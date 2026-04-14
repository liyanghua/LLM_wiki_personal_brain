import { onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useEvalStore } from "@/app/stores/eval.store";
import { resolvePinia } from "@/shared/lib/guards";
import { getEvalReport, listEvalReports } from "./api";

export function useEvalReports() {
  const store = useEvalStore(resolvePinia());
  const refs = storeToRefs(store);

  async function load() {
    store.loading = true;
    store.error = "";
    try {
      store.reports = await listEvalReports();
      if (store.reports.length > 0) {
        store.selectedReportId = store.reports[0].run_id;
        store.detail = await getEvalReport(store.selectedReportId);
      }
    } catch (e: any) {
      store.error = e?.message || "加载评估报告失败";
    } finally {
      store.loading = false;
    }
  }

  async function selectReport(runId: string) {
    store.selectedReportId = runId;
    try {
      store.detail = await getEvalReport(runId);
    } catch (e: any) {
      store.error = e?.message || "加载报告详情失败";
    }
  }

  onMounted(load);

  return { ...refs, selectReport, reload: load };
}
