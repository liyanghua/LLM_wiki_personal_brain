import { onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useWritebackStore } from "@/app/stores/writeback.store";
import { resolvePinia } from "@/shared/lib/guards";
import { approveWritebackProposal, getWritebackProposal, listWritebackProposals } from "./api";

export function useWritebackReview() {
  const store = useWritebackStore(resolvePinia());
  const refs = storeToRefs(store);

  async function refresh() {
    store.loading = true;
    store.error = "";
    try {
      const listPayload = await listWritebackProposals();
      store.proposals = (listPayload as any).proposals ?? [];
      if (store.selectedQueryId) {
        store.detail = await getWritebackProposal(store.selectedQueryId);
      }
    } catch (e: any) {
      store.error = e?.message || "加载沉淀提案失败";
    } finally {
      store.loading = false;
    }
  }

  async function select(queryId: string) {
    store.selectedQueryId = queryId;
    try {
      store.detail = await getWritebackProposal(queryId);
    } catch (e: any) {
      store.error = e?.message || "加载提案详情失败";
    }
  }

  async function approve() {
    if (!store.selectedQueryId) return;
    try {
      store.detail = await approveWritebackProposal(store.selectedQueryId);
    } catch (e: any) {
      store.error = e?.message || "审批操作失败";
    }
  }

  onMounted(refresh);

  return { ...refs, refresh, select, approve };
}
