import { extractionInterviewStateSchema } from "./schema";

describe("extraction interview schema", () => {
  it("parses a valid extraction interview payload", () => {
    const payload = extractionInterviewStateSchema.parse({
      interview_id: "extract-001",
      interaction_mode: "extraction-interview",
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
      state_path: "memory/session/extraction/2026-04-14/extract-001.json",
    });

    expect(payload.interview_id).toBe("extract-001");
    expect(payload.next_question_plan.candidate_questions[0]).toContain("适用范围");
  });

  it("rejects payloads missing required top-level fields", () => {
    expect(() =>
      extractionInterviewStateSchema.parse({
        interview_id: "extract-001",
      }),
    ).toThrow();
  });
});
