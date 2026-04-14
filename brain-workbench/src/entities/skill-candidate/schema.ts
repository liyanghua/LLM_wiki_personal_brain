import { z } from "zod";

export const skillCandidateSchema = z.object({
  skill_id: z.string(),
  family: z.string(),
  title: z.string(),
  summary: z.string(),
  origin_query_ids: z.array(z.string()),
  origin_wiki_pages: z.array(z.string()),
  source_refs: z.array(z.string()),
  asset_value_score: z.number(),
  status: z.string(),
});
