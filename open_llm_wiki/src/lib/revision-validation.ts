import { readFile } from "@/commands/fs"
import { searchKnowledgeWorkspace } from "@/lib/revision-aware-search"
import { streamChat } from "@/lib/llm-client"
import { buildLanguageDirective } from "@/lib/output-language"
import { normalizePath } from "@/lib/path-utils"
import type { LlmConfig } from "@/stores/wiki-store"
import type {
  ComposerRequest,
  KnowledgeAnswerMeta,
  MessageReference,
  RevisionChatContext,
} from "@/stores/chat-store"

const QA_META_RE = /<!--\s*qa-meta:\s*([\s\S]+?)\s*-->/
const CITED_RE = /<!--\s*cited:\s*.+?\s*-->/

function stripHiddenAnswerMeta(content: string): string {
  return content
    .replace(QA_META_RE, "")
    .replace(CITED_RE, "")
    .trim()
}

function buildPromptLanguageSeed(...parts: unknown[]): string {
  return parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part.length > 0)
    .join("\n\n")
}

export function extractRevisionAnswerMeta(content: string): KnowledgeAnswerMeta | null {
  const match = content.match(QA_META_RE)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1]) as KnowledgeAnswerMeta
    return {
      supplements: Array.isArray(parsed.supplements)
        ? parsed.supplements.map((item, index) => ({
            supplementId: typeof item?.supplementId === "string" ? item.supplementId : `supplement-${index + 1}`,
            title: typeof item?.title === "string" && item.title.trim() ? item.title.trim() : "启发性补充",
            origin: item?.origin === "evidence_extension" ? "evidence_extension" : "model_experience",
            disclaimer: typeof item?.disclaimer === "string" && item.disclaimer.trim()
              ? item.disclaimer.trim()
              : "这条内容目前不属于已确认底稿。",
            candidateSentence: typeof item?.candidateSentence === "string" ? item.candidateSentence.trim() : "",
            rationale: typeof item?.rationale === "string" ? item.rationale.trim() : "",
            targetFieldKey: typeof item?.targetFieldKey === "string" ? item.targetFieldKey : null,
            linkedCardId: typeof item?.linkedCardId === "string" ? item.linkedCardId : null,
            confidence: typeof item?.confidence === "number" ? item.confidence : 0.5,
          }))
        : [],
    }
  } catch {
    return null
  }
}

interface RunRevisionValidationTurnInput {
  projectPath: string
  projectName: string
  llmConfig: LlmConfig
  question: string
  revisionContext: RevisionChatContext
  signal?: AbortSignal
  onToken?: (token: string) => void
}

export async function runRevisionValidationTurn(
  input: RunRevisionValidationTurnInput,
): Promise<{
  content: string
  references: MessageReference[]
  answerMeta: KnowledgeAnswerMeta | null
  raw: string
}> {
  const pp = normalizePath(input.projectPath)
  const [rawIndex, purpose] = await Promise.all([
    readFile(`${pp}/wiki/index.md`).catch(() => ""),
    readFile(`${pp}/purpose.md`).catch(() => ""),
  ])
  const languageSeed = buildPromptLanguageSeed(
    input.question,
    input.projectName,
    purpose,
    rawIndex.slice(0, 1200),
    input.revisionContext.selectedCardTitle,
    input.revisionContext.selectedCardDiagnosis,
    input.revisionContext.groundTruthSummary,
  )
  const retrieval = await searchKnowledgeWorkspace({
    projectPath: pp,
    query: input.question,
    draft: input.revisionContext.draft ?? null,
    groundTruth: input.revisionContext.groundTruth ?? null,
    selectedCardId: input.revisionContext.selectedCardId ?? null,
    selectedBlockIds: input.revisionContext.selectedBlockIds ?? [],
    selectedTargetFieldKey: input.revisionContext.selectedTargetFieldKey ?? null,
    lastAcceptedCardId: input.revisionContext.lastAcceptedCardId ?? null,
  })

  let output = ""
  let streamError: Error | null = null
  await streamChat(
    input.llmConfig,
    [
      {
        role: "system",
        content: [
          buildLanguageDirective(languageSeed),
          "",
          "You are a business knowledge validation assistant working inside a revision workbench.",
          "Answer with the current working draft as the PRIMARY source of truth.",
          "If the working draft conflicts with published wiki pages, prefer the working draft and explicitly say it is the current revision version.",
          "Only use the project wiki as a supplement when the draft or business draft is incomplete.",
          "",
          "## Required answer shape",
          "1. 直接答案",
          "2. 依据",
          "3. 当前依据来自：修订稿 / wiki / 两者 / 资料不足",
          "4. 启发性补充（可选）",
          "5. 可纳入修订的建议句（可选）",
          "",
          "## Rules",
          "- ‘直接答案 / 依据 / 当前依据来自’ 只能基于提供给你的修订稿、业务底稿和项目 wiki。",
          "- 如果当前资料已足够回答，就不要强行生成启发性补充。",
          "- 如果当前资料不完整，但你能给出有帮助的延展，请把它放进“启发性补充”，不能混进“直接答案”。",
          "- 启发性补充只能使用这两种来源标签之一：",
          "  - 来源：基于当前资料的延展",
          "  - 来源：基于通用业务经验，尚未在当前底稿确认",
          "- 若给出“可纳入修订的建议句”，必须明确说这是一条待专家确认的候选表达。",
          "- If the current document does not cover the question, say so clearly before using broader wiki context.",
          "- Use [[wikilink]] syntax when referring to wiki pages.",
          "- At the VERY END of your response, add a hidden comment listing which references you used:",
          "  <!-- cited: 1, 2 -->",
          "- If you provide any 启发性补充, append one more hidden comment at the VERY END after cited refs:",
          "  <!-- qa-meta: {\"supplements\":[{\"supplementId\":\"supp-1\",\"title\":\"启发性补充\",\"origin\":\"evidence_extension|model_experience\",\"disclaimer\":\"这条内容目前不属于已确认底稿。\",\"candidateSentence\":\"...\",\"rationale\":\"...\",\"targetFieldKey\":\"...\",\"linkedCardId\":\"...\",\"confidence\":0.72}]} -->",
          "- If there is no 启发性补充, do not output qa-meta.",
          "",
          purpose ? `## 项目目的\n${purpose}` : "",
          rawIndex ? `## 项目索引\n${rawIndex.slice(0, 8000)}` : "",
          input.revisionContext.selectedCardTitle ? `## 当前问题卡\n${input.revisionContext.selectedCardTitle}` : "",
          input.revisionContext.selectedCardDiagnosis ? `## 当前问题卡诊断\n${input.revisionContext.selectedCardDiagnosis}` : "",
          input.revisionContext.groundTruthSummary ? `## 当前业务底稿摘要\n${input.revisionContext.groundTruthSummary}` : "",
          ...retrieval.promptSections,
        ].filter(Boolean).join("\n"),
      },
      {
        role: "user",
        content: input.question,
      },
    ],
    {
      onToken: (token) => {
        output += token
        input.onToken?.(token)
      },
      onDone: () => {},
      onError: (error) => {
        streamError = error
      },
    },
    input.signal,
  )

  if (streamError) {
    throw streamError
  }

  return {
    content: stripHiddenAnswerMeta(output),
    references: retrieval.references,
    answerMeta: extractRevisionAnswerMeta(output),
    raw: output,
  }
}

export type { ComposerRequest }
