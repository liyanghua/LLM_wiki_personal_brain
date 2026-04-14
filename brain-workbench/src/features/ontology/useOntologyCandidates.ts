import { onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useAssetsStore } from "@/app/stores/assets.store";
import { resolvePinia } from "@/shared/lib/guards";
import { listOntologyCandidates } from "./api";

export function useOntologyCandidates() {
  const store = useAssetsStore(resolvePinia());
  const refs = storeToRefs(store);

  onMounted(async () => {
    store.ontologyCandidates = await listOntologyCandidates();
  });

  return refs;
}
