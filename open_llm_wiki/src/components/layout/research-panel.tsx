import { useState } from "react"
import { Globe, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useResearchStore } from "@/stores/research-store"
import { useWikiStore } from "@/stores/wiki-store"
import { enterResearchWorkbench, hasUsableResearchBackend, runDeepResearchSession } from "@/lib/deep-research"
import { normalizePath } from "@/lib/path-utils"
import { isImeComposing } from "@/lib/keyboard-utils"

const PHASE_LABELS: Record<string, string> = {
  clarify_scope: "澄清范围",
  plan_queries: "规划查询",
  search_sources: "搜索来源",
  extract_learnings: "提炼信息",
  branch_followups: "继续追问",
  synthesize_report: "生成报告",
  save_research_asset: "保存档案",
}

export function ResearchPanel() {
  const sessions = useResearchStore((s) => s.sessions)
  const setPanelOpen = useResearchStore((s) => s.setPanelOpen)
  const setActiveSessionId = useResearchStore((s) => s.setActiveSessionId)
  const project = useWikiStore((s) => s.project)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const [inputValue, setInputValue] = useState("")

  async function handleStartResearch() {
    const topic = inputValue.trim()
    if (!topic || !project) return
    const searchConfig = useWikiStore.getState().searchApiConfig
    if (!hasUsableResearchBackend(searchConfig)) {
      window.alert("当前研究后端尚未配置。请先到“设置 → 网页搜索”补充 Firecrawl 或 Tavily。")
      return
    }
    const sessionId = enterResearchWorkbench({ topic, triggerSource: "quick_panel" })
    setInputValue("")
    await runDeepResearchSession(sessionId, normalizePath(project.path))
  }

  function handleOpenSession(sessionId: string) {
    setActiveSessionId(sessionId)
    setActiveView("research")
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">轻量调研面板</span>
        </div>
        <button
          onClick={() => setPanelOpen(false)}
          className="rounded p-1 text-muted-foreground hover:bg-accent"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-2">
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return
            if (e.key === "Enter") void handleStartResearch()
          }}
          placeholder="快速新建一条深度研究..."
          className="h-8 text-xs"
        />
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => void handleStartResearch()} disabled={!inputValue.trim() || !project}>
          <Search className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {sessions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground">
            <Globe className="h-8 w-8 opacity-20" />
            <p>还没有研究会话</p>
            <p>你可以在这里快速发起，也可以点击左侧「深度研究」进入完整工作台。</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => (
              <button
                key={session.sessionId}
                onClick={() => handleOpenSession(session.sessionId)}
                className="w-full rounded-lg border px-3 py-3 text-left transition-colors hover:bg-accent/50"
              >
                <div className="truncate text-sm font-medium">{session.topic}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {PHASE_LABELS[session.phase]} · {session.status}
                </div>
                <div className="mt-2 text-[11px] text-muted-foreground">
                  已访问来源 {session.runtime.visitedUrls.length} · 候选结论 {session.findings.length}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
