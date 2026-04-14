<template>
  <section class="widget-card">
    <h3>Citations</h3>
    <div class="chip-row">
      <span v-for="item in citations" :key="item" class="chip">{{ item }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{ citations: string[] }>();
</script>
