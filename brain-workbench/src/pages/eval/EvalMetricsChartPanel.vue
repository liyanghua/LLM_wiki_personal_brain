<template>
  <EvalTrendChart :title="'方法一致性趋势'" :trend="trend" metric="method_consistency" />
</template>

<script setup lang="ts">
import EvalTrendChart from "@/widgets/eval/EvalTrendChart.vue";

defineProps<{ trend: Array<Record<string, number | string>> }>();
</script>
