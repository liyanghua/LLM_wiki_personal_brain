<template>
  <DetailDrawerLayout>
    <h3>{{ title }}</h3>
    <CandidateEvidencePanel :evidence-refs="sourceRefs" :wiki-refs="wikiRefs" />
    <CandidateActionBar />
  </DetailDrawerLayout>
</template>

<script setup lang="ts">
import DetailDrawerLayout from "@/app/layouts/DetailDrawerLayout.vue";
import CandidateActionBar from "@/widgets/candidate/CandidateActionBar.vue";
import CandidateEvidencePanel from "@/widgets/candidate/CandidateEvidencePanel.vue";

defineProps<{ title: string; sourceRefs: string[]; wikiRefs: string[] }>();
</script>
