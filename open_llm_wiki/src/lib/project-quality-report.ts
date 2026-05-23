import { createDirectory, fileExists, listDirectory, readFile, writeFile } from "@/commands/fs"
import { loadAgentModeReports } from "@/lib/agent-mode-persist"
import { normalizePath } from "@/lib/path-utils"
import type { AgentModeReport, TaskContextPack } from "@/lib/agent-mode-types"
import type { TaskIndex, TaskIndexEntry } from "@/lib/task-index"
import type { SemanticUnitIndex } from "@/lib/semantic-units"

export interface ProjectQualityDocumentReport {
  sourceName: string
  sourcePath: string
  status: "compiled" | "pending" | "failed" | "unknown"
  qualityScore: number
  taskCount: number
  readyTaskCount: number
  needsReviewTaskCount: number
  averageTaskQualityScore: number
  topMissingElements: string[]
}

export interface ProjectQualityReport {
  generatedAt: string
  sourceCount: number
  compiledSourceCount: number
  pendingSourceCount: number
  failedSourceCount: number
  averageDocumentQualityScore: number
  taskSummary: {
    total: number
    ready: number
    needsReview: number
    averageQualityScore: number
    averageExecutableScore: number
    topMissingElements: string[]
  }
  documents: ProjectQualityDocumentReport[]
  semanticSummary?: {
    units: number
    relations: number
    conflicts: number
  }
}

interface CacheData {
  entries?: Record<string, {
    filesWritten?: string[]
    completedStages?: string[]
    sourceFileName?: string
    sourceKey?: string
  }>
}

interface IngestQueueTaskSnapshot {
  sourcePath?: string
  status?: string
}

interface CacheStats {
  sourceKeys: string[]
  compiledCount: number
}

interface QueueStats {
  sourceKeys: string[]
  pendingCount: number
  failedCount: number
}

function roundScore(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function topMissingElements(entries: TaskIndexEntry[], limit = 8): string[] {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    for (const element of entry.missingElements ?? []) {
      if (!element) continue
      counts.set(element, (counts.get(element) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([element]) => element)
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path)) as T
  } catch {
    return null
  }
}

export async function loadProjectQualityReport(projectPath: string): Promise<ProjectQualityReport | null> {
  const pp = normalizePath(projectPath)
  const path = `${pp}/.llm-wiki/quality-report.json`
  if (!(await fileExists(path).catch(() => false))) return null
  const parsed = await readJson<ProjectQualityReport>(path)
  if (!parsed || typeof parsed !== "object") return null
  if (!parsed.taskSummary || !Array.isArray(parsed.documents)) return null
  return parsed
}

async function loadTaskIndexIfPresent(projectPath: string): Promise<TaskIndex | null> {
  const path = `${projectPath}/.llm-wiki/task-index.json`
  if (!(await fileExists(path).catch(() => false))) return null
  const parsed = await readJson<TaskIndex>(path)
  return parsed?.schemaVersion === "task_index_v1" && Array.isArray(parsed.entries)
    ? parsed
    : null
}

async function loadTaskPacksIfPresent(projectPath: string): Promise<TaskContextPack[]> {
  const packDir = `${projectPath}/.llm-wiki/task-context-packs`
  let nodes
  try {
    nodes = await listDirectory(packDir)
  } catch {
    return []
  }
  const packs: TaskContextPack[] = []
  for (const node of nodes) {
    if (node.is_dir || !node.name.endsWith(".json")) continue
    const parsed = await readJson<TaskContextPack>(node.path)
    if (parsed?.schemaVersion === "task_context_pack_v1") packs.push(parsed)
  }
  return packs
}

async function loadSemanticSummary(projectPath: string): Promise<ProjectQualityReport["semanticSummary"]> {
  const path = `${projectPath}/.llm-wiki/semantic-units/index.json`
  if (!(await fileExists(path).catch(() => false))) return undefined
  const parsed = await readJson<Partial<SemanticUnitIndex>>(path)
  if (!parsed) return undefined
  return {
    units: Array.isArray(parsed.units) ? parsed.units.length : 0,
    relations: Array.isArray(parsed.relations) ? parsed.relations.length : 0,
    conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts.length : 0,
  }
}

async function loadCacheStats(projectPath: string): Promise<CacheStats> {
  const parsed = await readJson<CacheData>(`${projectPath}/.llm-wiki/ingest-cache.json`)
  const entries = parsed?.entries ?? {}
  return {
    sourceKeys: Object.keys(entries),
    compiledCount: Object.values(entries).filter((entry) =>
      (entry.completedStages ?? []).includes("core") || (entry.filesWritten ?? []).length > 0,
    ).length,
  }
}

async function loadQueueStats(projectPath: string): Promise<QueueStats> {
  const parsed = await readJson<IngestQueueTaskSnapshot[]>(`${projectPath}/.llm-wiki/ingest-queue.json`)
  const tasks = Array.isArray(parsed) ? parsed : []
  return {
    sourceKeys: tasks.map((task) => task.sourcePath ?? "").filter(Boolean),
    pendingCount: tasks.filter((task) => task.status === "pending" || task.status === "processing").length,
    failedCount: tasks.filter((task) => task.status === "failed").length,
  }
}

function canonicalSourcePath(value: string | undefined): string {
  const normalized = normalizePath(value ?? "").trim().replace(/\/+/g, "/")
  if (!normalized) return ""
  const rawMarker = "/raw/sources/"
  const markerIndex = normalized.indexOf(rawMarker)
  return markerIndex >= 0 ? normalized.slice(markerIndex + 1) : normalized
}

function canonicalSourceName(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase()
}

function canonicalSourceId(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/-(artifact|[a-z0-9]{6})$/i, "")
    .toLowerCase()
}

function sourceIdentityKey(sourcePath: string | undefined, sourceName: string | undefined, fallbackId?: string): string {
  const path = canonicalSourcePath(sourcePath)
  if (path) return `path:${path}`
  const name = canonicalSourceName(sourceName)
  if (name) return `name:${name}`
  const id = canonicalSourceId(fallbackId)
  return id ? `id:${id}` : ""
}

function sourceAliasKeys(sourcePath: string | undefined, sourceName: string | undefined, fallbackId?: string): string[] {
  return Array.from(new Set([
    canonicalSourcePath(sourcePath) ? `path:${canonicalSourcePath(sourcePath)}` : "",
    canonicalSourceName(sourceName) ? `name:${canonicalSourceName(sourceName)}` : "",
    canonicalSourceId(fallbackId) ? `id:${canonicalSourceId(fallbackId)}` : "",
  ].filter(Boolean)))
}

function hasEvidenceAnchors(pack: TaskContextPack): boolean {
  return (pack.evidenceAnchors ?? []).length > 0
}

function hasRuleAssets(pack: TaskContextPack): boolean {
  return Boolean(pack.taskRulePack || pack.taskTaxonomy)
}

function hasRoleContext(pack: TaskContextPack): boolean {
  return Boolean(pack.roleContextIndex || (pack.roleProfiles ?? []).length > 0)
}

function taskEntriesForPack(pack: TaskContextPack, taskEntries: TaskIndexEntry[]): TaskIndexEntry[] {
  return taskEntries.filter((entry) => {
    const entrySourcePath = (entry as TaskIndexEntry & { sourcePath?: string }).sourcePath ?? ""
    return (
      entry.sourceDocId === pack.sourceDocId
      || entry.sourceName === pack.sourceName
      || Boolean(entrySourcePath && entrySourcePath === pack.sourcePath)
    )
  })
}

function scoreTaskContextPackContribution(pack: TaskContextPack, taskEntries: TaskIndexEntry[]): number {
  const entries = taskEntriesForPack(pack, taskEntries)
  const taskCandidateCount = pack.taskCandidates?.length ?? 0
  const sourcePolicy = pack.sourcePolicy
  let score = 35

  if (sourcePolicy) score += 10
  if (hasEvidenceAnchors(pack)) score += 15

  switch (pack.docRole) {
    case "task_mechanism_source":
      if (sourcePolicy?.canGenerateTaskCards === false) score += 20
      if (hasRuleAssets(pack)) score += 25
      if (entries.length === 0 && taskCandidateCount === 0) score += 10
      if (entries.length > 0 || taskCandidateCount > 0) score -= 35
      break
    case "role_kpi_source":
      if (sourcePolicy?.canGenerateTaskCards === false) score += 20
      if (hasRoleContext(pack)) score += 25
      if (entries.length === 0 && taskCandidateCount === 0) score += 10
      if (entries.length > 0 || taskCandidateCount > 0) score -= 35
      break
    case "meeting_task_source":
      if (sourcePolicy?.canGenerateTaskCards !== false) score += 15
      if (taskCandidateCount > 0) score += 20
      if (entries.length > 0) score += 15
      if (taskCandidateCount === 0 && entries.length === 0) score -= 25
      break
    case "mixed_task_source":
      if (sourcePolicy?.canGenerateTaskCards !== false) score += 12
      if (taskCandidateCount > 0 || entries.length > 0) score += 18
      if (hasRuleAssets(pack) || hasRoleContext(pack)) score += 12
      if (hasRuleAssets(pack) && entries.length === 0 && sourcePolicy?.defaultIndexVisibility === "context_only") score += 8
      break
    default: {
      const fieldSignals = [
        (pack.operatingGoals ?? []).length > 0,
        (pack.roleProfiles ?? []).length > 0,
        (pack.metricRules ?? []).length > 0,
        (pack.taskTriggers ?? []).length > 0,
        taskCandidateCount > 0,
      ].filter(Boolean).length
      score += Math.min(25, fieldSignals * 5)
      if (taskCandidateCount === 0 && entries.length === 0 && fieldSignals === 0) score -= 20
      break
    }
  }

  return clampScore(score)
}

interface DocumentAccumulator extends ProjectQualityDocumentReport {
  taskEntries: TaskIndexEntry[]
}

function buildDocumentReports(
  reports: AgentModeReport[],
  taskEntries: TaskIndexEntry[],
  taskPacks: TaskContextPack[],
): ProjectQualityDocumentReport[] {
  const bySource = new Map<string, DocumentAccumulator>()
  const aliasToSource = new Map<string, string>()

  const registerAliases = (primaryKey: string, aliases: string[]): void => {
    if (!primaryKey) return
    for (const alias of aliases) {
      if (!alias || aliasToSource.has(alias)) continue
      aliasToSource.set(alias, primaryKey)
    }
  }

  const resolveSourceKey = (sourcePath: string | undefined, sourceName: string | undefined, fallbackId?: string): string => {
    const pathAlias = canonicalSourcePath(sourcePath) ? `path:${canonicalSourcePath(sourcePath)}` : ""
    if (pathAlias) return aliasToSource.get(pathAlias) ?? pathAlias
    const aliases = sourceAliasKeys(sourcePath, sourceName, fallbackId)
    const resolved = aliases.map((alias) => aliasToSource.get(alias)).find(Boolean)
    if (resolved) return resolved
    return sourceIdentityKey(sourcePath, sourceName, fallbackId) || fallbackId || sourceName || sourcePath || "unknown"
  }

  const upsertSource = (params: {
    sourcePath?: string
    sourceName?: string
    fallbackId?: string
    status?: ProjectQualityDocumentReport["status"]
    qualityScore?: number
  }): DocumentAccumulator => {
    const key = resolveSourceKey(params.sourcePath, params.sourceName, params.fallbackId)
    const aliases = sourceAliasKeys(params.sourcePath, params.sourceName, params.fallbackId)
    registerAliases(key, [key, ...aliases])
    const existing = bySource.get(key)
    if (existing) {
      existing.sourceName = existing.sourceName || params.sourceName || params.fallbackId || key
      existing.sourcePath = existing.sourcePath || params.sourcePath || ""
      existing.status = existing.status === "compiled" ? "compiled" : (params.status ?? existing.status)
      existing.qualityScore = Math.max(existing.qualityScore, params.qualityScore ?? 0)
      return existing
    }
    const created: DocumentAccumulator = {
      sourceName: params.sourceName || params.fallbackId || key,
      sourcePath: params.sourcePath || "",
      status: params.status ?? "compiled",
      qualityScore: params.qualityScore ?? 0,
      taskCount: 0,
      readyTaskCount: 0,
      needsReviewTaskCount: 0,
      averageTaskQualityScore: 0,
      topMissingElements: [],
      taskEntries: [],
    }
    bySource.set(key, created)
    return created
  }

  for (const report of reports) {
    upsertSource({
      sourceName: report.sourceName || report.docId,
      sourcePath: report.sourcePath || "",
      fallbackId: report.docId,
      status: "compiled",
      qualityScore: roundScore(report.qualityScore ?? report.sourceHealth?.score ?? 0),
    })
  }

  for (const pack of taskPacks) {
    upsertSource({
      sourceName: pack.sourceName,
      sourcePath: pack.sourcePath,
      fallbackId: pack.sourceDocId,
      status: "compiled",
      qualityScore: scoreTaskContextPackContribution(pack, taskEntries),
    })
  }

  for (const entry of taskEntries) {
    const sourcePath = (entry as TaskIndexEntry & { sourcePath?: string }).sourcePath
    const doc = upsertSource({
      sourceName: entry.sourceName,
      sourcePath,
      fallbackId: entry.sourceDocId,
      status: "compiled",
    })
    doc.taskEntries.push(entry)
  }

  for (const doc of bySource.values()) {
    if (doc.taskEntries.length === 0) continue
    const ready = doc.taskEntries.filter((entry) => entry.qualityBand === "ready").length
    const averageTaskQualityScore = roundScore(
      doc.taskEntries.reduce((sum, entry) => sum + (entry.qualityScore ?? 0), 0) / doc.taskEntries.length,
    )
    doc.taskCount = doc.taskEntries.length
    doc.readyTaskCount = ready
    doc.needsReviewTaskCount = doc.taskEntries.length - ready
    doc.averageTaskQualityScore = averageTaskQualityScore
    doc.topMissingElements = topMissingElements(doc.taskEntries)
    if (doc.qualityScore === 0) doc.qualityScore = averageTaskQualityScore
  }

  return Array.from(bySource.values()).map(({ taskEntries: _taskEntries, ...doc }) => doc).sort((a, b) => {
    if (a.status !== b.status) return a.status === "compiled" ? -1 : 1
    return a.sourceName.localeCompare(b.sourceName)
  })
}

export async function buildProjectQualityReport(projectPath: string): Promise<ProjectQualityReport> {
  const pp = normalizePath(projectPath)
  const [reports, taskIndex, taskPacks, semanticSummary, cacheStats, queueStats] = await Promise.all([
    loadAgentModeReports(pp).catch(() => []),
    loadTaskIndexIfPresent(pp),
    loadTaskPacksIfPresent(pp),
    loadSemanticSummary(pp),
    loadCacheStats(pp),
    loadQueueStats(pp),
  ])
  const taskEntries = taskIndex?.entries ?? []
  const documents = buildDocumentReports(reports, taskEntries, taskPacks)
  const compiledSourceCount = Math.max(
    documents.filter((doc) => doc.status === "compiled").length,
    cacheStats.compiledCount,
  )
  const sourceKeys = new Set<string>([
    ...cacheStats.sourceKeys,
    ...queueStats.sourceKeys,
    ...documents.map((doc) => doc.sourcePath || doc.sourceName),
  ].filter(Boolean))
  const sourceCount = sourceKeys.size
  const averageDocumentQualityScore = documents.length
    ? roundScore(documents.reduce((sum, doc) => sum + doc.qualityScore, 0) / documents.length)
    : 0
  const taskReady = taskEntries.filter((entry) => entry.qualityBand === "ready").length
  const taskTotal = taskEntries.length
  const averageQualityScore = taskTotal
    ? roundScore(taskEntries.reduce((sum, entry) => sum + (entry.qualityScore ?? 0), 0) / taskTotal)
    : 0
  const averageExecutableScore = taskTotal
    ? roundScore(taskEntries.reduce((sum, entry) => sum + (entry.executableScore ?? 0), 0) / taskTotal)
    : 0

  return {
    generatedAt: new Date().toISOString(),
    sourceCount,
    compiledSourceCount,
    pendingSourceCount: queueStats.pendingCount || Math.max(0, sourceCount - compiledSourceCount - queueStats.failedCount),
    failedSourceCount: queueStats.failedCount,
    averageDocumentQualityScore,
    taskSummary: {
      total: taskTotal,
      ready: taskReady,
      needsReview: taskTotal - taskReady,
      averageQualityScore,
      averageExecutableScore,
      topMissingElements: topMissingElements(taskEntries),
    },
    documents,
    semanticSummary,
  }
}

export function renderProjectQualityReportMarkdown(report: ProjectQualityReport): string {
  const lowScoreDocuments = report.documents
    .filter((doc) => doc.averageTaskQualityScore > 0 && doc.averageTaskQualityScore < 70)
    .slice(0, 10)
  const renderDoc = (doc: ProjectQualityDocumentReport): string =>
    [
      `### ${doc.sourceName}`,
      `- 状态：${doc.status}`,
      `- 文档作用识别分：${doc.qualityScore}/100`,
      `- 任务卡：${doc.taskCount} 张；可候选执行 ${doc.readyTaskCount} 张；需 Review ${doc.needsReviewTaskCount} 张`,
      `- 平均任务质量分：${doc.averageTaskQualityScore}/100`,
      `- 主要缺口：${doc.topMissingElements.join("、") || "暂无"}`,
      doc.sourcePath ? `- 来源路径：${doc.sourcePath}` : "",
      "",
    ].filter(Boolean).join("\n")

  return [
    "---",
    "type: project_quality_report",
    "title: \"项目质量罗盘\"",
    `updated_at: "${report.generatedAt}"`,
    "---",
    "",
    "# 项目质量罗盘",
    "",
    "本页由 `.llm-wiki/quality-report.json` 投影生成，用于观察文档编译质量、任务卡质量分和缺失要素分布。它不替代人工 Review，也不直接写入 GroundTruth / Skill。",
    "",
    "## 总览",
    "",
    `- 来源总数：${report.sourceCount}`,
    `- 已编译来源：${report.compiledSourceCount}`,
    `- 待处理来源：${report.pendingSourceCount}`,
    `- 失败来源：${report.failedSourceCount}`,
    `- 平均文档作用识别分：${report.averageDocumentQualityScore}/100`,
    "",
    "## 任务卡质量",
    "",
    `- 任务卡总数：${report.taskSummary.total}`,
    `- 可候选执行：${report.taskSummary.ready}`,
    `- 需 Review：${report.taskSummary.needsReview}`,
    `- 平均任务质量分：${report.taskSummary.averageQualityScore}/100`,
    `- 平均可执行度：${report.taskSummary.averageExecutableScore}/100`,
    `- Top 缺失要素：${report.taskSummary.topMissingElements.join("、") || "暂无"}`,
    report.taskSummary.total === 0 ? "- 暂无任务卡。请先完成经营任务场景编译。" : "",
    "",
    "## 语义关系",
    "",
    report.semanticSummary
      ? `- 语义单元：${report.semanticSummary.units}；关系：${report.semanticSummary.relations}；冲突：${report.semanticSummary.conflicts}`
      : "- 暂无语义单元索引。",
    "",
    "## 低分文档",
    "",
    ...(lowScoreDocuments.length
      ? lowScoreDocuments.map((doc) => `- ${doc.sourceName}：平均任务质量分 ${doc.averageTaskQualityScore}/100，主要缺口 ${doc.topMissingElements.join("、") || "暂无"}`)
      : ["- 暂无低分任务卡文档，或尚未生成任务卡。"]),
    "",
    "## 按文档分布",
    "",
    ...(report.documents.length ? report.documents.map(renderDoc) : ["- 暂无已编译文档。"]),
    "",
  ].join("\n")
}

export function formatProjectQualityTaskSummary(report: Pick<ProjectQualityReport, "taskSummary"> | null | undefined): string {
  if (!report) return "暂无任务卡质量报告"
  const { taskSummary } = report
  return [
    `ready ${taskSummary.ready}`,
    `needs_review ${taskSummary.needsReview}`,
    `平均质量 ${taskSummary.averageQualityScore}/100`,
    `平均可执行度 ${taskSummary.averageExecutableScore}/100`,
    `Top 缺失 ${taskSummary.topMissingElements.slice(0, 3).join("、") || "暂无"}`,
  ].join(" · ")
}

export async function writeProjectQualityReport(projectPath: string): Promise<ProjectQualityReport> {
  const pp = normalizePath(projectPath)
  const report = await buildProjectQualityReport(pp)
  await createDirectory(`${pp}/.llm-wiki`).catch(() => {})
  await createDirectory(`${pp}/wiki/quality`).catch(() => {})
  await writeFile(`${pp}/.llm-wiki/quality-report.json`, JSON.stringify(report, null, 2))
  await writeFile(`${pp}/wiki/quality/index.md`, renderProjectQualityReportMarkdown(report))
  return report
}
