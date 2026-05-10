import { readFile } from "@/commands/fs"
import { streamChat } from "@/lib/llm-client"
import { buildLanguageDirective } from "@/lib/output-language"
import { normalizePath } from "@/lib/path-utils"
import { loadResearchSessions, saveResearchSession } from "@/lib/research-persist"
import { fetchResearchDocument, runResearchSearch } from "@/lib/research-backend"
import type {
  EnterResearchWorkbenchInput,
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

const REPORT_SECTION_SPECS = [
  { key: "research_question", title: "研究问题" },
  { key: "scope_and_assumptions", title: "研究范围与前提" },
  { key: "core_findings", title: "核心结论" },
  { key: "evidence_sources", title: "证据来源" },
  { key: "open_questions", title: "未解决问题" },
  { key: "revision_suggestions", title: "可带入业务修订的建议" },
] as const

function safeNowIso(): string {
  return new Date().toISOString()
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

export async function runDeepResearchSession(sessionId: string, projectPath: string): Promise<void> {
  const session = getSession(sessionId)
  if (!session) return
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

  const clarifications = await generateClarificationQuestions(session, context, llmConfig)
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
    : await generatePlannedQueries(working, context, llmConfig)
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

    pendingFollowUps = await generateBranchFollowUps(working, dedupRoundLearnings, llmConfig)
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

  const reportMarkdown = await synthesizeResearchReport(working, context, llmConfig, {
    degraded,
    blockedReason: null,
    roundsCompleted: roundIndex + 1,
  })
  const reportSections = parseResearchReportSections(reportMarkdown)
  appendResearchThreadEntry(sessionId, {
    phase: "synthesize_report",
    kind: "report_generated",
    title: "研究报告已生成",
    detail: reportSections.parsed ? "报告已按结构化章节完成拆分。" : "报告已生成，但章节解析失败，将回退为正常阅读态。",
    data: { parsedSections: reportSections.parsed, roundsCompleted: roundIndex + 1 },
  })

  const findings = await extractResearchFindings(working, reportMarkdown, llmConfig)
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
        ? ["已保存研究线程", "已保存来源证据", "已生成候选结论", "证据抓取已降级"]
        : ["已保存研究线程", "已保存来源证据", "已生成候选结论"],
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
  const normalized = reportMarkdown.trim()
  if (!normalized) {
    return { parsed: false, sections: [] }
  }
  const headingRegex = /^##\s+(.+)$/gm
  const matches = Array.from(normalized.matchAll(headingRegex))
  if (matches.length === 0) {
    return { parsed: false, sections: [] }
  }

  const sections = REPORT_SECTION_SPECS.map((spec) => {
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
): Promise<string[]> {
  let result = ""
  await streamChat(
    llmConfig,
    [
      {
        role: "system",
        content: [
          "你是业务深度研究编排助手。",
          buildLanguageDirective(session.topic),
          "请基于当前研究主题，提出 2 个最关键的澄清问题，帮助研究更贴近业务。",
          "严格输出 JSON 数组，每项是一个字符串。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `研究主题：${session.topic}`,
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
): Promise<string[]> {
  let result = ""
  await streamChat(
    llmConfig,
    [
      {
        role: "system",
        content: [
          "你是业务深度研究规划助手。",
          buildLanguageDirective(session.topic),
          "请基于研究主题、项目目标、现有知识概览和专家澄清回答，生成一组适合网页搜索与整页抓取的查询。",
          "查询要覆盖 breadth / depth，不要泛泛而谈。",
          "严格输出 JSON 数组，每项是一个查询字符串。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `研究主题：${session.topic}`,
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
  return [
    session.topic,
    `${session.topic} best practices`,
    `${session.topic} case study`,
    `${session.topic} metrics action framework`,
  ]
}

async function summarizeSourceEvidence(
  session: ResearchSession,
  query: string,
  result: { title: string; url: string; snippet: string; source: string },
  markdown: string,
  detail: string,
  llmConfig: LlmConfig,
  index: number,
): Promise<ResearchSourceEvidence> {
  let response = ""
  await streamChat(
    llmConfig,
    [
      {
        role: "system",
        content: [
          "你是业务研究证据提炼助手。",
          buildLanguageDirective(session.topic),
          "请从单个来源中提炼：learnedFacts、openFollowUps、sourceReliabilityNote。",
          "严格输出 JSON 对象：{ learnedFacts: string[], openFollowUps: string[], sourceReliabilityNote: string }",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `研究主题：${session.topic}`,
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
): Promise<StructuredFollowUp[]> {
  let result = ""
  await streamChat(
    llmConfig,
    [
      {
        role: "system",
        content: [
          "你是业务深度研究追问助手。",
          buildLanguageDirective(session.topic),
          "基于当前 learnings，提出最多 3 个下一步需要继续追问的方向。",
          "严格输出 JSON 数组，每项包含：followUpQuestion, reason, derivedFromLearning, priority。",
          "priority 只能是 high、medium、low。",
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
  options: {
    degraded: boolean
    blockedReason: string | null
    roundsCompleted: number
  },
): Promise<string> {
  let report = ""
  await streamChat(
    llmConfig,
    [
      {
        role: "system",
        content: [
          "你是业务深度研究总结助手。",
          buildLanguageDirective(session.topic),
          "请严格按以下结构输出研究报告：",
          "## 研究问题",
          "## 研究范围与前提",
          "## 核心结论",
          "## 证据来源",
          "## 未解决问题",
          "## 可带入业务修订的建议",
          "要求：标清哪些内容是已确认依据，哪些只是启发性延展。",
          "如果结果不足，请明确说明是证据不足、抓取降级还是外部来源冲突未解。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `研究主题：${session.topic}`,
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
      onToken: (token) => { report += token },
      onDone: () => {},
      onError: () => {},
    },
  )
  return report.trim()
}

async function extractResearchFindings(
  session: ResearchSession,
  reportMarkdown: string,
  llmConfig: LlmConfig,
): Promise<ResearchFinding[]> {
  let result = ""
  await streamChat(
    llmConfig,
    [
      {
        role: "system",
        content: [
          "你是业务研究结果结构化助手。",
          buildLanguageDirective(session.topic),
          "请从研究报告中提炼候选结论。",
          "严格输出 JSON 数组，每项包含：kind, title, summary, evidenceSummary。",
          "kind 只能是 business_conclusion 或 revision_suggestion。",
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
