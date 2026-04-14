import { defineStore } from "pinia";
import type { WikiPageEntity } from "@/entities/wiki-page/types";
import { wikiDetailMock, wikiPagesMock, wikiTreeMock } from "@/mocks/wiki.mock";

export const useWikiStore = defineStore("wiki", {
  state: (): {
    pages: WikiPageEntity[];
    tree: Array<Record<string, unknown>>;
    selectedPageId: string;
    detail: WikiPageEntity;
    loading: boolean;
  } => ({
    pages: wikiPagesMock.pages,
    tree: wikiTreeMock.tree,
    selectedPageId: wikiDetailMock.page.page_id,
    detail: wikiDetailMock.page,
    loading: false,
  }),
});
