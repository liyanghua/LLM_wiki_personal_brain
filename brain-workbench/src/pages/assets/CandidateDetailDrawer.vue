<template>
  <DetailDrawerLayout>
    <h3>{{ title }}</h3>
    <CandidateEvidencePanel :evidence-refs="sourceRefs" :wiki-refs="wikiRefs" />
    <p class="empty-state">候选资产仅供浏览，暂不支持在线操作。</p>
  </DetailDrawerLayout>
</template>

<script setup lang="ts">
import DetailDrawerLayout from "@/app/layouts/DetailDrawerLayout.vue";
import CandidateEvidencePanel from "@/widgets/candidate/CandidateEvidencePanel.vue";

defineProps<{ title: string; sourceRefs: string[]; wikiRefs: string[] }>();
</script>
