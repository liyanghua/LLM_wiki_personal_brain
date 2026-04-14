import { wikiDetailMock, wikiPagesMock, wikiTreeMock } from "@/mocks/wiki.mock";
import { apiClient } from "@/shared/api/client";
import { ENDPOINTS } from "@/shared/api/endpoints";
import { mapWikiPageDetail, mapWikiPages } from "./mapper";

export async function listWikiPages() {
  const payload = await apiClient.get(ENDPOINTS.wikiPages, () => wikiPagesMock);
  return mapWikiPages(payload);
}

export async function getWikiTree() {
  return await apiClient.get(ENDPOINTS.wikiTree, () => wikiTreeMock);
}

export async function getWikiPage(pageId: string) {
  const payload = await apiClient.get(ENDPOINTS.wikiPage(pageId), () => wikiDetailMock);
  return mapWikiPageDetail(payload);
}
