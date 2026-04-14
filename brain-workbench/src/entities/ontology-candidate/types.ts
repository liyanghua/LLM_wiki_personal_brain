export interface OntologyCandidateEntity {
  candidate_id: string;
  candidate_type: string;
  canonical_name: string;
  summary: string;
  wiki_refs: string[];
  source_refs: string[];
  attributes: Record<string, unknown>;
  status: string;
}
