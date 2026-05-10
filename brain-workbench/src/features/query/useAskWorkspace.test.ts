import { defineComponent } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { useAskWorkspace } from "./useAskWorkspace";
import { toExtractionInterviewEntity } from "@/entities/extraction-interview/adapters";
import {
  continueExtractionInterview,
  finishExtractionInterview,
  getExtractionInterview,
  startExtractionInterview,
  updateExtractionCandidateAsset,
} from "./api";
import { loadRecentMemory } from "@/features/memory/api";

vi.mock("./api", () => ({
  askQuestion: vi.fn(),
  startExtractionInterview: vi.fn(),
  getExtractionInterview: vi.fn(),
  continueExtractionInterview: vi.fn(),
  finishExtractionInterview: vi.fn(),
  updateExtractionCandidateAsset: vi.fn(),
}));

vi.mock("@/features/memory/api", () => ({
  loadRecentMemory: vi.fn(),
}));

const sampleExtractionState = {
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
    completed_at: null,
  },
  status: "in_progress",
  question_type: "definition",
  turn_index: 1,
  current_object: "品牌经营OS",
  current_knowledge_goal: "补齐品牌经营OS的稳定定义",
  known_slots: {
    current_object: "品牌经营OS",
  },
  missing_slots: ["definition", "scope"],
  retrieval_buckets: {
    object_pages: [],
    evidence_pages: [],
    conversation_hits: [],
    pattern_hits: [],
    ranked_page_paths: [],
    retrieved_sources: [],
  },
  current_answer_markdown: "## Fact\n品牌经营OS强调长期经营。",
  current_answer_summary: "品牌经营OS强调长期经营。",
  next_question_plan: {
    next_question_type: "slot-fill",
    candidate_questions: ["品牌经营OS的定义应该怎么表述才最稳定？"],
    target_missing_slots: ["definition"],
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
    knowledge_level: null,
    asset_level: null,
    projected_writeback_level: "session-level",
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
    },
  ],
  session_summary: {
    summary_id: "summary-extract-001",
    session_id: "extract-001",
    summary_text: "当前已经沉淀出品牌经营OS的初步定义。",
    key_concepts: ["品牌经营OS"],
    key_heuristics: [],
    key_cases: [],
    key_boundaries: [],
    unresolved_items: ["definition", "scope"],
  },
  interview_view: {
    current_prompt: "品牌经营OS的定义应该怎么表述才最稳定？",
    prompt_type_label: "当前在问：定义澄清",
    phase_label: "正在围绕 第二阶段-产品塑造 推进",
    recommended_followups: ["追问适用范围"],
    structure_counts: {
      concepts: 1,
      heuristics: 0,
      cases: 0,
      boundaries: 0,
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
  state_path: "memory/session/extraction/2026-04-14/extract-001.json",
};

const recentMemoryPayload = {
  recent_queries: [],
  recent_session_summaries: [],
  persistent_interests: [],
  persistent_principles: [],
  open_loops: [],
};

const Harness = defineComponent({
  setup() {
    return useAskWorkspace();
  },
  template: "<div />",
});

describe("useAskWorkspace", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.mocked(loadRecentMemory).mockResolvedValue(recentMemoryPayload as never);
    vi.mocked(startExtractionInterview).mockResolvedValue(sampleExtractionState as never);
    vi.mocked(getExtractionInterview).mockResolvedValue(sampleExtractionState as never);
    vi.mocked(continueExtractionInterview).mockResolvedValue(sampleExtractionState as never);
    vi.mocked(updateExtractionCandidateAsset).mockResolvedValue({
      ...sampleExtractionState,
      candidate_assets: sampleExtractionState.candidate_assets.map((item) => ({
        ...item,
        status: "confirmed",
      })),
    } as never);
    vi.mocked(finishExtractionInterview).mockResolvedValue({
      ...sampleExtractionState,
      status: "completed",
      staged_writeback: {
        ...sampleExtractionState.staged_writeback,
        projected_writeback_level: "knowledge-level",
      },
    } as never);
    window.history.replaceState({}, "", "/workspace/ask");
  });

  it("defaults to extraction mode and syncs the URL", async () => {
    const wrapper = mount(Harness, {
      global: { plugins: [createPinia()] },
    });

    await flushPromises();

    expect(wrapper.vm.mode).toBe("extraction");
    expect(window.location.search).toContain("mode=extraction");
  });

  it("restores an extraction interview from the URL", async () => {
    window.history.replaceState({}, "", "/workspace/ask?mode=extraction&interview_id=extract-001");

    const wrapper = mount(Harness, {
      global: { plugins: [createPinia()] },
    });

    await flushPromises();

    expect(getExtractionInterview).toHaveBeenCalledWith("extract-001");
    expect(wrapper.vm.extractionState?.interview_id).toBe("extract-001");
    expect(wrapper.vm.selectedCandidateQuestion).toContain("定义");
  });

  it("keeps extraction state when switching between quick and extraction", async () => {
    const wrapper = mount(Harness, {
      global: { plugins: [createPinia()] },
    });

    await flushPromises();
    await wrapper.vm.startExtraction("什么是品牌经营OS？");

    expect(wrapper.vm.extractionState?.interview_id).toBe("extract-001");

    wrapper.vm.switchMode("quick");
    expect(wrapper.vm.mode).toBe("quick");
    expect(window.location.search).toContain("mode=quick");

    wrapper.vm.switchMode("extraction");
    expect(wrapper.vm.mode).toBe("extraction");
    expect(wrapper.vm.extractionState?.interview_id).toBe("extract-001");
    expect(window.location.search).toContain("interview_id=extract-001");
  });

  it("sends session metadata when starting extraction", async () => {
    const wrapper = mount(Harness, {
      global: { plugins: [createPinia()] },
    });

    await flushPromises();
    await wrapper.vm.startExtraction("什么是品牌经营OS？", {
      title: "品牌经营OS访谈",
      topic_type: "strategy",
      target_object: "品牌经营OS",
      goal: "补齐稳定定义",
      created_by: "expert",
    });

    expect(startExtractionInterview).toHaveBeenCalledWith("什么是品牌经营OS？", {
      title: "品牌经营OS访谈",
      topic_type: "strategy",
      target_object: "品牌经营OS",
      goal: "补齐稳定定义",
      created_by: "expert",
    });
  });

  it("restores a legacy extraction interview and continues without losing the interview id", async () => {
    window.history.replaceState({}, "", "/workspace/ask?mode=extraction&interview_id=extract-001");
    vi.mocked(getExtractionInterview).mockResolvedValue(
      toExtractionInterviewEntity({
        ...sampleExtractionState,
        retrieval_buckets: null,
        next_question_plan: null,
        stop_decision: null,
        staged_writeback: null,
        state_path: null,
      }) as never,
    );
    vi.mocked(continueExtractionInterview).mockResolvedValue({
      ...sampleExtractionState,
      turn_index: 2,
      state_path: "memory/session/extraction/2026-04-14/extract-001.json",
    } as never);

    const wrapper = mount(Harness, {
      global: { plugins: [createPinia()] },
    });

    await flushPromises();
    await wrapper.vm.continueExtraction("它是一套长期经营框架。");

    expect(continueExtractionInterview).toHaveBeenCalledWith("extract-001", {
      turn_action: "answer",
      user_answer: "它是一套长期经营框架。",
    });
    expect(wrapper.vm.extractionState?.interview_id).toBe("extract-001");
    expect(window.location.search).toContain("interview_id=extract-001");
  });

  it("updates candidate asset status without losing the current interview state", async () => {
    const wrapper = mount(Harness, {
      global: { plugins: [createPinia()] },
    });

    await flushPromises();
    await wrapper.vm.startExtraction("什么是品牌经营OS？");
    await wrapper.vm.updateCandidateAsset("concept-brand-os", {
      status: "confirmed",
      summary: "一套更稳定的定义",
      expert_note: "专家确认这条定义成立。",
    });

    expect(updateExtractionCandidateAsset).toHaveBeenCalledWith("extract-001", "concept-brand-os", {
      status: "confirmed",
      summary: "一套更稳定的定义",
      expert_note: "专家确认这条定义成立。",
    });
    expect(wrapper.vm.extractionState?.candidate_assets?.[0]?.status).toBe("confirmed");
  });

  it("uses chat-style validation copy when the follow-up answer is empty", async () => {
    const wrapper = mount(Harness, {
      global: { plugins: [createPinia()] },
    });

    await flushPromises();
    await wrapper.vm.startExtraction("什么是品牌经营OS？");
    await wrapper.vm.continueExtraction("   ");

    expect(wrapper.vm.error).toBe("请输入你的回答");
    expect(continueExtractionInterview).not.toHaveBeenCalled();
  });

  it("can skip and summarize without losing the current interview id", async () => {
    const wrapper = mount(Harness, {
      global: { plugins: [createPinia()] },
    });

    await flushPromises();
    await wrapper.vm.startExtraction("什么是品牌经营OS？");
    await wrapper.vm.skipExtraction();
    await wrapper.vm.summarizeExtraction();

    expect(continueExtractionInterview).toHaveBeenNthCalledWith(1, "extract-001", {
      turn_action: "skip",
    });
    expect(continueExtractionInterview).toHaveBeenNthCalledWith(2, "extract-001", {
      turn_action: "summarize",
    });
    expect(wrapper.vm.extractionState?.interview_id).toBe("extract-001");
  });
});
