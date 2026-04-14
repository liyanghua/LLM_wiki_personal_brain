<template>
  <div class="page-shell">
    <AskWorkspaceHeader />
    <div class="workbench-grid workbench-grid--wide">
      <AskWorkspaceSidebar
        :recent-queries="recentMemory.recent_queries"
        :topics="recentMemory.persistent_interests"
      />
      <section class="page-card stack">
        <div class="action-row">
          <n-input v-model:value="questionDraft" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" />
          <n-button type="primary" @click="submit(questionDraft)">Ask</n-button>
        </div>
        <AnswerCard :sections="sections" />
        <CitationList :citations="result.ranked_pages" />
      </section>
      <section class="page-card stack">
        <QueryTracePanel
          :question-type="result.question_classification.question_type"
          :cues="result.question_classification.cues"
        />
        <RetrievedPagesList :pages="result.ranked_pages" />
        <KeyValueList
          :items="[
            { key: 'Method Profile', value: result.method_profile_id },
            { key: 'Template', value: result.template_id },
            { key: 'Open Loops', value: result.recalled_memory.open_loops.join(' | ') || 'none' },
          ]"
        />
      </section>
    </div>
    <AskWorkspaceTray
      :evidence="result.selected_evidence"
      :proposal-target="result.writeback_plan?.targets[0]?.target ?? 'none'"
      :content-preview="result.writeback_plan?.targets[0]?.content_preview ?? 'No preview yet.'"
      :proposal-evidence="result.writeback_plan?.targets[0]?.evidence_refs ?? []"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { NButton, NInput } from "naive-ui";
import { useAskWorkspace } from "@/features/query/useAskWorkspace";
import KeyValueList from "@/shared/ui/KeyValueList.vue";
import AnswerCard from "@/widgets/answer/AnswerCard.vue";
import CitationList from "@/widgets/answer/CitationList.vue";
import QueryTracePanel from "@/widgets/answer/QueryTracePanel.vue";
import RetrievedPagesList from "@/widgets/evidence/RetrievedPagesList.vue";
import AskWorkspaceHeader from "./AskWorkspaceHeader.vue";
import AskWorkspaceSidebar from "./AskWorkspaceSidebar.vue";
import AskWorkspaceTray from "./AskWorkspaceTray.vue";

const { currentQuestion, result, recentMemory, sections, submit } = useAskWorkspace();
const questionDraft = ref(currentQuestion.value);

watch(currentQuestion, (value) => {
  questionDraft.value = value;
});
</script>
