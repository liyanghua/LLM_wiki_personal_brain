from __future__ import annotations

from personal_brain.agent.memory_policy import MemoryPolicy
from personal_brain.agent.style_engine import StyleEngine
from personal_brain.agent.style_profile_loader import StyleProfileLoader
from personal_brain.config import BrainConfig
from personal_brain.models import EvidenceItem, MemoryRecallBundle


def test_memory_policy_only_proposes_durable_persistent_writes() -> None:
    policy = MemoryPolicy()
    recall = MemoryRecallBundle(
        recent_session_summaries=["品牌经营OS相关问题已经连续出现。"],
        persistent_interests=["品牌经营OS"],
        persistent_principles=[],
        open_loops=[],
    )

    proposals = policy.propose(
        user_query="品牌经营OS和SUPER指标如何结合？",
        answer_summary="品牌经营OS需要用SUPER指标长期诊断货品运营健康度。",
        retrieved_pages=["wiki/topics/品牌经营os.md", "wiki/principles/商品全生命周期运营原则.md"],
        recalled_memory=recall,
        open_follow_ups=["是否需要把SUPER指标沉淀成长期原则？"],
    )

    proposal_kinds = {proposal.proposal_type for proposal in proposals}
    assert "principle" in proposal_kinds
    assert "open_loop" in proposal_kinds
    assert "interest" not in proposal_kinds


def test_style_profile_loader_falls_back_to_grounded_defaults(tmp_path) -> None:
    config = BrainConfig(root=tmp_path)
    profile = StyleProfileLoader(config).load()

    assert profile.profile_id == "default-grounded"
    assert profile.citation_preference == "high"


def test_style_engine_changes_structure_without_changing_evidence_payload() -> None:
    engine = StyleEngine()
    evidence = [
        EvidenceItem(
            page_id="topic-品牌经营os",
            page_title="品牌经营OS",
            page_path="wiki/topics/品牌经营os.md",
            source_refs=["raw/industry_docs/电商运营本体核心文档.md"],
            snippet="品牌经营OS强调人货场协同。",
            relevance_score=8.0,
        )
    ]
    sections = {
        "fact": ["品牌经营OS强调人货场协同。"],
        "synthesis": ["它把生命周期运营和数据诊断联结起来。"],
        "interpretation": ["它更像一个经营方法框架而不是单一工具。"],
        "recommendation": ["可将相关问答沉淀为原则页。"],
    }
    profile = StyleProfileLoader.from_dict(
        {
            "profile_id": "actionable",
            "preferred_answer_structure": ["fact", "recommendation", "synthesis", "interpretation"],
            "abstraction_level": "balanced",
            "actionability_preference": "high",
            "citation_preference": "high",
            "favored_output_forms": ["markdown"],
            "reuse_preference": "proposal-first",
        }
    )

    rendered = engine.render(
        question="什么是品牌经营OS？",
        sections=sections,
        evidence=evidence,
        profile=profile,
    )

    assert rendered.index("## Recommendation") < rendered.index("## Synthesis")
    assert "raw/industry_docs/电商运营本体核心文档.md" in rendered
