<template>
  <span class="status-badge" :data-tone="tone">{{ label }}</span>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string;
    tone?: "neutral" | "success" | "warning";
  }>(),
  { tone: "neutral" },
);
</script>
