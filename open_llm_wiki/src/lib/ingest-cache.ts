import { readFile, writeFile, fileExists } from "@/commands/fs"
import { normalizePath, isAbsolutePath } from "@/lib/path-utils"
import type { FileFingerprint } from "@/lib/source-fingerprint"

export type { FileFingerprint } from "@/lib/source-fingerprint"

/**
 * SHA256-based ingest cache.
 * Stores hash of source file content → skips re-ingest if unchanged.
 * Cache file: .llm-wiki/ingest-cache.json
 */

export interface IngestCacheEntry {
  hash: string
  timestamp: number
  filesWritten: string[]
  sourceKey?: string
  sourceFileName?: string
  sourceFingerprint?: FileFingerprint
  contentHash?: string
  pipelineVersion?: number
  artifactManifestPath?: string | null
  completedStages?: string[]
}

export interface IngestCacheHit {
  filesWritten: string[]
  entry: IngestCacheEntry
}

interface CacheData {
  entries: Record<string, IngestCacheEntry> // keyed by sourceKey, legacy caches by source filename
}

const CURRENT_INGEST_PIPELINE_VERSION = 3

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isFileFingerprint(value: unknown): value is FileFingerprint {
  if (!isObject(value)) return false
  return (
    typeof value.sourcePath === "string" &&
    typeof value.sourceKey === "string" &&
    typeof value.sizeBytes === "number" &&
    typeof value.modifiedMs === "number" &&
    typeof value.generatedAt === "string"
  )
}

function isCacheEntry(value: unknown): value is IngestCacheEntry {
  if (!isObject(value)) return false
  return (
    typeof value.hash === "string" &&
    typeof value.timestamp === "number" &&
    Array.isArray(value.filesWritten) &&
    value.filesWritten.every((filePath) => typeof filePath === "string") &&
    (value.sourceFingerprint === undefined || isFileFingerprint(value.sourceFingerprint)) &&
    (value.completedStages === undefined ||
      (Array.isArray(value.completedStages) && value.completedStages.every((stage) => typeof stage === "string")))
  )
}

function normalizeCacheData(parsed: unknown): CacheData {
  if (!isObject(parsed)) return { entries: {} }

  if (isObject(parsed.entries)) {
    const entries: Record<string, IngestCacheEntry> = {}
    for (const [sourceFileName, entry] of Object.entries(parsed.entries)) {
      if (isCacheEntry(entry)) entries[sourceFileName] = entry
    }
    return { entries }
  }

  // Backward compatibility for legacy cache files that were written as a
  // direct source-file map instead of { entries }. Empty objects safely land
  // here as an empty cache, which is important for first-run project shells.
  const legacyEntries: Record<string, IngestCacheEntry> = {}
  for (const [sourceFileName, entry] of Object.entries(parsed)) {
    if (isCacheEntry(entry)) legacyEntries[sourceFileName] = entry
  }
  return { entries: legacyEntries }
}

async function sha256(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

function cachePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.llm-wiki/ingest-cache.json`
}

function sourceKindForName(sourceFileName: string): string {
  return sourceFileName.split(".").pop()?.toLowerCase() ?? ""
}

function needsPipelineVersionCheck(sourceFileName: string): boolean {
  return ["xlsx", "xls", "ods"].includes(sourceKindForName(sourceFileName))
}

async function loadCache(projectPath: string): Promise<CacheData> {
  try {
    const raw = await readFile(cachePath(projectPath))
    return normalizeCacheData(JSON.parse(raw))
  } catch {
    return { entries: {} }
  }
}

async function saveCache(projectPath: string, cache: CacheData): Promise<void> {
  try {
    await writeFile(cachePath(projectPath), JSON.stringify(cache, null, 2))
  } catch {
    // non-critical
  }
}

/**
 * Check if a source file has already been ingested with the same content.
 * Returns the list of previously written files if cached, or null if ingest
 * is needed.
 *
 * IMPORTANT: a cache hit is only returned if every previously-written file
 * still exists on disk. Otherwise we treat the cache as stale and fall
 * through to a full re-ingest. Historically we returned the cached list
 * blindly, which surfaced ghost entries in the activity panel — clicking
 * them gave the preview panel a missing file, and the auto-save path then
 * materialized a `[Binary file: ...]` stub at the now-empty location.
 */
export async function checkIngestCacheDetailed(
  projectPath: string,
  sourceFileName: string,
  sourceContent: string,
  options: {
    sourceKey?: string
    sourceFingerprint?: FileFingerprint | null
  } = {},
): Promise<IngestCacheHit | null> {
  const cache = await loadCache(projectPath)
  const entry = (options.sourceKey ? cache.entries[options.sourceKey] : null)
    ?? cache.entries[sourceFileName]
  if (!entry) return null
  if (
    needsPipelineVersionCheck(sourceFileName) &&
    (entry.pipelineVersion ?? 1) < CURRENT_INGEST_PIPELINE_VERSION
  ) {
    return null
  }

  if (options.sourceFingerprint && entry.sourceFingerprint) {
    const sameFingerprint =
      entry.sourceFingerprint.sourceKey === options.sourceFingerprint.sourceKey &&
      entry.sourceFingerprint.sizeBytes === options.sourceFingerprint.sizeBytes &&
      entry.sourceFingerprint.modifiedMs === options.sourceFingerprint.modifiedMs &&
      (entry.sourceFingerprint.sha256 === undefined ||
        options.sourceFingerprint.sha256 === undefined ||
        entry.sourceFingerprint.sha256 === options.sourceFingerprint.sha256)
    if (!sameFingerprint) return null
  } else {
    const currentHash = await sha256(sourceContent)
    if (entry.hash !== currentHash) return null
  }

  const pp = normalizePath(projectPath)
  for (const filePath of entry.filesWritten) {
    const fullPath = isAbsolutePath(filePath)
      ? normalizePath(filePath)
      : `${pp}/${filePath}`
    try {
      if (!(await fileExists(fullPath))) {
        console.log(
          `[ingest-cache] cache miss for ${options.sourceKey ?? sourceFileName}: ${filePath} no longer on disk`,
        )
        return null
      }
    } catch {
      // If the existence check itself fails, fall back to re-ingest —
      // safer than trusting a stale cache entry.
      return null
    }
  }

  return {
    filesWritten: entry.filesWritten,
    entry,
  }
}

export async function checkIngestCache(
  projectPath: string,
  sourceFileName: string,
  sourceContent: string,
  options: {
    sourceKey?: string
    sourceFingerprint?: FileFingerprint | null
  } = {},
): Promise<string[] | null> {
  const hit = await checkIngestCacheDetailed(projectPath, sourceFileName, sourceContent, options)
  return hit?.filesWritten ?? null
}

/**
 * Save ingest result to cache after successful ingest.
 */
export async function saveIngestCache(
  projectPath: string,
  sourceFileName: string,
  sourceContent: string,
  filesWritten: string[],
  options: {
    sourceKey?: string
    sourceFingerprint?: FileFingerprint | null
    artifactManifestPath?: string | null
    completedStages?: string[]
  } = {},
): Promise<void> {
  const cache = await loadCache(projectPath)
  const hash = await sha256(sourceContent)
  const newEntries = { ...cache.entries }
  const sourceKey = options.sourceKey ?? sourceFileName
  newEntries[sourceKey] = {
    hash,
    contentHash: hash,
    sourceKey,
    sourceFileName,
    sourceFingerprint: options.sourceFingerprint ?? undefined,
    pipelineVersion: CURRENT_INGEST_PIPELINE_VERSION,
    artifactManifestPath: options.artifactManifestPath ?? undefined,
    completedStages: options.completedStages ?? ["core"],
    timestamp: Date.now(),
    filesWritten,
  }
  await saveCache(projectPath, { entries: newEntries })
}

/**
 * Remove a source file entry from cache (e.g., when source is deleted).
 */
export async function removeFromIngestCache(
  projectPath: string,
  sourceFileName: string,
): Promise<void> {
  const cache = await loadCache(projectPath)
  const newEntries = { ...cache.entries }
  delete newEntries[sourceFileName]
  for (const [key, entry] of Object.entries(newEntries)) {
    if (
      entry.sourceFileName === sourceFileName ||
      entry.sourceKey === sourceFileName ||
      key.endsWith(`/${sourceFileName}`)
    ) {
      delete newEntries[key]
    }
  }
  await saveCache(projectPath, { entries: newEntries })
}
