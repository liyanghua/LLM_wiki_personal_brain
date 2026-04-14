export interface SkillCandidateEntity {
  skill_id: string;
  family: string;
  title: string;
  summary: string;
  origin_query_ids: string[];
  origin_wiki_pages: string[];
  source_refs: string[];
  asset_value_score: number;
  status: string;
}
