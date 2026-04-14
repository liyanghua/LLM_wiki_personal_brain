import { onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useWikiStore } from "@/app/stores/wiki.store";
import { resolvePinia } from "@/shared/lib/guards";
import { getWikiPage, getWikiTree, listWikiPages } from "./api";

export function useWikiExplorer() {
  const store = useWikiStore(resolvePinia());
  const refs = storeToRefs(store);

  async function load() {
    store.loading = true;
    store.error = "";
    try {
      store.pages = await listWikiPages();
      store.tree = (await getWikiTree()).tree ?? [];
      if (store.selectedPageId) {
        store.detail = await getWikiPage(store.selectedPageId);
      }
    } catch (e: any) {
      store.error = e?.message || "加载知识地图失败";
    } finally {
      store.loading = false;
    }
  }

  async function selectPage(pageId: string) {
    store.selectedPageId = pageId;
    try {
      store.detail = await getWikiPage(pageId);
    } catch (e: any) {
      store.error = e?.message || "加载页面详情失败";
    }
  }

  onMounted(load);

  return { ...refs, selectPage, reload: load };
}
