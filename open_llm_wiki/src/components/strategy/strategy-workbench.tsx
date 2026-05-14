import { useEffect, useMemo, useRef, useState } from "react"
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
import { useReviewStore } from "@/stores/review-store"
import { useWikiStore } from "@/stores/wiki-store"
import type { StrategyActionCard, StrategyCardStatus, StrategySkillCandidateManifest } from "@/lib/agent-mode-types"
import { saveAgentModeReport } from "@/lib/agent-mode-persist"
import {
  formatBusinessText,
  agentRunStatusLabel,
  buildAgentRunBusinessSections,
  buildExecutionTimelineItems,
  buildSkillStepExecutionItems,
  executionTimelineStatusLabel,
  formatExecutionDuration,
  skillCandidateDisplayName,
  skillCandidateSummary,
  skillStepStatusLabel,
  skillStepTaskTypeLabel,
  skillTierDescription,
  skillTierLabel,
  strategyActionStatusLabel,
  strategyInputFieldExample,
  strategyInputFieldHelp,
  strategyInputFieldLabel,
  strategyInputFieldPlaceholder,
} from "@/lib/strategy-display"

const RUN_MODES = [
  { value: "diagnose_document", label: "诊断当前文档" },
  { value: "generate_strategy", label: "生成下一轮策略" },
  { value: "generate_asset_brief", label: "生成素材说明" },
  { value: "validate_action_plan", label: "验证动作方案" },
] as const

export function StrategyWorkbench() {
  const project = useWikiStore((s) => s.project)
  const reports = useAgentModeStore((s) => s.reports)
  const selectedDocId = useAgentModeStore((s) => s.selectedDocId)
  const setSelectedDocId = useAgentModeStore((s) => s.setSelectedDocId)
  const upsertReport = useAgentModeStore((s) => s.upsertReport)
  const addReviewItem = useReviewStore((s) => s.addItem)
  const report = useMemo(
    () => reports.find((item) => item.docId === selectedDocId) ?? reports[0] ?? null,
    [reports, selectedDocId],
  )
  const actionCards = report?.strategyBundle?.actionCards ?? []
  const legacyCards = report?.strategyBundle?.strategyCards ?? []
  const cards = actionCards
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [status, setStatus] = useState<string>("")
  const [selectedSkillCandidates, setSelectedSkillCandidates] = useState<StrategySkillCandidateManifest[]>([])
  const [taskInput, setTaskInput] = useState<Record<string, string>>({})
  const [touchedInputs, setTouchedInputs] = useState<Record<string, boolean>>({})
  const [createReviewItem, setCreateReviewItem] = useState(false)
  const [lastRunResult, setLastRunResult] = useState<Awaited<ReturnType<typeof runProjectAgent>> | null>(null)
  const [runError, setRunError] = useState<{ layer: string; message: string } | null>(null)
  const [runNotice, setRunNotice] = useState<string>("")
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const resultRef = useRef<HTMLDivElement | null>(null)
  const runMode = RUN_MODES[0].value

  useEffect(() => {
    setSelectedSkillCandidates([])
    setTaskInput({})
    setTouchedInputs({})
    setCreateReviewItem(false)
    setLastRunResult(null)
    setRunError(null)
    setRunNotice("")
    setRunStartedAt(null)
    setElapsedSeconds(0)
  }, [report?.docId])

  useEffect(() => {
    if (busyKey !== "run" || runStartedAt === null) return
    const updateElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - runStartedAt) / 1000)))
    updateElapsed()
    const timer = window.setInterval(updateElapsed, 1000)
    return () => window.clearInterval(timer)
  }, [busyKey, runStartedAt])

  const requiredInputLabels = useMemo(() => {
    const labels = new Set<string>(["objective"])
    for (const candidate of selectedSkillCandidates) {
      for (const item of candidate.requiredInputs ?? []) {
        labels.add(formatBusinessText(item))
      }
    }
    return Array.from(labels)
  }, [selectedSkillCandidates])
  const lastRunSections = useMemo(
    () => buildAgentRunBusinessSections(lastRunResult?.structuredOutput),
    [lastRunResult?.structuredOutput],
  )
  const lastRunTimeline = useMemo(
    () => buildExecutionTimelineItems(lastRunResult?.executionTimeline),
    [lastRunResult?.executionTimeline],
  )
  const lastRunSteps = useMemo(
    () => buildSkillStepExecutionItems(lastRunResult?.stepExecutions),
    [lastRunResult?.stepExecutions],
  )
  const missingInputLabels = useMemo(
    () => requiredInputLabels.filter((label) => !(taskInput[label] ?? "").trim()),
    [requiredInputLabels, taskInput],
  )
  const hasStrategyBundle = Boolean(report?.strategyBundle)
  const runButtonLabel = busyKey === "run" ? "运行中..." : "运行智能执行助手"
  const estimatedRunStepCount = useMemo(() => {
    const selectedSteps = selectedSkillCandidates.reduce((total, candidate) => total + (candidate.actionSteps?.length ?? 0), 0)
    if (selectedSteps > 0) return selectedSteps
    return actionCards.reduce((total, card) => total + (card.actionSteps?.length ?? 0), 0)
  }, [actionCards, selectedSkillCandidates])

  function classifyRunError(error: unknown): { layer: string; message: string } {
    const message = error instanceof Error ? error.message : String(error)
    if (/failed to parse|JSON/i.test(message)) return { layer: "Tauri / JSON 解析", message }
    if (/strategy runtime|python|traceback|ValueError/i.test(message)) return { layer: "Python runtime", message }
    if (/litellm|model|api|provider|key/i.test(message)) return { layer: "模型调用", message }
    return { layer: "Tauri 调用", message }
  }

  async function persistActionCardStatus(card: StrategyActionCard, status: StrategyCardStatus) {
    if (!project || !report?.strategyBundle) return
    const nextActionCards = (report.strategyBundle.actionCards ?? []).map((item) =>
      item.actionCardId === card.actionCardId
        ? { ...item, status, updatedAt: new Date().toISOString() }
        : item
    )
    const nextBundle = {
      ...report.strategyBundle,
      actionCards: nextActionCards,
      strategyCards: report.strategyBundle.strategyCards.map((item) => {
        if (item.cardType !== card.category) return item
        const categoryCards = nextActionCards.filter((candidate) => candidate.category === card.category)
        const nextStatus: StrategyCardStatus = categoryCards.some((candidate) => candidate.status === "promoted_to_skill")
          ? "promoted_to_skill"
          : categoryCards.some((candidate) => candidate.status === "confirmed")
            ? "confirmed"
            : "draft"
        return {
          ...item,
          status: nextStatus,
          updatedAt: new Date().toISOString(),
        }
      }),
    }
    const nextReport = {
      ...report,
      strategyBundle: nextBundle,
      confirmedStrategyCardIds: (nextBundle.actionCards ?? [])
        .filter((item) => item.status === "confirmed" || item.status === "promoted_to_skill")
        .map((item) => item.actionCardId),
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
      setSelectedSkillCandidates(candidates as StrategySkillCandidateManifest[])
      setStatus(`已生成 ${candidates.length} 个业务能力候选。`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyKey(null)
    }
  }

  async function handleApprove(candidate: StrategySkillCandidateManifest, tier: "pilot" | "stable") {
    if (!project) return
    const displayName = skillCandidateDisplayName(candidate)
    setBusyKey(`approve:${candidate.skillId}`)
    try {
      await ensureProjectBrainBinding(project.path)
      await approveStrategySkill(project.path, candidate.skillId, tier)
      setStatus(`已将「${displayName}」设为${skillTierLabel(tier)}能力。`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyKey(null)
    }
  }

  async function handleRunAgent() {
    if (!project || !report) return
    setRunError(null)
    setLastRunResult(null)
    if (!hasStrategyBundle) {
      const message = "请先生成策略包，再运行智能执行助手。"
      setRunError({ layer: "前端输入", message })
      setStatus(message)
      return
    }
    if (actionCards.length === 0) {
      const message = "当前没有可执行动作卡，请重新解析或重新编译该文档。"
      setRunError({ layer: "前端输入", message })
      setStatus(message)
      return
    }
    if (selectedSkillCandidates.length > 0 && missingInputLabels.length > 0) {
      const nextTouched = Object.fromEntries(missingInputLabels.map((label) => [label, true]))
      setTouchedInputs((current) => ({ ...current, ...nextTouched }))
      const message = `请先补充必填输入：${missingInputLabels.map(strategyInputFieldLabel).join("、")}。`
      setRunError({ layer: "前端输入", message })
      setStatus(message)
      return
    }
    setBusyKey("run")
    setRunStartedAt(Date.now())
    setElapsedSeconds(0)
    setRunNotice("正在准备业务能力...")
    setStatus("正在准备业务能力...")
    try {
      await ensureProjectBrainBinding(project.path)
      setRunNotice("正在一次性理解并本地执行步骤，预计 15-40 秒。完成后会展示执行计划、读取来源和步骤结果。")
      setStatus("正在一次性理解并本地执行步骤，预计 15-40 秒...")
      const result = await runProjectAgent(project.path, {
        projectPath: project.path,
        docId: report.docId,
        sceneId: report.sceneId,
        runMode,
        selectedSkillIds: selectedSkillCandidates.map((item) => item.skillId),
        groundingSources: report.strategyBundle?.linkedWikiRefs ?? report.supportingWikiPages,
        taskInput,
        createReviewItem,
      })
      setLastRunResult(result)
      setRunNotice("")
      if (createReviewItem && result.status === "completed") {
        addReviewItem({
          type: "suggestion",
          title: `智能执行助手产物：${RUN_MODES.find((item) => item.value === runMode)?.label ?? "业务能力运行"}`,
          description: result.resultSummary,
          options: [{ label: "进入业务修订", action: "goto-agent-mode" }],
          origin: "agent_skill_run",
          linkedDocId: report.docId,
          agentRunId: result.runId,
          agentSkillId: result.selectedSkillIds[0] ?? null,
          agentEvidenceRefs: selectedSkillCandidates.flatMap((item) => item.sourceRefs),
          agentWikiRefs: result.contextRefs ?? result.groundingSources,
        })
      }
      const statusLabel = agentRunStatusLabel(result.status)
      setStatus(`智能执行助手${statusLabel}：${RUN_MODES.find((item) => item.value === runMode)?.label ?? runMode}。`)
      window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50)
    } catch (error) {
      const classified = classifyRunError(error)
      setRunError(classified)
      setRunNotice("")
      setStatus(classified.message)
      window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50)
    } finally {
      setBusyKey(null)
      setRunStartedAt(null)
    }
  }

  if (!project) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">请先打开业务工作区。</div>
  }

  if (!report) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">当前还没有可用的策略资产，请先导入资料并完成结构化编译。</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <WandSparkles className="h-4 w-4 text-primary" />
          <span>策略与业务能力工作台</span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          从已确认业务修订继续生成策略卡、业务能力候选和可运行智能执行助手。主知识层仍以修订稿和业务知识页为准。
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
              生成业务能力候选
            </Button>
            <Button variant="outline" className="w-full" onClick={() => void handleRunAgent()} disabled={busyKey !== null}>
              <Bot className="mr-1 h-4 w-4" />
              {runButtonLabel}
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
                当前还没有生成可用策略卡。先补齐业务底稿和业务页投影，再进入策略/业务能力链路。
              </div>
            ) : (
              cards.map((card) => (
                <div key={card.actionCardId} className="rounded-xl border bg-background p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{formatBusinessText(card.title)}</div>
                      <div className="mt-2 text-sm leading-6">
                        <div className="font-medium text-foreground">触发条件</div>
                        <div className="mt-1 whitespace-pre-wrap">{formatBusinessText(card.triggerCondition)}</div>
                      </div>
                    </div>
                    <div className="rounded-full border px-2 py-1 text-[11px] text-muted-foreground">
                      {strategyActionStatusLabel(card.status)}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                    <div className="rounded-lg bg-muted/40 px-3 py-2">
                      <div className="font-medium text-foreground">必要输入</div>
                      <div className="mt-1 whitespace-pre-wrap">
                        {card.requiredInputs.map(formatBusinessText).join("、") || "待补齐"}
                      </div>
                    </div>
                    <div className="rounded-lg bg-muted/40 px-3 py-2">
                      <div className="font-medium text-foreground">产出与验证</div>
                      <div className="mt-1 whitespace-pre-wrap">
                        {formatBusinessText(card.outputArtifact)}
                        {card.validationMetrics.length > 0
                          ? `\n指标：${card.validationMetrics.map(formatBusinessText).join("、")}`
                          : ""}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    <div className="font-medium text-foreground">执行步骤</div>
                    <ol className="mt-1 list-decimal space-y-1 pl-4">
                      {card.actionSteps.map((step, index) => (
                        <li key={`${card.actionCardId}-step-${index}`}>{formatBusinessText(step)}</li>
                      ))}
                    </ol>
                    {card.missingInputs.length > 0 ? (
                      <div className="mt-2 text-amber-700">
                        待补输入：{card.missingInputs.map(formatBusinessText).join("、")}
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => void persistActionCardStatus(card, "confirmed")}
                      disabled={busyKey !== null}
                    >
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                      确认为业务动作
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void persistActionCardStatus(card, "rejected")}
                      disabled={busyKey !== null}
                    >
                      暂不采用
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void persistActionCardStatus(card, "promoted_to_skill")}
                      disabled={busyKey !== null}
                    >
                      <Clock3 className="mr-1 h-3.5 w-3.5" />
                      标记可生成能力
                    </Button>
                  </div>
                  {card.wikiRefs.length > 0 ? (
                    <div className="mt-3 text-xs text-muted-foreground">
                      知识页引用：{card.wikiRefs.slice(0, 4).join(" · ")}
                    </div>
                  ) : null}
                  {card.evidenceRefs.length > 0 ? (
                    <div className="mt-3 text-xs text-muted-foreground">
                      证据锚点：{card.evidenceRefs.slice(0, 6).join(" · ")}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>

          {cards.length === 0 && legacyCards.length > 0 ? (
            <div className="mt-4 rounded-xl border bg-background p-4 text-sm text-muted-foreground">
              当前策略包是旧格式摘要卡。请重新解析或重新编译该文档以生成可执行动作卡。
            </div>
          ) : null}

          {selectedSkillCandidates.length > 0 ? (
            <div className="mt-6 rounded-xl border bg-background p-4">
              <div className="text-sm font-semibold">当前业务能力候选</div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {selectedSkillCandidates.map((candidate) => (
                  <div key={candidate.skillId} className="rounded-lg border px-3 py-3 text-xs">
                    <div className="font-medium text-foreground">{skillCandidateDisplayName(candidate)}</div>
                    <div className="mt-1 leading-5 text-muted-foreground">{skillCandidateSummary(candidate)}</div>
                    <div className="mt-2 text-[11px] text-muted-foreground/75">
                      技术标识：{candidate.skillId}
                    </div>
                    <div className="mt-3 grid gap-2">
                      <Button
                        size="xs"
                        onClick={() => void handleApprove(candidate, "pilot")}
                        disabled={busyKey !== null}
                        title={skillTierDescription("pilot")}
                      >
                        设为试运行能力
                      </Button>
                      <div className="text-[11px] text-muted-foreground">{skillTierDescription("pilot")}</div>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => void handleApprove(candidate, "stable")}
                        disabled={busyKey !== null}
                        title={skillTierDescription("stable")}
                      >
                        设为正式能力
                      </Button>
                      <div className="text-[11px] text-muted-foreground">{skillTierDescription("stable")}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {selectedSkillCandidates.length > 0 ? (
            <div className="mt-6 rounded-xl border bg-background p-4">
              <div className="text-sm font-semibold">智能执行助手输入</div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {requiredInputLabels.map((label) => (
                  <label key={label} className="grid gap-1 text-xs">
                    <span className="flex items-center justify-between gap-2 font-medium text-foreground">
                      <span className="flex items-center gap-1">
                        <span>{strategyInputFieldLabel(label)}</span>
                        <span className="text-red-500">*</span>
                        <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-normal text-red-600">必填</span>
                      </span>
                      {strategyInputFieldExample(label) ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => setTaskInput((current) => ({ ...current, [label]: strategyInputFieldExample(label) }))}
                        >
                          应用实例
                        </Button>
                      ) : null}
                    </span>
                    <textarea
                      className={[
                        "min-h-20 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary",
                        touchedInputs[label] && !(taskInput[label] ?? "").trim()
                          ? "border-red-300 bg-red-50/40"
                          : "",
                      ].join(" ")}
                      value={taskInput[label] ?? ""}
                      onChange={(event) => setTaskInput((current) => ({ ...current, [label]: event.target.value }))}
                      onBlur={() => setTouchedInputs((current) => ({ ...current, [label]: true }))}
                      placeholder={strategyInputFieldPlaceholder(label)}
                      required
                    />
                    {touchedInputs[label] && !(taskInput[label] ?? "").trim() ? (
                      <div className="text-[11px] text-red-600">这个输入是必填项，补齐后再运行智能执行助手。</div>
                    ) : null}
                    {strategyInputFieldHelp(label).length > 0 ? (
                      <div className="rounded-md bg-muted/40 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                        {strategyInputFieldHelp(label).map((item) => (
                          <div key={item}>{item}</div>
                        ))}
                      </div>
                    ) : null}
                  </label>
                ))}
              </div>
              <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={createReviewItem}
                  onChange={(event) => setCreateReviewItem(event.target.checked)}
                />
                生成审阅任务，人工确认后再进入业务修订
              </label>
            </div>
          ) : null}

          {busyKey === "run" || runNotice || runError || lastRunResult ? (
            <div ref={resultRef} className="mt-6 rounded-xl border bg-background p-4">
              <div className="text-sm font-semibold">最近一次智能执行助手运行结果</div>
              {busyKey === "run" || runNotice ? (
                <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                  <div className="font-semibold">正在运行</div>
                  <p className="mt-1 leading-6">
                    {runNotice || "正在一次性理解并本地执行步骤，完成后会显示步骤执行结果。"}
                  </p>
                  <div className="mt-2 grid gap-2 text-xs leading-5 text-blue-800 md:grid-cols-3">
                    <div className="rounded-lg bg-white/70 px-3 py-2">已等待：{elapsedSeconds}s</div>
                    <div className="rounded-lg bg-white/70 px-3 py-2">
                      预计步骤：{estimatedRunStepCount > 0 ? `${estimatedRunStepCount} 步` : "按已启用能力自动判断"}
                    </div>
                    <div className="rounded-lg bg-white/70 px-3 py-2">预计耗时：约 15-40 秒</div>
                  </div>
                </div>
              ) : null}
              {runError ? (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                  <div className="font-semibold">运行没有继续：{runError.layer}</div>
                  <p className="mt-1 whitespace-pre-wrap leading-6">{runError.message}</p>
                </div>
              ) : null}
              {lastRunResult ? (
                <div className="mt-2 text-xs text-muted-foreground">
                  状态：{agentRunStatusLabel(lastRunResult.status)} · 执行模式：{formatBusinessText(lastRunResult.executionMode ?? "single_plan_local_execute")} · 产物：{lastRunResult.outputArtifacts.length} 个
                </div>
              ) : null}
              {!lastRunResult ? null : (
              <>
              {lastRunResult.degradationReason ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <div className="font-semibold">为什么降级：{lastRunResult.degradationReason.title}</div>
                  <p className="mt-1 leading-6">{lastRunResult.degradationReason.detail}</p>
                  {lastRunResult.degradationReason.recommendedAction ? (
                    <p className="mt-2 text-xs leading-5 text-amber-800">
                      建议：{lastRunResult.degradationReason.recommendedAction}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {lastRunResult.validationErrors && lastRunResult.validationErrors.length > 0 ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  待补充/校验问题：{lastRunResult.validationErrors.map((item) => String(item.field ?? item.message ?? "未知问题")).join("、")}
                </div>
              ) : null}
              {lastRunResult.contextRefs && lastRunResult.contextRefs.length > 0 ? (
                <div className="mt-3 text-xs text-muted-foreground">
                  读取上下文：{lastRunResult.contextRefs.slice(0, 5).join(" · ")}
                </div>
              ) : null}
              {lastRunSections.length > 0 ? (
                <div className="mt-4 grid gap-3">
                  {lastRunSections.map((section) => (
                    <div key={section.title} className="rounded-xl border bg-muted/20 px-4 py-3">
                      <div className="text-xs font-semibold text-muted-foreground">{section.title}</div>
                      {section.body ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{section.body}</p>
                      ) : null}
                      {section.items && section.items.length > 0 ? (
                        <ul className="mt-2 space-y-1 text-sm leading-6">
                          {section.items.map((item, index) => (
                            <li key={`${section.title}-${index}`} className="flex gap-2">
                              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {lastRunTimeline.length > 0 ? (
                <div className="mt-4 rounded-xl border bg-muted/10 px-4 py-3">
                  <div className="text-sm font-semibold">执行过程</div>
                  <div className="mt-3 space-y-3">
                    {lastRunTimeline.map((entry, index) => (
                      <div key={`${entry.phase}-${index}`} className="flex gap-3">
                        <div className={[
                          "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                          entry.status === "failed"
                            ? "bg-red-500"
                            : entry.status === "degraded"
                              ? "bg-amber-500"
                              : "bg-emerald-500",
                        ].join(" ")} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="font-medium">{entry.title}</span>
                            <span className="rounded-full bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                              {executionTimelineStatusLabel(entry.status)}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {formatExecutionDuration(entry.durationMs)}
                            </span>
                          </div>
                          {entry.detail ? (
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">{entry.detail}</p>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {lastRunResult.executionPlan && "summary" in lastRunResult.executionPlan ? (
                <div className="mt-4 rounded-xl border bg-muted/10 px-4 py-3">
                  <div className="text-sm font-semibold">一次性执行计划</div>
                  <p className="mt-2 text-sm leading-6">
                    {formatBusinessText(String(lastRunResult.executionPlan.summary ?? ""))}
                  </p>
                  {Array.isArray(lastRunResult.executionPlan.stepTasks) && lastRunResult.executionPlan.stepTasks.length > 0 ? (
                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                      {lastRunResult.executionPlan.stepTasks.map((task, index) => (
                        <div key={`${task.stepIndex ?? index}-${task.stepTitle}`} className="rounded-lg bg-background px-3 py-2">
                          <span className="font-medium text-foreground">
                            第 {task.stepIndex ?? index + 1} 步：{formatBusinessText(String(task.stepTitle ?? ""))}
                          </span>
                          <span className="ml-2 rounded-full bg-muted px-2 py-0.5">
                            {skillStepTaskTypeLabel(String(task.taskType ?? ""))}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {lastRunSteps.length > 0 ? (
                <div className="mt-4 rounded-xl border bg-background px-4 py-3">
                  <div className="text-sm font-semibold">步骤执行结果</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    智能执行助手先一次性理解任务，再把步骤拆成读取文件、数据抽取、数据整理和专家确认等本地执行单元。
                  </p>
                  <div className="mt-3 space-y-3">
                    {lastRunSteps.map((step) => (
                      <div
                        key={`${step.stepIndex}-${step.stepTitle}`}
                        className={[
                          "rounded-xl border px-4 py-3",
                          step.status === "failed"
                            ? "border-red-200 bg-red-50"
                            : step.status === "degraded"
                              ? "border-amber-200 bg-amber-50"
                              : "bg-muted/20",
                        ].join(" ")}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-semibold">第 {step.stepIndex} 步：{formatBusinessText(step.stepTitle)}</span>
                          <span className={[
                            "rounded-full px-2 py-0.5 text-[11px]",
                            step.status === "failed"
                              ? "bg-red-100 text-red-700"
                              : step.status === "degraded"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-emerald-100 text-emerald-700",
                          ].join(" ")}>
                            {skillStepStatusLabel(step.status)}
                          </span>
                          <span className="rounded-full bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                            {skillStepTaskTypeLabel(step.taskType)}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {formatExecutionDuration(step.durationMs)}
                          </span>
                        </div>
                        {step.inputRefs.length > 0 ? (
                          <div className="mt-2 text-xs leading-5 text-muted-foreground">
                            使用输入：{step.inputRefs.slice(0, 4).map(formatBusinessText).join(" · ")}
                          </div>
                        ) : null}
                        {step.stepOutput ? (
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                            {formatBusinessText(step.stepOutput)}
                          </p>
                        ) : null}
                        {step.evidenceRefs.length > 0 ? (
                          <div className="mt-2 text-xs leading-5 text-muted-foreground">
                            证据引用：{step.evidenceRefs.slice(0, 5).join(" · ")}
                          </div>
                        ) : null}
                        {step.validationNotes.length > 0 ? (
                          <div className="mt-2 rounded-lg bg-background/70 px-3 py-2 text-xs leading-5 text-muted-foreground">
                            待确认：{step.validationNotes.map(formatBusinessText).join("；")}
                          </div>
                        ) : null}
                        {step.degradationReason ? (
                          <div className="mt-2 text-xs leading-5 text-amber-800">
                            降级说明：{step.degradationReason.detail}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <details className="mt-4 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
                <summary className="cursor-pointer font-medium text-muted-foreground">技术详情</summary>
                {lastRunResult.structuredOutput ? (
                  <pre className="mt-2 whitespace-pre-wrap leading-5">{JSON.stringify(lastRunResult.structuredOutput, null, 2)}</pre>
                ) : null}
                {lastRunResult.stepExecutions ? (
                  <pre className="mt-3 whitespace-pre-wrap leading-5">{JSON.stringify(lastRunResult.stepExecutions, null, 2)}</pre>
                ) : null}
                {lastRunResult.executionPlan ? (
                  <pre className="mt-3 whitespace-pre-wrap leading-5">{JSON.stringify(lastRunResult.executionPlan, null, 2)}</pre>
                ) : null}
                <pre className="mt-3 whitespace-pre-wrap text-sm leading-6">{formatBusinessText(lastRunResult.resultSummary)}</pre>
              </details>
              </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
