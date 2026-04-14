import { onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useEvalStore } from "@/app/stores/eval.store";
import { resolvePinia } from "@/shared/lib/guards";
import { getEvalReport, listEvalReports } from "./api";

export function useEvalReports() {
  const store = useEvalStore(resolvePinia());
  const refs = storeToRefs(store);

  onMounted(async () => {
    store.reports = await listEvalReports();
    if (store.selectedReportId) {
      store.detail = await getEvalReport(store.selectedReportId);
    }
  });

  return refs;
}
