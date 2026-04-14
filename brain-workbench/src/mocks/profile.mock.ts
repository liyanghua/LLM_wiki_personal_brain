import { queryResponseMock } from "./query.mock";

export const methodProfileMock = {
  method_profile_id: "default-grounded",
  preferred_answer_structure: ["fact", "synthesis", "interpretation", "recommendation"],
  abstraction_depth: "balanced",
  operationalization_level: "high",
  explanation_pattern: "decision-first",
  reusable_asset_preferences: ["mapping", "roadmap"],
  citation_preference: "high",
  assetization_preference: "proposal-first",
  favored_output_forms: ["markdown", "mapping-table"],
  preferred_tone: "grounded",
  actionability_preference: "high",
};

export const persistentMemoryMock = {
  profile: methodProfileMock,
  interests: ["品牌经营OS", "方法资产化", "单因子测图"],
  principles: ["写回答时优先保持 fact 和 interpretation 分离。"],
  open_loops: ["SUPER指标是否适合作为长期经营总指标？"],
};

export const profileProposalsMock = {
  method_suggestions: queryResponseMock.method_update_suggestions.map((item) => ({
    query_id: queryResponseMock.query_id,
    ...item,
  })),
  style_suggestions: queryResponseMock.style_update_suggestions.map((item) => ({
    query_id: queryResponseMock.query_id,
    rationale: item,
  })),
  persistent_memory_proposals: queryResponseMock.persistent_memory_proposals.map((item) => ({
    query_id: queryResponseMock.query_id,
    ...item,
  })),
};
