from __future__ import annotations

import json
from pathlib import Path

from personal_brain.config import BrainConfig
from personal_brain.ingestion.service import IngestionService


def test_ingest_records_metadata_and_prefers_markdown_variant(brain_workspace) -> None:
    service = IngestionService(BrainConfig(root=brain_workspace))

    records = service.ingest_paths(
        [
            brain_workspace / "raw" / "industry_docs",
            brain_workspace / "raw" / "conversations",
        ]
    )

    assert len(records) == 8
    grouped = {record.logical_source_id: record for record in records if record.is_primary_variant}
    assert "背景选择访谈日志" in grouped
    assert grouped["背景选择访谈日志"].path.endswith("背景选择_访谈日志.md")

    manifest_path = brain_workspace / "raw" / ".brain" / "source_records.jsonl"
    manifest_lines = manifest_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(manifest_lines) == 8

    first = json.loads(manifest_lines[0])
    assert set(["source_id", "path", "source_type", "checksum", "logical_source_id"]).issubset(first)


def test_ingest_records_parse_failures_without_dropping_source(brain_workspace) -> None:
    service = IngestionService(BrainConfig(root=brain_workspace))

    records = service.ingest_paths([brain_workspace / "raw" / "industry_docs" / "broken.doc"])

    assert len(records) == 1
    assert records[0].parse_error is not None

    error_log = brain_workspace / "raw" / ".brain" / "ingest_errors.jsonl"
    entry = json.loads(error_log.read_text(encoding="utf-8").strip().splitlines()[0])
    assert entry["path"].endswith("broken.doc")


def test_ingest_records_schema_metadata_for_raw_new_pilot(tmp_path: Path) -> None:
    root = tmp_path / "brain"
    root.mkdir(parents=True, exist_ok=True)
    config = BrainConfig(
        root=root,
        source_root=root / "raw_new",
        workspace_root=root / "pilot_workspace",
        schema_enabled=True,
    )

    init = IngestionService(config).initialize_schema_from_doc(root / "raw_new")
    assert init["created"] >= 10

    industry_doc = root / "raw_new" / "industry_docs" / "测试方法.md"
    industry_doc.write_text("# 测试方法\n\n主图点击率优先看视觉核心层。\n", encoding="utf-8")

    records = IngestionService(config).ingest_paths([industry_doc])
    assert len(records) == 1
    record = records[0]
    assert record.source_family == "domain_knowledge"
    assert record.role_in_pipeline == "rule_source"
    assert "concept_pages" in record.preferred_outputs
    assert "needs_scope_check" in record.risk_flags
    assert record.routing_policy["compiler_pipeline"] == "direct_or_graph_mixed"
    assert record.retrieval_policy["searchable_in_qa"] is True
    assert record.governance_policy["can_promote_to_final_wiki"] is True
    assert "main_image_ctr_ontology" in record.domain_profiles

    manifest_lines = config.paths.source_manifest.read_text(encoding="utf-8").strip().splitlines()
    stored = json.loads(manifest_lines[0])
    assert stored["source_family"] == "domain_knowledge"
    assert stored["schema_path"].endswith("raw_new/industry_docs/_dir_schema.yaml")
