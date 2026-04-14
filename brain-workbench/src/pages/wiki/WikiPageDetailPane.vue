<template>
  <section class="panel-card stack">
    <h3>{{ detail.title }}</h3>
    <p>{{ detail.summary }}</p>
    <WikiLinkList title="关联页面" :links="detail.linked_pages ?? []" />
    <WikiLinkList title="反向链接" :links="backlinks" />
    <WikiMarkdownViewer :source="detail.markdown ?? ''" />
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import WikiLinkList from "@/widgets/wiki/WikiLinkList.vue";
import WikiMarkdownViewer from "@/widgets/wiki/WikiMarkdownViewer.vue";

const props = defineProps<{ detail: Record<string, any> }>();
const backlinks = computed(() => (props.detail.backlinks ?? []).map((item: string) => ({ path: item, title: item })));
</script>
