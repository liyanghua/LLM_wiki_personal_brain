<template>
  <section class="panel-card">
    <h3>最近分析</h3>
    <div class="stack">
      <div v-if="recentQueries.length === 0" class="empty-state">暂无最近分析记录</div>
      <div v-for="item in recentQueries" :key="item.query_id" class="list-card">
        <strong>{{ item.question }}</strong>
        <p>{{ item.summary }}</p>
      </div>
    </div>
    <h3>高频主题</h3>
    <div class="chip-row">
      <span v-if="topics.length === 0" class="empty-state">暂无高频主题</span>
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
