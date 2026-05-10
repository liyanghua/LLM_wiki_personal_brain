import type { AgentTraceBundleEntity } from "@/entities/agent-trace/types";
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

export interface InterviewSessionEntity {
  session_id: string;
  title: string;
  topic_type: string;
  target_object: string;
  goal: string;
  status: string;
  created_by: string;
  created_at: string;
  completed_at: string;
  current_stage: string;
  current_step: string;
}

export interface CandidateAssetEntity {
  asset_id: string;
  session_id: string;
  asset_type: "concept" | "heuristic" | "case" | "signal" | "boundary";
  title: string;
  summary: string;
  content_json: Record<string, unknown>;
  confidence: number;
  source_turn_ids: number[];
  evidence_refs: string[];
  status: "draft" | "confirmed" | "needs_clarification" | "rejected";
  expert_note: string;
  stage_refs: string[];
  step_refs: string[];
  decision_refs: string[];
  card_group: string;
  card_order: number;
  anchor_block_refs: string[];
}

export interface FollowupQuestionEntity {
  question_id: string;
  session_id: string;
  question_text: string;
  question_type: string;
  reason: string;
  priority: "high" | "medium" | "low";
  status: "open" | "selected" | "answered" | "frozen";
  source_asset_ids: string[];
  target_missing_slots: string[];
  linked_stage: string;
  linked_step: string;
  gap_type: string;
}

export interface SessionSummaryEntity {
  summary_id: string;
  session_id: string;
  summary_text: string;
  key_concepts: string[];
  key_heuristics: string[];
  key_cases: string[];
  key_boundaries: string[];
  unresolved_items: string[];
}

export interface InterviewViewEntity {
  current_prompt: string;
  prompt_type_label: string;
  phase_label: string;
  recommended_followups: string[];
  structure_counts: {
    concepts: number;
    heuristics: number;
    cases: number;
    boundaries: number;
  };
  answer_frame: {
    primary_answer: string;
    mainline_steps: string[];
    key_judgements: string[];
    evidence_refs: string[];
  };
  can_skip: boolean;
  can_summarize: boolean;
  autosave_state: string;
}

export interface AutosaveStateEntity {
  saved: boolean;
  state_path: string;
  updated_at: string;
  status: string;
}

export interface DegradedRetrievalModeEntity {
  active: boolean;
  configured_backend: string;
  actual_backend: string;
  reason: string;
}

export interface ExtractionInterviewTurnEntity {
  turn_index: number;
  user_input: string;
  answer_summary: string;
  answer_markdown: string;
  newly_filled_slots: string[];
  created_at: string;
  agent_trace: AgentTraceBundleEntity;
}

export interface ExtractionInterviewStateEntity {
  interview_id: string;
  interaction_mode: "extraction-interview";
  session: InterviewSessionEntity;
  status: string;
  question_type: string;
  turn_index: number;
  current_object: string;
  current_knowledge_goal: string;
  current_stage: string;
  current_step: string;
  process_context: {
    current_stage: string;
    current_step: string;
    linked_rules: string[];
    linked_cases: string[];
    linked_sources: string[];
    anchor_bundle_id: string;
    anchor_paths: string[];
    matched_block_ids: string[];
    answer_mode: string;
  };
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
  answer_grounding_blocks: Array<{
    label: string;
    block_type: string;
    text: string;
    refs: string[];
    stage: string;
    step: string;
  }>;
  next_question_plan: QuestionPlanEntity;
  stop_decision: StopDecisionEntity;
  staged_writeback: StagedWritebackEntity;
  candidate_assets: CandidateAssetEntity[];
  followup_questions: FollowupQuestionEntity[];
  session_summary: SessionSummaryEntity;
  interview_view: InterviewViewEntity;
  autosave_state: AutosaveStateEntity;
  degraded_retrieval_mode: DegradedRetrievalModeEntity;
  current_trace: AgentTraceBundleEntity;
  compile_warnings: string[];
  turns: ExtractionInterviewTurnEntity[];
  state_path: string;
}
