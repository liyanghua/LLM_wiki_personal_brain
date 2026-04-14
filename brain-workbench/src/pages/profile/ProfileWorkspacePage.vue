<template>
  <div class="page-shell">
    <AppPageHeader eyebrow="Profile" title="Profile Workspace" description="查看 method profile、persistent memory 与更新建议。" />
    <div class="workbench-grid">
      <MethodProfilePanel :profile="methodProfile" />
      <StyleProposalPanel :items="methodItems" />
      <MemoryProposalPanel :items="proposals.persistent_memory_proposals" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import AppPageHeader from "@/shared/ui/AppPageHeader.vue";
import { useProfileWorkspace } from "@/features/profile/useProfileWorkspace";
import MemoryProposalPanel from "./MemoryProposalPanel.vue";
import MethodProfilePanel from "./MethodProfilePanel.vue";
import StyleProposalPanel from "./StyleProposalPanel.vue";

const { methodProfile, proposals } = useProfileWorkspace();
const methodItems = computed(() => [
  ...proposals.value.method_suggestions.map((item: { query_id: string; field_name: string; rationale: string }) => ({
    query_id: item.query_id,
    title: item.field_name,
    description: item.rationale,
  })),
  ...proposals.value.style_suggestions.map((item: { query_id: string; rationale: string }) => ({
    query_id: item.query_id,
    title: "style_update",
    description: item.rationale,
  })),
]);
</script>
