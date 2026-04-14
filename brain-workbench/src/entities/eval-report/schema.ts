import { z } from "zod";

export const evalReportSummarySchema = z.object({
  run_id: z.string(),
  created_at: z.string(),
  metrics: z.record(z.number()),
  report_path_json: z.string().optional(),
  report_path_markdown: z.string().optional(),
});

export const evalReportSchema = evalReportSummarySchema.extend({
  case_results: z.array(
    z.object({
      case_id: z.string(),
      question: z.string(),
      scores: z.record(z.number()),
      matched_targets: z.array(z.string()),
      missing_targets: z.array(z.string()),
      explanation: z.string(),
    }),
  ),
});
