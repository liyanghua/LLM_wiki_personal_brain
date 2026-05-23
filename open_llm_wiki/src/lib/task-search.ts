import {
  isSearchableTaskIndexEntry,
  loadTaskIndex,
  type TaskIndexEntry,
  type TaskQualityBand,
} from "@/lib/task-index"

export interface TaskSearchFilters {
  role?: string
  startDate?: string
  endDate?: string
  cadence?: string
  status?: TaskIndexEntry["status"]
  minQualityScore?: number
  priority?: TaskIndexEntry["priority"]
  taskModule?: TaskIndexEntry["taskModule"]
  productId?: string
  taskStatus?: TaskIndexEntry["taskStatus"]
  sourceDocType?: TaskIndexEntry["sourceDocType"]
  includeNeedsReview?: boolean
  includeContextSources?: boolean
  limit?: number
}

export interface TaskSearchResult {
  entry: TaskIndexEntry
  matchScore: number
  rankScore: number
  matchedReasons: string[]
  qualityBand: TaskQualityBand
}

export interface GroupedTaskSearchResults {
  ready: {
    count: number
    tasks: TaskSearchResult[]
    missingElements: string[]
    averageQualityScore: number
    averageExecutableScore: number
  }
  needsReview: {
    count: number
    tasks: TaskSearchResult[]
    missingElements: string[]
    averageQualityScore: number
    averageExecutableScore: number
  }
  ordered: TaskSearchResult[]
}

const MONTH_ALIASES: Record<string, string> = {
  "1月": "01",
  "2月": "02",
  "3月": "03",
  "4月": "04",
  "5月": "05",
  "6月": "06",
  "7月": "07",
  "8月": "08",
  "9月": "09",
  "10月": "10",
  "11月": "11",
  "12月": "12",
}

export function hasTaskListIntent(query: string): boolean {
  return /(任务|任务卡|行动项|待办|计划|owner|负责人|角色).*(列表|有哪些|查询|查找|给我|展示|汇总)|任务列表|行动项/i.test(query)
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "")
}

function tokenize(value: string): string[] {
  return Array.from(new Set(
    value
      .toLowerCase()
      .split(/[^0-9a-zA-Z\u4e00-\u9fff]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2),
  ))
}

function monthFromQuery(query: string): string | null {
  for (const [label, month] of Object.entries(MONTH_ALIASES)) {
    if (query.includes(label)) return month
  }
  const numeric = query.match(/(?:^|[^0-9])(\d{1,2})\s*(?:月份|月)/)
  if (!numeric) return null
  return numeric[1].padStart(2, "0")
}

function timeMatches(entry: TaskIndexEntry, filters: TaskSearchFilters, query: string): { ok: boolean; reason: string | null; score: number } {
  const label = entry.timeRange.label || ""
  const start = entry.timeRange.start ?? ""
  const end = entry.timeRange.end ?? ""
  const month = monthFromQuery(query)
  if (filters.startDate || filters.endDate) {
    const filterStart = filters.startDate ?? filters.endDate ?? ""
    const filterEnd = filters.endDate ?? filters.startDate ?? ""
    if (start && end && filterStart && filterEnd) {
      const overlaps = start <= filterEnd && end >= filterStart
      return {
        ok: overlaps,
        reason: overlaps ? `时间匹配：${label}` : null,
        score: overlaps ? 35 : 0,
      }
    }
    if (label && filterStart.slice(0, 7) && label.includes(filterStart.slice(0, 7))) {
      return { ok: true, reason: `时间匹配：${label}`, score: 25 }
    }
    return { ok: false, reason: null, score: 0 }
  }
  if (month && (label.includes(`${Number(month)}月`) || label.includes(`-${month}`) || start.includes(`-${month}-`) || end.includes(`-${month}-`))) {
    return { ok: true, reason: `时间匹配：${label}`, score: 25 }
  }
  return { ok: true, reason: null, score: 0 }
}

function textScore(entry: TaskIndexEntry, query: string): { score: number; reasons: string[] } {
  const haystack = normalizeText([
    entry.title,
    entry.ownerRole,
    entry.normalizedOwnerRole,
    entry.collaboratorRoles.join(" "),
    entry.taskModule,
    entry.taskModuleLabel,
    entry.productId,
    entry.taskItem,
    entry.taskStatus,
    entry.resultFeedback.join(" "),
    entry.targetObject,
    entry.problemEvidence.join(" "),
    entry.actionSteps.join(" "),
    entry.acceptanceMetrics.join(" "),
    entry.sourceName,
  ].join(" "))
  let score = 0
  const reasons: string[] = []
  for (const token of tokenize(query)) {
    if (!haystack.includes(normalizeText(token))) continue
    score += 8
  }
  if (score > 0) reasons.push("内容命中任务标题/动作/指标")
  return { score: Math.min(score, 40), reasons }
}

function roleMatches(entry: TaskIndexEntry, role?: string): { ok: boolean; reason: string | null; score: number } {
  if (!role?.trim()) return { ok: true, reason: null, score: 0 }
  const needle = normalizeText(role)
  const candidates = [
    entry.ownerRole,
    entry.normalizedOwnerRole,
    ...entry.collaboratorRoles,
  ].map(normalizeText).filter(Boolean)
  const ok = candidates.some((item) => item.includes(needle) || needle.includes(item))
  return {
    ok,
    reason: ok ? `角色匹配：${role}` : null,
    score: ok ? 45 : 0,
  }
}

function priorityBoost(priority: TaskIndexEntry["priority"]): number {
  switch (priority) {
    case "critical":
      return 12
    case "high":
      return 9
    case "medium":
      return 5
    case "low":
      return 1
    default:
      return 3
  }
}

function averageScore(tasks: TaskSearchResult[], selector: (entry: TaskIndexEntry) => number): number {
  if (tasks.length === 0) return 0
  return Math.round(tasks.reduce((sum, hit) => sum + selector(hit.entry), 0) / tasks.length)
}

function countMissingElements(tasks: TaskSearchResult[]): string[] {
  const counts = new Map<string, number>()
  for (const hit of tasks) {
    for (const item of hit.entry.missingElements ?? []) {
      if (!item) continue
      counts.set(item, (counts.get(item) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key)
}

export function groupTaskSearchResults(results: TaskSearchResult[]): GroupedTaskSearchResults {
  const ready = results
    .filter((hit) => hit.qualityBand === "ready")
    .sort((a, b) => b.rankScore - a.rankScore || b.entry.qualityScore - a.entry.qualityScore || a.entry.title.localeCompare(b.entry.title))
  const needsReview = results
    .filter((hit) => hit.qualityBand !== "ready")
    .sort((a, b) => b.rankScore - a.rankScore || b.entry.qualityScore - a.entry.qualityScore || a.entry.title.localeCompare(b.entry.title))
  return {
    ready: {
      count: ready.length,
      tasks: ready,
      missingElements: countMissingElements(ready),
      averageQualityScore: averageScore(ready, (entry) => entry.qualityScore),
      averageExecutableScore: averageScore(ready, (entry) => entry.executableScore),
    },
    needsReview: {
      count: needsReview.length,
      tasks: needsReview,
      missingElements: countMissingElements(needsReview),
      averageQualityScore: averageScore(needsReview, (entry) => entry.qualityScore),
      averageExecutableScore: averageScore(needsReview, (entry) => entry.executableScore),
    },
    ordered: [...ready, ...needsReview],
  }
}

function rank(entry: TaskIndexEntry, matchScore: number): number {
  const quality = entry.qualityScore * 0.25
  const executable = entry.executableScore * 0.2
  const importance = entry.importanceScore * 0.2
  const readyBoost = entry.qualityBand === "ready" ? 18 : 0
  const moduleBoost = entry.taskModule !== "unknown" ? 8 : 0
  return Math.round(matchScore + quality + executable + importance + priorityBoost(entry.priority) + readyBoost + moduleBoost)
}

export async function searchTaskCards(
  projectPath: string,
  query: string,
  filters: TaskSearchFilters = {},
): Promise<TaskSearchResult[]> {
  const index = await loadTaskIndex(projectPath)
  const includeNeedsReview = filters.includeNeedsReview ?? true
  const results: TaskSearchResult[] = []
  for (const entry of index.entries) {
    if (!isSearchableTaskIndexEntry(entry, filters.includeContextSources)) continue
    if (!includeNeedsReview && entry.qualityBand === "needs_review") continue
    if (filters.status && entry.status !== filters.status) continue
    if (filters.cadence && entry.cadence !== filters.cadence) continue
    if (filters.priority && entry.priority !== filters.priority) continue
    if (filters.taskModule && entry.taskModule !== filters.taskModule) continue
    if (filters.productId && !entry.productId.includes(filters.productId)) continue
    if (filters.taskStatus && entry.taskStatus !== filters.taskStatus) continue
    if (filters.sourceDocType && entry.sourceDocType !== filters.sourceDocType) continue
    if (filters.minQualityScore !== undefined && entry.qualityScore < filters.minQualityScore) continue

    const role = roleMatches(entry, filters.role)
    if (!role.ok) continue
    const time = timeMatches(entry, filters, query)
    if (!time.ok) continue
    const text = textScore(entry, query)
    const matchScore = role.score + time.score + text.score
    const matchedReasons = [role.reason, time.reason, ...text.reasons].filter((item): item is string => Boolean(item))
    if (matchScore <= 0 && (filters.role || filters.startDate || filters.endDate)) {
      matchedReasons.push("过滤条件命中")
    }
    results.push({
      entry,
      matchScore,
      rankScore: rank(entry, matchScore),
      matchedReasons,
      qualityBand: entry.qualityBand,
    })
  }
  return results
    .sort((a, b) => b.rankScore - a.rankScore || b.entry.qualityScore - a.entry.qualityScore || a.entry.title.localeCompare(b.entry.title))
    .slice(0, filters.limit ?? 12)
}

export function formatTaskCardsForPrompt(hits: TaskSearchResult[]): string {
  if (hits.length === 0) return ""
  const grouped = groupTaskSearchResults(hits)
  const renderGroup = (
    title: string,
    summary: { count: number; tasks: TaskSearchResult[]; missingElements: string[]; averageQualityScore: number; averageExecutableScore: number },
  ): string => {
    if (summary.count === 0) return ""
    return [
      `### ${title}`,
      `- 数量：${summary.count}`,
      `- 平均质量分：${summary.averageQualityScore}/100`,
      `- 平均可执行度：${summary.averageExecutableScore}/100`,
      `- 共同缺失：${summary.missingElements.slice(0, 5).join("、") || "无"}`,
      "",
      ...summary.tasks.map((hit, index) => {
        const task = hit.entry
        return [
          `#### [T${index + 1}] ${task.title}`,
          `- taskId: ${task.taskId}`,
          `- module: ${task.taskModuleLabel} (${task.taskModule})`,
          `- productId: ${task.productId || "n/a"}`,
          `- taskItem: ${task.taskItem || task.title}`,
          `- taskStatus: ${task.taskStatus}`,
          `- owner: ${task.ownerRole || "待确认"}`,
          `- time: ${task.timeRange.label}`,
          `- priority: ${task.priority}`,
          `- quality: ${task.qualityScore}/100; executable: ${task.executableScore}/100; importance: ${task.importanceScore}/100; status: ${task.status}`,
          `- action: ${task.actionSteps.join("；") || "待补充"}`,
          `- metrics: ${task.acceptanceMetrics.join("；") || "待补充"}`,
          `- feedback: ${task.resultFeedback.join("；") || "暂无"}`,
          `- missing: ${task.missingElements.join("、") || "无"}`,
          `- review: ${(task.reviewNotes ?? []).join("；") || "暂无"}`,
          `- source: ${task.wikiRefs.join(", ")}`,
          `- matched: ${hit.matchedReasons.join("；") || "任务索引召回"}`,
          "",
        ].join("\n")
      }),
    ].join("\n")
  }

  return [
    renderGroup("可候选执行", grouped.ready),
    renderGroup("需补齐", grouped.needsReview),
  ].filter(Boolean).join("\n\n")
}
