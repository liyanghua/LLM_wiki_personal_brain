import { z } from "zod";

export const evidenceSnippetSchema = z.object({
  page_id: z.string(),
  page_title: z.string(),
  page_path: z.string(),
  source_refs: z.array(z.string()),
  snippet: z.string(),
  relevance_score: z.number(),
});

export const askResultSchema = z.object({
  query_id: z.string(),
  user_query: z.string(),
  answer_markdown: z.string(),
  ranked_pages: z.array(z.string()),
  retrieved_pages: z.array(z.string()),
  retrieved_sources: z.array(z.string()),
  selected_evidence: z.array(evidenceSnippetSchema),
  question_classification: z.object({
    question_type: z.string(),
    confidence: z.number(),
    cues: z.array(z.string()),
  }),
  recalled_memory: z.object({
    recent_session_summaries: z.array(z.string()),
    persistent_interests: z.array(z.string()),
    persistent_principles: z.array(z.string()),
    open_loops: z.array(z.string()),
  }),
  writeback_plan: z
    .object({
      query_id: z.string(),
      targets: z.array(
        z.object({
          target: z.string(),
          action: z.string(),
          rationale: z.string(),
          confidence: z.number(),
          long_term_value: z.string(),
          evidence_refs: z.array(z.string()),
          content_preview: z.string(),
          approval_status: z.string(),
        }),
      ),
    })
    .optional(),
  method_profile_id: z.string(),
  template_id: z.string(),
  created_at: z.string(),
});
