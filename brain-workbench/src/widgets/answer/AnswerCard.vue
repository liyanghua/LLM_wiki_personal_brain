<template>
  <section class="widget-card">
    <h3>Structured Answer</h3>
    <AnswerSections :sections="sections" />
  </section>
</template>

<script setup lang="ts">
import type { AnswerSectionView } from "@/features/query/model";
import AnswerSections from "./AnswerSections.vue";

defineProps<{ sections: AnswerSectionView[] }>();
</script>
