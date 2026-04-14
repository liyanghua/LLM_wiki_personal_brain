<template>
  <section class="panel-card stack">
    <h3>Writeback Detail</h3>
    <p>{{ detail.question }}</p>
    <ProposalStatusTag :status="detail.targets[0]?.approval_status ?? 'pending'" />
    <div class="chip-row">
      <ProposalTargetTag v-for="item in detail.targets" :key="item.target" :target="item.target" />
    </div>
    <MergePreviewPanel
      :target="detail.targets[0]?.target ?? 'unknown'"
      :content-preview="detail.targets[0]?.content_preview ?? 'no preview'"
      :evidence-refs="detail.targets[0]?.evidence_refs ?? []"
    />
    <div class="action-row">
      <button class="primary-button" @click="$emit('approve')">Approve</button>
      <button class="ghost-button" disabled title="TODO(BACKEND_ENDPOINT_BINDING)">Reject</button>
      <button class="ghost-button" disabled title="TODO(BACKEND_ENDPOINT_BINDING)">Edit</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import MergePreviewPanel from "@/widgets/proposal/MergePreviewPanel.vue";
import ProposalStatusTag from "@/widgets/proposal/ProposalStatusTag.vue";
import ProposalTargetTag from "@/widgets/proposal/ProposalTargetTag.vue";

defineProps<{ detail: Record<string, any> }>();
defineEmits<{ approve: [] }>();
</script>
