<template>
  <article class="markdown-renderer" v-html="html"></article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

const props = defineProps<{ source: string }>();
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

const html = computed(() => DOMPurify.sanitize(markdown.render(props.source || "")));
</script>
