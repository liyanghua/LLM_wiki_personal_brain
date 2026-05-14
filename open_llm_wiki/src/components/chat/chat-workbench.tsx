import { useState } from "react"
import { Image as ImageIcon, MessageSquareText } from "lucide-react"
import { ChatPanel } from "@/components/chat/chat-panel"
import { useWikiStore } from "@/stores/wiki-store"
import {
  captionProjectImagesOnce,
  loadImageIndex,
  loadImageCaptionBackfillState,
  type ImageCaptionBackfillState,
} from "@/lib/knowledge-image-index"
import { preflightCaptionModel, type CaptionFailureDiagnosis } from "@/lib/vision-caption"

function resolveCaptionLlmConfig() {
  const { multimodalConfig, llmConfig } = useWikiStore.getState()
  if (!multimodalConfig.enabled) return null
  if (multimodalConfig.useMainLlm) return llmConfig
  return {
    provider: multimodalConfig.provider,
    apiKey: multimodalConfig.apiKey,
    model: multimodalConfig.model,
    ollamaUrl: multimodalConfig.ollamaUrl,
    customEndpoint: multimodalConfig.customEndpoint,
    apiMode: multimodalConfig.apiMode,
    maxContextSize: llmConfig.maxContextSize,
  }
}

async function captionIndexSummary(projectPath: string): Promise<string> {
  const entries = await loadImageIndex(projectPath)
  const captioned = entries.filter((entry) => entry.status === "captioned").length
  const needsCaption = entries.filter((entry) => entry.status === "needs_caption").length
  const missingFile = entries.filter((entry) => entry.status === "missing_file").length
  return `当前项目索引：已补说明 ${captioned} 张，待补说明 ${needsCaption} 张，文件缺失 ${missingFile} 张。路径：${projectPath}/.llm-wiki/image-index.json`
}

export function ChatWorkbench() {
  const projectPath = useWikiStore((s) => s.project?.path ?? null)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const [captionStatus, setCaptionStatus] = useState<{
    state: "idle" | "running" | "done" | "error"
    detail: string
    diagnosis?: CaptionFailureDiagnosis | null
    backfillState?: ImageCaptionBackfillState | null
  }>({ state: "idle", detail: "" })

  const backfillProjectCaptions = async (force = false) => {
    if (!projectPath) {
      setCaptionStatus({ state: "error", detail: "请先打开一个项目。" })
      return
    }
    const previousState = await loadImageCaptionBackfillState(projectPath)
    if (!force && (previousState.status === "completed" || previousState.status === "paused")) {
      const summary = await captionIndexSummary(projectPath)
      setCaptionStatus({
        state: previousState.status === "completed" ? "done" : "error",
        detail: previousState.status === "completed"
          ? `本项目图片说明已经补齐过：新增 ${previousState.updated} 条，复用缓存 ${previousState.cached} 条，剩余 ${previousState.remaining} 条。${summary}`
          : `上次图片说明补齐已暂停：失败 ${previousState.failed} 条，跳过 ${previousState.skipped} 条。${previousState.recommendedAction ?? "修复 VLM 配置后可手动重新补齐。"} ${summary}`,
        diagnosis: previousState.status === "paused"
          ? {
              code: "model_unavailable",
              title: previousState.errorTitle ?? "图片说明补齐已暂停",
              detail: previousState.errorDetail ?? "上次批量补齐未完成。",
              recommendedAction: previousState.recommendedAction ?? "修复 VLM 配置后点击重新补齐。",
              retryable: true,
            }
          : null,
        backfillState: previousState,
      })
      return
    }
    const llmConfig = resolveCaptionLlmConfig()
    if (!llmConfig) {
      setCaptionStatus({ state: "error", detail: "未启用图片说明模型，请先在设置中开启多模态/VLM 配置。" })
      return
    }

    setCaptionStatus({ state: "running", detail: "正在检查 VLM 配置..." })
    try {
      const preflight = await preflightCaptionModel(llmConfig)
      if (!preflight.ok) {
        setCaptionStatus({
          state: "error",
          detail: preflight.diagnosis?.detail ?? "VLM 预检失败，已停止图片说明补齐。",
          diagnosis: preflight.diagnosis ?? null,
        })
        return
      }
      setCaptionStatus({ state: "running", detail: "正在扫描并补齐本项目图片说明..." })
      const backfill = await captionProjectImagesOnce(projectPath, llmConfig, {
        force,
        onProgress: (done, total, current) => {
          setCaptionStatus({
            state: "running",
            detail: `正在补齐图片说明 ${done}/${total}，已新增 ${current.updated} 条，复用缓存 ${current.cached} 条，失败 ${current.failed} 条。`,
          })
        },
      })
      const result = backfill.result
      bumpDataVersion()
      const lastError = result.errors[result.errors.length - 1]
      const summary = await captionIndexSummary(projectPath)
      const captionedAfterRun = result.entries.filter((entry) => entry.status === "captioned").length
      const needsCaptionAfterRun = result.entries.filter((entry) => entry.status === "needs_caption").length
      const writeLooksBroken = result.failed === 0 && (result.updated > 0 || result.cached > 0) && captionedAfterRun === 0
      setCaptionStatus({
        state: result.failed > 0 || writeLooksBroken ? "error" : "done",
        detail: writeLooksBroken
          ? `图片说明生成过，但没有写入当前项目索引。请确认当前打开项目路径是否正确。${summary}`
          : result.failed > 0
          ? `图片说明补齐已停止：新增 ${result.updated} 条，复用缓存 ${result.cached} 条，跳过 ${result.skipped} 条，失败 ${result.failed} 条。${lastError?.recommendedAction ?? ""}`
          : `图片说明补齐完成：新增 ${result.updated} 条，复用缓存 ${result.cached} 条，跳过 ${result.skipped} 条，失败 ${result.failed} 条。${summary}`,
        diagnosis: writeLooksBroken
          ? {
              code: "model_unavailable",
              title: "图片说明未写入当前项目索引",
              detail: `运行结果显示有 ${result.updated + result.cached} 条说明，但当前索引仍有 ${needsCaptionAfterRun} 张待补说明。`,
              recommendedAction: "请确认当前项目路径，或点击重新补齐后再提问。",
              retryable: true,
            }
          : lastError?.failureCode
          ? {
              code: lastError.failureCode,
              title: lastError.title ?? "图片说明生成失败",
              detail: lastError.message,
              recommendedAction: lastError.recommendedAction ?? "请检查 VLM 配置后重试。",
              retryable: lastError.retryable ?? true,
            }
          : null,
        backfillState: backfill.state,
      })
    } catch (err) {
      setCaptionStatus({
        state: "error",
        detail: err instanceof Error ? err.message : String(err),
        diagnosis: null,
      })
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,rgba(219,234,254,0.78),transparent_34%),linear-gradient(180deg,#f8fbff_0%,#fff_44%)]">
      <div className="shrink-0 border-b border-sky-100 bg-white/80 px-6 py-5 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-sky-800">
              <MessageSquareText className="h-4 w-4" />
              独立知识问答
            </div>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950">项目知识问答</h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              这里只基于当前项目的 wiki、来源页和图片证据回答问题；不会进入业务修订线程，也不会写回 GroundTruth。
            </p>
            {captionStatus.detail ? (
              <div className={`mt-3 rounded-2xl px-3 py-2 text-xs leading-5 ${
                captionStatus.state === "error"
                  ? "border border-rose-100 bg-rose-50 text-rose-700"
                  : captionStatus.state === "done"
                    ? "border border-emerald-100 bg-emerald-50 text-emerald-700"
                    : "border border-sky-100 bg-sky-50 text-sky-800"
              }`}>
                <div>
                  {captionStatus.diagnosis?.title ? `${captionStatus.diagnosis.title}：` : ""}
                  {captionStatus.detail}
                </div>
                {captionStatus.diagnosis?.recommendedAction ? (
                  <div className="mt-1 font-medium">{captionStatus.diagnosis.recommendedAction}</div>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-xs leading-5 text-sky-900">
            <div>适合问：业务方法、SOP 步骤、主图案例、图文证据、知识页里的结论。</div>
            <button
              type="button"
              onClick={() => backfillProjectCaptions(false)}
              disabled={captionStatus.state === "running"}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-sky-800 shadow-sm transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              {captionStatus.state === "running" ? "正在补齐图片说明..." : "补齐本项目图片描述"}
            </button>
            {captionStatus.backfillState?.status === "completed" || captionStatus.backfillState?.status === "paused" ? (
              <button
                type="button"
                onClick={() => backfillProjectCaptions(true)}
                disabled={captionStatus.state === "running"}
                className="inline-flex items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                重新补齐
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 p-4">
        <div className="h-full overflow-hidden rounded-3xl border border-sky-100 bg-white shadow-sm">
          <ChatPanel />
        </div>
      </div>
    </div>
  )
}
