import { useRef, useEffect, useCallback, useMemo, useState } from "react"
import { BookOpen, ChevronDown, Plus, Trash2, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChatMessage, StreamingMessage, useSourceFiles } from "./chat-message"
import { ChatInput } from "./chat-input"
import {
  useChatStore,
  chatMessagesToLLM,
  conversationMatchesScope,
  shouldShowConversationInSidebar,
  type ComposerRequest,
  type ConversationStage,
  type ChatImageEvidence,
  type KnowledgeAnswerMeta,
  type RevisionChatContext,
  type DisplayMessage,
} from "@/stores/chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import { streamChat, type ChatMessage as LLMMessage } from "@/lib/llm-client"
import { executeIngestWrites } from "@/lib/ingest"
import { listDirectory, readFile, deleteFile } from "@/commands/fs"
import { searchWiki } from "@/lib/search"
import { buildRetrievalGraph, getRelatedNodes } from "@/lib/graph-relevance"
import { normalizePath, getFileName, getRelativePath } from "@/lib/path-utils"
import { buildLanguageDirective, buildLanguageReminder } from "@/lib/output-language"
import { isGreeting } from "@/lib/greeting-detector"
import { computeContextBudget } from "@/lib/context-budget"
import { searchKnowledgeWorkspace } from "@/lib/revision-aware-search"
import {
  buildKnowledgeImageEvidenceContext,
  collectKnowledgeImageEvidence,
  hasVisualQuestionIntent,
} from "@/lib/knowledge-image-evidence"
import {
  formatImageEvidenceForPrompt,
  type KnowledgeImageHit,
  searchKnowledgeImages,
} from "@/lib/knowledge-image-index"
import { loadSemanticUnitIndex, semanticContextForQuery } from "@/lib/semantic-units"

// Store the page mapping from the last query so SourceFilesBar can show which pages were cited
export let lastQueryPages: { title: string; path: string }[] = []

const QA_META_RE = /<!--\s*qa-meta:\s*([\s\S]+?)\s*-->/
const CITED_RE = /<!--\s*cited:\s*.+?\s*-->/

function stripHiddenAnswerMeta(content: string): string {
  return content
    .replace(QA_META_RE, "")
    .replace(CITED_RE, "")
    .trim()
}

function buildPromptLanguageSeed(...parts: unknown[]): string {
  return parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part.length > 0)
    .join("\n\n")
}

function extractAnswerMeta(content: string): KnowledgeAnswerMeta | null {
  const match = content.match(QA_META_RE)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1]) as KnowledgeAnswerMeta
    return {
      supplements: Array.isArray(parsed.supplements)
        ? parsed.supplements.map((item, index) => ({
            supplementId: item.supplementId ?? `supplement-${index + 1}`,
            title: item.title?.trim() || "启发性补充",
            origin: item.origin === "evidence_extension" ? "evidence_extension" : "model_experience",
            disclaimer: item.disclaimer?.trim() || "这条内容目前不属于已确认底稿。",
            candidateSentence: item.candidateSentence?.trim() || "",
            rationale: item.rationale?.trim() || "",
            targetFieldKey: item.targetFieldKey ?? null,
            linkedCardId: item.linkedCardId ?? null,
            confidence: typeof item.confidence === "number" ? item.confidence : 0.5,
          }))
        : [],
    }
  } catch {
    return null
  }
}

function toChatImageEvidence(hits: KnowledgeImageHit[]): ChatImageEvidence[] {
  return hits.map((hit, index) => ({
    imageId: hit.imageId,
    displayId: `img-${index + 1}`,
    relPath: hit.relPath,
    caption: hit.caption || hit.fallbackCaption,
    fallbackCaption: hit.fallbackCaption,
    sourcePath: hit.sourcePath,
    page: hit.page,
    matchedReason: hit.matchedReason,
    status: hit.status,
    score: hit.score,
  }))
}

interface ChatPanelProps {
  mode?: "default" | "revision-aware" | "revision-loop"
  revisionContext?: RevisionChatContext
  hideSidebar?: boolean
  composerRequest?: ComposerRequest | null
  loopStage?: ConversationStage
  onSendInRevisionLoop?: (text: string, conversationId: string) => Promise<void> | void
  onStopInRevisionLoop?: () => void
  onAcceptSuggestion?: (message: DisplayMessage, editedMarkdown?: string) => Promise<void> | void
  onRequestStageSwitch?: (stage: ConversationStage, question?: string | null) => void
  onPrepareFollowup?: (text: string) => Promise<void> | void
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" })
}

function ConversationSidebar({
  scope,
  docId,
  loopId,
  onCreateConversation,
}: {
  scope?: "global" | "revision-workbench" | "revision-loop"
  docId?: string | null
  loopId?: string | null
  onCreateConversation?: () => void
}) {
  const conversations = useChatStore((s) => s.conversations)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const messages = useChatStore((s) => s.messages)
  const createConversation = useChatStore((s) => s.createConversation)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  const setActiveConversation = useChatStore((s) => s.setActiveConversation)

  const [hoveredId, setHoveredId] = useState<string | null>(null)

  function getMessageCount(convId: string): number {
    return messages.filter((m) => m.conversationId === convId).length
  }

  const scopedConversations = conversations.filter((conversation) => {
    if (scope && !conversationMatchesScope(conversation, scope, { docId, loopId })) return false
    return shouldShowConversationInSidebar(conversation, getMessageCount(conversation.id))
  })
  const sorted = [...scopedConversations].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="flex h-full w-[236px] flex-shrink-0 flex-col border-r bg-muted/30">
      <div className="border-b p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
          历史会话
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={() => {
            if (onCreateConversation) {
              onCreateConversation()
              return
            }
            createConversation()
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          {scope === "revision-workbench" ? "新建验证会话" : scope === "revision-loop" ? "打开当前线程" : "新建会话"}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {sorted.length === 0 ? (
          <p className="px-4 py-5 text-center text-xs leading-5 text-muted-foreground">
            {scope === "global"
              ? "暂无历史会话，发送问题后会自动保存"
              : "当前范围暂无会话"}
          </p>
        ) : (
          sorted.map((conv) => {
            const isActive = conv.id === activeConversationId
            const msgCount = getMessageCount(conv.id)
            return (
              <div
                key={conv.id}
                className={`group relative mx-1 my-0.5 flex cursor-pointer flex-col rounded-md px-2 py-1.5 text-sm transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-accent text-foreground"
                }`}
                onClick={() => setActiveConversation(conv.id)}
                onMouseEnter={() => setHoveredId(conv.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="line-clamp-2 flex-1 text-xs font-medium leading-snug">
                    {conv.title}
                  </span>
                  {hoveredId === conv.id && (
                    <button
                      className="flex-shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteConversation(conv.id)
                        // Delete persisted chat file
                        const proj = useWikiStore.getState().project
                        if (proj) {
                          deleteFile(`${proj.path}/.llm-wiki/chats/${conv.id}.json`).catch(() => {})
                        }
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span>{formatDate(conv.updatedAt)}</span>
                  {msgCount > 0 && (
                    <>
                      <span>·</span>
                      <span>{msgCount} 条消息</span>
                    </>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export function ChatPanel({
  mode: panelMode = "default",
  revisionContext,
  hideSidebar = false,
  composerRequest = null,
  loopStage = "revise",
  onSendInRevisionLoop,
  onStopInRevisionLoop,
  onAcceptSuggestion,
  onRequestStageSwitch,
  onPrepareFollowup,
}: ChatPanelProps = {}) {
  useSourceFiles() // Keep source file cache warm
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const streamingContent = useChatStore((s) => s.streamingContent)
  const streamingImageEvidence = useChatStore((s) => s.streamingImageEvidence)
  const mode = useChatStore((s) => s.mode)
  const addMessage = useChatStore((s) => s.addMessage)
  const setStreaming = useChatStore((s) => s.setStreaming)
  const setStreamingImageEvidence = useChatStore((s) => s.setStreamingImageEvidence)
  const appendStreamToken = useChatStore((s) => s.appendStreamToken)
  const finalizeStream = useChatStore((s) => s.finalizeStream)
  const createConversation = useChatStore((s) => s.createConversation)
  const ensureScopedConversation = useChatStore((s) => s.ensureScopedConversation)
  const removeLastAssistantMessage = useChatStore((s) => s.removeLastAssistantMessage)
  const maxHistoryMessages = useChatStore((s) => s.maxHistoryMessages)
  const setActiveConversation = useChatStore((s) => s.setActiveConversation)
  const conversations = useChatStore((s) => s.conversations)

  // Derive active messages via selector to re-render on message changes
  const allMessages = useChatStore((s) => s.messages)
  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId) ?? null,
    [conversations, activeConversationId],
  )
  const expectedScope =
    panelMode === "revision-aware"
      ? "revision-workbench"
      : panelMode === "revision-loop"
        ? "revision-loop"
        : "global"
  const scopeConversationIds = useMemo(
    () =>
      new Set(
        conversations
          .filter((conversation) =>
            conversationMatchesScope(conversation, expectedScope, {
              docId: revisionContext?.docId ?? null,
              loopId: revisionContext?.loopId ?? null,
            })
          )
          .map((conversation) => conversation.id),
      ),
    [conversations, expectedScope, revisionContext?.docId, revisionContext?.loopId],
  )
  const sidebarConversationIds = useMemo(
    () =>
      new Set(
        conversations
          .filter((conversation) => {
            if (!scopeConversationIds.has(conversation.id)) return false
            const messageCount = allMessages.filter((message) => message.conversationId === conversation.id).length
            return shouldShowConversationInSidebar(conversation, messageCount)
          })
          .map((conversation) => conversation.id),
      ),
    [allMessages, conversations, scopeConversationIds],
  )
  const hasScopedActiveConversation = activeConversationId
    ? scopeConversationIds.has(activeConversationId)
    : false
  const activeMessages = activeConversationId
    ? allMessages.filter((m) => m.conversationId === activeConversationId && scopeConversationIds.has(m.conversationId))
    : []

  const project = useWikiStore((s) => s.project)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const setFileTree = useWikiStore((s) => s.setFileTree)

  const abortRef = useRef<AbortController | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const shouldStickToBottomRef = useRef(true)
  const pendingStreamTokenRef = useRef("")
  const streamFlushTimerRef = useRef<number | null>(null)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)
  const readyComposerRequest = useMemo(() => {
    if (!composerRequest) return null
    if (panelMode !== "revision-aware") return composerRequest
    const expectedSnapshotKey = composerRequest.snapshotKey ?? null
    if (!expectedSnapshotKey) return composerRequest
    return expectedSnapshotKey === (revisionContext?.revisionSnapshotKey ?? null)
      ? composerRequest
      : null
  }, [composerRequest, panelMode, revisionContext?.revisionSnapshotKey])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const container = scrollContainerRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior })
  }, [])

  const updateBottomStickiness = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    const nearBottom = distanceFromBottom < 96
    shouldStickToBottomRef.current = nearBottom
    setShowJumpToBottom(!nearBottom && isStreaming)
  }, [isStreaming])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    container.addEventListener("scroll", updateBottomStickiness, { passive: true })
    updateBottomStickiness()
    return () => container.removeEventListener("scroll", updateBottomStickiness)
  }, [updateBottomStickiness])

  useEffect(() => {
    if (shouldStickToBottomRef.current) {
      requestAnimationFrame(() => scrollToBottom("auto"))
      setShowJumpToBottom(false)
    } else if (isStreaming) {
      setShowJumpToBottom(true)
    }
  }, [activeMessages.length, isStreaming, scrollToBottom, streamingContent, streamingImageEvidence])

  const flushPendingStreamTokens = useCallback(() => {
    if (streamFlushTimerRef.current !== null) {
      window.clearTimeout(streamFlushTimerRef.current)
      streamFlushTimerRef.current = null
    }
    const pending = pendingStreamTokenRef.current
    if (!pending) return
    pendingStreamTokenRef.current = ""
    appendStreamToken(pending)
  }, [appendStreamToken])

  const queueStreamToken = useCallback((token: string) => {
    pendingStreamTokenRef.current += token
    if (streamFlushTimerRef.current !== null) return
    streamFlushTimerRef.current = window.setTimeout(() => {
      streamFlushTimerRef.current = null
      const pending = pendingStreamTokenRef.current
      if (!pending) return
      pendingStreamTokenRef.current = ""
      appendStreamToken(pending)
    }, 60)
  }, [appendStreamToken])

  useEffect(() => () => {
    if (streamFlushTimerRef.current !== null) {
      window.clearTimeout(streamFlushTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if ((panelMode !== "revision-aware" && panelMode !== "revision-loop") || !project || !revisionContext?.docId) return

    const currentScope = activeConversation?.scope ?? "global"
    const currentDocId = activeConversation?.docId ?? null
    const currentLoopId = activeConversation?.loopId ?? null
    const expectedLoopId = revisionContext.loopId ?? null
    if (
      ((panelMode === "revision-aware" && currentScope === "revision-workbench")
        || (panelMode === "revision-loop" && currentScope === "revision-loop"))
      && currentDocId === revisionContext.docId
      && (panelMode !== "revision-loop" || currentLoopId === expectedLoopId)
    ) {
      return
    }

    const convId = ensureScopedConversation(panelMode === "revision-loop" ? "统一修订线程" : "修订后知识验证", {
      scope: panelMode === "revision-loop" ? "revision-loop" : "revision-workbench",
      docId: revisionContext.docId,
      loopId: panelMode === "revision-loop" ? (revisionContext.loopId ?? null) : null,
    })
    setActiveConversation(convId)
  }, [
    activeConversation?.docId,
    activeConversation?.loopId,
    activeConversation?.scope,
    ensureScopedConversation,
    panelMode,
    project,
    revisionContext?.docId,
    setActiveConversation,
  ])

  useEffect(() => {
    if (panelMode !== "default") return
    if (!activeConversationId || scopeConversationIds.has(activeConversationId)) return
    const latestGlobalConversation = conversations
      .filter((conversation) => sidebarConversationIds.has(conversation.id))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    setActiveConversation(latestGlobalConversation?.id ?? null)
  }, [activeConversationId, conversations, panelMode, scopeConversationIds, setActiveConversation, sidebarConversationIds])

  const handleCreateConversation = useCallback(() => {
    if ((panelMode === "revision-aware" || panelMode === "revision-loop") && revisionContext?.docId) {
      const convId = ensureScopedConversation(panelMode === "revision-loop" ? "统一修订线程" : "修订后知识验证", {
        scope: panelMode === "revision-loop" ? "revision-loop" : "revision-workbench",
        docId: revisionContext.docId,
        loopId: panelMode === "revision-loop" ? (revisionContext.loopId ?? null) : null,
      })
      setActiveConversation(convId)
      return
    }
    createConversation()
  }, [
    createConversation,
    ensureScopedConversation,
    panelMode,
    revisionContext?.docId,
    setActiveConversation,
  ])

  const handleSend = useCallback(
    async (text: string) => {
      // Auto-create a conversation if none is active
      let convId = useChatStore.getState().activeConversationId
      if (!convId || !scopeConversationIds.has(convId)) {
        convId = (panelMode === "revision-aware" || panelMode === "revision-loop") && revisionContext?.docId
          ? ensureScopedConversation(panelMode === "revision-loop" ? "统一修订线程" : "修订后知识验证", {
              scope: panelMode === "revision-loop" ? "revision-loop" : "revision-workbench",
              docId: revisionContext.docId,
              loopId: panelMode === "revision-loop" ? (revisionContext.loopId ?? null) : null,
            })
          : createConversation()
      }

      shouldStickToBottomRef.current = true
      setShowJumpToBottom(false)
      addMessage("user", text, { conversationId: convId })
      requestAnimationFrame(() => scrollToBottom("auto"))
      if (panelMode === "revision-loop") {
        await onSendInRevisionLoop?.(text, convId)
        return
      }
      setStreaming(true)
      setStreamingImageEvidence([])

      // Build system prompt with wiki context using graph-enhanced retrieval
      const systemMessages: LLMMessage[] = []
      let queryRefs: { title: string; path: string }[] = []
      let queryImageEvidence: ChatImageEvidence[] = []
      let langReminder: string | undefined
      // Pure greetings ("hi", "你好", "嗨") don't warrant running the whole
      // retrieval pipeline — it's slow, costs context, and drags in random
      // wiki pages the user clearly didn't ask about. Short-circuit with a
      // minimal system prompt and let the model reply conversationally.
      const greetingOnly = isGreeting(text)
      if (project && greetingOnly) {
        const languageSeed = buildPromptLanguageSeed(text, project.name)
        systemMessages.push({
          role: "system",
          content: [
            buildLanguageDirective(languageSeed),
            "",
            `You are a wiki assistant for the project "${project.name}".`,
            "The user sent a casual greeting — reply briefly and naturally, in one or two sentences.",
            "Do NOT invent wiki content or pretend to have retrieved pages. Invite the user to ask a concrete question if they want information from the wiki.",
          ].join("\n"),
        })
        langReminder = buildLanguageReminder(languageSeed)
        // Skip retrieval; queryRefs stays empty so no "Sources" chip is shown.
      } else if (project) {
        const pp = normalizePath(project.path)
        const dataVersion = useWikiStore.getState().dataVersion

        // ── Budget allocation (see context-budget.ts) ─────────
        // Page budget scales with the LLM's context window; we now
        // also reserve ~15% as headroom for the response so the
        // model isn't truncated mid-sentence on a packed prompt.
        const {
          indexBudget: INDEX_BUDGET,
          pageBudget: PAGE_BUDGET,
          maxPageSize: MAX_PAGE_SIZE,
        } = computeContextBudget(llmConfig.maxContextSize)

        const [rawIndex, purpose] = await Promise.all([
          readFile(`${pp}/wiki/index.md`).catch(() => ""),
          readFile(`${pp}/purpose.md`).catch(() => ""),
        ])

        if (panelMode === "revision-aware" && revisionContext?.docId) {
          const languageSeed = buildPromptLanguageSeed(
            text,
            project.name,
            purpose,
            rawIndex.slice(0, 1200),
            revisionContext.selectedCardTitle,
            revisionContext.selectedCardDiagnosis,
            revisionContext.groundTruthSummary,
          )
          const retrieval = await searchKnowledgeWorkspace({
            projectPath: pp,
            query: text,
            draft: revisionContext.draft ?? null,
            groundTruth: revisionContext.groundTruth ?? null,
            selectedCardId: revisionContext.selectedCardId ?? null,
            selectedBlockIds: revisionContext.selectedBlockIds ?? [],
            selectedTargetFieldKey: revisionContext.selectedTargetFieldKey ?? null,
            lastAcceptedCardId: revisionContext.lastAcceptedCardId ?? null,
          })
          if (hasVisualQuestionIntent(text)) {
            const imageHits = await searchKnowledgeImages(pp, text, { limit: 8 }).catch((err) => {
              console.warn("[chat:revision-image-index] failed", err)
              return []
            })
            queryImageEvidence = toChatImageEvidence(imageHits)
            if (queryImageEvidence.length > 0) {
              setStreamingImageEvidence(queryImageEvidence)
            }
          }
          const semanticContext = semanticContextForQuery(
            await loadSemanticUnitIndex(pp).catch(() => ({
              schemaVersion: "semantic_units_v1" as const,
              projectId: "local-project",
              generatedAt: new Date().toISOString(),
              units: [],
              relations: [],
              conflicts: [],
            })),
            text,
          )

          systemMessages.push({
            role: "system",
            content: [
              buildLanguageDirective(languageSeed),
              "",
              "You are a business knowledge validation assistant working inside a revision workbench.",
              "Answer with the current working draft as the PRIMARY source of truth.",
              "If the working draft conflicts with published wiki pages, prefer the working draft and explicitly say it is the current revision version.",
              "Only use the project wiki as a supplement when the draft or business draft is incomplete.",
              "",
              "## Required answer shape",
              "1. 直接答案",
              "2. 依据",
              "3. 当前依据来自：修订稿 / wiki / 两者 / 资料不足",
              "4. 启发性补充（可选）",
              "5. 可纳入修订的建议句（可选）",
              "",
              "## Rules",
              "- ‘直接答案 / 依据 / 当前依据来自’ 只能基于提供给你的修订稿、业务底稿和项目 wiki。",
              "- 如果当前资料已足够回答，就不要强行生成启发性补充。",
              "- 如果当前资料不完整，但你能给出有帮助的延展，请把它放进“启发性补充”，不能混进“直接答案”。",
              "- 启发性补充只能使用这两种来源标签之一：",
              "  - 来源：基于当前资料的延展",
              "  - 来源：基于通用业务经验，尚未在当前底稿确认",
              "- 若给出“可纳入修订的建议句”，必须明确说这是一条待专家确认的候选表达。",
              "- If the current document does not cover the question, say so clearly before using broader wiki context.",
              "- Use [[wikilink]] syntax when referring to wiki pages.",
              "- If the user asks about visual design, image details, examples, layout, composition, or hero-image improvement AND Image Evidence exists, include a section named `图片案例`.",
              "- In `图片案例`, embed the relevant images directly using the provided Markdown lines from Image Evidence, then explain what design detail each image supports.",
              "- Do not invent image URLs. Only use images listed in Image Evidence.",
              "- At the VERY END of your response, add a hidden comment listing which references you used:",
              "  <!-- cited: 1, 2 -->",
              "- If you provide any 启发性补充, append one more hidden comment at the VERY END after cited refs:",
              "  <!-- qa-meta: {\"supplements\":[{\"supplementId\":\"supp-1\",\"title\":\"启发性补充\",\"origin\":\"evidence_extension|model_experience\",\"disclaimer\":\"这条内容目前不属于已确认底稿。\",\"candidateSentence\":\"...\",\"rationale\":\"...\",\"targetFieldKey\":\"...\",\"linkedCardId\":\"...\",\"confidence\":0.72}]} -->",
              "- If there is no 启发性补充, do not output qa-meta.",
              "",
              purpose ? `## 项目目的\n${purpose}` : "",
              rawIndex ? `## 项目索引\n${rawIndex.slice(0, INDEX_BUDGET)}` : "",
              revisionContext.selectedCardTitle ? `## 当前问题卡\n${revisionContext.selectedCardTitle}` : "",
              revisionContext.selectedCardDiagnosis ? `## 当前问题卡诊断\n${revisionContext.selectedCardDiagnosis}` : "",
              revisionContext.groundTruthSummary ? `## 当前业务底稿摘要\n${revisionContext.groundTruthSummary}` : "",
              semanticContext,
              ...retrieval.promptSections,
            ].filter(Boolean).join("\n"),
          })

          lastQueryPages = retrieval.references.map((ref) => ({
            title: ref.title,
            path: ref.path,
          }))
          queryRefs = retrieval.references
          langReminder = buildLanguageReminder(languageSeed)
        } else {

        // ── Phase 1: Tokenized search → top 10 ────────────────
        const searchResults = await searchWiki(pp, text)
        const topSearchResults = searchResults.slice(0, 10)

        // ── Trim index by relevance if over budget ─────────────
        let index = rawIndex
        if (rawIndex.length > INDEX_BUDGET) {
          const { tokenizeQuery } = await import("@/lib/search")
          const tokens = tokenizeQuery(text)
          const lines = rawIndex.split("\n")
          const keptLines: string[] = []
          let keptSize = 0

          for (const line of lines) {
            const isHeader = line.startsWith("##")
            const lower = line.toLowerCase()
            const isRelevant = tokens.some((t) => lower.includes(t))

            if (isHeader || isRelevant) {
              if (keptSize + line.length + 1 <= INDEX_BUDGET) {
                keptLines.push(line)
                keptSize += line.length + 1
              }
            }
          }
          index = keptLines.join("\n")
          if (index.length < rawIndex.length) {
            index += "\n\n[...index trimmed to relevant entries...]"
          }
        }

        // ── Phase 2: Graph 1-level expansion ───────────────────
        // Note: Vector search (if enabled) is already merged into searchResults
        // by searchWiki() in search.ts — no duplicate code needed here.
        const graph = await buildRetrievalGraph(pp, dataVersion)
        const expandedIds = new Set<string>()
        const searchHitPaths = new Set(topSearchResults.map((r) => r.path))
        const graphExpansions: { title: string; path: string; relevance: number }[] = []

        for (const result of topSearchResults) {
          const fileName = getFileName(result.path)
          const nodeId = fileName.replace(/\.md$/, "")
          const related = getRelatedNodes(nodeId, graph, 3)
          for (const { node, relevance } of related) {
            if (relevance < 2.0) continue
            if (searchHitPaths.has(node.path)) continue
            if (expandedIds.has(node.id)) continue
            expandedIds.add(node.id)
            graphExpansions.push({ title: node.title, path: node.path, relevance })
          }
        }
        graphExpansions.sort((a, b) => b.relevance - a.relevance)

        // ── Phase 3 & 4: Page budget control ───────────────────
        let usedChars = 0
        type PageEntry = { title: string; path: string; content: string; priority: number }
        const relevantPages: PageEntry[] = []

        const tryAddPage = async (title: string, filePath: string, priority: number): Promise<boolean> => {
          if (usedChars >= PAGE_BUDGET) return false
          try {
            const raw = await readFile(filePath)
            const relativePath = getRelativePath(filePath, pp)
            const truncated = raw.length > MAX_PAGE_SIZE
              ? raw.slice(0, MAX_PAGE_SIZE) + "\n\n[...truncated...]"
              : raw
            if (usedChars + truncated.length > PAGE_BUDGET) return false
            usedChars += truncated.length
            relevantPages.push({ title, path: relativePath, content: truncated, priority })
            return true
          } catch { return false }
        }

        // P0: Title matches
        for (const r of topSearchResults.filter((r) => r.titleMatch)) {
          await tryAddPage(r.title, r.path, 0)
        }
        // P1: Content matches
        for (const r of topSearchResults.filter((r) => !r.titleMatch)) {
          await tryAddPage(r.title, r.path, 1)
        }
        // P2: Graph expansions
        for (const exp of graphExpansions) {
          await tryAddPage(exp.title, exp.path, 2)
        }
        // P3: Overview fallback
        if (relevantPages.length === 0) {
          await tryAddPage("全局概览", `${pp}/wiki/overview.md`, 3)
        }

        const pagesContext = relevantPages.length > 0
          ? relevantPages.map((p, i) =>
              `### [${i + 1}] ${p.title}\nPath: ${p.path}\n\n${p.content}`
            ).join("\n\n---\n\n")
          : "(No wiki pages found)"

        const imageEvidence = collectKnowledgeImageEvidence(
          text,
          topSearchResults,
          relevantPages,
          pp,
        )
        const indexedImageHits = hasVisualQuestionIntent(text)
          ? await searchKnowledgeImages(pp, text, { limit: 8 }).catch((err) => {
              console.warn("[chat:image-index] failed", err)
              return []
            })
          : []
        queryImageEvidence = toChatImageEvidence(indexedImageHits)
        if (queryImageEvidence.length > 0) {
          setStreamingImageEvidence(queryImageEvidence)
        }
        const imageEvidenceContext = [
          buildKnowledgeImageEvidenceContext(imageEvidence),
          formatImageEvidenceForPrompt(indexedImageHits),
        ].filter(Boolean).join("\n\n")
        const semanticContext = semanticContextForQuery(
          await loadSemanticUnitIndex(pp).catch(() => ({
            schemaVersion: "semantic_units_v1" as const,
            projectId: "local-project",
            generatedAt: new Date().toISOString(),
            units: [],
            relations: [],
            conflicts: [],
          })),
          text,
        )

        const pageList = relevantPages.map((p, i) =>
          `[${i + 1}] ${p.title} (${p.path})`
        ).join("\n")

        const languageSeed = buildPromptLanguageSeed(
          text,
          project.name,
          purpose,
          index,
          pageList,
        )

        systemMessages.push({
          role: "system",
          content: [
            buildLanguageDirective(languageSeed),
            "",
            "You are a knowledgeable business knowledge assistant. Answer questions based on the wiki content provided below.",
            "",
            "## Rules",
            "- Answer based ONLY on the numbered wiki pages provided below.",
            "- If the provided pages don't contain enough information, say so honestly.",
            "- Use [[wikilink]] syntax to reference wiki pages.",
            "- When citing information, use the page number in brackets, e.g. [1], [2].",
            "- If the user asks about visual design, image details, examples, layout, composition, or hero-image improvement AND Image Evidence exists, include a section named `图片案例`.",
            "- In `图片案例`, embed the relevant images directly using the provided Markdown lines from Image Evidence, then explain what design detail each image supports.",
            "- Do not invent image URLs. Only use images listed in Image Evidence.",
            "- At the VERY END of your response, add a hidden comment listing which page numbers you used:",
            "  <!-- cited: 1, 3, 5 -->",
            "",
            "Use markdown formatting for clarity.",
            "",
            purpose ? `## Wiki Purpose\n${purpose}` : "",
            index ? `## Wiki Index\n${index}` : "",
            relevantPages.length > 0 ? `## Page List\n${pageList}` : "",
            imageEvidenceContext ? `## Image Evidence\n\n${imageEvidenceContext}` : "",
            semanticContext,
            `## Wiki Pages\n\n${pagesContext}`,
          ].filter(Boolean).join("\n"),
        })

        // Reminder injected later, right before the user's current message
        // (after history so it's the last system instruction the LLM sees).
        langReminder = buildLanguageReminder(languageSeed)

        lastQueryPages = relevantPages.map((p) => ({ title: p.title, path: p.path }))
        const imageRefs = imageEvidence
          .map((item) => ({ title: item.sourcePageTitle, path: item.sourcePagePath }))
          .filter((ref) => !lastQueryPages.some((page) => page.path === ref.path))
        const indexedImageRefs = indexedImageHits
          .map((item) => ({ title: item.sourceSlug, path: item.sourcePath }))
          .filter((ref) => !lastQueryPages.some((page) => page.path === ref.path))
          .filter((ref) => !imageRefs.some((page) => page.path === ref.path))
        queryRefs = [...lastQueryPages, ...imageRefs, ...indexedImageRefs]
        }
      }

      // ── Conversation history with count limit ────────────────
      // Only include messages from the active conversation, last N messages
      const activeConvMessages = useChatStore.getState().getActiveMessages()
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-maxHistoryMessages)

      // Prepend the language reminder onto the final user turn rather than
      // inserting a second {role:"system"} between history and the final
      // user message. vLLM / llama.cpp / Ollama drive their chat templates
      // from HF Jinja, and Qwen3-family templates enforce "system only at
      // index 0" — a mid-conversation system message gets rejected with
      // "System message must be at the beginning." (HTTP 400). OpenAI and
      // Anthropic are more lenient, but keeping a single system at the top
      // is the safest shape across every OpenAI-compatible backend.
      const historyMessages = chatMessagesToLLM(activeConvMessages)
      let llmMessages: LLMMessage[] = [...systemMessages, ...historyMessages]
      if (langReminder && historyMessages.length > 0) {
        const lastIdx = llmMessages.length - 1
        const last = llmMessages[lastIdx]
        if (last && last.role === "user") {
          llmMessages = [
            ...llmMessages.slice(0, lastIdx),
            { role: "user", content: `[${langReminder}]\n\n${last.content}` },
          ]
        }
      }

      const controller = new AbortController()
      abortRef.current = controller

      let accumulated = ""

      await streamChat(
        llmConfig,
        llmMessages,
        {
          onToken: (token) => {
            accumulated += token
            queueStreamToken(token)
          },
          onDone: () => {
            flushPendingStreamTokens()
            const answerMeta = panelMode === "revision-aware" ? extractAnswerMeta(accumulated) : null
            finalizeStream(stripHiddenAnswerMeta(accumulated), queryRefs, answerMeta, queryImageEvidence)
            abortRef.current = null
            // save-worthy detection removed — user has direct "Save to Wiki" button on each message
          },
          onError: (err) => {
            flushPendingStreamTokens()
            finalizeStream(`Error: ${err.message}`, undefined, null, [])
            abortRef.current = null
          },
        },
        controller.signal,
      )
    },
    [
      llmConfig,
      addMessage,
      flushPendingStreamTokens,
      setStreaming,
      finalizeStream,
      setStreamingImageEvidence,
      queueStreamToken,
      scrollToBottom,
      createConversation,
      ensureScopedConversation,
      hasScopedActiveConversation,
      maxHistoryMessages,
      onSendInRevisionLoop,
      panelMode,
      revisionContext,
    ],
  )

  const handleStop = useCallback(() => {
    if (panelMode === "revision-loop") {
      onStopInRevisionLoop?.()
      return
    }
    abortRef.current?.abort()
    abortRef.current = null
  }, [onStopInRevisionLoop, panelMode])

  const handleRegenerate = useCallback(async () => {
    if (isStreaming) return
    // Find the last user message in active conversation
    const active = useChatStore.getState().getActiveMessages()
    const lastUserMsg = [...active].reverse().find((m) => m.role === "user")
    if (!lastUserMsg) return
    // Remove the last assistant reply, then re-send
    removeLastAssistantMessage()
    // Small delay to let state update
    await new Promise((r) => setTimeout(r, 50))
    // Trigger send with the same text (handleSend will add a new user message,
    // so also remove the original to avoid duplication)
    // Actually: just call handleSend — but it adds a user message. To avoid dupe,
    // we remove the last user message too and let handleSend re-add it.
    const store = useChatStore.getState()
    const updatedActive = store.getActiveMessages()
    const lastUser = [...updatedActive].reverse().find((m) => m.role === "user")
    if (lastUser) {
      useChatStore.setState((s) => ({
        messages: s.messages.filter((m) => m.id !== lastUser.id),
      }))
    }
    handleSend(lastUserMsg.content)
  }, [isStreaming, removeLastAssistantMessage, handleSend])

  const handleWriteToWiki = useCallback(async () => {
    if (!project) return
    const pp = normalizePath(project.path)
    try {
      await executeIngestWrites(pp, llmConfig, undefined, undefined)
      try {
        const tree = await listDirectory(pp)
        setFileTree(tree)
      } catch {
        // ignore
      }
    } catch (err) {
      console.error("Failed to write to wiki:", err)
    }
  }, [project, llmConfig, setFileTree])

  const hasAssistantMessages = activeMessages.some((m) => m.role === "assistant")
  const showWriteButton = mode === "ingest" && !isStreaming && hasAssistantMessages
  const headerLabel = panelMode === "revision-aware" ? "修订感知知识问答" : "知识问答"
  const revisionLoopLabel = loopStage === "revise" ? "修订输入" : "知识验证输入"
  const revisionLoopHint = loopStage === "revise"
    ? "围绕当前任务继续补充、修正文案或追问，系统会整理成消息内可确认的修订建议。"
    : "围绕最新修订稿做验证追问，系统会优先命中最新 patch、业务底稿和项目 wiki。"
  const revisionLoopPlaceholder = loopStage === "revise"
    ? "输入你的修订补充、判断依据或更准确的业务表达..."
    : "输入一个验证问题，比如“这次修订后，一线同事能否直接执行？”"

  return (
    <div className="flex h-full flex-row overflow-hidden">
      {!hideSidebar && (
        <ConversationSidebar
          scope={expectedScope}
          docId={revisionContext?.docId ?? null}
          loopId={revisionContext?.loopId ?? null}
          onCreateConversation={handleCreateConversation}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!hasScopedActiveConversation ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="mx-auto mb-3 h-8 w-8 opacity-30" />
              <p className="text-sm">{panelMode === "revision-loop" ? "统一修订对话框" : headerLabel}</p>
              <p className="mt-1 text-xs opacity-60">
                {panelMode === "revision-loop"
                  ? "从当前修订任务开始，系统会把修订建议、写回结果和验证回答都放进同一条线程。"
                  : panelMode === "revision-aware"
                  ? "从一个验证问题开始，看看当前修订稿是否已经把答案讲清楚。"
                  : "点击“新建会话”开始提问、归纳或校准"}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={handleCreateConversation}
              >
                <Plus className="mr-2 h-3.5 w-3.5" />
                {panelMode === "revision-loop" ? "进入当前线程" : panelMode === "revision-aware" ? "开始验证" : "新建会话"}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="relative min-h-0 flex-1">
              <div
                ref={scrollContainerRef}
                className={`h-full overflow-y-auto px-3 ${panelMode === "revision-aware" ? "py-3" : "py-2"}`}
              >
                <div className="flex flex-col gap-3">
                  {activeMessages.map((msg, idx) => {
                    // Check if this is the last assistant message
                    const isLastAssistant = msg.role === "assistant" &&
                      !activeMessages.slice(idx + 1).some((m) => m.role === "assistant")
                    return (
                      <ChatMessage
                        key={msg.id}
                        message={msg}
                        mode={panelMode}
                        isLastAssistant={isLastAssistant && !isStreaming}
                        onRegenerate={isLastAssistant ? handleRegenerate : undefined}
                        onAcceptSuggestion={onAcceptSuggestion}
                        onRequestStageSwitch={onRequestStageSwitch}
                        onSendFollowup={onPrepareFollowup}
                      />
                    )
                  })}
                  {isStreaming && <StreamingMessage content={streamingContent} imageEvidence={streamingImageEvidence} />}
                  <div ref={bottomRef} />
                </div>
              </div>
              {showJumpToBottom ? (
                <button
                  type="button"
                  onClick={() => {
                    shouldStickToBottomRef.current = true
                    setShowJumpToBottom(false)
                    scrollToBottom("smooth")
                  }}
                  className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-sky-200 bg-white/95 px-3 py-1.5 text-xs font-medium text-sky-800 shadow-lg backdrop-blur transition hover:bg-sky-50"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                  有新内容，回到底部
                </button>
              ) : null}
            </div>

            {showWriteButton && (
              <div className="border-t px-3 py-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleWriteToWiki}
                  className="w-full gap-2"
                >
                  <BookOpen className="h-4 w-4" />
                  写入知识页
                </Button>
              </div>
            )}
          </>
        )}

        <ChatInput
          onSend={handleSend}
          onStop={handleStop}
          isStreaming={isStreaming}
          embedded={panelMode === "revision-aware" || panelMode === "revision-loop"}
          prefillRequest={readyComposerRequest}
          focusRequest={readyComposerRequest}
          label={
            panelMode === "revision-loop"
              ? revisionLoopLabel
              : panelMode === "revision-aware"
                ? "知识验证输入"
                : "知识问答输入"
          }
          hint={
            panelMode === "revision-loop"
              ? revisionLoopHint
              : panelMode === "revision-aware"
              ? "优先围绕当前修订稿验证答案是否更准，也可以继续追问缺失的判断、动作或边界。"
              : mode === "ingest"
              ? "继续围绕当前资料追问、归纳或补充。"
              : "输入业务问题，系统会结合当前知识页给出回答。"
          }
          placeholder={
            panelMode === "revision-loop"
              ? revisionLoopPlaceholder
              : panelMode === "revision-aware"
              ? "输入一个验证问题，比如“现在这份方法论的数据洞察核心流程是什么？”"
              : mode === "ingest"
              ? "围绕当前资料继续追问、总结或修正..."
              : "请输入你的业务问题..."
          }
        />
      </div>
    </div>
  )
}
