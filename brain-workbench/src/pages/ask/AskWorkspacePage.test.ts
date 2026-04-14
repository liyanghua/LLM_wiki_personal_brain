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
  status: "in_progress",
  question_type: "definition",
  turn_index: 1,
  current_object: "品牌经营OS",
  current_knowledge_goal: "补齐品牌经营OS的稳定定义",
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
  created_at: "2026-04-14T00:00:00Z",
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

const selectCandidateQuestion = vi.fn((question: string) => {
  selectedCandidateQuestion.value = question;
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
    submitQuick: vi.fn(),
    startExtraction: vi.fn(),
    continueExtraction: vi.fn(),
    finishExtraction,
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

  it("renders mode switcher and extraction panels", () => {
    const wrapper = mountPage();

    expect(wrapper.text()).toContain("Extraction Interview");
    expect(wrapper.text()).toContain("Quick Answer");
    expect(wrapper.text()).toContain("品牌经营OS");
    expect(wrapper.text()).toContain("补齐品牌经营OS的稳定定义");
    expect(wrapper.text()).toContain("knowledge-level");
  });

  it("updates the current prompt when a candidate question is clicked", async () => {
    const wrapper = mountPage();

    const buttons = wrapper.findAll("button").filter((button) => button.text().includes("适用范围"));
    await buttons[0].trigger("click");

    expect(selectCandidateQuestion).toHaveBeenCalledWith("品牌经营OS的适用范围是什么？");
    expect(wrapper.text()).toContain("品牌经营OS的适用范围是什么？");
  });

  it("shows the completed extraction state after finish", async () => {
    const wrapper = mountPage();

    const finishButton = wrapper.findAll("button").find((button) => button.text().includes("结束并查看沉淀"));
    await finishButton?.trigger("click");

    expect(finishExtraction).toHaveBeenCalled();
    expect(wrapper.text()).toContain("completed");
    expect(wrapper.text()).toContain("asset-level");
  });

  it("renders the quick answer layout when quick mode is active", async () => {
    mode.value = "quick";
    const wrapper = mountPage();

    expect(wrapper.text()).toContain("结构化结论");
    expect(wrapper.text()).toContain("Quick 模式沉淀预览");
  });
});
