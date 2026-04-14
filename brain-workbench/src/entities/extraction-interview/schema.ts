import { z } from "zod";
import { evidenceSnippetSchema } from "@/entities/answer-record/schema";

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

export const extractionInterviewStateSchema = z.object({
  interview_id: z.string(),
  interaction_mode: z.literal("extraction-interview"),
  status: z.string(),
  question_type: z.string(),
  turn_index: z.number(),
  current_object: z.string(),
  current_knowledge_goal: z.string(),
  known_slots: z.record(z.string()),
  missing_slots: z.array(z.string()),
  retrieval_buckets: retrievalBucketsSchema,
  current_answer_markdown: z.string(),
  current_answer_summary: z.string(),
  next_question_plan: questionPlanSchema,
  stop_decision: stopDecisionSchema,
  staged_writeback: stagedWritebackSchema,
  state_path: z.string(),
});
