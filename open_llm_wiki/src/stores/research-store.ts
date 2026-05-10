import { create } from "zustand"
import type {
  EnterResearchWorkbenchInput,
  ResearchFinding,
  ResearchPhase,
  ResearchProviderStatus,
  ResearchReportSections,
  ResearchRuntime,
  ResearchSession,
  ResearchSourceEvidence,
  ResearchThreadEntry,
  ResearchStatus,
} from "@/lib/research-types"
import { useWikiStore } from "@/stores/wiki-store"

interface ResearchState {
  sessions: ResearchSession[]
  activeSessionId: string | null
  panelOpen: boolean
  maxConcurrent: number

  enterResearchWorkbench: (input?: EnterResearchWorkbenchInput) => string
  setPanelOpen: (open: boolean) => void
  setSessions: (sessions: ResearchSession[]) => void
  setActiveSessionId: (id: string | null) => void
  updateSession: (sessionId: string, updates: Partial<ResearchSession>) => void
  updateRuntime: (sessionId: string, updates: Partial<ResearchRuntime>) => void
  appendSourceEvidence: (sessionId: string, source: ResearchSourceEvidence) => void
  appendLearnings: (sessionId: string, learnings: string[]) => void
  appendFindings: (sessionId: string, findings: ResearchFinding[]) => void
  appendThreadEntry: (sessionId: string, entry: ResearchThreadEntry) => void
  answerFollowUp: (sessionId: string, answer: string) => void
  removeSession: (sessionId: string) => void
  reset: () => void
}

let counter = 0

function now(): number {
  return Date.now()
}

function defaultProviderStatus(): ResearchProviderStatus | null {
  return null
}

function normalizeReportSections(input: ResearchReportSections | null | undefined): ResearchReportSections | null {
  if (!input || !Array.isArray(input.sections)) return null
  return {
    parsed: Boolean(input.parsed),
    sections: input.sections.map((section) => ({
      key: section.key,
      title: section.title,
      content: section.content ?? "",
    })),
  }
}

function makeRuntime(sessionId: string): ResearchRuntime {
  return {
    sessionId,
    phase: "clarify_scope",
    status: "needs_input",
    title: "等待研究澄清",
    detail: "先补齐这轮研究的关键范围，再进入外部调研。",
    currentRound: 0,
    maxDepth: 1,
    providerStatus: defaultProviderStatus(),
    visitedUrls: [],
    learnings: [],
    followUpQuestions: [],
    pendingUserAnswers: [],
    currentQueries: [],
    acceptedSourcesCount: 0,
    completedArtifacts: [],
    errorMessage: null,
    canResume: true,
  }
}

function normalizeRuntime(
  sessionId: string,
  runtime: Partial<ResearchRuntime> | null | undefined,
  fallback?: Partial<ResearchRuntime> | null,
): ResearchRuntime {
  const merged = {
    ...makeRuntime(sessionId),
    ...(fallback ?? {}),
    ...(runtime ?? {}),
    sessionId,
  }
  return {
    ...merged,
    visitedUrls: Array.isArray(merged.visitedUrls) ? merged.visitedUrls : [],
    learnings: Array.isArray(merged.learnings) ? merged.learnings : [],
    followUpQuestions: Array.isArray(merged.followUpQuestions) ? merged.followUpQuestions : [],
    pendingUserAnswers: Array.isArray(merged.pendingUserAnswers) ? merged.pendingUserAnswers : [],
    currentQueries: Array.isArray(merged.currentQueries) ? merged.currentQueries : [],
    completedArtifacts: Array.isArray(merged.completedArtifacts) ? merged.completedArtifacts : [],
    acceptedSourcesCount: Number.isFinite(merged.acceptedSourcesCount) ? merged.acceptedSourcesCount : 0,
    currentRound: Number.isFinite(merged.currentRound) ? merged.currentRound : 0,
    maxDepth: Number.isFinite(merged.maxDepth) ? merged.maxDepth : 1,
  }
}

function normalizeSession(session: ResearchSession): ResearchSession {
  const runtime = normalizeRuntime(
    session.sessionId,
    session.runtime,
    {
      currentRound: session.runtime?.currentRound ?? session.currentRound ?? 0,
      maxDepth: session.runtime?.maxDepth ?? session.depth ?? 1,
      providerStatus: session.runtime?.providerStatus ?? session.providerStatus ?? defaultProviderStatus(),
      acceptedSourcesCount: session.runtime?.acceptedSourcesCount ?? session.sources?.length ?? 0,
    },
  )
  return {
    ...session,
    linkedDocId: session.linkedDocId ?? null,
    targetFieldKey: session.targetFieldKey ?? null,
    triggerSource: session.triggerSource ?? null,
    followUpQuestions: Array.isArray(session.followUpQuestions) ? session.followUpQuestions : [],
    userAnswers: Array.isArray(session.userAnswers) ? session.userAnswers : [],
    plannedQueries: Array.isArray(session.plannedQueries) ? session.plannedQueries : [],
    sources: Array.isArray(session.sources) ? session.sources : [],
    learnings: Array.isArray(session.learnings) ? session.learnings : [],
    pendingFollowUps: Array.isArray(session.pendingFollowUps) ? session.pendingFollowUps : [],
    findings: Array.isArray(session.findings)
      ? session.findings.map((finding) => ({
          ...finding,
          id: finding.id ?? finding.findingId,
          findingId: finding.findingId ?? finding.id,
          researchSessionId: finding.researchSessionId ?? session.sessionId,
          researchFindingId: finding.researchFindingId ?? finding.findingId ?? finding.id,
          promotionState: finding.promotionState ?? "idle",
          linkedDocId: finding.linkedDocId ?? session.linkedDocId ?? null,
          targetFieldKey: finding.targetFieldKey ?? session.targetFieldKey ?? null,
        }))
      : [],
    reportSections: normalizeReportSections(session.reportSections),
    thread: Array.isArray(session.thread) ? session.thread : [],
    visitedQueries: Array.isArray(session.visitedQueries) ? session.visitedQueries : [],
    currentRound: session.currentRound ?? runtime.currentRound ?? 0,
    providerStatus: session.providerStatus ?? runtime.providerStatus ?? defaultProviderStatus(),
    runtime,
    artifactDir: session.artifactDir ?? null,
    reportPath: session.reportPath ?? null,
    sessionPath: session.sessionPath ?? null,
    sourcesPath: session.sourcesPath ?? null,
    notesPath: session.notesPath ?? null,
    errorMessage: session.errorMessage ?? null,
  }
}

function makeSession(input?: EnterResearchWorkbenchInput): ResearchSession {
  const sessionId = `research-session-${++counter}`
  const topic = input?.topic?.trim() || "新的深度研究"
  const createdAt = now()
  const runtime = makeRuntime(sessionId)
  return {
    sessionId,
    topic,
    projectPath: useWikiStore.getState().project?.path ?? "",
    linkedDocId: input?.linkedDocId ?? null,
    targetFieldKey: input?.targetFieldKey ?? null,
    triggerSource: input?.triggerSource ?? null,
    breadth: Math.max(1, Math.min(6, input?.breadth ?? 3)),
    depth: Math.max(1, Math.min(4, input?.depth ?? 2)),
    focus: input?.focus ?? null,
    status: "needs_input",
    phase: "clarify_scope",
    createdAt,
    updatedAt: createdAt,
    followUpQuestions: [],
    userAnswers: [],
    plannedQueries: input?.searchQueries ?? [],
    sources: [],
    learnings: [],
    pendingFollowUps: [],
    reportMarkdown: "",
    notesMarkdown: "",
    findings: [],
    reportSections: null,
    thread: [],
    visitedQueries: [],
    currentRound: 0,
    providerStatus: null,
    runtime,
    artifactDir: null,
    reportPath: null,
    sessionPath: null,
    sourcesPath: null,
    notesPath: null,
    errorMessage: null,
  }
}

function mergeSession(oldSession: ResearchSession, updates: Partial<ResearchSession>): ResearchSession {
  return {
    ...oldSession,
    ...updates,
    updatedAt: now(),
  }
}

export const useResearchStore = create<ResearchState>((set) => ({
  sessions: [],
  activeSessionId: null,
  panelOpen: false,
  maxConcurrent: 2,

  enterResearchWorkbench: (input) => {
    const session = makeSession(input)
    useWikiStore.getState().setActiveView("research")
    set((state) => ({
      sessions: [session, ...state.sessions],
      activeSessionId: session.sessionId,
      panelOpen: false,
    }))
    return session.sessionId
  },

  setPanelOpen: (panelOpen) => set({ panelOpen }),

  setSessions: (sessions) =>
    set(() => {
      const byId = new Map<string, ResearchSession>()
      for (const session of sessions) {
        const normalizedSession = normalizeSession(session)
        const existing = byId.get(normalizedSession.sessionId)
        if (!existing || normalizedSession.updatedAt >= existing.updatedAt) {
          byId.set(normalizedSession.sessionId, normalizedSession)
        }
      }
      const normalized = Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt)
      for (const session of normalized) {
        const match = session.sessionId.match(/research-session-(\d+)/)
        const n = match ? Number(match[1]) : 0
        if (Number.isFinite(n)) {
          counter = Math.max(counter, n)
        }
      }
      return {
        sessions: normalized,
        activeSessionId: normalized[0]?.sessionId ?? null,
      }
    }),

  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),

  updateSession: (sessionId, updates) =>
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.sessionId === sessionId ? normalizeSession(mergeSession(session, updates)) : session
      ),
    })),

  updateRuntime: (sessionId, updates) =>
    set((state) => ({
      sessions: state.sessions.map((session) => {
        if (session.sessionId !== sessionId) return session
        const runtime = normalizeRuntime(sessionId, updates, session.runtime)
        return mergeSession(session, {
          runtime,
          phase: (updates.phase ?? runtime.phase) as ResearchPhase,
          status: (updates.status ?? runtime.status) as ResearchStatus,
          errorMessage: updates.errorMessage ?? session.errorMessage ?? null,
        })
      }),
    })),

  appendSourceEvidence: (sessionId, source) =>
    set((state) => ({
      sessions: state.sessions.map((session) => {
        if (session.sessionId !== sessionId) return session
        const sources = session.sources.some((item) => item.url === source.url)
          ? session.sources
          : [...session.sources, source]
        const visitedUrls = Array.from(new Set([...session.runtime.visitedUrls, source.url]))
        return mergeSession(session, {
          sources,
          runtime: {
            ...session.runtime,
            visitedUrls,
            acceptedSourcesCount: sources.length,
          },
        })
      }),
    })),

  appendLearnings: (sessionId, learnings) =>
    set((state) => ({
      sessions: state.sessions.map((session) => {
        if (session.sessionId !== sessionId) return session
        const nextLearnings = Array.from(new Set([...session.learnings, ...learnings.filter(Boolean)]))
        return mergeSession(session, {
          learnings: nextLearnings,
          runtime: {
            ...session.runtime,
            learnings: nextLearnings,
          },
        })
      }),
    })),

  appendFindings: (sessionId, findings) =>
    set((state) => ({
      sessions: state.sessions.map((session) => {
        if (session.sessionId !== sessionId) return session
        const next = [...session.findings]
        for (const finding of findings) {
          if (!next.some((item) => item.id === finding.id)) {
            next.push(finding)
          }
        }
        return mergeSession(session, { findings: next })
      }),
    })),

  appendThreadEntry: (sessionId, entry) =>
    set((state) => ({
      sessions: state.sessions.map((session) => {
        if (session.sessionId !== sessionId) return session
        if (session.thread.some((item) => item.entryId === entry.entryId)) {
          return session
        }
        return mergeSession(session, {
          thread: [...session.thread, entry],
        })
      }),
    })),

  answerFollowUp: (sessionId, answer) =>
    set((state) => ({
      sessions: state.sessions.map((session) => {
        if (session.sessionId !== sessionId) return session
        const trimmed = answer.trim()
        if (!trimmed) return session
        const userAnswers = [...session.userAnswers, trimmed]
        return mergeSession(session, {
          userAnswers,
          runtime: {
            ...session.runtime,
            pendingUserAnswers: userAnswers,
          },
        })
      }),
    })),

  removeSession: (sessionId) =>
    set((state) => {
      const sessions = state.sessions.filter((session) => session.sessionId !== sessionId)
      return {
        sessions,
        activeSessionId: state.activeSessionId === sessionId
          ? sessions[0]?.sessionId ?? null
          : state.activeSessionId,
      }
    }),

  reset: () =>
    set({
      sessions: [],
      activeSessionId: null,
      panelOpen: false,
      maxConcurrent: 2,
    }),
}))
