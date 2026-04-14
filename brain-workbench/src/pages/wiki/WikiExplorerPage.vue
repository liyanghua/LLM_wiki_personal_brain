<template>
  <div class="page-shell">
    <AppPageHeader eyebrow="Wiki" title="Wiki Explorer" description="浏览 page type、页面详情、links 和 backlinks。" />
    <div class="workbench-grid">
      <WikiTypeTreePane :tree="tree" />
      <WikiPageListPane :pages="pages" @select="selectPage" />
      <WikiPageDetailPane :detail="detail" />
    </div>
  </div>
</template>

<script setup lang="ts">
import AppPageHeader from "@/shared/ui/AppPageHeader.vue";
import { useWikiExplorer } from "@/features/wiki/useWikiExplorer";
import WikiPageDetailPane from "./WikiPageDetailPane.vue";
import WikiPageListPane from "./WikiPageListPane.vue";
import WikiTypeTreePane from "./WikiTypeTreePane.vue";

const { tree, pages, detail, selectPage } = useWikiExplorer();
</script>
