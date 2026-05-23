import { analyzeDocumentWithBackend, convertDocToDocx, createDirectory, fileFingerprint, preprocessFile, readFile, writeFile } from "@/commands/fs"
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
import type { FileFingerprint } from "@/lib/source-fingerprint"
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
  if (ext === "xlsx") return "xlsx"
  if (ext === "xls") return "xls"
  if (ext === "ods") return "ods"
  return "generic"
}

function isSpreadsheetSourceKind(sourceKind: SourceKind): boolean {
  return sourceKind === "xlsx" || sourceKind === "xls" || sourceKind === "ods"
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

async function safeReadWithMaxBytes(path: string | null | undefined, maxBytes: number): Promise<string | null> {
  if (!path) return null
  try {
    const stat = await fileFingerprint(path)
    if (stat.sizeBytes > maxBytes) return null
  } catch {
    return null
  }
  return safeRead(path)
}

async function safeReadJsonWithMaxBytes<T>(
  path: string | null | undefined,
  maxBytes: number,
  fallback: T,
): Promise<T> {
  const raw = await safeReadWithMaxBytes(path, maxBytes)
  if (!raw) return fallback
  return safeJsonParse<T>(raw, fallback)
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
  sourceFingerprint?: FileFingerprint | null
  allowArtifactReuse?: boolean
}

const ARTIFACT_SCHEMA_VERSION = 2
const MAX_INGEST_ANALYSIS_BYTES = 4 * 1024 * 1024
const MAX_INGEST_JSON_ARTIFACT_BYTES = 8 * 1024 * 1024

function prepareOptionsSignature(options: PrepareDocumentOptions, sourceKind: SourceKind): string {
  return JSON.stringify({
    preferredPdfBackend: options.preferredPdfBackend,
    multimodalEnabled: options.multimodalEnabled,
    multimodalAvailable: options.multimodalAvailable,
    sourceKind,
  })
}

function fingerprintsMatch(a: FileFingerprint | undefined, b: FileFingerprint | null | undefined): boolean {
  if (!a || !b) return false
  return (
    a.sourceKey === b.sourceKey &&
    a.sizeBytes === b.sizeBytes &&
    a.modifiedMs === b.modifiedMs &&
    (a.sha256 === undefined || b.sha256 === undefined || a.sha256 === b.sha256)
  )
}

async function loadReusableArtifact(
  artifactDir: string,
  sourceKind: SourceKind,
  options: PrepareDocumentOptions,
): Promise<PreparedDocumentArtifact | null> {
  if (options.allowArtifactReuse === false || !options.sourceFingerprint) return null
  const rawManifest = await safeRead(`${artifactDir}/manifest.json`)
  if (!rawManifest) return null
  const manifest = safeJsonParse<EnhancedDocumentArtifactManifest | null>(rawManifest, null)
  if (!manifest) return null
  if (manifest.artifactSchemaVersion !== ARTIFACT_SCHEMA_VERSION) return null
  if (manifest.prepareOptionsSignature !== prepareOptionsSignature(options, sourceKind)) return null
  if (!fingerprintsMatch(manifest.sourceFingerprint, options.sourceFingerprint)) return null

  const analysisMarkdown = await safeReadWithMaxBytes(manifest.analysisPath ?? manifest.markdownPath, MAX_INGEST_ANALYSIS_BYTES)
  if (!analysisMarkdown) return null
  const normalizedBundle = await safeReadJsonWithMaxBytes<NormalizedDocumentBundle | null>(
    manifest.normalizedPath,
    MAX_INGEST_JSON_ARTIFACT_BYTES,
    null,
  )
  const documentIr = await safeReadJsonWithMaxBytes<DocumentIR | null>(
    manifest.documentIrPath,
    MAX_INGEST_JSON_ARTIFACT_BYTES,
    null,
  )

  return {
    sourceKind,
    backendStatus: {
      mode: manifest.backend,
      status: manifest.degraded ? "fallback" : "ready",
      detail: manifest.detail,
      degraded: manifest.degraded,
    },
    artifactManifest: manifest,
    analysisMarkdown,
    enhancedMarkdown: sourceKind === "pdf" ? analysisMarkdown : null,
    documentIr,
    normalizedBundle,
    convertedSourcePath: manifest.convertedSourcePath,
  }
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

  const reusable = await loadReusableArtifact(artifactDir, sourceKind, options)
  if (reusable) return reusable

  if (isSpreadsheetSourceKind(sourceKind)) {
    const analysisMarkdown = await preprocessFile(sp)
    const documentIr = buildDocumentIR(pp, sp, analysisMarkdown)
    const manifest: EnhancedDocumentArtifactManifest = {
      docId,
      sourcePath: sp,
      sourceKind,
      backend: "spreadsheet_core",
      artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
      sourceFingerprint: options.sourceFingerprint ?? undefined,
      prepareOptionsSignature: prepareOptionsSignature(options, sourceKind),
      generatedAt: new Date().toISOString(),
      outputDir: artifactDir,
      analysisPath: `${artifactDir}/analysis.md`,
      markdownPath: `${artifactDir}/document.md`,
      jsonPath: `${artifactDir}/document.json`,
      htmlPath: `${artifactDir}/document.html`,
      normalizedPath: null,
      documentIrPath: `${artifactDir}/document-ir.json`,
      convertedSourcePath: null,
      assetDirPath: `${artifactDir}/assets`,
      pageCount: null,
      ocrUsed: false,
      degraded: false,
      detail: "已通过本地表格解析器保留 Workbook/Sheet 行列结构。",
      availableEnhancers: ["calamine-spreadsheet"],
      missingEnhancers: [],
      warnings: [],
    }
    await writeFile(manifest.analysisPath!, analysisMarkdown)
    await writeFile(manifest.markdownPath!, analysisMarkdown)
    await writeFile(manifest.htmlPath!, `<html><body><pre>${analysisMarkdown}</pre></body></html>`)
    await writeFile(manifest.jsonPath!, JSON.stringify({
      sourceKind,
      blocks: documentIr.blocks,
      images: [],
      warnings: [],
    }, null, 2))
    await writeFile(manifest.documentIrPath!, JSON.stringify(documentIr, null, 2))
    await writeFile(`${artifactDir}/manifest.json`, JSON.stringify(manifest, null, 2))
    return {
      sourceKind,
      backendStatus: {
        mode: "spreadsheet_core",
        status: "ready",
        detail: manifest.detail,
        degraded: false,
      },
      artifactManifest: manifest,
      analysisMarkdown,
      enhancedMarkdown: null,
      documentIr,
      normalizedBundle: null,
      convertedSourcePath: null,
    }
  }

  if (sourceKind === "pdf") {
    const pdf = await preparePdfForIngest(pp, sp, options.preferredPdfBackend, { docId, sourceName })
    const manifest: EnhancedDocumentArtifactManifest | null = pdf.artifactManifest
      ? {
          ...pdf.artifactManifest,
          artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
          sourceFingerprint: options.sourceFingerprint ?? undefined,
          prepareOptionsSignature: prepareOptionsSignature(options, sourceKind),
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

  const analysisMarkdown = await safeReadWithMaxBytes(backend.analysisPath ?? backend.markdownPath, MAX_INGEST_ANALYSIS_BYTES)
    ?? `${sourceName} 已完成结构化解析，但解析稿超过 ${(MAX_INGEST_ANALYSIS_BYTES / 1024 / 1024).toFixed(0)}MB，ingest 主链仅使用轻量上下文以避免内存溢出。`
  const normalizedBundle = await safeReadJsonWithMaxBytes<NormalizedDocumentBundle | null>(
    backend.normalizedPath,
    MAX_INGEST_JSON_ARTIFACT_BYTES,
    null,
  )
  const documentIr = await safeReadJsonWithMaxBytes<DocumentIR | null>(
    backend.documentIrPath,
    MAX_INGEST_JSON_ARTIFACT_BYTES,
    null,
  )
  const manifest: EnhancedDocumentArtifactManifest = {
    docId,
    sourcePath: sp,
    sourceKind,
    backend: backend.backend,
    artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
    sourceFingerprint: options.sourceFingerprint ?? undefined,
    prepareOptionsSignature: prepareOptionsSignature(options, sourceKind),
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
    warnings: [
      ...backend.warnings,
      ...sourceBridgeWarnings,
      ...(documentIr ? [] : ["DocumentIR artifact skipped in ingest memory path because it is missing or too large."]),
      ...(normalizedBundle ? [] : ["Normalized artifact skipped in ingest memory path because it is missing or too large."]),
    ],
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
