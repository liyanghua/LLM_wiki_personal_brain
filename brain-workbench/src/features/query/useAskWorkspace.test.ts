import { defineComponent } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { useAskWorkspace } from "./useAskWorkspace";
import {
  continueExtractionInterview,
  finishExtractionInterview,
  getExtractionInterview,
  startExtractionInterview,
} from "./api";
import { loadRecentMemory } from "@/features/memory/api";

vi.mock("./api", () => ({
  askQuestion: vi.fn(),
  startExtractionInterview: vi.fn(),
  getExtractionInterview: vi.fn(),
  continueExtractionInterview: vi.fn(),
  finishExtractionInterview: vi.fn(),
}));

vi.mock("@/features/memory/api", () => ({
  loadRecentMemory: vi.fn(),
}));

const sampleExtractionState = {
  interview_id: "extract-001",
  interaction_mode: "extraction-interview" as const,
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
});
