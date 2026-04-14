<template>
  <article class="list-card">
    <strong>{{ title }}</strong>
    <p>{{ snippet }}</p>
    <div class="chip-row">
      <span v-for="item in sourceRefs" :key="item" class="chip">{{ item }}</span>
    </div>
  </article>
</template>

<script setup lang="ts">
defineProps<{ title: string; snippet: string; sourceRefs: string[] }>();
</script>
