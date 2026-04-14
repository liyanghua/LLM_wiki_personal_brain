<template>
  <article class="list-card">
    <strong>{{ title }}</strong>
    <p>{{ summary }}</p>
    <small>{{ path }}</small>
  </article>
</template>

<script setup lang="ts">
defineProps<{ title: string; summary: string; path: string }>();
</script>
