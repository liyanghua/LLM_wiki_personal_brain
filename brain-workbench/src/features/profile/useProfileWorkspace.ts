import { onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useProfileStore } from "@/app/stores/profile.store";
import { resolvePinia } from "@/shared/lib/guards";
import { getMethodProfile, getPersistentMemory, getProfileProposals } from "./api";

export function useProfileWorkspace() {
  const store = useProfileStore(resolvePinia());
  const refs = storeToRefs(store);

  async function load() {
    store.loading = true;
    store.error = "";
    try {
      const [profile, memory, proposals] = await Promise.all([
        getMethodProfile(),
        getPersistentMemory(),
        getProfileProposals(),
      ]);
      store.methodProfile = profile;
      store.persistentMemory = memory as Record<string, unknown>;
      store.proposals = proposals as Record<string, any>;
    } catch (e: any) {
      store.error = e?.message || "加载分析画像失败";
    } finally {
      store.loading = false;
    }
  }

  onMounted(load);

  return { ...refs, reload: load };
}
