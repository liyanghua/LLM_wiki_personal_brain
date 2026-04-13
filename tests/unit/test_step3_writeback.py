from __future__ import annotations

import json

from personal_brain.agent.method_profile import MethodProfile, MethodProfileLoader
from personal_brain.agent.template_selector import TemplateSelector
from personal_brain.config import BrainConfig
from personal_brain.retrieval.query_engine import QueryEngine
from personal_brain.writeback.service import WritebackService


def test_method_profile_loader_backfills_step2_profile_and_template_selector_adds_method_section(brain_workspace) -> None:
    config = BrainConfig(root=brain_workspace)

    profile = MethodProfileLoader(config).load()

    assert profile.method_profile_id == "default-grounded"
    assert profile.explanation_pattern == "hybrid"
    assert profile.operationalization_level == "medium"
    assert profile.assetization_preference == "proposal-first"

    custom = MethodProfile(
        method_profile_id="mapping-first",
        preferred_answer_structure=["fact", "synthesis", "interpretation", "recommendation"],
        abstraction_depth="balanced",
        operationalization_level="high",
        explanation_pattern="concept-first",
        reusable_asset_preferences=["mapping", "schema"],
        citation_preference="high",
        assetization_preference="proposal-first",
    )
    template = TemplateSelector().select("comparison", custom)

    assert template.method_section == "mapping"
    assert template.sections[:4] == ["fact", "synthesis", "interpretation", "recommendation"]


def test_writeback_service_creates_structured_bundle_and_apply_merges_existing_topic_page(built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)
    engine = QueryEngine(config)
    writeback = WritebackService(config)

    result = engine.ask("品牌经营OS和SUPER指标之间是什么关系？")
    topic_path = built_brain_workspace / "wiki" / "topics" / "品牌经营os.md"
    original_topic = topic_path.read_text(encoding="utf-8")

    bundle = writeback.create_proposal(result.query_id)

    assert bundle.query_id == result.query_id
    assert bundle.target_paths
    assert any(target.target.startswith("wiki/topics/") for target in bundle.targets)
    assert all(target.confidence >= 0.0 for target in bundle.targets)
    assert all(target.approval_status in {"pending", "approved-for-apply", "rejected"} for target in bundle.targets)
    first_target = bundle.targets[0].model_dump(mode="json")
    for key in [
        "target",
        "action",
        "rationale",
        "confidence",
        "long_term_value",
        "evidence_refs",
        "content_preview",
        "approval_status",
    ]:
        assert key in first_target

    applied = writeback.create_proposal(result.query_id, apply=True)
    stored = json.loads(
        (built_brain_workspace / "memory" / "session" / "writeback" / f"{result.query_id}.json").read_text(
            encoding="utf-8"
        )
    )

    assert stored["query_id"] == result.query_id
    assert applied.applied_targets
    merged_topic = topic_path.read_text(encoding="utf-8")
    assert "# 品牌经营OS" in merged_topic
    assert "## Key Points" in merged_topic
    assert "## Managed Writeback Updates" in merged_topic
    assert result.query_id in merged_topic
    assert "品牌经营OS在当前资料中被描述为一个以人货场协同、全生命周期运营和数据驱动决策为核心的经营框架。" in original_topic
    assert "品牌经营OS在当前资料中被描述为一个以人货场协同、全生命周期运营和数据驱动决策为核心的经营框架。" in merged_topic
