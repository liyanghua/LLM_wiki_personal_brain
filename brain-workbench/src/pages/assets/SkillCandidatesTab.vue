<template>
  <section class="panel-card">
    <h3>技能候选</h3>
    <div class="stack">
      <CandidateCard
        v-for="item in candidates"
        :key="item.skill_id"
        :title="item.title"
        :summary="item.summary"
        :type="item.family"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import CandidateCard from "@/widgets/candidate/CandidateCard.vue";

defineProps<{ candidates: Array<Record<string, any>> }>();
</script>
