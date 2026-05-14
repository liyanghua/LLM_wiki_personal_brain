import { analyzeDocumentWithBackend, convertDocToDocx, createDirectory, readFile, writeFile } from "@/commands/fs"
import { preparePdfForIngest } from "@/lib/pdf-enhanced"
import { buildDocumentIR } from "@/lib/document-ir"
import { getFileName, normalizePath } from "@/lib/path-utils"
import type {
  DocumentBackendStatus,
  DocumentIR,
  EnhancedDocumentArtifactManifest,
  NormalizedDocumentBundle,
  PreparedDocumentArtifact,
  SourceKind,
} from "@/lib/agent-mode-types"
import type { PdfBackendMode } from "@/stores/wiki-store"

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function detectSourceKind(sourcePath: string): SourceKind {
  const ext = sourcePath.split(".").pop()?.toLowerCase() ?? ""
  if (ext === "pdf") return "pdf"
  if (ext === "docx") return "docx"
  if (ext === "doc") return "doc"
  if (ext === "xmind") return "xmind"
  return "generic"
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

async function safeRead(path: string | null | undefined): Promise<string | null> {
  if (!path) return null
  try {
    const content = await readFile(path)
    return content.trim() ? content : null
  } catch {
    return null
  }
}

function docIdFromPath(sourcePath: string): string {
  const fileName = getFileName(sourcePath)
  return `${slugify(fileName.replace(/\.[^.]+$/, "")) || "document"}-${Math.abs(hashCode(sourcePath)).toString(36).slice(0, 6)}`
}

function hashCode(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i)
    hash |= 0
  }
  return hash
}

function defaultStatus(sourceKind: SourceKind, detail: string): DocumentBackendStatus {
  return {
    mode: sourceKind === "pdf" ? "pdfium" : "generic",
    status: sourceKind === "pdf" ? "fallback" : "ready",
    detail,
    degraded: sourceKind !== "generic",
  }
}

export interface PrepareDocumentOptions {
  preferredPdfBackend: PdfBackendMode
  multimodalEnabled: boolean
  multimodalAvailable: boolean
}

export async function prepareDocumentForIngest(
  projectPath: string,
  sourcePath: string,
  options: PrepareDocumentOptions,
): Promise<PreparedDocumentArtifact> {
  const pp = normalizePath(projectPath)
  const sp = normalizePath(sourcePath)
  const sourceKind = detectSourceKind(sp)
  const docId = docIdFromPath(sp)
  const sourceName = getFileName(sp)
  const artifactDir = `${pp}/.llm-wiki/document-artifacts/${docId}`

  await createDirectory(`${pp}/.llm-wiki`).catch(() => {})
  await createDirectory(`${pp}/.llm-wiki/document-artifacts`).catch(() => {})
  await createDirectory(artifactDir).catch(() => {})

  if (sourceKind === "pdf") {
    const pdf = await preparePdfForIngest(pp, sp, options.preferredPdfBackend, { docId, sourceName })
    const manifest: EnhancedDocumentArtifactManifest | null = pdf.artifactManifest
      ? {
          ...pdf.artifactManifest,
          sourceKind,
          backend: pdf.artifactManifest.backend,
          analysisPath: pdf.artifactManifest.markdownPath,
          normalizedPath: null,
          documentIrPath: null,
          assetDirPath: `${artifactDir}/assets`,
          availableEnhancers: pdf.backendStatus.mode === "opendataloader" ? ["opendataloader-pdf"] : [],
          missingEnhancers: pdf.backendStatus.mode === "opendataloader" ? [] : ["opendataloader-pdf"],
          warnings: pdf.backendStatus.degraded ? [pdf.backendStatus.detail] : [],
        }
      : null
    if (manifest) {
      await writeFile(`${artifactDir}/manifest.json`, JSON.stringify(manifest, null, 2)).catch(() => {})
    }
    return {
      sourceKind,
      backendStatus: pdf.backendStatus,
      artifactManifest: manifest,
      analysisMarkdown: pdf.enhancedMarkdown,
      enhancedMarkdown: pdf.enhancedMarkdown,
      documentIr: pdf.documentIr,
      normalizedBundle: null,
      convertedSourcePath: null,
    }
  }

  let backendSourcePath = sp
  let sourceBridgeWarnings: string[] = []
  let bridgeMode: SourceKind = sourceKind

  if (sourceKind === "doc") {
    const conversionDir = `${pp}/.llm-wiki/source-conversions/${docId}`
    await createDirectory(`${pp}/.llm-wiki/source-conversions`).catch(() => {})
    await createDirectory(conversionDir).catch(() => {})
    backendSourcePath = await convertDocToDocx(sp, conversionDir)
    bridgeMode = "docx"
    sourceBridgeWarnings = ["原始 DOC 已通过 soffice 转换为 DOCX 后再进入理解主链。"]
  }

  const backend = await analyzeDocumentWithBackend(
    pp,
    backendSourcePath,
    artifactDir,
    bridgeMode,
    {
      multimodalEnabled: options.multimodalEnabled,
      multimodalAvailable: options.multimodalAvailable,
    },
  )

  const analysisMarkdown = await safeRead(backend.analysisPath ?? backend.markdownPath)
  const normalizedBundle = safeJsonParse<NormalizedDocumentBundle | null>(
    (await safeRead(backend.normalizedPath)) ?? "",
    null,
  )
  const documentIr = safeJsonParse<DocumentIR | null>(
    (await safeRead(backend.documentIrPath)) ?? "",
    null,
  )
  const manifest: EnhancedDocumentArtifactManifest = {
    docId,
    sourcePath: sp,
    sourceKind,
    backend: backend.backend,
    generatedAt: new Date().toISOString(),
    outputDir: artifactDir,
    analysisPath: backend.analysisPath,
    markdownPath: backend.markdownPath,
    jsonPath: backend.jsonPath,
    htmlPath: backend.htmlPath,
    normalizedPath: backend.normalizedPath,
    documentIrPath: backend.documentIrPath,
    convertedSourcePath: backend.convertedSourcePath,
    assetDirPath: backend.assetDirPath,
    pageCount: backend.pageCount,
    ocrUsed: backend.ocrUsed,
    degraded: backend.degraded,
    detail: backend.detail,
    availableEnhancers: backend.availableEnhancers,
    missingEnhancers: backend.missingEnhancers,
    warnings: [...backend.warnings, ...sourceBridgeWarnings],
  }
  await writeFile(`${artifactDir}/manifest.json`, JSON.stringify(manifest, null, 2)).catch(() => {})

  return {
    sourceKind,
    backendStatus: {
      mode: backend.backend,
      status: backend.status,
      detail: backend.detail,
      degraded: backend.degraded,
    },
    artifactManifest: manifest,
    analysisMarkdown,
    documentIr,
    normalizedBundle,
    convertedSourcePath: backend.convertedSourcePath,
  }
}

export async function buildPreparedGenericDocument(
  projectPath: string,
  sourcePath: string,
  sourceContent: string,
): Promise<PreparedDocumentArtifact> {
  const sourceKind = detectSourceKind(sourcePath)
  const ir = buildDocumentIR(projectPath, sourcePath, sourceContent)
  return {
    sourceKind,
    backendStatus: defaultStatus(sourceKind, "当前文档使用通用文本链路。"),
    artifactManifest: null,
    analysisMarkdown: sourceContent,
    documentIr: ir,
    normalizedBundle: null,
    convertedSourcePath: null,
  }
}
