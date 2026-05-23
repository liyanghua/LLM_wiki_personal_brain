import { createDirectory, listDirectory, readFile, readFileAsBase64, writeFile } from "@/commands/fs"
import { normalizeLocalImagePath } from "@/lib/markdown-image-resolver"
import { getFileStem, getRelativePath, normalizePath } from "@/lib/path-utils"
import {
  captionImage,
  classifyCaptionFailure,
  type CaptionFailureCode,
  type CaptionFailureDiagnosis,
} from "@/lib/vision-caption"
import type { LlmConfig } from "@/stores/wiki-store"
import type { ChatImageEvidence } from "@/stores/chat-store"
import type { FileNode } from "@/types/wiki"

export type KnowledgeImageIndexStatus = "indexed" | "captioned" | "needs_caption" | "missing_file"

export interface KnowledgeImageIndexEntry {
  imageId: string
  sourceSlug: string
  relPath: string
  sourcePath: string
  page: number | null
  sha256?: string | null
  caption: string
  fallbackCaption: string
  nearbyText: string
  headingPath: string[]
  tags: string[]
  linkedWikiRefs: string[]
  status: KnowledgeImageIndexStatus
  indexedAt: string
}

export interface KnowledgeImageIndexFile {
  schemaVersion: 1
  generatedAt: string
  entries: KnowledgeImageIndexEntry[]
}

export interface KnowledgeImageHit extends KnowledgeImageIndexEntry {
  score: number
  matchedReason: string
}

export interface ImageCaptionBackfillError {
  imageId: string
  relPath: string
  message: string
  failureCode?: CaptionFailureCode
  title?: string
  recommendedAction?: string
  retryable?: boolean
}

export interface ImageCaptionBackfillResult {
  total: number
  updated: number
  cached: number
  failed: number
  skipped: number
  errors: ImageCaptionBackfillError[]
  entries: KnowledgeImageIndexEntry[]
}

export type ImageCaptionBackfillStateStatus = "never_run" | "completed" | "partial" | "paused" | "failed"

export interface ImageCaptionBackfillState {
  schemaVersion: 1
  status: ImageCaptionBackfillStateStatus
  updatedAt: string
  total: number
  updated: number
  cached: number
  failed: number
  skipped: number
  remaining: number
  errorTitle?: string | null
  errorDetail?: string | null
  recommendedAction?: string | null
}

export interface ProjectCaptionBackfillResult {
  alreadyHandled: boolean
  state: ImageCaptionBackfillState
  result: ImageCaptionBackfillResult
}

export interface ImageCaptionBackfillOptions {
  signal?: AbortSignal
  maxEntries?: number
  stopAfterConsecutiveModelFailures?: number
  onProgress?: (done: number, total: number, result: ImageCaptionBackfillResult) => void
  force?: boolean
}

interface CaptionCacheEntry {
  caption: string
  mimeType: string
  model: string
  capturedAt: string
}

type CaptionCache = Record<string, CaptionCacheEntry>

const IMAGE_INDEX_REL_PATH = ".llm-wiki/image-index.json"
const CAPTION_CACHE_REL_PATH = ".llm-wiki/image-caption-cache.json"
const CAPTION_BACKFILL_STATE_REL_PATH = ".llm-wiki/image-caption-backfill-state.json"
const IMAGE_REF_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g

async function sha256OfBase64(b64: string): Promise<string> {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

function flattenFiles(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) out.push(...flattenFiles(node.children))
    else if (!node.is_dir) out.push(node)
  }
  return out
}

async function listFiles(root: string): Promise<FileNode[]> {
  try {
    return flattenFiles(await listDirectory(root))
  } catch {
    return []
  }
}

function normalizeImageUrl(rawUrl: string): string {
  const url = normalizeLocalImagePath(rawUrl)
  if (!url) return url
  const wikiIndex = url.lastIndexOf("/wiki/")
  if (wikiIndex >= 0) return url.slice(wikiIndex + "/wiki/".length)
  if (url.startsWith("wiki/")) return url.slice("wiki/".length)
  return url.replace(/^\.\//, "")
}

function pageFromRecentHeading(lines: string[], imageLineIndex: number): number | null {
  for (let i = imageLineIndex; i >= 0; i -= 1) {
    const match = lines[i]?.match(/^#{1,6}\s+Page\s+(\d+)\s*$/i)
    if (match) return Number(match[1])
  }
  return null
}

function headingPathBefore(lines: string[], imageLineIndex: number): string[] {
  const stack: Array<{ level: number; text: string }> = []
  for (let i = 0; i <= imageLineIndex; i += 1) {
    const match = lines[i]?.match(/^(#{1,6})\s+(.+)$/)
    if (!match) continue
    const level = match[1].length
    const text = match[2].trim()
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop()
    stack.push({ level, text })
  }
  return stack.map((item) => item.text)
}

function nearbyText(lines: string[], imageLineIndex: number): string {
  const start = Math.max(0, imageLineIndex - 8)
  const before = lines
    .slice(start, imageLineIndex)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("!") && !line.includes("llm-wiki:embedded-images"))
  return before.slice(-5).join(" ").slice(0, 500)
}

function tagsFor(text: string): string[] {
  const tags = [
    "主图",
    "细节",
    "案例",
    "素材",
    "版式",
    "构图",
    "视觉",
    "卖点",
    "安全区",
    "描边",
    "场景图",
    "细节图",
    "信任营销",
  ]
  return tags.filter((tag) => text.includes(tag))
}

function fallbackCaptionFor(input: {
  sourceSlug: string
  page: number | null
  index: number
  headingPath: string[]
}): string {
  const pageText = input.page ? `第 ${input.page} 页` : "文档"
  const nonPageHeadings = input.headingPath.filter((item) => !/^Page\s+\d+$/i.test(item))
  const heading = nonPageHeadings.length > 0 ? nonPageHeadings[nonPageHeadings.length - 1] : undefined
  return `${input.sourceSlug} ${pageText}图片 ${input.index}${heading ? `（${heading}）` : ""}，缺少视觉说明`
}

function extractImageEntriesFromSourcePage(
  projectPath: string,
  sourcePagePath: string,
  content: string,
  indexedAt: string,
): KnowledgeImageIndexEntry[] {
  const pp = normalizePath(projectPath)
  const lines = content.replace(/\r\n/g, "\n").split("\n")
  const sourceSlug = getFileStem(sourcePagePath)
  const entries: KnowledgeImageIndexEntry[] = []
  const seen = new Set<string>()

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    const matches = [...line.matchAll(new RegExp(IMAGE_REF_RE.source, IMAGE_REF_RE.flags))]
    for (const match of matches) {
      const relPath = normalizeImageUrl(match[2] ?? "")
      if (!relPath || !relPath.startsWith("media/") || seen.has(relPath)) continue
      seen.add(relPath)
      const alt = (match[1] ?? "").trim()
      const page = pageFromRecentHeading(lines, lineIndex)
      const headingPath = headingPathBefore(lines, lineIndex)
      const context = nearbyText(lines, lineIndex)
      const fallbackCaption = fallbackCaptionFor({
        sourceSlug,
        page,
        index: entries.length + 1,
        headingPath,
      })
      const caption = alt || fallbackCaption
      const linkedWikiRefs = [...content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)]
        .map((item) => item[1])
        .filter(Boolean)
        .slice(0, 12)
      const tagSource = `${caption} ${context} ${headingPath.join(" ")}`
      entries.push({
        imageId: `${sourceSlug}-image-${entries.length + 1}`,
        sourceSlug,
        relPath,
        sourcePath: getRelativePath(sourcePagePath, pp),
        page,
        sha256: null,
        caption,
        fallbackCaption,
        nearbyText: context,
        headingPath,
        tags: tagsFor(tagSource),
        linkedWikiRefs,
        status: alt ? "indexed" : "needs_caption",
        indexedAt,
      })
    }
  }
  return entries
}

async function collectReferencedImages(projectPath: string, indexedAt: string): Promise<KnowledgeImageIndexEntry[]> {
  const pp = normalizePath(projectPath)
  const sourceFiles = (await listFiles(`${pp}/wiki/sources`)).filter((file) => file.name.endsWith(".md"))
  const entries: KnowledgeImageIndexEntry[] = []
  for (const file of sourceFiles) {
    try {
      const content = await readFile(file.path)
      entries.push(...extractImageEntriesFromSourcePage(pp, file.path, content, indexedAt))
    } catch {
      // Ignore unreadable source pages; media-only fallback below still indexes files.
    }
  }
  return entries
}

async function collectMediaFallbacks(
  projectPath: string,
  knownRelPaths: Set<string>,
  indexedAt: string,
): Promise<KnowledgeImageIndexEntry[]> {
  const pp = normalizePath(projectPath)
  const files = await listFiles(`${pp}/wiki/media`)
  const imageFiles = files.filter((file) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name))
  const out: KnowledgeImageIndexEntry[] = []
  for (const file of imageFiles) {
    const relPath = getRelativePath(file.path, `${pp}/wiki`)
    if (knownRelPaths.has(relPath)) continue
    const parts = relPath.split("/")
    const sourceSlug = parts[1] || "media"
    const fallbackCaption = `${sourceSlug} 图片 ${out.length + 1}，缺少视觉说明`
    out.push({
      imageId: `${sourceSlug}-orphan-image-${out.length + 1}`,
      sourceSlug,
      relPath,
      sourcePath: `wiki/media/${sourceSlug}`,
      page: null,
      sha256: null,
      caption: fallbackCaption,
      fallbackCaption,
      nearbyText: "",
      headingPath: [],
      tags: tagsFor(`${sourceSlug} ${fallbackCaption}`),
      linkedWikiRefs: [],
      status: "needs_caption",
      indexedAt,
    })
  }
  return out
}

async function attachImageFileHashes(
  projectPath: string,
  entries: KnowledgeImageIndexEntry[],
): Promise<KnowledgeImageIndexEntry[]> {
  const pp = normalizePath(projectPath)
  return Promise.all(entries.map(async (entry) => {
    try {
      const file = await readFileAsBase64(`${pp}/wiki/${entry.relPath}`)
      return {
        ...entry,
        sha256: await sha256OfBase64(file.base64),
      }
    } catch {
      return {
        ...entry,
        sha256: null,
        status: "missing_file" as const,
      }
    }
  }))
}

export async function buildOrRefreshImageIndex(projectPath: string): Promise<KnowledgeImageIndexEntry[]> {
  const pp = normalizePath(projectPath)
  const indexedAt = new Date().toISOString()
  const previousEntries = await loadImageIndexFile(pp).then((file) => file.entries).catch(() => [])
  const referenced = await collectReferencedImages(pp, indexedAt)
  const knownRelPaths = new Set(referenced.map((entry) => entry.relPath))
  const mediaFallbacks = await collectMediaFallbacks(pp, knownRelPaths, indexedAt)
  const hashedEntries = await attachImageFileHashes(
    pp,
    [...referenced, ...mediaFallbacks].map((entry, index) => ({
      ...entry,
      imageId: `image-${String(index + 1).padStart(4, "0")}`,
    })),
  )
  const entries = mergeExistingCaptionMetadata(hashedEntries, previousEntries)
  const payload: KnowledgeImageIndexFile = {
    schemaVersion: 1,
    generatedAt: indexedAt,
    entries,
  }
  await createDirectory(`${pp}/.llm-wiki`)
  await writeFile(`${pp}/${IMAGE_INDEX_REL_PATH}`, `${JSON.stringify(payload, null, 2)}\n`)
  return entries
}

export async function loadImageIndex(projectPath: string): Promise<KnowledgeImageIndexEntry[]> {
  const pp = normalizePath(projectPath)
  try {
    return (await loadImageIndexFile(pp)).entries
  } catch {
    return []
  }
}

export async function refreshImageEvidenceFromIndex(
  projectPath: string,
  imageEvidence: ChatImageEvidence[],
): Promise<ChatImageEvidence[]> {
  const entries = await loadImageIndex(projectPath)
  if (entries.length === 0 || imageEvidence.length === 0) return imageEvidence

  const byId = new Map(entries.map((entry) => [entry.imageId, entry]))
  const byRelPath = new Map(entries.map((entry) => [entry.relPath, entry]))

  return imageEvidence.map((item) => {
    const updated = byId.get(item.imageId) ?? byRelPath.get(item.relPath)
    if (!updated) return item
    return {
      ...item,
      imageId: updated.imageId,
      relPath: updated.relPath,
      caption: updated.caption || updated.fallbackCaption,
      fallbackCaption: updated.fallbackCaption,
      sourcePath: updated.sourcePath,
      page: updated.page,
      status: updated.status,
      matchedReason: updated.status === "captioned"
        ? "图片说明已补齐，可用于后续检索排序"
        : item.matchedReason,
    }
  })
}

async function loadImageIndexFile(projectPath: string): Promise<KnowledgeImageIndexFile> {
  const pp = normalizePath(projectPath)
  const raw = await readFile(`${pp}/${IMAGE_INDEX_REL_PATH}`)
  const parsed = JSON.parse(raw) as Partial<KnowledgeImageIndexFile>
  return {
    schemaVersion: 1,
    generatedAt: parsed.generatedAt || new Date().toISOString(),
    entries: Array.isArray(parsed.entries) ? parsed.entries : [],
  }
}

async function readCaptionCache(projectPath: string): Promise<CaptionCache> {
  const pp = normalizePath(projectPath)
  try {
    const raw = await readFile(`${pp}/${CAPTION_CACHE_REL_PATH}`)
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as CaptionCache
      : {}
  } catch {
    return {}
  }
}

async function writeCaptionCache(projectPath: string, cache: CaptionCache): Promise<void> {
  const pp = normalizePath(projectPath)
  await createDirectory(`${pp}/.llm-wiki`)
  await writeFile(`${pp}/${CAPTION_CACHE_REL_PATH}`, `${JSON.stringify(cache, null, 2)}\n`)
}

function emptyBackfillResult(entries: KnowledgeImageIndexEntry[], total = 0, skipped = 0): ImageCaptionBackfillResult {
  return {
    total,
    updated: 0,
    cached: 0,
    failed: 0,
    skipped,
    errors: [],
    entries,
  }
}

function needsCaptionEntry(entry: KnowledgeImageIndexEntry): boolean {
  if (entry.status === "missing_file") return false
  return entry.status === "needs_caption" || isFallbackOnlyCaption(entry)
}

function stateFromResult(result: ImageCaptionBackfillResult): ImageCaptionBackfillState {
  const lastError = result.errors[result.errors.length - 1]
  const remaining = result.entries.filter(needsCaptionEntry).length
  const paused = result.errors.some((error) => error.imageId === "__batch__")
  const status: ImageCaptionBackfillStateStatus =
    paused ? "paused"
      : result.failed > 0 ? "partial"
        : remaining === 0 ? "completed"
          : "partial"
  return {
    schemaVersion: 1,
    status,
    updatedAt: new Date().toISOString(),
    total: result.total,
    updated: result.updated,
    cached: result.cached,
    failed: result.failed,
    skipped: result.skipped,
    remaining,
    errorTitle: lastError?.title ?? null,
    errorDetail: lastError?.message ?? null,
    recommendedAction: lastError?.recommendedAction ?? null,
  }
}

async function writeImageCaptionBackfillState(projectPath: string, state: ImageCaptionBackfillState): Promise<void> {
  const pp = normalizePath(projectPath)
  await createDirectory(`${pp}/.llm-wiki`)
  await writeFile(`${pp}/${CAPTION_BACKFILL_STATE_REL_PATH}`, `${JSON.stringify(state, null, 2)}\n`)
}

export async function loadImageCaptionBackfillState(projectPath: string): Promise<ImageCaptionBackfillState> {
  const pp = normalizePath(projectPath)
  try {
    const parsed = JSON.parse(await readFile(`${pp}/${CAPTION_BACKFILL_STATE_REL_PATH}`)) as Partial<ImageCaptionBackfillState>
    return {
      schemaVersion: 1,
      status: parsed.status ?? "never_run",
      updatedAt: parsed.updatedAt ?? "",
      total: parsed.total ?? 0,
      updated: parsed.updated ?? 0,
      cached: parsed.cached ?? 0,
      failed: parsed.failed ?? 0,
      skipped: parsed.skipped ?? 0,
      remaining: parsed.remaining ?? 0,
      errorTitle: parsed.errorTitle ?? null,
      errorDetail: parsed.errorDetail ?? null,
      recommendedAction: parsed.recommendedAction ?? null,
    }
  } catch {
    return {
      schemaVersion: 1,
      status: "never_run",
      updatedAt: "",
      total: 0,
      updated: 0,
      cached: 0,
      failed: 0,
      skipped: 0,
      remaining: 0,
      errorTitle: null,
      errorDetail: null,
      recommendedAction: null,
    }
  }
}

function isFallbackOnlyCaption(entry: KnowledgeImageIndexEntry): boolean {
  return !entry.caption
    || entry.caption === entry.fallbackCaption
    || /缺少视觉说明|Embedded Images/i.test(entry.caption)
}

function sourceScopeKey(entry: Pick<KnowledgeImageIndexEntry, "sourceSlug" | "page" | "relPath">): string {
  return `${entry.sourceSlug}::${entry.page ?? "no-page"}::${entry.relPath.split("/").pop() ?? entry.relPath}`
}

function buildExistingEntryLookup(entries: KnowledgeImageIndexEntry[]): {
  byHash: Map<string, KnowledgeImageIndexEntry>
  byRelPath: Map<string, KnowledgeImageIndexEntry>
  byScope: Map<string, KnowledgeImageIndexEntry>
} {
  const byHash = new Map<string, KnowledgeImageIndexEntry>()
  const byRelPath = new Map<string, KnowledgeImageIndexEntry>()
  const byScope = new Map<string, KnowledgeImageIndexEntry>()
  for (const entry of entries) {
    if (entry.sha256) byHash.set(entry.sha256, entry)
    byRelPath.set(entry.relPath, entry)
    byScope.set(sourceScopeKey(entry), entry)
  }
  return { byHash, byRelPath, byScope }
}

function mergeCaptionedEntry(
  next: KnowledgeImageIndexEntry,
  previous: KnowledgeImageIndexEntry | undefined,
): KnowledgeImageIndexEntry {
  if (!previous || previous.status !== "captioned" || isFallbackOnlyCaption(previous)) return next
  return {
    ...next,
    caption: previous.caption,
    status: "captioned",
    tags: [...new Set([...next.tags, ...previous.tags, ...tagsFor(previous.caption)])],
    linkedWikiRefs: [...new Set([...next.linkedWikiRefs, ...previous.linkedWikiRefs])],
  }
}

function mergeExistingCaptionMetadata(
  entries: KnowledgeImageIndexEntry[],
  previousEntries: KnowledgeImageIndexEntry[],
): KnowledgeImageIndexEntry[] {
  const lookup = buildExistingEntryLookup(previousEntries)
  return entries.map((entry) => {
    const previous = (entry.sha256 ? lookup.byHash.get(entry.sha256) : undefined)
      ?? lookup.byRelPath.get(entry.relPath)
      ?? lookup.byScope.get(sourceScopeKey(entry))
    return mergeCaptionedEntry(entry, previous)
  })
}

function sanitizeCaption(caption: string): string {
  return caption
    .replace(/[\r\n]+/g, " ")
    .replace(/^\s*[-*]\s*/, "")
    .trim()
}

function buildCaptionContext(entry: KnowledgeImageIndexEntry): { before: string; after: string } {
  const pageText = entry.page ? `第 ${entry.page} 页` : "未知页码"
  const before = [
    `来源文档：${entry.sourceSlug}`,
    `来源页：${pageText}`,
    entry.headingPath.length > 0 ? `所在标题：${entry.headingPath.join(" / ")}` : "",
    entry.nearbyText ? `图片附近文本：${entry.nearbyText}` : "",
  ].filter(Boolean).join("\n")
  const after = [
    entry.tags.length > 0 ? `已有标签：${entry.tags.join("、")}` : "",
    entry.linkedWikiRefs.length > 0 ? `关联知识页：${entry.linkedWikiRefs.join("、")}` : "",
    "请优先描述这张图对主图设计、细节呈现、卖点放大、材质质感、版式构图或案例对比的可检索价值。",
  ].filter(Boolean).join("\n")
  return { before, after }
}

function resolveCaptionTargets(
  entries: KnowledgeImageIndexEntry[],
  entryIds?: string[] | null,
  maxEntries?: number,
): KnowledgeImageIndexEntry[] {
  const idSet = entryIds && entryIds.length > 0 ? new Set(entryIds) : null
  const targets = entries.filter((entry) => {
    if (idSet && !idSet.has(entry.imageId)) return false
    return needsCaptionEntry(entry)
  })
  return typeof maxEntries === "number" && maxEntries > 0
    ? targets.slice(0, maxEntries)
    : targets
}

export async function captionProjectImagesOnce(
  projectPath: string,
  llmConfig: LlmConfig,
  options: ImageCaptionBackfillOptions = {},
): Promise<ProjectCaptionBackfillResult> {
  const pp = normalizePath(projectPath)
  let entries = await loadImageIndex(pp)
  if (entries.length === 0) entries = await buildOrRefreshImageIndex(pp)
  const state = await loadImageCaptionBackfillState(pp)
  const targets = resolveCaptionTargets(entries, null, options.maxEntries)
  const alreadyHandled = !options.force && (state.status === "completed" || state.status === "paused")
  if (alreadyHandled) {
    return {
      alreadyHandled: true,
      state,
      result: emptyBackfillResult(entries, targets.length, targets.length),
    }
  }
  if (targets.length === 0) {
    const completed: ImageCaptionBackfillState = {
      schemaVersion: 1,
      status: "completed",
      updatedAt: new Date().toISOString(),
      total: 0,
      updated: 0,
      cached: 0,
      failed: 0,
      skipped: 0,
      remaining: 0,
      errorTitle: null,
      errorDetail: null,
      recommendedAction: null,
    }
    await writeImageCaptionBackfillState(pp, completed)
    return {
      alreadyHandled: true,
      state: completed,
      result: emptyBackfillResult(entries),
    }
  }
  const result = await captionImageIndexEntries(pp, null, llmConfig, options)
  const nextState = stateFromResult(result)
  await writeImageCaptionBackfillState(pp, nextState)
  return {
    alreadyHandled: false,
    state: nextState,
    result,
  }
}

export async function captionImageIndexEntries(
  projectPath: string,
  entryIds: string[] | null | undefined,
  llmConfig: LlmConfig,
  options: ImageCaptionBackfillOptions = {},
): Promise<ImageCaptionBackfillResult> {
  const pp = normalizePath(projectPath)
  let indexFile: KnowledgeImageIndexFile
  try {
    indexFile = await loadImageIndexFile(pp)
  } catch {
    const entries = await buildOrRefreshImageIndex(pp)
    indexFile = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      entries,
    }
  }

  const cache = await readCaptionCache(pp)
  const targets = resolveCaptionTargets(indexFile.entries, entryIds, options.maxEntries)
  const result: ImageCaptionBackfillResult = {
    total: targets.length,
    updated: 0,
    cached: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    entries: indexFile.entries,
  }

  let done = 0
  let consecutiveFailureCode: CaptionFailureCode | null = null
  let consecutiveFailures = 0
  const stopAfterConsecutiveModelFailures = Math.max(1, options.stopAfterConsecutiveModelFailures ?? 3)
  let cacheChanged = false
  let indexChanged = false
  for (const target of targets) {
    if (options.signal?.aborted) {
      result.skipped += 1
      done += 1
      options.onProgress?.(done, targets.length, result)
      continue
    }

    const entryIndex = indexFile.entries.findIndex((entry) => entry.imageId === target.imageId)
    if (entryIndex < 0) {
      result.skipped += 1
      done += 1
      options.onProgress?.(done, targets.length, result)
      continue
    }

    try {
      const bytes = await readFileAsBase64(`${pp}/wiki/${target.relPath}`)
      const hash = target.sha256 || await sha256OfBase64(bytes.base64)
      const cached = cache[hash]
      const now = new Date().toISOString()
      if (cached?.caption) {
        indexFile.entries[entryIndex] = {
          ...indexFile.entries[entryIndex],
          caption: cached.caption,
          status: "captioned",
          sha256: hash,
          indexedAt: now,
          tags: [...new Set([...indexFile.entries[entryIndex].tags, ...tagsFor(cached.caption)])],
        }
        result.cached += 1
        consecutiveFailureCode = null
        consecutiveFailures = 0
        indexChanged = true
      } else {
        const context = buildCaptionContext(target)
        const caption = sanitizeCaption(await captionImage(
          bytes.base64,
          bytes.mimeType,
          llmConfig,
          options.signal,
          {
            contextBefore: context.before,
            contextAfter: context.after,
          },
        ))
        if (!caption) throw new Error("VLM 返回了空图片说明")
        cache[hash] = {
          caption,
          mimeType: bytes.mimeType,
          model: llmConfig.model,
          capturedAt: now,
        }
        indexFile.entries[entryIndex] = {
          ...indexFile.entries[entryIndex],
          caption,
          status: "captioned",
          sha256: hash,
          indexedAt: now,
          tags: [...new Set([...indexFile.entries[entryIndex].tags, ...tagsFor(caption)])],
        }
        result.updated += 1
        consecutiveFailureCode = null
        consecutiveFailures = 0
        cacheChanged = true
        indexChanged = true
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const diagnosis: CaptionFailureDiagnosis = classifyCaptionFailure(err, llmConfig)
      result.failed += 1
      result.errors.push({
        imageId: target.imageId,
        relPath: target.relPath,
        message,
        failureCode: diagnosis.code,
        title: diagnosis.title,
        recommendedAction: diagnosis.recommendedAction,
        retryable: diagnosis.retryable,
      })
      if (!diagnosis.retryable) {
        consecutiveFailures = consecutiveFailureCode === diagnosis.code ? consecutiveFailures + 1 : 1
        consecutiveFailureCode = diagnosis.code
      } else {
        consecutiveFailures = 0
        consecutiveFailureCode = null
      }
    }

    done += 1
    options.onProgress?.(done, targets.length, result)

    if (consecutiveFailureCode && consecutiveFailures >= stopAfterConsecutiveModelFailures) {
      const remaining = targets.length - done
      if (remaining > 0) {
        result.skipped += remaining
        result.errors.push({
          imageId: "__batch__",
          relPath: "",
          message: `连续 ${consecutiveFailures} 次 ${consecutiveFailureCode}，已暂停剩余 ${remaining} 张图片，避免继续消耗请求。`,
          failureCode: consecutiveFailureCode,
          title: "批量补齐已自动暂停",
          recommendedAction: result.errors[result.errors.length - 1]?.recommendedAction
            ?? "请修复 VLM 配置后重试。",
          retryable: false,
        })
      }
      break
    }
  }

  if (indexChanged) {
    indexFile.generatedAt = new Date().toISOString()
    await createDirectory(`${pp}/.llm-wiki`)
    await writeFile(`${pp}/${IMAGE_INDEX_REL_PATH}`, `${JSON.stringify(indexFile, null, 2)}\n`)
  }
  if (cacheChanged) {
    await writeCaptionCache(pp, cache)
  }

  result.entries = indexFile.entries
  return result
}

function tokenizeQuery(query: string): string[] {
  const raw = query
    .toLowerCase()
    .split(/[\s,，。！？、；：""''（）()\-_/\\·~～…]+/)
    .filter(Boolean)
  const tokens: string[] = []
  for (const token of raw) {
    if (/[\u4e00-\u9fff]/.test(token) && token.length > 2) {
      const chars = [...token]
      for (let i = 0; i < chars.length - 1; i += 1) tokens.push(chars[i] + chars[i + 1])
      tokens.push(token)
    } else {
      tokens.push(token)
    }
  }
  return [...new Set(tokens.filter((token) => token.length >= 2))]
}

function scoreEntry(entry: KnowledgeImageIndexEntry, query: string, tokens: string[]): KnowledgeImageHit | null {
  const captionText = (entry.caption || "").toLowerCase()
  const fallbackText = (entry.fallbackCaption || "").toLowerCase()
  const contextText = [
    entry.nearbyText,
    entry.headingPath.join(" "),
    entry.tags.join(" "),
    entry.sourceSlug,
    entry.linkedWikiRefs.join(" "),
  ].join(" ").toLowerCase()
  const searchable = [captionText, fallbackText, contextText].join(" ")
  const captionMatched = tokens.filter((token) => captionText.includes(token))
  const contextMatched = tokens.filter((token) => contextText.includes(token) || fallbackText.includes(token))
  const matched = [...new Set([...captionMatched, ...contextMatched])]
  const phrase = query.trim().toLowerCase()
  let score = 0
  if (phrase && searchable.includes(phrase)) score += 50
  score += contextMatched.length * 6
  score += captionMatched.length * 14
  if (!isFallbackOnlyCaption(entry)) score += 16
  if (entry.status === "captioned") score += 12
  if (entry.tags.some((tag) => /主图|细节|案例|素材|视觉|版式/.test(tag))) score += 8
  if (matched.length === 0 && score === 0) return null
  const lacksVisualCaption = entry.status === "needs_caption" && isFallbackOnlyCaption(entry)
  return {
    ...entry,
    score,
    matchedReason: lacksVisualCaption
      ? `按来源主题召回，待补图片说明${matched.length > 0 ? `：命中 ${matched.slice(0, 5).join("、")}` : ""}`
      : captionMatched.length > 0
      ? `图片说明命中：${captionMatched.slice(0, 5).join("、")}`
      : contextMatched.length > 0
      ? `图片上下文命中：${contextMatched.slice(0, 5).join("、")}`
      : "命中图片索引语义描述",
  }
}

export async function searchKnowledgeImages(
  projectPath: string,
  query: string,
  options: { limit?: number; refreshIfMissing?: boolean } = {},
): Promise<KnowledgeImageHit[]> {
  const limit = options.limit ?? 8
  let entries = await loadImageIndex(projectPath)
  if (entries.length === 0 && options.refreshIfMissing !== false) {
    entries = await buildOrRefreshImageIndex(projectPath)
  }
  const tokens = tokenizeQuery(query)
  const hits = entries
    .map((entry) => scoreEntry(entry, query, tokens))
    .filter((entry): entry is KnowledgeImageHit => Boolean(entry))
    .sort((a, b) => b.score - a.score)
  return hits.slice(0, limit)
}

export function formatImageEvidenceForPrompt(hits: KnowledgeImageHit[]): string {
  return hits.map((hit, index) => {
    const imageId = `img-${index + 1}`
    return [
      `### ${imageId}`,
      `Markdown: ![${hit.caption || hit.fallbackCaption}](${hit.relPath})`,
      `Caption: ${hit.caption || hit.fallbackCaption}`,
      `Source: ${hit.sourcePath}${hit.page ? `, page ${hit.page}` : ""}`,
      hit.nearbyText ? `Nearby text: ${hit.nearbyText}` : "",
      hit.tags.length > 0 ? `Tags: ${hit.tags.join(", ")}` : "",
      `Why relevant: ${hit.matchedReason}`,
    ].filter(Boolean).join("\n")
  }).join("\n\n")
}
