import { load as loadYaml } from "js-yaml"
import { createDirectory, fileExists, listDirectory, readFile, writeFile } from "@/commands/fs"
import type { TaskContextPack } from "@/lib/agent-mode-types"
import type { TaskIndex, TaskIndexEntry } from "@/lib/task-index"
import { loadTaskIndex } from "@/lib/task-index"
import {
  formatTaskCardsForPrompt,
  groupTaskSearchResults,
  searchTaskCards,
  type GroupedTaskSearchResults,
  type TaskSearchFilters,
  type TaskSearchResult,
} from "@/lib/task-search"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { streamChat } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import { normalizePath } from "@/lib/path-utils"

export interface TaskQualityJudgeCaseFile {
  runId?: string
  ingestCases?: TaskQualityIngestCase[]
  taskExtractionCases?: TaskQualityExtractionCase[]
  queryCases?: TaskQualityQueryCase[]
}

export type ExpectedTaskContribution = "task_cards" | "template_rules"
export type ActualTaskContribution = "task_cards" | "template_rules" | "context_only" | "mixed" | "missing"

export interface TaskQualityIngestCase {
  caseId: string
  sourceName?: string
  expectedDocRole?: string
  shouldGenerateTasks?: boolean
  expectedContribution?: ExpectedTaskContribution
  minTaskCards?: number
  requireTaskRulePack?: boolean
  requireRoleContextIndex?: boolean
  mustEnterTaskIndex?: boolean
  mustNotEnterTaskIndex?: boolean
  acceptedDocRoles?: string[]
}

export interface TaskQualityExtractionCase {
  caseId: string
  taskId?: string
  sourceName?: string
  requiredElements?: string[]
}

export interface TaskQualityQueryCase {
  caseId: string
  query: string
  filters?: TaskSearchFilters
}

export interface TaskQualityLayerScore {
  score: number
  status: "pass" | "warn" | "fail"
  mainProblem: string
}

export interface TaskQualityIngestResult {
  caseId: string
  sourceName: string
  docRole: string
  expectedContribution?: ExpectedTaskContribution
  actualContribution: ActualTaskContribution
  taskCandidateCount: number
  indexedTaskCount: number
  taskExtractionComplete: boolean
  contributionStatus: TaskQualityLayerScore["status"]
  score: number
  status: TaskQualityLayerScore["status"]
  failureReason: string
  recommendedFix: string
  evidenceRefs: string[]
}

export interface TaskQualityExtractionResult {
  caseId: string
  taskId: string
  title: string
  score: number
  status: TaskQualityLayerScore["status"]
  failureReason: string
  recommendedFix: string
  evidenceRefs: string[]
  missingElements: string[]
}

export interface TaskQualityQueryResult {
  caseId: string
  query: string
  score: number
  status: TaskQualityLayerScore["status"]
  failureReason: string
  recommendedFix: string
  grouped: GroupedTaskSearchResults
  evidenceRefs: string[]
  judgeNotes: string[]
}

export interface TaskQualityLlmJudgeReport {
  schemaVersion: "task_quality_llm_judge_v1"
  runId: string
  generatedAt: string
  llmJudgeSkipped: boolean
  llmJudgeNotes: string[]
  layerSummary: {
    ingest: TaskQualityLayerScore
    taskExtraction: TaskQualityLayerScore
    queryQuality: TaskQualityLayerScore
    overall: TaskQualityLayerScore
  }
  ingestResults: TaskQualityIngestResult[]
  taskExtractionResults: TaskQualityExtractionResult[]
  queryResults: TaskQualityQueryResult[]
}

export interface RunTaskQualityLlmJudgeInput {
  projectPath: string
  cases: TaskQualityJudgeCaseFile
  llmConfig?: LlmConfig | null
  runId?: string
  generatedAt?: string
}

export interface RunTaskQualityLlmJudgeFromFileOptions {
  llmConfig?: LlmConfig | null
  runId?: string
  generatedAt?: string
}

export interface RunTaskQualityLlmJudgeResult {
  outputDir: string
  report: TaskQualityLlmJudgeReport
}

interface ProjectQualityReportLike {
  taskSummary?: {
    total?: number
    ready?: number
    needsReview?: number
    averageQualityScore?: number
    averageExecutableScore?: number
    topMissingElements?: string[]
  }
  averageDocumentQualityScore?: number
}

interface LlmJudgeResponse {
  ingestScore?: number
  taskExtractionScore?: number
  queryQualityScore?: number
  notes?: string[]
}

const DEFAULT_QUERY_CASES: TaskQualityQueryCase[] = [
  { caseId: "ops-owner-december-tasks", query: "运营负责人 12 月任务列表", filters: { role: "运营负责人" } },
  { caseId: "promotion-this-week", query: "推广运营 本周需要做什么", filters: { role: "推广运营" } },
  { caseId: "existing-product-growth", query: "老链接增长任务有哪些", filters: { taskModule: "existing_product_growth" } },
  { caseId: "customer-conversion", query: "客服转化任务列表", filters: { taskModule: "customer_conversion" } },
  { caseId: "product-id-related", query: "某商品 ID 相关任务", filters: {} },
  { caseId: "done-missing-feedback", query: "已完成但缺复盘反馈的任务", filters: { taskStatus: "done" } },
]

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function average(values: number[]): number {
  const valid = values.filter((value) => Number.isFinite(value))
  if (valid.length === 0) return 0
  return clampScore(valid.reduce((sum, value) => sum + value, 0) / valid.length)
}

function statusForScore(score: number): TaskQualityLayerScore["status"] {
  if (score >= 85) return "pass"
  if (score >= 60) return "warn"
  return "fail"
}

function layer(score: number, mainProblem: string): TaskQualityLayerScore {
  const safeScore = clampScore(score)
  return {
    score: safeScore,
    status: statusForScore(safeScore),
    mainProblem,
  }
}

function uniq(items: readonly string[], limit = Number.POSITIVE_INFINITY): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))).slice(0, limit)
}

function topMissingElements(entries: TaskIndexEntry[], limit = 8): string[] {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    for (const element of entry.missingElements ?? []) {
      counts.set(element, (counts.get(element) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([element]) => element)
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

async function readJsonIfPresent<T>(path: string, fallback: T): Promise<T> {
  try {
    return safeJsonParse<T>(await readFile(path), fallback)
  } catch {
    return fallback
  }
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
      // Corrupt work-state packs should be visible through quality gaps, not fatal to the eval.
    }
  }
  return packs
}

function normalizeCaseFile(value: unknown): TaskQualityJudgeCaseFile {
  const obj = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const normalizeQueryCase = (item: unknown): TaskQualityQueryCase | null => {
    if (!item || typeof item !== "object") return null
    const record = item as Record<string, unknown>
    const query = String(record.query ?? "").trim()
    if (!query) return null
    return {
      caseId: String(record.caseId ?? record.id ?? query).trim(),
      query,
      filters: record.filters && typeof record.filters === "object"
        ? record.filters as TaskSearchFilters
        : undefined,
    }
  }
  const normalizeIngestCase = (item: unknown): TaskQualityIngestCase | null => {
    if (!item || typeof item !== "object") return null
    const record = item as Record<string, unknown>
    const caseId = String(record.caseId ?? record.id ?? record.sourceName ?? "").trim()
    if (!caseId) return null
    return {
      caseId,
      sourceName: record.sourceName ? String(record.sourceName) : undefined,
      expectedDocRole: record.expectedDocRole ? String(record.expectedDocRole) : undefined,
      shouldGenerateTasks: typeof record.shouldGenerateTasks === "boolean" ? record.shouldGenerateTasks : undefined,
      expectedContribution: record.expectedContribution === "task_cards" || record.expectedContribution === "template_rules"
        ? record.expectedContribution
        : undefined,
      minTaskCards: typeof record.minTaskCards === "number" ? record.minTaskCards : undefined,
      requireTaskRulePack: typeof record.requireTaskRulePack === "boolean" ? record.requireTaskRulePack : undefined,
      requireRoleContextIndex: typeof record.requireRoleContextIndex === "boolean" ? record.requireRoleContextIndex : undefined,
      mustEnterTaskIndex: typeof record.mustEnterTaskIndex === "boolean" ? record.mustEnterTaskIndex : undefined,
      mustNotEnterTaskIndex: typeof record.mustNotEnterTaskIndex === "boolean" ? record.mustNotEnterTaskIndex : undefined,
      acceptedDocRoles: Array.isArray(record.acceptedDocRoles)
        ? record.acceptedDocRoles.map((role) => String(role))
        : undefined,
    }
  }
  const normalizeExtractionCase = (item: unknown): TaskQualityExtractionCase | null => {
    if (!item || typeof item !== "object") return null
    const record = item as Record<string, unknown>
    const caseId = String(record.caseId ?? record.id ?? record.taskId ?? "").trim()
    if (!caseId) return null
    return {
      caseId,
      taskId: record.taskId ? String(record.taskId) : undefined,
      sourceName: record.sourceName ? String(record.sourceName) : undefined,
      requiredElements: Array.isArray(record.requiredElements)
        ? record.requiredElements.map((element) => String(element))
        : undefined,
    }
  }
  return {
    runId: obj.runId ? String(obj.runId) : undefined,
    ingestCases: Array.isArray(obj.ingestCases) ? obj.ingestCases.map(normalizeIngestCase).filter((item): item is TaskQualityIngestCase => Boolean(item)) : [],
    taskExtractionCases: Array.isArray(obj.taskExtractionCases) ? obj.taskExtractionCases.map(normalizeExtractionCase).filter((item): item is TaskQualityExtractionCase => Boolean(item)) : [],
    queryCases: Array.isArray(obj.queryCases) ? obj.queryCases.map(normalizeQueryCase).filter((item): item is TaskQualityQueryCase => Boolean(item)) : [],
  }
}

function defaultRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
  return `task-quality-judge-${stamp}`
}

function sourceNameMatches(actual: string, expected: string): boolean {
  return actual.includes(expected) || expected.includes(actual)
}

function taskEntriesForSource(entries: TaskIndexEntry[], sourceName: string): TaskIndexEntry[] {
  return entries.filter((entry) => sourceNameMatches(entry.sourceName, sourceName))
}

function actualContributionFor(input: {
  taskCandidateCount: number
  taskIndexCount: number
  hasTaskRulePack: boolean
  hasTaxonomy: boolean
  hasRoleContext: boolean
}): ActualTaskContribution {
  const hasTasks = input.taskCandidateCount > 0 || input.taskIndexCount > 0
  const hasRules = input.hasTaskRulePack || input.hasTaxonomy
  if (hasTasks && hasRules) return "mixed"
  if (hasTasks) return "task_cards"
  if (hasRules) return "template_rules"
  if (input.hasRoleContext) return "context_only"
  return "context_only"
}

function scorePackGroup(
  packs: TaskContextPack[],
  taskIndex: TaskIndex,
  evalCase?: TaskQualityIngestCase,
): TaskQualityIngestResult {
  if (packs.length === 0) {
    return {
      caseId: evalCase?.caseId ?? "missing",
      sourceName: evalCase?.sourceName ?? evalCase?.caseId ?? "missing",
      docRole: "missing",
      expectedContribution: evalCase?.expectedContribution,
      actualContribution: "missing",
      taskCandidateCount: 0,
      indexedTaskCount: 0,
      taskExtractionComplete: false,
      contributionStatus: "fail",
      score: 0,
      status: "fail",
      failureReason: "未找到对应 TaskContextPack",
      recommendedFix: "确认该来源是否已完成 ingest，并检查 .llm-wiki/task-context-packs。",
      evidenceRefs: [],
    }
  }

  const primary = packs[0]
  const sourceName = evalCase?.sourceName ?? primary.sourceName
  const indexEntries = taskEntriesForSource(taskIndex.entries, sourceName)
  const taskCandidateCount = packs.reduce((sum, pack) => sum + (pack.taskCandidates?.length ?? 0), 0)
  const evidenceRefs = uniq(packs.flatMap((pack) => pack.evidenceAnchors ?? []), 8)
  const evidenceCount = evidenceRefs.length
  const hasPolicy = packs.some((pack) => Boolean(pack.sourcePolicy))
  const hasTaskRulePack = packs.some((pack) => Boolean(pack.taskRulePack))
  const hasTaxonomy = packs.some((pack) => Boolean(pack.taskTaxonomy))
  const hasRoleContext = packs.some((pack) => Boolean(pack.roleContextIndex) || (pack.roleProfiles ?? []).length > 0)
  const docRoles = uniq(packs.map((pack) => pack.docRole))
  const docRoleMatches = !evalCase?.expectedDocRole || docRoles.includes(evalCase.expectedDocRole)
  const acceptedDocRoleMatches = !evalCase?.acceptedDocRoles?.length
    || docRoles.some((role) => evalCase.acceptedDocRoles?.includes(role))
  const taskPolicyMatches = evalCase?.shouldGenerateTasks === undefined
    || (evalCase.shouldGenerateTasks ? taskCandidateCount > 0 : taskCandidateCount === 0)
  const minTaskCards = evalCase?.minTaskCards ?? (evalCase?.expectedContribution === "task_cards" ? 1 : 0)
  const hasEnoughTaskCards = Math.max(taskCandidateCount, indexEntries.length) >= minTaskCards
  const entersTaskIndex = indexEntries.length > 0
  const taskExtractionComplete = evalCase?.expectedContribution === "task_cards"
    ? hasEnoughTaskCards && (!evalCase?.mustEnterTaskIndex || entersTaskIndex)
    : true
  const taskIndexRequirementMatches = (
    (evalCase?.mustEnterTaskIndex !== true || entersTaskIndex)
    && (evalCase?.mustNotEnterTaskIndex !== true || !entersTaskIndex)
  )
  const ruleRequirementMatches = evalCase?.requireTaskRulePack !== true || hasTaskRulePack || hasTaxonomy
  const roleContextRequirementMatches = evalCase?.requireRoleContextIndex !== true || hasRoleContext
  const actualContribution = actualContributionFor({
    taskCandidateCount,
    taskIndexCount: indexEntries.length,
    hasTaskRulePack,
    hasTaxonomy,
    hasRoleContext,
  })
  const taskCardsReadyCount = indexEntries.filter((entry) => entry.qualityBand === "ready").length
  const expectedContributionMatches = evalCase?.expectedContribution
    ? evalCase.expectedContribution === actualContribution
      || (evalCase.expectedContribution === "task_cards" && actualContribution === "mixed")
      || (evalCase.expectedContribution === "template_rules" && actualContribution === "mixed")
    : true
  const taskCardQualityWarn = evalCase?.expectedContribution === "task_cards"
    && hasEnoughTaskCards
    && entersTaskIndex
    && taskCardsReadyCount === 0
  const fieldSignals = [
    packs.some((pack) => (pack.operatingGoals ?? []).length > 0),
    packs.some((pack) => (pack.roleProfiles ?? []).length > 0),
    packs.some((pack) => (pack.metricRules ?? []).length > 0),
    packs.some((pack) => (pack.taskTriggers ?? []).length > 0),
    hasTaskRulePack || hasTaxonomy || hasRoleContext || taskCandidateCount > 0 || indexEntries.length > 0,
  ].filter(Boolean).length
  const hardFailures = [
    docRoleMatches,
    acceptedDocRoleMatches,
    taskPolicyMatches,
    hasEnoughTaskCards,
    taskIndexRequirementMatches,
    ruleRequirementMatches,
    roleContextRequirementMatches,
    expectedContributionMatches,
    evidenceCount > 0,
    fieldSignals > 0,
  ].filter((ok) => !ok).length
  const score = clampScore(
    20
    + (docRoleMatches && acceptedDocRoleMatches ? 18 : 0)
    + (taskPolicyMatches ? 10 : 0)
    + (hasPolicy ? 8 : 0)
    + (expectedContributionMatches ? 12 : 0)
    + (hasEnoughTaskCards ? 10 : 0)
    + (taskIndexRequirementMatches ? 8 : 0)
    + (ruleRequirementMatches ? 8 : 0)
    + (roleContextRequirementMatches ? 4 : 0)
    + Math.min(12, fieldSignals * 3)
    + Math.min(10, evidenceCount * 3)
    - (taskCardQualityWarn ? 12 : 0)
    - (hardFailures * 8),
  )
  const problems = [
    docRoleMatches ? "" : `docRole expected ${evalCase?.expectedDocRole}, got ${docRoles.join("、")}`,
    acceptedDocRoleMatches ? "" : `docRole not in accepted roles: ${(evalCase?.acceptedDocRoles ?? []).join("、")}`,
    taskPolicyMatches ? "" : evalCase?.shouldGenerateTasks ? "expected task candidates but none found" : "context source generated task candidates",
    evalCase?.expectedContribution === "task_cards" && !hasEnoughTaskCards
      ? `期望生成任务卡但 taskCandidates/task-index 为空或不足（taskCandidates=${taskCandidateCount}，taskIndex=${indexEntries.length}，min=${minTaskCards}）`
      : "",
    evalCase?.expectedContribution === "template_rules" && !ruleRequirementMatches
      ? "模板未沉淀规则：缺少 TaskRulePack / TaskTaxonomy"
      : "",
    evalCase?.requireRoleContextIndex && !roleContextRequirementMatches
      ? "模板未沉淀角色上下文：缺少 RoleContextIndex"
      : "",
    evalCase?.mustEnterTaskIndex && !entersTaskIndex
      ? "期望进入 task-index，但当前没有对应任务卡"
      : "",
    evalCase?.mustNotEnterTaskIndex && entersTaskIndex
      ? "模板污染任务索引：该模板类来源进入了 .llm-wiki/task-index.json"
      : "",
    expectedContributionMatches ? "" : `expectedContribution=${evalCase?.expectedContribution}, actualContribution=${actualContribution}`,
    taskCardQualityWarn ? "已生成任务卡，但只生成 needs_review，暂无 ready 任务" : "",
    evidenceCount > 0 ? "" : "missing evidence anchors",
    fieldSignals > 0 ? "" : "no task-related field signals found",
  ].filter(Boolean)
  const contributionStatus: TaskQualityLayerScore["status"] = hardFailures > 0
    ? "fail"
    : taskCardQualityWarn
      ? "warn"
      : statusForScore(score)
  return {
    caseId: evalCase?.caseId ?? primary.packId,
    sourceName,
    docRole: docRoles.join("、"),
    expectedContribution: evalCase?.expectedContribution,
    actualContribution,
    taskCandidateCount,
    indexedTaskCount: indexEntries.length,
    taskExtractionComplete,
    contributionStatus,
    score,
    status: contributionStatus === "fail" ? "fail" : contributionStatus === "warn" ? "warn" : statusForScore(score),
    failureReason: problems.join("；") || "结构化产物基本可用",
    recommendedFix: problems.length > 0
      ? evalCase?.expectedContribution === "template_rules"
        ? "检查模板类文档是否沉淀 TaskRulePack / TaskTaxonomy，并确保不进入任务索引。"
        : "检查文档角色识别、表格/字段映射、任务卡抽取和 task-index 写入。"
      : "继续保持 source role、字段候选和证据锚点一致。",
    evidenceRefs,
  }
}

function scoreTask(entry: TaskIndexEntry, evalCase?: TaskQualityExtractionCase): TaskQualityExtractionResult {
  const required = evalCase?.requiredElements ?? [
    "taskItem",
    "targetObject",
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
  const missing = uniq([
    ...(entry.missingElements ?? []),
    ...required.filter((key) => {
      if (key === "sourceRefs") return entry.sourceRefs.length === 0
      const value = (entry as unknown as Record<string, unknown>)[key]
      if (Array.isArray(value)) return value.length === 0
      if (typeof value === "string") return !value.trim() || value === "待确认"
      return value === undefined || value === null
    }),
  ])
  const score = clampScore(entry.qualityScore - Math.min(25, Math.max(0, missing.length - (entry.missingElements ?? []).length) * 3))
  return {
    caseId: evalCase?.caseId ?? entry.taskId,
    taskId: entry.taskId,
    title: entry.title,
    score,
    status: statusForScore(score),
    failureReason: missing.length > 0 ? `缺失要素：${missing.join("、")}` : "任务卡核心要素完整",
    recommendedFix: missing.length > 0
      ? "优先补齐 Owner、具体动作、验收指标、问题证据和 sourceRefs，再进入可执行候选。"
      : "可作为 ready 任务进入后续 Review 或 Agent 候选消费。",
    evidenceRefs: uniq(entry.sourceRefs, 5),
    missingElements: missing,
  }
}

function scoreQuery(caseItem: TaskQualityQueryCase, hits: TaskSearchResult[]): TaskQualityQueryResult {
  const grouped = groupTaskSearchResults(hits)
  const readyCount = grouped.ready.count
  const reviewCount = grouped.needsReview.count
  const hitCount = readyCount + reviewCount
  const score = hitCount === 0
    ? 25
    : clampScore(
        45
        + Math.min(25, readyCount * 25)
        + Math.min(15, reviewCount * 8)
        + (grouped.ready.averageQualityScore ? grouped.ready.averageQualityScore * 0.1 : 0)
        + (grouped.needsReview.missingElements.length > 0 ? 5 : 0),
      )
  const evidenceRefs = uniq(hits.flatMap((hit) => hit.entry.sourceRefs), 8)
  const missing = uniq([
    ...grouped.ready.missingElements,
    ...grouped.needsReview.missingElements,
  ], 8)
  return {
    caseId: caseItem.caseId,
    query: caseItem.query,
    score,
    status: statusForScore(score),
    failureReason: hitCount === 0
      ? "没有从任务索引召回任务卡"
      : readyCount === 0
        ? `只召回 needs_review 任务；主要缺口：${missing.join("、") || "未知"}`
        : "已召回任务卡并完成 ready / needs_review 分组",
    recommendedFix: hitCount === 0
      ? "检查任务索引中 role/time/module/productId/status 字段是否抽取完整。"
      : readyCount === 0
        ? "先补齐 needs_review 任务的核心要素，再提升查询结果可执行性。"
        : "继续保持结构化任务索引消费，模型正文只做解释补充。",
    grouped,
    evidenceRefs,
    judgeNotes: hits.length > 0 ? ["结构化检索已返回任务卡。"] : ["任务索引召回为空。"],
  }
}

function findMatchingPacks(packs: TaskContextPack[], evalCase: TaskQualityIngestCase): TaskContextPack[] {
  if (evalCase.sourceName) {
    return packs.filter((pack) => sourceNameMatches(pack.sourceName, evalCase.sourceName ?? ""))
  }
  return packs.filter((pack) => pack.packId === evalCase.caseId || pack.sourceDocId === evalCase.caseId)
}

function findMatchingTask(entries: TaskIndexEntry[], evalCase: TaskQualityExtractionCase): TaskIndexEntry | undefined {
  if (evalCase.taskId) return entries.find((entry) => entry.taskId === evalCase.taskId)
  if (evalCase.sourceName) return entries.find((entry) => entry.sourceName.includes(evalCase.sourceName ?? ""))
  return entries.find((entry) => entry.taskId === evalCase.caseId)
}

function buildIngestResults(packs: TaskContextPack[], taskIndex: TaskIndex, cases: TaskQualityIngestCase[] | undefined): TaskQualityIngestResult[] {
  if (cases?.length) {
    return cases.map((evalCase) => {
      const matchingPacks = findMatchingPacks(packs, evalCase)
      return scorePackGroup(matchingPacks, taskIndex, evalCase)
    })
  }
  return packs.map((pack) => scorePackGroup([pack], taskIndex))
}

function buildTaskResults(index: TaskIndex, cases: TaskQualityExtractionCase[] | undefined): TaskQualityExtractionResult[] {
  if (cases?.length) {
    return cases.map((evalCase) => {
      const task = findMatchingTask(index.entries, evalCase)
      if (!task) {
        return {
          caseId: evalCase.caseId,
          taskId: evalCase.taskId ?? evalCase.caseId,
          title: evalCase.sourceName ?? evalCase.caseId,
          score: 0,
          status: "fail",
          failureReason: "未找到对应任务卡",
          recommendedFix: "确认任务是否进入 .llm-wiki/task-index.json，或检查任务源是否被正确排除。",
          evidenceRefs: [],
          missingElements: ["taskCard"],
        }
      }
      return scoreTask(task, evalCase)
    })
  }
  return index.entries.map((entry) => scoreTask(entry))
}

async function buildQueryResults(projectPath: string, cases: TaskQualityQueryCase[]): Promise<TaskQualityQueryResult[]> {
  const results: TaskQualityQueryResult[] = []
  for (const evalCase of cases) {
    const hits = await searchTaskCards(projectPath, evalCase.query, {
      includeNeedsReview: true,
      limit: 12,
      ...(evalCase.filters ?? {}),
    })
    results.push(scoreQuery(evalCase, hits))
  }
  return results
}

function taskExtractionCompletionSummary(ingestResults: TaskQualityIngestResult[]): string | null {
  const taskSources = ingestResults.filter((item) => item.expectedContribution === "task_cards")
  if (taskSources.length === 0) return null
  const completed = taskSources.filter((item) => item.taskExtractionComplete).length
  const rate = Math.round((completed / taskSources.length) * 100)
  const failedSources = taskSources
    .filter((item) => !item.taskExtractionComplete)
    .map((item) => `${item.sourceName}(candidates=${item.taskCandidateCount}, index=${item.indexedTaskCount})`)
  return failedSources.length > 0
    ? `任务源抽取完成率：${rate}%；未完成：${failedSources.join("、")}`
    : `任务源抽取完成率：${rate}%`
}

function mainProblemFromMissing(entries: TaskIndexEntry[], ingestResults: TaskQualityIngestResult[]): string {
  const completion = taskExtractionCompletionSummary(ingestResults)
  const missing = topMissingElements(entries, 5)
  const quality = missing.length === 0
    ? entries.length > 0 ? "任务卡核心要素较完整" : "当前任务索引为空"
    : `主要缺口：${missing.join("、")}`
  return completion ? `${completion}；${quality}` : quality
}

function buildLayerSummary(input: {
  ingestResults: TaskQualityIngestResult[]
  taskExtractionResults: TaskQualityExtractionResult[]
  queryResults: TaskQualityQueryResult[]
  taskIndex: TaskIndex
  qualityReport: ProjectQualityReportLike
  llmJudge?: LlmJudgeResponse | null
}): TaskQualityLlmJudgeReport["layerSummary"] {
  const ingestScore = input.llmJudge?.ingestScore ?? (
    input.ingestResults.length > 0
      ? average(input.ingestResults.map((item) => item.score))
      : clampScore(input.qualityReport.averageDocumentQualityScore ?? 0)
  )
  const extractionScore = input.llmJudge?.taskExtractionScore ?? (
    input.taskExtractionResults.length > 0
      ? average(input.taskExtractionResults.map((item) => item.score))
      : clampScore(input.qualityReport.taskSummary?.averageQualityScore ?? 0)
  )
  const queryScore = input.llmJudge?.queryQualityScore ?? average(input.queryResults.map((item) => item.score))
  const ingestProblems = input.ingestResults.filter((item) => item.status !== "pass").map((item) => item.failureReason)
  const queryProblems = input.queryResults.filter((item) => item.status !== "pass").map((item) => item.failureReason)
  const ingest = layer(ingestScore, ingestProblems[0] ?? "文档角色、结构和证据锚点基本可用")
  const taskExtraction = layer(extractionScore, mainProblemFromMissing(input.taskIndex.entries, input.ingestResults))
  const queryQuality = layer(queryScore, queryProblems[0] ?? "标准问题能通过任务索引召回并分组")
  const overall = layer(
    ingest.score * 0.3 + taskExtraction.score * 0.4 + queryQuality.score * 0.3,
    [ingest, taskExtraction, queryQuality].sort((a, b) => a.score - b.score)[0]?.mainProblem ?? "整体可用",
  )
  return { ingest, taskExtraction, queryQuality, overall }
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  return safeJsonParse<Record<string, unknown> | null>(raw.slice(start, end + 1), null)
}

async function runLlmJudgeIfAvailable(input: {
  llmConfig?: LlmConfig | null
  packs: TaskContextPack[]
  taskIndex: TaskIndex
  queryResults: TaskQualityQueryResult[]
  signal?: AbortSignal
}): Promise<{ skipped: boolean; response: LlmJudgeResponse | null; notes: string[] }> {
  if (!input.llmConfig || !hasUsableLlm(input.llmConfig)) {
    return { skipped: true, response: null, notes: ["LLM Judge skipped: no usable LLM config."] }
  }
  const compactContext = {
    docs: input.packs.map((pack) => ({
      sourceName: pack.sourceName,
      docRole: pack.docRole,
      taskCount: pack.taskCandidates?.length ?? 0,
      evidenceCount: pack.evidenceAnchors?.length ?? 0,
      warnings: pack.qualityWarnings ?? [],
    })).slice(0, 30),
    taskSummary: input.taskIndex.summary,
    tasks: input.taskIndex.entries.map((entry) => ({
      taskId: entry.taskId,
      title: entry.title,
      qualityScore: entry.qualityScore,
      qualityBand: entry.qualityBand,
      missingElements: entry.missingElements,
      sourceRefs: entry.sourceRefs.slice(0, 3),
    })).slice(0, 40),
    queries: input.queryResults.map((result) => ({
      caseId: result.caseId,
      query: result.query,
      score: result.score,
      ready: result.grouped.ready.count,
      needsReview: result.grouped.needsReview.count,
      failureReason: result.failureReason,
    })),
  }
  let content = ""
  let errorMessage: string | null = null
  await streamChat(
    input.llmConfig,
    [
      {
        role: "system",
        content: [
          "你是经营任务生成引擎的质量评测 Judge。",
          "只根据输入的结构化产物评分，不要假设 raw 原文内容。",
          "输出 JSON，字段：ingestScore, taskExtractionScore, queryQualityScore, notes。",
          "分数范围 0-100；notes 是中文字符串数组。",
        ].join("\n"),
      },
      { role: "user", content: JSON.stringify(compactContext, null, 2) },
    ],
    {
      onToken: (token) => { content += token },
      onDone: () => {},
      onError: (err) => { errorMessage = err.message },
    },
    input.signal,
    { temperature: 0.1 },
  )
  if (errorMessage) return { skipped: false, response: null, notes: [`LLM Judge failed: ${errorMessage}`] }
  const parsed = extractJsonObject(content)
  if (!parsed) return { skipped: false, response: null, notes: ["LLM Judge did not return parseable JSON."] }
  return {
    skipped: false,
    response: {
      ingestScore: typeof parsed.ingestScore === "number" ? parsed.ingestScore : undefined,
      taskExtractionScore: typeof parsed.taskExtractionScore === "number" ? parsed.taskExtractionScore : undefined,
      queryQualityScore: typeof parsed.queryQualityScore === "number" ? parsed.queryQualityScore : undefined,
      notes: Array.isArray(parsed.notes) ? parsed.notes.map((item) => String(item)) : undefined,
    },
    notes: Array.isArray(parsed.notes) ? parsed.notes.map((item) => String(item)) : ["LLM Judge completed."],
  }
}

function markdownTable(rows: string[][]): string {
  if (rows.length === 0) return ""
  const [head, ...body] = rows
  return [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.map((cell) => String(cell).replace(/\n/g, "<br/>")).join(" | ")} |`),
  ].join("\n")
}

export function renderTaskQualityScorecard(report: TaskQualityLlmJudgeReport): string {
  const layerRows = [
    ["Layer", "Score", "Status", "Main Problem"],
    ["Ingest", String(report.layerSummary.ingest.score), report.layerSummary.ingest.status, report.layerSummary.ingest.mainProblem],
    ["Task Extraction", String(report.layerSummary.taskExtraction.score), report.layerSummary.taskExtraction.status, report.layerSummary.taskExtraction.mainProblem],
    ["Query Quality", String(report.layerSummary.queryQuality.score), report.layerSummary.queryQuality.status, report.layerSummary.queryQuality.mainProblem],
    ["Overall", String(report.layerSummary.overall.score), report.layerSummary.overall.status, report.layerSummary.overall.mainProblem],
  ]
  const ingestRows = [
    ["Case", "Source", "Role", "Expected Contribution", "Actual Contribution", "Task Candidates", "Indexed Tasks", "Extraction Complete", "Contribution Status", "Score", "Status", "Failure Reason", "Recommended Fix", "Evidence Refs"],
    ...report.ingestResults.map((item) => [
      item.caseId,
      item.sourceName,
      item.docRole,
      item.expectedContribution ?? "n/a",
      item.actualContribution,
      String(item.taskCandidateCount),
      String(item.indexedTaskCount),
      item.taskExtractionComplete ? "yes" : "no",
      item.contributionStatus,
      String(item.score),
      item.status,
      item.failureReason,
      item.recommendedFix,
      item.evidenceRefs.join("<br/>"),
    ]),
  ]
  const taskRows = [
    ["Case", "Task", "Score", "Status", "Failure Reason", "Recommended Fix", "Evidence Refs"],
    ...report.taskExtractionResults.map((item) => [
      item.caseId,
      `${item.taskId}: ${item.title}`,
      String(item.score),
      item.status,
      item.failureReason,
      item.recommendedFix,
      item.evidenceRefs.join("<br/>"),
    ]),
  ]
  const queryRows = [
    ["Case", "Query", "Score", "Status", "Failure Reason", "Recommended Fix", "Evidence Refs"],
    ...report.queryResults.map((item) => [
      item.caseId,
      item.query,
      String(item.score),
      item.status,
      item.failureReason,
      item.recommendedFix,
      item.evidenceRefs.join("<br/>"),
    ]),
  ]
  return [
    "# 经营任务 LLM Judge 评测总表",
    "",
    `- Run ID：${report.runId}`,
    `- Generated At：${report.generatedAt}`,
    `- LLM Judge：${report.llmJudgeSkipped ? "skipped" : "enabled"}`,
    ...(report.llmJudgeNotes.length ? [`- Notes：${report.llmJudgeNotes.join("；")}`] : []),
    "",
    "## 总览",
    "",
    markdownTable(layerRows),
    "",
    "## Ingest 质量",
    "",
    markdownTable(ingestRows),
    "",
    "## 任务抽取质量",
    "",
    markdownTable(taskRows),
    "",
    "## 查询回答质量",
    "",
    markdownTable(queryRows),
    "",
  ].join("\n")
}

function renderTaskGroup(title: string, tasks: TaskSearchResult[]): string {
  return [
    `## ${title}`,
    "",
    ...(tasks.length
      ? tasks.map((hit, index) => {
        const task = hit.entry
        return [
          `### ${index + 1}. ${task.title}`,
          `- taskId：${task.taskId}`,
          `- owner：${task.ownerRole || "待确认"}`,
          `- module：${task.taskModuleLabel}`,
          `- time：${task.timeRange.label}`,
          `- quality：${task.qualityScore}/100；executable：${task.executableScore}/100`,
          `- missing：${task.missingElements.join("、") || "无"}`,
          `- source：${task.sourceRefs.join("；") || "暂无"}`,
          "",
        ].join("\n")
      })
      : ["- 暂无", ""]),
  ].join("\n")
}

export function renderTaskQualityQueryAnswers(report: TaskQualityLlmJudgeReport): string {
  return [
    "# 经营任务标准问题评测",
    "",
    ...report.queryResults.flatMap((item) => [
      `# ${item.query}`,
      "",
      `- Case：${item.caseId}`,
      `- Score：${item.score}/100（${item.status}）`,
      `- Failure Reason：${item.failureReason}`,
      `- Recommended Fix：${item.recommendedFix}`,
      "",
      renderTaskGroup("Ready", item.grouped.ready.tasks),
      renderTaskGroup("Needs Review", item.grouped.needsReview.tasks),
      "## Prompt Context",
      "",
      "```markdown",
      formatTaskCardsForPrompt(item.grouped.ordered),
      "```",
      "",
    ]),
  ].join("\n")
}

async function writeOutputs(projectPath: string, report: TaskQualityLlmJudgeReport): Promise<string> {
  const outputDir = `${projectPath}/.llm-wiki/evals/${report.runId}`
  await createDirectory(outputDir).catch(() => {})
  await writeFile(`${outputDir}/results.json`, JSON.stringify(report, null, 2))
  await writeFile(`${outputDir}/scorecard.md`, renderTaskQualityScorecard(report))
  await writeFile(`${outputDir}/query-answers.md`, renderTaskQualityQueryAnswers(report))
  return outputDir
}

export async function runTaskQualityLlmJudge(
  input: RunTaskQualityLlmJudgeInput,
): Promise<RunTaskQualityLlmJudgeResult> {
  const pp = normalizePath(input.projectPath)
  const runId = input.runId ?? input.cases.runId ?? defaultRunId()
  const generatedAt = input.generatedAt ?? new Date().toISOString()
  const [packs, taskIndex, qualityReport] = await Promise.all([
    loadTaskPacks(pp),
    loadTaskIndex(pp),
    readJsonIfPresent<ProjectQualityReportLike>(`${pp}/.llm-wiki/quality-report.json`, {}),
  ])
  const queryCases = input.cases.queryCases?.length ? input.cases.queryCases : DEFAULT_QUERY_CASES
  const ingestResults = buildIngestResults(packs, taskIndex, input.cases.ingestCases)
  const taskExtractionResults = buildTaskResults(taskIndex, input.cases.taskExtractionCases)
  const queryResults = await buildQueryResults(pp, queryCases)
  const llmJudge = await runLlmJudgeIfAvailable({
    llmConfig: input.llmConfig,
    packs,
    taskIndex,
    queryResults,
  })
  const layerSummary = buildLayerSummary({
    ingestResults,
    taskExtractionResults,
    queryResults,
    taskIndex,
    qualityReport,
    llmJudge: llmJudge.response,
  })
  const report: TaskQualityLlmJudgeReport = {
    schemaVersion: "task_quality_llm_judge_v1",
    runId,
    generatedAt,
    llmJudgeSkipped: llmJudge.skipped,
    llmJudgeNotes: llmJudge.notes,
    layerSummary,
    ingestResults,
    taskExtractionResults,
    queryResults,
  }
  const outputDir = await writeOutputs(pp, report)
  return { outputDir, report }
}

export async function loadTaskQualityJudgeCases(caseFilePath: string): Promise<TaskQualityJudgeCaseFile> {
  if (!(await fileExists(caseFilePath).catch(() => false))) {
    throw new Error(`Task quality judge cases file not found: ${caseFilePath}`)
  }
  const raw = await readFile(caseFilePath)
  const parsed = caseFilePath.endsWith(".json")
    ? JSON.parse(raw) as unknown
    : loadYaml(raw)
  return normalizeCaseFile(parsed)
}

export async function runTaskQualityLlmJudgeFromFile(
  projectPath: string,
  caseFilePath: string,
  options: RunTaskQualityLlmJudgeFromFileOptions = {},
): Promise<RunTaskQualityLlmJudgeResult> {
  const cases = await loadTaskQualityJudgeCases(caseFilePath)
  return runTaskQualityLlmJudge({
    projectPath,
    cases,
    llmConfig: options.llmConfig,
    runId: options.runId,
    generatedAt: options.generatedAt,
  })
}
