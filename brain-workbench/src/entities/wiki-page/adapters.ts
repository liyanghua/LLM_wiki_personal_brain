import type { WikiPageEntity } from "./types";
import { wikiPageSchema } from "./schema";

export function toWikiPageEntity(payload: unknown): WikiPageEntity {
  return wikiPageSchema.parse(payload);
}
