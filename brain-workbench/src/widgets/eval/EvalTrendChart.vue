<template>
  <section class="widget-card">
    <h3>{{ title }}</h3>
    <v-chart class="chart-frame" :option="option" autoresize />
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import VChart from "vue-echarts";
import { buildMetricSeries } from "@/shared/lib/chart";

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent]);

const props = defineProps<{ title: string; trend: Array<Record<string, number | string>>; metric: string }>();
const option = computed(() => buildMetricSeries(props.trend, props.metric));
</script>
