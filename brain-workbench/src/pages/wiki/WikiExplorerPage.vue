<template>
  <div class="page-shell">
    <AppPageHeader eyebrow="知识库" title="知识地图" description="按分类浏览知识页面，查看详情、关联与反向链接。" />
    <StatePanel :loading="loading" loading-text="加载知识地图…" :error="error" :empty="pages.length === 0 && !loading" empty-text="知识库暂无页面" :on-retry="reload">
      <div class="workbench-grid">
        <WikiTypeTreePane :tree="tree" />
        <WikiPageListPane :pages="pages" @select="selectPage" />
        <WikiPageDetailPane :detail="detail" />
      </div>
    </StatePanel>
  </div>
</template>

<script setup lang="ts">
import AppPageHeader from "@/shared/ui/AppPageHeader.vue";
import StatePanel from "@/shared/ui/StatePanel.vue";
import { useWikiExplorer } from "@/features/wiki/useWikiExplorer";
import WikiPageDetailPane from "./WikiPageDetailPane.vue";
import WikiPageListPane from "./WikiPageListPane.vue";
import WikiTypeTreePane from "./WikiTypeTreePane.vue";

const { tree, pages, detail, loading, error, selectPage, reload } = useWikiExplorer();
</script>
