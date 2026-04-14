import { onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useAssetsStore } from "@/app/stores/assets.store";
import { resolvePinia } from "@/shared/lib/guards";
import { listOntologyCandidates } from "./api";

export function useOntologyCandidates() {
  const store = useAssetsStore(resolvePinia());
  const refs = storeToRefs(store);

  onMounted(async () => {
    store.loading = true;
    store.error = "";
    try {
      store.ontologyCandidates = await listOntologyCandidates();
    } catch (e: any) {
      store.error = e?.message || "加载本体候选失败";
    } finally {
      store.loading = false;
    }
  });

  return refs;
}
