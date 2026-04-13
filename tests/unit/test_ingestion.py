from __future__ import annotations

import json

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

    assert len(records) == 7
    grouped = {record.logical_source_id: record for record in records if record.is_primary_variant}
    assert "背景选择访谈日志" in grouped
    assert grouped["背景选择访谈日志"].path.endswith("背景选择_访谈日志.md")

    manifest_path = brain_workspace / "raw" / ".brain" / "source_records.jsonl"
    manifest_lines = manifest_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(manifest_lines) == 7

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
