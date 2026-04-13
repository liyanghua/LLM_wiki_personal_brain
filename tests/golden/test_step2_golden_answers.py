from __future__ import annotations

from personal_brain.config import BrainConfig
from personal_brain.retrieval.query_engine import QueryEngine


def test_golden_answer_contains_structured_sections_and_citations(built_brain_workspace) -> None:
    result = QueryEngine(BrainConfig(root=built_brain_workspace)).ask("品牌经营OS和SUPER指标之间是什么关系？")

    assert "## Fact" in result.answer_markdown
    assert "## Synthesis" in result.answer_markdown
    assert "## Interpretation" in result.answer_markdown
    assert "## Recommendation" in result.answer_markdown
    assert "## Citations" in result.answer_markdown
    assert "wiki/topics/品牌经营os.md" in result.answer_markdown
    assert "raw/industry_docs/货品全生命周期管理-SUPER指标模型.md" in result.answer_markdown


def test_golden_repeated_topic_creates_memory_proposal_without_auto_write(built_brain_workspace) -> None:
    engine = QueryEngine(BrainConfig(root=built_brain_workspace))
    engine.ask("什么是品牌经营OS？")
    repeated = engine.ask("品牌经营OS有什么长期价值？")

    assert repeated.persistent_memory_proposals
    assert not repeated.applied_memory_writes
