export const ontologyCandidatesMock = {
  candidates: [
    {
      candidate_id: "topic-品牌经营os",
      candidate_type: "Topic",
      canonical_name: "品牌经营OS",
      summary: "围绕品牌增长、货品经营和协同执行的经营框架。",
      wiki_refs: ["wiki/topics/品牌经营os.md"],
      source_refs: ["raw/industry_docs/电商运营本体核心文档.md"],
      attributes: { stability: "high", status: "candidate" },
      status: "candidate/pending-approval",
    },
    {
      candidate_id: "concept-super指标",
      candidate_type: "Concept",
      canonical_name: "SUPER指标",
      summary: "围绕优S、高U、新P、准E、快R的货品诊断框架。",
      wiki_refs: ["wiki/principles/商品全生命周期运营原则.md"],
      source_refs: ["raw/industry_docs/货品全生命周期管理-SUPER指标模型.md"],
      attributes: { stability: "high", status: "candidate" },
      status: "candidate/pending-approval",
    },
  ],
};

export const skillCandidatesMock = {
  candidates: [
    {
      skill_id: "topic_synthesis",
      family: "topic_synthesis",
      title: "Topic Synthesis",
      summary: "把多个 wiki 页面编译成结构化主题综述。",
      origin_query_ids: ["20260414-ask-001", "20260414-ask-002"],
      origin_wiki_pages: ["wiki/topics/品牌经营os.md"],
      source_refs: ["raw/industry_docs/电商运营本体核心文档.md"],
      asset_value_score: 0.83,
      status: "candidate/pending-approval",
    },
  ],
};
