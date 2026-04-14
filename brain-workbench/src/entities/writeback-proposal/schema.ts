import { z } from "zod";

export const writebackTargetDecisionSchema = z.object({
  target: z.string(),
  action: z.string(),
  rationale: z.string(),
  confidence: z.number(),
  long_term_value: z.string(),
  evidence_refs: z.array(z.string()),
  content_preview: z.string(),
  approval_status: z.string(),
});

export const writebackBundleSchema = z.object({
  query_id: z.string(),
  question: z.string(),
  created_at: z.string(),
  target_paths: z.array(z.string()),
  applied_targets: z.array(z.string()),
  targets: z.array(writebackTargetDecisionSchema),
});
