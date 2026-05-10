import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { analyzePdfWithBackend } from "@/commands/fs"
import { getFileName, normalizePath } from "@/lib/path-utils"
import type {
  DocumentBlock,
  DocumentBackendStatus,
  DocumentIR,
  EnhancedPdfArtifactManifest,
  PdfBackendMode,
} from "@/lib/agent-mode-types"

export interface EnhancePdfResult {
  documentIr: DocumentIR | null
  backendStatus: DocumentBackendStatus
  artifactManifest: EnhancedPdfArtifactManifest | null
  enhancedMarkdown: string | null
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function blockTypeOf(raw: unknown): "heading" | "paragraph" | "list" | "table" | "quote" | "code" | "evidence" {
  const value = String(raw ?? "").toLowerCase()
  if (value.includes("heading") || value === "title") return "heading"
  if (value.includes("table")) return "table"
  if (value.includes("list")) return "list"
  if (value.includes("quote")) return "quote"
  if (value.includes("code")) return "code"
  if (value.includes("image") || value.includes("figure") || value.includes("chart")) return "evidence"
  return "paragraph"
}

function maybeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number") return String(value)
  if (Array.isArray(value)) {
    return value.map((item) => stringValue(item)).filter(Boolean).join(" ").trim()
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>
    return [
      obj.text,
      obj.value,
      obj.content,
      obj.markdown,
      obj.label,
      obj.caption,
      obj.alt_text,
      obj.altText,
    ]
      .map((item) => stringValue(item))
      .filter(Boolean)
      .join(" ")
      .trim()
  }
  return ""
}

function pageNumberOf(node: Record<string, unknown>, fallback: number | null): number | null {
  const candidates = [
    node.page,
    node["page number"],
    node.page_number,
    node.pageNumber,
    node.page_index,
  ]
  for (const candidate of candidates) {
    const value = Number(candidate)
    if (Number.isFinite(value) && value > 0) return value
  }
  return fallback
}

function bboxOf(node: Record<string, unknown>): [number, number, number, number] | null {
  const raw = node.bbox ?? node["bounding box"] ?? node.bounding_box ?? node.boundingBox
  if (!Array.isArray(raw) || raw.length < 4) return null
  const nums = raw.slice(0, 4).map((item) => Number(item))
  if (nums.every((item) => Number.isFinite(item))) {
    return [nums[0], nums[1], nums[2], nums[3]]
  }
  return null
}

function childrenOf(node: Record<string, unknown>): Record<string, unknown>[] {
  const rawChildren = node.kids ?? node.children ?? node.blocks ?? node.elements ?? node.regions ?? []
  return maybeArray<unknown>(rawChildren)
    .map((child) => asObject(child))
    .filter((child): child is Record<string, unknown> => Boolean(child))
}

function flattenOpenDataLoaderNodes(
  node: Record<string, unknown>,
  state: {
    docId: string
    sourcePath: string
    page: number | null
    readingOrder: number
    blocks: DocumentBlock[]
    rootOcrUsed: boolean
    headingPath: string[]
    currentParentId: string | null
  },
): void {
  const currentPage = pageNumberOf(node, state.page)
  const type = String(node.type ?? node.blockType ?? node.label ?? node.role ?? "").trim()
  const text = stringValue(node.content ?? node.text ?? node.markdown ?? node.value)
  const blockType = blockTypeOf(type)
  const blockId = `${state.docId}-pdf-b${String(state.blocks.length + 1).padStart(4, "0")}`
  const nextHeadingPath =
    blockType === "heading" && text
      ? [...state.headingPath, text]
      : [...state.headingPath]

  const shouldEmit = Boolean(text) || blockType === "evidence"
  const currentBlock: DocumentBlock | null = shouldEmit
    ? {
        blockId,
        blockType,
        textContent: text || "[图像/区域证据]",
        parentBlockId: state.currentParentId,
        childBlockIds: [],
        sourceRefs: [state.sourcePath],
        headingPath: blockType === "heading" ? [...state.headingPath] : [...state.headingPath],
        lineStart: state.blocks.length + 1,
        lineEnd: state.blocks.length + 1,
        page: currentPage,
        bbox: bboxOf(node),
        readingOrder: state.readingOrder,
        blockRole: type || null,
        ocrUsed: Boolean(node.ocr_used ?? node.ocrUsed ?? node["ocr used"] ?? state.rootOcrUsed),
      }
    : null

  if (currentBlock) {
    state.blocks.push(currentBlock)
    if (state.currentParentId) {
      const parent = state.blocks.find((item) => item.blockId === state.currentParentId)
      if (parent) parent.childBlockIds.push(currentBlock.blockId)
    }
  }

  const childParentId = currentBlock?.blockId ?? state.currentParentId
  const childHeadingPath = blockType === "heading" && text ? nextHeadingPath : state.headingPath
  for (const child of childrenOf(node)) {
    flattenOpenDataLoaderNodes(child, {
      ...state,
      page: currentPage,
      readingOrder: state.readingOrder + 1,
      headingPath: childHeadingPath,
      currentParentId: childParentId,
    })
  }
}

function buildIrFromEnhancedJson(
  docId: string,
  sourceName: string,
  sourcePath: string,
  jsonRaw: string,
): DocumentIR | null {
  const parsed = safeJsonParse<Record<string, unknown>>(jsonRaw, {})
  const root = asObject(parsed.document) ?? parsed
  const rootKids = childrenOf(root)
  const rootOcrUsed = Boolean(root.ocr_used ?? root.ocrUsed ?? root["ocr used"] ?? parsed.ocr_used ?? parsed.ocrUsed)
  const blocks: DocumentBlock[] = []

  if (rootKids.length > 0) {
    for (const child of rootKids) {
      flattenOpenDataLoaderNodes(child, {
        docId,
        sourcePath,
        page: null,
        readingOrder: blocks.length,
        blocks,
        rootOcrUsed,
        headingPath: [],
        currentParentId: null,
      })
    }
  } else {
    const fallbackNode = asObject(parsed)
    if (fallbackNode) {
      flattenOpenDataLoaderNodes(fallbackNode, {
        docId,
        sourcePath,
        page: null,
        readingOrder: 0,
        blocks,
        rootOcrUsed,
        headingPath: [],
        currentParentId: null,
      })
    }
  }

  if (blocks.length === 0) return null
  return {
    docId,
    sourceName,
    sourcePath,
    createdAt: new Date().toISOString(),
    blocks,
  }
}

async function safeRead(path: string | null): Promise<string | null> {
  if (!path) return null
  const content = await readFile(path).catch(() => "")
  return content.trim() ? content : null
}

export async function enhancePdfDocument(
  projectPath: string,
  sourcePath: string,
  docId: string,
  sourceName: string,
  backendMode: PdfBackendMode,
): Promise<EnhancePdfResult> {
  const pp = normalizePath(projectPath)
  const sp = normalizePath(sourcePath)
  const outputDir = `${pp}/.llm-wiki/pdf-artifacts/${docId}`
  await createDirectory(`${pp}/.llm-wiki`).catch(() => {})
  await createDirectory(`${pp}/.llm-wiki/pdf-artifacts`).catch(() => {})
  await createDirectory(outputDir).catch(() => {})

  const result = await analyzePdfWithBackend(sp, outputDir, backendMode)
  const backendStatus: DocumentBackendStatus = {
    mode: result.backend,
    status: result.status,
    detail: result.detail,
    degraded: result.degraded,
  }
  const manifest: EnhancedPdfArtifactManifest = {
    docId,
    sourcePath: sp,
    sourceKind: "pdf",
    backend: result.backend,
    generatedAt: new Date().toISOString(),
    outputDir,
    analysisPath: result.markdownPath,
    markdownPath: result.markdownPath,
    jsonPath: result.jsonPath,
    htmlPath: result.htmlPath,
    normalizedPath: null,
    documentIrPath: null,
    pageCount: result.pageCount,
    ocrUsed: result.ocrUsed,
    degraded: result.degraded,
    detail: result.detail,
    availableEnhancers: result.backend === "opendataloader" ? ["opendataloader-pdf"] : [],
    missingEnhancers: result.backend === "opendataloader" ? [] : ["opendataloader-pdf"],
    warnings: result.degraded ? [result.detail] : [],
  }
  await writeFile(`${outputDir}/manifest.json`, JSON.stringify(manifest, null, 2))

  const enhancedMarkdown = await safeRead(result.markdownPath ?? null)
  let documentIr: DocumentIR | null = null
  if (result.jsonPath) {
    const jsonRaw = await readFile(result.jsonPath).catch(() => "")
    if (jsonRaw.trim()) {
      documentIr = buildIrFromEnhancedJson(docId, sourceName, sp, jsonRaw)
    }
  }
  return {
    documentIr,
    backendStatus,
    artifactManifest: manifest,
    enhancedMarkdown,
  }
}

export async function preparePdfForIngest(
  projectPath: string,
  sourcePath: string,
  backendMode: PdfBackendMode,
  options?: {
    docId?: string
    sourceName?: string
  },
): Promise<EnhancePdfResult> {
  const sourceName = options?.sourceName ?? getFileName(sourcePath)
  const safeProjectPath = normalizePath(projectPath)
  const docId = options?.docId
    ?? `${sourceName.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "") || "document"}-pdf`
  return enhancePdfDocument(safeProjectPath, sourcePath, docId, sourceName, backendMode)
}
