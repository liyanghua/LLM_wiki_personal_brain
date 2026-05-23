import { createDirectory, listDirectory, readFile, writeFile } from "@/commands/fs"
import type { BusinessTaskStatus, RoleContextIndex, TaskCardDraft, TaskContextPack, TaskModule, TaskRulePack } from "@/lib/agent-mode-types"
import { getFileStem, normalizePath } from "@/lib/path-utils"

export type TaskPriority = "critical" | "high" | "medium" | "low" | "unknown"
export type TaskQualityBand = "ready" | "needs_review"

export interface TaskTimeRange {
  label: string
  start?: string | null
  end?: string | null
}

export interface TaskIndexEntry {
  taskId: string
  title: string
  taskModule: TaskModule
  taskModuleLabel: string
  productId: string
  taskItem: string
  taskStatus: BusinessTaskStatus
  resultFeedback: string[]
  ownerRole: string
  normalizedOwnerRole: string
  collaboratorRoles: string[]
  timeRange: TaskTimeRange
  cadence: string
  priority: TaskPriority
  importanceScore: number
  executableScore: number
  qualityScore: number
  qualityBand: TaskQualityBand
  status: TaskCardDraft["status"]
  targetObject: string
  problemEvidence: string[]
  actionSteps: string[]
  acceptanceMetrics: string[]
  reviewRequirement: string
  missingElements: string[]
  sourceRefs: string[]
  wikiRefs: string[]
  sourceDocId: string
  sourceName: string
  sourceDocType: TaskContextPack["docRole"]
  generationSource: NonNullable<TaskCardDraft["generationSource"]>
  completionSources: string[]
  rulePackRefs: string[]
  roleContextRefs: string[]
  qualityDerived?: boolean
  reviewNotes?: string[]
}

export interface TaskIndexSummary {
  total: number
  ready: number
  needsReview: number
  averageQualityScore: number
  averageExecutableScore: number
  byOwnerRole: Record<string, number>
  byCadence: Record<string, number>
  byPriority: Record<string, number>
  byTaskModule: Record<string, number>
  byTaskStatus: Record<string, number>
  topMissingElements: string[]
}

export interface TaskIndex {
  schemaVersion: "task_index_v1"
  generatedAt: string
  entries: TaskIndexEntry[]
  summary: TaskIndexSummary
}

const TASK_MODULE_LABELS: Record<TaskModule, string> = {
  new_product_launch: "新品/新链接规划与上线",
  existing_product_growth: "老链接/存量商品增长优化",
  visual_content: "商品视觉与内容创作",
  traffic_promotion: "推广与流量运营",
  customer_conversion: "客服与转化运营",
  creator_content: "达人与内容投放",
  product_operations: "商品基础运营与管理",
  unknown: "待分类",
}

function slugifySourceName(sourceName: string): string {
  return getFileStem(sourceName)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "") || "source"
}

function normalizeRoleName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || ["待确认", "待补充", "无", "暂无"].includes(trimmed)) return ""
  return trimmed
    .replace(/^(负责人|owner|Owner)[:：]?\s*/i, "")
    .replace(/\s+/g, "")
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function hasConcreteValue(value: string): boolean {
  const normalized = value.trim()
  return normalized.length > 0 && !["待确认", "待补充", "无", "暂无"].includes(normalized)
}

function inferredTaskMissingElements(task: TaskCardDraft): string[] {
  const actionSteps = task.actionSteps ?? []
  const sourceRefs = task.sourceRefs ?? []
  const checks: Array<{ key: string; ok: boolean }> = [
    { key: "taskModule", ok: Boolean(task.taskModule && task.taskModule !== "unknown") },
    { key: "taskItem", ok: hasConcreteValue(task.taskItem ?? task.title) },
    { key: "businessGoal", ok: hasConcreteValue(task.title) },
    { key: "targetObject", ok: hasConcreteValue(task.targetObject) },
    { key: "problem", ok: hasConcreteValue(task.trigger) },
    { key: "problemEvidence", ok: (task.problemEvidence ?? []).some(hasConcreteValue) },
    {
      key: "strategyPath",
      ok: actionSteps.some((item) => /(策略|路径|打法|计划|方案|排查|优化|重建|调整)/.test(item)),
    },
    { key: "actionSteps", ok: actionSteps.some(hasConcreteValue) },
    { key: "ownerRole", ok: hasConcreteValue(task.ownerRole) },
    { key: "collaboratorRoles", ok: (task.collaboratorRoles ?? []).some(hasConcreteValue) },
    { key: "cadence", ok: hasConcreteValue(task.cadence) },
    { key: "acceptanceMetrics", ok: (task.acceptanceMetrics ?? []).some(hasConcreteValue) },
    { key: "reviewRequirement", ok: hasConcreteValue(task.reviewRequirement) },
    { key: "sourceRefs", ok: sourceRefs.length > 0 },
  ]
  if ((task.taskStatus === "done" || /复盘|完成|结果|反馈/.test(`${task.title} ${task.trigger}`)) && !(task.resultFeedback ?? []).some(hasConcreteValue)) {
    checks.push({ key: "resultFeedback", ok: false })
  }
  return checks.filter((item) => !item.ok).map((item) => item.key)
}

function inferredTaskScores(task: TaskCardDraft, missingElements: string[]): {
  qualityScore: number
  executableScore: number
  evidenceScore: number
} {
  const totalKeys = [
    "taskModule",
    "taskItem",
    "businessGoal",
    "targetObject",
    "problem",
    "problemEvidence",
    "strategyPath",
    "actionSteps",
    "ownerRole",
    "collaboratorRoles",
    "cadence",
    "acceptanceMetrics",
    "reviewRequirement",
    "sourceRefs",
  ]
  const executableKeys = [
    "taskItem",
    "businessGoal",
    "targetObject",
    "actionSteps",
    "ownerRole",
    "collaboratorRoles",
    "cadence",
    "acceptanceMetrics",
    "reviewRequirement",
  ]
  const evidenceKeys = ["problemEvidence", "sourceRefs"]
  const missing = new Set(missingElements)
  const scoreFor = (keys: string[]): number =>
    Math.round(((keys.length - keys.filter((key) => missing.has(key)).length) / keys.length) * 100)
  const completenessScore = scoreFor(totalKeys)
  const executableScore = asNumber(task.executableScore, asNumber(task.quality?.executableScore, scoreFor(executableKeys)))
  const evidenceScore = asNumber(task.quality?.evidenceScore, scoreFor(evidenceKeys))
  const qualityScore = asNumber(
    task.qualityScore,
    asNumber(task.quality?.score, Math.round((completenessScore * 0.45) + (executableScore * 0.35) + (evidenceScore * 0.2))),
  )
  return {
    qualityScore,
    executableScore,
    evidenceScore,
  }
}

function qualityBandForTask(task: TaskCardDraft, qualityScore: number, missingElements: string[]): TaskQualityBand {
  const hasBlockingGap = ["taskItem", "ownerRole", "acceptanceMetrics", "sourceRefs"].some((key) => missingElements.includes(key))
  if ((task.status === "draft" || task.quality?.level === "ready") && qualityScore >= 85 && !hasBlockingGap) return "ready"
  return "needs_review"
}

function fallbackTimeRange(task: TaskCardDraft): TaskTimeRange {
  if (task.timeRange?.label) return task.timeRange
  if (task.cadence && task.cadence !== "待确认") return { label: task.cadence }
  return { label: "待确认" }
}

function priorityForTask(task: TaskCardDraft): TaskPriority {
  return task.priority ?? "unknown"
}

function uniq(items: readonly string[], max = Number.POSITIVE_INFINITY): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))).slice(0, max)
}

function normalizedSourceText(input: { sourceName?: string; sourcePath?: string }): string {
  return `${input.sourceName ?? ""} ${input.sourcePath ?? ""}`.toLowerCase()
}

function isMechanismSourceName(input: { sourceName?: string; sourcePath?: string }): boolean {
  return /(经营任务生成机制|任务生成元策略|任务生成机制|质量体系|任务质量|质量评分|评分规则|任务模板|核心要素)/i.test(
    normalizedSourceText(input),
  )
}

function isMeetingOrActionSourceName(input: { sourceName?: string; sourcePath?: string }): boolean {
  return /(周会|月会|周计划|月计划|行动计划|行动项|复盘|review|meeting|weekly|monthly)/i.test(
    normalizedSourceText(input),
  )
}

function isRoleKpiSourceName(input: { sourceName?: string; sourcePath?: string }): boolean {
  const text = normalizedSourceText(input)
  return /(岗位|职责|kpi|绩效|考核|岗位说明|岗位价值|岗位能力)/i.test(text) && !isMeetingOrActionSourceName(input)
}

export function isSearchableTaskIndexEntry(entry: TaskIndexEntry, includeContextSources = false): boolean {
  if (includeContextSources) return true
  if (entry.generationSource === "manual_confirmed" || entry.generationSource === "derived_from_review") return true
  if (isMechanismSourceName(entry) || isRoleKpiSourceName(entry)) return false
  return entry.sourceDocType === "meeting_task_source" || entry.sourceDocType === "mixed_task_source"
}

function countBy(items: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items.filter(Boolean)) {
    counts[item] = (counts[item] ?? 0) + 1
  }
  return counts
}

interface TaskCompletionContext {
  rulePacks: Array<{ packId: string; sourceName: string; pack: TaskRulePack }>
  roleContexts: Array<{ packId: string; sourceName: string; index: RoleContextIndex }>
}

function buildCompletionContext(packs: TaskContextPack[]): TaskCompletionContext {
  const rulePacks = packs.flatMap((pack) =>
    pack.taskRulePack
      ? [{ packId: pack.packId, sourceName: pack.sourceName, pack: pack.taskRulePack }]
      : [],
  )
  const roleContexts = packs.flatMap((pack) =>
    pack.roleContextIndex
      ? [{ packId: pack.packId, sourceName: pack.sourceName, index: pack.roleContextIndex }]
      : [],
  )
  return { rulePacks, roleContexts }
}

function roleMatchScore(roleName: string, task: TaskCardDraft): number {
  const role = roleName.replace(/\s+/g, "")
  if (!role) return 0
  const haystack = [
    task.title,
    task.targetObject,
    task.trigger,
    task.ownerRole,
    ...(task.problemEvidence ?? []),
    ...(task.actionSteps ?? []),
    ...(task.acceptanceMetrics ?? []),
  ].join(" ").replace(/\s+/g, "")
  if (!haystack) return 0
  if (hasConcreteValue(task.ownerRole) && task.ownerRole.replace(/\s+/g, "").includes(role)) return 100
  if (haystack.includes(role)) return 70
  return 0
}

function findBestRoleContext(
  task: TaskCardDraft,
  context: TaskCompletionContext,
): { packId: string; sourceName: string; roleName: string; kpis: string[]; collaboratorRoles: string[] } | null {
  let best: { score: number; packId: string; sourceName: string; roleName: string; kpis: string[]; collaboratorRoles: string[] } | null = null
  for (const item of context.roleContexts) {
    for (const role of item.index.roles) {
      const score = roleMatchScore(role.roleName, task)
      if (score <= 0) continue
      if (!best || score > best.score) {
        best = {
          score,
          packId: item.packId,
          sourceName: item.sourceName,
          roleName: role.roleName,
          kpis: role.kpis,
          collaboratorRoles: role.collaboratorRoles,
        }
      }
    }
  }
  return best
}

function enrichTaskWithContext(
  pack: TaskContextPack,
  task: TaskCardDraft,
  context: TaskCompletionContext,
): TaskCardDraft {
  const rulePackRefs = uniq([
    ...(task.rulePackRefs ?? []),
    ...context.rulePacks.map((item) => item.packId),
  ], 5)
  const completionSources = [...(task.completionSources ?? [])]
  if (rulePackRefs.length > (task.rulePackRefs ?? []).length) {
    completionSources.push("task_rule_pack")
  }
  const bestRole = findBestRoleContext(task, context)
  if (!bestRole) {
    return {
      ...task,
      rulePackRefs,
      completionSources: uniq(completionSources, 8),
    }
  }

  const canFillOwner = !hasConcreteValue(task.ownerRole)
    && (roleMatchScore(bestRole.roleName, task) >= 100 || /(负责人|owner|主责|归属)/i.test(task.trigger + task.title))
  const nextOwnerRole = canFillOwner ? bestRole.roleName : task.ownerRole
  const nextCollaborators = uniq([
    ...(task.collaboratorRoles ?? []),
    ...bestRole.collaboratorRoles,
  ], 8)
  const nextMetrics = uniq([
    ...(task.acceptanceMetrics ?? []),
    ...bestRole.kpis,
  ], 8)
  completionSources.push("role_context_index")
  return {
    ...task,
    ownerRole: nextOwnerRole,
    normalizedOwnerRole: canFillOwner ? nextOwnerRole.replace(/\s+/g, "") : task.normalizedOwnerRole,
    collaboratorRoles: nextCollaborators,
    acceptanceMetrics: nextMetrics,
    rulePackRefs,
    roleContextRefs: uniq([...(task.roleContextRefs ?? []), bestRole.packId], 5),
    completionSources: uniq(completionSources, 8),
    sourceDocType: task.sourceDocType ?? pack.docRole,
  }
}

function summarize(entries: TaskIndexEntry[]): TaskIndexSummary {
  const total = entries.length
  const ready = entries.filter((entry) => entry.qualityBand === "ready").length
  const needsReview = total - ready
  const averageQualityScore = total
    ? Math.round(entries.reduce((sum, entry) => sum + entry.qualityScore, 0) / total)
    : 0
  const averageExecutableScore = total
    ? Math.round(entries.reduce((sum, entry) => sum + entry.executableScore, 0) / total)
    : 0
  const missingCounts = countBy(entries.flatMap((entry) => entry.missingElements))
  const topMissingElements = Object.entries(missingCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key)
    .slice(0, 8)
  return {
    total,
    ready,
    needsReview,
    averageQualityScore,
    averageExecutableScore,
    byOwnerRole: countBy(entries.map((entry) => entry.normalizedOwnerRole || entry.ownerRole).filter(Boolean)),
    byCadence: countBy(entries.map((entry) => entry.cadence)),
    byPriority: countBy(entries.map((entry) => entry.priority)),
    byTaskModule: countBy(entries.map((entry) => entry.taskModule)),
    byTaskStatus: countBy(entries.map((entry) => entry.taskStatus)),
    topMissingElements,
  }
}

function entryFromTask(pack: TaskContextPack, task: TaskCardDraft): TaskIndexEntry {
  const missingElements = (task.quality?.missingElements?.length ?? 0) > 0
    ? (task.quality?.missingElements ?? [])
    : inferredTaskMissingElements(task)
  const inferredScores = inferredTaskScores(task, missingElements)
  const qualityScore = inferredScores.qualityScore
  const executableScore = inferredScores.executableScore
  const importanceScore = asNumber(task.importanceScore, 50)
  const sourceSlug = slugifySourceName(pack.sourceName)
  return {
    taskId: task.taskId,
    title: task.title,
    taskModule: task.taskModule ?? "unknown",
    taskModuleLabel: TASK_MODULE_LABELS[task.taskModule ?? "unknown"],
    productId: task.productId ?? "",
    taskItem: task.taskItem ?? task.title,
    taskStatus: task.taskStatus ?? "unknown",
    resultFeedback: task.resultFeedback ?? [],
    ownerRole: task.ownerRole,
    normalizedOwnerRole: task.normalizedOwnerRole ?? normalizeRoleName(task.ownerRole),
    collaboratorRoles: task.collaboratorRoles ?? [],
    timeRange: fallbackTimeRange(task),
    cadence: task.cadence,
    priority: priorityForTask(task),
    importanceScore,
    executableScore,
    qualityScore,
    qualityBand: qualityBandForTask(task, qualityScore, missingElements),
    status: task.status,
    targetObject: task.targetObject,
    problemEvidence: task.problemEvidence ?? [],
    actionSteps: task.actionSteps ?? [],
    acceptanceMetrics: task.acceptanceMetrics ?? [],
    reviewRequirement: task.reviewRequirement,
    missingElements,
    sourceRefs: task.sourceRefs ?? [],
    wikiRefs: [`wiki/tasks/${sourceSlug}.md`],
    sourceDocId: pack.sourceDocId,
    sourceName: pack.sourceName,
    sourceDocType: task.sourceDocType ?? pack.docRole,
    generationSource: task.generationSource ?? "meeting_action",
    completionSources: task.completionSources ?? [],
    rulePackRefs: task.rulePackRefs ?? [],
    roleContextRefs: task.roleContextRefs ?? [],
    qualityDerived: !task.quality && task.qualityScore === undefined,
    reviewNotes: task.quality?.reviewNotes ?? [],
  }
}

function taskDedupeKey(entry: TaskIndexEntry): string {
  const evidenceKey = entry.sourceRefs[0] ?? `${entry.sourceDocId}|${entry.sourceName}`
  return [
    entry.sourceName,
    entry.taskItem || entry.title,
    entry.productId,
    entry.taskModule,
    entry.targetObject,
    evidenceKey,
  ].join("|").toLowerCase()
}

function hasSpecificTimeRange(entry: TaskIndexEntry): boolean {
  return Boolean(
    entry.timeRange.start
    || entry.timeRange.end
    || (!["weekly", "monthly", "待确认"].includes(entry.timeRange.label) && /\d/.test(entry.timeRange.label)),
  )
}

function entrySelectionScore(entry: TaskIndexEntry): number {
  const populatedFieldCount = [
    entry.ownerRole,
    entry.taskModule,
    entry.taskItem,
    entry.productId,
    entry.taskStatus,
    entry.targetObject,
    entry.reviewRequirement,
    ...entry.problemEvidence,
    ...entry.actionSteps,
    ...entry.acceptanceMetrics,
    ...entry.sourceRefs,
  ].filter(hasConcreteValue).length
  return (
    entry.qualityScore * 1000
    + entry.executableScore * 100
    + entry.importanceScore
    + populatedFieldCount * 10
    + (entry.taskModule !== "unknown" ? 30 : 0)
    + (entry.productId ? 10 : 0)
    + (hasSpecificTimeRange(entry) ? 25 : 0)
    + (entry.qualityDerived ? 0 : 100000)
    - entry.missingElements.length * 5
  )
}

function dedupeTaskEntries(entries: TaskIndexEntry[]): TaskIndexEntry[] {
  const byKey = new Map<string, TaskIndexEntry>()
  for (const entry of entries) {
    const key = taskDedupeKey(entry)
    const current = byKey.get(key)
    if (!current || entrySelectionScore(entry) > entrySelectionScore(current)) {
      byKey.set(key, entry)
    }
  }
  return Array.from(byKey.values())
}

function normalizeTaskIndexEntry(entry: TaskIndexEntry): TaskIndexEntry {
  const taskModule = entry.taskModule ?? "unknown"
  return {
    ...entry,
    taskModule,
    taskModuleLabel: entry.taskModuleLabel ?? TASK_MODULE_LABELS[taskModule],
    productId: entry.productId ?? "",
    taskItem: entry.taskItem ?? entry.title,
    taskStatus: entry.taskStatus ?? "unknown",
    resultFeedback: entry.resultFeedback ?? [],
    collaboratorRoles: entry.collaboratorRoles ?? [],
    problemEvidence: entry.problemEvidence ?? [],
    actionSteps: entry.actionSteps ?? [],
    acceptanceMetrics: entry.acceptanceMetrics ?? [],
    missingElements: entry.missingElements ?? [],
    sourceRefs: entry.sourceRefs ?? [],
    wikiRefs: entry.wikiRefs ?? [],
    completionSources: entry.completionSources ?? [],
    rulePackRefs: entry.rulePackRefs ?? [],
    roleContextRefs: entry.roleContextRefs ?? [],
    reviewNotes: entry.reviewNotes ?? [],
  }
}

function canIndexPackTasks(pack: TaskContextPack): boolean {
  if (pack.sourcePolicy?.canGenerateTaskCards === false) return false
  if (pack.taskRulePack || isMechanismSourceName(pack) || isRoleKpiSourceName(pack)) return false
  if (pack.docRole === "meeting_task_source") return true
  if (pack.docRole === "mixed_task_source") return isMeetingOrActionSourceName(pack)
  return (pack.taskCandidates ?? []).some((task) =>
    task.generationSource === "manual_confirmed" || task.generationSource === "derived_from_review"
  )
}

async function loadTaskPacks(projectPath: string): Promise<TaskContextPack[]> {
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
    try {
      const parsed = JSON.parse(await readFile(node.path)) as TaskContextPack
      if (parsed.schemaVersion === "task_context_pack_v1") packs.push(parsed)
    } catch {
      // Corrupt work-state packs should not block the whole task index.
    }
  }
  return packs
}

export function buildTaskIndexFromPacks(packs: TaskContextPack[]): TaskIndex {
  const completionContext = buildCompletionContext(packs)
  const entries = dedupeTaskEntries(packs.flatMap((pack) =>
    canIndexPackTasks(pack)
      ? (pack.taskCandidates ?? [])
        .filter((task) => {
          const sourceDocType = task.sourceDocType ?? pack.docRole
          if (task.generationSource === "manual_confirmed" || task.generationSource === "derived_from_review") {
            return true
          }
          return sourceDocType === "meeting_task_source" || sourceDocType === "mixed_task_source"
        })
        .map((task) => entryFromTask(pack, enrichTaskWithContext(pack, task, completionContext)))
        .filter((entry) => isSearchableTaskIndexEntry(entry))
      : [],
  ))
  return {
    schemaVersion: "task_index_v1",
    generatedAt: new Date().toISOString(),
    entries,
    summary: summarize(entries),
  }
}

export async function buildOrRefreshTaskIndex(projectPath: string): Promise<TaskIndex> {
  const pp = normalizePath(projectPath)
  const packs = await loadTaskPacks(pp)
  const index = buildTaskIndexFromPacks(packs)
  await createDirectory(`${pp}/.llm-wiki`).catch(() => {})
  await writeFile(`${pp}/.llm-wiki/task-index.json`, JSON.stringify(index, null, 2))
  return index
}

export function renderTaskIndexMarkdown(index: TaskIndex): string {
  const ready = index.entries.filter((entry) => entry.qualityBand === "ready")
  const needsReview = index.entries.filter((entry) => entry.qualityBand === "needs_review")
  const renderEntry = (entry: TaskIndexEntry): string => [
    `### ${entry.title}`,
    `- 任务模块：${entry.taskModuleLabel}`,
    `- 商品编号/ID：${entry.productId || "不适用/待确认"}`,
    `- 任务事项：${entry.taskItem || entry.title}`,
    `- Owner：${entry.ownerRole || "待确认"}`,
    `- 时间：${entry.timeRange.label}`,
    `- 优先级：${entry.priority}`,
    `- 业务状态：${entry.taskStatus}`,
    `- 结果反馈：${entry.resultFeedback.join("；") || "暂无/待复盘"}`,
    `- 质量分：${entry.qualityScore}/100；可执行度：${entry.executableScore}/100；重要度：${entry.importanceScore}/100`,
    `- 状态：${entry.qualityBand === "ready" ? "可候选执行" : "需补齐"}`,
    `- 缺失要素：${entry.missingElements.join("、") || "无"}`,
    `- 来源：${entry.wikiRefs.map((ref) => `[[${ref.replace(/^wiki\//, "").replace(/\.md$/, "")}|${entry.sourceName}]]`).join("、")}`,
    "",
  ].join("\n")

  return [
    "---",
    "type: task_index",
    "title: \"经营任务卡索引\"",
    "scene_id: ecom_growth_task_generation",
    "---",
    "",
    "# 经营任务卡索引",
    "",
    "这里是从 `.llm-wiki/task-index.json` 投影出来的人类可读导航页。结构化检索和 Agent 消费以 task-index 为准，本页用于快速浏览任务质量、角色分布和缺口。",
    "",
    "## 质量概览",
    "",
    `- 任务总数：${index.summary.total}`,
    `- 可候选执行：${index.summary.ready}`,
    `- 需补齐：${index.summary.needsReview}`,
    `- 平均质量分：${index.summary.averageQualityScore}/100`,
    `- 平均可执行度：${index.summary.averageExecutableScore}/100`,
    `- 主要缺口：${index.summary.topMissingElements.join("、") || "暂无"}`,
    "",
    "## 角色分布",
    "",
    ...Object.entries(index.summary.byOwnerRole).map(([role, count]) => `- ${role}：${count} 张任务卡`),
    ...(Object.keys(index.summary.byOwnerRole).length ? [] : ["- 暂无明确 Owner"]),
    "",
    "## 任务模块分布",
    "",
    ...Object.entries(index.summary.byTaskModule).map(([moduleId, count]) => `- ${TASK_MODULE_LABELS[moduleId as TaskModule] ?? moduleId}：${count} 张任务卡`),
    ...(Object.keys(index.summary.byTaskModule).length ? [] : ["- 暂无明确任务模块"]),
    "",
    "## 可候选执行任务",
    "",
    ...(ready.length ? ready.map(renderEntry) : ["- 暂无"]),
    "",
    "## 需补齐任务",
    "",
    ...(needsReview.length ? needsReview.map(renderEntry) : ["- 暂无"]),
    "",
  ].join("\n")
}

export async function loadTaskIndex(projectPath: string): Promise<TaskIndex> {
  const pp = normalizePath(projectPath)
  try {
    const parsed = JSON.parse(await readFile(`${pp}/.llm-wiki/task-index.json`)) as TaskIndex
    if (parsed.schemaVersion === "task_index_v1") {
      const entries = (parsed.entries ?? []).map(normalizeTaskIndexEntry)
      return {
        ...parsed,
        entries,
        summary: {
          ...summarize(entries),
          ...parsed.summary,
          byTaskModule: parsed.summary?.byTaskModule ?? countBy(entries.map((entry) => entry.taskModule)),
          byTaskStatus: parsed.summary?.byTaskStatus ?? countBy(entries.map((entry) => entry.taskStatus)),
        },
      }
    }
  } catch {
    // Rebuild below.
  }
  return buildOrRefreshTaskIndex(pp)
}
