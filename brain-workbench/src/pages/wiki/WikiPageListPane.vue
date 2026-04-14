<template>
  <section class="panel-card">
    <h3>知识页面</h3>
    <div class="stack">
      <button
        v-for="page in pages"
        :key="page.page_id"
        class="ghost-button"
        @click="$emit('select', page.page_id)"
      >
        <WikiPageCard :title="page.title" :summary="page.summary" :path="page.path" />
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import WikiPageCard from "@/widgets/wiki/WikiPageCard.vue";

defineProps<{ pages: Array<Record<string, any>> }>();
defineEmits<{ select: [pageId: string] }>();
</script>
