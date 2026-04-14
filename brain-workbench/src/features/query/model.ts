import type { AskResultEntity } from "@/entities/answer-record/types";

export interface AnswerSectionView {
  title: string;
  body: string;
}

export interface AskWorkspaceViewModel {
  result: AskResultEntity;
  sections: AnswerSectionView[];
}
