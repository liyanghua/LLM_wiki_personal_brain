export interface EvalReportSummaryEntity {
  run_id: string;
  created_at: string;
  metrics: Record<string, number>;
  report_path_json?: string;
  report_path_markdown?: string;
}

export interface EvalReportEntity extends EvalReportSummaryEntity {
  case_results: Array<{
    case_id: string;
    question: string;
    scores: Record<string, number>;
    matched_targets: string[];
    missing_targets: string[];
    explanation: string;
  }>;
}
