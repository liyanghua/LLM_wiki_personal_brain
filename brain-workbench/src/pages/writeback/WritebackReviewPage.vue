<template>
  <div class="page-shell">
    <AppPageHeader eyebrow="知识管理" title="知识沉淀" description="审阅可沉淀的高价值解释、决策与原则。" />
    <StatePanel :loading="loading" loading-text="加载沉淀提案…" :error="error" :empty="proposals.length === 0 && !loading" empty-text="暂无待审阅的沉淀提案" :on-retry="refresh">
      <div class="workbench-grid">
        <WritebackProposalListPane :proposals="proposals" @select="select" />
        <WritebackProposalDetailPane :detail="detail" @approve="approve" />
        <section class="panel-card">
          <h3>沉淀依据</h3>
          <p>{{ detail.targets[0]?.rationale || '暂无' }}</p>
          <p>置信度: {{ detail.targets[0]?.confidence ? detail.targets[0].confidence.toFixed(2) : '-' }}</p>
        </section>
      </div>
    </StatePanel>
  </div>
</template>

<script setup lang="ts">
import AppPageHeader from "@/shared/ui/AppPageHeader.vue";
import StatePanel from "@/shared/ui/StatePanel.vue";
import { useWritebackReview } from "@/features/writeback/useWritebackReview";
import WritebackProposalDetailPane from "./WritebackProposalDetailPane.vue";
import WritebackProposalListPane from "./WritebackProposalListPane.vue";

const { proposals, detail, loading, error, select, approve, refresh } = useWritebackReview();
</script>
