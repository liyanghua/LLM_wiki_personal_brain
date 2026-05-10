export type TraceStageStatus = "pass" | "partial" | "fail" | "inactive";

export interface TraceStageEntity {
  stage_id: string;
  label: string;
  status: TraceStageStatus;
  reason: string;
  pass_criteria: string;
  evidence_refs: string[];
  warnings: string[];
}

export interface TraceTopHitEntity {
  path: string;
  title: string;
  score: number;
  snippet?: string;
}

export interface TraceLogEntryEntity {
  component: string;
  step: string;
  input_summary: string;
  output_summary: string;
  refs: string[];
  warnings: string[];
}

export interface AgentTraceBundleEntity {
  stage_checks: TraceStageEntity[];
  retrieval_trace: {
    backend: string;
    mode: string;
    collection: string;
    retrieval_explain: string[];
    wiki_hits: string[];
    raw_hits: string[];
    top_hits: TraceTopHitEntity[];
    warnings: string[];
  };
  decision_trace: {
    question_type: string;
    current_object: string;
    knowledge_goal: string;
    recommended_action: string;
    target_missing_slots: string[];
    stop_reason: string;
  };
  llm_log: TraceLogEntryEntity[];
}
