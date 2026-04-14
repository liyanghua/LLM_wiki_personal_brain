<template>
  <div v-if="loading" class="loading-panel">
    <n-spin size="small" />
    <span>{{ loadingText }}</span>
  </div>
  <div v-else-if="error" class="error-panel">
    <p class="error-panel__title">请求失败</p>
    <p class="error-panel__message">{{ error }}</p>
    <n-button v-if="onRetry" size="small" @click="onRetry">重试</n-button>
  </div>
  <div v-else-if="empty" class="empty-state">
    <p>{{ emptyText }}</p>
  </div>
  <slot v-else />
</template>

<script setup lang="ts">
import { NSpin, NButton } from "naive-ui";

defineProps<{
  loading?: boolean;
  error?: string;
  empty?: boolean;
  loadingText?: string;
  emptyText?: string;
  onRetry?: () => void;
}>();
</script>

<style scoped>
.loading-panel {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 24px;
  color: var(--wb-text-muted);
}
.error-panel {
  border: 1px solid rgba(220, 80, 80, 0.3);
  border-radius: 14px;
  padding: 20px;
  background: rgba(220, 80, 80, 0.06);
}
.error-panel__title {
  color: #e07070;
  font-weight: 600;
  margin: 0 0 6px;
}
.error-panel__message {
  color: var(--wb-text-muted);
  margin: 0 0 12px;
  font-size: 0.88rem;
}
</style>
