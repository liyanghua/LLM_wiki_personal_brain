import { extractionInterviewStateSchema } from "./schema";

describe("extraction interview schema", () => {
  it("parses a valid extraction interview payload", () => {
    const payload = extractionInterviewStateSchema.parse({
      interview_id: "extract-001",
      interaction_mode: "extraction-interview",
      session: {
        session_id: "extract-001",
        title: "品牌经营OS访谈",
        topic_type: "strategy",
        target_object: "品牌经营OS",
        goal: "补齐稳定定义",
        status: "in_progress",
        created_by: "expert",
        created_at: "2026-04-14T00:00:00Z",
        completed_at: null,
      },
      status: "in_progress",
      question_type: "definition",
      turn_index: 2,
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
            snippet: "品牌经营OS强调长期经营与协同。",
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
            snippet: "品牌经营OS强调长期经营与协同。",
            relevance_score: 0.94,
          },
        ],
        conversation_hits: [],
        pattern_hits: [],
        ranked_page_paths: ["wiki/topics/品牌经营os.md"],
        retrieved_sources: ["raw/industry_docs/电商运营本体核心文档.md"],
      },
      current_answer_markdown: "## Fact\n品牌经营OS强调长期经营。",
      current_answer_summary: "品牌经营OS强调长期经营。",
      next_question_plan: {
        next_question_type: "slot-fill",
        candidate_questions: ["品牌经营OS的适用范围是什么？"],
        target_missing_slots: ["scope"],
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
          source_turn_ids: [1, 2],
          evidence_refs: ["raw/industry_docs/电商运营本体核心文档.md"],
          status: "draft",
          expert_note: "",
        },
      ],
      followup_questions: [
        {
          question_id: "followup-definition",
          session_id: "extract-001",
          question_text: "品牌经营OS的适用范围是什么？",
          question_type: "definition",
          reason: "范围边界仍缺失",
          priority: "high",
          status: "open",
          source_asset_ids: ["concept-brand-os"],
          target_missing_slots: ["scope"],
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
        unresolved_items: ["scope"],
      },
      state_path: "memory/session/extraction/2026-04-14/extract-001.json",
    });

    expect(payload.interview_id).toBe("extract-001");
    expect(payload.session?.title).toBe("品牌经营OS访谈");
    expect(payload.candidate_assets?.[0]?.asset_type).toBe("concept");
    expect(payload.followup_questions?.[0]?.priority).toBe("high");
    expect(payload.next_question_plan?.candidate_questions?.[0]).toContain("适用范围");
  });

  it("rejects payloads missing required top-level fields", () => {
    expect(() =>
      extractionInterviewStateSchema.parse({
        interview_id: "extract-001",
      }),
    ).toThrow();
  });
});
