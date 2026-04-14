<template>
  <div class="page-shell">
    <AppPageHeader eyebrow="Eval" title="Eval Reports" description="观察 asset quality、writeback precision 与方法一致性。" />
    <div class="workbench-grid">
      <EvalReportListPane :reports="reports" @select="selectReport" />
      <EvalReportDetailPane :detail="detail" />
      <EvalMetricsChartPanel :trend="trend" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import AppPageHeader from "@/shared/ui/AppPageHeader.vue";
import { useEvalReports } from "@/features/eval/useEvalReports";
import EvalMetricsChartPanel from "./EvalMetricsChartPanel.vue";
import EvalReportDetailPane from "./EvalReportDetailPane.vue";
import EvalReportListPane from "./EvalReportListPane.vue";

const { reports, detail } = useEvalReports();
const trend = computed(() =>
  reports.value.map((item) => ({
    date: item.created_at,
    ...item.metrics,
  })),
);

function selectReport() {
  // TODO(BACKEND_ENDPOINT_BINDING): bind report selection and detail refetch for historical reports.
}
</script>
