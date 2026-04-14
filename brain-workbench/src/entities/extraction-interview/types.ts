import type { EvidenceSnippet } from "@/entities/answer-record/types";

export interface RetrievalHitEntity {
  title: string;
  path: string;
  snippet: string;
  score: number;
  source_refs: string[];
}

export interface QuestionPlanEntity {
  next_question_type: string;
  candidate_questions: string[];
  target_missing_slots: string[];
  stop_if: string[];
}

export interface StopDecisionEntity {
  should_stop: boolean;
  reason: string;
  confidence: number;
}

export interface StagedWritebackEntity {
  session_level: Record<string, unknown> | null;
  knowledge_level: Record<string, unknown> | null;
  asset_level: Record<string, unknown> | null;
  projected_writeback_level: string;
}

export interface ExtractionInterviewStateEntity {
  interview_id: string;
  interaction_mode: "extraction-interview";
  status: string;
  question_type: string;
  turn_index: number;
  current_object: string;
  current_knowledge_goal: string;
  known_slots: Record<string, string>;
  missing_slots: string[];
  retrieval_buckets: {
    object_pages: RetrievalHitEntity[];
    evidence_pages: EvidenceSnippet[];
    conversation_hits: RetrievalHitEntity[];
    pattern_hits: RetrievalHitEntity[];
    ranked_page_paths: string[];
    retrieved_sources: string[];
  };
  current_answer_markdown: string;
  current_answer_summary: string;
  next_question_plan: QuestionPlanEntity;
  stop_decision: StopDecisionEntity;
  staged_writeback: StagedWritebackEntity;
  state_path: string;
}
