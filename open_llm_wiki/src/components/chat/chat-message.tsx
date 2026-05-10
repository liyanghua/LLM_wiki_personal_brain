import { useCallback, useEffect, useRef, useState, useMemo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import "katex/dist/katex.min.css"
import {
  Bot, User, FileText, BookmarkPlus, ChevronDown, ChevronRight, RefreshCw, Copy, Check,
  Users, Lightbulb, BookOpen, HelpCircle, GitMerge, BarChart3, Layout, Globe,
  Image as ImageIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWikiStore } from "@/stores/wiki-store"
import { useAgentModeStore } from "@/stores/agent-mode-store"
import { useAgentLoopStore } from "@/stores/agent-loop-store"
import { useChatStore, type DisplayMessage, type SupplementInsight } from "@/stores/chat-store"
import { readFile, writeFile, listDirectory } from "@/commands/fs"
import { lastQueryPages } from "@/components/chat/chat-panel"
import type { FileNode } from "@/types/wiki"

import { convertLatexToUnicode } from "@/lib/latex-to-unicode"
import { normalizePath, getFileName } from "@/lib/path-utils"
import { makeQueryFileName } from "@/lib/wiki-filename"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { resolveMarkdownImageSrc } from "@/lib/markdown-image-resolver"
import { findRawSourceForImage, imageUrlToAbsolute } from "@/lib/raw-source-resolver"
import { MermaidDiagram } from "@/components/mermaid-diagram"

// Module-level cache of source file names
let cachedSourceFiles: string[] = []

export function useSourceFiles() {
  const project = useWikiStore((s) => s.project)

  useEffect(() => {
    if (!project) return
    const pp = normalizePath(project.path)
    listDirectory(`${pp}/raw/sources`)
      .then((tree) => {
        cachedSourceFiles = flattenNames(tree)
      })
      .catch(() => {
        cachedSourceFiles = []
      })
  }, [project])

  return cachedSourceFiles
}

function flattenNames(nodes: FileNode[]): string[] {
  const names: string[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      names.push(...flattenNames(node.children))
    } else if (!node.is_dir) {
      names.push(node.name)
    }
  }
  return names
}

interface ChatMessageProps {
  message: DisplayMessage
  isLastAssistant?: boolean
  onRegenerate?: () => void
  mode?: "default" | "revision-aware" | "revision-loop"
  onAcceptSuggestion?: (message: DisplayMessage, editedMarkdown?: string) => Promise<void> | void
  onRequestStageSwitch?: (stage: "revise" | "validate", question?: string | null) => void
  onSendFollowup?: (text: string) => Promise<void> | void
}

export function ChatMessage({
  message,
  isLastAssistant,
  onRegenerate,
  mode = "default",
  onAcceptSuggestion,
  onRequestStageSwitch,
  onSendFollowup,
}: ChatMessageProps) {
  const isUser = message.role === "user"
  const isSystem = message.role === "system"
  const isAssistant = message.role === "assistant"
  const [hovered, setHovered] = useState(false)
  const isRevisionLoop = mode === "revision-loop"

  return (
    <div
      className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isSystem
            ? "bg-accent text-accent-foreground"
            : isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
        }`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className="max-w-[88%] flex flex-col gap-1.5">
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground"
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : (
            isRevisionLoop && message.revisionMeta ? (
              <RevisionWorkflowMessage
                message={message}
                onAcceptSuggestion={onAcceptSuggestion}
                onRequestStageSwitch={onRequestStageSwitch}
                onSendFollowup={onSendFollowup}
              />
            ) : (
              <MarkdownContent content={message.content} />
            )
          )}
        </div>
        {isAssistant && (mode === "revision-aware" || mode === "revision-loop") && message.answerMeta?.supplements?.length ? (
          <SupplementInsightsPanel supplements={message.answerMeta.supplements} />
        ) : null}
        {isAssistant && <CitedReferencesPanel content={message.content} savedReferences={message.references} />}
        {isAssistant && hovered && (
          <div className="flex items-center gap-1">
            <CopyButton content={message.content} />
            <SaveToWikiButton content={message.content} visible={true} />
            {isLastAssistant && onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                title="Regenerate this response"
              >
                <RefreshCw className="h-3 w-3" /> Regenerate
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function RevisionWorkflowMessage({
  message,
  onAcceptSuggestion,
  onRequestStageSwitch,
  onSendFollowup,
}: {
  message: DisplayMessage
  onAcceptSuggestion?: (message: DisplayMessage, editedMarkdown?: string) => Promise<void> | void
  onRequestStageSwitch?: (stage: "revise" | "validate", question?: string | null) => void
  onSendFollowup?: (text: string) => Promise<void> | void
}) {
  const revisionMeta = message.revisionMeta
  const [isEditing, setIsEditing] = useState(false)
  const [editedMarkdown, setEditedMarkdown] = useState(revisionMeta?.suggestion?.revisedMarkdown ?? "")
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setEditedMarkdown(revisionMeta?.suggestion?.revisedMarkdown ?? "")
    setIsEditing(false)
  }, [revisionMeta?.suggestion?.id, revisionMeta?.actionState])

  if (!revisionMeta) {
    return <MarkdownContent content={message.content} />
  }

  const canAccept = revisionMeta.messageKind === "revision_suggestion" && revisionMeta.suggestion && revisionMeta.actionState === "pending_confirmation"
  const canContinue = revisionMeta.messageKind === "revision_suggestion" || revisionMeta.messageKind === "supplement_seed"
  const canValidate = revisionMeta.messageKind !== "validation_answer"
  const mainLabel =
    revisionMeta.messageKind === "task_context"
      ? "当前任务"
      : revisionMeta.messageKind === "accept_result"
        ? "写回结果"
        : revisionMeta.messageKind === "validation_answer"
          ? "验证回答"
          : revisionMeta.messageKind === "supplement_seed"
            ? "待确认补充"
            : "直接建议"

  async function handleAccept() {
    if (!canAccept || !onAcceptSuggestion) return
    setIsSubmitting(true)
    try {
      await onAcceptSuggestion(message, isEditing ? editedMarkdown : undefined)
      setIsEditing(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleFollowup() {
    if (!canContinue || !onSendFollowup) return
    const seed = revisionMeta?.validationQuestion?.trim()
      || revisionMeta?.changeSummary[0]
      || "请继续沿着这条修订建议往下补充。"
    setIsSubmitting(true)
    try {
      await onSendFollowup(seed)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700">
          {revisionMeta.stage === "revise" ? "修订阶段" : "验证阶段"}
        </span>
        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] text-zinc-600">
          {revisionKindLabel(revisionMeta.messageKind)}
        </span>
        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] text-zinc-500">
          {revisionActionStateLabel(revisionMeta.actionState)}
        </span>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">{mainLabel}</p>
        <div className="mt-2 text-sm leading-6 text-zinc-800">
          <MarkdownContent content={message.content} />
        </div>
      </div>

      {revisionMeta.changeSummary.length > 0 && (
        <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">本次变化</p>
          <div className="mt-2 space-y-2">
            {revisionMeta.changeSummary.map((item, index) => (
              <p key={`${item}-${index}`} className="text-sm leading-6 text-zinc-700">{item}</p>
            ))}
          </div>
        </div>
      )}

      {(revisionMeta.impactFieldKeys.length > 0 || revisionMeta.impactDimensions.length > 0) && (
        <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">影响范围</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {revisionMeta.impactFieldKeys.map((fieldKey) => (
              <span key={fieldKey} className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700">
                字段：{fieldKey}
              </span>
            ))}
            {revisionMeta.impactDimensions.map((dimension) => (
              <span key={dimension} className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-800">
                维度：{dimension}
              </span>
            ))}
          </div>
        </div>
      )}

      {revisionMeta.suggestion && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">确认动作</p>
            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] text-zinc-600">
              {revisionMeta.suggestion.targetFieldKey ? `字段 ${revisionMeta.suggestion.targetFieldKey}` : "主稿写回"}
            </span>
          </div>
          {isEditing ? (
            <textarea
              value={editedMarkdown}
              onChange={(event) => setEditedMarkdown(event.target.value)}
              className="mt-3 min-h-[160px] w-full resize-y rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm leading-6 text-zinc-800 outline-none focus:border-amber-300"
            />
          ) : (
            <div className="mt-3 whitespace-pre-wrap rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-zinc-800">
              {revisionMeta.suggestion.revisedMarkdown}
            </div>
          )}
          {revisionMeta.suggestion.rationale ? (
            <p className="mt-3 text-xs leading-5 text-zinc-600">{revisionMeta.suggestion.rationale}</p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {canAccept ? (
              <Button onClick={() => void handleAccept()} disabled={isSubmitting}>
                {isSubmitting ? "写回中..." : "采纳写回"}
              </Button>
            ) : null}
            {canAccept ? (
              <Button
                variant="outline"
                onClick={() => {
                  if (isEditing) {
                    setEditedMarkdown(revisionMeta.suggestion?.revisedMarkdown ?? "")
                    setIsEditing(false)
                  } else {
                    setIsEditing(true)
                  }
                }}
                disabled={isSubmitting}
              >
                {isEditing ? "取消编辑" : "编辑后采纳"}
              </Button>
            ) : null}
            {canContinue ? (
              <Button variant="ghost" onClick={() => void handleFollowup()} disabled={isSubmitting}>
                继续追问
              </Button>
            ) : null}
            {canValidate ? (
              <Button
                variant="ghost"
                onClick={() => onRequestStageSwitch?.("validate", revisionMeta.validationQuestion ?? null)}
              >
                切到验证
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

function revisionKindLabel(kind: NonNullable<DisplayMessage["revisionMeta"]>["messageKind"]): string {
  switch (kind) {
    case "task_context":
      return "任务上下文"
    case "revision_suggestion":
      return "修订建议"
    case "accept_result":
      return "写回结果"
    case "validation_answer":
      return "验证回答"
    case "supplement_seed":
      return "启发补充"
    default:
      return "修订消息"
  }
}

function revisionActionStateLabel(state: NonNullable<DisplayMessage["revisionMeta"]>["actionState"]): string {
  switch (state) {
    case "pending_confirmation":
      return "待确认"
    case "accepted":
      return "已采纳"
    case "rejected":
      return "已拒绝"
    case "superseded":
      return "已更新"
    case "error":
      return "出错"
    default:
      return "处理中"
  }
}

function SupplementInsightsPanel({ supplements }: { supplements: SupplementInsight[] }) {
  const project = useWikiStore((s) => s.project)
  const reports = useAgentModeStore((s) => s.reports)
  const selectedDocId = useAgentModeStore((s) => s.selectedDocId)
  const loopSessions = useAgentLoopStore((s) => s.sessions)
  const ensureScopedConversation = useChatStore((s) => s.ensureScopedConversation)
  const setActiveConversation = useChatStore((s) => s.setActiveConversation)
  const addMessage = useChatStore((s) => s.addMessage)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const report = useMemo(
    () => reports.find((item) => item.docId === selectedDocId) ?? null,
    [reports, selectedDocId],
  )
  const loopSession = useMemo(
    () => loopSessions.find((item) => item.docId === selectedDocId) ?? null,
    [loopSessions, selectedDocId],
  )
  const activeCard = useMemo(() => {
    if (!report) return null
    return report.revisionIssueCards.find((card) => card.cardId === loopSession?.activeCardId)
      ?? report.revisionIssueCards.find((card) => card.cardId === supplements[0]?.linkedCardId)
      ?? report.revisionIssueCards[0]
      ?? null
  }, [loopSession?.activeCardId, report, supplements])
  const canBringIntoRevision = Boolean(project && report && (activeCard || loopSession?.activeTaskId))

  const handleCopy = useCallback(async (insight: SupplementInsight) => {
    if (!insight.candidateSentence.trim()) return
    await navigator.clipboard.writeText(insight.candidateSentence.trim())
    setCopiedId(insight.supplementId)
    setTimeout(() => setCopiedId((current) => (current === insight.supplementId ? null : current)), 1800)
  }, [])

  const handleBringIntoRevision = useCallback(async (insight: SupplementInsight) => {
    if (!project || !report) return
    const targetCard = report.revisionIssueCards.find((card) => card.cardId === insight.linkedCardId)
      ?? activeCard
      ?? null
    if (!targetCard && !loopSession?.activeTaskId) return

    setLoadingId(insight.supplementId)
    try {
      const loopId = loopSession?.loopId ?? null
      const conversationId = ensureScopedConversation(
        `修订闭环 · ${report.sourceName}`,
        {
          scope: "revision-loop",
          docId: report.docId,
          loopId,
        },
      )
      setActiveConversation(conversationId)
      const seededAssistant = [
        "这条内容来自启发性补充，尚未在底稿确认，请先判断是否适用。",
        "",
        `来源：${insight.origin === "evidence_extension" ? "基于当前资料的延展" : "基于通用业务经验，尚未在当前底稿确认"}`,
        "",
        `建议句：${insight.candidateSentence || "暂无建议句"}`,
        insight.rationale ? `为什么值得考虑：${insight.rationale}` : "",
      ].filter(Boolean).join("\n")
      addMessage("assistant", seededAssistant, {
        conversationId,
        skipTitleAuto: true,
        revisionMeta: {
          messageKind: "supplement_seed",
          docId: report.docId,
          loopId,
          taskId: loopSession?.activeTaskId ?? null,
          cardId: targetCard?.cardId ?? loopSession?.activeCardId ?? null,
          targetFieldKey: insight.targetFieldKey ?? targetCard?.targetFieldKey ?? null,
          stage: "revise",
          changeSummary: [
            targetCard?.issueTitle ? `当前补充将优先回流到「${targetCard.issueTitle}」` : "当前补充会先挂到本轮修订线程里待确认",
            insight.candidateSentence ? `候选建议句：${insight.candidateSentence}` : "当前只有启发说明，还没有现成建议句",
          ],
          impactFieldKeys: insight.targetFieldKey ? [insight.targetFieldKey] : [],
          impactDimensions: ["待专家确认", originLabelForSupplement(insight.origin)],
          actionState: "pending_confirmation",
          validationQuestion: targetCard?.followupQuestion ?? loopSession?.recommendedValidationQuestion ?? null,
        },
      })
    } finally {
      setLoadingId(null)
    }
  }, [activeCard, addMessage, ensureScopedConversation, loopSession, project, report, setActiveConversation])

  return (
    <div className="space-y-2">
      {supplements.map((insight) => {
        const originLabel = insight.origin === "evidence_extension" ? "资料延展" : "通用经验"
        return (
          <div key={insight.supplementId} className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-amber-800">
                启发性补充
              </span>
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] text-zinc-600">
                待专家确认
              </span>
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] text-zinc-600">
                {originLabel}
              </span>
            </div>
            <p className="mt-3 text-sm font-medium text-zinc-900">{insight.title}</p>
            <p className="mt-2 text-xs leading-5 text-zinc-500">{insight.disclaimer}</p>
            {insight.rationale ? (
              <p className="mt-3 text-sm leading-6 text-zinc-700">{insight.rationale}</p>
            ) : null}
            {insight.candidateSentence ? (
              <div className="mt-3 rounded-2xl bg-white px-3 py-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-zinc-400">可纳入修订的建议句</p>
                <p className="mt-2 text-sm leading-6 text-zinc-700">{insight.candidateSentence}</p>
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleBringIntoRevision(insight)}
                disabled={!canBringIntoRevision || loadingId === insight.supplementId}
                className="inline-flex items-center gap-1 rounded-full bg-zinc-900 px-3 py-1.5 text-xs text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                title={canBringIntoRevision ? "把这条候选建议带入当前修订会话" : "先开始修订闭环"}
              >
                {loadingId === insight.supplementId ? "带入中..." : "加入当前修订"}
              </button>
              <button
                type="button"
                onClick={() => void handleCopy(insight)}
                className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
              >
                {copiedId === insight.supplementId ? "已复制" : "复制建议句"}
              </button>
            </div>
            {!canBringIntoRevision ? (
              <p className="mt-2 text-[11px] text-zinc-500">先开始修订闭环，才能把这条启发性补充带入当前修订。</p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function originLabelForSupplement(origin: SupplementInsight["origin"]): string {
  return origin === "evidence_extension" ? "资料延展" : "通用经验"
}

function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    // Strip HTML comments and thinking blocks before copying
    const clean = content
      .replace(/<!--.*?-->/gs, "")
      .replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>\s*/gi, "")
      .replace(/<think(?:ing)?>\s*[\s\S]*$/gi, "")
      .trim()

    await navigator.clipboard.writeText(clean)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [content])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied!" : "Copy"}
    </button>
  )
}

function SaveToWikiButton({ content, visible }: { content: string; visible: boolean }) {
  const project = useWikiStore((s) => s.project)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleSave = useCallback(async () => {
    if (!project || saving) return
    const pp = normalizePath(project.path)
    setSaving(true)
    try {
      // Generate a unique filename for this save.
      // See `src/lib/wiki-filename.ts` — the slug is Unicode-aware
      // (so CJK titles don't collapse to empty) and the HHMMSS
      // timestamp suffix guarantees same-day saves stay distinct.
      const firstLine = content.split("\n")[0].replace(/^#+\s*/, "").trim()
      const title = firstLine.slice(0, 60) || "Saved Query"
      const { date, fileName } = makeQueryFileName(title)
      const filePath = `${pp}/wiki/queries/${fileName}`

      // Strip hidden sources comment and thinking blocks from content
      const cleanContent = content
        .replace(/<!--\s*sources:.*?-->/g, "")
        .replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>\s*/gi, "")
        .replace(/<think(?:ing)?>\s*[\s\S]*$/gi, "")
        .trimEnd()

      const frontmatter = [
        "---",
        `type: query`,
        `title: "${title.replace(/"/g, '\\"')}"`,
        `created: ${date}`,
        `tags: []`,
        "---",
        "",
      ].join("\n")

      await writeFile(filePath, frontmatter + cleanContent)

      // Update index.md — append under ## Queries section
      const indexPath = `${pp}/wiki/index.md`
      let indexContent = ""
      try {
        indexContent = await readFile(indexPath)
      } catch {
        indexContent = "# Wiki Index\n\n## Queries\n"
      }
      // The wikilink target is the filename WITHOUT the `.md`
      // extension — must match `fileName` exactly (including the
      // time suffix) or the link lands on a 404.
      const linkTarget = fileName.replace(/\.md$/, "")
      const entry = `- [[queries/${linkTarget}|${title}]]`
      if (indexContent.includes("## Queries")) {
        indexContent = indexContent.replace(
          /(## Queries\n)/,
          `$1${entry}\n`
        )
      } else {
        indexContent = indexContent.trimEnd() + "\n\n## Queries\n" + entry + "\n"
      }
      await writeFile(indexPath, indexContent)

      // Append to log.md
      const logPath = `${pp}/wiki/log.md`
      let logContent = ""
      try {
        logContent = await readFile(logPath)
      } catch {
        logContent = "# Wiki Log\n\n"
      }
      const logEntry = `- ${date}: Saved query page \`${fileName}\`\n`
      await writeFile(logPath, logContent.trimEnd() + "\n" + logEntry)

      // Refresh file tree and update graph
      const tree = await listDirectory(pp)
      setFileTree(tree)
      useWikiStore.getState().bumpDataVersion()

      setSaved(true)
      setTimeout(() => setSaved(false), 2000)

      // Full auto-ingest: extract entities, concepts, cross-references from saved content
      const llmConfig = useWikiStore.getState().llmConfig
      if (hasUsableLlm(llmConfig)) {
        const { autoIngest } = await import("@/lib/ingest")
        autoIngest(pp, filePath, llmConfig).catch((err) =>
          console.error("Failed to auto-ingest saved query:", err)
        )
      }
    } catch (err) {
      console.error("Failed to save to wiki:", err)
    } finally {
      setSaving(false)
    }
  }, [project, content, saving, setFileTree])

  if (!visible && !saved) return null

  return (
    <button
      type="button"
      onClick={handleSave}
      disabled={saving}
      className="self-start inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
      title="Save to wiki"
    >
      <BookmarkPlus className="h-3 w-3" />
      {saved ? "Saved!" : saving ? "Saving..." : "Save to Wiki"}
    </button>
  )
}

interface CitedPage {
  title: string
  path: string
}

const REF_TYPE_CONFIG: Record<string, { icon: typeof FileText; color: string }> = {
  entity: { icon: Users, color: "text-blue-500" },
  concept: { icon: Lightbulb, color: "text-purple-500" },
  source: { icon: BookOpen, color: "text-orange-500" },
  query: { icon: HelpCircle, color: "text-green-500" },
  synthesis: { icon: GitMerge, color: "text-red-500" },
  comparison: { icon: BarChart3, color: "text-teal-500" },
  overview: { icon: Layout, color: "text-yellow-500" },
  clip: { icon: Globe, color: "text-blue-400" },
}

function getRefType(path: string): string {
  if (path.includes("deliverables/revised-docs/")) return "query"
  if (path.includes("deliverables/ground-truth/")) return "concept"
  if (path.includes("/entities/")) return "entity"
  if (path.includes("/concepts/")) return "concept"
  if (path.includes("/sources/")) return "source"
  if (path.includes("/queries/")) return "query"
  if (path.includes("/synthesis/")) return "synthesis"
  if (path.includes("/comparisons/")) return "comparison"
  if (path.includes("overview")) return "overview"
  if (path.includes("raw/sources/")) return "clip"
  return "source"
}

/**
 * Markdown image-reference regex used to count `![](url)` occurrences
 * in cited pages AND extract the first URL (so the image-badge
 * jump button knows where to send the user). Same shape as the
 * search/pipeline regex elsewhere (kept duplicated to avoid
 * coupling — this module never wants to pull caption-pipeline
 * imports for a 3-character count).
 *
 * Group 1 captures the URL (everything inside `(...)` of the
 * markdown image syntax, no whitespace).
 */
const CITED_IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)\)/g

interface CitedImageInfo {
  count: number
  /** First image URL on the page — used as the scroll target when
   *  the badge button opens the raw source. Null when count===0. */
  firstUrl: string | null
}

function CitedReferencesPanel({ content, savedReferences }: { content: string; savedReferences?: CitedPage[] }) {
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setPendingScrollImageSrc = useWikiStore((s) => s.setPendingScrollImageSrc)
  const [expanded, setExpanded] = useState(false)
  /**
   * Per-cited-page image info: count + first image URL. We can't
   * hang this off `CitedPage` directly because `extractCitedPages`
   * is sync and works on the AI's text response, never seeing the
   * underlying page. So we fetch the page contents lazily here.
   * Same path → same info, so a tiny in-component map keyed by
   * path is plenty.
   */
  const [imageInfos, setImageInfos] = useState<Record<string, CitedImageInfo>>({})

  // Use saved references first (persisted with message), fall back to dynamic extraction
  const citedPages = useMemo(() => {
    const rawPages = savedReferences && savedReferences.length > 0 ? savedReferences : extractCitedPages(content)
    const seen = new Set<string>()
    return rawPages.filter((page) => {
      const key = `${page.path}::${page.title}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [content, savedReferences])

  // Async-fetch each cited page's content once and extract image
  // info: count + first URL. Done in parallel; failures are
  // silently treated as { count: 0, firstUrl: null } (page may
  // not exist on disk yet, e.g. a citation the LLM hallucinated).
  useEffect(() => {
    if (!project || citedPages.length === 0) return
    const pp = normalizePath(project.path)
    let cancelled = false
    Promise.all(
      citedPages.map(async (page) => {
        // Try the path verbatim first, then the same fallback set
        // the click-handler uses below — keeps "is the file on
        // disk" check consistent across the panel.
        const id = getFileName(page.path.replace(/^wiki\//, "").replace(/\.md$/, ""))
        const candidates = [
          `${pp}/${page.path}`,
          `${pp}/wiki/entities/${id}.md`,
          `${pp}/wiki/concepts/${id}.md`,
          `${pp}/wiki/sources/${id}.md`,
          `${pp}/wiki/queries/${id}.md`,
          `${pp}/wiki/synthesis/${id}.md`,
          `${pp}/wiki/comparisons/${id}.md`,
          `${pp}/wiki/${id}.md`,
        ]
        for (const candidate of candidates) {
          try {
            const text = await readFile(candidate)
            // Reset stateful regex.lastIndex by `new RegExp(...)` —
            // module-level `g` regexes carry state across calls
            // and would skip matches on the second invocation.
            const re = new RegExp(CITED_IMAGE_RE.source, CITED_IMAGE_RE.flags)
            const matches = [...text.matchAll(re)]
            const info: CitedImageInfo = {
              count: matches.length,
              firstUrl: matches.length > 0 ? matches[0][1] : null,
            }
            return [page.path, info] as const
          } catch {
            // try next candidate
          }
        }
        return [page.path, { count: 0, firstUrl: null }] as const
      }),
    ).then((entries) => {
      if (cancelled) return
      const next: Record<string, CitedImageInfo> = {}
      for (const [path, info] of entries) next[path] = info
      setImageInfos(next)
    })
    return () => {
      cancelled = true
    }
  }, [project, citedPages])

  /**
   * Open the raw source file for a page's first image and stage a
   * scroll target so the markdown preview lands on that image.
   * Mirrors the lightbox "Jump to source document" path in
   * search-view — same `findRawSourceForImage` resolver, same
   * `pendingScrollImageSrc` store handoff, same fallback to
   * opening the wiki page when no raw source is found.
   */
  const handleJumpToImageSource = useCallback(
    async (firstUrl: string, fallbackPath: string) => {
      if (!project) return
      const pp = normalizePath(project.path)
      const rawPath = await findRawSourceForImage(firstUrl, pp)
      if (rawPath) {
        try {
          const content = await readFile(rawPath)
          setPendingScrollImageSrc(imageUrlToAbsolute(firstUrl, pp))
          setSelectedFile(rawPath)
          setFileContent(content)
          console.log(`[refs:image-jump] ${firstUrl} → raw source ${rawPath}`)
          return
        } catch (err) {
          console.warn(`[refs:image-jump] failed to read ${rawPath}:`, err)
        }
      }
      // Fallback: open the wiki summary itself with same scroll
      // target — at least the safety-net section will scroll into
      // view there.
      try {
        const content = await readFile(`${pp}/${fallbackPath}`)
        setPendingScrollImageSrc(firstUrl)
        setSelectedFile(`${pp}/${fallbackPath}`)
        setFileContent(content)
      } catch (err) {
        console.warn(`[refs:image-jump] fallback also failed:`, err)
      }
    },
    [project, setPendingScrollImageSrc, setSelectedFile, setFileContent],
  )

  if (citedPages.length === 0) return null

  const MAX_COLLAPSED = 3
  const visiblePages = expanded ? citedPages : citedPages.slice(0, MAX_COLLAPSED)
  const hasMore = citedPages.length > MAX_COLLAPSED

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 text-xs mb-1">
      <button
        type="button"
        onClick={() => hasMore && setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <FileText className="h-3 w-3 shrink-0" />
        <span className="font-medium">References ({citedPages.length})</span>
        {hasMore && (
          expanded
            ? <ChevronDown className="h-3 w-3 ml-auto" />
            : <ChevronRight className="h-3 w-3 ml-auto" />
        )}
      </button>
      <div className="px-2 pb-1.5">
        {visiblePages.map((page, i) => {
          const refType = getRefType(page.path)
          const config = REF_TYPE_CONFIG[refType] ?? REF_TYPE_CONFIG.source
          const Icon = config.icon
          const info = imageInfos[page.path]
          const hasImages = (info?.count ?? 0) > 0
          const openCitedPage = async () => {
            if (!project) return
            const pp = normalizePath(project.path)
            if (page.path.startsWith("deliverables/")) {
              try {
                const absolutePath = `${pp}/${page.path}`
                const content = await readFile(absolutePath)
                setSelectedFile(absolutePath)
                setFileContent(content)
                return
              } catch {
                // fall through to normal wiki resolution
              }
            }
            const id = getFileName(page.path.replace(/^wiki\//, "").replace(/\.md$/, ""))
            const candidates = [
              `${pp}/${page.path}`,
              `${pp}/wiki/entities/${id}.md`,
              `${pp}/wiki/concepts/${id}.md`,
              `${pp}/wiki/sources/${id}.md`,
              `${pp}/wiki/queries/${id}.md`,
              `${pp}/wiki/synthesis/${id}.md`,
              `${pp}/wiki/comparisons/${id}.md`,
              `${pp}/wiki/${id}.md`,
            ]
            for (const candidate of candidates) {
              try {
                await readFile(candidate)
                setSelectedFile(candidate)
                return
              } catch {
                // try next
              }
            }
            setSelectedFile(`${pp}/${page.path}`)
          }
          return (
            // Outer is a div, NOT a button — we have two click
            // targets inside (image badge + main row) and nesting
            // a button inside a button is invalid HTML and breaks
            // event delegation. Hover effect shifts to the inner
            // buttons individually so each gives feedback.
            <div
              key={`${page.path}-${i}`}
              className="flex w-full items-center gap-1.5 rounded text-left"
              title={page.path}
            >
              <span className="text-[10px] text-muted-foreground/60 w-4 shrink-0 text-right">[{i + 1}]</span>
              {/*
               * Image badge — clickable, separately from the page
               * row. Click → resolve the FIRST image's raw source
               * (`raw/sources/<slug>.<ext>`) and open the FULL
               * combined-extraction preview, scrolled to that
               * image. This mirrors the search-view lightbox
               * "Jump to source document" behavior so the two
               * surfaces feel consistent.
               *
               * Icon: lucide `Image` (picture-frame outline with
               * mountain + sun) — direct visual cue for "image",
               * NOT `Camera` which reads as "take a photo".
               */}
              {hasImages && info?.firstUrl && (
                <button
                  type="button"
                  onClick={() => handleJumpToImageSource(info.firstUrl!, page.path)}
                  className="flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-blue-600 hover:bg-blue-100/40 dark:text-blue-400 dark:hover:bg-blue-900/30 transition-colors"
                  title={`Open original document at first image (${info.count} image${info.count === 1 ? "" : "s"} on this page)`}
                >
                  <ImageIcon className="h-3 w-3" />
                  {info.count}
                </button>
              )}
              <button
                type="button"
                onClick={openCitedPage}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-accent/50 transition-colors"
              >
                <Icon className={`h-3 w-3 shrink-0 ${config.color}`} />
                <span className="truncate text-foreground/80">{page.title}</span>
              </button>
            </div>
          )
        })}
        {hasMore && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="w-full text-center text-[10px] text-muted-foreground hover:text-primary pt-0.5"
          >
            +{citedPages.length - MAX_COLLAPSED} more...
          </button>
        )}
      </div>
    </div>
  )
}


/**
 * Extract cited wiki pages from the hidden <!-- cited: 1, 3, 5 --> comment.
 * Maps page numbers back to the pages that were sent to the LLM.
 */
function extractCitedPages(text: string): CitedPage[] {
  const citedMatch = text.match(/<!--\s*cited:\s*(.+?)\s*-->/)
  if (citedMatch && lastQueryPages.length > 0) {
    const numbers = citedMatch[1]
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n >= 1 && n <= lastQueryPages.length)

    const pages = numbers.map((n) => lastQueryPages[n - 1])
    if (pages.length > 0) return pages
  }

  // Fallback: if LLM used [1], [2] notation in text, try to match those
  if (lastQueryPages.length > 0) {
    const numberRefs = text.match(/\[(\d+)\]/g)
    if (numberRefs) {
      const numbers = [...new Set(numberRefs.map((r) => parseInt(r.slice(1, -1), 10)))]
        .filter((n) => n >= 1 && n <= lastQueryPages.length)
      if (numbers.length > 0) {
        return numbers.map((n) => lastQueryPages[n - 1])
      }
    }
  }

  // Fallback for persisted messages: extract [[wikilinks]] from the text
  // Try to resolve each wikilink to a real file path by checking common wiki subdirectories
  const wikilinks = text.match(/\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g)
  if (wikilinks) {
    const seen = new Set<string>()
    const pages: CitedPage[] = []
    const WIKI_DIRS = ["entities", "concepts", "sources", "queries", "synthesis", "comparisons"]

    for (const link of wikilinks) {
      const nameMatch = link.match(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/)
      if (nameMatch) {
        const id = nameMatch[1].trim()
        const display = nameMatch[2]?.trim() || id

        // Skip if id contains path separators (already a path like queries/xxx)
        if (seen.has(id)) continue
        seen.add(id)

        // Try to find the file in known wiki subdirectories
        let resolvedPath = ""
        if (id.includes("/")) {
          // Already has directory like "queries/my-query"
          resolvedPath = `wiki/${id}.md`
        } else {
          // Search in common directories
          for (const dir of WIKI_DIRS) {
            resolvedPath = `wiki/${dir}/${id}.md`
            // We can't do async file checking here, so try all known patterns
            // The click handler will try multiple paths
            break // Use first candidate, click handler resolves the rest
          }
          if (!resolvedPath) resolvedPath = `wiki/${id}.md`
        }

        pages.push({ title: display, path: resolvedPath })
      }
    }
    if (pages.length > 0) return pages
  }

  // No citations found
  return []
}

interface StreamingMessageProps {
  content: string
}

export function StreamingMessage({ content }: StreamingMessageProps) {
  const { thinking, answer } = useMemo(() => separateThinking(content), [content])
  const isThinking = thinking !== null && answer.length === 0

  return (
    <div className="flex gap-2 flex-row">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Bot className="h-4 w-4" />
      </div>
      <div className="max-w-[80%] rounded-lg px-3 py-2 text-sm bg-muted text-foreground">
        {isThinking ? (
          <StreamingThinkingBlock content={thinking} />
        ) : (
          <>
            {thinking && <ThinkingBlock content={thinking} />}
            <MarkdownContent content={answer} />
            <span className="animate-pulse">▊</span>
          </>
        )}
      </div>
    </div>
  )
}

function MarkdownContent({ content }: { content: string }) {
  // Strip hidden comments
  const cleaned = content.replace(/<!--.*?-->/gs, "").trimEnd()

  // Project path for resolving wiki-relative image src in chat
  // replies (LLM may surface images that came in via retrieved
  // chunks, e.g. when the chat answer cites a diagram from a wiki
  // page). Same convention the file-preview uses.
  const projectPath = useWikiStore((s) => s.project?.path ?? null)

  // Separate thinking blocks from main content
  const { thinking, answer } = useMemo(() => separateThinking(cleaned), [cleaned])
  const processed = useMemo(() => processContent(answer), [answer])

  return (
    <div>
      {thinking && <ThinkingBlock content={thinking} />}
      <div className="chat-markdown prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            a: ({ href, children }) => {
              if (href?.startsWith("wikilink:")) {
                const pageName = href.slice("wikilink:".length)
                return <WikiLink pageName={pageName}>{children}</WikiLink>
              }
              return (
                <span className="text-primary underline cursor-default" title={href}>
                  {children}
                </span>
              )
            },
            img: ({ src, alt, ...props }) => (
              <img
                src={typeof src === "string" ? resolveMarkdownImageSrc(src, projectPath) : undefined}
                alt={alt ?? ""}
                className="my-2 max-w-full rounded border border-border/40"
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
              <th className="border border-border/80 px-3 py-1.5 text-left font-semibold bg-muted" {...props}>{children}</th>
            ),
            td: ({ children, ...props }) => (
              <td className="border border-border/60 px-3 py-1.5" {...props}>{children}</td>
            ),
            pre: ({ children, ...props }) => (
              <pre className="rounded bg-background/50 p-2 text-xs overflow-x-auto" {...props}>{children}</pre>
            ),
            code: ({ className, children, ...props }) => {
              const lang = className?.replace("language-", "")
              const codeText = String(children).replace(/\n$/, "")
              if (lang === "mermaid") {
                return <MermaidDiagram code={codeText} />
              }
              return <code className={className} {...props}>{children}</code>
            },
          }}
        >
          {processed}
        </ReactMarkdown>
      </div>
    </div>
  )
}

/**
 * Separate <think>...</think> blocks from the main answer.
 * Handles multiple think blocks and partial (unclosed) thinking during streaming.
 */
function separateThinking(text: string): { thinking: string | null; answer: string } {
  // Match complete <think>...</think> and <thinking>...</thinking> blocks
  const thinkRegex = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi
  const thinkParts: string[] = []
  let answer = text

  let match: RegExpExecArray | null
  while ((match = thinkRegex.exec(text)) !== null) {
    thinkParts.push(match[1].trim())
  }
  answer = answer.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "").trim()

  // Handle unclosed <think> or <thinking> tag (streaming in progress)
  const unclosedMatch = answer.match(/<think(?:ing)?>([\s\S]*)$/i)
  if (unclosedMatch) {
    thinkParts.push(unclosedMatch[1].trim())
    answer = answer.replace(/<think(?:ing)?>[\s\S]*$/i, "").trim()
  }

  const thinking = thinkParts.length > 0 ? thinkParts.join("\n\n") : null
  return { thinking, answer }
}

/** Streaming thinking: shows latest ~5 lines rolling upward with animation */
function StreamingThinkingBlock({ content }: { content: string }) {
  const lines = content.split("\n").filter((l) => l.trim())
  const visibleLines = lines.slice(-5)

  return (
    <div className="rounded-md border border-dashed border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 px-2.5 py-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-sm animate-pulse">💭</span>
        <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Thinking...</span>
        <span className="text-[10px] text-amber-600/50 dark:text-amber-500/40">{lines.length} lines</span>
      </div>
      <div className="h-[5lh] overflow-hidden text-xs text-amber-800/70 dark:text-amber-300/60 font-mono leading-relaxed">
        {visibleLines.map((line, i) => (
          <div
            key={lines.length - 5 + i}
            className="truncate"
            style={{ opacity: 0.4 + (i / visibleLines.length) * 0.6 }}
          >
            {line}
          </div>
        ))}
        <span className="animate-pulse text-amber-500">▊</span>
      </div>
    </div>
  )
}

/** Completed thinking: collapsed by default, click to expand */
function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const lines = content.split("\n").filter((l) => l.trim())

  return (
    <div className="mb-2 rounded-md border border-dashed border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-100/50 dark:hover:bg-amber-900/20 transition-colors"
      >
        <span className="text-sm">💭</span>
        <span className="font-medium">Thought for {lines.length} lines</span>
        <span className="text-amber-600/60 dark:text-amber-500/60">
          {expanded ? "▼" : "▶"}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-amber-500/20 px-2.5 py-2 text-xs text-amber-800/80 dark:text-amber-300/70 whitespace-pre-wrap max-h-64 overflow-y-auto font-mono leading-relaxed">
          {content}
        </div>
      )}
    </div>
  )
}

/**
 * Process content to create clickable links:
 * - [[wikilinks]] → markdown links with wikilink: protocol
 */
function processContent(text: string): string {
  let result = text

  // Wrap bare \begin{...}...\end{...} blocks with $$ for remark-math
  result = result.replace(
    /(?<!\$\$\s*)(\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\})(?!\s*\$\$)/g,
    (_match, block: string) => `$$\n${block}\n$$`,
  )

  // Only apply Unicode conversion to text outside of math delimiters
  // Split on $$...$$ and $...$ blocks, only convert non-math parts
  const parts = result.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g)
  result = parts
    .map((part) => {
      if (part.startsWith("$")) return part // preserve math
      return convertLatexToUnicode(part)
    })
    .join("")

  // Fix malformed wikilinks like [[name] (missing closing bracket)
  result = result.replace(/\[\[([^\]]+)\](?!\])/g, "[[$1]]")

  // Convert [[wikilinks]] to markdown links
  result = result.replace(
    /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,
    (_match, pageName: string, displayText?: string) => {
      const display = displayText?.trim() || pageName.trim()
      return `[${display}](wikilink:${pageName.trim()})`
    }
  )

  return result
}

function WikiLink({ pageName, children }: { pageName: string; children: React.ReactNode }) {
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const [exists, setExists] = useState<boolean | null>(null)
  const resolvedPath = useRef<string | null>(null)

  useEffect(() => {
    if (!project) return
    const pp = normalizePath(project.path)
    const candidates = [
      `${pp}/wiki/entities/${pageName}.md`,
      `${pp}/wiki/concepts/${pageName}.md`,
      `${pp}/wiki/sources/${pageName}.md`,
      `${pp}/wiki/queries/${pageName}.md`,
      `${pp}/wiki/comparisons/${pageName}.md`,
      `${pp}/wiki/synthesis/${pageName}.md`,
      `${pp}/wiki/${pageName}.md`,
    ]

    let cancelled = false
    async function check() {
      for (const path of candidates) {
        try {
          await readFile(path)
          if (!cancelled) {
            resolvedPath.current = path
            setExists(true)
          }
          return
        } catch {
          // try next
        }
      }
      if (!cancelled) setExists(false)
    }
    check()
    return () => { cancelled = true }
  }, [project, pageName])

  const handleClick = useCallback(async () => {
    if (!resolvedPath.current) return
    try {
      const content = await readFile(resolvedPath.current)
      setSelectedFile(resolvedPath.current)
      setFileContent(content)
      setActiveView("wiki")
    } catch {
      // ignore
    }
  }, [setSelectedFile, setFileContent, setActiveView])

  if (exists === false) {
    return (
      <span className="inline text-muted-foreground" title={`Page not found: ${pageName}`}>
        {children}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-primary underline decoration-primary/30 hover:bg-primary/10 hover:decoration-primary"
      title={`Open wiki page: ${pageName}`}
    >
      <FileText className="inline h-3 w-3" />
      {children}
    </button>
  )
}
