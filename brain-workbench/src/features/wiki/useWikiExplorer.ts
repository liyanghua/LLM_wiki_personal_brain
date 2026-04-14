import { onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useWikiStore } from "@/app/stores/wiki.store";
import { resolvePinia } from "@/shared/lib/guards";
import { getWikiPage, getWikiTree, listWikiPages } from "./api";

export function useWikiExplorer() {
  const store = useWikiStore(resolvePinia());
  const refs = storeToRefs(store);

  onMounted(async () => {
    store.pages = await listWikiPages();
    store.tree = (await getWikiTree()).tree;
    if (store.selectedPageId) {
      store.detail = await getWikiPage(store.selectedPageId);
    }
  });

  async function selectPage(pageId: string) {
    store.selectedPageId = pageId;
    store.detail = await getWikiPage(pageId);
  }

  return { ...refs, selectPage };
}
