from __future__ import annotations

import json
from pathlib import Path

from personal_brain.config import BrainConfig
from personal_brain.ingestion.service import IngestionService
from personal_brain.lint.service import WikiLintService
from personal_brain.retrieval.query_engine import QueryEngine
from personal_brain.wiki.compiler import WikiCompiler
from personal_brain.writeback.service import WritebackService


def test_build_ask_lint_and_writeback_flow(brain_workspace) -> None:
    config = BrainConfig(root=brain_workspace)
    ingest_service = IngestionService(config)
    compiler = WikiCompiler(config)
    query_engine = QueryEngine(config)
    lint_service = WikiLintService(config)
    writeback_service = WritebackService(config)

    ingest_service.ingest_paths(
        [
            brain_workspace / "raw" / "industry_docs",
            brain_workspace / "raw" / "conversations",
        ]
    )
    build_result = compiler.build()

    assert (brain_workspace / "wiki" / "index.md").exists()
    assert (brain_workspace / "wiki" / "log.md").exists()
    assert len(build_result.source_pages) == 8
    assert (brain_workspace / "wiki" / "topics" / "品牌经营os.md").exists()
    assert (brain_workspace / "wiki" / "projects" / "儿童学习桌垫单因子测图.md").exists()
    assert (brain_workspace / "wiki" / "principles" / "商品全生命周期运营原则.md").exists()

    answer = query_engine.ask("什么是品牌经营OS？")
    assert "## Fact" in answer.answer_markdown
    assert "## Synthesis" in answer.answer_markdown
    assert "## Interpretation" in answer.answer_markdown
    assert "## Recommendation" in answer.answer_markdown
    assert answer.retrieved_pages
    assert (brain_workspace / "memory" / "session" / "answers" / f"{answer.query_id}.md").exists()

    lint_result = lint_service.run()
    assert lint_result.issues == []

    proposal = writeback_service.create_proposal(answer.query_id)
    assert proposal.target_paths
    wiki_targets = [brain_workspace / path for path in proposal.target_paths if path.startswith("wiki/")]
    assert wiki_targets

    proposal_path = brain_workspace / "memory" / "session" / "writeback" / f"{answer.query_id}.json"
    stored = json.loads(proposal_path.read_text(encoding="utf-8"))
    assert stored["query_id"] == answer.query_id


def test_build_wiki_for_raw_new_pilot_keeps_outputs_isolated_and_schema_tagged(tmp_path: Path) -> None:
    root = tmp_path / "brain"
    root.mkdir(parents=True, exist_ok=True)
    config = BrainConfig(
        root=root,
        source_root=root / "raw_new",
        workspace_root=root / "pilot_workspace",
        schema_enabled=True,
    )
    ingest_service = IngestionService(config)
    compiler = WikiCompiler(config)

    ingest_service.initialize_schema_from_doc(root / "raw_new")
    (root / "raw_new" / "industry_docs" / "6大维度·42个细分变量选择逻辑01.md").write_text(
        "# 6大维度·42个细分变量选择逻辑01\n\n## 维度1：视觉核心层（决定第一眼停留）\n\n先看视觉核心层，再细化变量。\n",
        encoding="utf-8",
    )
    (root / "raw_new" / "conversations" / "访谈记录.md").write_text(
        "# 访谈记录\n\n## 当前已确认内容\n- 视觉核心层优先。\n",
        encoding="utf-8",
    )

    ingest_service.ingest_paths([root / "raw_new" / "industry_docs", root / "raw_new" / "conversations"])
    build_result = compiler.build()

    assert build_result.derived_pages
    assert not (root / "wiki" / "index.md").exists()
    assert config.paths.wiki_index.exists()
    assert str(config.paths.wiki).endswith("pilot_workspace/wiki")

    topic_page = config.paths.wiki / "topics" / "6大维度42个细分变量选择逻辑01.md"
    assert topic_page.exists()
    rendered = topic_page.read_text(encoding="utf-8")
    assert "schema_route: direct_rule_compile" in rendered
    assert "source_family: domain_knowledge" in rendered
    assert "governance_status: draft" in rendered

    conversation_summary = config.paths.wiki / "topics" / "访谈记录.md"
    assert not conversation_summary.exists()


def test_process_spine_compile_generates_overview_stage_step_and_index_pages(brain_workspace: Path) -> None:
    config = BrainConfig(root=brain_workspace)
    ingest_service = IngestionService(config)
    compiler = WikiCompiler(config)

    ingest_service.ingest_paths(
        [
            brain_workspace / "raw" / "industry_docs",
            brain_workspace / "raw" / "conversations",
        ]
    )
    compiler.build()

    overview_page = brain_workspace / "wiki" / "主干链路SOP.md"
    stage_page = brain_workspace / "wiki" / "stages" / "第一环节-洞察分析.md"
    step_page = brain_workspace / "wiki" / "steps" / "产品营销能力塑造.md"
    process_index = brain_workspace / "wiki" / "index" / "process_sop_index.md"
    legacy_untitled = brain_workspace / "wiki" / "topics" / "untitled.md"

    assert overview_page.exists()
    assert stage_page.exists()
    assert step_page.exists()
    assert process_index.exists()
    assert not legacy_untitled.exists()

    overview_text = overview_page.read_text(encoding="utf-8")
    stage_text = stage_page.read_text(encoding="utf-8")
    step_text = step_page.read_text(encoding="utf-8")
    dimension_text = (brain_workspace / "wiki" / "topics" / "6大维度42个细分变量选择逻辑01.md").read_text(
        encoding="utf-8"
    )
    process_index_text = process_index.read_text(encoding="utf-8")

    assert "page_type: process" in overview_text
    assert "stage_order:" in overview_text
    assert "schema_route: process_spine_compile" in overview_text
    assert "page_type: stage" in stage_text
    assert "stage_id: 第一环节-洞察分析" in stage_text
    assert "linked_steps:" in stage_text
    assert "page_type: step" in step_text
    assert "linked_stage: 第二阶段-产品塑造" in step_text
    assert "source_family: domain_knowledge" in step_text
    assert "linked_stage: 第二阶段-产品塑造" in dimension_text
    assert "linked_step: 产品营销能力塑造" in dimension_text
    assert "维度1：视觉核心层（决定第一眼停留）" in dimension_text
    assert "主干链路SOP" in process_index_text
    assert "第一环节-洞察分析" in process_index_text
    assert "产品营销能力塑造" in process_index_text


def test_schema_aware_quality_report_flags_conversation_publish_violation(tmp_path: Path) -> None:
    root = tmp_path / "brain"
    root.mkdir(parents=True, exist_ok=True)
    config = BrainConfig(
        root=root,
        source_root=root / "raw_new",
        workspace_root=root / "pilot_workspace",
        schema_enabled=True,
    )
    ingest_service = IngestionService(config)
    compiler = WikiCompiler(config)
    lint_service = WikiLintService(config)

    ingest_service.initialize_schema_from_doc(root / "raw_new")
    (root / "raw_new" / "conversations" / "访谈记录.md").write_text(
        "# 访谈记录\n\n视觉核心层优先。\n",
        encoding="utf-8",
    )
    ingest_service.ingest_paths([root / "raw_new" / "conversations" / "访谈记录.md"])
    compiler.build()

    bad_page = config.paths.wiki / "principles" / "错误发布.md"
    bad_page.parent.mkdir(parents=True, exist_ok=True)
    bad_page.write_text(
        "---\n"
        "page_id: principle-error\n"
        "page_type: principle\n"
        "title: 错误发布\n"
        "summary: 由访谈直接发布。\n"
        "source_refs:\n"
        "  - raw_new/conversations/访谈记录.md\n"
        "links_to: []\n"
        "updated_at: 2026-04-15T00:00:00Z\n"
        "schema_route: conversation_candidate_compile\n"
        "source_family: elicitation_trace\n"
        "confidence: 0.4\n"
        "governance_status: published\n"
        "retrieval_tags:\n"
        "  - interview-only\n"
        "---\n\n# 错误发布\n",
        encoding="utf-8",
    )

    result = lint_service.run_quality_audit(
        gold_questions=["6大维度首先看哪个维度"],
    )
    codes = {issue.code for issue in result.issues}
    assert "conversation-direct-publish" in codes
    assert result.metrics["policy_quality"] < 1.0


def test_process_quality_report_flags_unattached_sources_and_missing_process_links(brain_workspace: Path) -> None:
    config = BrainConfig(root=brain_workspace)
    ingest_service = IngestionService(config)
    compiler = WikiCompiler(config)
    lint_service = WikiLintService(config)

    ingest_service.ingest_paths(
        [
            brain_workspace / "raw" / "industry_docs",
            brain_workspace / "raw" / "conversations",
        ]
    )
    compiler.build()

    broken_process_page = brain_workspace / "wiki" / "steps" / "错误步骤页.md"
    broken_process_page.parent.mkdir(parents=True, exist_ok=True)
    broken_process_page.write_text(
        "---\n"
        "page_id: step-bad\n"
        "page_type: step\n"
        "title: 错误步骤页\n"
        "summary: 缺失流程挂载。\n"
        "source_refs:\n"
        "  - raw/industry_docs/主干链路SOP.md\n"
        "links_to: []\n"
        "updated_at: 2026-04-15T00:00:00Z\n"
        "schema_route: process_spine_compile\n"
        "source_family: domain_knowledge\n"
        "confidence: 0.4\n"
        "governance_status: draft\n"
        "retrieval_tags: []\n"
        "---\n\n# 错误步骤页\n",
        encoding="utf-8",
    )

    unattached_source = brain_workspace / "raw" / "industry_docs" / "孤立经验规则.md"
    unattached_source.write_text("# 孤立经验规则\n\n这个文件没有流程挂载。\n", encoding="utf-8")
    ingest_service.ingest_paths([unattached_source])

    result = lint_service.run_quality_audit(gold_questions=["主干链路SOP里产品塑造阶段要看哪些关键判断"])
    codes = {issue.code for issue in result.issues}

    assert "process-missing-linkage" in codes
    assert "process-unattached-source" in codes


def test_build_wiki_emits_normalized_artifacts_and_source_bundle_metadata(brain_workspace: Path) -> None:
    config = BrainConfig(root=brain_workspace)
    ingest_service = IngestionService(config)
    compiler = WikiCompiler(config)

    ingest_service.ingest_paths(
        [
            brain_workspace / "raw" / "industry_docs",
            brain_workspace / "raw" / "conversations",
        ]
    )
    compiler.build()

    normalized_dir = brain_workspace / "normalized"
    assert normalized_dir.exists()

    normalized_md = normalized_dir / "主干链路sop.md"
    normalized_graph = normalized_dir / "主干链路sop.graph.json"
    normalized_meta = normalized_dir / "主干链路sop.meta.yaml"
    node_registry = normalized_dir / "registries" / "node_registry.json"
    edge_registry = normalized_dir / "registries" / "edge_registry.json"
    claim_bank = normalized_dir / "registries" / "claim_bank.jsonl"

    assert normalized_md.exists()
    assert normalized_graph.exists()
    assert normalized_meta.exists()
    assert node_registry.exists()
    assert edge_registry.exists()
    assert claim_bank.exists()

    manifest_rows = [
        json.loads(line)
        for line in (brain_workspace / "raw" / ".brain" / "source_records.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    sop_record = next(item for item in manifest_rows if item["path"].endswith("主干链路SOP.md"))
    assert sop_record["normalized_path"] == "normalized/主干链路sop.md"
    assert sop_record["compile_mode"] == "llm_object_compile"
    assert sop_record["graph_bundle_refs"]
    assert sop_record["claim_refs"]


def test_quality_audit_emits_sop_bundle_and_answer_readiness_metrics(brain_workspace: Path) -> None:
    config = BrainConfig(root=brain_workspace)
    ingest_service = IngestionService(config)
    compiler = WikiCompiler(config)
    lint_service = WikiLintService(config)

    ingest_service.ingest_paths(
        [
            brain_workspace / "raw" / "industry_docs",
            brain_workspace / "raw" / "conversations",
        ]
    )
    compiler.build()

    result = lint_service.run_quality_audit(
        gold_questions=[
            "主干链路首先看哪几个步骤",
            "产品塑造阶段要看哪些关键判断",
            "6大维度首先看哪个维度",
        ]
    )

    assert "bundle_integrity" in result.metrics
    assert "process_coverage" in result.metrics
    assert "object_compile_quality" in result.metrics
    assert "evidence_grounding_quality" in result.metrics
    assert "retrieval_readiness" in result.metrics
    assert "answer_readiness" in result.metrics
