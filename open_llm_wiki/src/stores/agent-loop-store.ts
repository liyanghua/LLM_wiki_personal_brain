import { create } from "zustand"
import type { AgentLoopSession } from "@/lib/agent-mode-types"

interface AgentLoopState {
  sessions: AgentLoopSession[]
  setSessions: (sessions: AgentLoopSession[]) => void
  upsertSession: (session: AgentLoopSession) => void
  getSessionByDocId: (docId: string) => AgentLoopSession | null
  reset: () => void
}

export const useAgentLoopStore = create<AgentLoopState>((set, get) => ({
  sessions: [],
  setSessions: (sessions) => set({ sessions }),
  upsertSession: (session) =>
    set((state) => ({
      sessions: [session, ...state.sessions.filter((item) => item.docId !== session.docId)],
    })),
  getSessionByDocId: (docId) => get().sessions.find((session) => session.docId === docId) ?? null,
  reset: () => set({ sessions: [] }),
}))
