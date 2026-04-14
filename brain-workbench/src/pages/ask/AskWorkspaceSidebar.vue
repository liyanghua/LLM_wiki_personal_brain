<template>
  <section class="panel-card">
    <h3>Recent Queries</h3>
    <div class="stack">
      <div v-for="item in recentQueries" :key="item.query_id" class="list-card">
        <strong>{{ item.question }}</strong>
        <p>{{ item.summary }}</p>
      </div>
    </div>
    <h3>Quick Topics</h3>
    <div class="chip-row">
      <span v-for="item in topics" :key="item" class="chip">{{ item }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  recentQueries: Array<{ query_id: string; question: string; summary: string }>;
  topics: string[];
}>();
</script>
