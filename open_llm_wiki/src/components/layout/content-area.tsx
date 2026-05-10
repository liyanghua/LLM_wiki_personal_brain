import { useWikiStore } from "@/stores/wiki-store"
import { AgentWorkbench } from "@/components/agent-mode/agent-workbench"
import { SettingsView } from "@/components/settings/settings-view"
import { SourcesView } from "@/components/sources/sources-view"
import { ReviewView } from "@/components/review/review-view"
import { LintView } from "@/components/lint/lint-view"
import { SearchView } from "@/components/search/search-view"
import { GraphView } from "@/components/graph/graph-view"
import { ResearchWorkbench } from "@/components/research/research-workbench"
import { StrategyWorkbench } from "@/components/strategy/strategy-workbench"

export function ContentArea() {
  const activeView = useWikiStore((s) => s.activeView)

  switch (activeView) {
    case "agent-mode":
      return <AgentWorkbench />
    case "settings":
      return <SettingsView />
    case "sources":
      return <SourcesView />
    case "review":
      return <ReviewView />
    case "lint":
      return <LintView />
    case "search":
      return <SearchView />
    case "graph":
      return <GraphView />
    case "research":
      return <ResearchWorkbench />
    case "strategy":
      return <StrategyWorkbench />
    default:
      return <AgentWorkbench />
  }
}
