import { computed, ref } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import AskWorkspacePage from "./AskWorkspacePage.vue";
import type { ExtractionInterviewStateEntity } from "@/entities/extraction-interview/types";

const mode = ref<"extraction" | "quick">("extraction");
const selectedCandidateQuestion = ref("品牌经营OS的定义应该怎么表述才最稳定？");
const extractionState = ref<ExtractionInterviewStateEntity>({
  interview_id: "extract-001",
  interaction_mode: "extraction-interview" as const,
  session: {
    session_id: "extract-001",
    title: "品牌经营OS访谈",
    topic_type: "strategy",
    target_object: "品牌经营OS",
    goal: "补齐品牌经营OS的稳定定义",
    status: "in_progress",
    created_by: "expert",
    created_at: "2026-04-14T00:00:00Z",
    completed_at: "",
    current_stage: "第二阶段-产品塑造",
    current_step: "产品营销能力塑造",
  },
  status: "in_progress",
  question_type: "definition",
  turn_index: 1,
  current_object: "品牌经营OS",
  current_knowledge_goal: "补齐品牌经营OS的稳定定义",
  current_stage: "第二阶段-产品塑造",
  current_step: "产品营销能力塑造",
  process_context: {
    current_stage: "第二阶段-产品塑造",
    current_step: "产品营销能力塑造",
    linked_rules: ["营销能力塑造校验项"],
    linked_cases: ["产品能力塑造表（视觉设计）"],
    linked_sources: ["raw/industry_docs/主干链路SOP.md"],
    anchor_bundle_id: "sop_mainline_001",
    anchor_paths: [
      "raw/industry_docs/主干链路SOP.md",
      "raw/industry_docs/主干链路SOP.graph.json",
      "raw/industry_docs/主干链路SOP.meta.yaml",
    ],
    matched_block_ids: ["mainline-step-1", "judgement-1"],
    answer_mode: "mainline_step_question",
  },
  known_slots: {
    current_object: "品牌经营OS",
    definition: "一套围绕长期经营的品牌协同框架。",
  },
  missing_slots: ["scope", "purpose"],
  retrieval_buckets: {
    object_pages: [
      {
        title: "品牌经营OS",
        path: "wiki/topics/品牌经营os.md",
        snippet: "品牌经营OS强调长期经营。",
        score: 0.92,
        source_refs: ["raw/industry_docs/电商运营本体核心文档.md"],
      },
    ],
    evidence_pages: [
      {
        page_id: "topic_brand_operating_os",
        page_title: "品牌经营OS",
        page_path: "wiki/topics/品牌经营os.md",
        source_refs: ["raw/industry_docs/电商运营本体核心文档.md"],
        snippet: "品牌经营OS强调长期经营。",
        relevance_score: 0.94,
      },
    ],
    conversation_hits: [],
    pattern_hits: [],
    ranked_page_paths: ["wiki/topics/品牌经营os.md"],
    retrieved_sources: ["raw/industry_docs/电商运营本体核心文档.md"],
  },
  current_answer_markdown: "## Fact\n品牌经营OS强调长期经营。\n## Synthesis\n它是一套长期协同框架。",
  current_answer_summary: "品牌经营OS强调长期经营。",
  answer_grounding_blocks: [
    {
      label: "主干链路SOP",
      block_type: "evidence",
      text: "1. 类目可行性分析，确定最优叶子类目；2. 确定叶子类目后价格带地图（店铺+人群）",
      refs: ["raw/industry_docs/主干链路SOP.md"],
      stage: "第一环节-洞察分析",
      step: "类目可行性分析，确定最优叶子类目",
    },
  ],
  next_question_plan: {
    next_question_type: "slot-fill",
    candidate_questions: [
      "品牌经营OS的定义应该怎么表述才最稳定？",
      "品牌经营OS的适用范围是什么？",
    ],
    target_missing_slots: ["scope", "purpose"],
    stop_if: ["all target missing slots are filled"],
  },
  stop_decision: {
    should_stop: false,
    reason: "continue",
    confidence: 0.8,
  },
  staged_writeback: {
    session_level: {
      interview_id: "extract-001",
    },
    knowledge_level: {
      query_id: "extract-001",
      targets: [
        {
          target: "wiki/decisions/品牌经营os-qa-note.md",
          content_preview: "将形成品牌经营OS的稳定定义与适用范围沉淀。",
          evidence_refs: ["raw/industry_docs/电商运营本体核心文档.md"],
        },
      ],
    },
    asset_level: null,
    projected_writeback_level: "knowledge-level",
  },
  candidate_assets: [
    {
      asset_id: "concept-brand-os",
      session_id: "extract-001",
      asset_type: "concept",
      title: "品牌经营OS",
      summary: "一套围绕长期经营的品牌协同框架。",
      content_json: {
        draft_definition: "一套围绕长期经营的品牌协同框架。",
      },
      confidence: 0.86,
      source_turn_ids: [1],
      evidence_refs: ["raw/industry_docs/电商运营本体核心文档.md"],
      status: "draft",
      expert_note: "",
      stage_refs: ["第二阶段-产品塑造"],
      step_refs: ["产品营销能力塑造"],
      decision_refs: ["营销能力塑造校验项"],
      card_group: "mainline_step",
      card_order: 1,
      anchor_block_refs: ["mainline-step-1"],
    },
    {
      asset_id: "heuristic-brand-os",
      session_id: "extract-001",
      asset_type: "heuristic",
      title: "品牌经营优先级",
      summary: "先统一长期经营框架，再看短期投放动作。",
      content_json: {
        statement: "先统一长期经营框架，再看短期投放动作。",
      },
      confidence: 0.78,
      source_turn_ids: [1],
      evidence_refs: ["wiki/topics/品牌经营os.md"],
      status: "needs_clarification",
      expert_note: "后续还需要补齐边界条件。",
      stage_refs: ["第二阶段-产品塑造"],
      step_refs: ["产品营销能力塑造"],
      decision_refs: ["营销能力塑造校验项"],
      card_group: "judgement",
      card_order: 2,
      anchor_block_refs: ["judgement-1"],
    },
  ],
  followup_questions: [
    {
      question_id: "followup-definition",
      session_id: "extract-001",
      question_text: "品牌经营OS的定义应该怎么表述才最稳定？",
      question_type: "definition",
      reason: "定义尚未稳定",
      priority: "high",
      status: "selected",
      source_asset_ids: ["concept-brand-os"],
      target_missing_slots: ["definition"],
      linked_stage: "第二阶段-产品塑造",
      linked_step: "产品营销能力塑造",
      gap_type: "stage_step_gap",
    },
    {
      question_id: "followup-scope",
      session_id: "extract-001",
      question_text: "品牌经营OS的适用范围是什么？",
      question_type: "definition",
      reason: "边界条件还不完整",
      priority: "medium",
      status: "open",
      source_asset_ids: ["heuristic-brand-os"],
      target_missing_slots: ["scope"],
      linked_stage: "第二阶段-产品塑造",
      linked_step: "产品营销能力塑造",
      gap_type: "boundary_gap",
    },
  ],
  session_summary: {
    summary_id: "summary-extract-001",
    session_id: "extract-001",
    summary_text: "当前已经沉淀出品牌经营OS的初步定义与优先级判断。",
    key_concepts: ["品牌经营OS"],
    key_heuristics: ["品牌经营优先级"],
    key_cases: [],
    key_boundaries: ["scope"],
    unresolved_items: ["scope"],
  },
  compile_warnings: [],
  interview_view: {
    current_prompt: "品牌经营OS的定义应该怎么表述才最稳定？",
    prompt_type_label: "当前在问：定义澄清",
    phase_label: "正在围绕 第二阶段-产品塑造 推进",
    recommended_followups: ["追问适用范围", "追问边界条件"],
    structure_counts: {
      concepts: 1,
      heuristics: 1,
      cases: 0,
      boundaries: 1,
    },
    answer_frame: {
      primary_answer: "主干链路先看类目可行性分析，确定最优叶子类目。",
      mainline_steps: [
        "类目可行性分析，确定最优叶子类目",
        "确定叶子类目后价格带地图（店铺+人群）",
      ],
      key_judgements: ["主图风格定位符合人群", "产品定价符合人群消费层级"],
      evidence_refs: ["raw/industry_docs/主干链路SOP.md"],
    },
    can_skip: true,
    can_summarize: true,
    autosave_state: "saved",
  },
  autosave_state: {
    saved: true,
    state_path: "memory/session/extraction/2026-04-14/extract-001.json",
    updated_at: "2026-04-14T00:00:00Z",
    status: "saved",
  },
  degraded_retrieval_mode: {
    active: false,
    configured_backend: "qmd",
    actual_backend: "qmd",
    reason: "",
  },
  current_trace: {
    stage_checks: [
      {
        stage_id: "wiki_recall",
        label: "Agent 是否能从原始 wiki 中获得有用知识？",
        status: "partial",
        reason: "wiki 页面太薄，需要 raw 补证据。",
        pass_criteria: "能召回，不乱引",
        evidence_refs: [
          "wiki/sources/6大维度42个细分变量选择逻辑01.md",
          "raw/industry_docs/6大维度·42个细分变量选择逻辑01.md",
        ],
        warnings: ["wiki source page is too thin for direct answering"],
      },
      {
        stage_id: "context_expand",
        label: "Agent 是否能扩展相关对象与证据链？",
        status: "pass",
        reason: "已命中关联 page 与 evidence。",
        pass_criteria: "能找到相关对象与证据链",
        evidence_refs: ["wiki/topics/品牌经营os.md"],
        warnings: [],
      },
      {
        stage_id: "ontology_decision",
        label: "Agent 是否能通过本体做状态判断与动作选择？",
        status: "pass",
        reason: "已生成下一问与缺槽。",
        pass_criteria: "能从“知道”走到“判断”",
        evidence_refs: [],
        warnings: [],
      },
      {
        stage_id: "skill_reuse",
        label: "Agent 是否能通过 skill 稳定复用经验？",
        status: "inactive",
        reason: "当前未接 runtime skill。",
        pass_criteria: "同类任务表现明显更稳",
        evidence_refs: [],
        warnings: [],
      },
    ],
    retrieval_trace: {
      backend: "qmd",
      mode: "hybrid",
      collection: "wiki",
      retrieval_explain: ["bm25 title hit: 品牌经营OS"],
      wiki_hits: ["wiki/topics/品牌经营os.md"],
      raw_hits: ["raw/industry_docs/电商运营本体核心文档.md"],
      top_hits: [
        {
          path: "wiki/topics/品牌经营os.md",
          title: "品牌经营OS",
          score: 0.92,
        },
      ],
      warnings: ["wiki source page is too thin for direct answering"],
    },
    decision_trace: {
      question_type: "definition",
      current_object: "品牌经营OS",
      knowledge_goal: "补齐品牌经营OS的稳定定义",
      recommended_action: "ask_follow_up",
      target_missing_slots: ["scope", "purpose"],
      stop_reason: "continue",
    },
    llm_log: [
      {
        component: "query_engine",
        step: "search",
        input_summary: "query=什么是品牌经营OS？",
        output_summary: "hit wiki + raw",
        refs: ["wiki/topics/品牌经营os.md", "raw/industry_docs/电商运营本体核心文档.md"],
        warnings: ["wiki source page is too thin for direct answering"],
      },
    ],
  },
  turns: [
    {
      turn_index: 1,
      user_input: "什么是品牌经营OS？",
      answer_summary: "品牌经营OS强调长期经营。",
      answer_markdown: "## Fact\n品牌经营OS强调长期经营。",
      newly_filled_slots: ["current_object"],
      created_at: "2026-04-14T00:00:00Z",
      agent_trace: {
        stage_checks: [],
        retrieval_trace: {
          backend: "qmd",
          mode: "hybrid",
          collection: "wiki",
          retrieval_explain: [],
          wiki_hits: ["wiki/topics/品牌经营os.md"],
          raw_hits: [],
          top_hits: [],
          warnings: [],
        },
        decision_trace: {
          question_type: "definition",
          current_object: "品牌经营OS",
          knowledge_goal: "补齐品牌经营OS的稳定定义",
          recommended_action: "ask_follow_up",
          target_missing_slots: ["scope"],
          stop_reason: "continue",
        },
        llm_log: [],
      },
    },
  ],
  state_path: "memory/session/extraction/2026-04-14/extract-001.json",
});

const quickResult = ref({
  query_id: "ask-001",
  user_query: "什么是品牌经营OS？",
  answer_markdown: "## Fact\n品牌经营OS强调长期经营。",
  ranked_pages: ["wiki/topics/品牌经营os.md"],
  retrieved_pages: ["wiki/topics/品牌经营os.md"],
  retrieved_sources: ["raw/industry_docs/电商运营本体核心文档.md"],
  selected_evidence: [],
  question_classification: { question_type: "definition", confidence: 0.9, cues: ["definition-prefix"] },
  recalled_memory: {
    recent_session_summaries: [],
    persistent_interests: [],
    persistent_principles: [],
    open_loops: [],
  },
  writeback_plan: {
    query_id: "ask-001",
    targets: [
      {
        target: "wiki/decisions/品牌经营os-qa-note.md",
        action: "create",
        rationale: "高价值问答",
        confidence: 0.8,
        long_term_value: "可复用",
        evidence_refs: [],
        content_preview: "Quick 模式沉淀预览",
        approval_status: "pending",
      },
    ],
  },
  method_profile_id: "default-grounded",
  template_id: "core-four-part",
  retrieval_backend: "qmd",
  retrieval_mode: "hybrid",
  retrieval_collection: "wiki",
  retrieval_explain: ["bm25 title hit: 品牌经营OS"],
  agent_trace: {
    stage_checks: [
      {
        stage_id: "wiki_recall",
        label: "Agent 是否能从原始 wiki 中获得有用知识？",
        status: "partial",
        reason: "命中了 wiki/source，但正文过薄。",
        pass_criteria: "能召回，不乱引",
        evidence_refs: [
          "wiki/sources/6大维度42个细分变量选择逻辑01.md",
          "raw/industry_docs/6大维度·42个细分变量选择逻辑01.md",
        ],
        warnings: ["wiki source page is too thin for direct answering"],
      },
    ],
    retrieval_trace: {
      backend: "qmd",
      mode: "hybrid",
      collection: "wiki",
      retrieval_explain: ["bm25 title hit: 品牌经营OS"],
      wiki_hits: ["wiki/topics/品牌经营os.md"],
      raw_hits: ["raw/industry_docs/电商运营本体核心文档.md"],
      top_hits: [
        {
          path: "wiki/topics/品牌经营os.md",
          title: "品牌经营OS",
          score: 0.92,
        },
      ],
      warnings: [],
    },
    decision_trace: {
      question_type: "definition",
      current_object: "品牌经营OS",
      knowledge_goal: "解释品牌经营OS",
      recommended_action: "answer",
      target_missing_slots: [],
      stop_reason: "inactive",
    },
    llm_log: [
      {
        component: "query_engine",
        step: "search",
        input_summary: "query=什么是品牌经营OS？",
        output_summary: "hit wiki + raw",
        refs: ["wiki/topics/品牌经营os.md"],
        warnings: [],
      },
    ],
  },
  created_at: "2026-04-14T00:00:00Z",
  process_context: {
    current_stage: "第二阶段-产品塑造",
    current_step: "产品营销能力塑造",
    linked_rules: ["营销能力塑造校验项"],
    linked_cases: ["产品能力塑造表（视觉设计）"],
    linked_sources: ["raw/industry_docs/主干链路SOP.md"],
  },
  answer_grounding_blocks: [
    {
      label: "主干链路SOP",
      block_type: "evidence",
      text: "1. 类目可行性分析，确定最优叶子类目；2. 确定叶子类目后价格带地图（店铺+人群）",
      refs: ["raw/industry_docs/主干链路SOP.md"],
      stage: "第一环节-洞察分析",
      step: "类目可行性分析，确定最优叶子类目",
    },
  ],
  compile_warnings: [],
});

const recentMemory = ref({
  recent_queries: [],
  recent_session_summaries: [],
  persistent_interests: [],
  persistent_principles: [],
  open_loops: [],
});

const questionDraft = ref("什么是品牌经营OS？");
const followupAnswerDraft = ref("它是一套长期经营框架。");
const extractionSessionDraft = ref({
  title: "品牌经营OS访谈",
  topic_type: "strategy",
  target_object: "品牌经营OS",
  goal: "补齐品牌经营OS的稳定定义",
  created_by: "expert",
});

const selectCandidateQuestion = vi.fn((question: string) => {
  selectedCandidateQuestion.value = question;
});
const updateCandidateAsset = vi.fn((assetId: string, update: Record<string, unknown>) => {
  extractionState.value = {
    ...extractionState.value,
    candidate_assets: extractionState.value.candidate_assets.map((item) =>
      item.asset_id === assetId ? { ...item, ...update } : item,
    ),
  };
});

const finishExtraction = vi.fn(() => {
  extractionState.value = {
    ...extractionState.value,
    status: "completed",
    staged_writeback: {
      ...extractionState.value.staged_writeback,
      projected_writeback_level: "asset-level",
      asset_level: {
        rationale: "可以沉淀为候选资产",
      } as Record<string, unknown>,
    },
  };
});

vi.mock("@/features/query/useAskWorkspace", () => ({
  useAskWorkspace: () => ({
    mode,
    questionDraft,
    quickResult,
    extractionState,
    recentMemory,
    quickSections: computed(() => [{ title: "已知事实", body: "品牌经营OS强调长期经营。" }]),
    extractionSections: computed(() => [
      { title: "已知事实", body: "品牌经营OS强调长期经营。" },
      { title: "综合归纳", body: "它是一套长期协同框架。" },
    ]),
    loading: ref(false),
    error: ref(""),
    followupAnswerDraft,
    selectedCandidateQuestion,
    extractionSessionDraft,
    submitQuick: vi.fn(),
    startExtraction: vi.fn(),
    continueExtraction: vi.fn(),
    finishExtraction,
    updateCandidateAsset,
    switchMode: (nextMode: "extraction" | "quick") => {
      mode.value = nextMode;
    },
    resetExtraction: vi.fn(),
    selectCandidateQuestion,
    currentQuestionType: computed(() =>
      mode.value === "quick"
        ? quickResult.value.question_classification.question_type
        : extractionState.value.question_type,
    ),
    currentCues: computed(() =>
      mode.value === "quick" ? quickResult.value.question_classification.cues : [],
    ),
  }),
}));

function mountPage() {
  return mount(AskWorkspacePage, {
    global: {
      plugins: [createPinia()],
      stubs: {
        VChart: { template: "<div>chart</div>" },
      },
    },
  });
}

describe("AskWorkspacePage", () => {
  beforeEach(() => {
    mode.value = "extraction";
    selectedCandidateQuestion.value = "品牌经营OS的定义应该怎么表述才最稳定？";
  });

  it("renders the simplified single-flow interview agent by default", () => {
    const wrapper = mountPage();

    expect(wrapper.text()).toContain("交互式问答 Agent");
    expect(wrapper.text()).toContain("当前知识底座");
    expect(wrapper.text()).toContain("主干链路SOP");
    expect(wrapper.text()).toContain("当前在问：定义澄清");
    expect(wrapper.text()).toContain("正在围绕 第二阶段-产品塑造 推进");
    expect(wrapper.text()).toContain("自动保存");
    expect(wrapper.text()).toContain("品牌经营OS的定义应该怎么表述才最稳定？");
    expect(wrapper.text()).toContain("回答并继续");
    expect(wrapper.text()).toContain("跳过这个问题");
    expect(wrapper.text()).toContain("先总结一下");
    expect(wrapper.text()).toContain("概念 1");
    expect(wrapper.text()).toContain("规则 1");
    expect(wrapper.text()).toContain("边界 1");
    expect(wrapper.text()).not.toContain("Extraction Interview");
    expect(wrapper.text()).not.toContain("Quick Answer");
    expect(wrapper.text()).not.toContain("分析详情");
    expect(wrapper.text()).not.toContain("Agent Trace");
    expect(wrapper.text()).toContain("第二阶段-产品塑造");
    expect(wrapper.text()).toContain("产品营销能力塑造");
    expect(wrapper.text()).toContain("主干链路先看类目可行性分析");
    expect(wrapper.text()).toContain("确定叶子类目后价格带地图（店铺+人群）");
  });

  it("updates the current prompt when a candidate question is clicked", async () => {
    const wrapper = mountPage();

    const buttons = wrapper.findAll("button").filter((button) => button.text().includes("追问适用范围"));
    await buttons[0].trigger("click");

    expect(selectCandidateQuestion).toHaveBeenCalledWith("追问适用范围");
    expect(wrapper.text()).toContain("追问适用范围");
  });

  it("shows the completed extraction state after finish", async () => {
    const wrapper = mountPage();

    const finishButton = wrapper.findAll("button").find((button) => button.text().includes("结束"));
    await finishButton?.trigger("click");

    expect(finishExtraction).toHaveBeenCalled();
    expect(wrapper.text()).toContain("采掘已完成");
    expect(wrapper.text()).toContain("继续补充");
  });

  it("opens the structure drawer and allows lightweight asset confirmation", async () => {
    const wrapper = mountPage();

    const drawerButton = wrapper.findAll("button").find((button) => button.text().includes("展开查看"));
    await drawerButton?.trigger("click");

    const confirmButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("确认") && button.attributes("data-asset-id") === "concept-brand-os");

    await confirmButton?.trigger("click");

    expect(updateCandidateAsset).toHaveBeenCalledWith("concept-brand-os", { status: "confirmed" });
    expect(wrapper.text()).toContain("confirmed");
  });

  it("keeps diagnostics hidden by default but can open them on demand", async () => {
    const wrapper = mountPage();

    expect(wrapper.text()).not.toContain("阶段判断");
    const diagnoseButton = wrapper.findAll("button").find((button) => button.text().includes("查看诊断"));
    await diagnoseButton?.trigger("click");

    expect(wrapper.text()).toContain("Agent Trace");
    expect(wrapper.text()).toContain("检索链路");
  });

  it("shows process refs in the structure drawer instead of the default canvas", async () => {
    const wrapper = mountPage();
    const drawerButton = wrapper.findAll("button").find((button) => button.text().includes("展开查看"));
    await drawerButton?.trigger("click");

    expect(wrapper.text()).toContain("stage: 第二阶段-产品塑造");
    expect(wrapper.text()).toContain("step: 产品营销能力塑造");
    expect(wrapper.text()).toContain("mainline_step");
    expect(wrapper.text()).toContain("judgement");
    expect(wrapper.text()).toContain("以后再说");
  });
});
