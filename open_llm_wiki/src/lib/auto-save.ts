import { useReviewStore } from "@/stores/review-store"
import { useChatStore } from "@/stores/chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import { saveReviewItems, saveChatHistory } from "./persist"
import { useInteractiveSessionStore } from "@/stores/interactive-session-store"
import { useRevisionStore } from "@/stores/revision-store"
import { useAgentModeStore } from "@/stores/agent-mode-store"
import { saveInteractiveSession, saveRevisionDraft } from "@/lib/agent-mode-persist"
import { useResearchStore } from "@/stores/research-store"
import { saveResearchSession } from "@/lib/research-persist"

let reviewTimer: ReturnType<typeof setTimeout> | null = null
let chatTimer: ReturnType<typeof setTimeout> | null = null
let interactiveTimer: ReturnType<typeof setTimeout> | null = null
let draftTimer: ReturnType<typeof setTimeout> | null = null
let researchTimer: ReturnType<typeof setTimeout> | null = null

export function setupAutoSave(): void {
  // Auto-save review items (debounced 1s)
  useReviewStore.subscribe((state) => {
    if (reviewTimer) clearTimeout(reviewTimer)
    reviewTimer = setTimeout(() => {
      const project = useWikiStore.getState().project
      if (project) {
        saveReviewItems(project.path, state.items).catch(() => {})
      }
    }, 1000)
  })

  // Auto-save chat conversations and messages (debounced 2s, skip during streaming)
  useChatStore.subscribe((state) => {
    if (state.isStreaming) return
    if (chatTimer) clearTimeout(chatTimer)
    chatTimer = setTimeout(() => {
      const project = useWikiStore.getState().project
      if (project) {
        saveChatHistory(project.path, state.conversations, state.messages).catch(() => {})
      }
    }, 2000)
  })

  useInteractiveSessionStore.subscribe((state) => {
    const project = useWikiStore.getState().project
    if (!project || !state.currentSessionId) return
    const session = state.sessions.find((item) => item.sessionId === state.currentSessionId)
    if (!session) return
    if (interactiveTimer) clearTimeout(interactiveTimer)
    interactiveTimer = setTimeout(() => {
      useAgentModeStore.getState().setAutosaveState("saving")
      saveInteractiveSession(project.path, session)
        .then(() => useAgentModeStore.getState().setAutosaveState("saved"))
        .catch(() => useAgentModeStore.getState().setAutosaveState("error"))
    }, 1200)
  })

  useRevisionStore.subscribe((state) => {
    const project = useWikiStore.getState().project
    if (!project || state.drafts.length === 0) return
    const draft = state.drafts[0]
    if (!draft) return
    if (draftTimer) clearTimeout(draftTimer)
    draftTimer = setTimeout(() => {
      useAgentModeStore.getState().setAutosaveState("saving")
      saveRevisionDraft(project.path, draft)
        .then(() => useAgentModeStore.getState().setAutosaveState("saved"))
        .catch(() => useAgentModeStore.getState().setAutosaveState("error"))
    }, 1200)
  })

  useResearchStore.subscribe((state) => {
    const project = useWikiStore.getState().project
    const session = state.sessions.find((item) => item.sessionId === state.activeSessionId) ?? state.sessions[0]
    if (!project || !session) return
    if (researchTimer) clearTimeout(researchTimer)
    researchTimer = setTimeout(() => {
      saveResearchSession(project.path, session).catch(() => {})
    }, 1200)
  })
}
