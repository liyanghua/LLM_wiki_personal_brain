<template>
  <article class="list-card">
    <strong>{{ label }}</strong>
    <p>{{ score.toFixed(2) }}</p>
  </article>
</template>

<script setup lang="ts">
defineProps<{ label: string; score: number }>();
</script>
