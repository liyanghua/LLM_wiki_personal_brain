import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  AlertTriangle,
  FilePenLine,
  MessageSquareText,
  RefreshCcw,
  Sparkles,
  Target,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChatPanel } from "@/components/chat/chat-panel"
import {
  useChatStore,
  type ComposerRequest,
  type ConversationStage,
  type DisplayMessage,
  type MessageReference,
  type RevisionChatContext,
  type RevisionMessageMeta,
} from "@/stores/chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import { useAgentModeStore } from "@/stores/agent-mode-store"
import { useAgentLoopStore } from "@/stores/agent-loop-store"
import { useInteractiveSessionStore } from "@/stores/interactive-session-store"
import { useRevisionStore } from "@/stores/revision-store"
import { useActivityStore } from "@/stores/activity-store"
import { ensureScenePack } from "@/lib/scene-pack"
import {
  acceptSuggestionToAssets,
  createAgentLoopSession,
  createInteractiveSession,
  publishRevisionVersion,
  recomputeLoopAfterAcceptance,
  runInteractiveTurn,
} from "@/lib/revision-pipeline"
import {
  saveAgentModeReport,
  saveAgentLoopSession,
  saveInteractiveSession,
  saveRevisionDraft,
  saveGroundTruthDraftSnapshot,
  saveRevisionPatches,
} from "@/lib/agent-mode-persist"
import type {
  AgentLoopSession,
  AgentModeReport,
  AgentWorkbenchRuntime,
  GroundTruthDraft,
  LoopTask,
  RevisionDraft,
  RevisionIssueCard,
  RevisionSuggestion,
  TriggerSource,
} from "@/lib/agent-mode-types"
import { labelForGateStatus } from "@/lib/quality-contracts"
import { runRevisionValidationTurn } from "@/lib/revision-validation"

function statusBadge(status: string): string {
  if (status === "covered") return "bg-emerald-100 text-emerald-700"
  if (status === "missing") return "bg-red-100 text-red-700"
  if (status === "weak") return "bg-amber-100 text-amber-700"
  return "bg-slate-100 text-slate-700"
}

function severityBadge(severity: string): string {
  if (severity === "P1") return "bg-red-100 text-red-700"
  if (severity === "P2") return "bg-amber-100 text-amber-800"
  return "bg-zinc-100 text-zinc-700"
}

function gateBadge(status: string): string {
  if (status === "fail") return "bg-red-100 text-red-700"
  if (status === "warn") return "bg-amber-100 text-amber-800"
  return "bg-emerald-100 text-emerald-700"
}

function normalizeReport(report: AgentModeReport | null): AgentModeReport | null {
  if (!report) return null
  return {
    ...report,
    blockAssessments: Array.isArray(report.blockAssessments) ? report.blockAssessments : [],
    revisionIssueCards: Array.isArray(report.revisionIssueCards) ? report.revisionIssueCards : [],
    reviewSummary: report.reviewSummary ?? {
      highPriorityCount: 0,
      mediumPriorityCount: 0,
      lowPriorityCount: 0,
      criticalThemes: [],
      nextBestAction: "请重新导入或重新运行结构化分析，以生成新的问题卡。",
    },
    activeCriticalCardIds: Array.isArray(report.activeCriticalCardIds) ? report.activeCriticalCardIds : [],
  }
}

function normalizeSuggestionForWriteback(suggestion: RevisionSuggestion): RevisionSuggestion {
  return {
    ...suggestion,
    cardId: suggestion.cardId ?? null,
    targetFieldKey: suggestion.targetFieldKey ?? null,
    targetBlockIds: Array.isArray(suggestion.targetBlockIds) ? suggestion.targetBlockIds : [],
    anchorBlockId: suggestion.anchorBlockId ?? null,
    patchMode: suggestion.patchMode ?? "replace",
    suggestionText: suggestion.suggestionText ?? suggestion.revisedMarkdown ?? "",
    revisedMarkdown: suggestion.revisedMarkdown ?? suggestion.suggestionText ?? "",
  }
}

function loopStatusLabel(status: AgentLoopSession["status"]): string {
  switch (status) {
    case "active":
      return "进行中"
    case "awaiting_expert":
      return "等待专家"
    case "recomputing":
      return "局部重算中"
    case "ready_to_publish":
      return "可发布"
    case "feedback_pending":
      return "待处理回流"
    case "completed":
      return "已完成"
    case "idle":
    default:
      return "未开始"
  }
}

function runtimeStatusLabel(status: AgentWorkbenchRuntime["status"]): string {
  switch (status) {
    case "running":
      return "进行中"
    case "done":
      return "已完成"
    case "error":
      return "出错"
    case "idle":
    default:
      return "待开始"
  }
}

function buildRevisionSnapshotKey(input: {
  draft: RevisionDraft | null
  groundTruth: GroundTruthDraft | null
  selectedCardId?: string | null
}): string {
  return [
    input.draft?.updatedAt ?? "no-draft",
    input.groundTruth?.lastUpdatedAt ?? input.groundTruth?.updatedAt ?? "no-ground-truth",
    input.selectedCardId ?? "no-card",
  ].join(":")
}

function buildRevisionChangeSummary(input: {
  card: RevisionIssueCard | null
  suggestion: RevisionSuggestion
  editedMarkdown?: string
}): string[] {
  const lines: string[] = []
  if (input.card?.issueTitle) {
    lines.push(`当前建议聚焦「${input.card.issueTitle}」`)
  }
  if (input.suggestion.targetFieldKey) {
    lines.push(`目标字段：${input.suggestion.targetFieldKey}`)
  }
  if (input.editedMarkdown) {
    lines.push("本次采纳采用了专家编辑后的版本，而不是原始建议稿。")
  }
  if (input.card?.diagnosis) {
    lines.push(`预期改善：${input.card.diagnosis}`)
  }
  return lines
}

function buildAcceptanceSummary(input: {
  suggestion: RevisionSuggestion
  loopSession: AgentLoopSession | null
  report: AgentModeReport
}): string[] {
  const lines = ["已写入主稿", "已更新业务底稿", "已完成局部重算"]
  if (input.loopSession?.activeTaskId) {
    lines.push(`下一任务：${input.loopSession.activeTaskId}`)
  } else {
    lines.push("当前没有新的待处理任务")
  }
  lines.push(`当前发布门禁：${labelForGateStatus(input.report.publishGate.status)}`)
  return lines
}

export function AgentWorkbench() {
  const project = useWikiStore((s) => s.project)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const reports = useAgentModeStore((s) => s.reports)
  const selectedDocId = useAgentModeStore((s) => s.selectedDocId)
  const setSelectedDocId = useAgentModeStore((s) => s.setSelectedDocId)
  const setActiveMode = useAgentModeStore((s) => s.setActiveMode)
  const autosaveState = useAgentModeStore((s) => s.autosaveState)
  const degradedMode = useAgentModeStore((s) => s.degradedMode)
  const setAutosaveState = useAgentModeStore((s) => s.setAutosaveState)
  const setDegradedMode = useAgentModeStore((s) => s.setDegradedMode)
  const upsertReport = useAgentModeStore((s) => s.upsertReport)
  const runtime = useAgentModeStore((s) => s.runtime)
  const setRuntime = useAgentModeStore((s) => s.setRuntime)
  const pendingExternalSuggestion = useAgentModeStore((s) => s.pendingExternalSuggestion)
  const setPendingExternalSuggestion = useAgentModeStore((s) => s.setPendingExternalSuggestion)
  const ensureScopedConversation = useChatStore((s) => s.ensureScopedConversation)
  const setActiveConversation = useChatStore((s) => s.setActiveConversation)
  const conversations = useChatStore((s) => s.conversations)
  const messages = useChatStore((s) => s.messages)
  const addChatMessage = useChatStore((s) => s.addMessage)
  const updateChatMessage = useChatStore((s) => s.updateMessage)
  const setStreaming = useChatStore((s) => s.setStreaming)
  const appendStreamToken = useChatStore((s) => s.appendStreamToken)
  const loopSessions = useAgentLoopStore((s) => s.sessions)
  const upsertLoopSession = useAgentLoopStore((s) => s.upsertSession)
  const sessions = useInteractiveSessionStore((s) => s.sessions)
  const currentSessionId = useInteractiveSessionStore((s) => s.currentSessionId)
  const setCurrentSessionId = useInteractiveSessionStore((s) => s.setCurrentSessionId)
  const upsertSession = useInteractiveSessionStore((s) => s.upsertSession)
  const drafts = useRevisionStore((s) => s.drafts)
  const upsertDraft = useRevisionStore((s) => s.upsertDraft)
  const upsertVersion = useRevisionStore((s) => s.upsertVersion)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [overrideReason, setOverrideReason] = useState("")
  const [composerRequest, setComposerRequest] = useState<ComposerRequest | null>(null)
  const [conversationStage, setConversationStage] = useState<ConversationStage>("revise")
  const qaPanelRef = useRef<HTMLDivElement | null>(null)
  const validationAbortRef = useRef<AbortController | null>(null)

  function updateRuntime(
    phase: AgentWorkbenchRuntime["phase"],
    status: AgentWorkbenchRuntime["status"],
    detail: string,
    extras: Partial<AgentWorkbenchRuntime> = {},
  ) {
    const current = runtime
    const startedAt = current?.startedAt ?? new Date().toISOString()
    const title =
      phase === "enter_workbench" ? "进入业务修订" :
      phase === "restore_workspace" ? "恢复修订工作台" :
      phase === "prepare_task" ? "准备当前修订任务" :
      phase === "accept_writeback" ? "采纳并写回主稿" :
      phase === "partial_recompute" ? "局部重算质量与任务" :
      "发布并校验知识层"
    setRuntime({
      phase,
      status,
      title,
      detail,
      docId: extras.docId ?? current?.docId ?? report?.docId ?? null,
      taskId: extras.taskId ?? current?.taskId ?? loopSession?.activeTaskId ?? null,
      startedAt,
      updatedAt: new Date().toISOString(),
      completedArtifacts: extras.completedArtifacts ?? current?.completedArtifacts ?? [],
      errorMessage: extras.errorMessage,
      canRetry: extras.canRetry ?? false,
    })
  }

  async function handleStartLoop(triggerSource: TriggerSource, card?: RevisionIssueCard | null, feedbackTask?: LoopTask | null) {
    if (!project || !report) return
    const nextLoop = createAgentLoopSession(report, triggerSource, {
      activeCardId: card?.cardId ?? feedbackTask?.linkedCardId ?? null,
      feedbackTask,
      previous: loopSession,
    })
    upsertLoopSession(nextLoop)
    if (nextLoop.activeCardId) {
      setSelectedCardId(nextLoop.activeCardId)
    }
    setAutosaveState("saving")
    try {
      await saveAgentLoopSession(project.path, nextLoop)
      setAutosaveState("saved")
    } catch {
      setAutosaveState("error")
    }
  }

  const report = useMemo(
    () => normalizeReport(reports.find((item) => item.docId === selectedDocId) ?? reports[0] ?? null),
    [reports, selectedDocId],
  )
  const draft = useMemo(
    () => drafts.find((item) => item.docId === report?.docId) ?? null,
    [drafts, report?.docId],
  )
  const currentSession = useMemo(
    () => sessions.find((session) => session.sessionId === currentSessionId) ?? null,
    [sessions, currentSessionId],
  )
  const selectedCard = useMemo(() => {
    if (!report) return null
    return report.revisionIssueCards.find((card) => card.cardId === selectedCardId)
      ?? report.revisionIssueCards[0]
      ?? null
  }, [report, selectedCardId])
  const loopSession = useMemo(
    () => loopSessions.find((item) => item.docId === report?.docId) ?? null,
    [loopSessions, report?.docId],
  )
  const activeTask = useMemo(
    () => loopSession?.tasks.find((task) => task.taskId === loopSession.activeTaskId) ?? null,
    [loopSession],
  )
  const activeCard = useMemo(() => {
    if (!report) return null
    const preferredCardId = loopSession?.activeCardId ?? selectedCard?.cardId ?? null
    return report.revisionIssueCards.find((card) => card.cardId === preferredCardId)
      ?? selectedCard
      ?? report.revisionIssueCards[0]
      ?? null
  }, [loopSession?.activeCardId, report, selectedCard])
  const confirmedFieldCount = useMemo(
    () => report?.groundTruth.fields.filter((field) => field.status === "confirmed" || field.status === "revised").length ?? 0,
    [report],
  )

  const revisionLoopConversationId = useMemo(() => {
    if (!report) return null
    const loopId = loopSession?.loopId ?? null
    return conversations.find((conversation) =>
      (conversation.scope ?? "global") === "revision-loop"
      && (conversation.docId ?? null) === report.docId
      && (conversation.loopId ?? null) === loopId
    )?.id ?? null
  }, [conversations, loopSession?.loopId, report])

  const revisionLoopMessages = useMemo(
    () => revisionLoopConversationId
      ? messages.filter((message) => message.conversationId === revisionLoopConversationId)
      : [],
    [messages, revisionLoopConversationId],
  )

  const revisionContext = useMemo<RevisionChatContext | null>(() => {
    if (!project || !report) return null
    return {
      docId: report.docId,
      loopId: loopSession?.loopId ?? null,
      draftPath: `${project.path}/deliverables/revised-docs/${report.docId}/draft.md`,
      draft,
      groundTruth: report.groundTruth,
      selectedCardId: activeCard?.cardId ?? selectedCard?.cardId ?? null,
      selectedBlockIds: [activeCard?.primaryBlockId, activeCard?.anchorBlockId].filter(Boolean) as string[],
      selectedTargetFieldKey: activeTask?.targetFieldKey ?? activeCard?.targetFieldKey ?? null,
      lastAcceptedCardId: report.groundTruth.lastAcceptedCardId ?? null,
      revisionSnapshotKey: buildRevisionSnapshotKey({
        draft,
        groundTruth: report.groundTruth,
        selectedCardId: activeCard?.cardId ?? selectedCard?.cardId ?? null,
      }),
      selectedCardTitle: activeCard?.issueTitle ?? null,
      selectedCardDiagnosis: activeCard?.diagnosis ?? null,
      groundTruthSummary: report.groundTruth.fields
        .slice(0, 4)
        .map((field) => `${field.label}：${field.value}`)
        .join("\n"),
    }
  }, [activeCard, activeTask?.targetFieldKey, draft, loopSession?.loopId, project, report, selectedCard?.cardId])

  const ensureRevisionLoopConversation = useCallback((title?: string) => {
    if (!report) return null
    const loopId = loopSession?.loopId ?? null
    const conversationId = ensureScopedConversation(
      title ?? `修订闭环 · ${report.sourceName}`,
      {
        scope: "revision-loop",
        docId: report.docId,
        loopId,
      },
    )
    setActiveConversation(conversationId)
    return conversationId
  }, [ensureScopedConversation, loopSession?.loopId, report, setActiveConversation])

  const appendRevisionLoopMessage = useCallback((params: {
    role?: DisplayMessage["role"]
    content: string
    revisionMeta?: RevisionMessageMeta | null
    references?: MessageReference[]
  }) => {
    const conversationId = ensureRevisionLoopConversation()
    if (!conversationId) return null
    addChatMessage(params.role ?? "assistant", params.content, {
      conversationId,
      references: params.references,
      revisionMeta: params.revisionMeta ?? null,
      skipTitleAuto: true,
    })
    return conversationId
  }, [addChatMessage, ensureRevisionLoopConversation])

  const seedTaskContextMessage = useCallback((inputCard?: RevisionIssueCard | null, inputTask?: LoopTask | null) => {
    if (!report) return
    const targetCard = inputCard ?? activeCard ?? selectedCard ?? report.revisionIssueCards[0] ?? null
    const targetTask = inputTask ?? activeTask ?? null
    const content = [
      `当前修订任务：${targetTask?.entryHint ?? targetCard?.issueTitle ?? "待确认任务"}`,
      "",
      targetCard?.diagnosis ? `为什么要修：${targetCard.diagnosis}` : "",
      targetCard?.originalExcerpt ? `原文问题段：\n${targetCard.originalExcerpt}` : "",
      targetCard?.suggestedRevision ? `建议方向：\n${targetCard.suggestedRevision}` : "",
      targetTask?.whyNow ? `当前优先级说明：${targetTask.whyNow}` : "",
      loopSession?.recommendedValidationQuestion ? `完成后建议验证：${loopSession.recommendedValidationQuestion}` : "",
    ].filter(Boolean).join("\n\n")
    appendRevisionLoopMessage({
      content,
      revisionMeta: {
        messageKind: "task_context",
        docId: report.docId,
        loopId: loopSession?.loopId ?? null,
        taskId: targetTask?.taskId ?? loopSession?.activeTaskId ?? null,
        cardId: targetCard?.cardId ?? loopSession?.activeCardId ?? null,
        targetFieldKey: targetTask?.targetFieldKey ?? targetCard?.targetFieldKey ?? null,
        stage: "revise",
        changeSummary: [
          targetTask?.entryHint ?? targetCard?.issueTitle ?? "当前闭环任务已准备好",
          targetTask?.whyNow ?? targetCard?.diagnosis ?? "可以继续补充、修正文案或直接确认建议。",
        ],
        impactFieldKeys: [targetTask?.targetFieldKey ?? targetCard?.targetFieldKey].filter(Boolean) as string[],
        impactDimensions: Array.isArray(targetCard?.impactsDimensions) ? targetCard!.impactsDimensions : [],
        actionState: "accepted",
        validationQuestion: loopSession?.recommendedValidationQuestion ?? targetCard?.followupQuestion ?? null,
      },
    })
  }, [activeCard, activeTask, appendRevisionLoopMessage, loopSession, report, selectedCard])

  const seedExternalResearchSuggestion = useCallback(() => {
    if (!pendingExternalSuggestion || !report) return
    ensureRevisionLoopConversation()
    appendRevisionLoopMessage({
      content: [
        "这条内容来自深度研究候选结论，尚未写回业务底稿。",
        "",
        `候选主题：${pendingExternalSuggestion.title}`,
        pendingExternalSuggestion.summary,
        pendingExternalSuggestion.evidenceSummary
          ? `研究依据：${pendingExternalSuggestion.evidenceSummary}`
          : "",
        "请先判断这条研究结论是否适用，再决定是否继续修订和写回。",
      ].filter(Boolean).join("\n\n"),
      revisionMeta: {
        messageKind: "supplement_seed",
        docId: report.docId,
        loopId: loopSession?.loopId ?? null,
        taskId: loopSession?.activeTaskId ?? null,
        cardId: null,
        targetFieldKey: pendingExternalSuggestion.targetFieldKey ?? null,
        stage: "revise",
        changeSummary: [
          "来源：深度研究候选结论",
          pendingExternalSuggestion.researchFindingId
            ? `findingId：${pendingExternalSuggestion.researchFindingId}`
            : "当前没有 findingId",
        ],
        impactFieldKeys: [pendingExternalSuggestion.targetFieldKey].filter(Boolean) as string[],
        impactDimensions: ["deep_research"],
        actionState: "pending_confirmation",
        validationQuestion: null,
      },
    })
    setConversationStage("revise")
    setComposerRequest({
      id: `research-seed-${Date.now()}`,
      text: `请结合这条深度研究候选结论，帮我生成一版可确认的修订建议：${pendingExternalSuggestion.title}`,
      selectAll: true,
    })
    setPendingExternalSuggestion(null)
  }, [
    appendRevisionLoopMessage,
    ensureRevisionLoopConversation,
    loopSession?.activeTaskId,
    loopSession?.loopId,
    pendingExternalSuggestion,
    report,
    setPendingExternalSuggestion,
  ])

  useEffect(() => {
    if (!pendingExternalSuggestion || !report) return
    seedExternalResearchSuggestion()
  }, [pendingExternalSuggestion, report, seedExternalResearchSuggestion])

  const runAutoValidationTurn = useCallback(async (question?: string | null, nextContext?: RevisionChatContext | null) => {
    if (!project || !report || !question?.trim() || !nextContext) return
    const conversationId = ensureRevisionLoopConversation()
    if (!conversationId) return
    setConversationStage("validate")
    setStreaming(true)
    validationAbortRef.current?.abort()
    const controller = new AbortController()
    validationAbortRef.current = controller
    try {
      const result = await runRevisionValidationTurn({
        projectPath: project.path,
        projectName: project.name,
        llmConfig,
        question: question.trim(),
        revisionContext: nextContext,
        signal: controller.signal,
        onToken: (token) => appendStreamToken(token),
      })
      addChatMessage("assistant", result.content, {
        conversationId,
        references: result.references,
        answerMeta: result.answerMeta,
        revisionMeta: {
          messageKind: "validation_answer",
          docId: report.docId,
          loopId: loopSession?.loopId ?? null,
          taskId: loopSession?.activeTaskId ?? null,
          cardId: nextContext.selectedCardId ?? null,
          targetFieldKey: nextContext.selectedTargetFieldKey ?? null,
          stage: "validate",
          changeSummary: [
            "系统已基于最新修订稿自动发起一轮验证。",
            `验证问题：${question.trim()}`,
          ],
          impactFieldKeys: [nextContext.selectedTargetFieldKey].filter(Boolean) as string[],
          impactDimensions: ["最新修订快照"],
          actionState: "accepted",
          validationQuestion: question.trim(),
        },
        skipTitleAuto: true,
      })
    } finally {
      setStreaming(false)
      useChatStore.setState({ streamingContent: "" })
      validationAbortRef.current = null
    }
  }, [addChatMessage, appendStreamToken, ensureRevisionLoopConversation, llmConfig, loopSession?.activeTaskId, loopSession?.loopId, project, report, setStreaming])

  async function handleStartCard(card?: RevisionIssueCard | null) {
    if (!project || !report) return
    updateRuntime("prepare_task", "running", "正在准备这张修订卡对应的当前任务与会话上下文。")
    const resolvedCard = card ?? activeCard ?? selectedCard ?? report.revisionIssueCards[0] ?? null
    if (resolvedCard) {
      await handleStartLoop("issue_card", resolvedCard)
    }
    setConversationStage("revise")
    const conversationId = ensureRevisionLoopConversation()
    if (conversationId && revisionLoopMessages.length === 0) {
      seedTaskContextMessage(resolvedCard)
    } else {
      seedTaskContextMessage(resolvedCard)
    }
    const session = createInteractiveSession(report, resolvedCard)
    upsertSession(session)
    setCurrentSessionId(session.sessionId)
    setActiveMode("interactive")
    setAutosaveState("saving")
    try {
      await saveInteractiveSession(project.path, session)
      setAutosaveState("saved")
      updateRuntime("prepare_task", "done", "当前修订会话已经准备好，可以继续补充、澄清或确认建议。", {
        completedArtifacts: ["已恢复统一修订线程", "已同步当前闭环任务"],
      })
    } catch {
      setAutosaveState("error")
      updateRuntime("prepare_task", "error", "准备当前修订会话时失败，可以重新进入这张卡片。", {
        canRetry: true,
      })
    }
  }

  async function handleInteractiveSend(text: string, conversationId?: string | null) {
    if (!project || !report || !currentSession || !draft) return
    setAutosaveState("saving")
    try {
      const scenePack = await ensureScenePack(project.path, {
        defaultLanguage: useWikiStore.getState().outputLanguage,
      })
      const { session, suggestion } = await runInteractiveTurn({
        session: currentSession,
        report,
        scenePack,
        userAnswer: text,
        llmConfig,
      })
      void suggestion
      upsertSession(session)
      await saveInteractiveSession(project.path, session)
      const latestMessage = session.messages.length > 0
        ? session.messages[session.messages.length - 1]
        : null
      appendRevisionLoopMessage({
        content: latestMessage?.content ?? "我已经整理出一版可确认的修订建议。",
        revisionMeta: {
          messageKind: "revision_suggestion",
          docId: report.docId,
          loopId: loopSession?.loopId ?? null,
          taskId: loopSession?.activeTaskId ?? currentSession.taskId ?? null,
          cardId: suggestion.cardId ?? currentSession.cardId ?? null,
          targetFieldKey: suggestion.targetFieldKey ?? currentSession.targetFieldKey ?? null,
          stage: "revise",
          changeSummary: buildRevisionChangeSummary({
            card: activeCard ?? selectedCard ?? null,
            suggestion,
          }),
          impactFieldKeys: [suggestion.targetFieldKey].filter(Boolean) as string[],
          impactDimensions: activeCard?.impactsDimensions ?? [],
          actionState: "pending_confirmation",
          suggestion,
          validationQuestion: loopSession?.recommendedValidationQuestion ?? activeCard?.followupQuestion ?? null,
        },
      })
      if (conversationId) {
        setActiveConversation(conversationId)
      }
      setAutosaveState("saved")
      setDegradedMode(null)
    } catch (error) {
      console.error(error)
      setAutosaveState("error")
      setDegradedMode("当前会话已降级为基础修订模式，请继续输入关键补充，我们仍会保留草稿。")
    }
  }

  async function handleAcceptSuggestion(suggestion: RevisionSuggestion, editedMarkdown?: string) {
    if (!project || !report || !draft) return
    const baseSuggestion = normalizeSuggestionForWriteback(suggestion)
    const nextSuggestion = editedMarkdown
      ? {
          ...baseSuggestion,
          revisedMarkdown: editedMarkdown,
          suggestionText: editedMarkdown,
        }
      : baseSuggestion
    setAutosaveState("saving")
    updateRuntime("accept_writeback", "running", "正在把采纳内容写入主稿与业务底稿。")
    try {
      const nextAssets = await acceptSuggestionToAssets(
        project.path,
        draft,
        report.groundTruth,
        report,
        nextSuggestion,
      )
      upsertDraft(nextAssets.draft)
      await saveRevisionDraft(project.path, nextAssets.draft)
      await saveRevisionPatches(project.path, nextAssets.draft.docId, nextAssets.draft.appliedPatches)
      await saveGroundTruthDraftSnapshot(project.path, nextAssets.groundTruth)
      const acceptedStatus: RevisionIssueCard["status"] = editedMarkdown ? "edited" : "accepted"
      const acceptedCard = report.revisionIssueCards.find((card) => card.cardId === nextSuggestion.cardId) ?? activeCard
      const stagedCards: RevisionIssueCard[] = report.revisionIssueCards.map((card) =>
        card.cardId === nextSuggestion.cardId
          ? { ...card, status: acceptedStatus, suggestedRevision: nextSuggestion.revisedMarkdown }
          : card,
      )
      const stagedReport = {
        ...report,
        revisionIssueCards: stagedCards,
        groundTruth: nextAssets.groundTruth,
      }
      const recomputed = acceptedCard
        ? await recomputeLoopAfterAcceptance({
            projectPath: project.path,
            report: stagedReport,
            draft: nextAssets.draft,
            groundTruth: nextAssets.groundTruth,
            acceptedCard: {
              ...acceptedCard,
              status: acceptedStatus,
              suggestedRevision: nextSuggestion.revisedMarkdown,
            },
            llmConfig,
            loopSession,
          })
        : { report: stagedReport, loopSession }
      updateRuntime("partial_recompute", "running", "正在局部重算字段状态、质量分和下一张任务卡。")
      upsertReport(recomputed.report)
      if (recomputed.loopSession) {
        upsertLoopSession(recomputed.loopSession)
        if (recomputed.loopSession.activeCardId) {
          setSelectedCardId(recomputed.loopSession.activeCardId)
        }
        await saveAgentLoopSession(project.path, recomputed.loopSession)
      }
      await saveAgentModeReport(project.path, recomputed.report)
      setAutosaveState("saved")
      const nextRevisionContext: RevisionChatContext | null = project ? {
        docId: recomputed.report.docId,
        loopId: recomputed.loopSession?.loopId ?? loopSession?.loopId ?? null,
        draftPath: `${project.path}/deliverables/revised-docs/${recomputed.report.docId}/draft.md`,
        draft: nextAssets.draft,
        groundTruth: recomputed.report.groundTruth,
        selectedCardId: recomputed.loopSession?.activeCardId ?? recomputed.report.groundTruth.lastAcceptedCardId ?? null,
        selectedBlockIds: [],
        selectedTargetFieldKey: activeTask?.targetFieldKey ?? activeCard?.targetFieldKey ?? nextSuggestion.targetFieldKey ?? null,
        lastAcceptedCardId: recomputed.report.groundTruth.lastAcceptedCardId ?? nextSuggestion.cardId ?? null,
        revisionSnapshotKey: buildRevisionSnapshotKey({
          draft: nextAssets.draft,
          groundTruth: recomputed.report.groundTruth,
          selectedCardId: recomputed.loopSession?.activeCardId ?? recomputed.report.groundTruth.lastAcceptedCardId ?? null,
        }),
        selectedCardTitle: activeCard?.issueTitle ?? null,
        selectedCardDiagnosis: activeCard?.diagnosis ?? null,
        groundTruthSummary: recomputed.report.groundTruth.fields
          .slice(0, 4)
          .map((field) => `${field.label}：${field.value}`)
          .join("\n"),
      } : null
      appendRevisionLoopMessage({
        content: [
          "这条修订建议已经完成写回，并且业务底稿、质量分和下一任务都已同步更新。",
          "",
          `已写回内容：${nextSuggestion.revisedMarkdown}`,
          recomputed.loopSession?.recommendedValidationQuestion
            ? `下一轮建议验证：${recomputed.loopSession.recommendedValidationQuestion}`
            : "",
        ].filter(Boolean).join("\n\n"),
        revisionMeta: {
          messageKind: "accept_result",
          docId: report.docId,
          loopId: recomputed.loopSession?.loopId ?? loopSession?.loopId ?? null,
          taskId: recomputed.loopSession?.activeTaskId ?? null,
          cardId: nextSuggestion.cardId ?? null,
          targetFieldKey: nextSuggestion.targetFieldKey ?? null,
          stage: "validate",
          changeSummary: buildAcceptanceSummary({
            suggestion: nextSuggestion,
            loopSession: recomputed.loopSession ?? null,
            report: recomputed.report,
          }),
          impactFieldKeys: [nextSuggestion.targetFieldKey].filter(Boolean) as string[],
          impactDimensions: activeCard?.impactsDimensions ?? [],
          actionState: "accepted",
          validationQuestion: recomputed.loopSession?.recommendedValidationQuestion ?? loopSession?.recommendedValidationQuestion ?? activeCard?.followupQuestion ?? null,
        },
      })
      await runAutoValidationTurn(
        recomputed.loopSession?.recommendedValidationQuestion ?? loopSession?.recommendedValidationQuestion ?? activeCard?.followupQuestion,
        nextRevisionContext,
      )
      updateRuntime("partial_recompute", "done", "这次采纳已经完成写回，系统也刷新了质量分与下一任务。", {
        taskId: recomputed.loopSession?.activeTaskId ?? null,
        completedArtifacts: [
          "已写入主稿",
          "已更新业务底稿",
          "已刷新原文质量分",
          recomputed.loopSession?.activeTaskId ? "已切换到下一任务" : "当前没有新的任务",
          "已自动追加一轮验证",
        ],
      })
      setConversationStage("validate")
    } catch (error) {
      console.error(error)
      setAutosaveState("error")
      updateRuntime("accept_writeback", "error", "写回主稿或业务底稿时失败，当前内容已保留，可以直接重试。", {
        errorMessage: error instanceof Error ? error.message : String(error),
        canRetry: true,
      })
    }
  }

  async function handlePublish() {
    if (!project || !report || !draft) return
    setAutosaveState("saving")
    updateRuntime("publish_and_health_check", "running", "正在固化修订版本，并执行发布后的 Wiki 健康校验。")
    try {
      const { version, loopSession: nextLoop } = await publishRevisionVersion(project.path, report, draft, report.groundTruth, {
        llmConfig,
        overrideReason: report.publishGate.status === "fail" ? overrideReason : undefined,
        runSemanticLint: true,
        loopSession,
      })
      upsertVersion(version)
      if (nextLoop) {
        upsertLoopSession(nextLoop)
        if (nextLoop.activeCardId) {
          setSelectedCardId(nextLoop.activeCardId)
        }
      }
      useActivityStore.getState().addItem({
        type: "query",
        title: report.sourceName,
        status: "done",
        detail: `已发布修订版本 ${version.versionId}，后续可基于这个版本重新编译 wiki。`,
        filesWritten: [],
      })
      setAutosaveState("saved")
      updateRuntime(
        "publish_and_health_check",
        "done",
        nextLoop?.status === "feedback_pending"
          ? "已完成发布，但知识层仍有问题回流到原文修订。"
          : "本轮原文修订已完成发布，知识层校验也已同步结束。",
        {
          taskId: nextLoop?.activeTaskId ?? null,
          completedArtifacts: [
            `已发布版本 ${version.versionId}`,
            "已重编业务知识页",
            "已完成 Wiki 健康校验",
            nextLoop?.status === "feedback_pending" ? "已生成回流任务" : "本轮闭环已收敛",
          ],
        },
      )
    } catch (error) {
      console.error(error)
      setAutosaveState("error")
      updateRuntime("publish_and_health_check", "error", "发布版本或校验知识层时失败，当前草稿与会话状态已保留。", {
        errorMessage: error instanceof Error ? error.message : String(error),
        canRetry: true,
      })
    }
  }

  function handleStartKnowledgeValidation(options?: {
    question?: string | null
    selectAll?: boolean
    snapshotKey?: string | null
  }) {
    setConversationStage("validate")
    ensureRevisionLoopConversation()
    const text = options?.question?.trim()
    const snapshotKey = options?.snapshotKey ?? buildRevisionSnapshotKey({
      draft,
      groundTruth: report?.groundTruth ?? null,
      selectedCardId: loopSession?.activeCardId ?? activeCard?.cardId ?? selectedCard?.cardId ?? null,
    })
    setComposerRequest({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      selectAll: options?.selectAll ?? Boolean(text),
      snapshotKey,
    })
  }

  if (!project) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">请先打开业务工作区</div>
  }

  if (!report) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top,rgba(248,226,195,0.55),transparent_35%),linear-gradient(180deg,#fffdf8_0%,#fff 42%)]">
        <div className="px-8 pt-8">
          <div className="mx-auto max-w-5xl rounded-3xl border border-amber-100 bg-white/90 p-8 shadow-sm">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <Sparkles className="h-6 w-6" />
            </div>
            <h2 className="text-center text-xl font-semibold text-zinc-900">这个项目还没有修订工作台数据</h2>
            <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-6 text-zinc-600">
              旧项目还没生成新的结构化修订报告，所以暂时没有“问题卡修订”和“修订感知问答”。
              但你现在仍然可以先进入项目知识问答，基于当前项目里的 wiki 和资料继续提问。
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button
                className="bg-amber-600 text-white hover:bg-amber-700"
                onClick={() => {
                  requestAnimationFrame(() => {
                    qaPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
                  })
                }}
              >
                <MessageSquareText className="mr-2 h-4 w-4" />
                开始项目问答
              </Button>
              <Button variant="outline" onClick={() => useWikiStore.getState().setActiveView("sources")}>
                去导入新文档
              </Button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 px-6 pb-6 pt-6">
          <div ref={qaPanelRef} className="h-full overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-100 px-5 py-4">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                <MessageSquareText className="h-4 w-4 text-amber-700" />
                项目知识问答
              </div>
              <p className="mt-1 text-sm text-zinc-500">
                这里先基于当前项目已有的 wiki 与资料问答。等你重新导入业务文档后，会自动升级成修订感知问答。
              </p>
            </div>
            <div className="min-h-0 h-[calc(100%-73px)] overflow-hidden">
              <ChatPanel hideSidebar />
            </div>
          </div>
        </div>
      </div>
    )
  }

  const runtimeBar = runtime ? (
    <section className="mx-6 mt-6 rounded-3xl border border-amber-200 bg-amber-50/70 px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
            <Target className="h-4 w-4 text-amber-700" />
            {runtime.title}
            <span className="rounded-full bg-white px-2.5 py-1 text-xs text-zinc-600">
              {runtimeStatusLabel(runtime.status)}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-zinc-700">{runtime.detail}</p>
        </div>
        <div className="rounded-2xl bg-white/80 px-4 py-3 text-sm text-zinc-600">
          <p>当前文档：{report?.sourceName ?? "未选择"}</p>
          <p className="mt-1">当前任务：{activeTask?.entryHint ?? "待准备"}</p>
          <p className="mt-1">自动保存：{autosaveState === "saving" ? "进行中" : autosaveState === "saved" ? "已保存" : autosaveState === "error" ? "失败" : "待命"}</p>
        </div>
      </div>
      {runtime.completedArtifacts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {runtime.completedArtifacts.map((artifact) => (
            <span key={artifact} className="rounded-full bg-white px-3 py-1 text-xs text-zinc-700">
              {artifact}
            </span>
          ))}
        </div>
      )}
      {runtime.errorMessage && (
        <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          失败原因：{runtime.errorMessage}
        </div>
      )}
    </section>
  ) : null

  return (
    <div className="flex h-full bg-[radial-gradient(circle_at_top,rgba(248,226,195,0.35),transparent_32%),linear-gradient(180deg,#fffdf8_0%,#fff 42%)]">
      <aside className="w-[280px] shrink-0 border-r border-amber-100/70 bg-white/80 backdrop-blur">
        <div className="border-b border-amber-100/70 px-5 py-4">
          <p className="text-xs uppercase tracking-[0.18em] text-amber-700">Agent Mode</p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-900">业务修订工作台</h2>
          <p className="mt-2 text-xs leading-5 text-zinc-500">围绕业务文档做结构化理解、诊断、修订与版本沉淀。</p>
        </div>
        <div className="space-y-2 p-3">
          {reports.map((item) => (
            <button
              key={item.docId}
              onClick={() => setSelectedDocId(item.docId)}
              className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                item.docId === report.docId
                  ? "border-amber-200 bg-amber-50/80 shadow-sm"
                  : "border-transparent bg-white hover:border-amber-100 hover:bg-amber-50/40"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="line-clamp-2 text-sm font-medium text-zinc-900">{item.sourceName}</p>
                  <p className="mt-1 text-xs text-zinc-500">{item.qualityScore}/100 · {item.qualitySummary}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${gateBadge(item.publishGate.status)}`}>
                      {item.publishGate.status}
                    </span>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
                      {item.sourceHealth.status}
                    </span>
                  </div>
                </div>
                <ChevronRight className="mt-0.5 h-4 w-4 text-zinc-400" />
              </div>
            </button>
          ))}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden">
        <div className="border-b border-amber-100/70 bg-white/85 px-6 py-4 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-amber-700" />
                <span className="text-xs font-medium uppercase tracking-[0.16em] text-amber-700">当前文档</span>
              </div>
              <h1 className="mt-1 text-2xl font-semibold text-zinc-900">{report.sourceName}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">{report.understanding.summary}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600">自动保存：{autosaveState === "saved" ? "已保存" : autosaveState === "saving" ? "保存中" : autosaveState === "error" ? "失败" : "待修改"}</span>
              <Button
                className="bg-zinc-900 text-white hover:bg-zinc-800"
                onClick={() => void handleStartLoop(loopSession ? "publish_gate" : "manual_start", activeCard)}
              >
                {loopSession
                  ? loopSession.status === "ready_to_publish"
                    ? "结束本轮并准备发布"
                    : "继续本轮修订"
                  : "开始修订闭环"}
              </Button>
              <Button
                className="bg-amber-600 text-white hover:bg-amber-700"
                onClick={() => handleStartKnowledgeValidation()}
              >
                <MessageSquareText className="mr-2 h-4 w-4" />
                开始知识验证
              </Button>
            </div>
          </div>
          {runtimeBar}
          {degradedMode && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {degradedMode}
            </div>
          )}
          {loopSession && (
            <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-700">
                <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-600">当前轮次：{loopSession.iteration}</span>
                <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-600">闭环状态：{loopStatusLabel(loopSession.status)}</span>
                <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-600">当前任务：{activeTask?.entryHint ?? "待分配"}</span>
                <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-600">已确认字段数：{confirmedFieldCount}</span>
                <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-600">原文质量分：{report.qualityScore}</span>
                <span className={`rounded-full px-3 py-1 text-xs ${gateBadge(report.publishGate.status)}`}>发布门禁：{labelForGateStatus(report.publishGate.status)}</span>
              </div>
              {loopSession.feedbackTaskIds.length > 0 && (
                <p className="mt-2 text-xs text-amber-800">当前有来自 Wiki 健康检查的回流任务，建议优先补齐这些编译或检索缺口。</p>
              )}
            </div>
          )}
        </div>

        <div className="grid h-[calc(100%-1px)] min-h-0 gap-4 p-6 lg:grid-cols-[minmax(0,1.6fr)_360px]">
          <section className="min-h-0 overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-100 px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                    <MessageSquareText className="h-4 w-4 text-amber-700" />
                    统一修订对话框
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] text-amber-800">
                      {conversationStage === "revise" ? "修订优先" : "验证阶段"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-zinc-600">
                    所有修订建议、消息内确认、写回结果和知识验证，都在同一条线程里完成。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => void handleStartCard(activeCard)}>
                    <RefreshCcw className="mr-2 h-4 w-4" />
                    准备当前任务
                  </Button>
                  <Button variant="outline" onClick={() => setConversationStage("revise")}>
                    继续修订
                  </Button>
                  <Button variant="outline" onClick={() => handleStartKnowledgeValidation({
                    question: loopSession?.recommendedValidationQuestion ?? null,
                    selectAll: Boolean(loopSession?.recommendedValidationQuestion),
                  })}>
                    切到验证
                  </Button>
                </div>
              </div>
            </div>
            {revisionContext ? (
              <div className="h-[calc(100%-89px)] min-h-0">
                <ChatPanel
                  mode="revision-loop"
                  revisionContext={revisionContext}
                  hideSidebar
                  composerRequest={composerRequest}
                  loopStage={conversationStage}
                  onSendInRevisionLoop={(text, conversationId) => handleInteractiveSend(text, conversationId)}
                  onStopInRevisionLoop={() => {
                    validationAbortRef.current?.abort()
                    setStreaming(false)
                    useChatStore.setState({ streamingContent: "" })
                  }}
                  onAcceptSuggestion={async (message, editedMarkdown) => {
                    const suggestion = message.revisionMeta?.suggestion
                    if (!suggestion) return
                    await handleAcceptSuggestion(suggestion, editedMarkdown)
                    if (message.revisionMeta) {
                      updateChatMessage(message.id, {
                        revisionMeta: {
                          ...message.revisionMeta,
                          actionState: "accepted",
                        },
                      })
                    }
                  }}
                  onRequestStageSwitch={(stage, question) => {
                    if (stage === "validate") {
                      handleStartKnowledgeValidation({
                        question,
                        selectAll: Boolean(question),
                      })
                    } else {
                      setConversationStage("revise")
                      if (question?.trim()) {
                        setComposerRequest({
                          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                          text: question.trim(),
                          selectAll: true,
                          snapshotKey: revisionContext.revisionSnapshotKey ?? null,
                        })
                      }
                    }
                  }}
                  onPrepareFollowup={async (text) => {
                    setConversationStage("revise")
                    setComposerRequest({
                      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                      text,
                      selectAll: true,
                      snapshotKey: revisionContext.revisionSnapshotKey ?? null,
                    })
                  }}
                />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-sm text-zinc-500">
                当前还没有准备好统一修订线程。
              </div>
            )}
          </section>

          <aside className="min-h-0 overflow-auto space-y-4">
            <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                <Bot className="h-4 w-4 text-amber-700" />
                当前任务
              </div>
              {activeCard ? (
                <>
                  <p className="mt-3 text-base font-semibold text-zinc-900">{activeCard.issueTitle}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs ${severityBadge(activeCard.severity)}`}>{activeCard.severity}</span>
                    <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600">{activeCard.rootCause}</span>
                    {activeCard.blocking ? <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs text-red-700">阻塞发布</span> : null}
                  </div>
                  <p className="mt-4 text-sm leading-6 text-zinc-600">{activeCard.diagnosis}</p>
                  <div className="mt-4 rounded-2xl bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-700">
                    {activeCard.originalExcerpt}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button onClick={() => void handleStartCard(activeCard)}>
                      进入修订
                    </Button>
                    <Button variant="outline" onClick={() => void handleAcceptSuggestion({
                      id: `quick-${activeCard.cardId}`,
                      sessionId: `quick-${activeCard.cardId}`,
                      docId: report.docId,
                      cardId: activeCard.cardId,
                      targetFieldKey: activeCard.targetFieldKey,
                      targetBlockIds: [activeCard.primaryBlockId, activeCard.anchorBlockId].filter(Boolean) as string[],
                      anchorBlockId: activeCard.anchorBlockId,
                      actionType: "rewrite",
                      patchMode: activeCard.patchMode,
                      suggestionText: activeCard.suggestedRevision,
                      revisedMarkdown: activeCard.suggestedRevision,
                      rationale: activeCard.diagnosis,
                      writeTarget: activeCard.targetFieldKey ? "both" : "draft",
                      createdAt: new Date().toISOString(),
                    })}>
                      直接采纳
                    </Button>
                  </div>
                </>
              ) : (
                <p className="mt-3 text-sm text-zinc-500">当前还没有可用的问题卡。</p>
              )}
            </section>

            <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                质量与发布
              </div>
              <div className="mt-4 rounded-3xl bg-zinc-950 px-5 py-6 text-white">
                <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">原文质量分</p>
                <div className="mt-2 flex items-end gap-3">
                  <span className="text-4xl font-semibold">{report.qualityScore}</span>
                  <span className="pb-1 text-sm text-zinc-400">/100</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-300">{report.qualitySummary}</p>
              </div>
              <div className="mt-4 space-y-2 text-sm text-zinc-600">
                <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-3 py-2">
                  <span>闭环状态</span>
                  <span>{loopStatusLabel(loopSession?.status ?? "idle")}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-3 py-2">
                  <span>当前任务</span>
                  <span>{activeTask?.entryHint ?? "待分配"}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-3 py-2">
                  <span>已确认字段</span>
                  <span>{confirmedFieldCount}</span>
                </div>
              </div>
              <div className="mt-4 space-y-2 rounded-2xl bg-zinc-50 px-4 py-4">
                <p className="text-sm font-medium text-zinc-900">发布门禁摘要</p>
                {report.publishGate.rules.map((rule) => (
                  <div key={rule.ruleKey} className="rounded-2xl bg-white px-3 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-zinc-900">{rule.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${gateBadge(rule.status)}`}>
                        {rule.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">{rule.message}</p>
                  </div>
                ))}
                {report.publishGate.status === "fail" ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 text-red-600" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-red-700">当前发布为高风险 override</p>
                        <p className="mt-1 text-xs leading-5 text-red-600">
                          仍然允许发布，但需要记录为什么这次接受高风险。
                        </p>
                        <textarea
                          className="mt-3 min-h-[88px] w-full rounded-xl border border-red-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none"
                          placeholder="请填写 override_reason，例如：这次先用于内部演练，关键判断将在下一轮访谈补齐。"
                          value={overrideReason}
                          onChange={(event) => setOverrideReason(event.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              <Button className="mt-4 w-full" onClick={() => void handlePublish()}>
                <FilePenLine className="mr-2 h-4 w-4" />
                {report.publishGate.status === "fail" ? "仍然发布（高风险）" : "发布一个修订版本"}
              </Button>
            </section>

            <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                <Sparkles className="h-4 w-4 text-amber-700" />
                结构覆盖与下一步
              </div>
              <div className="mt-4 space-y-3">
                {report.fieldAssessments.slice(0, 6).map((assessment) => (
                  <div key={assessment.fieldKey} className="rounded-2xl bg-zinc-50/70 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-zinc-900">{assessment.label}</p>
                      <span className={`rounded-full px-2.5 py-1 text-xs ${statusBadge(assessment.status)}`}>
                        {assessment.status}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-zinc-500">{assessment.recommendedAction}</p>
                  </div>
                ))}
                {loopSession?.recommendedValidationQuestion ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">下一轮推荐验证</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-700">{loopSession.recommendedValidationQuestion}</p>
                  </div>
                ) : null}
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  )
}
