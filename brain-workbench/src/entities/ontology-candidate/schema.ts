import { z } from "zod";

export const ontologyCandidateSchema = z.object({
  candidate_id: z.string(),
  candidate_type: z.string(),
  canonical_name: z.string(),
  summary: z.string(),
  wiki_refs: z.array(z.string()),
  source_refs: z.array(z.string()),
  attributes: z.record(z.any()),
  status: z.string(),
});
