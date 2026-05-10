import { z } from "zod";
import { evidenceSnippetSchema } from "@/entities/answer-record/schema";
import { agentTraceSchema } from "@/entities/agent-trace/schema";

const retrievalHitSchema = z.object({
  title: z.string(),
  path: z.string(),
  snippet: z.string(),
  score: z.number(),
  source_refs: z.array(z.string()),
});

const retrievalBucketsSchema = z.object({
  object_pages: z.array(retrievalHitSchema),
  evidence_pages: z.array(evidenceSnippetSchema),
  conversation_hits: z.array(retrievalHitSchema),
  pattern_hits: z.array(retrievalHitSchema),
  ranked_page_paths: z.array(z.string()),
  retrieved_sources: z.array(z.string()),
  retrieval_backend: z.string().nullish(),
  retrieval_mode: z.string().nullish(),
  retrieval_collection: z.string().nullish(),
  retrieval_explain: z.array(z.string()).nullish(),
});

const questionPlanSchema = z.object({
  next_question_type: z.string(),
  candidate_questions: z.array(z.string()),
  target_missing_slots: z.array(z.string()),
  stop_if: z.array(z.string()),
});

const stopDecisionSchema = z.object({
  should_stop: z.boolean(),
  reason: z.string(),
  confidence: z.number(),
});

const stagedWritebackSchema = z.object({
  session_level: z.record(z.any()).nullable(),
  knowledge_level: z.record(z.any()).nullable(),
  asset_level: z.record(z.any()).nullable(),
  projected_writeback_level: z.string(),
});

const interviewSessionSchema = z.object({
  session_id: z.string(),
  title: z.string(),
  topic_type: z.string(),
  target_object: z.string(),
  goal: z.string(),
  status: z.string(),
  created_by: z.string(),
  created_at: z.string().nullish(),
  completed_at: z.string().nullish(),
  current_stage: z.string().nullish(),
  current_step: z.string().nullish(),
});

const candidateAssetSchema = z.object({
  asset_id: z.string(),
  session_id: z.string(),
  asset_type: z.enum(["concept", "heuristic", "case", "signal", "boundary"]),
  title: z.string(),
  summary: z.string(),
  content_json: z.record(z.any()).nullish(),
  confidence: z.number(),
  source_turn_ids: z.array(z.number()).nullish(),
  evidence_refs: z.array(z.string()).nullish(),
  status: z.enum(["draft", "confirmed", "needs_clarification", "rejected"]).nullish(),
  expert_note: z.string().nullish(),
  stage_refs: z.array(z.string()).nullish(),
  step_refs: z.array(z.string()).nullish(),
  decision_refs: z.array(z.string()).nullish(),
  card_group: z.string().nullish(),
  card_order: z.number().nullish(),
  anchor_block_refs: z.array(z.string()).nullish(),
});

const followupQuestionSchema = z.object({
  question_id: z.string(),
  session_id: z.string(),
  question_text: z.string(),
  question_type: z.string(),
  reason: z.string(),
  priority: z.enum(["high", "medium", "low"]).nullish(),
  status: z.enum(["open", "selected", "answered", "frozen"]).nullish(),
  source_asset_ids: z.array(z.string()).nullish(),
  target_missing_slots: z.array(z.string()).nullish(),
  linked_stage: z.string().nullish(),
  linked_step: z.string().nullish(),
  gap_type: z.string().nullish(),
});

const sessionSummarySchema = z.object({
  summary_id: z.string(),
  session_id: z.string(),
  summary_text: z.string(),
  key_concepts: z.array(z.string()).nullish(),
  key_heuristics: z.array(z.string()).nullish(),
  key_cases: z.array(z.string()).nullish(),
  key_boundaries: z.array(z.string()).nullish(),
  unresolved_items: z.array(z.string()).nullish(),
});

const interviewViewSchema = z.object({
  current_prompt: z.string(),
  prompt_type_label: z.string(),
  phase_label: z.string(),
  recommended_followups: z.array(z.string()).nullish(),
  structure_counts: z
    .object({
      concepts: z.number().nullish(),
      heuristics: z.number().nullish(),
      cases: z.number().nullish(),
      boundaries: z.number().nullish(),
    })
    .nullish(),
  answer_frame: z
    .object({
      primary_answer: z.string().nullish(),
      mainline_steps: z.array(z.string()).nullish(),
      key_judgements: z.array(z.string()).nullish(),
      evidence_refs: z.array(z.string()).nullish(),
    })
    .nullish(),
  can_skip: z.boolean().nullish(),
  can_summarize: z.boolean().nullish(),
  autosave_state: z.string().nullish(),
});

const autosaveStateSchema = z.object({
  saved: z.boolean().nullish(),
  state_path: z.string().nullish(),
  updated_at: z.string().nullish(),
  status: z.string().nullish(),
});

const degradedRetrievalModeSchema = z.object({
  active: z.boolean().nullish(),
  configured_backend: z.string().nullish(),
  actual_backend: z.string().nullish(),
  reason: z.string().nullish(),
});

const extractionTurnSchema = z.object({
  turn_index: z.number(),
  user_input: z.string(),
  answer_summary: z.string().default(""),
  answer_markdown: z.string().default(""),
  newly_filled_slots: z.array(z.string()).nullish(),
  created_at: z.string().nullish(),
  agent_trace: agentTraceSchema.nullish(),
});

export const extractionInterviewStateSchema = z.object({
  interview_id: z.string(),
  interaction_mode: z.literal("extraction-interview"),
  session: interviewSessionSchema.nullish(),
  status: z.string(),
  question_type: z.string(),
  turn_index: z.number(),
  current_object: z.string(),
  current_knowledge_goal: z.string(),
  current_stage: z.string().nullish(),
  current_step: z.string().nullish(),
  process_context: z
    .object({
      current_stage: z.string().nullish(),
      current_step: z.string().nullish(),
      linked_rules: z.array(z.string()).nullish(),
      linked_cases: z.array(z.string()).nullish(),
      linked_sources: z.array(z.string()).nullish(),
      anchor_bundle_id: z.string().nullish(),
      anchor_paths: z.array(z.string()).nullish(),
      matched_block_ids: z.array(z.string()).nullish(),
      answer_mode: z.string().nullish(),
    })
    .nullish(),
  known_slots: z.record(z.string()),
  missing_slots: z.array(z.string()),
  retrieval_buckets: retrievalBucketsSchema.partial().nullish(),
  current_answer_markdown: z.string(),
  current_answer_summary: z.string(),
  answer_grounding_blocks: z
    .array(
      z.object({
        label: z.string(),
        block_type: z.string(),
        text: z.string(),
        refs: z.array(z.string()),
        stage: z.string().nullish(),
        step: z.string().nullish(),
      }),
    )
    .nullish(),
  next_question_plan: questionPlanSchema.partial().nullish(),
  stop_decision: stopDecisionSchema.partial().nullish(),
  staged_writeback: stagedWritebackSchema.partial().nullish(),
  candidate_assets: z.array(candidateAssetSchema).nullish(),
  followup_questions: z.array(followupQuestionSchema).nullish(),
  session_summary: sessionSummarySchema.nullish(),
  interview_view: interviewViewSchema.nullish(),
  autosave_state: autosaveStateSchema.nullish(),
  degraded_retrieval_mode: degradedRetrievalModeSchema.nullish(),
  current_trace: agentTraceSchema.nullish(),
  compile_warnings: z.array(z.string()).nullish(),
  turns: z.array(extractionTurnSchema).nullish(),
  state_path: z.string().nullish(),
});
