import { agentTraceSchema } from "./schema";
import type { AgentTraceBundleEntity } from "./types";

interface AgentTraceFallback {
  retrieval?: Partial<AgentTraceBundleEntity["retrieval_trace"]>;
  decision?: Partial<AgentTraceBundleEntity["decision_trace"]>;
}

export function createEmptyAgentTrace(fallback: AgentTraceFallback = {}): AgentTraceBundleEntity {
  return {
    stage_checks: [],
    retrieval_trace: {
      backend: fallback.retrieval?.backend ?? "legacy",
      mode: fallback.retrieval?.mode ?? "heuristic",
      collection: fallback.retrieval?.collection ?? "wiki",
      retrieval_explain: fallback.retrieval?.retrieval_explain ?? [],
      wiki_hits: fallback.retrieval?.wiki_hits ?? [],
      raw_hits: fallback.retrieval?.raw_hits ?? [],
      top_hits: fallback.retrieval?.top_hits ?? [],
      warnings: fallback.retrieval?.warnings ?? [],
    },
    decision_trace: {
      question_type: fallback.decision?.question_type ?? "",
      current_object: fallback.decision?.current_object ?? "",
      knowledge_goal: fallback.decision?.knowledge_goal ?? "",
      recommended_action: fallback.decision?.recommended_action ?? "",
      target_missing_slots: fallback.decision?.target_missing_slots ?? [],
      stop_reason: fallback.decision?.stop_reason ?? "",
    },
    llm_log: [],
  };
}

export function toAgentTraceEntity(
  payload: unknown,
  fallback: AgentTraceFallback = {},
): AgentTraceBundleEntity {
  const parsed = agentTraceSchema.parse(payload ?? {});
  const empty = createEmptyAgentTrace(fallback);

  return {
    stage_checks:
      parsed.stage_checks?.map((stage) => ({
        ...stage,
        evidence_refs: stage.evidence_refs ?? [],
        warnings: stage.warnings ?? [],
      })) ?? empty.stage_checks,
    retrieval_trace: {
      backend: parsed.retrieval_trace?.backend ?? empty.retrieval_trace.backend,
      mode: parsed.retrieval_trace?.mode ?? empty.retrieval_trace.mode,
      collection: parsed.retrieval_trace?.collection ?? empty.retrieval_trace.collection,
      retrieval_explain: parsed.retrieval_trace?.retrieval_explain ?? empty.retrieval_trace.retrieval_explain,
      wiki_hits: parsed.retrieval_trace?.wiki_hits ?? empty.retrieval_trace.wiki_hits,
      raw_hits: parsed.retrieval_trace?.raw_hits ?? empty.retrieval_trace.raw_hits,
      top_hits: parsed.retrieval_trace?.top_hits ?? empty.retrieval_trace.top_hits,
      warnings: parsed.retrieval_trace?.warnings ?? empty.retrieval_trace.warnings,
    },
    decision_trace: {
      question_type: parsed.decision_trace?.question_type ?? empty.decision_trace.question_type,
      current_object: parsed.decision_trace?.current_object ?? empty.decision_trace.current_object,
      knowledge_goal: parsed.decision_trace?.knowledge_goal ?? empty.decision_trace.knowledge_goal,
      recommended_action: parsed.decision_trace?.recommended_action ?? empty.decision_trace.recommended_action,
      target_missing_slots: parsed.decision_trace?.target_missing_slots ?? empty.decision_trace.target_missing_slots,
      stop_reason: parsed.decision_trace?.stop_reason ?? empty.decision_trace.stop_reason,
    },
    llm_log:
      parsed.llm_log?.map((entry) => ({
        ...entry,
        refs: entry.refs ?? [],
        warnings: entry.warnings ?? [],
      })) ?? empty.llm_log,
  };
}
