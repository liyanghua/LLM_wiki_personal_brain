<template>
  <section class="widget-card">
    <h3>Markdown</h3>
    <MarkdownRenderer :source="source" />
  </section>
</template>

<script setup lang="ts">
import MarkdownRenderer from "@/shared/ui/MarkdownRenderer.vue";

defineProps<{ source: string }>();
</script>
