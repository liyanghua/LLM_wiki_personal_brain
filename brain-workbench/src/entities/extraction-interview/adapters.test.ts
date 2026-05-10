import { toExtractionInterviewEntity } from "./adapters";

describe("extraction interview adapters", () => {
  it("normalizes legacy payloads with nullable fields", () => {
    const payload = toExtractionInterviewEntity({
      interview_id: "extract-legacy",
      interaction_mode: "extraction-interview",
      status: "in_progress",
      question_type: "definition",
      turn_index: 1,
      current_object: "品牌经营OS",
      current_knowledge_goal: "补齐品牌经营OS的稳定定义",
      known_slots: {
        current_object: "品牌经营OS",
      },
      missing_slots: ["definition"],
      retrieval_buckets: null,
      current_answer_markdown: "",
      current_answer_summary: "",
      next_question_plan: null,
      stop_decision: null,
      staged_writeback: null,
      session: null,
      candidate_assets: null,
      followup_questions: null,
      session_summary: null,
      state_path: null,
    });

    expect(payload.state_path).toBe("");
    expect(payload.retrieval_buckets.object_pages).toEqual([]);
    expect(payload.session.session_id).toBe("extract-legacy");
    expect(payload.candidate_assets).toEqual([]);
    expect(payload.followup_questions).toEqual([]);
    expect(payload.session_summary.session_id).toBe("extract-legacy");
    expect(payload.next_question_plan.target_missing_slots).toEqual(["definition"]);
    expect(payload.stop_decision.reason).toBe("continue");
    expect(payload.staged_writeback.projected_writeback_level).toBe("session-level");
  });

  it("materializes interview_view, autosave_state, and degraded retrieval metadata", () => {
    const payload = toExtractionInterviewEntity({
      interview_id: "extract-agent",
      interaction_mode: "extraction-interview",
      status: "in_progress",
      question_type: "definition",
      turn_index: 1,
      current_object: "主干链路SOP",
      current_knowledge_goal: "梳理主链路步骤",
      known_slots: {},
      missing_slots: ["steps"],
      retrieval_buckets: {
        object_pages: [],
        evidence_pages: [],
        conversation_hits: [],
        pattern_hits: [],
        ranked_page_paths: [],
        retrieved_sources: [],
      },
      current_answer_markdown: "## 直接答案\n主链路先看类目可行性分析。",
      current_answer_summary: "主链路先看类目可行性分析。",
      next_question_plan: {
        next_question_type: "slot-fill",
        candidate_questions: ["产品塑造阶段有哪些关键判断？"],
        target_missing_slots: ["steps"],
        stop_if: ["all target missing slots are filled"],
      },
      stop_decision: {
        should_stop: false,
        reason: "continue",
        confidence: 0.8,
      },
      staged_writeback: {
        session_level: {},
        knowledge_level: null,
        asset_level: null,
        projected_writeback_level: "session-level",
      },
      session: {
        session_id: "extract-agent",
        title: "主干链路访谈",
        topic_type: "topic",
        target_object: "主干链路SOP",
        goal: "梳理主链路步骤",
        status: "in_progress",
        created_by: "expert",
        created_at: "2026-04-16T00:00:00Z",
        completed_at: null,
        current_stage: "第一环节-洞察分析",
        current_step: "类目可行性分析，确定最优叶子类目",
      },
      candidate_assets: [],
      followup_questions: [],
      session_summary: null,
      current_trace: null,
      state_path: "memory/session/extraction/2026-04-16/extract-agent.json",
      interview_view: {
        current_prompt: "产品塑造阶段有哪些关键判断？",
        prompt_type_label: "当前在问：关键缺口",
        phase_label: "正在围绕 第一环节-洞察分析 推进",
        recommended_followups: ["追问关键判断"],
        structure_counts: {
          concepts: 1,
          heuristics: 2,
          cases: 0,
          boundaries: 1,
        },
        can_skip: true,
        can_summarize: true,
        autosave_state: "saved",
      },
      autosave_state: {
        saved: true,
        state_path: "memory/session/extraction/2026-04-16/extract-agent.json",
        updated_at: "2026-04-16T00:00:00Z",
        status: "saved",
      },
      degraded_retrieval_mode: {
        active: true,
        configured_backend: "qmd",
        actual_backend: "legacy",
        reason: "qmd unavailable or returned no mappable hits",
      },
    });

    expect(payload.interview_view.current_prompt).toBe("产品塑造阶段有哪些关键判断？");
    expect(payload.interview_view.structure_counts.heuristics).toBe(2);
    expect(payload.autosave_state.saved).toBe(true);
    expect(payload.degraded_retrieval_mode.active).toBe(true);
  });

  it("materializes SOP anchor fields, answer_frame, card groups, and gap types", () => {
    const payload = toExtractionInterviewEntity({
      interview_id: "extract-sop",
      interaction_mode: "extraction-interview",
      status: "in_progress",
      question_type: "open-ended-synthesis",
      turn_index: 1,
      current_object: "主干链路SOP",
      current_knowledge_goal: "提炼主链路步骤表",
      current_stage: "第一环节-洞察分析",
      current_step: "类目可行性分析，确定最优叶子类目",
      process_context: {
        current_stage: "第一环节-洞察分析",
        current_step: "类目可行性分析，确定最优叶子类目",
        linked_rules: [],
        linked_cases: [],
        linked_sources: ["raw/industry_docs/主干链路SOP.md"],
        anchor_bundle_id: "sop_mainline_001",
        anchor_paths: [
          "raw/industry_docs/主干链路SOP.md",
          "raw/industry_docs/主干链路SOP.graph.json",
          "raw/industry_docs/主干链路SOP.meta.yaml",
        ],
        matched_block_ids: ["mainline-step-1"],
        answer_mode: "mainline_step_question",
      },
      known_slots: {},
      missing_slots: ["judgement"],
      retrieval_buckets: {
        object_pages: [],
        evidence_pages: [],
        conversation_hits: [],
        pattern_hits: [],
        ranked_page_paths: [],
        retrieved_sources: [],
      },
      current_answer_markdown: "## 直接答案\n主干链路先看类目可行性分析。",
      current_answer_summary: "主干链路先看类目可行性分析。",
      next_question_plan: null,
      stop_decision: null,
      staged_writeback: null,
      session: null,
      candidate_assets: [
        {
          asset_id: "mainline-step-1",
          session_id: "extract-sop",
          asset_type: "heuristic",
          title: "类目可行性分析，确定最优叶子类目",
          summary: "主链路步骤 1",
          confidence: 0.9,
          card_group: "mainline_step",
          card_order: 1,
          anchor_block_refs: ["mainline-step-1"],
        },
      ],
      followup_questions: [
        {
          question_id: "followup-judgement",
          session_id: "extract-sop",
          question_text: "这个步骤最关键的判断标准是什么？",
          question_type: "judgement",
          reason: "补关键判断",
          gap_type: "judgement_gap",
        },
      ],
      session_summary: null,
      interview_view: {
        current_prompt: "这个步骤最关键的判断标准是什么？",
        prompt_type_label: "当前在问：关键判断",
        phase_label: "正在围绕 第一环节-洞察分析 推进",
        recommended_followups: ["这个步骤最关键的判断标准是什么？"],
        structure_counts: {
          concepts: 0,
          heuristics: 1,
          cases: 0,
          boundaries: 0,
        },
        answer_frame: {
          primary_answer: "主干链路先看类目可行性分析。",
          mainline_steps: ["类目可行性分析，确定最优叶子类目"],
          key_judgements: ["先确定最优叶子类目"],
          evidence_refs: ["raw/industry_docs/主干链路SOP.md"],
        },
      },
      state_path: "memory/session/extraction/2026-04-16/extract-sop.json",
    });

    expect(payload.process_context.anchor_bundle_id).toBe("sop_mainline_001");
    expect(payload.process_context.answer_mode).toBe("mainline_step_question");
    expect(payload.interview_view.answer_frame.mainline_steps).toEqual([
      "类目可行性分析，确定最优叶子类目",
    ]);
    expect(payload.candidate_assets[0].card_group).toBe("mainline_step");
    expect(payload.candidate_assets[0].anchor_block_refs).toEqual(["mainline-step-1"]);
    expect(payload.followup_questions[0].gap_type).toBe("judgement_gap");
  });
});
