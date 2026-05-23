import { createDirectory, listDirectory, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

export type IngestPhase =
  | "fingerprint"
  | "cacheCheck"
  | "prepareDocumentForIngest"
  | "imageExtract"
  | "imageCaption"
  | "analysisLlm"
  | "structuring"
  | "sceneCompile"
  | "strategyCompile"
  | "semanticIndex"
  | "taskIndex"
  | "embeddings"
  | "reviewSweep"
  | "deferredPostProcessing"

export interface IngestRunTiming {
  runId: string
  batchId?: string
  sourceKey: string
  phase: IngestPhase | string
  startedAt: string
  endedAt: string
  durationMs: number
  status: "done" | "error"
  error?: string
}

export interface IngestRunRecorder {
  runId: string
  timings: IngestRunTiming[]
  time<T>(phase: IngestPhase | string, work: () => Promise<T>): Promise<T>
  flushSummary(extra?: { title?: string; filesWritten?: string[]; warnings?: string[] }): Promise<void>
}

export interface IngestPhaseTimingSummary {
  phase: string
  label: string
  durationMs: number
  status: "done" | "error" | "skipped"
}

export interface IngestTimingSummary {
  batchId?: string
  runId?: string
  sourceCount: number
  totalDurationMs: number
  coreDurationMs: number
  enrichmentDurationMs: number
  latestEndedAt: string
  phases: IngestPhaseTimingSummary[]
}

function nowIso(): string {
  return new Date().toISOString()
}

function runIdFor(sourceKey: string): string {
  const safe = sourceKey
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "source"
  return `ingest-${Date.now()}-${safe}`
}

async function writeTimings(projectPath: string, runId: string, timings: IngestRunTiming[]): Promise<void> {
  const pp = normalizePath(projectPath)
  await createDirectory(`${pp}/.llm-wiki`).catch(() => {})
  await createDirectory(`${pp}/.llm-wiki/ingest-runs`).catch(() => {})
  const jsonl = timings.map((item) => JSON.stringify(item)).join("\n")
  await writeFile(`${pp}/.llm-wiki/ingest-runs/${runId}.jsonl`, jsonl ? `${jsonl}\n` : "")
}

export function createIngestRunRecorder(
  projectPath: string,
  context: { sourceKey: string; batchId?: string },
): IngestRunRecorder {
  const runId = runIdFor(context.sourceKey)
  const timings: IngestRunTiming[] = []
  return {
    runId,
    timings,
    async time<T>(phase: IngestPhase | string, work: () => Promise<T>): Promise<T> {
      const startedAt = nowIso()
      const startedMs = Date.now()
      try {
        const result = await work()
        timings.push({
          runId,
          batchId: context.batchId,
          sourceKey: context.sourceKey,
          phase,
          startedAt,
          endedAt: nowIso(),
          durationMs: Date.now() - startedMs,
          status: "done",
        })
        await writeTimings(projectPath, runId, timings).catch(() => {})
        return result
      } catch (err) {
        timings.push({
          runId,
          batchId: context.batchId,
          sourceKey: context.sourceKey,
          phase,
          startedAt,
          endedAt: nowIso(),
          durationMs: Date.now() - startedMs,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        })
        await writeTimings(projectPath, runId, timings).catch(() => {})
        throw err
      }
    },
    async flushSummary(extra = {}) {
      const pp = normalizePath(projectPath)
      const totalMs = timings.reduce((sum, item) => sum + item.durationMs, 0)
      const lines = [
        "# Ingest Run Summary",
        "",
        `- Run ID：${runId}`,
        `- Source：${context.sourceKey}`,
        context.batchId ? `- Batch：${context.batchId}` : null,
        `- Total measured time：${Math.round(totalMs / 1000)}s`,
        extra.filesWritten ? `- Files written：${extra.filesWritten.length}` : null,
        extra.warnings?.length ? `- Warnings：${extra.warnings.length}` : null,
        "",
        "## Phase Timings",
        "",
        "| Phase | Status | Duration |",
        "| --- | --- | ---: |",
        ...timings.map((item) => `| ${item.phase} | ${item.status} | ${item.durationMs}ms |`),
      ].filter((line): line is string => Boolean(line))
      await createDirectory(`${pp}/.llm-wiki/ingest-runs`).catch(() => {})
      await writeFile(`${pp}/.llm-wiki/ingest-runs/latest-summary.md`, lines.join("\n"))
    },
  }
}

export function formatIngestPhaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    fingerprint: "文件指纹",
    cacheCheck: "缓存检查",
    prepareDocumentForIngest: "文档预处理",
    spreadsheetPreprocessFallback: "表格兜底解析",
    imageExtract: "图片抽取",
    imageCaption: "图片理解",
    analysisLlm: "文档理解",
    structuring: "结构化抽取",
    sceneCompile: "Wiki/任务卡编译",
    strategyCompile: "策略编译",
    semanticIndex: "语义索引",
    taskIndex: "任务索引",
    qualityReport: "质量报告",
    embeddings: "向量索引",
    reviewSweep: "Review 刷新",
    deferredPostProcessing: "批量后处理",
    "deferredPostProcessing:loadReports": "读取编译报告",
  }
  return labels[phase] ?? phase
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s"
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const restSeconds = seconds % 60
  if (minutes < 60) return restSeconds > 0 ? `${minutes}m ${restSeconds}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`
}

function parseTimingLines(content: string): IngestRunTiming[] {
  const timings: IngestRunTiming[] = []
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as IngestRunTiming
      if (parsed && parsed.runId && parsed.phase && typeof parsed.durationMs === "number") {
        timings.push(parsed)
      }
    } catch {
      // Ignore corrupt timing lines; telemetry should never break UI.
    }
  }
  return timings
}

function isEnrichmentPhase(phase: string): boolean {
  return phase === "strategyCompile" || phase === "embeddings"
}

export async function loadLatestIngestTimingSummary(projectPath: string): Promise<IngestTimingSummary | null> {
  const pp = normalizePath(projectPath)
  const dir = `${pp}/.llm-wiki/ingest-runs`
  let nodes: Awaited<ReturnType<typeof listDirectory>>
  try {
    nodes = await listDirectory(dir)
  } catch {
    return null
  }

  const timingFiles = nodes
    .filter((node) => !node.is_dir && node.name.endsWith(".jsonl"))
    .map((node) => node.path)
  if (timingFiles.length === 0) return null

  const allTimings: IngestRunTiming[] = []
  for (const path of timingFiles) {
    try {
      allTimings.push(...parseTimingLines(await readFile(path)))
    } catch {
      // Ignore unreadable timing files.
    }
  }
  if (allTimings.length === 0) return null

  const groups = new Map<string, IngestRunTiming[]>()
  for (const item of allTimings) {
    const key = item.batchId ? `batch:${item.batchId}` : `run:${item.runId}`
    groups.set(key, [...(groups.get(key) ?? []), item])
  }

  let latestKey = ""
  let latestEndedAt = ""
  for (const [key, timings] of groups) {
    const endedAt = timings.reduce((latest, item) =>
      !latest || item.endedAt > latest ? item.endedAt : latest,
    "")
    if (!latestEndedAt || endedAt > latestEndedAt) {
      latestEndedAt = endedAt
      latestKey = key
    }
  }
  if (!latestKey) return null

  const latest = (groups.get(latestKey) ?? []).slice().sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const phaseOrder: string[] = []
  const phaseMap = new Map<string, IngestPhaseTimingSummary>()
  for (const item of latest) {
    if (!phaseMap.has(item.phase)) phaseOrder.push(item.phase)
    const current = phaseMap.get(item.phase)
    phaseMap.set(item.phase, {
      phase: item.phase,
      label: formatIngestPhaseLabel(item.phase),
      durationMs: (current?.durationMs ?? 0) + item.durationMs,
      status: current?.status === "error" || item.status === "error" ? "error" : "done",
    })
  }
  const phases = phaseOrder.map((phase) => phaseMap.get(phase)!).filter(Boolean)
  const totalDurationMs = latest.reduce((sum, item) => sum + item.durationMs, 0)
  const enrichmentDurationMs = latest
    .filter((item) => isEnrichmentPhase(item.phase))
    .reduce((sum, item) => sum + item.durationMs, 0)
  const sourceKeys = new Set(
    latest
      .map((item) => item.sourceKey)
      .filter((sourceKey) => sourceKey && sourceKey !== "batch-post-processing"),
  )

  return {
    batchId: latest[0]?.batchId,
    runId: latest[0]?.runId,
    sourceCount: sourceKeys.size,
    totalDurationMs,
    coreDurationMs: totalDurationMs - enrichmentDurationMs,
    enrichmentDurationMs,
    latestEndedAt,
    phases,
  }
}
