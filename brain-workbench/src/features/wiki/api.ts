import { apiClient } from "@/shared/api/client";
import { ENDPOINTS } from "@/shared/api/endpoints";
import { mapWikiPageDetail, mapWikiPages } from "./mapper";

export async function listWikiPages() {
  const payload = await apiClient.get<{ pages: unknown[] }>(ENDPOINTS.wikiPages);
  return mapWikiPages(payload);
}

export async function getWikiTree() {
  return await apiClient.get<{ tree: Array<Record<string, unknown>> }>(ENDPOINTS.wikiTree);
}

export async function getWikiPage(pageId: string) {
  const payload = await apiClient.get<{ page: unknown }>(ENDPOINTS.wikiPage(pageId));
  return mapWikiPageDetail(payload);
}
