<template>
  <div class="bottom-tray">
    <EvidenceList :evidence="evidence" />
    <MergePreviewPanel
      :target="proposalTarget"
      :content-preview="contentPreview"
      :evidence-refs="proposalEvidence"
    />
  </div>
</template>

<script setup lang="ts">
import type { EvidenceSnippet } from "@/entities/answer-record/types";
import EvidenceList from "@/widgets/evidence/EvidenceList.vue";
import MergePreviewPanel from "@/widgets/proposal/MergePreviewPanel.vue";

defineProps<{
  evidence: EvidenceSnippet[];
  proposalTarget: string;
  contentPreview: string;
  proposalEvidence: string[];
}>();
</script>
