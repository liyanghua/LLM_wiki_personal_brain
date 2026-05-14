import { toAskResultEntity } from "./adapters";

describe("ask result schema", () => {
  it("parses an ask payload with observability fields", () => {
    const payload = toAskResultEntity({
      query_id: "ask-001",
      user_query: "6大维度首先看哪个维度？",
      answer_markdown: "## Fact\n维度1：视觉核心层（决定第一眼停留）",
      ranked_pages: ["wiki/sources/6大维度42个细分变量选择逻辑01.md"],
      retrieved_pages: ["wiki/sources/6大维度42个细分变量选择逻辑01.md"],
      retrieved_sources: ["raw/industry_docs/6大维度·42个细分变量选择逻辑01.md"],
      selected_evidence: [],
      question_classification: {
        question_type: "definition",
        confidence: 0.94,
        cues: ["dimension-priority"],
      },
      recalled_memory: {
        recent_session_summaries: [],
        persistent_interests: [],
        persistent_principles: [],
        open_loops: [],
      },
      method_profile_id: "default-grounded",
      template_id: "core-four-part",
      retrieval_backend: "qmd",
      retrieval_mode: "hybrid",
      retrieval_collection: "wiki",
      retrieval_explain: ["bm25 title hit: 6大维度"],
      agent_trace: {
        stage_checks: [
          {
            stage_id: "wiki_recall",
            label: "Agent 是否能从原始 wiki 中获得有用知识？",
            status: "partial",
            reason: "召回到了 wiki 页面，但正文过薄。",
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
          retrieval_explain: ["bm25 title hit: 6大维度"],
          wiki_hits: ["wiki/sources/6大维度42个细分变量选择逻辑01.md"],
          raw_hits: ["raw/industry_docs/6大维度·42个细分变量选择逻辑01.md"],
          top_hits: [
            {
              path: "wiki/sources/6大维度42个细分变量选择逻辑01.md",
              title: "6大维度·42个细分变量选择逻辑01",
              score: 0.91,
            },
          ],
          warnings: ["wiki source page is too thin for direct answering"],
        },
        decision_trace: {
          question_type: "definition",
          current_object: "6大维度",
          knowledge_goal: "回答首先看哪个维度",
          recommended_action: "answer-with-raw-evidence",
          target_missing_slots: [],
          stop_reason: "inactive",
        },
        llm_log: [
          {
            component: "query_engine",
            step: "search",
            input_summary: "query=6大维度首先看哪个维度",
            output_summary: "wiki hit + raw support hit",
            refs: [
              "wiki/sources/6大维度42个细分变量选择逻辑01.md",
              "raw/industry_docs/6大维度·42个细分变量选择逻辑01.md",
            ],
            warnings: ["wiki source page is too thin for direct answering"],
          },
        ],
      },
      created_at: "2026-04-14T00:00:00Z",
    });

    expect(payload.retrieval_backend).toBe("qmd");
    expect(payload.agent_trace.stage_checks[0]?.status).toBe("partial");
    expect(payload.agent_trace.llm_log[0]?.warnings?.[0]).toContain("too thin");
  });
});
