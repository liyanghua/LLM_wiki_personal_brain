<template>
  <section class="widget-card">
    <h3>Eval Summary</h3>
    <div class="metric-grid">
      <EvalMetricBadge v-for="item in metrics" :key="item.label" :label="item.label" :score="item.score" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import EvalMetricBadge from "./EvalMetricBadge.vue";

const props = defineProps<{ metrics: Record<string, number> }>();
const metrics = computed(() => Object.entries(props.metrics).map(([label, score]) => ({ label, score })));
</script>
