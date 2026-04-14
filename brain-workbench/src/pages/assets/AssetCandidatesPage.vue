<template>
  <div class="page-shell">
    <AppPageHeader eyebrow="Assets" title="Asset Candidates" description="审阅 ontology 与 skills 的候选资产。" />
    <div class="workbench-grid">
      <OntologyCandidatesTab :candidates="ontologyCandidates" />
      <SkillCandidatesTab :candidates="skillCandidates" />
      <CandidateDetailDrawer
        title="Candidates Detail"
        :source-refs="ontologyCandidates[0]?.source_refs ?? skillCandidates[0]?.source_refs ?? []"
        :wiki-refs="ontologyCandidates[0]?.wiki_refs ?? skillCandidates[0]?.origin_wiki_pages ?? []"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import AppPageHeader from "@/shared/ui/AppPageHeader.vue";
import { useOntologyCandidates } from "@/features/ontology/useOntologyCandidates";
import { useSkillCandidates } from "@/features/skills/useSkillCandidates";
import CandidateDetailDrawer from "./CandidateDetailDrawer.vue";
import OntologyCandidatesTab from "./OntologyCandidatesTab.vue";
import SkillCandidatesTab from "./SkillCandidatesTab.vue";

const { ontologyCandidates } = useOntologyCandidates();
const { skillCandidates } = useSkillCandidates();
</script>
