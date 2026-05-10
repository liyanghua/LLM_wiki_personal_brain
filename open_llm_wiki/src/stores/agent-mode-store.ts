import { create } from "zustand"
import type { AgentModeReport } from "@/lib/agent-mode-types"
import { useWikiStore } from "@/stores/wiki-store"
import { useAgentLoopStore } from "@/stores/agent-loop-store"
import { useInteractiveSessionStore } from "@/stores/interactive-session-store"
import { useRevisionStore } from "@/stores/revision-store"

type AgentViewMode = "agent" | "interactive"
type AutosaveState = "idle" | "saving" | "saved" | "error"
export type AgentWorkbenchPhase =
  | "enter_workbench"
  | "restore_workspace"
  | "prepare_task"
  | "accept_writeback"
  | "partial_recompute"
  | "publish_and_health_check"

export type AgentWorkbenchPhaseStatus = "idle" | "running" | "done" | "error"

export interface AgentWorkbenchRuntime {
  phase: AgentWorkbenchPhase
  status: AgentWorkbenchPhaseStatus
  title: string
  detail: string
  docId: string | null
  taskId: string | null
  startedAt: string
  updatedAt: string
  completedArtifacts: string[]
  errorMessage?: string
  canRetry: boolean
}

interface AgentModeState {
  reports: AgentModeReport[]
  selectedDocId: string | null
  activeMode: AgentViewMode
  autosaveState: AutosaveState
  degradedMode: string | null
  runtime: AgentWorkbenchRuntime | null
  pendingExternalSuggestion:
    | {
        source: "research"
        title: string
        summary: string
        evidenceSummary: string
        targetFieldKey?: string | null
        researchSessionId?: string | null
        researchFindingId?: string | null
      }
    | null
  setReports: (reports: AgentModeReport[]) => void
  upsertReport: (report: AgentModeReport) => void
  setSelectedDocId: (docId: string | null) => void
  setActiveMode: (mode: AgentViewMode) => void
  setAutosaveState: (state: AutosaveState) => void
  setDegradedMode: (message: string | null) => void
  setRuntime: (runtime: AgentWorkbenchRuntime | null) => void
  setPendingExternalSuggestion: (value: AgentModeState["pendingExternalSuggestion"]) => void
  resetRuntime: () => void
  enterAgentWorkbench: (docId?: string | null) => Promise<void>
  getSelectedReport: () => AgentModeReport | null
  reset: () => void
}

const PHASE_LABELS: Record<AgentWorkbenchPhase, string> = {
  enter_workbench: "进入业务修订",
  restore_workspace: "恢复修订工作台",
  prepare_task: "准备当前修订任务",
  accept_writeback: "采纳并写回主稿",
  partial_recompute: "局部重算质量与任务",
  publish_and_health_check: "发布并校验知识层",
}

function makeRuntime(
  phase: AgentWorkbenchPhase,
  status: AgentWorkbenchPhaseStatus,
  overrides: Partial<AgentWorkbenchRuntime> = {},
): AgentWorkbenchRuntime {
  const now = new Date().toISOString()
  return {
    phase,
    status,
    title: PHASE_LABELS[phase],
    detail: "",
    docId: null,
    taskId: null,
    startedAt: overrides.startedAt ?? now,
    updatedAt: now,
    completedArtifacts: overrides.completedArtifacts ?? [],
    canRetry: overrides.canRetry ?? false,
    ...overrides,
  }
}

export const useAgentModeStore = create<AgentModeState>((set, get) => ({
  reports: [],
  selectedDocId: null,
  activeMode: "agent",
  autosaveState: "idle",
  degradedMode: null,
  runtime: null,
  pendingExternalSuggestion: null,
  setReports: (reports) =>
    set({
      reports,
      selectedDocId: get().selectedDocId ?? reports[0]?.docId ?? null,
    }),
  upsertReport: (report) =>
    set((state) => {
      const existing = state.reports.filter((item) => item.docId !== report.docId)
      const reports = [report, ...existing]
      return {
        reports,
        selectedDocId: state.selectedDocId ?? report.docId,
      }
    }),
  setSelectedDocId: (selectedDocId) => set({ selectedDocId }),
  setActiveMode: (activeMode) => set({ activeMode }),
  setAutosaveState: (autosaveState) => set({ autosaveState }),
  setDegradedMode: (degradedMode) => set({ degradedMode }),
  setRuntime: (runtime) => set({ runtime }),
  setPendingExternalSuggestion: (pendingExternalSuggestion) => set({ pendingExternalSuggestion }),
  resetRuntime: () => set({ runtime: null }),
  enterAgentWorkbench: async (docId) => {
    const startedAt = new Date().toISOString()
    useWikiStore.getState().setActiveView("agent-mode")
    set({
      runtime: makeRuntime("enter_workbench", "running", {
        startedAt,
        docId: docId ?? get().selectedDocId,
        detail: "正在进入业务修订工作台，并准备恢复当前项目的修订状态。",
      }),
    })
    await Promise.resolve()
    const reports = get().reports
    const selectedDocId = docId ?? get().selectedDocId ?? reports[0]?.docId ?? null
    set({
      selectedDocId,
      runtime: makeRuntime("restore_workspace", "running", {
        startedAt,
        docId: selectedDocId,
        detail: "正在恢复这份文档的 GroundTruth、修订草稿和闭环任务。",
      }),
    })
    await Promise.resolve()
    const loopSession = selectedDocId
      ? useAgentLoopStore.getState().getSessionByDocId(selectedDocId)
      : null
    const taskId = loopSession?.activeTaskId ?? null
    const hasReport = reports.some((report) => report.docId === selectedDocId)
    set({
      selectedDocId,
      runtime: makeRuntime("prepare_task", hasReport ? "running" : "done", {
        startedAt,
        docId: selectedDocId,
        taskId,
        detail: hasReport
          ? "正在解析当前闭环任务、推荐验证问句和可发布状态。"
          : "当前项目还没有准备好修订工作台，需要先生成 Agent Mode 报告。",
        canRetry: false,
      }),
    })
    await Promise.resolve()
    const draft = selectedDocId ? useRevisionStore.getState().getDraftByDocId(selectedDocId) : null
    const session = useInteractiveSessionStore.getState().getCurrentSession()
    set({
      activeMode: session && selectedDocId && session.docId === selectedDocId ? "interactive" : "agent",
      runtime: makeRuntime("prepare_task", "done", {
        startedAt,
        docId: selectedDocId,
        taskId,
        detail: hasReport
          ? "当前任务已准备好，可以继续修订、验证或发布。"
          : "当前项目还没有准备好修订工作台，请先导入或重新编译业务资料。",
        completedArtifacts: [
          hasReport ? "已恢复原文质量报告" : "未找到原文质量报告",
          draft ? "已恢复修订草稿" : "还没有修订草稿",
          loopSession ? "已恢复闭环任务" : "当前还没有闭环任务",
        ],
      }),
    })
  },
  getSelectedReport: () => {
    const state = get()
    return state.reports.find((report) => report.docId === state.selectedDocId) ?? null
  },
  reset: () =>
    set({
      reports: [],
      selectedDocId: null,
      activeMode: "agent",
      autosaveState: "idle",
      degradedMode: null,
      runtime: null,
      pendingExternalSuggestion: null,
    }),
}))
