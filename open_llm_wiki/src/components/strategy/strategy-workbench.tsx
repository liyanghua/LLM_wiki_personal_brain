import { useMemo, useState } from "react"
import { Bot, CheckCircle2, Clock3, Sparkles, WandSparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  approveStrategySkill,
  ensureProjectBrainBinding,
  generateStrategySkillCandidates,
  runProjectAgent,
  writeFile,
} from "@/commands/fs"
import { useAgentModeStore } from "@/stores/agent-mode-store"
import { useWikiStore } from "@/stores/wiki-store"
import type { StrategyCard, StrategyCardStatus } from "@/lib/agent-mode-types"
import { saveAgentModeReport } from "@/lib/agent-mode-persist"

const RUN_MODES = [
  { value: "diagnose_document", label: "诊断当前文档" },
  { value: "generate_strategy", label: "生成下一轮策略" },
  { value: "generate_asset_brief", label: "生成素材 brief" },
  { value: "validate_action_plan", label: "验证动作方案" },
] as const

export function StrategyWorkbench() {
  const project = useWikiStore((s) => s.project)
  const reports = useAgentModeStore((s) => s.reports)
  const selectedDocId = useAgentModeStore((s) => s.selectedDocId)
  const setSelectedDocId = useAgentModeStore((s) => s.setSelectedDocId)
  const upsertReport = useAgentModeStore((s) => s.upsertReport)
  const report = useMemo(
    () => reports.find((item) => item.docId === selectedDocId) ?? reports[0] ?? null,
    [reports, selectedDocId],
  )
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [status, setStatus] = useState<string>("")
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([])
  const [lastRunSummary, setLastRunSummary] = useState<string>("")
  const runMode = RUN_MODES[0].value

  async function persistCardStatus(card: StrategyCard, status: StrategyCardStatus) {
    if (!project || !report?.strategyBundle) return
    const nextBundle = {
      ...report.strategyBundle,
      strategyCards: report.strategyBundle.strategyCards.map((item) =>
        item.cardId === card.cardId
          ? { ...item, status, updatedAt: new Date().toISOString() }
          : item
      ),
    }
    const nextReport = {
      ...report,
      strategyBundle: nextBundle,
      confirmedStrategyCardIds: nextBundle.strategyCards
        .filter((item) => item.status === "confirmed" || item.status === "promoted_to_skill")
        .map((item) => item.cardId),
    }
    await writeFile(
      `${project.path}/.llm-wiki/strategy-cards/${report.docId}.json`,
      JSON.stringify(nextBundle, null, 2),
    )
    await saveAgentModeReport(project.path, nextReport)
    upsertReport(nextReport)
  }

  async function handleGenerateCandidates() {
    if (!project || !report) return
    setBusyKey("generate")
    try {
      await ensureProjectBrainBinding(project.path)
      const candidates = await generateStrategySkillCandidates(project.path, report.docId, report.sceneId)
      setSelectedSkillIds(candidates.map((item) => item.skillId))
      setStatus(`已生成 ${candidates.length} 个技能候选。`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyKey(null)
    }
  }

  async function handleApprove(skillId: string, tier: "pilot" | "stable") {
    if (!project) return
    setBusyKey(`approve:${skillId}`)
    try {
      await ensureProjectBrainBinding(project.path)
      await approveStrategySkill(project.path, skillId, tier)
      setStatus(`已将 ${skillId} 提升为 ${tier} skill。`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyKey(null)
    }
  }

  async function handleRunAgent() {
    if (!project || !report) return
    setBusyKey("run")
    try {
      await ensureProjectBrainBinding(project.path)
      const result = await runProjectAgent(project.path, {
        projectPath: project.path,
        docId: report.docId,
        sceneId: report.sceneId,
        runMode,
        selectedSkillIds,
        groundingSources: report.strategyBundle?.linkedWikiRefs ?? report.supportingWikiPages,
      })
      setLastRunSummary(result.resultSummary)
      setStatus(`Agent 已完成一次 ${RUN_MODES.find((item) => item.value === runMode)?.label ?? runMode}。`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyKey(null)
    }
  }

  if (!project) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">请先打开业务工作区。</div>
  }

  if (!report) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">当前还没有可用的策略资产，请先导入资料并完成结构化编译。</div>
  }

  const cards = report.strategyBundle?.strategyCards ?? []

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <WandSparkles className="h-4 w-4 text-primary" />
          <span>策略与技能工作台</span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          从已确认业务修订继续生成策略卡、技能候选和可运行 Agent。主知识层仍以修订稿和业务 Wiki 为准。
        </p>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)]">
        <div className="border-r bg-muted/15 p-4">
          <div className="mb-3 text-xs font-medium text-muted-foreground">文档</div>
          <div className="space-y-2">
            {reports.map((item) => (
              <button
                key={item.docId}
                onClick={() => setSelectedDocId(item.docId)}
                className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                  item.docId === report.docId ? "border-primary bg-primary/5" : "hover:bg-accent"
                }`}
              >
                <div className="text-sm font-medium">{item.sourceName}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  scene: {item.sceneId}
                </div>
              </button>
            ))}
          </div>
          <div className="mt-6 space-y-2">
            <Button className="w-full" onClick={() => void handleGenerateCandidates()} disabled={busyKey !== null}>
              <Sparkles className="mr-1 h-4 w-4" />
              生成技能候选
            </Button>
            <Button variant="outline" className="w-full" onClick={() => void handleRunAgent()} disabled={busyKey !== null}>
              <Bot className="mr-1 h-4 w-4" />
              运行 Agent
            </Button>
          </div>
          {status ? (
            <div className="mt-4 rounded-lg border bg-background px-3 py-3 text-xs text-muted-foreground">
              {status}
            </div>
          ) : null}
        </div>
        <div className="min-h-0 overflow-y-auto p-6">
          <div className="rounded-xl border bg-background p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">{report.strategyBundle?.title ?? `${report.sourceName} 策略包`}</div>
                <div className="mt-1 text-sm text-muted-foreground">{report.strategyBundle?.summary ?? report.qualitySummary}</div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <div>已确认策略卡：{report.confirmedStrategyCardIds?.length ?? 0}</div>
                <div>当前质量分：{report.qualityScore}</div>
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {cards.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                当前还没有生成可用策略卡。先补齐 GroundTruth 和业务页投影，再进入策略/技能链路。
              </div>
            ) : (
              cards.map((card) => (
                <div key={card.cardId} className="rounded-xl border bg-background p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{card.title}</div>
                      <div className="mt-2 whitespace-pre-wrap text-sm leading-6">{card.recommendation}</div>
                    </div>
                    <div className="rounded-full border px-2 py-1 text-[11px] text-muted-foreground">
                      {card.status}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                    <div className="rounded-lg bg-muted/40 px-3 py-2">
                      <div className="font-medium text-foreground">为什么现在做</div>
                      <div className="mt-1 whitespace-pre-wrap">{card.whyNow}</div>
                    </div>
                    <div className="rounded-lg bg-muted/40 px-3 py-2">
                      <div className="font-medium text-foreground">如何验证</div>
                      <div className="mt-1 whitespace-pre-wrap">{card.validationPlan}</div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => void persistCardStatus(card, "confirmed")}
                      disabled={busyKey !== null}
                    >
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                      确认为策略卡
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void persistCardStatus(card, "rejected")}
                      disabled={busyKey !== null}
                    >
                      暂不采用
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void persistCardStatus(card, "promoted_to_skill")}
                      disabled={busyKey !== null}
                    >
                      <Clock3 className="mr-1 h-3.5 w-3.5" />
                      标记可升技能
                    </Button>
                  </div>
                  {card.evidenceRefs.length > 0 ? (
                    <div className="mt-3 text-xs text-muted-foreground">
                      证据锚点：{card.evidenceRefs.slice(0, 6).join(" · ")}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>

          {selectedSkillIds.length > 0 ? (
            <div className="mt-6 rounded-xl border bg-background p-4">
              <div className="text-sm font-semibold">当前技能候选</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedSkillIds.map((skillId) => (
                  <div key={skillId} className="rounded-lg border px-3 py-2 text-xs">
                    <div className="font-medium">{skillId}</div>
                    <div className="mt-2 flex gap-2">
                      <Button size="xs" onClick={() => void handleApprove(skillId, "pilot")} disabled={busyKey !== null}>
                        提升为 Pilot
                      </Button>
                      <Button size="xs" variant="outline" onClick={() => void handleApprove(skillId, "stable")} disabled={busyKey !== null}>
                        提升为 Stable
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {lastRunSummary ? (
            <div className="mt-6 rounded-xl border bg-background p-4">
              <div className="text-sm font-semibold">最近一次 Agent 运行结果</div>
              <pre className="mt-3 whitespace-pre-wrap text-sm leading-6">{lastRunSummary}</pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
