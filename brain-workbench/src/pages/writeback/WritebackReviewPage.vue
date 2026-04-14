<template>
  <div class="page-shell">
    <AppPageHeader eyebrow="Review" title="Writeback Review" description="审阅可沉淀的高价值解释、决策与原则。" />
    <div class="workbench-grid">
      <WritebackProposalListPane :proposals="proposals" @select="select" />
      <WritebackProposalDetailPane :detail="detail" @approve="approve" />
      <section class="panel-card">
        <h3>Rationale</h3>
        <p>{{ detail.targets[0]?.rationale }}</p>
        <p>Confidence: {{ detail.targets[0]?.confidence?.toFixed(2) }}</p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppPageHeader from "@/shared/ui/AppPageHeader.vue";
import { useWritebackReview } from "@/features/writeback/useWritebackReview";
import WritebackProposalDetailPane from "./WritebackProposalDetailPane.vue";
import WritebackProposalListPane from "./WritebackProposalListPane.vue";

const { proposals, detail, select, approve } = useWritebackReview();
</script>
