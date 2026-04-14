export interface MemoryRecentEntity {
  recent_queries: Array<{
    query_id: string;
    question: string;
    question_type: string;
    summary: string;
    created_at: string;
  }>;
  recent_session_summaries: string[];
  persistent_interests: string[];
  persistent_principles: string[];
  open_loops: string[];
}
