<template>
  <aside class="page-card stack trace-panel">
    <header class="trace-panel__header">
      <div>
        <p class="eyebrow">Observability</p>
        <h3>Agent Trace</h3>
      </div>
      <label v-if="props.turnOptions.length > 0" class="trace-panel__turn">
        <span>查看轮次</span>
        <select :value="props.selectedTurn" @change="emitTurnSelect">
          <option v-for="item in props.turnOptions" :key="item.value" :value="item.value">
            {{ item.label }}
          </option>
        </select>
      </label>
    </header>

    <section class="widget-card stack">
      <div class="trace-section-title">
        <h4>阶段判断</h4>
      </div>
      <div v-if="trace.stage_checks.length === 0" class="empty-state">暂无阶段判断</div>
      <article v-for="stage in trace.stage_checks" :key="stage.stage_id" class="trace-stage-card">
        <div class="trace-stage-card__top">
          <strong>{{ stage.label }}</strong>
          <span class="trace-status" :class="`trace-status--${stage.status}`">{{ stage.status }}</span>
        </div>
        <p>{{ stage.pass_criteria }}</p>
        <p>{{ stage.reason }}</p>
        <p v-if="stage.evidence_refs.length > 0" class="trace-meta">
          依据：{{ stage.evidence_refs.join(" | ") }}
        </p>
        <p v-if="stage.warnings.length > 0" class="trace-warning">
          告警：{{ stage.warnings.join(" | ") }}
        </p>
      </article>
    </section>

    <section class="widget-card stack">
      <div class="trace-section-title">
        <h4>检索链路</h4>
      </div>
      <div class="trace-kv-grid">
        <div class="trace-kv-item">
          <span>backend</span>
          <strong>{{ trace.retrieval_trace.backend || "legacy" }}</strong>
        </div>
        <div class="trace-kv-item">
          <span>mode</span>
          <strong>{{ trace.retrieval_trace.mode || "heuristic" }}</strong>
        </div>
        <div class="trace-kv-item">
          <span>collection</span>
          <strong>{{ trace.retrieval_trace.collection || "wiki" }}</strong>
        </div>
      </div>
      <p v-if="trace.retrieval_trace.retrieval_explain.length > 0" class="trace-meta">
        explain：{{ trace.retrieval_trace.retrieval_explain.join(" | ") }}
      </p>
      <p v-if="trace.retrieval_trace.wiki_hits.length > 0" class="trace-meta">
        wiki hits：{{ trace.retrieval_trace.wiki_hits.join(" | ") }}
      </p>
      <p v-if="trace.retrieval_trace.raw_hits.length > 0" class="trace-meta">
        raw hits：{{ trace.retrieval_trace.raw_hits.join(" | ") }}
      </p>
      <p v-if="trace.retrieval_trace.warnings.length > 0" class="trace-warning">
        warning：{{ trace.retrieval_trace.warnings.join(" | ") }}
      </p>
      <div v-if="trace.retrieval_trace.top_hits.length === 0" class="empty-state">暂无 top hits</div>
      <article v-for="hit in trace.retrieval_trace.top_hits" :key="`${hit.path}-${hit.title}`" class="trace-hit-card">
        <div class="trace-hit-card__top">
          <strong>{{ hit.title }}</strong>
          <span>{{ hit.score.toFixed(2) }}</span>
        </div>
        <p class="trace-meta">{{ hit.path }}</p>
        <p v-if="hit.snippet">{{ hit.snippet }}</p>
      </article>
    </section>

    <section class="widget-card stack">
      <div class="trace-section-title">
        <h4>决策链路</h4>
      </div>
      <div class="trace-kv-grid">
        <div class="trace-kv-item">
          <span>question_type</span>
          <strong>{{ trace.decision_trace.question_type || "unknown" }}</strong>
        </div>
        <div class="trace-kv-item">
          <span>recommended_action</span>
          <strong>{{ trace.decision_trace.recommended_action || "n/a" }}</strong>
        </div>
      </div>
      <p class="trace-meta">current_object：{{ trace.decision_trace.current_object || "待识别" }}</p>
      <p class="trace-meta">knowledge_goal：{{ trace.decision_trace.knowledge_goal || "待明确" }}</p>
      <p class="trace-meta">
        target_missing_slots：{{ trace.decision_trace.target_missing_slots.join(" | ") || "无" }}
      </p>
      <p class="trace-meta">stop_reason：{{ trace.decision_trace.stop_reason || "n/a" }}</p>
    </section>

    <section class="widget-card stack">
      <div class="trace-section-title">
        <h4>LLM-log</h4>
      </div>
      <div v-if="trace.llm_log.length === 0" class="empty-state">暂无结构化日志</div>
      <article v-for="entry in trace.llm_log.slice(0, 10)" :key="`${entry.component}-${entry.step}`" class="trace-log-card">
        <div class="trace-hit-card__top">
          <strong>{{ entry.component }} / {{ entry.step }}</strong>
        </div>
        <p>{{ entry.input_summary }}</p>
        <p>{{ entry.output_summary }}</p>
        <p v-if="entry.refs.length > 0" class="trace-meta">refs：{{ entry.refs.join(" | ") }}</p>
        <p v-if="entry.warnings.length > 0" class="trace-warning">
          warnings：{{ entry.warnings.join(" | ") }}
        </p>
      </article>
    </section>
  </aside>
</template>

<script setup lang="ts">
import type { AgentTraceBundleEntity } from "@/entities/agent-trace/types";

const props = withDefaults(
  defineProps<{
    trace: AgentTraceBundleEntity;
    turnOptions?: Array<{ label: string; value: string }>;
    selectedTurn?: string;
  }>(),
  {
    turnOptions: () => [],
    selectedTurn: "current",
  },
);

const emit = defineEmits<{
  (event: "select-turn", value: string): void;
}>();

function emitTurnSelect(event: Event) {
  emit("select-turn", (event.target as HTMLSelectElement).value);
}
</script>

<style scoped>
.trace-panel {
  gap: 14px;
  position: sticky;
  top: 20px;
}

.trace-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.trace-panel__header h3,
.trace-panel__header p,
.trace-stage-card p,
.trace-hit-card p,
.trace-log-card p {
  margin: 0;
}

.trace-panel__turn {
  display: grid;
  gap: 6px;
  font-size: 0.82rem;
  color: var(--wb-text-muted);
}

.trace-panel__turn select {
  min-width: 128px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 6px 8px;
  background: rgba(17, 24, 39, 0.75);
  color: var(--wb-text-primary);
}

.trace-section-title h4 {
  margin: 0;
}

.trace-stage-card,
.trace-hit-card,
.trace-log-card {
  display: grid;
  gap: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
}

.trace-stage-card__top,
.trace-hit-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.trace-status {
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 0.76rem;
  font-weight: 600;
  text-transform: uppercase;
}

.trace-status--pass {
  background: rgba(74, 222, 128, 0.16);
  color: #86efac;
}

.trace-status--partial {
  background: rgba(250, 204, 21, 0.16);
  color: #fde047;
}

.trace-status--fail {
  background: rgba(248, 113, 113, 0.16);
  color: #fca5a5;
}

.trace-status--inactive {
  background: rgba(148, 163, 184, 0.16);
  color: #cbd5f5;
}

.trace-kv-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.trace-kv-item {
  display: grid;
  gap: 4px;
}

.trace-kv-item span,
.trace-meta {
  color: var(--wb-text-muted);
  font-size: 0.82rem;
}

.trace-warning {
  color: #fbbf24;
  font-size: 0.82rem;
}

@media (max-width: 1280px) {
  .trace-panel {
    position: static;
  }

  .trace-kv-grid {
    grid-template-columns: 1fr;
  }
}
</style>
