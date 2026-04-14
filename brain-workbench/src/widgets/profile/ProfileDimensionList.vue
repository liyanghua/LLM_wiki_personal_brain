<template>
  <div class="stack">
    <div v-for="item in items" :key="item.key" class="list-card">
      <strong>{{ item.key }}</strong>
      <p>{{ item.value }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ items: Array<{ key: string; value: string }> }>();
</script>
