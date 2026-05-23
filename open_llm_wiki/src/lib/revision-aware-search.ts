import { readFile } from "@/commands/fs"
import type { GroundTruthDraft, RevisionDraft } from "@/lib/agent-mode-types"
import type { MessageReference } from "@/stores/chat-store"
import { searchWiki, tokenizeQuery } from "@/lib/search"
import { getRelativePath, normalizePath } from "@/lib/path-utils"
import {
  formatImageEvidenceForPrompt,
  searchKnowledgeImages,
} from "@/lib/knowledge-image-index"
import { hasVisualQuestionIntent } from "@/lib/knowledge-image-evidence"

export interface RevisionAwareSearchContext {
  projectPath: string
  query: string
  draft: RevisionDraft | null
  groundTruth: GroundTruthDraft | null
  selectedCardId?: string | null
  selectedBlockIds?: string[]
  selectedTargetFieldKey?: string | null
  lastAcceptedCardId?: string | null
}

export interface RevisionAwareSearchResult {
  promptSections: string[]
  references: MessageReference[]
  evidenceSummary: string
}

interface DraftChunk {
  blockId: string
  content: string
  startLine: number
  endLine: number
}

const MAX_DRAFT_CHUNKS = 5
const MAX_PATCH_RESULTS = 3
const MAX_WIKI_RESULTS = 4
const MAX_GROUND_TRUTH_FIELDS = 4

function makeChunkId(startLine: number, endLine: number): string {
  return `draft:${startLine}-${endLine}`
}

function splitDraftIntoChunks(content: string): DraftChunk[] {
  const normalized = content.replace(/\r\n/g, "\n")
  const lines = normalized.split("\n")
  const chunks: DraftChunk[] = []

  let currentLines: string[] = []
  let currentStartLine = 1

  function flush(endLine: number) {
    const text = currentLines.join("\n").trim()
    if (!text) {
      currentLines = []
      currentStartLine = endLine + 1
      return
    }
    chunks.push({
      blockId: makeChunkId(currentStartLine, endLine),
      content: text,
      startLine: currentStartLine,
      endLine,
    })
    currentLines = []
    currentStartLine = endLine + 1
  }

  lines.forEach((line, index) => {
    const lineNo = index + 1
    const isHeading = /^#{1,6}\s+/.test(line)
    const isBlank = line.trim().length === 0

    if (isHeading && currentLines.length > 0) {
      flush(lineNo - 1)
    }

    currentLines.push(line)

    if (isBlank || currentLines.length >= 12) {
      flush(lineNo)
    }
  })

  if (currentLines.length > 0) {
    flush(lines.length)
  }

  return chunks
}

function scoreText(text: string, tokens: readonly string[], rawQuery: string): number {
  const lower = text.toLowerCase()
  const normalizedQuery = rawQuery.trim().toLowerCase()
  let score = 0

  if (normalizedQuery && lower.includes(normalizedQuery)) {
    score += 10
  }

  for (const token of tokens) {
    if (lower.includes(token)) score += 2
  }

  return score
}

function normalizeInlineText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function chunkContainsPatchContent(chunkContent: string, patchContent: string): boolean {
  const normalizedChunk = normalizeInlineText(chunkContent)
  const normalizedPatch = normalizeInlineText(patchContent)
  if (normalizedPatch.length < 18) return false
  const probe = normalizedPatch.slice(0, Math.min(normalizedPatch.length, 160))
  return normalizedChunk.includes(probe)
}

function summarizeGroundTruth(groundTruth: GroundTruthDraft): string {
  const fieldLines = groundTruth.fields
    .slice(0, MAX_GROUND_TRUTH_FIELDS)
    .map((field) => `- ${field.label}: ${field.value}`)

  return [
    `主链路步骤：${groundTruth.mainlineSteps.join("；") || "暂无"}`,
    `关键判断：${groundTruth.keyJudgements.join("；") || "暂无"}`,
    fieldLines.length > 0 ? "核心字段：" : "",
    ...fieldLines,
  ].filter(Boolean).join("\n")
}

export async function searchKnowledgeWorkspace(
  input: RevisionAwareSearchContext,
): Promise<RevisionAwareSearchResult> {
  const pp = normalizePath(input.projectPath)
  const query = input.query.trim()
  const tokens = tokenizeQuery(query)
  const effectiveTokens = tokens.length > 0 ? tokens : [query.toLowerCase()]

  const references: MessageReference[] = []
  const promptSections: string[] = []

  const draft = input.draft
  const selectedBlockSet = new Set(input.selectedBlockIds ?? [])
  const prioritizedPatches = draft?.appliedPatches?.length
    ? draft.appliedPatches
        .map((patch, index, allPatches) => {
          const text = patch.revisedMarkdown?.trim()
          if (!text) return null
          const lexicalScore = scoreText(text, effectiveTokens, query)
          const selectedCardBoost = patch.cardId && patch.cardId === input.selectedCardId ? 120 : 0
          const lastAcceptedBoost = patch.cardId && patch.cardId === input.lastAcceptedCardId ? 130 : 0
          const selectedBlockBoost = patch.targetBlockIds.some((blockId) => selectedBlockSet.has(blockId))
            || (patch.anchorBlockId ? selectedBlockSet.has(patch.anchorBlockId) : false)
            ? 100
            : 0
          const recentBoost = index >= Math.max(0, allPatches.length - MAX_PATCH_RESULTS) ? 8 : 0
          return {
            patch,
            score: lexicalScore + selectedCardBoost + lastAcceptedBoost + selectedBlockBoost + recentBoost,
          }
        })
        .filter((entry): entry is { patch: RevisionDraft["appliedPatches"][number]; score: number } => Boolean(entry && entry.score > 0))
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_PATCH_RESULTS)
    : []

  if (draft?.content?.trim() && prioritizedPatches.length > 0) {
    promptSections.push(
      [
        "## 最新修订片段（最高优先级）",
        ...prioritizedPatches.map(({ patch }, index) => {
          references.push({
            title: `最新修订片段 ${index + 1}`,
            path: `deliverables/revised-docs/${draft.docId}/draft.md`,
            kind: "patch",
            cardId: patch.cardId ?? input.selectedCardId ?? null,
            blockId: patch.patchId,
          })
          return `### 最新修订片段 [P${index + 1}] (${patch.patchMode})\n${patch.revisedMarkdown.trim()}`
        }),
      ].join("\n\n"),
    )
  }

  if (draft?.content?.trim()) {
    const chunks = splitDraftIntoChunks(draft.content)
    const scored = chunks
      .map((chunk) => {
        const score = scoreText(chunk.content, effectiveTokens, query)
        const latestRevisionBoost = prioritizedPatches.some(({ patch }) =>
          chunkContainsPatchContent(chunk.content, patch.revisedMarkdown),
        ) ? 24 : 0
        return { chunk, score: score + latestRevisionBoost }
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_DRAFT_CHUNKS)

    if (scored.length > 0) {
      promptSections.push(
        [
          "## 当前修订稿（优先知识层）",
          ...scored.map(({ chunk }, index) => {
            references.push({
              title: `修订稿片段 ${index + 1}`,
              path: `deliverables/revised-docs/${draft.docId}/draft.md`,
              kind: "draft",
              cardId: input.selectedCardId ?? null,
              blockId: chunk.blockId,
            })
            return `### 修订稿片段 [D${index + 1}] (${chunk.blockId})\n${chunk.content}`
          }),
        ].join("\n\n"),
      )
    }
  }

  if (input.groundTruth) {
    const gt = input.groundTruth
    const prioritizedFieldKeys = new Set<string>()
    if (input.selectedTargetFieldKey) {
      prioritizedFieldKeys.add(input.selectedTargetFieldKey)
    }
    const lastAcceptedField = input.lastAcceptedCardId
      ? gt.fields.find((field) => field.updatedFromCardId === input.lastAcceptedCardId)
      : null
    if (lastAcceptedField?.key) {
      prioritizedFieldKeys.add(lastAcceptedField.key)
    }

    const matchingFields = gt.fields
      .map((field) => ({
        field,
        score:
          scoreText(`${field.label}\n${field.value}`, effectiveTokens, query)
          + (prioritizedFieldKeys.has(field.key) ? 90 : 0)
          + (field.status === "revised" || field.status === "confirmed" ? 6 : 0),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_GROUND_TRUTH_FIELDS)

    const gtSummary = matchingFields.length > 0
      ? matchingFields.map(({ field }) => `- ${field.label}: ${field.value}`).join("\n")
      : summarizeGroundTruth(gt)

    promptSections.push(
      `## 当前业务底稿\n${gtSummary}`,
    )
    references.push({
      title: "业务底稿",
      path: `deliverables/ground-truth/${gt.docId}/draft.json`,
      kind: "ground_truth",
      cardId: input.selectedCardId ?? null,
      blockId: null,
    })
  }

  const wikiResults = await searchWiki(pp, query)
  const topWiki = wikiResults.slice(0, MAX_WIKI_RESULTS)
  if (topWiki.length > 0) {
    const pages = await Promise.all(
      topWiki.map(async (item) => {
        try {
          const content = await readFile(item.path)
          return {
            title: item.title,
            path: getRelativePath(item.path, pp),
            content: content.length > 2200 ? `${content.slice(0, 2200)}\n\n[...truncated...]` : content,
          }
        } catch {
          return null
        }
      }),
    )

    const materialized = pages.filter((item): item is NonNullable<typeof item> => Boolean(item))
    if (materialized.length > 0) {
      promptSections.push(
        [
          "## 项目知识页（补充层）",
          ...materialized.map((page, index) => {
            references.push({
              title: page.title,
              path: page.path,
              kind: page.path.includes("overview")
                ? "overview"
                : page.path.includes("index.md")
                  ? "index"
                  : "wiki",
              cardId: input.selectedCardId ?? null,
              blockId: null,
            })
            return `### 知识页 [W${index + 1}] ${page.title}\nPath: ${page.path}\n\n${page.content}`
          }),
        ].join("\n\n"),
      )
    }
  }

  if (hasVisualQuestionIntent(query)) {
    const imageHits = await searchKnowledgeImages(pp, query, { limit: 8 }).catch((err) => {
      console.warn("[revision-aware-search:image-index] failed", err)
      return []
    })
    const imageEvidence = formatImageEvidenceForPrompt(imageHits)
    if (imageEvidence) {
      promptSections.push(
        [
          "## Image Evidence",
          "以下图片来自项目图片证据索引。回答视觉、主图、细节、案例类问题时，必须优先使用这些 Markdown 图片；不要编造不存在的图片 URL。",
          imageEvidence,
        ].join("\n\n"),
      )
      const knownRefPaths = new Set(references.map((ref) => ref.path))
      for (const hit of imageHits) {
        if (knownRefPaths.has(hit.sourcePath)) continue
        knownRefPaths.add(hit.sourcePath)
        references.push({
          title: hit.sourceSlug,
          path: hit.sourcePath,
          kind: "source",
          cardId: input.selectedCardId ?? null,
          blockId: hit.imageId,
        })
      }
    }
  }

  if (promptSections.length === 0) {
    promptSections.push("## 可用资料\n当前还没有可用的修订稿或知识页内容，请明确说明信息不足。")
  }

  const evidenceSummary = references
    .map((ref) => `${ref.title} (${ref.kind ?? "wiki"})`)
    .join("；")

  return {
    promptSections,
    references,
    evidenceSummary: evidenceSummary || "暂无引用",
  }
}
