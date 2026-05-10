<template>
  <div class="bottom-tray">
    <template v-if="mode === 'quick'">
      <section class="panel-card">
        <h3>证据片段</h3>
        <EvidenceList :evidence="evidence" />
      </section>
      <section class="panel-card" v-if="quickGroundingBlocks.length > 0">
        <h3>答案依据</h3>
        <div class="stack">
          <article v-for="item in quickGroundingBlocks" :key="`${item.label}-${item.text}`" class="list-card">
            <strong>{{ item.label }}</strong>
            <p>{{ item.text }}</p>
          </article>
        </div>
      </section>
      <section class="panel-card">
        <h3>沉淀预览</h3>
        <MergePreviewPanel
          :target="proposalTarget"
          :content-preview="contentPreview"
          :evidence-refs="proposalEvidence"
        />
      </section>
    </template>
    <template v-else>
      <section class="panel-card">
        <h3>待追问问题池</h3>
        <div class="stack">
          <div v-if="extractionFollowups.length === 0" class="empty-state">暂无待追问问题</div>
          <article
            v-for="item in extractionFollowups"
            :key="item.question_id"
            class="list-card"
          >
            <div class="action-row">
              <strong>{{ item.question_text }}</strong>
              <span class="chip">{{ item.priority }}</span>
              <span class="chip">{{ item.status }}</span>
            </div>
            <p>{{ item.reason }}</p>
            <p v-if="item.linked_stage" class="question-meta">linked stage: {{ item.linked_stage }}</p>
            <p v-if="item.linked_step" class="question-meta">linked step: {{ item.linked_step }}</p>
          </article>
        </div>
      </section>
      <section class="panel-card">
        <h3>检索证据桶</h3>
        <EvidenceList :evidence="extractionEvidence" />
      </section>
      <section class="panel-card">
        <h3>分层写回预览</h3>
        <div class="stack">
          <div v-if="knowledgePreviews.length === 0 && assetPreviews.length === 0" class="empty-state">
            暂无 staged writeback 预览
          </div>
          <MergePreviewPanel
            v-for="item in knowledgePreviews"
            :key="`knowledge-${item.target}-${item.contentPreview}`"
            :target="item.target"
            :content-preview="item.contentPreview"
            :evidence-refs="item.evidenceRefs"
          />
          <MergePreviewPanel
            v-for="item in assetPreviews"
            :key="`asset-${item.target}-${item.contentPreview}`"
            :target="item.target"
            :content-preview="item.contentPreview"
            :evidence-refs="item.evidenceRefs"
          />
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { EvidenceSnippet } from "@/entities/answer-record/types";
import type {
  ExtractionInterviewStateEntity,
  FollowupQuestionEntity,
  StagedWritebackEntity,
} from "@/entities/extraction-interview/types";
import EvidenceList from "@/widgets/evidence/EvidenceList.vue";
import MergePreviewPanel from "@/widgets/proposal/MergePreviewPanel.vue";

const props = defineProps<{
  mode: "extraction" | "quick";
  evidence: EvidenceSnippet[];
  proposalTarget: string;
  contentPreview: string;
  proposalEvidence: string[];
  quickGroundingBlocks?: Array<{
    label: string;
    text: string;
  }>;
  retrievalBuckets?: ExtractionInterviewStateEntity["retrieval_buckets"] | null;
  stagedWriteback?: StagedWritebackEntity | null;
  followupQuestions?: FollowupQuestionEntity[] | null;
}>();

function normalizeLayerPreviews(layer: Record<string, unknown> | null | undefined, fallbackTarget: string) {
  if (!layer) return [];

  const rawTargets = Array.isArray(layer.targets) ? layer.targets : [];
  if (rawTargets.length > 0) {
    return rawTargets.map((item, index) => {
      const target = typeof item?.target === "string" ? item.target : `${fallbackTarget}-${index + 1}`;
      const contentPreview =
        typeof item?.content_preview === "string"
          ? item.content_preview
          : typeof item?.rationale === "string"
            ? item.rationale
            : JSON.stringify(item, null, 2);
      const evidenceRefs = Array.isArray(item?.evidence_refs)
        ? item.evidence_refs.filter((reference: unknown): reference is string => typeof reference === "string")
        : [];

      return { target, contentPreview, evidenceRefs };
    });
  }

  const contentPreview =
    typeof layer.content_preview === "string"
      ? layer.content_preview
      : typeof layer.rationale === "string"
        ? layer.rationale
        : JSON.stringify(layer, null, 2);

  return [
    {
      target: fallbackTarget,
      contentPreview,
      evidenceRefs: [],
    },
  ];
}

const extractionEvidence = computed(() => props.retrievalBuckets?.evidence_pages ?? []);
const knowledgePreviews = computed(() =>
  normalizeLayerPreviews(props.stagedWriteback?.knowledge_level, "knowledge-level"),
);
const assetPreviews = computed(() =>
  normalizeLayerPreviews(props.stagedWriteback?.asset_level, "asset-level"),
);
const extractionFollowups = computed(() => props.followupQuestions ?? []);
const quickGroundingBlocks = computed(() => props.quickGroundingBlocks ?? []);
</script>

<style scoped>
.question-meta {
  margin: 0;
  color: var(--wb-text-muted);
}
</style>
