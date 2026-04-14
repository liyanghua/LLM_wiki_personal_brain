import { onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useWritebackStore } from "@/app/stores/writeback.store";
import { resolvePinia } from "@/shared/lib/guards";
import { approveWritebackProposal, getWritebackProposal, listWritebackProposals } from "./api";

export function useWritebackReview() {
  const store = useWritebackStore(resolvePinia());
  const refs = storeToRefs(store);

  async function refresh() {
    const listPayload = await listWritebackProposals();
    store.proposals = listPayload.proposals;
    if (store.selectedQueryId) {
      store.detail = await getWritebackProposal(store.selectedQueryId);
    }
  }

  async function select(queryId: string) {
    store.selectedQueryId = queryId;
    store.detail = await getWritebackProposal(queryId);
  }

  async function approve() {
    if (!store.selectedQueryId) return;
    store.detail = await approveWritebackProposal(store.selectedQueryId);
  }

  onMounted(refresh);

  return { ...refs, refresh, select, approve };
}
