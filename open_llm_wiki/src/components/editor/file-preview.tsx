import { useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { convertFileSrc } from "@tauri-apps/api/core"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import "katex/dist/katex.min.css"
import {
  AlertTriangle,
  FileQuestion,
  FileSpreadsheet,
  FileText,
  Film,
  Image as ImageIcon,
  Music,
  Sparkles,
} from "lucide-react"
import { getFileCategory, getCodeLanguage } from "@/lib/file-types"
import type { FileCategory } from "@/lib/file-types"
import { getFileName, normalizePath } from "@/lib/path-utils"
import { resolveMarkdownImageSrc } from "@/lib/markdown-image-resolver"
import { parseFrontmatter } from "@/lib/frontmatter"
import { FrontmatterPanel } from "@/components/editor/frontmatter-panel"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile, fileExists, preprocessFile } from "@/commands/fs"
import { useAgentModeStore } from "@/stores/agent-mode-store"
import type {
  AgentModeReport,
  DocumentBlock,
  EnhancedDocumentArtifactManifest,
  NormalizedDocumentBundle,
} from "@/lib/agent-mode-types"

interface FilePreviewProps {
  filePath: string
  textContent: string
}

type PreviewTab = "source" | "analysis" | "structure"

interface StructuredPreviewState {
  report: AgentModeReport | null
  artifact: EnhancedDocumentArtifactManifest | null
  analysisMarkdown: string | null
  normalized: NormalizedDocumentBundle | null
  htmlPath: string | null
}

export function FilePreview({ filePath, textContent }: FilePreviewProps) {
  const category = getFileCategory(filePath)
  const fileName = getFileName(filePath)

  switch (category) {
    case "image":
      return <ImagePreview filePath={filePath} fileName={fileName} />
    case "video":
      return <VideoPreview filePath={filePath} fileName={fileName} />
    case "audio":
      return <AudioPreview filePath={filePath} fileName={fileName} />
    case "pdf":
      return <StructuredDocumentPreview filePath={filePath} fileName={fileName} fallbackContent={textContent} />
    case "code":
      return <CodePreview filePath={filePath} content={textContent} />
    case "data":
      return <CodePreview filePath={filePath} content={textContent} />
    case "text":
      return <TextPreview filePath={filePath} content={textContent} label="Text" />
    case "document":
      if (/\.(docx|doc|xmind|xlsx|xls|ods)$/i.test(filePath)) {
        return <StructuredDocumentPreview filePath={filePath} fileName={fileName} fallbackContent={textContent} />
      }
      return <BinaryPlaceholder filePath={filePath} fileName={fileName} category={category} />
    default:
      return <BinaryPlaceholder filePath={filePath} fileName={fileName} category={category} />
  }
}

function ImagePreview({ filePath, fileName }: { filePath: string; fileName: string }) {
  const src = convertFileSrc(filePath)
  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 text-xs text-muted-foreground">{filePath}</div>
      <div className="flex flex-1 items-center justify-center overflow-auto rounded-lg bg-muted/30">
        <img
          src={src}
          alt={fileName}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    </div>
  )
}

function VideoPreview({ filePath, fileName }: { filePath: string; fileName: string }) {
  const src = convertFileSrc(filePath)
  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 text-xs text-muted-foreground">{filePath}</div>
      <div className="flex flex-1 items-center justify-center overflow-auto rounded-lg bg-black">
        <video
          src={src}
          controls
          className="max-h-full max-w-full"
        >
          <track kind="captions" label={fileName} />
        </video>
      </div>
    </div>
  )
}

function AudioPreview({ filePath, fileName }: { filePath: string; fileName: string }) {
  const src = convertFileSrc(filePath)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <div className="text-xs text-muted-foreground">{filePath}</div>
      <Music className="h-16 w-16 text-muted-foreground/50" />
      <p className="text-sm font-medium">{fileName}</p>
      <audio src={src} controls className="w-full max-w-md">
        <track kind="captions" label={fileName} />
      </audio>
    </div>
  )
}

function CodePreview({ filePath, content }: { filePath: string; content: string }) {
  const lang = getCodeLanguage(filePath)
  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{filePath}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">{lang}</span>
      </div>
      <pre className="whitespace-pre-wrap rounded-lg bg-muted/30 p-4 font-mono text-sm">
        {content}
      </pre>
    </div>
  )
}

function TextPreview({ filePath, content, label }: { filePath: string; content: string; label: string }) {
  const projectPath = useWikiStore((s) => s.project?.path ?? null)
  const pendingScrollImageSrc = useWikiStore((s) => s.pendingScrollImageSrc)
  const setPendingScrollImageSrc = useWikiStore((s) => s.setPendingScrollImageSrc)
  const scrollRootRef = useRef<HTMLDivElement | null>(null)

  const { frontmatter, body } = useMemo(() => parseFrontmatter(content), [content])

  useEffect(() => {
    if (!pendingScrollImageSrc) return
    const root = scrollRootRef.current
    if (!root) return
    const escapedSrc = pendingScrollImageSrc
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
    const target = root.querySelector<HTMLImageElement>(
      `img[data-mdsrc="${escapedSrc}"]`,
    )
    if (!target) {
      setPendingScrollImageSrc(null)
      return
    }
    target.scrollIntoView({ behavior: "auto", block: "center" })
    if (!target.complete) {
      const onLoad = () => {
        target.scrollIntoView({ behavior: "smooth", block: "center" })
        target.removeEventListener("load", onLoad)
      }
      target.addEventListener("load", onLoad)
    }
    target.classList.add("ring-2", "ring-primary", "ring-offset-2")
    const tHighlight = setTimeout(() => {
      target.classList.remove("ring-2", "ring-primary", "ring-offset-2")
    }, 1800)
    setPendingScrollImageSrc(null)
    return () => clearTimeout(tHighlight)
  }, [pendingScrollImageSrc, content, setPendingScrollImageSrc])

  return (
    <div ref={scrollRootRef} className="h-full overflow-auto p-6">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{filePath}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">{label}</span>
      </div>
      {frontmatter && <FrontmatterPanel data={frontmatter} />}
      <MarkdownBody content={body} projectPath={projectPath} />
    </div>
  )
}

function StructuredDocumentPreview({
  filePath,
  fileName,
  fallbackContent,
}: {
  filePath: string
  fileName: string
  fallbackContent: string
}) {
  const projectPath = useWikiStore((s) => s.project?.path ?? null)
  const reports = useAgentModeStore((s) => s.reports)
  const [preview, setPreview] = useState<StructuredPreviewState>({
    report: null,
    artifact: null,
    analysisMarkdown: null,
    normalized: null,
    htmlPath: null,
  })
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<PreviewTab>("source")
  const isSpreadsheet = /\.(xlsx|xls|ods)$/i.test(filePath)

  useEffect(() => {
    let cancelled = false

    async function loadPreview() {
      setLoading(true)
      const matchedReport =
        reports.find((item) => normalizePath(item.sourcePath) === normalizePath(filePath))
        ?? null
      const artifact = matchedReport?.documentArtifacts ?? null

      let analysisMarkdown: string | null = null
      let normalized: NormalizedDocumentBundle | null = null
      let htmlPath: string | null = null

      if (artifact?.analysisPath) {
        analysisMarkdown = await readFile(artifact.analysisPath).catch(() => null)
      }
      if (!analysisMarkdown && isSpreadsheet) {
        analysisMarkdown = await preprocessFile(filePath).catch(() => fallbackContent || null)
      }
      if (artifact?.normalizedPath) {
        const normalizedRaw = await readFile(artifact.normalizedPath).catch(() => null)
        if (normalizedRaw) {
          try {
            normalized = JSON.parse(normalizedRaw) as NormalizedDocumentBundle
          } catch {
            normalized = null
          }
        }
      }
      if (artifact?.htmlPath && await fileExists(artifact.htmlPath).catch(() => false)) {
        htmlPath = artifact.htmlPath
      }

      if (!cancelled) {
        setPreview({
          report: matchedReport,
          artifact,
          analysisMarkdown,
          normalized,
          htmlPath,
        })
        setTab(htmlPath ? "source" : analysisMarkdown ? "analysis" : "structure")
        setLoading(false)
      }
    }

    void loadPreview()
    return () => {
      cancelled = true
    }
  }, [filePath, fallbackContent, reports, isSpreadsheet])

  const sourceKindLabel = labelForStructuredKind(filePath)
  const backendBadge = preview.report?.documentBackendStatus ?? null
  const hasSourceView = Boolean(preview.htmlPath)
  const hasAnalysisView = Boolean(preview.analysisMarkdown)
  const blockSummary = summarizeBlocks(preview.report?.documentIr.blocks ?? [])
  const normalizedWarnings = preview.normalized?.warnings ?? []

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-white/90 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{fileName}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{filePath}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">{sourceKindLabel}</span>
              {preview.report && (
                <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                  已接入业务理解主链
                </span>
              )}
            </div>
          </div>
          {backendBadge && (
            <div className={`rounded-full px-3 py-1 text-xs font-medium ${backendBadge.degraded ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"}`}>
              {backendBadge.degraded ? "已降级" : "增强解析中间产物已就绪"} · {backendBadge.mode}
            </div>
          )}
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <StatusCard
            title="当前预览在看什么"
            value={tab === "source" ? "原件友好预览" : tab === "analysis" ? "结构化阅读稿" : "结构证据摘要"}
            detail={
              tab === "source"
                ? "更适合快速浏览原文排版与整体感受。"
                : tab === "analysis"
                  ? "更适合看系统抽出的标题、正文、图片与表格。"
                  : "更适合判断系统到底识别出了哪些业务结构。"
            }
          />
          <StatusCard
            title="解析后端"
            value={preview.report?.documentBackend ?? "未命中增强报告"}
            detail={preview.report?.documentBackendStatus.detail ?? "当前文件还没有关联到最新增强解析产物。"}
            tone={preview.report?.documentBackendStatus.degraded ? "warn" : "default"}
          />
          <StatusCard
            title="识别到的结构"
            value={blockSummary.primary}
            detail={blockSummary.detail}
          />
        </div>

        {(preview.artifact?.warnings?.length || normalizedWarnings.length) ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              当前文档存在降级或补证提示
            </div>
            <div className="mt-1 space-y-1">
              {[...(preview.artifact?.warnings ?? []), ...normalizedWarnings]
                .filter((item, index, arr) => arr.indexOf(item) === index)
                .slice(0, 3)
                .map((item) => (
                  <p key={item}>{item}</p>
                ))}
            </div>
          </div>
        ) : null}

        {isSpreadsheet && !hasSourceView ? (
          <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
            Excel 原件不可直接在预览区渲染，当前展示的是系统转换后的结构化表格文本。
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          {hasSourceView && (
            <PreviewTabButton active={tab === "source"} onClick={() => setTab("source")}>
              原件预览
            </PreviewTabButton>
          )}
          {hasAnalysisView && (
            <PreviewTabButton active={tab === "analysis"} onClick={() => setTab("analysis")}>
              结构化阅读稿
            </PreviewTabButton>
          )}
          <PreviewTabButton active={tab === "structure"} onClick={() => setTab("structure")}>
            识别摘要
          </PreviewTabButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-zinc-50/60">
        {loading ? (
          <div className="space-y-3 p-6">
            <div className="h-6 w-48 animate-pulse rounded bg-muted" />
            <div className="h-24 animate-pulse rounded-2xl bg-muted" />
            <div className="h-72 animate-pulse rounded-2xl bg-muted" />
          </div>
        ) : tab === "source" && hasSourceView ? (
          <HtmlDocumentPreview htmlPath={preview.htmlPath!} />
        ) : tab === "analysis" && hasAnalysisView ? (
          <TextPreview
            filePath={preview.artifact?.analysisPath ?? filePath}
            content={preview.analysisMarkdown ?? fallbackContent}
            label="Structured Reading Draft"
          />
        ) : (
          <StructuredSummaryView
            filePath={filePath}
            fallbackContent={fallbackContent}
            report={preview.report}
            normalized={preview.normalized}
            projectPath={projectPath}
          />
        )}
      </div>
    </div>
  )
}

function HtmlDocumentPreview({ htmlPath }: { htmlPath: string }) {
  const src = convertFileSrc(htmlPath)
  return (
    <iframe
      title="document-preview"
      src={src}
      className="h-full w-full border-0 bg-white"
    />
  )
}

function StructuredSummaryView({
  filePath,
  fallbackContent,
  report,
  normalized,
  projectPath,
}: {
  filePath: string
  fallbackContent: string
  report: AgentModeReport | null
  normalized: NormalizedDocumentBundle | null
  projectPath: string | null
}) {
  const lines = normalized?.analysisMarkdown
    ? normalized.analysisMarkdown.split("\n").filter((line) => line.trim().length > 0)
    : fallbackContent.split("\n").filter((line) => line.trim().length > 0)

  const sampleLines = lines.slice(0, 8)
  const images = normalized?.images ?? []
  const tables = normalized?.tables ?? []
  const rules = normalized?.businessRules ?? report?.understanding.businessRules ?? []
  const decisions = normalized?.decisionPoints ?? report?.understanding.decisionPoints ?? []
  const entities = normalized?.entityCandidates ?? report?.understanding.entityCandidates ?? []
  const blocks = report?.documentIr.blocks ?? []

  return (
    <div className="space-y-4 p-6">
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <p className="text-base font-semibold text-zinc-900">文档内容预览摘要</p>
        <p className="mt-1 text-sm text-muted-foreground">
          这里先展示系统已经整理好的阅读主线，帮助你快速判断这份资料有没有被读对、读全。
        </p>
        <div className="mt-4 space-y-3">
          {sampleLines.length > 0 ? sampleLines.map((line, index) => (
            <div key={`${index}-${line.slice(0, 24)}`} className="rounded-xl bg-zinc-50 px-4 py-3">
              <p className="text-sm leading-7 text-zinc-800">{line}</p>
            </div>
          )) : (
            <p className="text-sm text-muted-foreground">当前还没有可展示的结构化阅读内容。</p>
          )}
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <p className="text-base font-semibold text-zinc-900">结构识别概览</p>
        <p className="mt-1 text-sm text-muted-foreground">
          这一层更像“系统读到了什么”，不是技术指标，而是给业务专家看整体识别覆盖。
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <MiniMetric label="标题/段落块" value={String(blocks.length || sampleLines.length)} />
          <MiniMetric label="表格" value={String(tables.length)} />
          <MiniMetric label="图片证据" value={String(images.length)} />
          <MiniMetric label="关键规则" value={String(rules.length)} />
          <MiniMetric label="决策点" value={String(decisions.length)} />
          <MiniMetric label="候选实体" value={String(entities.length)} />
        </div>
      </div>

      {images.length > 0 && (
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-base font-semibold text-zinc-900">
            <Sparkles className="h-4 w-4 text-primary" />
            图片与视觉证据
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            这里展示这份资料里被识别出来、并且可能影响业务理解的视觉证据。
          </p>
          <div className="mt-4 space-y-4">
            {images.slice(0, 6).map((image) => (
              <div key={image.imageId} className="overflow-hidden rounded-2xl border bg-zinc-50">
                <div className="grid gap-0 lg:grid-cols-[240px_minmax(0,1fr)]">
                  {image.assetPath ? (
                    <img
                      src={resolveMarkdownImageSrc(image.assetPath, projectPath)}
                      alt={image.title ?? image.imageId}
                      className="h-48 w-full object-cover lg:h-full"
                    />
                  ) : (
                    <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
                      暂无可展示图片
                    </div>
                  )}
                  <div className="space-y-2 p-4">
                    <p className="text-sm font-semibold text-zinc-900">{image.title || image.imageId}</p>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {image.approximateAnchor ? "当前按附近段落做近似挂载，适合先看大意，再判断是否需要精确补证。" : "当前已经能定位到对应文档内容，可直接作为视觉证据查看。"}
                    </p>
                    {image.caption ? (
                      <div className="rounded-xl bg-white px-3 py-2 text-sm leading-6 text-zinc-700">
                        {image.caption}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ListCard
        title="规则与判断"
        intro="这里应该能看到这份资料里稳定的业务规则、方法约束或判断标准。"
        empty="还没有抽出稳定的业务规则。"
        items={rules.slice(0, 6)}
      />
      <ListCard
        title="决策点"
        intro="这一层会把“在什么条件下，下一步该做什么”串起来，更适合检查系统有没有读出行动逻辑。"
        empty="还没有形成清晰的决策点。"
        items={decisions.slice(0, 5).map((item) => `${item.condition} -> ${item.action}`)}
      />
      <ListCard
        title="候选业务对象"
        intro="这些对象还不是正式知识页实体，而是当前文档里比较稳定、值得继续投影的业务对象候选。"
        empty="还没有抽出足够稳定的业务对象。"
        items={entities.slice(0, 6).map((item) => `${item.name} · ${Math.round(item.confidence * 100)}%`)}
      />

      {tables.length > 0 && (
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-base font-semibold text-zinc-900">表格证据</p>
          <p className="mt-1 text-sm text-muted-foreground">
            如果原文里有结构化表格，这里应该能直接看到抽出的关键表格，而不是被压成一坨普通文本。
          </p>
          <div className="mt-3 space-y-4">
            {tables.slice(0, 3).map((table) => (
              <div key={table.tableId} className="overflow-x-auto rounded-xl border">
                <table className="min-w-full border-collapse text-xs">
                  <thead className="bg-muted">
                    <tr>
                      {table.headers.map((header, index) => (
                        <th key={`${table.tableId}-h-${index}`} className="border border-border/80 px-3 py-2 text-left font-semibold">
                          {header || "未命名列"}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.slice(0, 6).map((row, rowIndex) => (
                      <tr key={`${table.tableId}-r-${rowIndex}`}>
                        {table.headers.map((_, colIndex) => (
                          <td key={`${table.tableId}-${rowIndex}-${colIndex}`} className="border border-border/60 px-3 py-2 align-top text-zinc-700">
                            {row[colIndex] || ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}

      {!report && (
        <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
          当前这份资料还没有命中最新增强解析报告，所以这里只能展示基础内容。建议先点右上角的 `重新解析`，让系统重建这份文档的结构化产物。
        </div>
      )}

      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <p className="text-base font-semibold text-zinc-900">文件定位</p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{filePath}</p>
      </div>
    </div>
  )
}

function PreviewTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "bg-zinc-900 text-white"
          : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
      }`}
    >
      {children}
    </button>
  )
}

function StatusCard({
  title,
  value,
  detail,
  tone = "default",
}: {
  title: string
  value: string
  detail: string
  tone?: "default" | "warn"
}) {
  return (
    <div className={`rounded-2xl border p-3 shadow-sm ${tone === "warn" ? "border-amber-200 bg-amber-50" : "bg-white"}`}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="mt-1 text-sm font-semibold text-zinc-900">{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-zinc-50 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-zinc-900">{value}</p>
    </div>
  )
}

function ListCard({
  title,
  intro,
  items,
  empty,
}: {
  title: string
  intro: string
  items: string[]
  empty: string
}) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <p className="text-base font-semibold text-zinc-900">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{intro}</p>
      <div className="mt-3 space-y-2">
        {items.length > 0 ? items.map((item, index) => (
          <div key={`${title}-${index}-${item.slice(0, 18)}`} className="rounded-xl bg-zinc-50 px-4 py-3">
            <p className="text-sm leading-7 text-zinc-800">
              {item}
            </p>
          </div>
        )) : (
          <p className="text-sm text-muted-foreground">{empty}</p>
        )}
      </div>
    </div>
  )
}

function MarkdownBody({ content, projectPath }: { content: string; projectPath: string | null }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          img: ({ src, alt, ...props }) => (
            <img
              src={typeof src === "string" ? resolveMarkdownImageSrc(src, projectPath) : undefined}
              data-mdsrc={typeof src === "string" ? src : undefined}
              alt={alt ?? ""}
              className="max-w-full rounded border border-border/40 transition-all"
              loading="lazy"
              {...props}
            />
          ),
          table: ({ children, ...props }) => (
            <div className="my-2 overflow-x-auto rounded border border-border">
              <table className="w-full border-collapse text-xs" {...props}>{children}</table>
            </div>
          ),
          thead: ({ children, ...props }) => (
            <thead className="bg-muted" {...props}>{children}</thead>
          ),
          th: ({ children, ...props }) => (
            <th className="border border-border/80 bg-muted px-3 py-1.5 text-left font-semibold" {...props}>{children}</th>
          ),
          td: ({ children, ...props }) => (
            <td className="border border-border/60 px-3 py-1.5" {...props}>{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function BinaryPlaceholder({
  filePath,
  fileName,
  category,
}: {
  filePath: string
  fileName: string
  category: FileCategory
}) {
  const iconMap: Record<string, typeof FileText> = {
    document: FileSpreadsheet,
    unknown: FileQuestion,
    image: ImageIcon,
    video: Film,
  }
  const Icon = iconMap[category] ?? FileQuestion

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <Icon className="h-16 w-16 text-muted-foreground/30" />
      <div>
        <p className="text-sm font-medium">{fileName}</p>
        <p className="mt-1 text-xs text-muted-foreground">{filePath}</p>
      </div>
      <p className="text-sm text-muted-foreground">
        Preview not available for this file type
      </p>
    </div>
  )
}

function labelForStructuredKind(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
  if (ext === "pdf") return "PDF"
  if (ext === "docx") return "DOCX"
  if (ext === "doc") return "DOC"
  if (ext === "xmind") return "XMIND"
  return "DOCUMENT"
}

function summarizeBlocks(blocks: DocumentBlock[]): { primary: string; detail: string } {
  if (blocks.length === 0) {
    return {
      primary: "还没有结构化块",
      detail: "当前还没有命中可用的 DocumentIR，建议重新解析这份资料。",
    }
  }

  const counts = blocks.reduce<Record<string, number>>((acc, block) => {
    acc[block.blockType] = (acc[block.blockType] ?? 0) + 1
    return acc
  }, {})

  const parts = [
    counts.heading ? `${counts.heading} 个标题` : null,
    counts.paragraph ? `${counts.paragraph} 个段落` : null,
    counts.table ? `${counts.table} 张表` : null,
    counts.image ? `${counts.image} 张图` : null,
    counts.mindmap_node ? `${counts.mindmap_node} 个脑图节点` : null,
    counts.revision_mark ? `${counts.revision_mark} 处修订痕迹` : null,
  ].filter(Boolean)

  return {
    primary: parts.slice(0, 3).join(" · ") || `${blocks.length} 个结构块`,
    detail: `共识别 ${blocks.length} 个结构块，预览会优先展示更接近业务阅读的那一层。`,
  }
}
