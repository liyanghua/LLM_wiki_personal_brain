export interface WritebackProposalListItem {
  query_id: string;
  question: string;
  created_at: string;
  primary_target?: string | null;
  primary_status?: string;
  primary_confidence?: number;
}
