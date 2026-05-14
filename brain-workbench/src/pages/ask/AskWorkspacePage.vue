<template>
  <div class="page-shell">
    <AskWorkspaceHeader :mode="mode" @switch-mode="switchMode" />

    <section v-if="!extractionState" class="page-card stack agent-launch">
      <div class="agent-launch__intro">
        <p class="eyebrow">AI-native Interview</p>
        <h2>围绕一个主题，开始知识榨取</h2>
        <p>只需要告诉 Agent 主题和目标，它会主动推进提问、实时抽取结构化理解，并在合适的时候帮你收束。</p>
      </div>
      <div class="agent-launch__grid">
        <n-input v-model:value="launchTopic" placeholder="主题" />
        <n-input v-model:value="launchGoal" placeholder="目标" />
      </div>
      <div class="agent-launch__grid">
        <n-input v-model:value="launchStage" placeholder="可选：所属阶段" />
        <n-input v-model:value="launchStep" placeholder="可选：所属步骤" />
      </div>
      <div class="action-row">
        <n-button type="primary" :loading="loading" @click="startAgentSession">开始访谈</n-button>
      </div>
      <StatePanel :loading="loading" loading-text="Agent 正在准备首轮问题…" :error="error" :empty="false" />
    </section>

    <section v-else class="page-card stack single-agent-shell">
      <header class="single-agent-shell__header">
        <div class="stack">
          <div class="action-row action-row--tight">
            <span class="chip">{{ extractionState.interview_view.phase_label }}</span>
            <span class="chip">{{ extractionState.interview_view.prompt_type_label }}</span>
            <span v-if="extractionState.current_stage" class="chip">{{ extractionState.current_stage }}</span>
            <span v-if="extractionState.current_step" class="chip">{{ extractionState.current_step }}</span>
          </div>
          <h2>{{ extractionState.session.title || extractionState.current_object || "交互式问答 Agent" }}</h2>
          <p class="single-agent-shell__meta">
            自动保存：{{ extractionState.autosave_state.status }}
            <span v-if="extractionState.autosave_state.updated_at"> · {{ extractionState.autosave_state.updated_at }}</span>
          </p>
          <p class="single-agent-shell__meta">
            当前知识底座：{{ extractionState.process_context.anchor_bundle_id || "未锚定" }}
            <span v-if="extractionState.process_context.anchor_bundle_id === 'sop_mainline_001'"> · 主干链路SOP</span>
          </p>
          <p v-if="extractionState.degraded_retrieval_mode.active" class="agent-warning">
            已降级到基础检索：{{ extractionState.degraded_retrieval_mode.reason || "当前未使用 qmd 检索结果。" }}
          </p>
        </div>
        <div class="action-row">
          <n-button secondary @click="toggleDiagnostics">
            {{ showDiagnostics ? "收起诊断" : "查看诊断" }}
          </n-button>
          <n-button secondary @click="toggleStructureDrawer">
            {{ showStructureDrawer ? "收起结构" : "展开查看" }}
          </n-button>
          <n-button secondary :loading="loading" @click="summarizeExtraction">先总结一下</n-button>
          <n-button secondary :loading="loading" @click="finishExtraction">结束</n-button>
        </div>
      </header>

      <StatePanel :loading="loading" loading-text="Agent 正在推进访谈…" :error="error" :empty="false">
        <template #default>
          <div class="agent-thread">
            <article class="agent-message agent-message--assistant">
              <div class="agent-message__meta">Agent 当前问题</div>
              <h3>{{ extractionState.interview_view.current_prompt }}</h3>
              <div v-if="extractionState.interview_view.recommended_followups.length > 0" class="candidate-list">
                <button
                  v-for="item in extractionState.interview_view.recommended_followups"
                  :key="item"
                  type="button"
                  class="candidate-button"
                  :class="{ 'candidate-button--active': item === currentPrompt }"
                  @click="selectCandidateQuestion(item)"
                >
                  {{ item }}
                </button>
              </div>
            </article>

            <article class="agent-message agent-message--assistant">
              <div class="agent-message__meta">Agent 当前答案</div>
              <p class="agent-message__summary">
                {{ extractionState.current_answer_summary || "Agent 正在根据当前证据组织答案。" }}
              </p>
              <div class="stack answer-frame">
                <div v-if="extractionState.interview_view.answer_frame.primary_answer" class="answer-frame__section">
                  <div class="agent-message__meta">直接答案</div>
                  <p>{{ extractionState.interview_view.answer_frame.primary_answer }}</p>
                </div>
                <div v-if="extractionState.interview_view.answer_frame.mainline_steps.length > 0" class="answer-frame__section">
                  <div class="agent-message__meta">主链路步骤</div>
                  <ol class="answer-frame__list">
                    <li v-for="step in extractionState.interview_view.answer_frame.mainline_steps" :key="step">{{ step }}</li>
                  </ol>
                </div>
                <div v-if="extractionState.interview_view.answer_frame.key_judgements.length > 0" class="answer-frame__section">
                  <div class="agent-message__meta">关键判断</div>
                  <ul class="answer-frame__list">
                    <li
                      v-for="judgement in extractionState.interview_view.answer_frame.key_judgements"
                      :key="judgement"
                    >
                      {{ judgement }}
                    </li>
                  </ul>
                </div>
                <div v-if="extractionState.interview_view.answer_frame.evidence_refs.length > 0" class="answer-frame__section">
                  <div class="agent-message__meta">依据</div>
                  <p class="asset-note">{{ extractionState.interview_view.answer_frame.evidence_refs.join(" | ") }}</p>
                </div>
              </div>
              <AnswerCard v-if="extractionSections.length > 0" :sections="extractionSections" />
            </article>

            <article v-if="extractionGroundingBlocks.length > 0" class="agent-message agent-message--evidence">
              <div class="agent-message__meta">答案依据</div>
              <article
                v-for="block in extractionGroundingBlocks"
                :key="`${block.label}-${block.text}`"
                class="grounding-card"
              >
                <div class="action-row action-row--tight">
                  <strong>{{ block.label }}</strong>
                  <div class="chip-row">
                    <span v-if="block.stage" class="chip">{{ block.stage }}</span>
                    <span v-if="block.step" class="chip">{{ block.step }}</span>
                  </div>
                </div>
                <p>{{ block.text }}</p>
                <p v-if="block.refs.length > 0" class="asset-note">refs: {{ block.refs.join(" | ") }}</p>
              </article>
            </article>

            <article v-if="isExtractionCompleted" class="agent-message agent-message--success">
              <div class="agent-message__meta">Session Summary</div>
              <h3>采掘已完成</h3>
              <p>{{ extractionState.session_summary.summary_text }}</p>
              <div class="action-row action-row--tight">
                <n-button secondary @click="resetExtraction">继续补充</n-button>
              </div>
            </article>
          </div>

          <section class="agent-composer">
            <div class="agent-composer__header">
              <div>
                <h3>继续对话</h3>
                <p>{{ extractionState.interview_view.current_prompt }}</p>
              </div>
            </div>
            <n-input
              v-model:value="agentComposerDraft"
              type="textarea"
              :autosize="{ minRows: 3, maxRows: 6 }"
              :placeholder="agentComposerPlaceholder"
              :disabled="loading || isExtractionCompleted"
            />
            <div class="action-row">
              <n-button type="primary" :loading="loading" :disabled="isExtractionCompleted" @click="submitAgentTurn">
                回答并继续
              </n-button>
              <n-button
                secondary
                :loading="loading"
                :disabled="loading || isExtractionCompleted || !extractionState.interview_view.can_skip"
                @click="skipExtraction"
              >
                跳过这个问题
              </n-button>
              <n-button
                secondary
                :loading="loading"
                :disabled="loading || !extractionState.interview_view.can_summarize"
                @click="summarizeExtraction"
              >
                先总结一下
              </n-button>
            </div>
          </section>

          <section class="structure-bar">
            <div class="structure-bar__stats">
              <span>概念 {{ extractionState.interview_view.structure_counts.concepts }}</span>
              <span>规则 {{ extractionState.interview_view.structure_counts.heuristics }}</span>
              <span>案例 {{ extractionState.interview_view.structure_counts.cases }}</span>
              <span>边界 {{ extractionState.interview_view.structure_counts.boundaries }}</span>
            </div>
            <button type="button" class="structure-bar__toggle" @click="toggleStructureDrawer">展开查看</button>
          </section>
        </template>
      </StatePanel>
    </section>

    <section v-if="extractionState && showStructureDrawer" class="page-card stack overlay-panel">
      <div class="action-row">
        <div>
          <p class="eyebrow">Structured Understanding</p>
          <h3>结构抽屉</h3>
        </div>
        <n-button secondary @click="toggleStructureDrawer">收起结构</n-button>
      </div>
      <div v-if="candidateAssets.length === 0" class="empty-state">当前还没有稳定候选资产</div>
      <article v-for="asset in candidateAssets" :key="asset.asset_id" class="list-card candidate-asset-card">
        <div class="action-row">
          <div>
            <strong>{{ asset.title }}</strong>
            <p>{{ asset.summary }}</p>
          </div>
          <div class="chip-row">
            <span v-if="asset.card_group" class="chip">{{ asset.card_group }}</span>
            <span class="chip">{{ asset.asset_type }}</span>
            <span class="chip">{{ asset.status }}</span>
          </div>
        </div>
        <p v-if="asset.stage_refs.length > 0" class="asset-note">stage: {{ asset.stage_refs.join(" | ") }}</p>
        <p v-if="asset.step_refs.length > 0" class="asset-note">step: {{ asset.step_refs.join(" | ") }}</p>
        <p v-if="asset.anchor_block_refs.length > 0" class="asset-note">anchor: {{ asset.anchor_block_refs.join(" | ") }}</p>
        <div class="action-row action-row--tight">
          <button
            type="button"
            class="candidate-button"
            :data-asset-id="asset.asset_id"
            @click="markAssetStatus(asset.asset_id, 'confirmed')"
          >
            确认
          </button>
          <button
            type="button"
            class="candidate-button"
            :data-asset-id="asset.asset_id"
            @click="markAssetStatus(asset.asset_id, 'needs_clarification')"
          >
            改一下
          </button>
          <button
            type="button"
            class="candidate-button"
            :data-asset-id="asset.asset_id"
            @click="markAssetStatus(asset.asset_id, 'rejected')"
          >
            不对
          </button>
          <button
            type="button"
            class="candidate-button"
            :data-asset-id="asset.asset_id"
            @click="markAssetStatus(asset.asset_id, 'needs_clarification')"
          >
            以后再说
          </button>
        </div>
      </article>
    </section>

    <section v-if="extractionState && showDiagnostics" class="page-card stack overlay-panel">
      <div class="action-row">
        <div>
          <p class="eyebrow">Diagnostics</p>
          <h3>Agent Trace</h3>
        </div>
        <n-button secondary @click="toggleDiagnostics">收起诊断</n-button>
      </div>
      <AgentTracePanel
        :trace="activeExtractionTrace"
        :turn-options="traceTurnOptions"
        :selected-turn="selectedTraceTurn"
        @select-turn="selectTraceTurn"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NButton, NInput } from "naive-ui";
import { createEmptyAgentTrace } from "@/entities/agent-trace/adapters";
import { useAskWorkspace } from "@/features/query/useAskWorkspace";
import StatePanel from "@/shared/ui/StatePanel.vue";
import AnswerCard from "@/widgets/answer/AnswerCard.vue";
import AgentTracePanel from "./AgentTracePanel.vue";
import AskWorkspaceHeader from "./AskWorkspaceHeader.vue";

const {
  mode,
  questionDraft,
  extractionState,
  extractionSections,
  loading,
  error,
  followupAnswerDraft,
  selectedCandidateQuestion,
  extractionSessionDraft,
  startExtraction,
  continueExtraction,
  skipExtraction,
  summarizeExtraction,
  finishExtraction,
  switchMode,
  resetExtraction,
  selectCandidateQuestion,
  updateCandidateAsset,
} = useAskWorkspace();

const launchTopic = computed({
  get: () => extractionSessionDraft.value.target_object || extractionSessionDraft.value.title || "",
  set: (value: string) => {
    extractionSessionDraft.value.title = value;
    extractionSessionDraft.value.target_object = value;
    questionDraft.value = value;
  },
});
const launchGoal = computed({
  get: () => extractionSessionDraft.value.goal,
  set: (value: string) => {
    extractionSessionDraft.value.goal = value;
  },
});
const launchStage = ref("");
const launchStep = ref("");
const showStructureDrawer = ref(false);
const showDiagnostics = ref(false);
const extractionGroundingBlocks = computed(() => extractionState.value?.answer_grounding_blocks ?? []);
const candidateAssets = computed(() => extractionState.value?.candidate_assets ?? []);
const isExtractionCompleted = computed(() => extractionState.value?.status === "completed");
const currentPrompt = computed(
  () =>
    selectedCandidateQuestion.value ||
    extractionState.value?.interview_view.current_prompt ||
    extractionState.value?.next_question_plan.candidate_questions?.[0] ||
    "",
);
const agentComposerDraft = computed({
  get: () => followupAnswerDraft.value,
  set: (value: string) => {
    followupAnswerDraft.value = value;
  },
});
const agentComposerPlaceholder = computed(() => currentPrompt.value || "请输入你的回答…");
const selectedTraceTurn = ref("current");
const traceTurnOptions = computed(() => {
  if (!extractionState.value) return [];
  return [
    { label: "当前轮次", value: "current" },
    ...extractionState.value.turns.map((turn) => ({
      label: `Turn ${turn.turn_index}`,
      value: String(turn.turn_index),
    })),
  ];
});
const activeExtractionTrace = computed(() => {
  const emptyTrace = createEmptyAgentTrace();
  if (!extractionState.value) return emptyTrace;
  if (selectedTraceTurn.value === "current") {
    return extractionState.value.current_trace ?? emptyTrace;
  }
  const turn = extractionState.value.turns.find((item) => String(item.turn_index) === selectedTraceTurn.value);
  return turn?.agent_trace ?? extractionState.value.current_trace ?? emptyTrace;
});

watch(
  () => extractionState.value?.interview_id,
  () => {
    selectedTraceTurn.value = "current";
    showStructureDrawer.value = false;
    showDiagnostics.value = false;
  },
);

function toggleStructureDrawer() {
  showStructureDrawer.value = !showStructureDrawer.value;
}

function toggleDiagnostics() {
  showDiagnostics.value = !showDiagnostics.value;
}

function selectTraceTurn(value: string) {
  selectedTraceTurn.value = value;
}

function markAssetStatus(assetId: string, status: "confirmed" | "needs_clarification" | "rejected") {
  void updateCandidateAsset(assetId, { status });
}

function startAgentSession() {
  void startExtraction(launchTopic.value || questionDraft.value, {
    title: launchTopic.value,
    topic_type: extractionSessionDraft.value.topic_type,
    target_object: launchTopic.value,
    goal: launchGoal.value,
    created_by: extractionSessionDraft.value.created_by,
    mapped_stage: launchStage.value,
    mapped_step: launchStep.value,
  } as any);
}

function submitAgentTurn() {
  if (isExtractionCompleted.value) return;
  void continueExtraction(followupAnswerDraft.value);
}
</script>

<style scoped>
.agent-launch,
.single-agent-shell,
.overlay-panel {
  gap: 16px;
}

.agent-launch__intro h2,
.single-agent-shell__header h2 {
  margin: 0;
}

.agent-launch__intro p,
.single-agent-shell__meta {
  margin: 0;
}

.agent-launch__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.single-agent-shell__header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.agent-warning {
  margin: 0;
  color: #fbbf24;
}

.agent-thread {
  display: grid;
  gap: 14px;
}

.agent-message {
  display: grid;
  gap: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 18px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.03);
}

.agent-message--success {
  border-color: rgba(94, 234, 212, 0.22);
}

.agent-message__meta {
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--wb-text-muted);
}

.agent-message__summary,
.grounding-card p,
.candidate-asset-card p {
  margin: 0;
}

.answer-frame {
  gap: 10px;
}

.answer-frame__section {
  display: grid;
  gap: 6px;
}

.answer-frame__section p,
.answer-frame__list {
  margin: 0;
}

.grounding-card {
  display: grid;
  gap: 8px;
  border-radius: 14px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
}

.agent-composer {
  display: grid;
  gap: 12px;
}

.agent-composer__header h3,
.agent-composer__header p {
  margin: 0;
}

.structure-bar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.04);
}

.structure-bar__stats {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  color: var(--wb-text-primary);
}

.structure-bar__toggle {
  border: none;
  background: transparent;
  color: var(--wb-link);
  cursor: pointer;
}

.candidate-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.candidate-button {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  padding: 8px 12px;
  background: transparent;
  color: var(--wb-text-muted);
  cursor: pointer;
}

.candidate-button--active {
  border-color: rgba(94, 234, 212, 0.45);
  background: rgba(94, 234, 212, 0.1);
  color: var(--wb-text-primary);
}

.candidate-asset-card {
  display: grid;
  gap: 10px;
}

.asset-note {
  color: var(--wb-text-muted);
}

@media (max-width: 900px) {
  .agent-launch__grid {
    grid-template-columns: 1fr;
  }

  .structure-bar {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
