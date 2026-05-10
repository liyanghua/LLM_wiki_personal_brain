from __future__ import annotations

from personal_brain.config import BrainConfig
from personal_brain.retrieval.answer_planner import AnswerPlanner
from personal_brain.retrieval.evidence_selector import EvidenceSelector
from personal_brain.retrieval.page_ranker import PageRanker
from personal_brain.retrieval.question_classifier import QuestionClassifier
from personal_brain.retrieval.query_engine import QueryEngine


def test_question_classifier_handles_multiple_query_styles() -> None:
    classifier = QuestionClassifier()

    assert classifier.classify("什么是品牌经营OS？").question_type == "definition"
    assert classifier.classify("比较品牌经营OS和SUPER指标模型").question_type == "comparison"
    assert classifier.classify("儿童学习桌垫单因子测图项目目前聚焦什么？").question_type == "project-status"
    assert classifier.classify("如何设计一个持续进化的品牌经营方法？").question_type == "procedural"


def test_page_ranker_prefers_multi_page_relevance(built_brain_workspace) -> None:
    engine = QueryEngine(BrainConfig(root=built_brain_workspace))
    candidates = engine.load_candidates()
    ranked = PageRanker().rank("品牌经营OS和SUPER指标有什么关系？", candidates)

    titles = [item.page.title for item in ranked[:3]]
    assert "品牌经营OS" in titles
    assert any("SUPER" in title for title in titles)
    assert len([item for item in ranked[:5] if item.score >= 3]) >= 2


def test_evidence_selector_preserves_page_and_source_refs(built_brain_workspace) -> None:
    engine = QueryEngine(BrainConfig(root=built_brain_workspace))
    ranked = PageRanker().rank("什么是品牌经营OS？", engine.load_candidates())
    selected = EvidenceSelector().select(ranked, limit=3)

    assert selected
    assert all(item.page_path.startswith("wiki/") for item in selected)
    assert any(item.source_refs for item in selected)


def test_answer_planner_produces_required_sections() -> None:
    plan = AnswerPlanner().plan(
        question="什么是品牌经营OS？",
        question_type="definition",
        evidence=[],
        recalled_memory=None,
    )

    assert [section.name for section in plan.sections] == [
        "fact",
        "synthesis",
        "interpretation",
        "recommendation",
    ]


def test_query_engine_emits_agent_trace_for_thin_wiki_source_case(built_brain_workspace) -> None:
    engine = QueryEngine(BrainConfig(root=built_brain_workspace))

    result = engine.ask("6大维度首先看哪个维度？")

    assert result.agent_trace.stage_checks
    assert {stage.stage_id for stage in result.agent_trace.stage_checks} == {
        "wiki_recall",
        "context_expand",
        "ontology_decision",
        "skill_reuse",
    }
    wiki_recall = next(stage for stage in result.agent_trace.stage_checks if stage.stage_id == "wiki_recall")
    assert wiki_recall.status == "partial"
    assert any("wiki source page is too thin for direct answering" in warning for warning in wiki_recall.warnings)
    assert any(ref.endswith("wiki/sources/6大维度42个细分变量选择逻辑01.md") for ref in wiki_recall.evidence_refs)
    assert any(ref.endswith("raw/industry_docs/6大维度·42个细分变量选择逻辑01.md") for ref in wiki_recall.evidence_refs)
    assert result.agent_trace.retrieval_trace["backend"] in {"legacy", "qmd"}
    assert result.agent_trace.retrieval_trace["top_hits"]
    assert result.agent_trace.llm_log


def test_query_engine_uses_raw_thin_source_snippet_in_answer_for_priority_question(built_brain_workspace) -> None:
    engine = QueryEngine(BrainConfig(root=built_brain_workspace))

    result = engine.ask("6大维度首先看哪个维度？")

    assert "维度1：视觉核心层（决定第一眼停留）" in result.answer_markdown
    assert any(
        item.page_path == "raw/industry_docs/6大维度·42个细分变量选择逻辑01.md"
        and "维度1：视觉核心层（决定第一眼停留）" in item.snippet
        for item in result.selected_evidence
    )


def test_query_engine_returns_process_context_for_process_question(built_brain_workspace) -> None:
    engine = QueryEngine(BrainConfig(root=built_brain_workspace))

    result = engine.ask("主干链路SOP里产品塑造阶段要看哪些关键判断？")

    assert result.process_context.current_stage == "第二阶段-产品塑造"
    assert result.process_context.current_step
    assert any("第二阶段-产品塑造" in page for page in result.retrieved_pages + result.ranked_pages)
    assert result.process_context.linked_rules
    assert result.process_context.linked_sources


def test_query_engine_returns_structured_process_answer_and_grounding_blocks(built_brain_workspace) -> None:
    engine = QueryEngine(BrainConfig(root=built_brain_workspace))

    result = engine.ask("主干链路首先看哪几个步骤？")

    assert "主链路步骤" in result.answer_markdown
    assert "类目可行性分析" in result.answer_markdown
    assert result.answer_grounding_blocks
    assert any(block.stage for block in result.answer_grounding_blocks)
    assert any(ref.endswith("raw/industry_docs/主干链路SOP.md") for block in result.answer_grounding_blocks for ref in block.refs)


def test_query_engine_marks_non_sop_priority_question_as_out_of_scope_when_session_is_sop_anchored(
    built_brain_workspace,
) -> None:
    engine = QueryEngine(BrainConfig(root=built_brain_workspace))
    ranked, _ = engine.rank_pages("主干链路首先看哪几个步骤？", "procedural")
    selected = EvidenceSelector().select(ranked, limit=3)
    assert engine.detect_sop_answer_mode("6大维度首先看哪个维度", ranked, selected) == "out_of_scope"


def test_query_engine_prioritizes_process_pages_for_process_questions(built_brain_workspace) -> None:
    engine = QueryEngine(BrainConfig(root=built_brain_workspace))

    result = engine.ask("主干链路SOP里产品塑造阶段要看哪些关键判断？")

    assert result.ranked_pages
    assert result.ranked_pages[0].startswith(("wiki/stages/", "wiki/steps/", "wiki/主干链路SOP.md"))
