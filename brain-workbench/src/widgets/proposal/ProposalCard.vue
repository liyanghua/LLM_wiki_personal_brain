<template>
  <article class="list-card">
    <div class="action-row">
      <strong>{{ question }}</strong>
      <ProposalStatusTag :status="status" />
    </div>
    <p>{{ target }}</p>
    <small>{{ confidence.toFixed(2) }}</small>
  </article>
</template>

<script setup lang="ts">
import ProposalStatusTag from "./ProposalStatusTag.vue";

defineProps<{ question: string; target: string; status: string; confidence: number }>();
</script>
