<template>
  <section class="panel-card">
    <h3>Page Type Tree</h3>
    <div class="stack">
      <div v-for="item in tree" :key="item.page_type" class="list-card">
        <strong>{{ item.page_type }}</strong>
        <p>{{ item.count }} pages</p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{ tree: Array<Record<string, any>> }>();
</script>
