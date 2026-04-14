<template>
  <section class="panel-card">
    <h3>Ontology Candidates</h3>
    <div class="stack">
      <CandidateCard
        v-for="item in candidates"
        :key="item.candidate_id"
        :title="item.canonical_name"
        :summary="item.summary"
        :type="item.candidate_type"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import CandidateCard from "@/widgets/candidate/CandidateCard.vue";

defineProps<{ candidates: Array<Record<string, any>> }>();
</script>
