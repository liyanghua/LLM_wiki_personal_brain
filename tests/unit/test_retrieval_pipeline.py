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
