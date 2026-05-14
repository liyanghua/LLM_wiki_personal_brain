import { useMemo } from "react"
import { ChevronDown, ChevronUp, MessageSquareText } from "lucide-react"
import { ChatPanel } from "@/components/chat/chat-panel"
import { Button } from "@/components/ui/button"
import type { GroundTruthDraft, RevisionDraft, RevisionIssueCard } from "@/lib/agent-mode-types"
import type { ComposerRequest } from "@/stores/chat-store"
import { useWikiStore } from "@/stores/wiki-store"

interface RevisionKnowledgePanelProps {
  docId: string
  draft: RevisionDraft | null
  groundTruth: GroundTruthDraft | null
  selectedCard: RevisionIssueCard | null
  recommendedQuestion?: string | null
  expanded: boolean
  onToggleExpanded: () => void
  composerRequest?: ComposerRequest | null
  onUseRecommendedQuestion?: (question: string) => void
}

function buildGroundTruthSummary(groundTruth: GroundTruthDraft | null): string {
  if (!groundTruth) return ""
  return [
    groundTruth.mainlineSteps.length > 0
      ? `主链路步骤：${groundTruth.mainlineSteps.join("；")}`
      : "",
    groundTruth.keyJudgements.length > 0
      ? `关键判断：${groundTruth.keyJudgements.join("；")}`
      : "",
    groundTruth.boundaries.length > 0
      ? `边界条件：${groundTruth.boundaries.join("；")}`
      : "",
  ].filter(Boolean).join("\n")
}

export function RevisionKnowledgePanel({
  docId,
  draft,
  groundTruth,
  selectedCard,
  recommendedQuestion,
  expanded,
  onToggleExpanded,
  composerRequest,
  onUseRecommendedQuestion,
}: RevisionKnowledgePanelProps) {
  const project = useWikiStore((s) => s.project)
  const context = useMemo(() => {
    if (!project) return null
    const revisionSnapshotKey = [
      draft?.updatedAt ?? "no-draft",
      groundTruth?.lastUpdatedAt ?? groundTruth?.updatedAt ?? "no-ground-truth",
      selectedCard?.cardId ?? "no-card",
    ].join(":")
    return {
      docId,
      draftPath: `${project.path}/deliverables/revised-docs/${docId}/draft.md`,
      draft,
      groundTruth,
      selectedCardId: selectedCard?.cardId ?? null,
      selectedBlockIds: [selectedCard?.primaryBlockId, selectedCard?.anchorBlockId].filter(Boolean) as string[],
      selectedTargetFieldKey: selectedCard?.targetFieldKey ?? null,
      lastAcceptedCardId: groundTruth?.lastAcceptedCardId ?? null,
      revisionSnapshotKey,
      selectedCardTitle: selectedCard?.issueTitle ?? null,
      selectedCardDiagnosis: selectedCard?.diagnosis ?? null,
      groundTruthSummary: buildGroundTruthSummary(groundTruth),
    }
  }, [docId, draft, groundTruth, project, selectedCard])
  const alignedToLatestSnapshot = Boolean(
    context?.revisionSnapshotKey
    && composerRequest?.snapshotKey
    && composerRequest.snapshotKey === context.revisionSnapshotKey,
  )

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
            <MessageSquareText className="h-4 w-4 text-amber-700" />
            修订感知知识问答
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            当前修订稿优先回答，随时校验修订后的答案是否更准。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onToggleExpanded}>
          {expanded ? (
            <>
              收起
              <ChevronDown className="ml-2 h-4 w-4" />
            </>
          ) : (
            <>
              展开
              <ChevronUp className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </div>

      {expanded ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="border-b border-zinc-100 bg-zinc-50/70 px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
              <span className="inline-flex items-center rounded-full bg-white px-2.5 py-1">
                当前修订稿优先
              </span>
              <span className="inline-flex items-center rounded-full bg-white px-2.5 py-1">
                文档：{docId}
              </span>
              {selectedCard?.issueTitle && (
                <span className="inline-flex max-w-full items-center truncate rounded-full bg-white px-2.5 py-1">
                  当前问题卡：{selectedCard.issueTitle}
                </span>
              )}
              {recommendedQuestion && onUseRecommendedQuestion && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-full"
                  onClick={() => onUseRecommendedQuestion(recommendedQuestion)}
                >
                  立即验证推荐问句
                </Button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-5 text-zinc-500">
              {recommendedQuestion ? (
                <p className="min-w-0 flex-1 truncate">
                  推荐验证：{recommendedQuestion}
                </p>
              ) : (
                <p className="min-w-0 flex-1 truncate">
                  当前会优先用最新修订稿、业务底稿和项目 wiki 来回答验证问题。
                </p>
              )}
              <span className="shrink-0 text-amber-700">
                {alignedToLatestSnapshot
                  ? "已基于最新修订稿准备验证问题"
                  : "输入区会对齐当前修订快照"}
              </span>
            </div>
          </div>
          {context ? (
            <ChatPanel
              mode="revision-aware"
              revisionContext={context}
              hideSidebar
              composerRequest={composerRequest}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              当前还没有可用的修订上下文。
            </div>
          )}
        </div>
      ) : (
        <div className="px-5 py-4 text-sm text-zinc-500">
          下次你采纳写回后，可以立刻在这里追问同一个业务问题，看看答案是否已经跟着修订变得更准。
        </div>
      )}
    </section>
  )
}
