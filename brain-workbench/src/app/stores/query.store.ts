import { defineStore } from "pinia";
import type { AskResultEntity } from "@/entities/answer-record/types";
import type { ExtractionInterviewStateEntity } from "@/entities/extraction-interview/types";
import type { MemoryRecentEntity } from "@/entities/memory-item/types";

export type AskMode = "extraction" | "quick";

const emptyResult: AskResultEntity = {
  query_id: "",
  user_query: "",
  answer_markdown: "",
  ranked_pages: [],
  retrieved_pages: [],
  retrieved_sources: [],
  selected_evidence: [],
  question_classification: { question_type: "", confidence: 0, cues: [] },
  recalled_memory: {
    recent_session_summaries: [],
    persistent_interests: [],
    persistent_principles: [],
    open_loops: [],
  },
  method_profile_id: "",
  template_id: "",
  created_at: "",
};

const emptyMemory: MemoryRecentEntity = {
  recent_queries: [],
  recent_session_summaries: [],
  persistent_interests: [],
  persistent_principles: [],
  open_loops: [],
};

export const useQueryStore = defineStore("query", {
  state: (): {
    mode: AskMode;
    quickResult: AskResultEntity;
    extractionState: ExtractionInterviewStateEntity | null;
    questionDraft: string;
    followupAnswerDraft: string;
    selectedCandidateQuestion: string;
    recentMemory: MemoryRecentEntity;
    loading: boolean;
    error: string;
  } => ({
    mode: "extraction",
    quickResult: emptyResult,
    extractionState: null,
    questionDraft: "",
    followupAnswerDraft: "",
    selectedCandidateQuestion: "",
    recentMemory: emptyMemory,
    loading: false,
    error: "",
  }),
});
