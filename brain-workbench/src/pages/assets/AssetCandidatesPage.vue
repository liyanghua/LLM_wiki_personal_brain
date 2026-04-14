<template>
  <div class="page-shell">
    <AppPageHeader eyebrow="资产管理" title="资产候选" description="浏览本体与技能的候选资产（只读）。" />
    <StatePanel :loading="loading" loading-text="加载候选资产…" :error="error" :empty="ontologyCandidates.length === 0 && skillCandidates.length === 0 && !loading" empty-text="暂无候选资产">
      <div class="workbench-grid">
        <OntologyCandidatesTab :candidates="ontologyCandidates" />
        <SkillCandidatesTab :candidates="skillCandidates" />
        <CandidateDetailDrawer
          title="候选详情"
          :source-refs="ontologyCandidates[0]?.source_refs ?? skillCandidates[0]?.source_refs ?? []"
          :wiki-refs="ontologyCandidates[0]?.wiki_refs ?? skillCandidates[0]?.origin_wiki_pages ?? []"
        />
      </div>
    </StatePanel>
  </div>
</template>

<script setup lang="ts">
import AppPageHeader from "@/shared/ui/AppPageHeader.vue";
import StatePanel from "@/shared/ui/StatePanel.vue";
import { useOntologyCandidates } from "@/features/ontology/useOntologyCandidates";
import { useSkillCandidates } from "@/features/skills/useSkillCandidates";
import CandidateDetailDrawer from "./CandidateDetailDrawer.vue";
import OntologyCandidatesTab from "./OntologyCandidatesTab.vue";
import SkillCandidatesTab from "./SkillCandidatesTab.vue";

const { ontologyCandidates, loading, error } = useOntologyCandidates();
const { skillCandidates } = useSkillCandidates();
</script>
