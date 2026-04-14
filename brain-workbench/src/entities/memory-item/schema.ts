import { z } from "zod";

export const memoryRecentSchema = z.object({
  recent_queries: z.array(
    z.object({
      query_id: z.string(),
      question: z.string(),
      question_type: z.string(),
      summary: z.string(),
      created_at: z.string(),
    }),
  ),
  recent_session_summaries: z.array(z.string()),
  persistent_interests: z.array(z.string()),
  persistent_principles: z.array(z.string()),
  open_loops: z.array(z.union([z.string(), z.object({ question: z.string() })])),
});
