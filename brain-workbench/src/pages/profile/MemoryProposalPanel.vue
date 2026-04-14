<template>
  <section class="panel-card">
    <h3>长期记忆建议</h3>
    <ProfileProposalCard
      v-for="item in items"
      :key="`${item.query_id}-${item.key}`"
      :title="item.key"
      :description="item.rationale"
      :query-id="item.query_id"
    />
  </section>
</template>

<script setup lang="ts">
import ProfileProposalCard from "@/widgets/profile/ProfileProposalCard.vue";

defineProps<{ items: Array<Record<string, string>> }>();
</script>
