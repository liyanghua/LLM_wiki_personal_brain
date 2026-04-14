<template>
  <section class="widget-card">
    <h3>Retrieved Pages</h3>
    <div class="stack">
      <div v-for="page in pages" :key="page" class="list-card">{{ page }}</div>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{ pages: string[] }>();
</script>
