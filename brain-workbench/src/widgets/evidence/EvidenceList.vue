<template>
  <section class="widget-card">
    <h3>Evidence</h3>
    <EvidenceSnippetCard
      v-for="item in evidence"
      :key="`${item.page_id}-${item.snippet}`"
      :title="item.page_title"
      :snippet="item.snippet"
      :source-refs="item.source_refs"
    />
  </section>
</template>

<script setup lang="ts">
import type { EvidenceSnippet } from "@/entities/answer-record/types";
import EvidenceSnippetCard from "./EvidenceSnippetCard.vue";

defineProps<{ evidence: EvidenceSnippet[] }>();
</script>
