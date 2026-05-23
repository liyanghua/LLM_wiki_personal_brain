import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { loadAgentModeReports, saveAgentModeReport } from "@/lib/agent-mode-persist"
import { ensureScenePack } from "@/lib/scene-pack"
import { rebuildSemanticUnitIndex } from "@/lib/semantic-units"
import { buildOrRefreshTaskIndex, renderTaskIndexMarkdown } from "@/lib/task-index"
import { writeStrategyBundle } from "@/lib/strategy-compile"
import { sweepResolvedReviews } from "@/lib/sweep-reviews"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { createIngestRunRecorder } from "@/lib/ingest-timing"
import { writeProjectQualityReport } from "@/lib/project-quality-report"
import { normalizePath } from "@/lib/path-utils"
import { useActivityStore } from "@/stores/activity-store"
import { useWikiStore } from "@/stores/wiki-store"

export interface DeferredIngestPostProcessingResult {
  semanticUnitCount: number
  taskCount: number
  filesWritten: string[]
  warnings: string[]
}

export interface DeferredIngestPostProcessingOptions {
  signal?: AbortSignal
  runReviewSweep?: boolean
  runStrategyEnhancement?: boolean
  runEmbeddings?: boolean
}

const DEFERRED_EMBEDDING_TIMEOUT_MS = 45_000

async function runSoftTimedEmbeddingPhase(
  task: () => Promise<number>,
  timeoutMs: number,
  onWarning: (warning: string) => void,
): Promise<number> {
  let settled = false
  const work = task()
    .then((result) => {
      settled = true
      return result
    })
    .catch((err) => {
      settled = true
      const message = err instanceof Error ? err.message : String(err)
      onWarning(`Embedding 增强失败，已跳过：${message}`)
      return 0
    })
  const timeout = new Promise<number>((resolve) => {
    setTimeout(() => {
      if (!settled) {
        onWarning(`Embedding 增强超过 ${Math.round(timeoutMs / 1000)} 秒，已转为后台降级，不阻塞批量 Ingest 完成。`)
        resolve(0)
      }
    }, timeoutMs)
  })
  return Promise.race([work, timeout])
}

async function embedPages(projectPath: string, pagePaths: string[]): Promise<number> {
  const embCfg = useWikiStore.getState().embeddingConfig
  if (!embCfg.enabled || !embCfg.model || pagePaths.length === 0) return 0
  const { embedPage } = await import("@/lib/embedding")
  let embedded = 0
  for (const pagePath of pagePaths) {
    if (!pagePath.endsWith(".md")) continue
    const pageId = pagePath.split("/").pop()?.replace(/\.md$/, "") ?? ""
    if (!pageId || ["index", "log", "overview"].includes(pageId)) continue
    try {
      const content = await readFile(`${projectPath}/${pagePath}`)
      const titleMatch = content.match(/^---\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m)
      const title = titleMatch ? titleMatch[1].trim() : pageId
      await embedPage(projectPath, pageId, title, content, embCfg)
      embedded++
    } catch {
      // Embeddings are enrichment only; never fail deferred post-processing.
    }
  }
  return embedded
}

export async function runDeferredIngestPostProcessing(
  projectPath: string,
  batchId: string,
  options: DeferredIngestPostProcessingOptions = {},
): Promise<DeferredIngestPostProcessingResult> {
  const pp = normalizePath(projectPath)
  const activity = useActivityStore.getState()
  const activityId = activity.addItem({
    type: "ingest",
    title: "批量 Ingest 增强处理",
    status: "running",
    detail: "刷新语义索引、任务索引与延后增强...",
    filesWritten: [],
    phase: "semanticIndex",
    batchId,
  })
  const recorder = createIngestRunRecorder(pp, { sourceKey: "batch-post-processing", batchId })
  const filesWritten: string[] = []
  const warnings: string[] = []

  try {
    const reports = await recorder.time("deferredPostProcessing:loadReports", () =>
      loadAgentModeReports(pp),
    )

    const semanticIndex = await recorder.time("semanticIndex", () =>
      rebuildSemanticUnitIndex(pp, reports),
    )

    activity.updateItem(activityId, { phase: "taskIndex", detail: "刷新任务索引..." })
    const taskIndex = await recorder.time("taskIndex", async () => {
      const index = await buildOrRefreshTaskIndex(pp)
      if (index.entries.length > 0) {
        await createDirectory(`${pp}/wiki/tasks`).catch(() => {})
        await writeFile(`${pp}/wiki/tasks/index.md`, renderTaskIndexMarkdown(index))
        filesWritten.push("wiki/tasks/index.md", ".llm-wiki/task-index.json")
      }
      return index
    })

    activity.updateItem(activityId, {
      phase: "qualityReport",
      detail: `任务索引已刷新：${taskIndex.entries.length} 张任务卡。正在写入质量报告...`,
      metrics: {
        taskCount: taskIndex.entries.length,
        ready: taskIndex.entries.filter((entry) => entry.status === "draft").length,
        needsReview: taskIndex.entries.filter((entry) => entry.status === "needs_review").length,
      },
    })
    const qualityReport = await recorder.time("qualityReport", () =>
      writeProjectQualityReport(pp),
    )
    activity.updateItem(activityId, {
      metrics: {
        taskCount: qualityReport.taskSummary.total,
        ready: qualityReport.taskSummary.ready,
        needsReview: qualityReport.taskSummary.needsReview,
        averageQualityScore: qualityReport.taskSummary.averageQualityScore,
      },
    })
    filesWritten.push(".llm-wiki/quality-report.json", "wiki/quality/index.md")
    useWikiStore.getState().bumpDataVersion()

    if (options.runStrategyEnhancement !== false) {
      const llmConfig = useWikiStore.getState().llmConfig
      if (hasUsableLlm(llmConfig)) {
        activity.updateItem(activityId, { phase: "strategyCompile", detail: "刷新策略增强..." })
        await recorder.time("strategyCompile", async () => {
          const scenePack = await ensureScenePack(pp, {
            defaultLanguage: useWikiStore.getState().outputLanguage,
          })
          for (const report of reports) {
            if (options.signal?.aborted) break
            const strategyResult = await writeStrategyBundle(pp, report, scenePack, {
              llmConfig,
              signal: options.signal,
              enhanceWithLlm: true,
            })
            filesWritten.push(...strategyResult.writtenPaths)
            await saveAgentModeReport(pp, {
              ...report,
              strategyBundle: strategyResult.bundle,
              strategyCoverage: strategyResult.coverage,
            })
          }
        })
      } else {
        warnings.push("LLM 未配置，已跳过延后策略增强。")
      }
    } else {
      activity.updateItem(activityId, {
        detail: `核心抽取后处理完成，strategyCompile 已跳过：${semanticIndex.units.length} 个语义单元，${taskIndex.entries.length} 张任务卡。`,
      })
    }

    if (options.runEmbeddings !== false) {
      activity.updateItem(activityId, { phase: "embeddings", detail: "刷新向量索引（超时会自动降级，不阻塞任务卡）..." })
      await recorder.time("embeddings", async () => {
        await runSoftTimedEmbeddingPhase(
          () => embedPages(pp, Array.from(new Set(filesWritten))),
          DEFERRED_EMBEDDING_TIMEOUT_MS,
          (warning) => warnings.push(warning),
        )
      })
    }

    if (options.runReviewSweep) {
      activity.updateItem(activityId, { phase: "reviewSweep", detail: "刷新 Review 状态..." })
      await recorder.time("reviewSweep", () =>
        sweepResolvedReviews(pp, options.signal),
      )
    }

    await recorder.flushSummary({ filesWritten, warnings })
    activity.updateItem(activityId, {
      status: "done",
      detail: `增强处理完成：${semanticIndex.units.length} 个语义单元，${taskIndex.entries.length} 张任务卡`,
      filesWritten,
      metrics: {
        taskCount: qualityReport.taskSummary.total,
        ready: qualityReport.taskSummary.ready,
        needsReview: qualityReport.taskSummary.needsReview,
        averageQualityScore: qualityReport.taskSummary.averageQualityScore,
      },
    })
    return {
      semanticUnitCount: semanticIndex.units.length,
      taskCount: taskIndex.entries.length,
      filesWritten,
      warnings,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    warnings.push(message)
    await writeProjectQualityReport(pp).catch(() => {})
    await recorder.flushSummary({ filesWritten, warnings }).catch(() => {})
    activity.updateItem(activityId, {
      status: "error",
      detail: `增强处理失败：${message}`,
      filesWritten,
    })
    return {
      semanticUnitCount: 0,
      taskCount: 0,
      filesWritten,
      warnings,
    }
  }
}
