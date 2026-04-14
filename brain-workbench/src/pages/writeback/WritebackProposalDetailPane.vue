<template>
  <section class="panel-card stack">
    <h3>沉淀详情</h3>
    <p>{{ detail.question }}</p>
    <ProposalStatusTag :status="detail.targets[0]?.approval_status ?? 'pending'" />
    <div class="chip-row">
      <ProposalTargetTag v-for="item in detail.targets" :key="item.target" :target="item.target" />
    </div>
    <MergePreviewPanel
      :target="detail.targets[0]?.target ?? '未知'"
      :content-preview="detail.targets[0]?.content_preview ?? '暂无预览'"
      :evidence-refs="detail.targets[0]?.evidence_refs ?? []"
    />
    <div class="action-row">
      <button class="primary-button" @click="$emit('approve')">批准沉淀</button>
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
