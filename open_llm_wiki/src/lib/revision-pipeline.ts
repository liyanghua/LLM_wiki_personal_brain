import { streamChat } from "@/lib/llm-client"
import { extractJsonObject } from "@/lib/sweep-reviews"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import type { LlmConfig } from "@/stores/wiki-store"
import { createDirectory, writeFile } from "@/commands/fs"
import type { LintResult } from "@/lib/lint"
import type {
  AgentLoopSession,
  AgentModeReport,
  GroundTruthDraft,
  GroundTruthFieldStatus,
  ImprovementActionType,
  InteractiveMessage,
  InteractiveSession,
  LoopTask,
  RevisionDraft,
  RevisionIssueCard,
  RevisionPatch,
  RevisionSuggestion,
  RevisionVersion,
  ScenePack,
  TriggerSource,
} from "@/lib/agent-mode-types"
import {
  appendQualityDraftReport,
  ensureWorkingDraft,
  loadAgentModeReports,
  loadRevisionVersions,
  makeVersionFileName,
  projectDocTitle,
  saveAgentModeReport,
  saveAgentLoopSession,
  renderDraftMarkdown,
  saveGroundTruthDraftSnapshot,
  saveRevisionDraft,
  saveRevisionPatches,
  saveRevisionVersion,
  saveRevisionVersions,
} from "@/lib/agent-mode-persist"
import { saveWikiHealthReport, runWikiHealthAudit } from "@/lib/wiki-health"
import { ensureScenePack } from "@/lib/scene-pack"
import { runStep15Structuring } from "@/lib/structuring"
import { writeSceneCompile } from "@/lib/scene-compile"
import { writeStrategyBundle } from "@/lib/strategy-compile"
import { rebuildSemanticUnitIndex } from "@/lib/semantic-units"

interface PublishRevisionOptions {
  llmConfig?: LlmConfig
  overrideReason?: string
  runSemanticLint?: boolean
}

const FEEDBACK_ROOT_CAUSES = new Set<LintResult["rootCause"]>([
  "compile_field_drop",
  "compile_missing_source_ref_projection",
  "compile_missing_stage_mapping",
  "retrieval_not_indexed",
  "retrieval_priority_miss",
  "retrieval_grounding_gap",
])

function nextId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function makeMessage(role: InteractiveMessage["role"], content: string): InteractiveMessage {
  return {
    id: nextId("msg"),
    role,
    content,
    createdAt: new Date().toISOString(),
  }
}

function lineRangeForBlock(
  report: AgentModeReport,
  blockId: string | null,
): { start: number; end: number } | null {
  if (!blockId) return null
  const block = report.documentIr.blocks.find((item) => item.blockId === blockId)
  if (!block) return null
  return { start: block.lineStart, end: block.lineEnd }
}

function fallbackPatchMode(card: RevisionIssueCard | undefined): RevisionSuggestion["patchMode"] {
  if (!card) return "replace"
  return card.patchMode
}

function taskPriorityFromSeverity(severity: RevisionIssueCard["severity"]): LoopTask["priority"] {
  if (severity === "P1") return "high"
  if (severity === "P2") return "medium"
  return "low"
}

function recommendValidationQuestion(
  card: Pick<RevisionIssueCard, "followupQuestion" | "issueTitle" | "targetFieldKey"> | null | undefined,
): string | null {
  if (!card) return null
  if (card.followupQuestion?.trim()) return card.followupQuestion.trim()
  if (card.targetFieldKey === "judgment_criteria") return "现在这份文档是否已经写清楚：什么情况算差、合格、优秀？"
  if (card.targetFieldKey === "validation_methods") return "现在这份文档是否已经写清楚：动作之后看什么数据来验证有效？"
  return `现在回看「${card.issueTitle}」，答案是否已经能被一线同事直接执行？`
}

function toLoopTask(card: RevisionIssueCard): LoopTask {
  return {
    taskId: `loop-task-${card.cardId}`,
    taskType: "revision_card",
    docId: "",
    linkedCardId: card.cardId,
    linkedLintIssueId: null,
    targetFieldKey: card.targetFieldKey,
    priority: taskPriorityFromSeverity(card.severity),
    status: card.status === "deferred" ? "deferred" : "open",
    entryHint: card.issueTitle,
    whyNow: card.diagnosis,
  }
}

function sortLoopTasks(tasks: LoopTask[]): LoopTask[] {
  const rank = { high: 3, medium: 2, low: 1 }
  return [...tasks].sort((a, b) => rank[b.priority] - rank[a.priority])
}

function deriveLoopStatus(
  report: AgentModeReport,
  tasks: LoopTask[],
  feedbackTaskIds: string[],
): AgentLoopSession["status"] {
  if (feedbackTaskIds.length > 0) return "feedback_pending"
  const openBlockingCards = report.revisionIssueCards.filter(
    (card) =>
      card.blocking
      && !["resolved", "accepted", "edited", "dismissed", "deferred"].includes(card.status),
  )
  const activeOrOpen = tasks.filter((task) => task.status === "open" || task.status === "active")
  if (openBlockingCards.length === 0 && report.publishGate.status !== "fail" && activeOrOpen.length === 0) {
    return "ready_to_publish"
  }
  if (activeOrOpen.length > 0) return "active"
  return "awaiting_expert"
}

function selectNextActiveTask(tasks: LoopTask[]): LoopTask | null {
  const next = sortLoopTasks(tasks).find((task) => task.status === "open" || task.status === "active")
  return next ?? null
}

export function createAgentLoopSession(
  report: AgentModeReport,
  triggerSource: TriggerSource,
  options?: { activeCardId?: string | null; feedbackTask?: LoopTask | null; previous?: AgentLoopSession | null },
): AgentLoopSession {
  const previous = options?.previous ?? null
  const completedIds = new Set(previous?.completedCardIds ?? [])
  const deferredIds = new Set(previous?.deferredCardIds ?? [])
  const baseTasks = report.revisionIssueCards.map((card) => ({
    ...toLoopTask(card),
    docId: report.docId,
  }))
  const feedbackTasks = options?.feedbackTask
    ? [{ ...options.feedbackTask, docId: report.docId }]
    : []
  const mergedTasks = sortLoopTasks([...baseTasks, ...feedbackTasks]).map((task) => {
    const isCompleted = task.linkedCardId ? completedIds.has(task.linkedCardId) : false
    const isDeferred = task.linkedCardId ? deferredIds.has(task.linkedCardId) : false
    const isExplicit = task.linkedCardId && task.linkedCardId === (options?.activeCardId ?? null)
    return {
      ...task,
      status: isCompleted ? "resolved" : isDeferred ? "deferred" : isExplicit ? "active" : task.status,
    }
  })
  const nextTask = mergedTasks.find((task) => task.status === "active") ?? selectNextActiveTask(mergedTasks)
  const now = new Date().toISOString()
  const feedbackTaskIds = feedbackTasks.map((task) => task.taskId)
  const session: AgentLoopSession = {
    loopId: previous?.loopId ?? nextId("loop"),
    docId: report.docId,
    status: deriveLoopStatus(report, mergedTasks, feedbackTaskIds),
    triggerSource,
    iteration: previous ? previous.iteration + 1 : 1,
    activeTaskId: nextTask?.taskId ?? null,
    activeCardId: nextTask?.linkedCardId ?? options?.activeCardId ?? null,
    completedCardIds: previous?.completedCardIds ?? [],
    deferredCardIds: previous?.deferredCardIds ?? [],
    feedbackTaskIds,
    lastRecomputeAt: null,
    lastRecomputeMode: "partial",
    startedAt: previous?.startedAt ?? now,
    updatedAt: now,
    recommendedValidationQuestion: recommendValidationQuestion(
      report.revisionIssueCards.find((card) => card.cardId === (nextTask?.linkedCardId ?? options?.activeCardId ?? null)),
    ),
    tasks: mergedTasks,
  }
  return session
}

export function createWikiFeedbackTask(report: AgentModeReport, lint: LintResult): LoopTask | null {
  if (!lint.linkedDocId || lint.linkedDocId !== report.docId) return null
  if (!FEEDBACK_ROOT_CAUSES.has(lint.rootCause)) return null
  return {
    taskId: `wiki-feedback-${lint.issueId}`,
    taskType: "wiki_feedback",
    docId: report.docId,
    linkedCardId: report.revisionIssueCards.find((card) =>
      (lint.linkedIssueIds ?? []).includes(card.issueId),
    )?.cardId ?? null,
    linkedLintIssueId: lint.issueId,
    targetFieldKey: report.revisionIssueCards.find((card) =>
      (lint.linkedIssueIds ?? []).includes(card.issueId),
    )?.targetFieldKey ?? null,
    priority: lint.blocking ? "high" : "medium",
    status: "open",
    entryHint: "来自 Wiki 健康检查的回流任务",
    whyNow: lint.detail,
  }
}

function applySinglePatch(baseContent: string, report: AgentModeReport, patch: RevisionPatch): string {
  const normalized = baseContent.replace(/\r\n/g, "\n")
  const lines = normalized.split("\n")
  const targetId = patch.patchMode === "insert_after" ? patch.anchorBlockId : patch.targetBlockIds[0] ?? patch.anchorBlockId
  const range = lineRangeForBlock(report, targetId)
  const patchLines = patch.revisedMarkdown.replace(/\r\n/g, "\n").split("\n")

  if (patch.patchMode === "confirm_only") {
    return lines.join("\n")
  }

  if (!range) {
    return `${lines.join("\n").trim()}\n\n${patch.revisedMarkdown.trim()}\n`
  }

  if (patch.patchMode === "insert_after") {
    const before = lines.slice(0, range.end)
    const after = lines.slice(range.end)
    return [...before, "", ...patchLines, ...after].join("\n")
  }

  if (patch.patchMode === "split_block") {
    const before = lines.slice(0, range.start - 1)
    const current = lines.slice(range.start - 1, range.end)
    const after = lines.slice(range.end)
    return [...before, ...current, "", ...patchLines, ...after].join("\n")
  }

  const before = lines.slice(0, range.start - 1)
  const after = lines.slice(range.end)
  return [...before, ...patchLines, ...after].join("\n")
}

export function rebuildDraftContent(
  draft: RevisionDraft,
  report: AgentModeReport,
): string {
  return draft.appliedPatches.reduce(
    (content, patch) => applySinglePatch(content, report, patch),
    draft.baseContent,
  )
}

function createPatchFromSuggestion(
  suggestion: RevisionSuggestion,
): RevisionPatch {
  const revisedMarkdown = (suggestion.revisedMarkdown ?? suggestion.suggestionText ?? "").trim()
  return {
    patchId: nextId("patch"),
    cardId: suggestion.cardId ?? null,
    targetBlockIds: Array.isArray(suggestion.targetBlockIds) ? suggestion.targetBlockIds : [],
    anchorBlockId: suggestion.anchorBlockId ?? null,
    patchMode: suggestion.patchMode ?? "replace",
    revisedMarkdown,
    appliedAt: new Date().toISOString(),
  }
}

function fallbackAssistantReply(card: RevisionIssueCard | undefined): string {
  if (!card) return "我已经把这轮补充整理成一版可确认的修订建议。"
  if (card.followupQuestion) {
    return `我先围绕这张修订卡整理了一版建议。如果这段还缺依据，我们可以继续追问：${card.followupQuestion}`
  }
  return "我已经把这轮补充整理成一版更可执行的修订建议，你可以直接采纳或改一下再采纳。"
}

export async function buildInitialRevisionDraft(
  projectPath: string,
  report: AgentModeReport,
): Promise<RevisionDraft> {
  return ensureWorkingDraft(
    projectPath,
    report.docId,
    report.sourcePath,
    report.sourceContent,
  )
}

export function createInteractiveSession(
  report: AgentModeReport,
  card?: RevisionIssueCard | null,
): InteractiveSession {
  const seed = card?.followupQuestion
    ?? card?.diagnosis
    ?? "请围绕这张修订卡补充更完整的专家表达。"
  return {
    sessionId: nextId("session"),
    docId: report.docId,
    sceneId: report.sceneId,
    taskId: card ? `task-from-${card.cardId}` : null,
    cardId: card?.cardId ?? null,
    primaryBlockId: card?.primaryBlockId ?? null,
    anchorBlockId: card?.anchorBlockId ?? null,
    targetBlockIds: [card?.primaryBlockId, card?.anchorBlockId].filter(Boolean) as string[],
    targetFieldKey: card?.targetFieldKey ?? null,
    goal: "clarify",
    sessionGoal: card?.issueTitle ?? "围绕当前修订卡补齐信息",
    status: "active",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [
      makeMessage(
        "assistant",
        [
          `这次修订会话聚焦在「${card?.issueTitle ?? "当前问题定位"}」。`,
          "",
          "如果这里带入了来自知识验证的启发性补充，请先判断它是否适用于当前业务，再决定是否写回主稿。",
          "",
          seed,
        ].join("\n"),
      ),
    ],
    writebackPreview: card?.suggestedRevision ?? null,
    latestSuggestion: null,
  }
}

interface InteractiveTurnInput {
  session: InteractiveSession
  report: AgentModeReport
  scenePack: ScenePack
  userAnswer: string
  llmConfig: LlmConfig
  signal?: AbortSignal
}

type LlmSuggestionJson = Partial<{
  assistant_reply: string
  revision_suggestion: {
    action_type: ImprovementActionType
    suggestion_text: string
    revised_markdown: string
    rationale: string
    write_target: "draft" | "ground_truth" | "both"
    patch_mode: RevisionSuggestion["patchMode"]
  }
}>

function fallbackSuggestion(input: InteractiveTurnInput, card: RevisionIssueCard | undefined): RevisionSuggestion {
  const text = input.userAnswer.trim() || card?.suggestedRevision || ""
  return {
    id: nextId("suggestion"),
    sessionId: input.session.sessionId,
    docId: input.session.docId,
    cardId: input.session.cardId,
    targetFieldKey: input.session.targetFieldKey,
    targetBlockIds: input.session.targetBlockIds,
    anchorBlockId: input.session.anchorBlockId,
    actionType: "rewrite",
    patchMode: fallbackPatchMode(card),
    suggestionText: text,
    revisedMarkdown: text,
    rationale: "基于当前卡片与专家补充整理出的修订建议。",
    writeTarget: input.session.targetFieldKey ? "both" : "draft",
    createdAt: new Date().toISOString(),
  }
}

export async function runInteractiveTurn(
  input: InteractiveTurnInput,
): Promise<{ session: InteractiveSession; suggestion: RevisionSuggestion }> {
  const userMessage = makeMessage("user", input.userAnswer.trim())
  const card = input.report.revisionIssueCards.find((item) => item.cardId === input.session.cardId)
  let assistantReply = fallbackAssistantReply(card)
  let suggestion = fallbackSuggestion(input, card)

  if (hasUsableLlm(input.llmConfig)) {
    let output = ""
    let failed = false
    await streamChat(
      input.llmConfig,
      [
        {
          role: "system",
          content: [
            "你是一个业务文档修订助手。",
            "请围绕一张明确的修订卡工作，不要做泛化总结。",
            "先给一条简洁回复，再输出 JSON。",
            "JSON 格式为 {\"assistant_reply\":\"...\",\"revision_suggestion\":{\"action_type\":\"rewrite|supplement|clarify|confirm\",\"suggestion_text\":\"...\",\"revised_markdown\":\"...\",\"rationale\":\"...\",\"write_target\":\"draft|ground_truth|both\",\"patch_mode\":\"replace|insert_after|split_block|confirm_only\"}}。",
            "revised_markdown 必须是可直接写回主稿的内容。",
            "不要输出 JSON 之外的解释。",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `## 当前文档理解\n${input.report.understanding.summary}`,
            `## 当前修订卡\n${JSON.stringify(card, null, 2)}`,
            `## Scene guidance\n${JSON.stringify(input.scenePack.expertGuidanceProfile, null, 2)}`,
            `## Ground truth\n${JSON.stringify(input.report.groundTruth, null, 2)}`,
            `## 专家最新补充\n${input.userAnswer.trim()}`,
          ].join("\n\n"),
        },
      ],
      {
        onToken: (token) => {
          output += token
        },
        onDone: () => {},
        onError: () => {
          failed = true
        },
      },
      input.signal,
      { temperature: 0.2 },
    )

    if (!failed && output.trim()) {
      try {
        const parsed = JSON.parse(extractJsonObject(output)) as LlmSuggestionJson
        assistantReply = parsed.assistant_reply?.trim() || assistantReply
        const llmSuggestion = parsed.revision_suggestion
        if (llmSuggestion?.revised_markdown?.trim() || llmSuggestion?.suggestion_text?.trim()) {
          const markdown = llmSuggestion.revised_markdown?.trim()
            || llmSuggestion.suggestion_text?.trim()
            || suggestion.revisedMarkdown
          suggestion = {
            id: nextId("suggestion"),
            sessionId: input.session.sessionId,
            docId: input.session.docId,
            cardId: input.session.cardId,
            targetFieldKey: input.session.targetFieldKey,
            targetBlockIds: input.session.targetBlockIds,
            anchorBlockId: input.session.anchorBlockId,
            actionType: llmSuggestion.action_type ?? "rewrite",
            patchMode: llmSuggestion.patch_mode ?? fallbackPatchMode(card),
            suggestionText: llmSuggestion.suggestion_text?.trim() || markdown,
            revisedMarkdown: markdown,
            rationale: llmSuggestion.rationale?.trim() || "根据专家补充整理出的修订建议。",
            writeTarget: llmSuggestion.write_target ?? (input.session.targetFieldKey ? "both" : "draft"),
            createdAt: new Date().toISOString(),
          }
        }
      } catch {
        // keep fallback
      }
    }
  }

  const assistantMessage = makeMessage("assistant", assistantReply)
  const session: InteractiveSession = {
    ...input.session,
    updatedAt: new Date().toISOString(),
    messages: [...input.session.messages, userMessage, assistantMessage],
    writebackPreview: suggestion.revisedMarkdown,
    latestSuggestion: suggestion,
  }
  return { session, suggestion }
}

export function applySuggestionToGroundTruth(
  groundTruth: GroundTruthDraft,
  suggestion: RevisionSuggestion,
): GroundTruthDraft {
  const now = new Date().toISOString()
  const patchId = `patch-from-${suggestion.id}`
  if (!suggestion.targetFieldKey) {
    return {
      ...groundTruth,
      evidenceNotes: Array.from(new Set([...groundTruth.evidenceNotes, suggestion.suggestionText])),
      revisionCount: (groundTruth.revisionCount ?? 0) + 1,
      lastAcceptedCardId: suggestion.cardId ?? null,
      updatedAt: now,
      lastUpdatedAt: now,
    }
  }
  const fields = groundTruth.fields.map((field) =>
    field.key === suggestion.targetFieldKey
      ? {
          ...field,
          value: suggestion.revisedMarkdown.trim() || suggestion.suggestionText.trim(),
          status: (suggestion.patchMode === "confirm_only" ? "confirmed" : "revised") as GroundTruthFieldStatus,
          lastUpdatedAt: now,
          updatedFromCardId: suggestion.cardId ?? null,
          acceptedPatchIds: Array.from(new Set([...(field.acceptedPatchIds ?? []), patchId])),
        }
      : field,
  )
  return {
    ...groundTruth,
    fields,
    evaluationContentPath: groundTruth.evaluationContentPath,
    revisionCount: (groundTruth.revisionCount ?? 0) + 1,
    lastAcceptedCardId: suggestion.cardId ?? null,
    updatedAt: now,
    lastUpdatedAt: now,
  }
}

export function applyAcceptedSuggestionToDraft(
  draft: RevisionDraft,
  report: AgentModeReport,
  suggestion: RevisionSuggestion,
): RevisionDraft {
  const normalizedDraft: RevisionDraft = {
    ...draft,
    baseContent: draft.baseContent ?? draft.content ?? report.sourceContent,
    content: draft.content ?? report.sourceContent,
    appliedSuggestionIds: Array.isArray(draft.appliedSuggestionIds) ? draft.appliedSuggestionIds : [],
    appliedPatches: Array.isArray(draft.appliedPatches) ? draft.appliedPatches : [],
  }
  const patch = createPatchFromSuggestion(suggestion)
  const nextDraft: RevisionDraft = {
    ...normalizedDraft,
    updatedAt: new Date().toISOString(),
    appliedSuggestionIds: Array.from(new Set([...normalizedDraft.appliedSuggestionIds, suggestion.id])),
    appliedPatches: [...normalizedDraft.appliedPatches, patch],
  }
  return {
    ...nextDraft,
    content: rebuildDraftContent(nextDraft, report),
  }
}

export async function acceptSuggestionToAssets(
  projectPath: string,
  draft: RevisionDraft,
  groundTruth: GroundTruthDraft,
  report: AgentModeReport,
  suggestion: RevisionSuggestion,
): Promise<{ draft: RevisionDraft; groundTruth: GroundTruthDraft }> {
  void projectPath
  let nextDraft = draft
  let nextGroundTruth = groundTruth

  if (suggestion.writeTarget === "draft" || suggestion.writeTarget === "both") {
    nextDraft = applyAcceptedSuggestionToDraft(draft, report, suggestion)
  }
  if (suggestion.writeTarget === "ground_truth" || suggestion.writeTarget === "both") {
    nextGroundTruth = applySuggestionToGroundTruth(groundTruth, suggestion)
  }
  return { draft: nextDraft, groundTruth: nextGroundTruth }
}

export async function recomputeLoopAfterAcceptance(input: {
  projectPath: string
  report: AgentModeReport
  draft: RevisionDraft
  groundTruth: GroundTruthDraft
  acceptedCard: RevisionIssueCard
  llmConfig?: LlmConfig
  loopSession?: AgentLoopSession | null
}): Promise<{
  report: AgentModeReport
  loopSession: AgentLoopSession | null
}> {
  const scenePack = await ensureScenePack(input.projectPath, { defaultLanguage: "Chinese" })
  const nextReport = await runStep15Structuring({
    projectPath: input.projectPath,
    sourcePath: input.report.sourcePath,
    sourceContent: input.draft.content,
    analysis: input.report.analysis,
    scenePack,
    llmConfig: input.llmConfig ?? {
      provider: "openai",
      apiKey: "",
      model: "",
      ollamaUrl: "http://localhost:11434",
      customEndpoint: "",
      maxContextSize: 204800,
    },
  })

  const acceptedIds = new Set([
    ...(input.loopSession?.completedCardIds ?? []),
    input.acceptedCard.cardId,
  ])
  const deferredIds = new Set(input.loopSession?.deferredCardIds ?? [])
  const previousByField = new Map(
    input.report.revisionIssueCards
      .filter((card) => card.targetFieldKey)
      .map((card) => [card.targetFieldKey as string, card]),
  )
  const nextCards = nextReport.revisionIssueCards.map((card) => {
    const acceptedByField = card.targetFieldKey ? previousByField.get(card.targetFieldKey) : null
    const sameFieldAccepted = acceptedByField?.cardId === input.acceptedCard.cardId
    if (sameFieldAccepted) {
      return {
        ...card,
        cardId: input.acceptedCard.cardId,
        issueId: input.acceptedCard.issueId,
        status: "resolved" as const,
        suggestedRevision: input.acceptedCard.suggestedRevision,
      }
    }
    if (deferredIds.has(card.cardId)) {
      return { ...card, status: "deferred" as const }
    }
    return card
  })

  const mergedReport: AgentModeReport = {
    ...nextReport,
    groundTruth: {
      ...input.groundTruth,
      evaluationContentPath: `${input.projectPath}/deliverables/revised-docs/${input.report.docId}/draft.md`,
      updatedAt: input.groundTruth.updatedAt,
      lastUpdatedAt: input.groundTruth.lastUpdatedAt,
    },
    revisionIssueCards: nextCards,
    activeCriticalCardIds: nextCards
      .filter((card) => card.severity === "P1" || card.severity === "P2")
      .slice(0, 8)
      .map((card) => card.cardId),
  }

  const compileResult = await writeSceneCompile(input.projectPath, mergedReport, scenePack)
  const existingReports = await loadAgentModeReports(input.projectPath)
  await rebuildSemanticUnitIndex(input.projectPath, [...existingReports.filter((item) => item.docId !== mergedReport.docId), mergedReport])
  const strategyResult = await writeStrategyBundle(input.projectPath, mergedReport, scenePack, {
    llmConfig: input.llmConfig ?? null,
  })
  const finalizedReport: AgentModeReport = {
    ...mergedReport,
    supportingWikiPages: compileResult.supportingWikiPages,
    compilePlan: compileResult.plan,
    compileCoverage: compileResult.compileCoverage,
    compileIr: compileResult.compileIr,
    strategyBundle: strategyResult.bundle,
    strategyCoverage: strategyResult.coverage,
    confirmedStrategyCardIds: (strategyResult.bundle.actionCards ?? strategyResult.bundle.strategyCards)
      .filter((card) => card.status === "confirmed" || card.status === "promoted_to_skill")
      .map((card) => "actionCardId" in card ? card.actionCardId : card.cardId),
    warnings: [...mergedReport.warnings, ...compileResult.warnings, ...(strategyResult.bundle.warnings ?? [])],
    compileSidecar: {
      ...mergedReport.compileSidecar,
      warnings: [...mergedReport.warnings, ...compileResult.warnings, ...(strategyResult.bundle.warnings ?? [])],
      compilePlan: compileResult.plan,
      compileCoverage: compileResult.compileCoverage,
    },
  }

  if (!input.loopSession) {
    return { report: finalizedReport, loopSession: null }
  }

  const updatedTasks = sortLoopTasks(
    input.loopSession.tasks.map((task) => {
      if (task.linkedCardId === input.acceptedCard.cardId) {
        return { ...task, status: "resolved" as const }
      }
      if (deferredIds.has(task.linkedCardId ?? "")) {
        return { ...task, status: "deferred" as const }
      }
      return task
    }),
  )
  const nextActiveTask = selectNextActiveTask(updatedTasks)
  const nextLoop: AgentLoopSession = {
    ...input.loopSession,
    iteration: input.loopSession.iteration + 1,
    status: deriveLoopStatus(finalizedReport, updatedTasks, input.loopSession.feedbackTaskIds),
    activeTaskId: nextActiveTask?.taskId ?? null,
    activeCardId: nextActiveTask?.linkedCardId ?? null,
    completedCardIds: Array.from(acceptedIds),
    lastRecomputeAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    recommendedValidationQuestion: recommendValidationQuestion(
      finalizedReport.revisionIssueCards.find((card) => card.cardId === (nextActiveTask?.linkedCardId ?? null))
      ?? input.acceptedCard,
    ),
    tasks: updatedTasks.map((task) => ({
      ...task,
      status:
        nextActiveTask && task.taskId === nextActiveTask.taskId
          ? "active"
          : task.status === "active"
            ? "open"
            : task.status,
    })),
  }

  return { report: finalizedReport, loopSession: nextLoop }
}

function buildFeedbackTasks(report: AgentModeReport, wikiHealthReportPath: string | undefined, issues: LintResult[]): LoopTask[] {
  if (!wikiHealthReportPath) return []
  return issues
    .map((issue) => createWikiFeedbackTask(report, issue))
    .filter((task): task is LoopTask => Boolean(task))
}

export async function publishRevisionVersion(
  projectPath: string,
  report: AgentModeReport,
  draft: RevisionDraft,
  groundTruth: GroundTruthDraft,
  options?: PublishRevisionOptions & { loopSession?: AgentLoopSession | null },
): Promise<{ version: RevisionVersion; loopSession: AgentLoopSession | null }> {
  if (report.publishGate.status === "fail" && !options?.overrideReason?.trim()) {
    throw new Error("当前原文发布门禁为高风险，请先填写 override_reason。")
  }
  const existing = await loadRevisionVersions(projectPath)
  const versionId = makeVersionFileName(existing.filter((item) => item.docId === report.docId).length + 1)
  const revisedDir = `${projectPath}/deliverables/revised-docs/${report.docId}`
  const groundTruthDir = `${projectPath}/deliverables/ground-truth/${report.docId}`
  const reportDir = `${projectPath}/deliverables/reports/${report.docId}`
  const contentPath = `${revisedDir}/${versionId}.md`
  const groundTruthPath = `${groundTruthDir}/${versionId}.json`
  const qualityReportPath = `${reportDir}/quality-${versionId}.md`

  await createDirectory(revisedDir).catch(() => {})
  await createDirectory(groundTruthDir).catch(() => {})
  await createDirectory(reportDir).catch(() => {})

  const versionedMarkdown = renderDraftMarkdown(projectDocTitle(report.sourcePath), draft.content)
  const versionedQualityReport = [
    `# ${report.sourceName} 修订质量报告 ${versionId}`,
    "",
    `- 文档 ID：${report.docId}`,
    `- 修订版本：${versionId}`,
    `- 当前质量分：${report.qualityScore}/100`,
    `- 原文发布门禁：${report.publishGate.status}`,
    `- 高优先级问题：${report.reviewSummary.highPriorityCount}`,
    `- 已应用修订补丁：${draft.appliedPatches.length}`,
    options?.overrideReason?.trim() ? `- Override 原因：${options.overrideReason.trim()}` : "",
    "",
    "## 文档理解摘要",
    "",
    report.understanding.summary,
    "",
    "## 当前关键修订主题",
    "",
    report.reviewSummary.criticalThemes.map((item) => `- ${item}`).join("\n") || "- 暂无",
    "",
    "## 原文发布门禁",
    "",
    report.publishGate.rules.map((rule) => `- [${rule.status}] ${rule.label}：${rule.message}`).join("\n") || "- 暂无门禁规则",
    "",
    "## 结论",
    "",
    report.qualitySummary,
    "",
    `发布时间：${new Date().toISOString()}`,
  ].join("\n")

  await writeFile(contentPath, versionedMarkdown)
  await writeFile(groundTruthPath, JSON.stringify(groundTruth, null, 2))
  await writeFile(qualityReportPath, versionedQualityReport)

  await saveRevisionDraft(projectPath, {
    ...draft,
    content: versionedMarkdown,
  })
  await saveGroundTruthDraftSnapshot(projectPath, groundTruth)
  await saveRevisionPatches(projectPath, draft.docId, draft.appliedPatches)
  await appendQualityDraftReport(
    projectPath,
    report.docId,
    report.sourceName,
    report.qualityScore,
    report.qualitySummary,
  )

  const scenePack = await ensureScenePack(projectPath, { defaultLanguage: "Chinese" })
  const compiledReport = await runStep15Structuring({
    projectPath,
    sourcePath: report.sourcePath,
    sourceContent: draft.content,
    analysis: report.analysis,
    scenePack,
    llmConfig: options?.llmConfig ?? {
      provider: "openai",
      apiKey: "",
      model: "",
      ollamaUrl: "http://localhost:11434",
      customEndpoint: "",
      maxContextSize: 204800,
    },
  })
  const compileResult = await writeSceneCompile(projectPath, compiledReport, scenePack)
  const existingReports = await loadAgentModeReports(projectPath)
  await rebuildSemanticUnitIndex(projectPath, [...existingReports.filter((item) => item.docId !== compiledReport.docId), compiledReport])
  const strategyResult = await writeStrategyBundle(projectPath, compiledReport, scenePack, {
    llmConfig: options?.llmConfig ?? null,
  })
  const finalCompiledReport: AgentModeReport = {
    ...compiledReport,
    supportingWikiPages: compileResult.supportingWikiPages,
    compilePlan: compileResult.plan,
    compileCoverage: compileResult.compileCoverage,
    compileIr: compileResult.compileIr,
    strategyBundle: strategyResult.bundle,
    strategyCoverage: strategyResult.coverage,
    confirmedStrategyCardIds: (strategyResult.bundle.actionCards ?? strategyResult.bundle.strategyCards)
      .filter((card) => card.status === "confirmed" || card.status === "promoted_to_skill")
      .map((card) => "actionCardId" in card ? card.actionCardId : card.cardId),
    warnings: [...compiledReport.warnings, ...compileResult.warnings, ...(strategyResult.bundle.warnings ?? [])],
    compileSidecar: {
      ...compiledReport.compileSidecar,
      warnings: [...compiledReport.warnings, ...compileResult.warnings, ...(strategyResult.bundle.warnings ?? [])],
      compilePlan: compileResult.plan,
      compileCoverage: compileResult.compileCoverage,
    },
  }
  await saveAgentModeReport(projectPath, finalCompiledReport)

  const wikiHealthReport = options?.llmConfig
    ? await runWikiHealthAudit(projectPath, options.llmConfig, { runSemantic: options.runSemanticLint ?? true })
    : await runWikiHealthAudit(projectPath, null, { runSemantic: false })
  const wikiHealthReportPath = await saveWikiHealthReport(projectPath, wikiHealthReport)

  const version: RevisionVersion = {
    docId: report.docId,
    versionId,
    sourcePath: report.sourcePath,
    contentPath,
    groundTruthPath,
    qualityReportPath,
    publishedAt: new Date().toISOString(),
    wikiRebuildStatus: "done",
    sourcePublishGateStatus: report.publishGate.status,
    wikiPublishGateStatus: wikiHealthReport.publishGate.status,
    publishedWithOverride: Boolean(options?.overrideReason?.trim()),
    overrideReason: options?.overrideReason?.trim() || undefined,
    wikiHealthReportPath,
  }
  await saveRevisionVersion(projectPath, version)
  await saveRevisionVersions(projectPath, [version, ...existing])
  await saveGroundTruthDraftSnapshot(projectPath, finalCompiledReport.groundTruth)

  const feedbackIssues = [
    ...wikiHealthReport.compileResults,
    ...wikiHealthReport.retrievalResults,
  ].filter((item) => item.linkedDocId === report.docId)
  const feedbackTasks = buildFeedbackTasks(report, wikiHealthReportPath, feedbackIssues)
  const nextLoop = options?.loopSession
    ? {
        ...options.loopSession,
        status: feedbackTasks.length > 0 ? "feedback_pending" as const : "completed" as const,
        feedbackTaskIds: feedbackTasks.map((task) => task.taskId),
        activeTaskId: feedbackTasks[0]?.taskId ?? null,
        activeCardId: feedbackTasks[0]?.linkedCardId ?? null,
        updatedAt: new Date().toISOString(),
        recommendedValidationQuestion: feedbackTasks.length > 0
          ? "请回看这次发布后的知识问答：哪些问题仍然没有被稳定命中？"
          : options.loopSession.recommendedValidationQuestion,
        tasks: sortLoopTasks([
          ...options.loopSession.tasks.filter((task) => task.taskType !== "wiki_feedback"),
          ...feedbackTasks,
        ]).map((task, index) => ({
          ...task,
          status:
            feedbackTasks.length > 0 && index === 0 && task.taskType === "wiki_feedback"
              ? "active"
              : task.status,
        })),
      }
    : null

  if (nextLoop) {
    await saveAgentLoopSession(projectPath, nextLoop)
  }

  return { version, loopSession: nextLoop }
}
