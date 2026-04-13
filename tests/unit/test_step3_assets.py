from __future__ import annotations

import json

from personal_brain.config import BrainConfig
from personal_brain.eval.runner import EvaluationRunner
from personal_brain.ontology.candidate_extractor import CandidateExtractor
from personal_brain.retrieval.query_engine import QueryEngine
from personal_brain.skills.candidate_generator import SkillCandidateGenerator
from personal_brain.writeback.service import WritebackService


def test_candidate_extractor_creates_traceable_candidates_from_wiki_and_writeback(built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)
    engine = QueryEngine(config)
    result = engine.ask("品牌经营OS和SUPER指标之间是什么关系？")
    WritebackService(config).create_proposal(result.query_id, apply=True)

    candidates = CandidateExtractor(config).extract()

    assert any(item.candidate_type == "Topic" for item in candidates)
    assert any(item.candidate_type == "Concept" for item in candidates)
    assert any(item.candidate_type == "Evidence" for item in candidates)
    assert all(item.wiki_refs for item in candidates)
    assert all(item.source_refs for item in candidates)


def test_skill_candidate_generator_packages_repeated_high_value_patterns(built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)
    engine = QueryEngine(config)

    first = engine.ask("品牌经营OS和SUPER指标之间是什么关系？")
    second = engine.ask("如何把品牌经营OS整理成可复用的方法框架？")
    writeback = WritebackService(config)
    writeback.create_proposal(first.query_id)
    writeback.create_proposal(second.query_id)

    manifests = SkillCandidateGenerator(config).build()

    assert manifests
    metadata_path = built_brain_workspace / "skills" / "candidates" / "topic_synthesis" / "metadata.json"
    skill_doc = built_brain_workspace / "skills" / "candidates" / "topic_synthesis" / "SKILL.md"
    example_path = built_brain_workspace / "skills" / "candidates" / "topic_synthesis" / "examples" / "example_01.md"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))

    assert skill_doc.exists()
    assert example_path.exists()
    assert metadata["origin_query_ids"]
    assert metadata["origin_wiki_pages"]
    assert metadata["source_refs"]


def test_evaluation_runner_generates_json_and_markdown_reports(built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)
    engine = QueryEngine(config)
    result = engine.ask("品牌经营OS和SUPER指标之间是什么关系？")
    writeback = WritebackService(config)
    writeback.create_proposal(result.query_id, apply=True)

    CandidateExtractor(config).extract()
    SkillCandidateGenerator(config).build()
    report = EvaluationRunner(config).run()

    assert report.report_path_json
    assert report.report_path_markdown
    assert report.metrics["answer_asset_value"] >= 0.0
    assert report.metrics["writeback_precision"] >= 0.0
    assert report.metrics["ontology_quality"] >= 0.0
    assert report.metrics["skill_candidate_quality"] >= 0.0
