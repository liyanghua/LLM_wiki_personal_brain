import type { AskResultEntity } from "@/entities/answer-record/types";
import type { AnswerSectionView } from "./model";

const SECTION_LABELS: Record<string, string> = {
  Fact: "已知事实",
  Synthesis: "综合归纳",
  Interpretation: "业务解读",
  Recommendation: "建议动作",
  Citations: "依据来源",
};

function localizeTitle(raw: string): string {
  return SECTION_LABELS[raw] ?? raw;
}

function resolveMarkdown(source: AskResultEntity | string | null | undefined): string {
  if (!source) return "";
  return typeof source === "string" ? source : source.answer_markdown;
}

export function answerSectionsFromMarkdown(source: AskResultEntity | string | null | undefined): AnswerSectionView[] {
  const markdown = resolveMarkdown(source);
  if (!markdown) return [];
  const blocks = markdown.split(/^##\s+/gm).filter(Boolean);
  return blocks.map((block) => {
    const [rawTitle, ...bodyParts] = block.split("\n");
    return {
      title: localizeTitle(rawTitle.trim()),
      body: bodyParts.join("\n").trim(),
    };
  });
}
