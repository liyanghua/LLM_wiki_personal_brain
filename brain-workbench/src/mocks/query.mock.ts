export const queryResponseMock = {
  query_id: "20260414-ask-001",
  user_query: "品牌经营OS和SUPER指标之间是什么关系？",
  question_classification: {
    question_type: "comparison",
    confidence: 0.92,
    cues: ["什么关系", "品牌经营OS", "SUPER指标"],
  },
  answer_markdown: `## Fact

品牌经营OS是面向品牌增长与经营协同的框架，SUPER指标是面向货品全生命周期的诊断框架。

## Synthesis

两者不是互斥概念。品牌经营OS更像经营操作系统，SUPER更像其中用于识别问题和分层诊断的指标部件。

## Interpretation

如果把品牌经营OS看成“经营总盘”，SUPER指标更接近“货品经营仪表盘”。它帮助经营团队把抽象经营问题落到货品维度的优先级上。

## Recommendation

把这组关系沉淀为 decision 页面，并把 Topic 页里的指标框架与经营框架互相加链接。

## Citations

- wiki/topics/品牌经营os.md
- wiki/principles/商品全生命周期运营原则.md
- wiki/sources/货品全生命周期管理-super指标模型.md`,
  ranked_pages: [
    "wiki/topics/品牌经营os.md",
    "wiki/principles/商品全生命周期运营原则.md",
    "wiki/sources/货品全生命周期管理-super指标模型.md",
  ],
  retrieved_pages: [
    "wiki/topics/品牌经营os.md",
    "wiki/principles/商品全生命周期运营原则.md",
  ],
  retrieved_sources: [
    "raw/industry_docs/货品全生命周期管理-SUPER指标模型.md",
  ],
  selected_evidence: [
    {
      page_id: "topic_brand_operating_os",
      page_title: "品牌经营OS",
      page_path: "wiki/topics/品牌经营os.md",
      source_refs: ["raw/industry_docs/电商运营本体核心文档.md"],
      snippet: "品牌经营OS强调以人货场协同、全生命周期运营和数据驱动决策为核心。",
      relevance_score: 0.94,
    },
    {
      page_id: "principle_super_operating",
      page_title: "商品全生命周期运营原则",
      page_path: "wiki/principles/商品全生命周期运营原则.md",
      source_refs: ["raw/industry_docs/货品全生命周期管理-SUPER指标模型.md"],
      snippet: "SUPER指标覆盖优S、高U、新P、准E、快R五个维度，是货品经营诊断框架。",
      relevance_score: 0.91,
    },
  ],
  recalled_memory: {
    recent_session_summaries: ["最近几轮围绕品牌经营OS、指标体系和决策沉淀展开。"],
    persistent_interests: ["品牌经营OS", "方法资产化"],
    persistent_principles: ["答案要优先沉淀稳定原则与决策关系。"],
    open_loops: ["SUPER指标是否适合作为长期经营总指标？"],
  },
  open_follow_ups: ["是否需要把品牌经营OS与SUPER关系固化到 wiki/decisions 页面？"],
  answer_path: "memory/session/answers/20260414-ask-001.md",
  session_record_path: "memory/session/2026-04-14/20260414-ask-001.json",
  method_profile_id: "default-grounded",
  template_id: "decision-first",
  writeback_plan: {
    query_id: "20260414-ask-001",
    question: "品牌经营OS和SUPER指标之间是什么关系？",
    created_at: "2026-04-14T09:10:00Z",
    target_paths: ["wiki/decisions/品牌经营os和super指标之间是什么关系-qa-note.md"],
    applied_targets: [],
    targets: [
      {
        target: "wiki/decisions/品牌经营os和super指标之间是什么关系-qa-note.md",
        action: "create_or_merge",
        rationale: "解释稳定、会被反复引用，适合作为 decision 沉淀。",
        confidence: 0.87,
        long_term_value: "便于后续围绕经营框架与指标体系展开复用问答。",
        evidence_refs: [
          "raw/industry_docs/电商运营本体核心文档.md",
          "raw/industry_docs/货品全生命周期管理-SUPER指标模型.md",
        ],
        content_preview: "品牌经营OS与SUPER指标不是同层概念，前者是经营框架，后者是货品诊断指标部件。",
        approval_status: "approved-for-apply",
      },
    ],
  },
  asset_value_signals: {
    overall_score: 0.88,
    reasons: ["multi-page synthesis", "durable explanation", "clear writeback target"],
    signals: {
      groundedness: 0.92,
      reusability: 0.84,
      traceability: 0.89,
    },
  },
  style_profile_id: "default-grounded",
  writeback_proposed: true,
  writeback_targets: ["wiki/decisions/品牌经营os和super指标之间是什么关系-qa-note.md"],
  persistent_memory_proposals: [
    {
      proposal_type: "interest",
      target_file: "memory/persistent/interests.json",
      key: "品牌经营OS",
      value: "品牌经营OS",
      rationale: "连续多轮问题都围绕品牌经营OS展开。",
    },
  ],
  method_update_suggestions: [
    {
      field_name: "reusable_asset_preferences",
      current_value: ["mapping"],
      suggested_value: ["mapping", "roadmap"],
      rationale: "当前问题更偏关系梳理，适合增加 roadmap 型输出偏好。",
    },
  ],
  style_update_suggestions: ["当前问答倾向 decision-first，后续可更主动展示 mapping 段落。"],
  applied_memory_writes: [],
  created_at: "2026-04-14T09:10:00Z",
};
