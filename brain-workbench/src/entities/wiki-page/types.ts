export interface WikiPageEntity {
  page_id: string;
  page_type: string;
  title: string;
  path: string;
  summary: string;
  source_refs: string[];
  links_to: string[];
  backlinks?: string[];
  updated_at: string;
  linked_pages?: Array<{ path: string; title: string }>;
  markdown?: string;
}
