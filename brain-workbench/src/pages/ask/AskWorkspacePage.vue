<template>
  <div class="page-shell">
    <AskWorkspaceHeader :mode="mode" @switch-mode="switchMode" />
    <div class="workbench-grid workbench-grid--wide">
      <AskWorkspaceSidebar
        :recent-queries="recentMemory.recent_queries"
        :topics="recentMemory.persistent_interests"
      />
      <section class="page-card stack">
        <template v-if="mode === 'quick'">
          <div class="action-row">
            <n-input
              v-model:value="questionDraft"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 4 }"
              placeholder="输入要分析的问题…"
            />
            <n-button type="primary" :loading="loading" @click="submitQuick(questionDraft)">
              快速分析
            </n-button>
          </div>
          <StatePanel
            :loading="loading"
            loading-text="正在分析…"
            :error="error"
            :empty="!quickResult.query_id && !loading"
          >
            <template #default>
              <AnswerCard :sections="quickSections" />
              <CitationList :citations="quickResult.ranked_pages" />
            </template>
          </StatePanel>
        </template>
        <template v-else>
          <div class="action-row">
            <n-input
              v-model:value="questionDraft"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 4 }"
              placeholder="输入根问题，启动交互式采掘…"
            />
            <n-button type="primary" :loading="loading" @click="startExtraction(questionDraft)">
              开始采掘
            </n-button>
            <n-button v-if="extractionState" secondary @click="resetExtraction">开始新的采掘</n-button>
          </div>
          <StatePanel
            :loading="loading"
            loading-text="正在推进采掘…"
            :error="error"
            :empty="!extractionState?.interview_id && !loading"
            empty-text="输入一个问题后，系统会先给出当前答案，再推荐下一轮最值得问的问题。"
          >
            <template #default>
              <section class="widget-card">
                <h3>当前采掘对象</h3>
                <p class="highlight-copy">{{ extractionState?.current_object || "待识别" }}</p>
                <h3>当前知识目标</h3>
                <p>{{ extractionState?.current_knowledge_goal || "待明确" }}</p>
                <div class="chip-row">
                  <span class="chip">status: {{ extractionState?.status || "draft" }}</span>
                  <span class="chip">turn: {{ extractionState?.turn_index ?? 0 }}</span>
                  <span class="chip">
                    projected: {{ extractionState?.staged_writeback?.projected_writeback_level || "session-level" }}
                  </span>
                </div>
              </section>

              <section class="slot-grid">
                <section class="widget-card">
                  <h3>已知槽位</h3>
                  <div v-if="knownSlotItems.length === 0" class="empty-state">暂无已知槽位</div>
                  <div v-for="item in knownSlotItems" :key="item.key" class="list-card">
                    <strong>{{ item.key }}</strong>
                    <p>{{ item.value }}</p>
                  </div>
                </section>
                <section class="widget-card">
                  <h3>缺失槽位</h3>
                  <div class="chip-row">
                    <span v-if="missingSlots.length === 0" class="empty-state">缺失槽位已收敛</span>
                    <span v-for="slot in missingSlots" :key="slot" class="chip">{{ slot }}</span>
                  </div>
                </section>
              </section>

              <AnswerCard :sections="extractionSections" />

              <section class="widget-card">
                <div class="section-heading">
                  <h3>下一轮候选问题</h3>
                  <span class="chip">{{ extractionState?.next_question_plan.next_question_type || "pending" }}</span>
                </div>
                <p class="prompt-preview">{{ currentPrompt }}</p>
                <div class="candidate-list">
                  <button
                    v-for="question in candidateQuestions"
                    :key="question"
                    type="button"
                    class="candidate-button"
                    :class="{ 'candidate-button--active': question === currentPrompt }"
                    @click="selectCandidateQuestion(question)"
                  >
                    {{ question }}
                  </button>
                </div>
                <KeyValueList
                  :items="[
                    { key: '目标缺槽', value: targetMissingSlotsText },
                    { key: 'stop if', value: stopIfText },
                  ]"
                />
              </section>

              <section v-if="!isExtractionCompleted" class="widget-card">
                <h3>回答当前追问</h3>
                <n-input
                  v-model:value="followupAnswerDraft"
                  type="textarea"
                  :autosize="{ minRows: 3, maxRows: 6 }"
                  :placeholder="currentPrompt || '补充你的回答…'"
                />
                <div class="action-row action-row--tight">
                  <n-button type="primary" :loading="loading" @click="continueExtraction(followupAnswerDraft)">
                    继续采掘
                  </n-button>
                  <n-button secondary :loading="loading" @click="finishExtraction">结束并查看沉淀</n-button>
                </div>
              </section>

              <section v-else class="widget-card completed-card">
                <h3>采掘已完成</h3>
                <p>
                  当前会话已进入只读完成态，你现在可以查看 staged writeback，或点击“开始新的采掘”开启下一轮。
                </p>
                <div class="chip-row">
                  <span class="chip">{{ extractionState?.status }}</span>
                  <span class="chip">{{ extractionState?.staged_writeback?.projected_writeback_level }}</span>
                </div>
              </section>
            </template>
          </StatePanel>
        </template>
      </section>
      <section class="page-card stack">
        <template v-if="mode === 'quick'">
          <h3>分析方式</h3>
          <QueryTracePanel :question-type="currentQuestionType" :cues="currentCues" />
          <h3>命中知识</h3>
          <RetrievedPagesList :pages="quickResult.ranked_pages" />
          <KeyValueList
            :items="[
              { key: '方法画像', value: quickResult.method_profile_id },
              { key: '答案模板', value: quickResult.template_id },
              { key: '待跟进', value: quickResult.recalled_memory.open_loops.join(' | ') || '无' },
            ]"
          />
        </template>
        <template v-else>
          <h3>采掘状态</h3>
          <KeyValueList
            :items="[
              { key: 'question_type', value: currentQuestionType || 'unknown' },
              { key: 'status', value: extractionState?.status || 'draft' },
              { key: 'stop_decision.reason', value: extractionState?.stop_decision.reason || 'continue' },
              {
                key: 'projected_writeback_level',
                value: extractionState?.staged_writeback?.projected_writeback_level || 'session-level',
              },
            ]"
          />
          <section class="widget-card">
            <h3>Retrieval Buckets</h3>
            <KeyValueList :items="bucketStats" />
          </section>
          <section class="widget-card">
            <h3>对象与模式命中</h3>
            <div class="stack">
              <div
                v-for="hit in bucketHits"
                :key="`${hit.path}-${hit.title}`"
                class="list-card"
              >
                <strong>{{ hit.title }}</strong>
                <p>{{ hit.snippet }}</p>
              </div>
              <div v-if="bucketHits.length === 0" class="empty-state">暂无额外命中摘要</div>
            </div>
          </section>
          <RetrievedPagesList :pages="extractionRankedPages" />
        </template>
      </section>
    </div>
    <AskWorkspaceTray
      :mode="mode"
      :evidence="quickResult.selected_evidence"
      :proposal-target="quickProposalTarget"
      :content-preview="quickProposalPreview"
      :proposal-evidence="quickProposalEvidence"
      :retrieval-buckets="extractionState?.retrieval_buckets ?? null"
      :staged-writeback="extractionState?.staged_writeback ?? null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { NButton, NInput } from "naive-ui";
import { useAskWorkspace } from "@/features/query/useAskWorkspace";
import KeyValueList from "@/shared/ui/KeyValueList.vue";
import StatePanel from "@/shared/ui/StatePanel.vue";
import AnswerCard from "@/widgets/answer/AnswerCard.vue";
import CitationList from "@/widgets/answer/CitationList.vue";
import QueryTracePanel from "@/widgets/answer/QueryTracePanel.vue";
import RetrievedPagesList from "@/widgets/evidence/RetrievedPagesList.vue";
import AskWorkspaceHeader from "./AskWorkspaceHeader.vue";
import AskWorkspaceSidebar from "./AskWorkspaceSidebar.vue";
import AskWorkspaceTray from "./AskWorkspaceTray.vue";

const {
  mode,
  questionDraft,
  quickResult,
  extractionState,
  recentMemory,
  quickSections,
  extractionSections,
  loading,
  error,
  followupAnswerDraft,
  selectedCandidateQuestion,
  currentQuestionType,
  currentCues,
  submitQuick,
  startExtraction,
  continueExtraction,
  finishExtraction,
  switchMode,
  resetExtraction,
  selectCandidateQuestion,
} = useAskWorkspace();

const candidateQuestions = computed(() => extractionState.value?.next_question_plan.candidate_questions ?? []);
const currentPrompt = computed(
  () => selectedCandidateQuestion.value || candidateQuestions.value[0] || "暂无推荐追问",
);
const knownSlotItems = computed(() =>
  Object.entries(extractionState.value?.known_slots ?? {}).map(([key, value]) => ({
    key,
    value,
  })),
);
const missingSlots = computed(() => extractionState.value?.missing_slots ?? []);
const targetMissingSlotsText = computed(
  () => extractionState.value?.next_question_plan.target_missing_slots.join(" | ") || "无",
);
const stopIfText = computed(() => extractionState.value?.next_question_plan.stop_if.join(" | ") || "无");
const isExtractionCompleted = computed(() => extractionState.value?.status === "completed");
const extractionRankedPages = computed(() => extractionState.value?.retrieval_buckets.ranked_page_paths ?? []);
const bucketStats = computed(() => [
  {
    key: "object_pages",
    value: String(extractionState.value?.retrieval_buckets.object_pages.length ?? 0),
  },
  {
    key: "evidence_pages",
    value: String(extractionState.value?.retrieval_buckets.evidence_pages.length ?? 0),
  },
  {
    key: "conversation_hits",
    value: String(extractionState.value?.retrieval_buckets.conversation_hits.length ?? 0),
  },
  {
    key: "pattern_hits",
    value: String(extractionState.value?.retrieval_buckets.pattern_hits.length ?? 0),
  },
]);
const bucketHits = computed(() => [
  ...(extractionState.value?.retrieval_buckets.object_pages ?? []),
  ...(extractionState.value?.retrieval_buckets.pattern_hits ?? []),
]);
const quickProposalTarget = computed(() => quickResult.value.writeback_plan?.targets[0]?.target ?? "无");
const quickProposalPreview = computed(
  () => quickResult.value.writeback_plan?.targets[0]?.content_preview ?? "暂无沉淀预览",
);
const quickProposalEvidence = computed(
  () => quickResult.value.writeback_plan?.targets[0]?.evidence_refs ?? [],
);
</script>

<style scoped>
.slot-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.highlight-copy {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0 0 12px;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.prompt-preview {
  margin: 12px 0;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--wb-text-primary);
}

.candidate-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
}

.candidate-button {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  padding: 8px 12px;
  background: transparent;
  color: var(--wb-text-muted);
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    color 0.2s ease,
    background 0.2s ease;
}

.candidate-button--active {
  border-color: rgba(94, 234, 212, 0.45);
  background: rgba(94, 234, 212, 0.1);
  color: var(--wb-text-primary);
}

.completed-card {
  border: 1px solid rgba(94, 234, 212, 0.25);
}

@media (max-width: 1024px) {
  .slot-grid {
    grid-template-columns: 1fr;
  }
}
</style>
