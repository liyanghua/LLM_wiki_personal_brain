import { useMemo, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import {
  AlertTriangle,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  Search,
  Sparkles,
  Target,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useResearchStore } from "@/stores/research-store"
import { useWikiStore } from "@/stores/wiki-store"
import {
  createReviewTaskFromOpportunityCard,
  createRevisionTaskFromResearchFinding,
  hasUsableResearchBackend,
  promoteResearchFindingToRevision,
  promoteResearchFindingToWikiDraft,
  runDeepResearchSession,
  skipResearchClarification,
  submitResearchClarification,
} from "@/lib/deep-research"
import { normalizePath } from "@/lib/path-utils"
import { useReviewStore } from "@/stores/review-store"
import { useAgentModeStore } from "@/stores/agent-mode-store"
import { isImeComposing } from "@/lib/keyboard-utils"
import { resolveMarkdownImageSrc } from "@/lib/markdown-image-resolver"
import type { OpportunityCard, ResearchFinding, ResearchReportSection, ResearchSession, ResearchThreadEntry } from "@/lib/research-types"

const PHASE_LABELS: Record<string, string> = {
  clarify_scope: "澄清研究范围",
  plan_queries: "规划查询路线",
  search_sources: "搜索与抓取来源",
  extract_learnings: "提炼有效信息",
  branch_followups: "继续追问分支",
  synthesize_report: "生成研究报告",
  save_research_asset: "保存研究档案",
}

export function ResearchWorkbench() {
  const project = useWikiStore((s) => s.project)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const sessions = useResearchStore((s) => s.sessions)
  const activeSessionId = useResearchStore((s) => s.activeSessionId)
  const setActiveSessionId = useResearchStore((s) => s.setActiveSessionId)
  const enterResearchWorkbench = useResearchStore((s) => s.enterResearchWorkbench)
  const addReviewItem = useReviewStore((s) => s.addItem)
  const enterAgentWorkbench = useAgentModeStore((s) => s.enterAgentWorkbench)
  const setPendingExternalSuggestion = useAgentModeStore((s) => s.setPendingExternalSuggestion)
  const setSelectedDocId = useAgentModeStore((s) => s.setSelectedDocId)
  const activeSession = useMemo(
    () => sessions.find((item) => item.sessionId === activeSessionId) ?? sessions[0] ?? null,
    [sessions, activeSessionId],
  )
  const [topic, setTopic] = useState("")
  const [opportunityTopic, setOpportunityTopic] = useState("")
  const [targetMarket, setTargetMarket] = useState("")
  const [targetAudience, setTargetAudience] = useState("")
  const [businessContext, setBusinessContext] = useState("")
  const [constraints, setConstraints] = useState("")
  const [answer, setAnswer] = useState("")
  const projectPath = project?.path ?? null
  const completedArtifacts = Array.isArray(activeSession?.runtime?.completedArtifacts)
    ? activeSession.runtime.completedArtifacts
    : []
  const followUpQuestions = Array.isArray(activeSession?.followUpQuestions)
    ? activeSession.followUpQuestions
    : []
  const threadEntries = Array.isArray(activeSession?.thread) ? activeSession.thread : []
  const sourceEntries = Array.isArray(activeSession?.sources) ? activeSession.sources : []
  const findingEntries = Array.isArray(activeSession?.findings) ? activeSession.findings : []
  const opportunityCards = Array.isArray(activeSession?.opportunityCards) ? activeSession.opportunityCards : []
  const isOpportunitySession = activeSession?.taskType === "market_opportunity_analysis"
  const reportFallbackMessage = activeSession
    ? activeSession.status === "needs_input"
      ? "当前还在等待你的研究澄清，报告尚未开始生成。你可以先回答澄清问题，或者点击“跳过并直接开始”。"
      : activeSession.status === "running"
        ? "当前研究仍在进行中，报告会在来源抓取与综合完成后生成。"
        : activeSession.status === "blocked"
          ? activeSession.runtime.detail || "当前研究被阻塞，报告暂时无法生成。请先处理阻塞原因后继续。"
          : activeSession.reportMarkdown || "报告尚未生成。完成研究后，这里会展示结构化报告与可回流业务修订的建议。"
    : "报告尚未生成。完成研究后，这里会展示结构化报告与可回流业务修订的建议。"

  function handleCreateSession() {
    if (!topic.trim() || !project) return
    const searchConfig = useWikiStore.getState().searchApiConfig
    if (!hasUsableResearchBackend(searchConfig)) {
      window.alert("当前研究后端尚未配置。请先到“设置 → 网页搜索”补充 Firecrawl 或 Tavily。")
      return
    }
    const sessionId = enterResearchWorkbench({ topic: topic.trim(), triggerSource: "manual" })
    setTopic("")
    if (project) {
      void runDeepResearchSession(sessionId, normalizePath(project.path))
    }
  }

  function handleCreateOpportunitySession() {
    if (!opportunityTopic.trim() || !project) return
    const searchConfig = useWikiStore.getState().searchApiConfig
    if (!hasUsableResearchBackend(searchConfig)) {
      window.alert("当前研究后端尚未配置。请先到“设置 → 网页搜索”补充 Firecrawl 或 Tavily。")
      return
    }
    const sessionId = enterResearchWorkbench({
      taskType: "market_opportunity_analysis",
      topic: opportunityTopic.trim(),
      targetMarket: targetMarket.trim() || null,
      targetAudience: targetAudience.trim() || null,
      businessContext: businessContext.trim() || null,
      constraints: constraints.trim() || null,
      triggerSource: "market_opportunity_analysis",
      breadth: 4,
      depth: 2,
    })
    setOpportunityTopic("")
    setTargetMarket("")
    setTargetAudience("")
    setBusinessContext("")
    setConstraints("")
    if (project) {
      void runDeepResearchSession(sessionId, normalizePath(project.path))
    }
  }

  async function handleRun(sessionId: string) {
    if (!project) return
    const searchConfig = useWikiStore.getState().searchApiConfig
    if (!hasUsableResearchBackend(searchConfig)) {
      window.alert("当前研究后端尚未配置。请先到“设置 → 网页搜索”补充 Firecrawl 或 Tavily。")
      return
    }
    await runDeepResearchSession(sessionId, normalizePath(project.path))
  }

  async function handleSubmitClarification() {
    if (!activeSession || !project || !answer.trim()) return
    await submitResearchClarification(
      activeSession.sessionId,
      normalizePath(project.path),
      answer.trim(),
    )
    setAnswer("")
  }

  async function handleSkipClarification() {
    if (!activeSession || !project) return
    await skipResearchClarification(activeSession.sessionId, normalizePath(project.path))
  }

  async function handlePromoteToRevision(finding: ResearchFinding) {
    if (!activeSession) return
    const promoted = await promoteResearchFindingToRevision(activeSession.sessionId, finding.findingId)
    if (!promoted) return
    if (finding.linkedDocId) {
      setPendingExternalSuggestion({
        source: "research",
        title: promoted.title,
        summary: promoted.summary,
        evidenceSummary: promoted.evidenceSummary,
        targetFieldKey: promoted.targetFieldKey ?? null,
        researchSessionId: activeSession.sessionId,
        researchFindingId: promoted.findingId,
      })
      setSelectedDocId(promoted.linkedDocId ?? null)
      await enterAgentWorkbench(promoted.linkedDocId ?? null)
      return
    }
    addReviewItem({
      type: "suggestion",
      title: `研究候选修订：${promoted.title}`,
      description: `${promoted.summary}\n\n研究依据：${promoted.evidenceSummary}`,
      options: [{ label: "打开深度研究", action: "goto-research-mode" }],
      origin: "agent_mode",
      linkedDocId: promoted.linkedDocId ?? null,
      researchSessionId: activeSession.sessionId,
      researchFindingId: promoted.findingId,
      researchEvidenceSummary: promoted.evidenceSummary,
      researchSourceUrls: promoted.sourceUrls,
      targetFieldKey: promoted.targetFieldKey ?? null,
    })
    setActiveView("review")
  }

  async function handleCreateRevisionTask(finding: ResearchFinding) {
    if (!activeSession) return
    await createRevisionTaskFromResearchFinding(activeSession.sessionId, finding.findingId)
    setActiveView("review")
  }

  async function handlePromoteToWikiDraft(finding: ResearchFinding) {
    if (!activeSession) return
    await promoteResearchFindingToWikiDraft(activeSession.sessionId, finding.findingId)
    addReviewItem({
      type: "suggestion",
      title: `纳入知识页草案：${finding.title}`,
      description: `${finding.summary}\n\n研究依据：${finding.evidenceSummary}`,
      options: [{ label: "打开深度研究", action: "goto-research-mode" }],
      origin: "wiki_lint",
      linkedDocId: finding.linkedDocId ?? null,
      researchSessionId: activeSession.sessionId,
      researchFindingId: finding.findingId,
      researchEvidenceSummary: finding.evidenceSummary,
      researchSourceUrls: finding.sourceUrls,
      targetFieldKey: finding.targetFieldKey ?? null,
    })
    setActiveView("review")
  }

  async function handleCreateOpportunityReview(card: OpportunityCard) {
    if (!activeSession) return
    await createReviewTaskFromOpportunityCard(activeSession.sessionId, card.cardId)
    setActiveView("review")
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="w-[280px] shrink-0 border-r bg-muted/20">
        <div className="border-b px-4 py-4">
          <div className="mb-2 flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">深度研究工作台</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            先澄清研究范围，再按 breadth / depth 递归外部调研，最后形成可回流业务修订的候选结论。
          </p>
        </div>
        <div className="space-y-3 border-b px-4 py-4">
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-950">
              <BriefcaseBusiness className="h-4 w-4" />
              商机/市场分析
            </div>
            <div className="space-y-2">
              <Input
                value={opportunityTopic}
                onChange={(e) => setOpportunityTopic(e.target.value)}
                placeholder="分析对象，如 AI 主图设计工具"
                className="bg-white"
              />
              <Input
                value={targetMarket}
                onChange={(e) => setTargetMarket(e.target.value)}
                placeholder="目标市场，可选"
                className="bg-white"
              />
              <Input
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                placeholder="目标客群，可选"
                className="bg-white"
              />
              <Input
                value={businessContext}
                onChange={(e) => setBusinessContext(e.target.value)}
                placeholder="业务背景/已知机会，可选"
                className="bg-white"
              />
              <Input
                value={constraints}
                onChange={(e) => setConstraints(e.target.value)}
                placeholder="约束或希望验证的问题，可选"
                className="bg-white"
              />
            </div>
            <Button
              className="mt-3 w-full"
              variant="secondary"
              onClick={handleCreateOpportunitySession}
              disabled={!project || !opportunityTopic.trim()}
            >
              生成机会卡片矩阵
            </Button>
          </div>
          <div className="rounded-2xl border bg-card p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Search className="h-4 w-4 text-primary" />
              快速新建深度研究
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              输入一个研究主题即可创建并运行，原“轻量调研面板”的快速入口已合并到这里。
            </p>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => {
                if (isImeComposing(e)) return
                if (e.key === "Enter") handleCreateSession()
              }}
              placeholder="输入新的研究主题..."
            />
          </div>
          <Button className="w-full" onClick={handleCreateSession} disabled={!project || !topic.trim()}>
            开始深度研究
          </Button>
        </div>
        <div className="overflow-y-auto px-2 py-2">
          {sessions.length === 0 ? (
            <div className="px-3 py-6 text-xs text-muted-foreground">
              还没有研究会话。你可以从图谱缺口、待审阅问题或业务修订中的外部补充入口进入，也可以直接新建。
            </div>
          ) : (
            sessions.map((session) => {
              const active = session.sessionId === activeSession?.sessionId
              return (
                <button
                  key={session.sessionId}
                  onClick={() => setActiveSessionId(session.sessionId)}
                  className={`mb-2 w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                    active ? "border-primary bg-primary/5" : "hover:bg-accent"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{session.topic}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {session.taskType === "market_opportunity_analysis" ? "商机分析" : "深度研究"} · {PHASE_LABELS[session.phase]} · {statusLabel(session.status)}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {!activeSession ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            选择或创建一条研究会话，开始进入独立研究工作台。
          </div>
        ) : (
          <>
            <div className="border-b px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-primary" />
                    <h1 className="text-lg font-semibold">{activeSession.topic}</h1>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {activeSession.runtime.detail}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                    breadth {activeSession.breadth}
                  </span>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                    round {Math.max(activeSession.currentRound, activeSession.runtime.currentRound)} / {activeSession.depth}
                  </span>
                  <Button
                    variant="outline"
                    onClick={() => handleRun(activeSession.sessionId)}
                    disabled={!project || activeSession.status === "running"}
                  >
                    {activeSession.status === "running" ? "研究中..." : "继续研究"}
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border px-2 py-1">{PHASE_LABELS[activeSession.phase]}</span>
                {completedArtifacts.map((item) => (
                  <span key={item} className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-300">
                    {item}
                  </span>
                ))}
                {activeSession.errorMessage && (
                  <span className="rounded-full bg-destructive/10 px-2 py-1 text-destructive">
                    {activeSession.errorMessage}
                  </span>
                )}
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-[1.2fr_0.9fr]">
              <div className="min-h-0 overflow-y-auto border-r px-5 py-4">
                {isOpportunitySession && (
                  <section className="mb-5 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-950">
                      <BriefcaseBusiness className="h-4 w-4" />
                      机会卡片矩阵
                    </div>
                    {opportunityCards.length > 0 ? (
                      <div className="grid gap-3">
                        {opportunityCards.map((card) => (
                          <OpportunityCardView
                            key={card.cardId}
                            card={card}
                            onCreateReview={() => void handleCreateOpportunityReview(card)}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-amber-300 bg-white/70 px-4 py-5 text-sm text-amber-900">
                        研究完成后，这里会优先展示“机会卡片矩阵”。如果来源证据不足，不会生成伪机会卡。
                      </div>
                    )}
                  </section>
                )}
                <section className="mb-5 rounded-xl border bg-card p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <Sparkles className="h-4 w-4 text-primary" />
                    {isOpportunitySession ? "过程与证据：研究线程" : "研究线程"}
                  </div>
                  <div className="space-y-3 text-sm">
                    {threadEntries.length > 0 ? threadEntries.map((entry) => (
                      <ResearchThreadCard key={entry.entryId} entry={entry} />
                    )) : (
                      <div className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
                        研究开始后，这里会按时间顺序展示澄清、查询、抓取、learnings、报告与回流动作。
                      </div>
                    )}
                  </div>
                </section>

                <section className="mb-5 rounded-xl border bg-card p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <Globe className="h-4 w-4 text-primary" />
                    来源与抓取
                  </div>
                  <div className="space-y-3">
                    {sourceEntries.length > 0 ? sourceEntries.map((source) => (
                      <SourceEvidenceCard key={source.id} source={source} />
                    )) : (
                      <div className="text-sm text-muted-foreground">
                        研究开始后，这里会逐条展示来源、抓取摘要和被用到的结论。
                      </div>
                    )}
                  </div>
                </section>

                <section className="rounded-xl border bg-card p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <FileText className="h-4 w-4 text-primary" />
                    最终研究报告
                  </div>
                  {activeSession.reportSections?.parsed ? (
                    <div className="space-y-4">
                      {activeSession.reportSections.sections.map((section) => (
                        <ReportSectionCard
                          key={section.key}
                          section={section}
                          projectPath={projectPath}
                          session={activeSession}
                        />
                      ))}
                    </div>
                  ) : (
                    <MarkdownBody
                      content={reportFallbackMessage}
                      projectPath={projectPath}
                    />
                  )}
                </section>
              </div>

              <div className="min-h-0 overflow-y-auto px-5 py-4">
                <section className="mb-5 rounded-xl border bg-card p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    {activeSession.status === "running" ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : activeSession.status === "blocked" || activeSession.status === "error" ? (
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    )}
                    研究状态条
                  </div>
                  <div className="space-y-2 text-sm">
                    <div>当前阶段：{PHASE_LABELS[activeSession.phase]}</div>
                    <div>当前状态：{statusLabel(activeSession.status)}</div>
                    <div>当前轮次：{Math.max(activeSession.currentRound, activeSession.runtime.currentRound)} / {activeSession.depth}</div>
                    <div>当前后端：{providerLabel(activeSession.runtime.providerStatus?.provider ?? activeSession.providerStatus?.provider ?? "none")}</div>
                    <div>已访问来源：{activeSession.runtime.visitedUrls.length}</div>
                    <div>已采纳来源：{activeSession.runtime.acceptedSourcesCount}</div>
                    <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      {activeSession.runtime.providerStatus?.detail || activeSession.runtime.detail}
                    </div>
                    {(activeSession.status === "blocked" || activeSession.status === "error" || activeSession.errorMessage) && (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                        {activeSession.errorMessage || activeSession.runtime.errorMessage || activeSession.runtime.detail}
                      </div>
                    )}
                  </div>
                </section>

                <section className="mb-5 rounded-xl border bg-card p-4">
                  <div className="mb-2 text-sm font-semibold">Follow-up 澄清</div>
                  <div className={`space-y-2 ${activeSession.status === "needs_input" ? "rounded-lg border border-primary/30 bg-primary/5 p-3" : ""}`}>
                    {activeSession.status === "needs_input" && (
                      <div className="rounded-lg border border-primary/20 bg-white/80 px-3 py-2 text-xs text-primary dark:bg-primary/10">
                        当前正在等待你的澄清，研究尚未继续。你可以补充研究范围，也可以直接跳过开始。
                      </div>
                    )}
                    {(followUpQuestions.length > 0
                      ? followUpQuestions
                      : ["这轮研究最希望解决的业务判断是什么？", "希望重点围绕哪些对象、动作或指标展开？"]
                    ).map((question) => (
                      <div key={question} className="rounded-md bg-muted/50 px-3 py-2 text-xs">{question}</div>
                    ))}
                    <Input
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      placeholder="输入你对当前研究澄清问题的回答..."
                    />
                    <div className="flex gap-2">
                      <Button onClick={handleSubmitClarification} disabled={!project || !answer.trim()}>
                        提交澄清并继续
                      </Button>
                      <Button variant="outline" onClick={handleSkipClarification} disabled={!project}>
                        跳过并直接开始
                      </Button>
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border bg-card p-4">
                  <div className="mb-2 text-sm font-semibold">候选结论与回流</div>
                  <div className="space-y-3">
                    {findingEntries.length > 0 ? findingEntries.map((finding) => (
                      <div key={finding.id} className="rounded-lg border p-3">
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <div className="text-sm font-medium">{finding.title}</div>
                          <span className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                            {promotionLabel(finding.promotionState)}
                          </span>
                        </div>
                        <div className="mb-2 text-xs text-muted-foreground">{finding.summary}</div>
                        {finding.evidenceSummary && (
                          <div className="mb-3 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                            研究依据：{finding.evidenceSummary}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => void handlePromoteToRevision(finding)}>加入当前业务修订</Button>
                          <Button size="sm" variant="outline" onClick={() => void handleCreateRevisionTask(finding)}>生成修订任务</Button>
                          <Button size="sm" variant="outline" onClick={() => void handlePromoteToWikiDraft(finding)}>纳入知识页草案</Button>
                        </div>
                      </div>
                    )) : (
                      <div className="text-sm text-muted-foreground">
                        当前还没有候选业务结论。研究完成后，这里会出现“可纳入业务修订”的候选项。
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function statusLabel(status: ResearchSession["status"]): string {
  switch (status) {
    case "needs_input":
      return "等待澄清"
    case "blocked":
      return "已阻塞"
    case "running":
      return "研究中"
    case "done":
      return "已完成"
    case "error":
      return "出错"
    case "idle":
    default:
      return "待开始"
  }
}

function providerLabel(provider: "firecrawl" | "tavily" | "none"): string {
  if (provider === "firecrawl") return "Firecrawl"
  if (provider === "tavily") return "Tavily-only"
  return "未启用"
}

function promotionLabel(state: ResearchFinding["promotionState"]): string {
  switch (state) {
    case "promoted_to_revision":
      return "已带入修订"
    case "promoted_to_review":
      return "已生成任务"
    case "promoted_to_wiki_draft":
      return "已入草案"
    case "idle":
    default:
      return "待确认"
  }
}

function threadIcon(kind: ResearchThreadEntry["kind"]) {
  if (kind === "error") return <AlertTriangle className="h-4 w-4 text-amber-500" />
  if (kind === "degraded") return <AlertTriangle className="h-4 w-4 text-zinc-500" />
  if (kind === "finding_promoted") return <Target className="h-4 w-4 text-emerald-600" />
  return <Clock3 className="h-4 w-4 text-primary" />
}

function ResearchThreadCard({ entry }: { entry: ResearchThreadEntry }) {
  return (
    <div className="rounded-xl border bg-card/80 p-3">
      <div className="mb-2 flex items-start gap-3">
        <div className="mt-0.5">{threadIcon(entry.kind)}</div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{entry.title}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {new Date(entry.createdAt).toLocaleString()}
          </div>
        </div>
      </div>
      <div className="space-y-2 text-xs text-muted-foreground">
        <div>{entry.detail}</div>
        {entry.query && (
          <div className="rounded-md bg-muted/50 px-3 py-2">
            查询：{entry.query}
          </div>
        )}
        {entry.url && (
          <div className="break-all rounded-md bg-muted/40 px-3 py-2">
            来源：{entry.url}
          </div>
        )}
      </div>
    </div>
  )
}

function SourceEvidenceCard({ source }: { source: ResearchSession["sources"][number] }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div className="text-sm font-medium">{source.title}</div>
        <span className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">{source.source}</span>
      </div>
      <div className="mb-2 break-all text-[11px] text-muted-foreground">{source.url}</div>
      <div className="mb-2 text-xs text-muted-foreground">{source.snippet}</div>
      {source.reliabilityNote && (
        <div className="mb-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          抓取状态：{source.reliabilityNote}
        </div>
      )}
      {source.learnedFacts.length > 0 && (
        <div className="space-y-1">
          {source.learnedFacts.map((fact) => (
            <div key={fact} className="rounded-md border px-3 py-2 text-xs">{fact}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function OpportunityCardView({
  card,
  onCreateReview,
}: {
  card: OpportunityCard
  onCreateReview: () => void
}) {
  return (
    <div className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-zinc-950">{card.title}</div>
          <div className="mt-1 text-xs text-zinc-600">目标客群：{card.targetSegment}</div>
        </div>
        <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-900">
          置信度 {Math.round(card.confidence * 100)}%
        </span>
      </div>
      <div className="grid gap-2 text-xs text-zinc-700">
        <div className="rounded-lg bg-amber-50 px-3 py-2">
          <span className="font-medium text-amber-950">痛点：</span>{card.painPoint}
        </div>
        <div className="rounded-lg bg-emerald-50 px-3 py-2">
          <span className="font-medium text-emerald-950">机会假设：</span>{card.opportunityHypothesis}
        </div>
        <div className="rounded-lg bg-sky-50 px-3 py-2">
          <span className="font-medium text-sky-950">证据：</span>{card.evidenceSummary || "待补证据"}
        </div>
      </div>
      {card.competitorSignals.length > 0 && (
        <div className="mt-3 text-xs text-zinc-600">
          <span className="font-medium text-zinc-900">竞品/替代信号：</span>{card.competitorSignals.join("；")}
        </div>
      )}
      {card.risks.length > 0 && (
        <div className="mt-2 text-xs text-amber-800">
          <span className="font-medium">风险与缺口：</span>{card.risks.join("；")}
        </div>
      )}
      {card.validationExperiments.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-medium text-zinc-900">建议验证实验</div>
          <div className="flex flex-wrap gap-1.5">
            {card.validationExperiments.map((experiment) => (
              <span key={experiment} className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800">
                {experiment}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={onCreateReview}>
          生成评审任务
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {card.status === "promoted_to_review" ? "已进入评审" : "候选资产，需人工确认后才能进入策略链路"}
        </span>
      </div>
    </div>
  )
}

function ReportSectionCard({
  section,
  projectPath,
  session,
}: {
  section: ResearchReportSection
  projectPath: string | null
  session: ResearchSession
}) {
  return (
    <div className="rounded-xl border bg-card/90 p-4">
      <div className="mb-3 text-sm font-semibold">{section.title}</div>
      {section.key === "evidence_sources" ? (
        <div className="space-y-3">
          {section.content ? <MarkdownBody content={section.content} projectPath={projectPath} /> : null}
          {session.sources.length > 0 && (
            <div className="space-y-3">
              {session.sources.map((source) => (
                <div key={source.id} className="rounded-lg border border-dashed p-3">
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">{source.title}</div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="mb-2 break-all text-[11px] text-muted-foreground">{source.url}</div>
                  <div className="text-xs text-muted-foreground">{source.reliabilityNote || source.snippet}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <MarkdownBody
          content={section.content || "当前章节还没有生成可读内容。"}
          projectPath={projectPath}
        />
      )}
    </div>
  )
}

function MarkdownBody({ content, projectPath }: { content: string; projectPath: string | null }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          img: ({ src, alt, ...props }) => (
            <img
              src={typeof src === "string" ? resolveMarkdownImageSrc(src, projectPath) : undefined}
              alt={alt ?? ""}
              className="max-w-full rounded border border-border/40"
              loading="lazy"
              {...props}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
