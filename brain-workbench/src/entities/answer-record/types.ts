import type { AgentTraceBundleEntity } from "@/entities/agent-trace/types";

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
  retrieval_backend: string;
  retrieval_mode: string;
  retrieval_collection: string;
  retrieval_explain: string[];
  process_context: {
    current_stage: string;
    current_step: string;
    linked_rules: string[];
    linked_cases: string[];
    linked_sources: string[];
  };
  answer_grounding_blocks: Array<{
    label: string;
    block_type: string;
    text: string;
    refs: string[];
    stage: string;
    step: string;
  }>;
  compile_warnings: string[];
  agent_trace: AgentTraceBundleEntity;
  created_at: string;
}
