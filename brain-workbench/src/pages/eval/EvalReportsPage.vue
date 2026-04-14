<template>
  <div class="page-shell">
    <AppPageHeader eyebrow="质量评估" title="评估看板" description="观察资产质量、沉淀精度与方法一致性。" />
    <StatePanel :loading="loading" loading-text="加载评估报告…" :error="error" :empty="reports.length === 0 && !loading" empty-text="暂无评估报告" :on-retry="reload">
      <div class="workbench-grid">
        <EvalReportListPane :reports="reports" @select="selectReport" />
        <EvalReportDetailPane :detail="detail" />
        <EvalMetricsChartPanel :trend="trend" />
      </div>
    </StatePanel>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import AppPageHeader from "@/shared/ui/AppPageHeader.vue";
import StatePanel from "@/shared/ui/StatePanel.vue";
import { useEvalReports } from "@/features/eval/useEvalReports";
import EvalMetricsChartPanel from "./EvalMetricsChartPanel.vue";
import EvalReportDetailPane from "./EvalReportDetailPane.vue";
import EvalReportListPane from "./EvalReportListPane.vue";

const { reports, detail, loading, error, selectReport, reload } = useEvalReports();
const trend = computed(() =>
  reports.value.map((item) => ({
    date: item.created_at,
    ...item.metrics,
  })),
);
</script>
