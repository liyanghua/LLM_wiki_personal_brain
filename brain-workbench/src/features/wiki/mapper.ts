import { toWikiPageEntity } from "@/entities/wiki-page/adapters";

export function mapWikiPages(payload: { pages: unknown[] }) {
  return payload.pages.map(toWikiPageEntity);
}

export function mapWikiPageDetail(payload: { page: unknown }) {
  return toWikiPageEntity(payload.page);
}
