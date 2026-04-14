<template>
  <section class="panel-card">
    <h3>提案列表</h3>
    <div class="stack">
      <button
        v-for="proposal in proposals"
        :key="proposal.query_id"
        class="ghost-button"
        @click="$emit('select', proposal.query_id)"
      >
        <ProposalCard
          :question="proposal.question"
          :target="proposal.primary_target ?? proposal.targets[0] ?? '未知'"
          :status="proposal.primary_status ?? 'pending'"
          :confidence="proposal.primary_confidence ?? 0"
        />
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import ProposalCard from "@/widgets/proposal/ProposalCard.vue";

defineProps<{ proposals: Array<Record<string, any>> }>();
defineEmits<{ select: [queryId: string] }>();
</script>
