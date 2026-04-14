<template>
  <section class="panel-card">
    <h3>Style / Method Suggestions</h3>
    <ProfileProposalCard
      v-for="item in items"
      :key="`${item.query_id}-${item.title}`"
      :title="item.title"
      :description="item.description"
      :query-id="item.query_id"
    />
  </section>
</template>

<script setup lang="ts">
import ProfileProposalCard from "@/widgets/profile/ProfileProposalCard.vue";

defineProps<{ items: Array<{ query_id: string; title: string; description: string }> }>();
</script>
