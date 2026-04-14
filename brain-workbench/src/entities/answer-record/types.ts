export interface EvidenceSnippet {
  page_id: string;
  page_title: string;
  page_path: string;
  source_refs: string[];
  snippet: string;
  relevance_score: number;
}

export interface AskResultEntity {
  query_id: string;
  user_query: string;
  answer_markdown: string;
  ranked_pages: string[];
  retrieved_pages: string[];
  retrieved_sources: string[];
  selected_evidence: EvidenceSnippet[];
  question_classification: {
    question_type: string;
    confidence: number;
    cues: string[];
  };
  recalled_memory: {
    recent_session_summaries: string[];
    persistent_interests: string[];
    persistent_principles: string[];
    open_loops: string[];
  };
  writeback_plan?: {
    query_id: string;
    targets: Array<{
      target: string;
      action: string;
      rationale: string;
      confidence: number;
      long_term_value: string;
      evidence_refs: string[];
      content_preview: string;
      approval_status: string;
    }>;
  };
  method_profile_id: string;
  template_id: string;
  created_at: string;
}
