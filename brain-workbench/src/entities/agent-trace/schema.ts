import { z } from "zod";

export const traceStageStatusSchema = z.enum(["pass", "partial", "fail", "inactive"]);

export const traceStageSchema = z.object({
  stage_id: z.string(),
  label: z.string(),
  status: traceStageStatusSchema,
  reason: z.string(),
  pass_criteria: z.string(),
  evidence_refs: z.array(z.string()).nullish(),
  warnings: z.array(z.string()).nullish(),
});

export const traceTopHitSchema = z.object({
  path: z.string(),
  title: z.string(),
  score: z.number(),
  snippet: z.string().optional(),
});

export const traceLogEntrySchema = z.object({
  component: z.string(),
  step: z.string(),
  input_summary: z.string(),
  output_summary: z.string(),
  refs: z.array(z.string()).nullish(),
  warnings: z.array(z.string()).nullish(),
});

export const agentTraceSchema = z.object({
  stage_checks: z.array(traceStageSchema).nullish(),
  retrieval_trace: z
    .object({
      backend: z.string().optional(),
      mode: z.string().optional(),
      collection: z.string().optional(),
      retrieval_explain: z.array(z.string()).nullish(),
      wiki_hits: z.array(z.string()).nullish(),
      raw_hits: z.array(z.string()).nullish(),
      top_hits: z.array(traceTopHitSchema).nullish(),
      warnings: z.array(z.string()).nullish(),
    })
    .nullish(),
  decision_trace: z
    .object({
      question_type: z.string().optional(),
      current_object: z.string().optional(),
      knowledge_goal: z.string().optional(),
      recommended_action: z.string().optional(),
      target_missing_slots: z.array(z.string()).nullish(),
      stop_reason: z.string().optional(),
    })
    .nullish(),
  llm_log: z.array(traceLogEntrySchema).nullish(),
});
