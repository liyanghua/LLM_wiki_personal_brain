export const evalReportsMock = {
  reports: [
    {
      run_id: "20260414-091200",
      created_at: "2026-04-14T09:12:00Z",
      metrics: {
        answer_asset_value: 0.88,
        writeback_precision: 0.92,
        memory_precision: 0.87,
        method_consistency: 0.91,
        ontology_quality: 0.89,
        skill_candidate_quality: 0.84,
      },
      report_path_json: "eval/reports/20260414-091200.json",
      report_path_markdown: "eval/reports/20260414-091200.md",
    },
  ],
};

export const evalReportDetailMock = {
  run_id: "20260414-091200",
  created_at: "2026-04-14T09:12:00Z",
  metrics: evalReportsMock.reports[0].metrics,
  case_results: [
    {
      case_id: "brand-os-super",
      question: "品牌经营OS和SUPER指标之间是什么关系？",
      scores: evalReportsMock.reports[0].metrics,
      matched_targets: ["wiki/decisions/"],
      missing_targets: [],
      explanation: "值得沉淀；写回命中正确 decision；ontology 与 skill 候选都可追溯。",
    },
  ],
  report_path_json: "eval/reports/20260414-091200.json",
  report_path_markdown: "eval/reports/20260414-091200.md",
};
