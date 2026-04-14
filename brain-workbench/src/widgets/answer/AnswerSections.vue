<template>
  <div class="section-grid">
    <article v-for="section in sections" :key="section.title" class="list-card">
      <h4>{{ section.title }}</h4>
      <p>{{ section.body }}</p>
    </article>
  </div>
</template>

<script setup lang="ts">
import type { AnswerSectionView } from "@/features/query/model";

defineProps<{ sections: AnswerSectionView[] }>();
</script>
