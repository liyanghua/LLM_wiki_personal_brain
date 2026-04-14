<template>
  <div class="page-shell">
    <AppPageHeader eyebrow="画像管理" title="分析画像" description="查看方法偏好、长期记忆与风格/方法更新建议。" />
    <StatePanel :loading="loading" loading-text="加载分析画像…" :error="error" :on-retry="reload">
      <div class="workbench-grid">
        <MethodProfilePanel :profile="methodProfile" />
        <StyleProposalPanel :items="methodItems" />
        <MemoryProposalPanel :items="proposals.persistent_memory_proposals" />
      </div>
    </StatePanel>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import AppPageHeader from "@/shared/ui/AppPageHeader.vue";
import StatePanel from "@/shared/ui/StatePanel.vue";
import { useProfileWorkspace } from "@/features/profile/useProfileWorkspace";
import MemoryProposalPanel from "./MemoryProposalPanel.vue";
import MethodProfilePanel from "./MethodProfilePanel.vue";
import StyleProposalPanel from "./StyleProposalPanel.vue";

const { methodProfile, proposals, loading, error, reload } = useProfileWorkspace();
const methodItems = computed(() => [
  ...(proposals.value.method_suggestions ?? []).map((item: { query_id: string; field_name: string; rationale: string }) => ({
    query_id: item.query_id,
    title: item.field_name,
    description: item.rationale,
  })),
  ...(proposals.value.style_suggestions ?? []).map((item: { query_id: string; rationale: string }) => ({
    query_id: item.query_id,
    title: "风格更新",
    description: item.rationale,
  })),
]);
</script>
