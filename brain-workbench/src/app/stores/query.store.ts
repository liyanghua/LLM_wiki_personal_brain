import { defineStore } from "pinia";
import { createEmptyAgentTrace } from "@/entities/agent-trace/adapters";
import type { AskResultEntity } from "@/entities/answer-record/types";
import type { ExtractionInterviewStateEntity, InterviewSessionEntity } from "@/entities/extraction-interview/types";
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
  retrieval_backend: "legacy",
  retrieval_mode: "heuristic",
  retrieval_collection: "wiki",
  retrieval_explain: [],
  process_context: {
    current_stage: "",
    current_step: "",
    linked_rules: [],
    linked_cases: [],
    linked_sources: [],
  },
  answer_grounding_blocks: [],
  compile_warnings: [],
  agent_trace: createEmptyAgentTrace(),
  created_at: "",
};

const emptyMemory: MemoryRecentEntity = {
  recent_queries: [],
  recent_session_summaries: [],
  persistent_interests: [],
  persistent_principles: [],
  open_loops: [],
};

const emptySessionDraft: Pick<
  InterviewSessionEntity,
  "title" | "topic_type" | "target_object" | "goal" | "created_by"
> = {
  title: "",
  topic_type: "topic",
  target_object: "",
  goal: "",
  created_by: "expert",
};

export const useQueryStore = defineStore("query", {
  state: (): {
    mode: AskMode;
    quickResult: AskResultEntity;
    extractionState: ExtractionInterviewStateEntity | null;
    extractionSessionDraft: Pick<
      InterviewSessionEntity,
      "title" | "topic_type" | "target_object" | "goal" | "created_by"
    >;
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
    extractionSessionDraft: { ...emptySessionDraft },
    questionDraft: "",
    followupAnswerDraft: "",
    selectedCandidateQuestion: "",
    recentMemory: emptyMemory,
    loading: false,
    error: "",
  }),
});
