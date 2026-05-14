import { readFile } from "@/commands/fs"
import { streamChat } from "@/lib/llm-client"
import { buildLanguageDirective } from "@/lib/output-language"
import { normalizePath } from "@/lib/path-utils"
import { loadResearchSessions, saveResearchSession } from "@/lib/research-persist"
import { fetchResearchDocument, runResearchSearch } from "@/lib/research-backend"
import {
  buildOpportunityCardsFromReport,
  getResearchProfile,
  type ResearchProfile,
} from "@/lib/research-profiles"
import type {
  EnterResearchWorkbenchInput,
  OpportunityCard,
  ResearchFinding,
  ResearchFindingPromotionState,
  ResearchProviderStatus,
  ResearchReportSections,
  ResearchSession,
  ResearchSourceEvidence,
  ResearchThreadEntry,
  StructuredFollowUp,
} from "@/lib/research-types"
import { useResearchStore } from "@/stores/research-store"
import { useWikiStore, type LlmConfig, type SearchApiConfig } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"

function safeNowIso(): string {
  return new Date().toISOString()
}

const RESEARCH_REPORT_SYNTHESIS_TIMEOUT_MS = 90_000

class ResearchReportSynthesisError extends Error {
  constructor(
    message: string,
    readonly code: "stream_error" | "timeout" | "empty_report",
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "ResearchReportSynthesisError"
  }
}

function normalizeList(items: unknown, limit = 6): string[] {
  if (!Array.isArray(items)) return []
  return items
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit)
}

function makeSourceId(sessionId: string, index: number): string {
  return `${sessionId}-source-${index + 1}`
}

function makeFindingId(sessionId: string, index: number): string {
  return `${sessionId}-finding-${index + 1}`
}

function makeThreadEntryId(sessionId: string, index: number): string {
  return `${sessionId}-thread-${index + 1}`
}

async function readProjectContext(projectPath: string): Promise<{ purpose: string; overview: string; index: string }> {
  const pp = normalizePath(projectPath)
  const [purpose, overview, index] = await Promise.all([
    readFile(`${pp}/purpose.md`).catch(() => ""),
    readFile(`${pp}/wiki/overview.md`).catch(() => ""),
    readFile(`${pp}/wiki/index.md`).catch(() => ""),
  ])
  return { purpose, overview, index }
}

function getSession(sessionId: string): ResearchSession | null {
  return useResearchStore.getState().sessions.find((item) => item.sessionId === sessionId) ?? null
}

function updateSession(sessionId: string, updater: (session: ResearchSession) => ResearchSession): ResearchSession | null {
  const store = useResearchStore.getState()
  const session = getSession(sessionId)
  if (!session) return null
  const next = updater(session)
  store.updateSession(sessionId, next)
  return next
}

function effectiveFirecrawlKey(config: SearchApiConfig): string {
  return config.firecrawlApiKey?.trim() || config.runtimeFirecrawlApiKey?.trim() || ""
}

export function hasUsableResearchBackend(config: SearchApiConfig): boolean {
  const provider = config.researchProvider ?? "firecrawl"
  if (provider === "firecrawl") {
    return Boolean(effectiveFirecrawlKey(config))
  }
  if (provider === "tavily") {
    return Boolean(config.apiKey?.trim())
  }
  return false
}

function getProviderStatus(config: SearchApiConfig): ResearchProviderStatus {
  const provider = config.researchProvider ?? "firecrawl"
  if (provider === "firecrawl") {
    const key = effectiveFirecrawlKey(config)
    return key
      ? { provider: "firecrawl", degraded: false, detail: "当前研究会话优先使用 Firecrawl 搜索与整页抓取。" }
      : { provider: "firecrawl", degraded: true, detail: "当前研究后端设置为 Firecrawl，但还没有可用的 API Key。" }
  }
  if (provider === "tavily") {
    return config.apiKey?.trim()
      ? { provider: "tavily", degraded: true, detail: "当前研究会话使用 Tavily-only 模式，无法抓取完整网页正文。" }
      : { provider: "tavily", degraded: true, detail: "当前研究后端设置为 Tavily，但还没有可用的 API Key。" }
  }
  return { provider: "none", degraded: true, detail: "当前研究后端已禁用，无法执行外部研究。" }
}

function appendResearchThreadEntry(
  sessionId: string,
  input: Omit<ResearchThreadEntry, "entryId" | "sessionId" | "createdAt">,
): ResearchThreadEntry | null {
  const session = getSession(sessionId)
  if (!session) return null
  const entry: ResearchThreadEntry = {
    entryId: makeThreadEntryId(sessionId, session.thread.length),
    sessionId,
    createdAt: safeNowIso(),
    ...input,
  }
  useResearchStore.getState().appendThreadEntry(sessionId, entry)
  return entry
}

function syncSessionRuntime(
  sessionId: string,
  updates: {
    phase?: ResearchSession["phase"]
    status?: ResearchSession["status"]
    title?: string
    detail?: string
    currentQueries?: string[]
    completedArtifacts?: string[]
    followUpQuestions?: string[]
    learnings?: string[]
    providerStatus?: ResearchProviderStatus | null
    errorMessage?: string | null
    currentRound?: number
    maxDepth?: number
  },
): ResearchSession | null {
  const store = useResearchStore.getState()
  store.updateRuntime(sessionId, {
    phase: updates.phase,
    status: updates.status,
    title: updates.title,
    detail: updates.detail,
    currentQueries: updates.currentQueries,
    completedArtifacts: updates.completedArtifacts,
    followUpQuestions: updates.followUpQuestions,
    learnings: updates.learnings,
    providerStatus: updates.providerStatus,
    errorMessage: updates.errorMessage,
    currentRound: updates.currentRound,
    maxDepth: updates.maxDepth,
  })
  return updateSession(sessionId, (current) => ({
    ...current,
    phase: updates.phase ?? current.phase,
    status: updates.status ?? current.status,
    providerStatus: updates.providerStatus ?? current.providerStatus ?? null,
    currentRound: updates.currentRound ?? current.currentRound,
  }))
}

function buildBlockedDetail(config: SearchApiConfig): string {
  const provider = config.researchProvider ?? "firecrawl"
  if (provider === "firecrawl") {
    return "当前研究后端需要 Firecrawl API Key。请先到“设置 → 网页搜索”补充，或切到 Tavily-only 模式。"
  }
  if (provider === "tavily") {
    return "当前研究后端需要 Tavily API Key。请先到“设置 → 网页搜索”补充可用 key。"
  }
  return "当前研究后端已禁用，无法执行外部研究。请先在“设置 → 网页搜索”开启可用后端。"
}

function sourceFingerprint(source: Pick<ResearchSourceEvidence, "url" | "title" | "snippet">): string {
  return `${source.url}::${source.title}::${source.snippet.slice(0, 120)}`
}

function normalizeQueryList(queries: string[], limit: number): string[] {
  return Array.from(
    new Set(
      queries
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, limit)
}

function shouldStopRecursiveResearch(session: ResearchSession, roundIndex: number, newLearnings: string[]): boolean {
  if (roundIndex + 1 >= session.depth) return true
  if (session.pendingFollowUps.length === 0 && roundIndex > 0) return true
  return newLearnings.length === 0
}

function toPromotionState(state: ResearchFindingPromotionState): ResearchFindingPromotionState {
  return state
}

function markFindingPromotion(
  sessionId: string,
  findingId: string,
  promotionState: ResearchFindingPromotionState,
): ResearchSession | null {
  return updateSession(sessionId, (session) => ({
    ...session,
    findings: session.findings.map((finding) =>
      finding.findingId === findingId
        ? { ...finding, promotionState }
        : finding,
    ),
  }))
}

async function persistResearchSessionSnapshot(sessionId: string): Promise<void> {
  const session = getSession(sessionId)
  const projectPath = session?.projectPath || useWikiStore.getState().project?.path || ""
  if (!session || !projectPath) return
  const saved = await saveResearchSession(normalizePath(projectPath), session)
  useResearchStore.getState().updateSession(sessionId, saved)
}

function makeReportSynthesisErrorMessage(error: unknown): string {
  if (error instanceof ResearchReportSynthesisError) return error.message
  if (error instanceof Error && error.message.trim()) {
    return `研究报告生成失败：${error.message.trim()}`
  }
  return "研究报告生成失败：模型没有返回可用错误信息。"
}

function buildFallbackResearchReport(
  session: ResearchSession,
  options: {
    reason: string
    roundsCompleted: number
    degraded: boolean
  },
): string {
  const sourceLines = session.sources.length > 0
    ? session.sources
        .slice(0, 10)
        .map((source, index) => [
          `${index + 1}. ${source.title}`,
          source.url ? `   - URL：${source.url}` : "",
          source.learnedFacts.length > 0 ? `   - 已提炼信息：${source.learnedFacts.join("；")}` : "",
          source.reliabilityNote ? `   - 抓取状态：${source.reliabilityNote}` : "",
        ].filter(Boolean).join("\n"))
        .join("\n")
    : "- 暂无可用来源。"
  const learningLines = session.learnings.length > 0
    ? session.learnings.slice(0, 16).map((item) => `- ${item}`).join("\n")
    : "- 暂无可用提炼信息。"
  const followUpLines = session.pendingFollowUps.length > 0
    ? session.pendingFollowUps
        .slice(0, 8)
        .map((item) => `- ${item.followUpQuestion}${item.reason ? `（原因：${item.reason}）` : ""}`)
        .join("\n")
    : "- 暂无待追问分支。"

  return [
    "# 研究报告生成兜底草案",
    "",
    "模型报告合成阶段没有正常完成，系统已把当前已经抓取和提炼的证据保存为兜底草案，避免本轮研究停在不可观测状态。",
    "",
    "## 研究问题",
    session.topic,
    "",
    "## 当前状态",
    `- 失败阶段：生成研究报告`,
    `- 失败原因：${options.reason}`,
    `- 已完成轮次：${options.roundsCompleted}/${session.depth}`,
    `- 来源数量：${session.sources.length}`,
    `- 已提炼信息数量：${session.learnings.length}`,
    `- 是否存在降级抓取：${options.degraded ? "是" : "否"}`,
    "",
    "## 已提炼信息",
    learningLines,
    "",
    "## 证据来源",
    sourceLines,
    "",
    "## 未解决问题",
    followUpLines,
    "",
    "## 可带入业务修订的建议",
    "- 当前报告是兜底草案，建议先检查模型配置、网络状态或切换更快模型后重试报告生成。",
    "- 已抓取来源和 learnings 已保留，可作为下一次重试的基础证据。",
  ].join("\n")
}

async function markResearchReportSynthesisFailed(
  sessionId: string,
  projectPath: string,
  error: unknown,
  options: {
    degraded: boolean
    roundsCompleted: number
    providerStatus: ResearchProviderStatus
  },
): Promise<void> {
  const reason = makeReportSynthesisErrorMessage(error)
  const current = getSession(sessionId)
  if (!current) return
  const fallbackReport = buildFallbackResearchReport(current, {
    reason,
    degraded: options.degraded,
    roundsCompleted: options.roundsCompleted,
  })
  const reportSections = parseResearchReportSectionsForProfile(
    fallbackReport,
    getResearchProfile(current.taskType ?? "generic_research"),
  )

  appendResearchThreadEntry(sessionId, {
    phase: "synthesize_report",
    kind: "error",
    title: "研究报告生成失败，已保存兜底草案",
    detail: reason,
    data: {
      stage: "synthesize_report",
      roundsCompleted: options.roundsCompleted,
      fallbackReport: true,
      errorCode: error instanceof ResearchReportSynthesisError ? error.code : "unknown",
    },
  })

  const failed = updateSession(sessionId, (session) => ({
    ...session,
    status: "error",
    phase: "synthesize_report",
    reportMarkdown: fallbackReport,
    reportSections,
    errorMessage: reason,
    providerStatus: {
      provider: options.providerStatus.provider,
      degraded: true,
      detail: reason,
    },
    runtime: {
      ...session.runtime,
      phase: "synthesize_report",
      status: "error",
      title: "研究报告生成失败",
      detail: "报告合成阶段没有正常完成，系统已保存兜底草案和失败原因，可以调整模型或稍后重试。",
      errorMessage: reason,
      canResume: true,
      completedArtifacts: Array.from(new Set([
        ...session.runtime.completedArtifacts,
        "已保存来源证据",
        "已保存报告兜底草案",
        "报告合成失败原因已记录",
      ])),
      currentRound: options.roundsCompleted,
      maxDepth: session.depth,
      providerStatus: {
        provider: options.providerStatus.provider,
        degraded: true,
        detail: reason,
      },
    },
  }))
  if (failed) {
    const saved = await saveResearchSession(normalizePath(projectPath), failed)
    useResearchStore.getState().updateSession(sessionId, saved)
  }
}

export function enterResearchWorkbench(input?: EnterResearchWorkbenchInput): string {
  return useResearchStore.getState().enterResearchWorkbench(input)
}

export async function restoreResearchSessions(projectPath: string): Promise<void> {
  const sessions = await loadResearchSessions(projectPath)
  useResearchStore.getState().setSessions(sessions)
}

export async function submitResearchClarification(
  sessionId: string,
  projectPath: string,
  answer: string,
): Promise<void> {
  useResearchStore.getState().answerFollowUp(sessionId, answer)
  appendResearchThreadEntry(sessionId, {
    phase: "clarify_scope",
    kind: "clarification_answered",
    title: "已收到研究澄清",
    detail: answer.trim(),
    data: { answer: answer.trim() },
  })
  const session = getSession(sessionId)
  if (!session) return
  const next = {
    ...session,
    notesMarkdown: `${session.notesMarkdown}\n- ${safeNowIso()} 澄清回答：${answer}`.trim(),
  }
  const saved = await saveResearchSession(projectPath, next)
  useResearchStore.getState().updateSession(sessionId, saved)
  await runDeepResearchSession(sessionId, projectPath)
}

export async function continueResearchSession(sessionId: string, projectPath: string): Promise<void> {
  const session = getSession(sessionId)
  if (!session) return
  const pp = normalizePath(projectPath)
  const saved = await saveResearchSession(pp, session)
  useResearchStore.getState().updateSession(sessionId, saved)
  await runDeepResearchSession(sessionId, projectPath)
}

export async function skipResearchClarification(sessionId: string, projectPath: string): Promise<void> {
  appendResearchThreadEntry(sessionId, {
    phase: "clarify_scope",
    kind: "clarification_answered",
    title: "跳过澄清，直接开始研究",
    detail: "专家选择跳过澄清问题，直接进入研究主链。",
    data: { skipped: true },
  })
  const session = getSession(sessionId)
  if (!session) return
  const next = {
    ...session,
    notesMarkdown: `${session.notesMarkdown}\n- ${safeNowIso()} 跳过澄清，直接开始研究。`.trim(),
  }
  const saved = await saveResearchSession(projectPath, next)
  useResearchStore.getState().updateSession(sessionId, saved)
  await runDeepResearchSession(sessionId, projectPath)
}

export async function promoteResearchFindingToRevision(
  sessionId: string,
  findingId: string,
): Promise<ResearchFinding | null> {
  const session = getSession(sessionId)
  const finding = session?.findings.find((item) => item.findingId === findingId) ?? null
  if (!session || !finding) return null
  markFindingPromotion(sessionId, findingId, toPromotionState("promoted_to_revision"))
  appendResearchThreadEntry(sessionId, {
    phase: session.phase,
    kind: "finding_promoted",
    title: `候选结论已加入业务修订：${finding.title}`,
    detail: finding.summary || finding.evidenceSummary || "已把这条候选结论带入业务修订闭环。",
    findingId,
    data: { action: "promoted_to_revision", linkedDocId: finding.linkedDocId ?? null },
  })
  await persistResearchSessionSnapshot(sessionId)
  return getSession(sessionId)?.findings.find((item) => item.findingId === findingId) ?? finding
}

export async function promoteResearchFindingToWikiDraft(
  sessionId: string,
  findingId: string,
): Promise<ResearchFinding | null> {
  const session = getSession(sessionId)
  const finding = session?.findings.find((item) => item.findingId === findingId) ?? null
  if (!session || !finding) return null
  markFindingPromotion(sessionId, findingId, toPromotionState("promoted_to_wiki_draft"))
  appendResearchThreadEntry(sessionId, {
    phase: session.phase,
    kind: "finding_promoted",
    title: `候选结论已加入知识页草案：${finding.title}`,
    detail: finding.summary || "这条候选结论已加入知识页草案收件箱，等待人工确认。",
    findingId,
    data: { action: "promoted_to_wiki_draft" },
  })
  await persistResearchSessionSnapshot(sessionId)
  return getSession(sessionId)?.findings.find((item) => item.findingId === findingId) ?? finding
}

export async function createRevisionTaskFromResearchFinding(
  sessionId: string,
  findingId: string,
): Promise<ResearchFinding | null> {
  const session = getSession(sessionId)
  const finding = session?.findings.find((item) => item.findingId === findingId) ?? null
  if (!session || !finding) return null
  useReviewStore.getState().addItem({
    type: "suggestion",
    title: `研究候选修订：${finding.title}`,
    description: `${finding.summary}\n\n研究依据：${finding.evidenceSummary}`,
    options: [
      { label: "打开深度研究", action: "goto-research-mode" },
      ...(finding.linkedDocId ? [{ label: "回到原文修订", action: "goto-agent-mode" }] : []),
    ],
    origin: "agent_mode",
    linkedDocId: finding.linkedDocId ?? null,
    researchSessionId: session.sessionId,
    researchFindingId: finding.findingId,
    researchEvidenceSummary: finding.evidenceSummary,
    researchSourceUrls: finding.sourceUrls,
    targetFieldKey: finding.targetFieldKey ?? null,
  })
  markFindingPromotion(sessionId, findingId, toPromotionState("promoted_to_review"))
  appendResearchThreadEntry(sessionId, {
    phase: session.phase,
    kind: "finding_promoted",
    title: `候选结论已生成修订任务：${finding.title}`,
    detail: finding.summary || "这条候选结论已进入 review 收件箱，等待人工进入业务修订。",
    findingId,
    data: { action: "promoted_to_review" },
  })
  await persistResearchSessionSnapshot(sessionId)
  return getSession(sessionId)?.findings.find((item) => item.findingId === findingId) ?? finding
}

export async function createReviewTaskFromOpportunityCard(
  sessionId: string,
  cardId: string,
): Promise<OpportunityCard | null> {
  const session = getSession(sessionId)
  const card = session?.opportunityCards?.find((item) => item.cardId === cardId) ?? null
  if (!session || !card) return null
  useReviewStore.getState().addItem({
    type: "suggestion",
    title: `商机候选：${card.title}`,
    description: [
      `机会假设：${card.opportunityHypothesis}`,
      `目标客群：${card.targetSegment}`,
      `痛点：${card.painPoint}`,
      `研究依据：${card.evidenceSummary}`,
      card.risks.length > 0 ? `风险与缺口：${card.risks.join("；")}` : "",
      card.validationExperiments.length > 0 ? `建议验证：${card.validationExperiments.join("；")}` : "",
    ].filter(Boolean).join("\n\n"),
    options: [
      { label: "打开深度研究", action: "goto-research-mode" },
      { label: "进入策略工作台", action: "goto-strategy-mode" },
    ],
    origin: "wiki_lint",
    linkedDocId: card.linkedDocId ?? null,
    researchSessionId: session.sessionId,
    researchFindingId: card.cardId,
    researchEvidenceSummary: card.evidenceSummary,
    researchSourceUrls: card.sourceUrls,
    targetFieldKey: card.targetFieldKey ?? null,
  })
  updateSession(sessionId, (current) => ({
    ...current,
    opportunityCards: (current.opportunityCards ?? []).map((item) =>
      item.cardId === cardId ? { ...item, status: "promoted_to_review" } : item,
    ),
  }))
  appendResearchThreadEntry(sessionId, {
    phase: session.phase,
    kind: "finding_promoted",
    title: `机会卡已生成评审任务：${card.title}`,
    detail: card.opportunityHypothesis,
    findingId: card.cardId,
    data: { action: "opportunity_promoted_to_review" },
  })
  await persistResearchSessionSnapshot(sessionId)
  return getSession(sessionId)?.opportunityCards?.find((item) => item.cardId === cardId) ?? card
}

export async function runDeepResearchSession(sessionId: string, projectPath: string): Promise<void> {
  const session = getSession(sessionId)
  if (!session) return
  const profile = getResearchProfile(session.taskType ?? "generic_research")
  const llmConfig = useWikiStore.getState().llmConfig
  const searchConfig = useWikiStore.getState().searchApiConfig
  const pp = normalizePath(projectPath)
  const providerStatus = getProviderStatus(searchConfig)
  const context = await readProjectContext(pp)

  syncSessionRuntime(sessionId, {
    phase: "clarify_scope",
    status: "running",
    title: "进入深度研究",
    detail: "正在结合项目背景和你的补充，准备研究范围与问题。",
    providerStatus,
    currentRound: 0,
    maxDepth: session.depth,
  })

  const clarifications = await generateClarificationQuestions(session, context, llmConfig, profile)
  const canUseSeededQueries = Array.isArray(session.plannedQueries) && session.plannedQueries.length > 0
  const shouldPauseForInput = session.userAnswers.length === 0 && clarifications.length > 0 && !canUseSeededQueries
  appendResearchThreadEntry(sessionId, {
    phase: "clarify_scope",
    kind: "clarification_requested",
    title: "已生成研究澄清问题",
    detail: clarifications.join("\n"),
    data: { questions: clarifications },
  })

  let working = updateSession(sessionId, (current) => ({
    ...current,
    followUpQuestions: clarifications,
    status: shouldPauseForInput ? "needs_input" : "running",
    phase: shouldPauseForInput ? "clarify_scope" : "plan_queries",
    providerStatus,
    runtime: {
      ...current.runtime,
      phase: shouldPauseForInput ? "clarify_scope" : "plan_queries",
      status: shouldPauseForInput ? "needs_input" : "running",
      title: shouldPauseForInput ? "等待研究澄清" : "规划研究路线",
      detail: shouldPauseForInput
        ? "当前正在等待你的澄清，研究尚未继续。你可以补充范围，也可以直接跳过。"
        : "正在把研究问题展开成可执行的搜索与抓取计划。",
      followUpQuestions: clarifications,
      providerStatus,
      currentRound: 0,
      maxDepth: current.depth,
    },
  }))

  if (!working) return
  working = await saveResearchSession(pp, working)
  useResearchStore.getState().updateSession(sessionId, working)

  if (shouldPauseForInput) {
    return
  }

  if (providerStatus.provider === "none") {
    syncSessionRuntime(sessionId, {
      phase: "plan_queries",
      status: "blocked",
      title: "研究已阻塞",
      detail: buildBlockedDetail(searchConfig),
      providerStatus,
      errorMessage: null,
    })
    appendResearchThreadEntry(sessionId, {
      phase: "plan_queries",
      kind: "error",
      title: "研究已阻塞",
      detail: buildBlockedDetail(searchConfig),
      data: { reason: "provider_disabled" },
    })
    const blocked = getSession(sessionId)
    if (blocked) {
      const saved = await saveResearchSession(pp, blocked)
      useResearchStore.getState().updateSession(sessionId, saved)
    }
    return
  }

  const queryLimit = Math.max(4, working.breadth * 2)
  const seededQueries = normalizeQueryList(working.plannedQueries, queryLimit)
  const generatedQueries = seededQueries.length >= Math.max(working.breadth, 2)
    ? []
    : await generatePlannedQueries(working, context, llmConfig, profile)
  const initialQueries = normalizeQueryList([...seededQueries, ...generatedQueries], queryLimit)
  appendResearchThreadEntry(sessionId, {
    phase: "plan_queries",
    kind: "queries_planned",
    title: "已规划首轮研究查询",
    detail: initialQueries.join("\n"),
    data: {
      round: 0,
      queries: initialQueries,
      seededQueries,
      generatedQueries,
    },
  })

  let currentQueries = initialQueries
  let roundIndex = 0
  let degraded = providerStatus.degraded
  let blockedReason: string | null = null
  let allSources: ResearchSourceEvidence[] = [...working.sources]
  let allLearnings: string[] = [...working.learnings]
  let pendingFollowUps: StructuredFollowUp[] = []
  const seenFingerprints = new Set(allSources.map(sourceFingerprint))

  while (roundIndex < working.depth && currentQueries.length > 0) {
    working = syncSessionRuntime(sessionId, {
      phase: "search_sources",
      status: "running",
      title: roundIndex === 0 ? "搜索与抓取来源" : `继续研究第 ${roundIndex + 1} 轮`,
      detail: `正在执行第 ${roundIndex + 1} 轮研究，优先搜索并抓取最相关的来源。`,
      currentQueries,
      providerStatus,
      currentRound: roundIndex + 1,
      maxDepth: working.depth,
    })
    if (!working) return

    const roundEvidence: ResearchSourceEvidence[] = []
    const roundLearnings: string[] = []
    const cappedQueries = currentQueries.slice(0, Math.max(working.breadth, 2))

    for (const query of cappedQueries) {
      appendResearchThreadEntry(sessionId, {
        phase: "search_sources",
        kind: "search_started",
        title: `开始搜索：${query}`,
        detail: `第 ${roundIndex + 1} 轮研究正在搜索这个问题。`,
        query,
        data: { round: roundIndex + 1 },
      })
      const searchResult = await runResearchSearch(query, searchConfig, 4)
      degraded = degraded || searchResult.degraded
      working = updateSession(sessionId, (current) => ({
        ...current,
        visitedQueries: current.visitedQueries.includes(query)
          ? current.visitedQueries
          : [...current.visitedQueries, query],
        providerStatus: {
          provider: searchResult.provider,
          degraded: searchResult.degraded,
          detail: searchResult.detail,
        },
      }))
      if (!working) return

      if (searchResult.blocked) {
        blockedReason = searchResult.detail
        appendResearchThreadEntry(sessionId, {
          phase: "search_sources",
          kind: "error",
          title: "研究后端当前不可用",
          detail: searchResult.detail,
          query,
          data: { provider: searchResult.provider },
        })
        break
      }

      if (searchResult.degraded) {
        appendResearchThreadEntry(sessionId, {
          phase: "search_sources",
          kind: "degraded",
          title: "研究后端已降级",
          detail: searchResult.detail,
          query,
          data: { provider: searchResult.provider },
        })
      }

      for (const [resultIndex, result] of searchResult.results.slice(0, 2).entries()) {
        appendResearchThreadEntry(sessionId, {
          phase: "search_sources",
          kind: "search_result_selected",
          title: `选中来源：${result.title}`,
          detail: result.snippet || result.url,
          query,
          url: result.url,
          data: { rank: resultIndex + 1, source: result.source },
        })
        const fetched = await fetchResearchDocument(result.url, result.title, searchConfig)
        degraded = degraded || fetched.degraded
        if (fetched.blocked) {
          blockedReason = fetched.detail
          appendResearchThreadEntry(sessionId, {
            phase: "search_sources",
            kind: "error",
            title: `无法抓取来源：${result.title}`,
            detail: fetched.detail,
            query,
            url: result.url,
            data: { provider: fetched.provider },
          })
          continue
        }
        if (fetched.degraded) {
          appendResearchThreadEntry(sessionId, {
            phase: "search_sources",
            kind: "degraded",
            title: `来源抓取已降级：${result.title}`,
            detail: fetched.detail,
            query,
            url: result.url,
            data: { provider: fetched.provider },
          })
        }
        const evidence = await summarizeSourceEvidence(
          working,
          query,
          result,
          fetched.markdown,
          fetched.detail,
          llmConfig,
          profile,
          allSources.length + roundEvidence.length,
        )
        const fingerprint = sourceFingerprint(evidence)
        if (seenFingerprints.has(fingerprint)) {
          continue
        }
        seenFingerprints.add(fingerprint)
        roundEvidence.push(evidence)
        roundLearnings.push(...evidence.learnedFacts)
        useResearchStore.getState().appendSourceEvidence(sessionId, evidence)
        appendResearchThreadEntry(sessionId, {
          phase: "extract_learnings",
          kind: "source_fetched",
          title: `已抓取来源：${evidence.title}`,
          detail: evidence.reliabilityNote ?? evidence.snippet,
          query,
          url: evidence.url,
          data: { learnedFacts: evidence.learnedFacts, openFollowUps: evidence.openFollowUps },
        })
        for (const learning of evidence.learnedFacts.slice(0, 4)) {
          appendResearchThreadEntry(sessionId, {
            phase: "extract_learnings",
            kind: "learning_extracted",
            title: `提炼有效信息：${evidence.title}`,
            detail: learning,
            query,
            url: evidence.url,
            data: { sourceId: evidence.id },
          })
        }
      }
    }

    if (blockedReason) {
      break
    }

    allSources = [...allSources, ...roundEvidence]
    const dedupRoundLearnings = Array.from(new Set(roundLearnings.filter(Boolean)))
    const nextLearnings = Array.from(new Set([...allLearnings, ...dedupRoundLearnings])).slice(0, 32)
    allLearnings = nextLearnings
    useResearchStore.getState().appendLearnings(sessionId, dedupRoundLearnings)

    pendingFollowUps = await generateBranchFollowUps(working, dedupRoundLearnings, llmConfig, profile)
    appendResearchThreadEntry(sessionId, {
      phase: "branch_followups",
      kind: "followup_generated",
      title: `已生成第 ${roundIndex + 1} 轮后续追问`,
      detail: pendingFollowUps.map((item) => `${item.followUpQuestion}（${item.reason}）`).join("\n"),
      data: { followUps: pendingFollowUps },
    })

    working = updateSession(sessionId, (current) => ({
      ...current,
      sources: allSources,
      learnings: allLearnings,
      pendingFollowUps,
      currentRound: roundIndex + 1,
      providerStatus: {
        provider: providerStatus.provider,
        degraded,
        detail: degraded
          ? "研究已继续推进，但部分来源抓取或后端能力已降级。"
          : "研究正在按完整后端能力继续推进。",
      },
      runtime: {
        ...current.runtime,
        phase: "branch_followups",
        status: "running",
        title: "继续追问分支",
        detail: degraded
          ? "研究已继续推进，但部分来源抓取已降级，当前主要依据搜索摘要与可用正文。"
          : "正在根据已提炼的信息继续生成需要追问的分支问题。",
        followUpQuestions: pendingFollowUps.map((item) => item.followUpQuestion),
        learnings: allLearnings,
        currentRound: roundIndex + 1,
        maxDepth: current.depth,
        providerStatus: {
          provider: providerStatus.provider,
          degraded,
          detail: degraded
            ? "部分证据抓取已降级。"
            : "当前研究后端工作正常。",
        },
      },
    }))
    if (!working) return

    if (shouldStopRecursiveResearch(working, roundIndex, dedupRoundLearnings)) {
      break
    }

    const nextQueries = pendingFollowUps
      .map((item) => item.followUpQuestion.trim())
      .filter((item) => item.length > 0 && !getSession(sessionId)?.visitedQueries.includes(item))
      .slice(0, Math.max(working.breadth, 2))
    currentQueries = nextQueries
    roundIndex += 1
  }

  if (blockedReason) {
    syncSessionRuntime(sessionId, {
      phase: "search_sources",
      status: "blocked",
      title: "研究已阻塞",
      detail: blockedReason,
      currentRound: roundIndex + 1,
      maxDepth: working.depth,
      providerStatus: {
        provider: providerStatus.provider,
        degraded: true,
        detail: blockedReason,
      },
      errorMessage: null,
    })
    const blocked = getSession(sessionId)
    if (blocked) {
      const saved = await saveResearchSession(pp, blocked)
      useResearchStore.getState().updateSession(sessionId, saved)
    }
    return
  }

  if (allSources.length === 0) {
    syncSessionRuntime(sessionId, {
      phase: "search_sources",
      status: "blocked",
      title: "研究没有拿到可用来源",
      detail: "当前搜索已经跑完，但没有拿到可以继续综合的有效来源。你可以补充更具体的研究范围，再重跑一轮。",
      currentRound: roundIndex + 1,
      maxDepth: working.depth,
      providerStatus: {
        provider: providerStatus.provider,
        degraded,
        detail: "搜索已完成，但没有可用来源。",
      },
    })
    appendResearchThreadEntry(sessionId, {
      phase: "search_sources",
      kind: "error",
      title: "研究没有拿到可用来源",
      detail: "当前搜索已经跑完，但没有拿到可以继续综合的有效来源。",
      data: { currentRound: roundIndex + 1 },
    })
    const blocked = getSession(sessionId)
    if (blocked) {
      const saved = await saveResearchSession(pp, blocked)
      useResearchStore.getState().updateSession(sessionId, saved)
    }
    return
  }

  working = syncSessionRuntime(sessionId, {
    phase: "synthesize_report",
    status: "running",
    title: "生成研究报告",
    detail: "正在综合多轮研究结果、来源证据和未解决问题，生成可读报告与候选结论。",
    currentRound: roundIndex + 1,
    maxDepth: working.depth,
    providerStatus: {
      provider: providerStatus.provider,
      degraded,
      detail: degraded
        ? "当前报告包含降级抓取得到的证据。"
        : "当前报告基于完整搜索与抓取结果生成。",
    },
  })
  if (!working) return

  appendResearchThreadEntry(sessionId, {
    phase: "synthesize_report",
    kind: "report_started",
    title: "开始生成研究报告",
    detail: "已进入报告合成阶段，正在调用模型综合来源证据、已提炼信息和待追问问题。",
    data: { roundsCompleted: roundIndex + 1, sourceCount: allSources.length, learningCount: allLearnings.length },
  })
  await persistResearchSessionSnapshot(sessionId)

  let lastReportProgressAt = 0
  let lastReportedChars = 0
  let reportedFirstToken = false
  let progressThreadWritten = false
  let reportMarkdown = ""
  const reportMaxDepth = working.depth
  try {
    reportMarkdown = await synthesizeResearchReport(working, context, llmConfig, profile, {
      degraded,
      blockedReason: null,
      roundsCompleted: roundIndex + 1,
      timeoutMs: RESEARCH_REPORT_SYNTHESIS_TIMEOUT_MS,
      onProgress: async ({ receivedChars }) => {
        const now = Date.now()
        if (
          reportedFirstToken &&
          now - lastReportProgressAt < 3000 &&
          receivedChars - lastReportedChars < 800
        ) {
          return
        }
        reportedFirstToken = true
        lastReportProgressAt = now
        lastReportedChars = receivedChars
        syncSessionRuntime(sessionId, {
          phase: "synthesize_report",
          status: "running",
          title: "生成研究报告",
          detail: `模型已开始输出研究报告，当前已收到约 ${receivedChars.toLocaleString()} 字。`,
          currentRound: roundIndex + 1,
          maxDepth: reportMaxDepth,
        })
        if (!progressThreadWritten && receivedChars > 0) {
          progressThreadWritten = true
          appendResearchThreadEntry(sessionId, {
            phase: "synthesize_report",
            kind: "report_progress",
            title: "报告合成已有输出",
            detail: `模型已返回约 ${receivedChars.toLocaleString()} 字，正在继续接收完整报告。`,
            data: { receivedChars },
          })
          await persistResearchSessionSnapshot(sessionId)
        }
      },
    })
  } catch (error) {
    await markResearchReportSynthesisFailed(sessionId, pp, error, {
      degraded,
      roundsCompleted: roundIndex + 1,
      providerStatus,
    })
    return
  }
  const reportSections = parseResearchReportSectionsForProfile(reportMarkdown, profile)
  appendResearchThreadEntry(sessionId, {
    phase: "synthesize_report",
    kind: "report_generated",
    title: "研究报告已生成",
    detail: reportSections.parsed ? "报告已按结构化章节完成拆分。" : "报告已生成，但章节解析失败，将回退为正常阅读态。",
    data: { parsedSections: reportSections.parsed, roundsCompleted: roundIndex + 1 },
  })

  const findings = await extractResearchFindings(working, reportMarkdown, llmConfig, profile)
  const opportunityCards = profile.taskType === "market_opportunity_analysis"
    ? buildOpportunityCardsFromReport(working, reportMarkdown)
    : []
  opportunityCards.forEach((card) => {
    appendResearchThreadEntry(sessionId, {
      phase: "save_research_asset",
      kind: "finding_extracted",
      title: `已生成机会卡：${card.title}`,
      detail: card.opportunityHypothesis,
      findingId: card.cardId,
      data: { kind: "opportunity_card", confidence: card.confidence },
    })
  })
  findings.forEach((finding) => {
    appendResearchThreadEntry(sessionId, {
      phase: "save_research_asset",
      kind: "finding_extracted",
      title: `已提炼候选结论：${finding.title}`,
      detail: finding.summary || finding.evidenceSummary,
      findingId: finding.findingId,
      data: { kind: finding.kind, targetFieldKey: finding.targetFieldKey ?? null },
    })
  })

  working = updateSession(sessionId, (current) => ({
    ...current,
    reportMarkdown,
    reportSections,
    findings,
    opportunityCards,
    sources: allSources,
    learnings: allLearnings,
    pendingFollowUps,
    phase: "save_research_asset",
    status: "running",
    providerStatus: {
      provider: providerStatus.provider,
      degraded,
      detail: degraded
        ? "研究报告已生成，但部分来源抓取降级为搜索摘要。"
        : "研究报告、来源与候选结论已全部准备好。",
    },
    runtime: {
      ...current.runtime,
      phase: "save_research_asset",
      status: "running",
      title: "保存研究档案",
      detail: "正在把研究报告、来源证据和会话快照写入研究档案层。",
      completedArtifacts: degraded
        ? ["已保存研究线程", "已保存来源证据", "已生成候选结论", ...(opportunityCards.length > 0 ? ["已生成机会卡"] : []), "证据抓取已降级"]
        : ["已保存研究线程", "已保存来源证据", "已生成候选结论", ...(opportunityCards.length > 0 ? ["已生成机会卡"] : [])],
      currentRound: roundIndex + 1,
      maxDepth: current.depth,
      providerStatus: {
        provider: providerStatus.provider,
        degraded,
        detail: degraded
          ? "部分来源抓取降级为搜索摘要。"
          : "研究报告已基于完整证据生成。",
      },
    },
  }))
  if (!working) return

  working = await saveResearchSession(pp, working)
  useResearchStore.getState().updateSession(sessionId, working)
  useResearchStore.getState().appendFindings(sessionId, findings)

  useResearchStore.getState().updateSession(sessionId, {
    status: "done",
    phase: "save_research_asset",
    runtime: {
      ...working.runtime,
      status: "done",
      title: "研究已完成",
      detail: degraded
        ? "研究报告已生成，但部分网页证据抓取降级为搜索摘要。"
        : "研究报告、来源与候选结论已全部准备好。",
      canResume: true,
    },
  })
  const finished = getSession(sessionId)
  if (finished) {
    const saved = await saveResearchSession(pp, finished)
    useResearchStore.getState().updateSession(sessionId, saved)
  }
}

export function parseResearchReportSections(reportMarkdown: string): ResearchReportSections {
  return parseResearchReportSectionsForProfile(reportMarkdown, getResearchProfile("generic_research"))
}

function parseResearchReportSectionsForProfile(
  reportMarkdown: string,
  profile: ResearchProfile,
): ResearchReportSections {
  const normalized = reportMarkdown.trim()
  if (!normalized) {
    return { parsed: false, sections: [] }
  }
  const headingRegex = /^##\s+(.+)$/gm
  const matches = Array.from(normalized.matchAll(headingRegex))
  if (matches.length === 0) {
    return { parsed: false, sections: [] }
  }

  const sections = profile.reportSections.map((spec) => {
    const idx = matches.findIndex((match) => match[1].trim() === spec.title)
    if (idx === -1) {
      return { key: spec.key, title: spec.title, content: "" }
    }
    const start = (matches[idx].index ?? 0) + matches[idx][0].length
    const end = idx + 1 < matches.length ? (matches[idx + 1].index ?? normalized.length) : normalized.length
    return {
      key: spec.key,
      title: spec.title,
      content: normalized.slice(start, end).trim(),
    }
  })
  const parsed = sections.some((section) => section.content.length > 0)
  return { parsed, sections }
}

async function generateClarificationQuestions(
  session: ResearchSession,
  context: { purpose: string; overview: string; index: string },
  llmConfig: LlmConfig,
  profile: ResearchProfile,
): Promise<string[]> {
  let result = ""
  await streamChat(
    llmConfig,
    [
      {
        role: "system",
        content: [
          ...profile.buildClarificationSystemPrompt(session),
          buildLanguageDirective(session.topic),
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `研究主题：${session.topic}`,
          session.businessContext ? `业务背景：${session.businessContext}` : "",
          session.targetMarket ? `目标市场：${session.targetMarket}` : "",
          session.targetAudience ? `目标客群：${session.targetAudience}` : "",
          session.constraints ? `已知约束：${session.constraints}` : "",
          session.triggerSource ? `触发来源：${session.triggerSource}` : "",
          context.purpose ? `项目目标：\n${context.purpose}` : "",
          context.overview ? `知识总览：\n${context.overview}` : "",
        ].filter(Boolean).join("\n\n"),
      },
    ],
    {
      onToken: (token) => { result += token },
      onDone: () => {},
      onError: () => {},
    },
  )
  try {
    const parsed = JSON.parse(result) as unknown
    const questions = normalizeList(parsed, 3)
    if (questions.length > 0) {
      return questions
    }
  } catch {
    // fall through
  }
  return [
    "这轮研究最希望补足的业务判断是什么？",
    "需要重点围绕哪些对象、动作、指标或人群来展开？",
  ]
}

async function generatePlannedQueries(
  session: ResearchSession,
  context: { purpose: string; overview: string; index: string },
  llmConfig: LlmConfig,
  profile: ResearchProfile,
): Promise<string[]> {
  let result = ""
  await streamChat(
    llmConfig,
    [
      {
        role: "system",
        content: [
          ...profile.buildQuerySystemPrompt(session),
          buildLanguageDirective(session.topic),
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `研究主题：${session.topic}`,
          session.businessContext ? `业务背景：${session.businessContext}` : "",
          session.targetMarket ? `目标市场：${session.targetMarket}` : "",
          session.targetAudience ? `目标客群：${session.targetAudience}` : "",
          session.constraints ? `已知约束：${session.constraints}` : "",
          `breadth：${session.breadth}`,
          `depth：${session.depth}`,
          session.focus ? `焦点：${session.focus}` : "",
          session.userAnswers.length > 0 ? `专家补充：\n${session.userAnswers.join("\n")}` : "",
          context.purpose ? `项目目标：\n${context.purpose}` : "",
          context.overview ? `知识总览：\n${context.overview}` : "",
        ].filter(Boolean).join("\n\n"),
      },
    ],
    {
      onToken: (token) => { result += token },
      onDone: () => {},
      onError: () => {},
    },
  )
  try {
    const parsed = JSON.parse(result) as unknown
    const queries = normalizeList(parsed, Math.max(4, session.breadth * 2))
    if (queries.length > 0) {
      return queries
    }
  } catch {
    // fall through
  }
  return profile.buildFallbackQueries(session)
}

async function summarizeSourceEvidence(
  session: ResearchSession,
  query: string,
  result: { title: string; url: string; snippet: string; source: string },
  markdown: string,
  detail: string,
  llmConfig: LlmConfig,
  profile: ResearchProfile,
  index: number,
): Promise<ResearchSourceEvidence> {
  let response = ""
  await streamChat(
    llmConfig,
    [
      {
        role: "system",
        content: [
          ...profile.buildSourceSummarySystemPrompt(session),
          buildLanguageDirective(session.topic),
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `研究主题：${session.topic}`,
          session.businessContext ? `业务背景：${session.businessContext}` : "",
          session.targetMarket ? `目标市场：${session.targetMarket}` : "",
          session.targetAudience ? `目标客群：${session.targetAudience}` : "",
          `当前查询：${query}`,
          `来源标题：${result.title}`,
          `来源 URL：${result.url}`,
          `搜索摘要：${result.snippet}`,
          detail ? `抓取状态：${detail}` : "",
          markdown ? `抓取正文：\n${markdown.slice(0, 8000)}` : "",
        ].filter(Boolean).join("\n\n"),
      },
    ],
    {
      onToken: (token) => { response += token },
      onDone: () => {},
      onError: () => {},
    },
  )

  let learnedFacts = [result.snippet].filter(Boolean)
  let openFollowUps: string[] = []
  let sourceReliabilityNote = detail
  try {
    const parsed = JSON.parse(response) as {
      learnedFacts?: unknown
      openFollowUps?: unknown
      sourceReliabilityNote?: unknown
    }
    const parsedLearnings = normalizeList(parsed.learnedFacts, 6)
    if (parsedLearnings.length > 0) {
      learnedFacts = parsedLearnings
    }
    openFollowUps = normalizeList(parsed.openFollowUps, 4)
    if (typeof parsed.sourceReliabilityNote === "string" && parsed.sourceReliabilityNote.trim()) {
      sourceReliabilityNote = parsed.sourceReliabilityNote.trim()
    }
  } catch {
    // keep fallbacks
  }

  return {
    id: makeSourceId(session.sessionId, index),
    query,
    url: result.url,
    title: result.title,
    snippet: result.snippet,
    source: result.source,
    rawContent: markdown || null,
    reliabilityNote: sourceReliabilityNote,
    learnedFacts,
    openFollowUps,
  }
}

async function generateBranchFollowUps(
  session: ResearchSession,
  learnings: string[],
  llmConfig: LlmConfig,
  profile: ResearchProfile,
): Promise<StructuredFollowUp[]> {
  let result = ""
  await streamChat(
    llmConfig,
    [
      {
        role: "system",
        content: [
          ...profile.buildFollowUpSystemPrompt(session),
          buildLanguageDirective(session.topic),
        ].join("\n"),
      },
      {
        role: "user",
        content: `研究主题：${session.topic}\n\n当前 learnings：\n${learnings.join("\n")}`,
      },
    ],
    {
      onToken: (token) => { result += token },
      onDone: () => {},
      onError: () => {},
    },
  )
  try {
    const parsed = JSON.parse(result) as Array<{
      followUpQuestion?: unknown
      reason?: unknown
      derivedFromLearning?: unknown
      priority?: unknown
    }>
    if (Array.isArray(parsed)) {
      const followUps = parsed
        .map((item) => ({
          followUpQuestion: typeof item?.followUpQuestion === "string" ? item.followUpQuestion.trim() : "",
          reason: typeof item?.reason === "string" ? item.reason.trim() : "",
          derivedFromLearning: typeof item?.derivedFromLearning === "string" ? item.derivedFromLearning.trim() : "",
          priority: (
            item?.priority === "high" || item?.priority === "low"
              ? item.priority
              : "medium"
          ) as StructuredFollowUp["priority"],
        }))
        .filter((item) => item.followUpQuestion.length > 0)
        .slice(0, 3)
      if (followUps.length > 0) {
        return followUps
      }
    }
  } catch {
    // ignore
  }
  return []
}

async function synthesizeResearchReport(
  session: ResearchSession,
  context: { purpose: string; overview: string; index: string },
  llmConfig: LlmConfig,
  profile: ResearchProfile,
  options: {
    degraded: boolean
    blockedReason: string | null
    roundsCompleted: number
    timeoutMs?: number
    onProgress?: (progress: { receivedChars: number }) => void | Promise<void>
  },
): Promise<string> {
  let report = ""
  const timeoutMs = Math.max(5_000, options.timeoutMs ?? RESEARCH_REPORT_SYNTHESIS_TIMEOUT_MS)
  const abortController = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const settleResolve = () => {
        if (settled) return
        settled = true
        resolve()
      }
      const settleReject = (error: unknown) => {
        if (settled) return
        settled = true
        reject(error)
      }

      timeoutId = setTimeout(() => {
        abortController.abort()
        settleReject(new ResearchReportSynthesisError(
          `研究报告生成超过 ${Math.round(timeoutMs / 1000)} 秒仍未完成，已停止等待。可以稍后重试，或切换更快模型后重新生成报告。`,
          "timeout",
        ))
      }, timeoutMs)

      void streamChat(
        llmConfig,
        [
          {
            role: "system",
            content: [
              ...profile.buildReportSystemPrompt(session),
              buildLanguageDirective(session.topic),
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              `研究主题：${session.topic}`,
              ...profile.buildReportUserContext(session),
              `研究轮次：${options.roundsCompleted}/${session.depth}`,
              session.userAnswers.length > 0 ? `专家澄清回答：\n${session.userAnswers.join("\n")}` : "",
              context.purpose ? `项目目标：\n${context.purpose}` : "",
              context.overview ? `知识总览：\n${context.overview}` : "",
              options.degraded ? "当前研究状态：部分来源抓取降级，部分结论可能只基于搜索摘要。" : "当前研究状态：来源抓取正常。",
              options.blockedReason ? `阻塞或缺口：${options.blockedReason}` : "",
              `来源 learnings：\n${session.sources.map((item) => `- ${item.title}: ${item.learnedFacts.join("；")}`).join("\n")}`,
              session.pendingFollowUps.length > 0
                ? `仍待追问：\n${session.pendingFollowUps.map((item) => `- ${item.followUpQuestion}（原因：${item.reason}）`).join("\n")}`
                : "",
            ].filter(Boolean).join("\n\n"),
          },
        ],
        {
          onToken: (token) => {
            report += token
            void options.onProgress?.({ receivedChars: report.length })
          },
          onDone: settleResolve,
          onError: (error) => {
            settleReject(new ResearchReportSynthesisError(
              `研究报告生成失败：${error.message}`,
              "stream_error",
              error,
            ))
          },
        },
        abortController.signal,
      ).then(settleResolve).catch((error) => {
        settleReject(new ResearchReportSynthesisError(
          `研究报告生成失败：${error instanceof Error ? error.message : String(error)}`,
          "stream_error",
          error,
        ))
      })
    })
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }

  const trimmed = report.trim()
  if (!trimmed) {
    throw new ResearchReportSynthesisError(
      "研究报告生成失败：模型没有返回报告正文。",
      "empty_report",
    )
  }
  return trimmed
}

async function extractResearchFindings(
  session: ResearchSession,
  reportMarkdown: string,
  llmConfig: LlmConfig,
  profile: ResearchProfile,
): Promise<ResearchFinding[]> {
  let result = ""
  await streamChat(
    llmConfig,
    [
      {
        role: "system",
        content: [
          ...profile.buildFindingSystemPrompt(session),
          buildLanguageDirective(session.topic),
        ].join("\n"),
      },
      {
        role: "user",
        content: reportMarkdown,
      },
    ],
    {
      onToken: (token) => { result += token },
      onDone: () => {},
      onError: () => {},
    },
  )
  try {
    const parsed = JSON.parse(result) as Array<{
      kind?: string
      title?: string
      summary?: string
      evidenceSummary?: string
    }>
    if (Array.isArray(parsed)) {
      const findings = parsed
        .filter((item) => item && typeof item.title === "string")
        .slice(0, 6)
        .map((item, index) => {
          const findingId = makeFindingId(session.sessionId, index)
          return {
            id: findingId,
            findingId,
            kind: (item.kind === "revision_suggestion" ? "revision_suggestion" : "business_conclusion") as ResearchFinding["kind"],
            title: item.title?.trim() || `候选结论 ${index + 1}`,
            summary: item.summary?.trim() || "",
            evidenceSummary: item.evidenceSummary?.trim() || "",
            sourceUrls: session.sources.map((source) => source.url).slice(0, 5),
            linkedDocId: session.linkedDocId ?? null,
            targetFieldKey: session.targetFieldKey ?? null,
            researchSessionId: session.sessionId,
            researchFindingId: findingId,
            promotionState: "idle" as ResearchFindingPromotionState,
          }
        })
      if (findings.length > 0) {
        return findings
      }
    }
  } catch {
    // ignore
  }

  const fallbackId = makeFindingId(session.sessionId, 0)
  return [{
    id: fallbackId,
    findingId: fallbackId,
    kind: "business_conclusion",
    title: "研究已完成，待人工确认回流",
    summary: "研究报告已经生成，但候选结论尚未结构化提取完成。",
    evidenceSummary: "请打开研究报告查看核心结论与证据来源。",
    sourceUrls: session.sources.map((source) => source.url).slice(0, 5),
    linkedDocId: session.linkedDocId ?? null,
    targetFieldKey: session.targetFieldKey ?? null,
    researchSessionId: session.sessionId,
    researchFindingId: fallbackId,
    promotionState: "idle",
  }]
}
