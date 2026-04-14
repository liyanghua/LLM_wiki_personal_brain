import type { AskResultEntity } from "@/entities/answer-record/types";
import type { AnswerSectionView } from "./model";

export function answerSectionsFromMarkdown(result: AskResultEntity): AnswerSectionView[] {
  const blocks = result.answer_markdown.split(/^##\s+/gm).filter(Boolean);
  return blocks.map((block) => {
    const [rawTitle, ...bodyParts] = block.split("\n");
    return {
      title: rawTitle.trim(),
      body: bodyParts.join("\n").trim(),
    };
  });
}
