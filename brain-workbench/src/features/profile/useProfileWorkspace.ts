import { onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useProfileStore } from "@/app/stores/profile.store";
import { resolvePinia } from "@/shared/lib/guards";
import { getMethodProfile, getPersistentMemory, getProfileProposals } from "./api";

export function useProfileWorkspace() {
  const store = useProfileStore(resolvePinia());
  const refs = storeToRefs(store);

  onMounted(async () => {
    store.methodProfile = await getMethodProfile();
    store.persistentMemory = await getPersistentMemory();
    store.proposals = await getProfileProposals();
  });

  return refs;
}
