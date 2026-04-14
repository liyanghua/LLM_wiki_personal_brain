<template>
  <div class="loading-panel">{{ label }}</div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ label?: string }>(), {
  label: "Loading...",
});
</script>
