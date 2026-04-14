<template>
  <section class="widget-card">
    <h3>{{ title }}</h3>
    <div class="chip-row">
      <span v-for="item in links" :key="item.path" class="chip">{{ item.title }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{ title: string; links: Array<{ path: string; title: string }> }>();
</script>
