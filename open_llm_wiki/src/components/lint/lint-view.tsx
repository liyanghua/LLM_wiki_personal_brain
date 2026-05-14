import { useCallback, useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowUpRight,
  BrainCircuit,
  CheckCircle2,
  Link2Off,
  RefreshCw,
  Trash2,
  Unlink,
  Wrench,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { useAgentModeStore } from "@/stores/agent-mode-store"
import { useAgentLoopStore } from "@/stores/agent-loop-store"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { readFile, writeFile, listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { runWikiHealthAudit, type WikiHealthReport } from "@/lib/wiki-health"
import { labelForGateStatus, labelForHealthStatus, labelForIssueScope } from "@/lib/quality-contracts"
import type { LintResult } from "@/lib/lint"
import { createAgentLoopSession, createWikiFeedbackTask } from "@/lib/revision-pipeline"
import { saveAgentLoopSession } from "@/lib/agent-mode-persist"

const typeConfig: Record<string, { icon: typeof AlertTriangle; label: string }> = {
  orphan: { icon: Unlink, label: "孤儿页" },
  "broken-link": { icon: Link2Off, label: "坏链" },
  "no-outlinks": { icon: ArrowUpRight, label: "无出链" },
  semantic: { icon: BrainCircuit, label: "语义问题" },
}

function gateBadge(status: string): string {
  if (status === "fail") return "bg-red-100 text-red-700"
  if (status === "warn") return "bg-amber-100 text-amber-700"
  return "bg-emerald-100 text-emerald-700"
}

export function LintView() {
  const project = useWikiStore((s) => s.project)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const reports = useAgentModeStore((s) => s.reports)
  const setSelectedDocId = useAgentModeStore((s) => s.setSelectedDocId)
  const enterAgentWorkbench = useAgentModeStore((s) => s.enterAgentWorkbench)
  const loopSessions = useAgentLoopStore((s) => s.sessions)
  const upsertLoopSession = useAgentLoopStore((s) => s.upsertSession)

  const [report, setReport] = useState<WikiHealthReport | null>(null)
  const [running, setRunning] = useState(false)
  const [hasRun, setHasRun] = useState(false)
  const [runSemantic, setRunSemantic] = useState(false)
  const [fixingId, setFixingId] = useState<string | null>(null)
  const [scopeFilter, setScopeFilter] = useState<"all" | LintResult["issueScope"]>("all")
  const [rootCauseFilter, setRootCauseFilter] = useState<string>("all")

  const allResults = useMemo(
    () =>
      report
        ? [
            ...report.structuralResults,
            ...report.semanticResults,
            ...report.compileResults,
            ...report.retrievalResults,
          ]
        : [],
    [report],
  )

  const filteredResults = useMemo(
    () =>
      allResults.filter((result) => {
        if (scopeFilter !== "all" && result.issueScope !== scopeFilter) return false
        if (rootCauseFilter !== "all" && result.rootCause !== rootCauseFilter) return false
        return true
      }),
    [allResults, scopeFilter, rootCauseFilter],
  )

  const scopeStats = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of allResults) {
      counts.set(item.issueScope, (counts.get(item.issueScope) ?? 0) + 1)
    }
    return counts
  }, [allResults])

  const rootCauseOptions = useMemo(
    () => Array.from(new Set(allResults.map((item) => item.rootCause))).sort(),
    [allResults],
  )

  const handleRunLint = useCallback(async () => {
    if (!project || running) return
    const pp = normalizePath(project.path)
    setRunning(true)
    setReport(null)
    try {
      const next = await runWikiHealthAudit(pp, llmConfig, {
        runSemantic: runSemantic && hasUsableLlm(llmConfig),
      })
      setReport(next)
      setHasRun(true)
    } catch (err) {
      console.error("Wiki health audit failed:", err)
    } finally {
      setRunning(false)
    }
  }, [project, llmConfig, running, runSemantic])

  async function handleOpenPage(page: string) {
    if (!project) return
    const pp = normalizePath(project.path)
    const candidates = [`${pp}/wiki/${page}`, `${pp}/wiki/${page}.md`]
    setActiveView("wiki")
    for (const path of candidates) {
      try {
        const content = await readFile(path)
        setSelectedFile(path)
        setFileContent(content)
        return
      } catch {
        // try next
      }
    }
    setSelectedFile(candidates[0])
    setFileContent(`Unable to load: ${page}`)
  }

  async function handleFix(result: LintResult, index: number) {
    if (!project) return
    const pp = normalizePath(project.path)
    const id = `${result.issueId}-${index}`
    setFixingId(id)

    try {
      switch (result.type) {
        case "orphan": {
          const indexPath = `${pp}/wiki/index.md`
          let indexContent = ""
          try { indexContent = await readFile(indexPath) } catch { indexContent = "# Wiki Index\n" }

          const pageName = result.page.replace(".md", "").replace(/^.*\//, "")
          const entry = `- [[${pageName}]]`
          if (!indexContent.includes(entry)) {
            indexContent = indexContent.trimEnd() + "\n" + entry + "\n"
            await writeFile(indexPath, indexContent)
          }
          break
        }

        case "broken-link": {
          const pagePath = `${pp}/wiki/${result.page}`
          useReviewStore.getState().addItem({
            type: "confirm",
            title: `修复坏链：${result.page}`,
            description: result.detail,
            affectedPages: [result.page],
            origin: "wiki_lint",
            issueScope: result.issueScope,
            rootCause: result.rootCause,
            linkedIssueId: result.issueId,
            linkedDocId: result.linkedDocId ?? null,
            options: [
              { label: "打开并编辑", action: `open:${result.page}` },
              { label: "删除页面", action: `delete:${pagePath}` },
              { label: "跳过", action: "Skip" },
            ],
          })
          break
        }

        case "no-outlinks":
        default: {
          useReviewStore.getState().addItem({
            type: "suggestion",
            title: `补强页面连接：${result.page}`,
            description: result.detail,
            affectedPages: result.affectedPages ?? [result.page],
            origin: "wiki_lint",
            issueScope: result.issueScope,
            rootCause: result.rootCause,
            linkedIssueId: result.issueId,
            linkedDocId: result.linkedDocId ?? null,
            options: [
              { label: "打开并编辑", action: `open:${result.page}` },
              ...(result.linkedDocId ? [{ label: "回到原文修订", action: "goto-agent-mode" }] : []),
              { label: "跳过", action: "Skip" },
            ],
          })
          break
        }
      }

      const tree = await listDirectory(pp)
      setFileTree(tree)
      bumpDataVersion()
    } catch (err) {
      console.error("Fix failed:", err)
    } finally {
      setFixingId(null)
    }
  }

  async function handleDeleteOrphan(result: LintResult) {
    if (!project) return
    const pp = normalizePath(project.path)
    const pagePath = `${pp}/wiki/${result.page}`
    const confirmed = window.confirm(`删除孤儿页 "${result.page}"？`)
    if (!confirmed) return

    try {
      const { cascadeDeleteWikiPagesWithRefs } = await import("@/lib/wiki-page-delete")
      await cascadeDeleteWikiPagesWithRefs(pp, [pagePath])
      const tree = await listDirectory(pp)
      setFileTree(tree)
      bumpDataVersion()
      if (report) {
        const rerun = await runWikiHealthAudit(pp, llmConfig, {
          runSemantic: runSemantic && hasUsableLlm(llmConfig),
        })
        setReport(rerun)
      }
    } catch (err) {
      console.error("Delete failed:", err)
    }
  }

  async function handleFlowBackToSource(result: LintResult) {
    if (!project || !result.linkedDocId) return
    const report = reports.find((item) => item.docId === result.linkedDocId)
    if (!report) {
      setSelectedDocId(result.linkedDocId)
      await enterAgentWorkbench(result.linkedDocId)
      return
    }
    const feedbackTask = createWikiFeedbackTask(report, result)
    if (!feedbackTask) {
      setSelectedDocId(report.docId)
      await enterAgentWorkbench(report.docId)
      return
    }
    const previous = loopSessions.find((item) => item.docId === report.docId) ?? null
    const nextLoop = createAgentLoopSession(report, "wiki_health_feedback", {
      activeCardId: feedbackTask.linkedCardId ?? null,
      feedbackTask,
      previous,
    })
    upsertLoopSession(nextLoop)
    setSelectedDocId(report.docId)
    await enterAgentWorkbench(report.docId)
    await saveAgentLoopSession(project.path, nextLoop).catch((error) => {
      console.error("Failed to save loop feedback session:", error)
    })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Wiki 健康检查</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              这里专门看 wiki 作为知识中间层与检索层的健康度，不与原文修订质量混在一起。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                className="h-3 w-3"
                checked={runSemantic}
                onChange={(e) => setRunSemantic(e.target.checked)}
              />
              语义检查（LLM）
            </label>
            <Button size="sm" onClick={handleRunLint} disabled={running || !project}>
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
              {running ? "检查中..." : "运行健康检查"}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!hasRun ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 text-muted-foreground/30" />
            <p>运行健康检查，查看 wiki 的结构、编译和检索健康度。</p>
            <p className="text-xs">这部分只检查 wiki 层，不评判原文内容本身。</p>
          </div>
        ) : !report ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <AlertTriangle className="h-8 w-8 text-amber-500/70" />
            <p>健康检查结果还未生成。</p>
          </div>
        ) : (
          <div className="space-y-4 p-4">
            <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-2xl border bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">Wiki 健康分</p>
                    <div className="mt-2 flex items-end gap-3">
                      <span className="text-4xl font-semibold text-zinc-900">{report.wikiHealth.score}</span>
                      <span className="pb-1 text-sm text-zinc-500">/100</span>
                    </div>
                    <p className="mt-2 text-sm text-zinc-600">{report.wikiHealth.summary}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${gateBadge(report.publishGate.status)}`}>
                    {labelForHealthStatus(report.wikiHealth.status)}
                  </span>
                </div>

                <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {report.wikiHealth.dimensions.map((dimension) => (
                    <div key={dimension.key} className="rounded-2xl bg-zinc-50 px-3 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-zinc-900">{dimension.label}</span>
                        <span className="text-xs text-zinc-500">{dimension.score}/100</span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-zinc-500">{dimension.rationale}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border bg-white p-4 shadow-sm">
                <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">发布门禁</p>
                <div className="mt-3 flex items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${gateBadge(report.publishGate.status)}`}>
                    {labelForGateStatus(report.publishGate.status)}
                  </span>
                  <span className="text-sm text-zinc-600">{report.publishGate.summary}</span>
                </div>
                <div className="mt-4 space-y-2">
                  {report.publishGate.rules.map((rule) => (
                    <div key={rule.ruleKey} className="rounded-2xl bg-zinc-50 px-3 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-zinc-900">{rule.label}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${gateBadge(rule.status)}`}>
                          {rule.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-500">{rule.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {report.imageHealth ? (
              <section className="rounded-2xl border bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-900">图片证据索引</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      用于判断原文图片是否已经进入可检索证据层；空 alt 或缺 caption 会影响图文问答质量。
                    </p>
                  </div>
                  {report.imageHealth.imageEmptyAltTotal > 0 ? (
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                      {report.imageHealth.imageEmptyAltTotal} 张图片缺少说明
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                      图片说明较完整
                    </span>
                  )}
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
                  {[
                    ["图片文件", report.imageHealth.imageFilesTotal],
                    ["Markdown 引用", report.imageHealth.imageRefsTotal],
                    ["已有说明", report.imageHealth.imageCaptionedTotal],
                    ["已入索引", report.imageHealth.imageIndexedTotal],
                    ["孤儿图片", report.imageHealth.imageOrphanedTotal],
                    ["空 alt", report.imageHealth.imageEmptyAltTotal],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl bg-zinc-50 px-3 py-3">
                      <p className="text-xs text-zinc-500">{label}</p>
                      <p className="mt-1 text-2xl font-semibold text-zinc-900">{value}</p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-zinc-900">问题统计与筛选</p>
                  <p className="mt-1 text-xs text-zinc-500">只显示 wiki 资产、wiki 编译、检索运行时三类问题。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    className="rounded-xl border px-3 py-2 text-sm"
                    value={scopeFilter}
                    onChange={(e) => setScopeFilter(e.target.value as typeof scopeFilter)}
                  >
                    <option value="all">全部层级</option>
                    <option value="wiki_asset">wiki_asset</option>
                    <option value="wiki_compile">wiki_compile</option>
                    <option value="retrieval_runtime">retrieval_runtime</option>
                  </select>
                  <select
                    className="rounded-xl border px-3 py-2 text-sm"
                    value={rootCauseFilter}
                    onChange={(e) => setRootCauseFilter(e.target.value)}
                  >
                    <option value="all">全部根因</option>
                    {rootCauseOptions.map((rootCause) => (
                      <option key={rootCause} value={rootCause}>{rootCause}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {Array.from(scopeStats.entries()).map(([scope, count]) => (
                  <span key={scope} className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600">
                    {labelForIssueScope(scope as LintResult["issueScope"])} · {count}
                  </span>
                ))}
              </div>
            </section>

            {filteredResults.length === 0 ? (
              <div className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-zinc-500">
                当前筛选条件下没有问题项。
              </div>
            ) : (
              <div className="space-y-3">
                {filteredResults.map((result, index) => (
                  <LintCard
                    key={result.issueId}
                    result={result}
                    index={index}
                    fixing={fixingId === `${result.issueId}-${index}`}
                    onOpenPage={handleOpenPage}
                    onFix={handleFix}
                    onFlowBack={handleFlowBackToSource}
                    onDelete={result.type === "orphan" ? handleDeleteOrphan : undefined}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function LintCard({
  result,
  index,
  fixing,
  onOpenPage,
  onFix,
  onFlowBack,
  onDelete,
}: {
  result: LintResult
  index: number
  fixing: boolean
  onOpenPage: (page: string) => void
  onFix: (result: LintResult, index: number) => void
  onFlowBack: (result: LintResult) => void
  onDelete?: (result: LintResult) => void
}) {
  const config = typeConfig[result.type] ?? typeConfig.semantic
  const Icon = config.icon

  return (
    <div className="rounded-2xl border bg-white p-4 text-sm shadow-sm">
      <div className="mb-2 flex items-start gap-3">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${result.severity === "warning" ? "text-amber-500" : "text-blue-500"}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-zinc-900">{result.page}</span>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">{config.label}</span>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">{result.issueScope}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${result.blocking ? "bg-red-100 text-red-700" : "bg-zinc-100 text-zinc-600"}`}>
              {result.blocking ? "阻塞" : "非阻塞"}
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-zinc-500">{result.detail}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-zinc-500">
            <span>root_cause: {result.rootCause}</span>
            {result.linkedDocId && <span>linked_doc: {result.linkedDocId}</span>}
          </div>
        </div>
      </div>

      {result.affectedPages && result.affectedPages.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {result.affectedPages.map((page) => (
            <button
              key={page}
              type="button"
              onClick={() => onOpenPage(page)}
              className="inline-flex items-center gap-0.5 rounded bg-accent/60 px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-accent transition-colors"
            >
              {page}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onOpenPage(result.page)}>
          打开页面
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" disabled={fixing} onClick={() => onFix(result, index)}>
          <Wrench className="h-3 w-3" />
          {fixing ? "处理中..." : "转交处理"}
        </Button>
        {result.linkedDocId && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onFlowBack(result)}
          >
            回到原文修订
          </Button>
        )}
        {onDelete && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
            onClick={() => onDelete(result)}
          >
            <Trash2 className="h-3 w-3" />
            删除孤儿页
          </Button>
        )}
      </div>
    </div>
  )
}
