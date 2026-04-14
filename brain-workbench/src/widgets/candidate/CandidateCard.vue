<template>
  <article class="list-card">
    <div class="action-row">
      <strong>{{ title }}</strong>
      <CandidateTypeTag :type="type" />
    </div>
    <p>{{ summary }}</p>
  </article>
</template>

<script setup lang="ts">
import CandidateTypeTag from "./CandidateTypeTag.vue";

defineProps<{ title: string; summary: string; type: string }>();
</script>
