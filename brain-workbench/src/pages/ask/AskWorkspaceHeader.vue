<template>
  <div class="ask-header">
    <AppPageHeader
      eyebrow="分析工作区"
      title="问题分析"
      description="基于知识库进行深度分析，生成结构化结论与沉淀建议。"
    />
    <div class="ask-header__modes">
      <button
        type="button"
        class="mode-toggle"
        :class="{ 'mode-toggle--active': mode === 'extraction' }"
        @click="$emit('switch-mode', 'extraction')"
      >
        Extraction Interview
      </button>
      <button
        type="button"
        class="mode-toggle"
        :class="{ 'mode-toggle--active': mode === 'quick' }"
        @click="$emit('switch-mode', 'quick')"
      >
        Quick Answer
      </button>
    </div>
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

.ask-header__modes {
  display: inline-flex;
  gap: 10px;
  padding: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
}

.mode-toggle {
  border: none;
  border-radius: 999px;
  padding: 10px 14px;
  background: transparent;
  color: var(--wb-text-muted);
  cursor: pointer;
  transition:
    background 0.2s ease,
    color 0.2s ease,
    transform 0.2s ease;
}

.mode-toggle--active {
  background: rgba(94, 234, 212, 0.12);
  color: var(--wb-text-primary);
  transform: translateY(-1px);
}
</style>
