<template>
  <div class="ask-header">
    <AppPageHeader
      eyebrow="Expert Brain Studio"
      title="交互式问答 Agent"
      description="一个主动推进、实时理解、轻量修正的知识访谈引擎。"
    />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  mode: "extraction" | "quick";
}>();

defineEmits<{
  (event: "switch-mode", mode: "extraction" | "quick"): void;
}>();

import AppPageHeader from "@/shared/ui/AppPageHeader.vue";
</script>

<style scoped>
.ask-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
</style>
