<template>
  <article class="list-card">
    <strong>{{ title }}</strong>
    <p>{{ description }}</p>
    <small>{{ queryId }}</small>
  </article>
</template>

<script setup lang="ts">
defineProps<{ title: string; description: string; queryId: string }>();
</script>
