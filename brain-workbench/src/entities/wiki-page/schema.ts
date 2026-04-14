import { z } from "zod";

export const wikiPageSchema = z.object({
  page_id: z.string(),
  page_type: z.string(),
  title: z.string(),
  path: z.string(),
  summary: z.string(),
  source_refs: z.array(z.string()),
  links_to: z.array(z.string()),
  backlinks: z.array(z.string()).optional(),
  updated_at: z.string(),
  linked_pages: z.array(z.object({ path: z.string(), title: z.string() })).optional(),
  markdown: z.string().optional(),
});
