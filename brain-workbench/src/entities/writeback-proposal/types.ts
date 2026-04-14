export interface WritebackTargetDecisionEntity {
  target: string;
  action: string;
  rationale: string;
  confidence: number;
  long_term_value: string;
  evidence_refs: string[];
  content_preview: string;
  approval_status: string;
}

export interface WritebackBundleEntity {
  query_id: string;
  question: string;
  created_at: string;
  target_paths: string[];
  applied_targets: string[];
  targets: WritebackTargetDecisionEntity[];
}
