<template>
  <section class="panel-card stack">
    <EvalSummaryCard :metrics="detail.metrics" />
    <div class="stack">
      <div v-for="item in detail.case_results" :key="item.case_id" class="list-card">
        <strong>{{ item.question }}</strong>
        <p>{{ item.explanation }}</p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import EvalSummaryCard from "@/widgets/eval/EvalSummaryCard.vue";

defineProps<{ detail: Record<string, any> }>();
</script>
