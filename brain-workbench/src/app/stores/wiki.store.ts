import { defineStore } from "pinia";
import type { WikiPageEntity } from "@/entities/wiki-page/types";

const emptyDetail: WikiPageEntity = {
  page_id: "",
  page_type: "",
  title: "",
  path: "",
  summary: "",
  source_refs: [],
  links_to: [],
  updated_at: "",
};

export const useWikiStore = defineStore("wiki", {
  state: (): {
    pages: WikiPageEntity[];
    tree: Array<Record<string, unknown>>;
    selectedPageId: string;
    detail: WikiPageEntity;
    loading: boolean;
    error: string;
  } => ({
    pages: [],
    tree: [],
    selectedPageId: "",
    detail: emptyDetail,
    loading: false,
    error: "",
  }),
});
