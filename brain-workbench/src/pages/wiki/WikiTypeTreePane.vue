<template>
  <section class="panel-card">
    <h3>分类导航</h3>
    <div class="stack">
      <div v-for="item in tree" :key="item.page_type" class="list-card">
        <strong>{{ item.page_type }}</strong>
        <p>{{ item.count }} 个页面</p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{ tree: Array<Record<string, any>> }>();
</script>
