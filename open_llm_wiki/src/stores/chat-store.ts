import { create } from "zustand"
import type { ChatMessage } from "@/lib/llm-client"
import type { GroundTruthDraft, RevisionDraft, RevisionSuggestion } from "@/lib/agent-mode-types"

export interface RevisionChatContext {
  docId: string
  loopId?: string | null
  draftPath: string
  draft?: RevisionDraft | null
  groundTruth?: GroundTruthDraft | null
  selectedCardId?: string | null
  selectedBlockIds?: string[]
  selectedTargetFieldKey?: string | null
  lastAcceptedCardId?: string | null
  revisionSnapshotKey?: string
  selectedCardTitle?: string | null
  selectedCardDiagnosis?: string | null
  groundTruthSummary?: string
}

export interface ComposerRequest {
  id: string
  text?: string
  selectAll?: boolean
  snapshotKey?: string | null
}

export type ConversationScope = "global" | "revision-workbench" | "revision-loop"
export type ConversationStage = "revise" | "validate"

export interface RevisionMessageMeta {
  messageKind: "task_context" | "revision_suggestion" | "accept_result" | "validation_answer" | "supplement_seed"
  docId: string
  loopId?: string | null
  taskId?: string | null
  cardId?: string | null
  targetFieldKey?: string | null
  stage: ConversationStage
  changeSummary: string[]
  impactFieldKeys: string[]
  impactDimensions: string[]
  actionState: "pending_confirmation" | "accepted" | "rejected" | "superseded" | "error"
  suggestion?: RevisionSuggestion | null
  validationQuestion?: string | null
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  scope?: ConversationScope
  docId?: string | null
  loopId?: string | null
}

export interface MessageReference {
  title: string
  path: string
  kind?: "draft" | "patch" | "ground_truth" | "wiki" | "index" | "overview" | "source"
  cardId?: string | null
  blockId?: string | null
}

export interface SupplementInsight {
  supplementId: string
  title: string
  origin: "evidence_extension" | "model_experience"
  disclaimer: string
  candidateSentence: string
  rationale: string
  targetFieldKey?: string | null
  linkedCardId?: string | null
  confidence: number
}

export interface KnowledgeAnswerMeta {
  supplements: SupplementInsight[]
}

export interface DisplayMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: number
  conversationId: string
  references?: MessageReference[]  // pages cited in this response, saved at creation time
  answerMeta?: KnowledgeAnswerMeta | null
  revisionMeta?: RevisionMessageMeta | null
}

interface AddMessageOptions {
  conversationId?: string | null
  references?: MessageReference[]
  answerMeta?: KnowledgeAnswerMeta | null
  revisionMeta?: RevisionMessageMeta | null
  skipTitleAuto?: boolean
}

interface ChatState {
  conversations: Conversation[]
  activeConversationId: string | null
  messages: DisplayMessage[]
  isStreaming: boolean
  streamingContent: string
  mode: "chat" | "ingest"
  ingestSource: string | null
  maxHistoryMessages: number

  // Conversation management
  createConversation: () => string
  ensureScopedConversation: (
    title: string,
    options: {
      scope: ConversationScope
      docId?: string | null
      loopId?: string | null
    },
  ) => string
  deleteConversation: (id: string) => void
  setActiveConversation: (id: string | null) => void
  renameConversation: (id: string, title: string) => void

  // Message management
  addMessage: (role: DisplayMessage["role"], content: string, options?: AddMessageOptions) => void
  setMessages: (messages: DisplayMessage[]) => void
  setConversations: (conversations: Conversation[]) => void
  setStreaming: (streaming: boolean) => void
  appendStreamToken: (token: string) => void
  finalizeStream: (content: string, references?: MessageReference[], answerMeta?: KnowledgeAnswerMeta | null) => void
  updateMessage: (id: string, patch: Partial<DisplayMessage>) => void
  setMode: (mode: ChatState["mode"]) => void
  setIngestSource: (path: string | null) => void
  clearMessages: () => void
  setMaxHistoryMessages: (n: number) => void
  removeLastAssistantMessage: () => void  // for regenerate: remove last assistant reply

  // Helpers
  getActiveMessages: () => DisplayMessage[]
}

let messageCounter = 0

function nextId(): string {
  messageCounter += 1
  return String(messageCounter)
}

function generateConversationId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  isStreaming: false,
  streamingContent: "",
  mode: "chat",
  ingestSource: null,
  maxHistoryMessages: 10,

  createConversation: () => {
    const id = generateConversationId()
    const now = Date.now()
    const newConversation: Conversation = {
      id,
      title: "New Conversation",
      createdAt: now,
      updatedAt: now,
    }
    set((state) => ({
      conversations: [newConversation, ...state.conversations],
      activeConversationId: id,
    }))
    return id
  },

  ensureScopedConversation: (title, options) => {
    const existing = get().conversations.find((conversation) =>
      conversation.scope === options.scope
      && (conversation.docId ?? null) === (options.docId ?? null)
      && (conversation.loopId ?? null) === (options.loopId ?? null),
    )
    if (existing) {
      set({ activeConversationId: existing.id })
      return existing.id
    }

    const id = generateConversationId()
    const now = Date.now()
    const newConversation: Conversation = {
      id,
      title,
      createdAt: now,
      updatedAt: now,
      scope: options.scope,
      docId: options.docId ?? null,
      loopId: options.loopId ?? null,
    }
    set((state) => ({
      conversations: [newConversation, ...state.conversations],
      activeConversationId: id,
    }))
    return id
  },

  deleteConversation: (id) =>
    set((state) => {
      const remaining = state.conversations.filter((c) => c.id !== id)
      const newActiveId =
        state.activeConversationId === id
          ? (remaining[0]?.id ?? null)
          : state.activeConversationId
      return {
        conversations: remaining,
        messages: state.messages.filter((m) => m.conversationId !== id),
        activeConversationId: newActiveId,
      }
    }),

  setActiveConversation: (id) => set({ activeConversationId: id }),

  renameConversation: (id, title) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, title, updatedAt: Date.now() } : c
      ),
    })),

  addMessage: (role, content, options) =>
    set((state) => {
      const conversationId = options?.conversationId ?? state.activeConversationId
      const { conversations } = state
      if (!conversationId) return state

      const newMessage: DisplayMessage = {
        id: nextId(),
        role,
        content,
        timestamp: Date.now(),
        conversationId,
        references: options?.references,
        answerMeta: options?.answerMeta ?? null,
        revisionMeta: options?.revisionMeta ?? null,
      }

      // Auto-set title from first user message (first 50 chars)
      const convMessages = state.messages.filter(
        (m) => m.conversationId === conversationId && m.role === "user"
      )
      const updatedConversations =
        role === "user" && convMessages.length === 0 && !options?.skipTitleAuto
          ? conversations.map((c) =>
              c.id === conversationId
                ? { ...c, title: content.slice(0, 50), updatedAt: Date.now() }
                : c
            )
          : conversations.map((c) =>
              c.id === conversationId
                ? { ...c, updatedAt: Date.now() }
                : c
            )

      return {
        messages: [...state.messages, newMessage],
        conversations: updatedConversations,
      }
    }),

  setMessages: (messages) => set({ messages }),

  setConversations: (conversations) => set({ conversations }),

  setStreaming: (isStreaming) => set({ isStreaming }),

  appendStreamToken: (token) =>
    set((state) => ({
      streamingContent: state.streamingContent + token,
    })),

  finalizeStream: (content, references, answerMeta) =>
    set((state) => {
      const { activeConversationId, conversations } = state
      if (!activeConversationId) {
        return {
          isStreaming: false,
          streamingContent: "",
        }
      }

      const newMessage: DisplayMessage = {
        id: nextId(),
        role: "assistant" as const,
        content,
        timestamp: Date.now(),
        conversationId: activeConversationId,
        references,
        answerMeta: answerMeta ?? null,
      }

      return {
        isStreaming: false,
        streamingContent: "",
        messages: [...state.messages, newMessage],
        conversations: conversations.map((c) =>
          c.id === activeConversationId
            ? { ...c, updatedAt: Date.now() }
            : c
        ),
      }
    }),

  updateMessage: (id, patch) =>
    set((state) => {
      const targetMessage = state.messages.find((message) => message.id === id)
      const targetConversationId = targetMessage?.conversationId ?? null
      return {
        messages: state.messages.map((message) =>
          message.id === id
            ? {
                ...message,
                ...patch,
              }
            : message,
        ),
        conversations: state.conversations.map((conversation) =>
          conversation.id === targetConversationId
            ? { ...conversation, updatedAt: Date.now() }
            : conversation,
        ),
      }
    }),

  setMode: (mode) => set({ mode }),

  setIngestSource: (ingestSource) => set({ ingestSource }),

  clearMessages: () =>
    set((state) => ({
      messages: state.messages.filter(
        (m) => m.conversationId !== state.activeConversationId
      ),
    })),

  setMaxHistoryMessages: (maxHistoryMessages) => set({ maxHistoryMessages }),

  removeLastAssistantMessage: () =>
    set((state) => {
      const activeId = state.activeConversationId
      if (!activeId) return state
      const activeMessages = state.messages.filter((m) => m.conversationId === activeId)
      // Find last assistant message
      const lastAssistantIdx = [...activeMessages].reverse().findIndex((m) => m.role === "assistant")
      if (lastAssistantIdx === -1) return state
      const msgToRemove = activeMessages[activeMessages.length - 1 - lastAssistantIdx]
      return {
        messages: state.messages.filter((m) => m.id !== msgToRemove.id),
      }
    }),

  getActiveMessages: () => {
    const { messages, activeConversationId } = get()
    if (!activeConversationId) return []
    return messages.filter((m) => m.conversationId === activeConversationId)
  },
}))

export function chatMessagesToLLM(messages: DisplayMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))
}
