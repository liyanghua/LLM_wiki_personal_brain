import { onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useAssetsStore } from "@/app/stores/assets.store";
import { resolvePinia } from "@/shared/lib/guards";
import { listSkillCandidates } from "./api";

export function useSkillCandidates() {
  const store = useAssetsStore(resolvePinia());
  const refs = storeToRefs(store);

  onMounted(async () => {
    try {
      store.skillCandidates = await listSkillCandidates();
    } catch (e: any) {
      if (!store.error) {
        store.error = e?.message || "加载技能候选失败";
      }
    }
  });

  return refs;
}
