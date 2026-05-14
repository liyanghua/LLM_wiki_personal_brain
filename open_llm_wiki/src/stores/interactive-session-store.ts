import { create } from "zustand"
import type { InteractiveSession } from "@/lib/agent-mode-types"

interface InteractiveSessionState {
  sessions: InteractiveSession[]
  currentSessionId: string | null
  setSessions: (sessions: InteractiveSession[]) => void
  upsertSession: (session: InteractiveSession) => void
  setCurrentSessionId: (id: string | null) => void
  getCurrentSession: () => InteractiveSession | null
  reset: () => void
}

export const useInteractiveSessionStore = create<InteractiveSessionState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  setSessions: (sessions) =>
    set({
      sessions,
      currentSessionId: get().currentSessionId ?? sessions[0]?.sessionId ?? null,
    }),
  upsertSession: (session) =>
    set((state) => {
      const sessions = [session, ...state.sessions.filter((item) => item.sessionId !== session.sessionId)]
      return {
        sessions,
        currentSessionId: session.sessionId,
      }
    }),
  setCurrentSessionId: (currentSessionId) => set({ currentSessionId }),
  getCurrentSession: () => {
    const state = get()
    return state.sessions.find((session) => session.sessionId === state.currentSessionId) ?? null
  },
  reset: () => set({ sessions: [], currentSessionId: null }),
}))
