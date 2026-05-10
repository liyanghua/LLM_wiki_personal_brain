from __future__ import annotations

import shutil
from pathlib import Path

from personal_brain.config import BrainConfig
from personal_brain.ingestion.parsers import SUPPORTED_SUFFIXES, parse_path
from personal_brain.models import SourceRecord
from personal_brain.schema import SchemaRegistry
from personal_brain.utils.files import append_jsonl, checksum_file, read_jsonl, utc_now
from personal_brain.utils.text import extract_title, normalize_title
from personal_brain.wiki.normalize_service import NormalizeService


EXTENSION_PRIORITY = {".md": 0, ".txt": 1, ".docx": 2, ".doc": 3}


class IngestionService:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.paths = config.paths
        self.schema_registry = SchemaRegistry(self.paths.raw)
        self.normalize_service = NormalizeService(config)

    def initialize_schema_from_doc(self, root: Path | None = None) -> dict[str, object]:
        if root is not None and root.resolve() != self.paths.raw.resolve():
            self.schema_registry = SchemaRegistry(root)
        return self.schema_registry.initialize_blueprints()

    def ingest_paths(self, paths: list[Path], bucket: str | None = None) -> list[SourceRecord]:
        files: list[Path] = []
        for path in paths:
            resolved = Path(path)
            if resolved.is_dir():
                files.extend(self._iter_supported_files(resolved))
            elif resolved.is_file():
                files.append(self._prepare_file(resolved, bucket))

        records = [self._build_record(path) for path in sorted(files)]
        grouped = self._group_records(records)
        output_records: list[SourceRecord] = []
        for group in grouped.values():
            primary = min(group, key=lambda item: EXTENSION_PRIORITY.get(Path(item.path).suffix.lower(), 99))
            variants = [item.path for item in group]
            for item in group:
                item.variant_group = variants
                item.is_primary_variant = item.source_id == primary.source_id
                output_records.append(item)
        self._replace_manifest_records(output_records)
        return records

    def load_records(self) -> list[SourceRecord]:
        rows = read_jsonl(self.paths.source_manifest)
        deduped: dict[str, SourceRecord] = {}
        for row in rows:
            record = SourceRecord.model_validate(row)
            deduped[record.path] = record
        grouped = self._group_records(list(deduped.values()))
        for group in grouped.values():
            primary = min(group, key=lambda item: EXTENSION_PRIORITY.get(Path(item.path).suffix.lower(), 99))
            variants = [item.path for item in group]
            for item in group:
                item.variant_group = variants
                item.is_primary_variant = item.source_id == primary.source_id
        return list(deduped.values())

    def _replace_manifest_records(self, new_records: list[SourceRecord]) -> None:
        new_paths = {record.path for record in new_records}
        existing = [record for record in self.load_records() if record.path not in new_paths]
        self.paths.source_manifest.write_text("", encoding="utf-8")
        for record in [*existing, *new_records]:
            append_jsonl(self.paths.source_manifest, record)

    def _iter_supported_files(self, path: Path) -> list[Path]:
        return [
            candidate
            for candidate in path.rglob("*")
            if candidate.is_file()
            and candidate.suffix.lower() in SUPPORTED_SUFFIXES
            and not candidate.name.startswith(".")
            and not candidate.name.endswith(".meta.yaml")
            and not candidate.name.endswith(".graph.json")
        ]

    def _prepare_file(self, path: Path, bucket: str | None) -> Path:
        resolved = path.resolve()
        if resolved.is_relative_to(self.paths.raw.resolve()):
            return resolved
        target_bucket = bucket or self.config.default_bucket
        destination = self.paths.raw / target_bucket / resolved.name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(resolved, destination)
        return destination

    def _build_record(self, path: Path) -> SourceRecord:
        try:
            relative_path = path.resolve().relative_to(self.config.root.resolve())
        except ValueError:
            relative_path = path.resolve().relative_to(self.paths.raw.parent.resolve())
        ingested_at = utc_now()
        created_at = ingested_at
        checksum = checksum_file(path)
        parse_error: str | None = None
        try:
            text = parse_path(path)
        except Exception as exc:
            text = ""
            parse_error = str(exc)
            append_jsonl(
                self.paths.ingest_errors,
                {
                    "path": str(relative_path),
                    "error": parse_error,
                    "ingested_at": ingested_at,
                },
            )
        title = extract_title(text, path)
        bucket = relative_path.parts[1] if len(relative_path.parts) > 1 else self.config.default_bucket
        logical_source_id = normalize_title(title or path.stem)
        source_id = f"{logical_source_id}:{checksum[:12]}"
        schema_metadata = self.schema_registry.schema_metadata_for(str(relative_path))
        if not self.config.schema_enabled and "industry_docs" in str(relative_path):
            schema_metadata["source_family"] = "domain_knowledge"
        descriptor_path = self._descriptor_path_for(path)
        canonical_asset_type = self._canonical_asset_type(path, descriptor_path)
        process_stage_id, process_step_id = self._infer_process_attachment(path, text, descriptor_path)
        graph_path = path.with_suffix(".graph.json")
        attachment_refs = [str(graph_path.relative_to(self.config.root))] if graph_path.exists() else []
        record = SourceRecord(
            source_id=source_id,
            path=str(relative_path),
            source_type=path.suffix.lower().lstrip("."),
            title=title,
            created_at=created_at,
            ingested_at=ingested_at,
            tags=[bucket],
            checksum=checksum,
            logical_source_id=logical_source_id,
            parse_error=parse_error,
            schema_path=schema_metadata["schema_path"],
            schema_route=schema_metadata["schema_route"],
            source_family=schema_metadata["source_family"],
            role_in_pipeline=schema_metadata["role_in_pipeline"],
            authority_level=schema_metadata["authority_level"],
            trust_level=schema_metadata["trust_level"],
            maturity_level=schema_metadata["maturity_level"],
            preferred_outputs=schema_metadata["preferred_outputs"],
            not_for_direct_publish=schema_metadata["not_for_direct_publish"],
            risk_flags=schema_metadata["risk_flags"],
            routing_policy=schema_metadata["routing_policy"],
            retrieval_policy=schema_metadata["retrieval_policy"],
            governance_policy=schema_metadata["governance_policy"],
            domain_profiles=schema_metadata["domain_profiles"],
            descriptor_path=descriptor_path,
            canonical_asset_type=canonical_asset_type,
            process_stage_id=process_stage_id,
            process_step_id=process_step_id,
            attachment_refs=attachment_refs,
            graph_node_refs=[],
            compile_confidence=0.9 if canonical_asset_type == "ProcessFlow" else 0.65,
            ingest_trace={
                "schema_enabled": self.config.schema_enabled,
                "bucket": bucket,
                "chunking_policy": schema_metadata.get("chunking_policy", {}),
                "extraction_priority": schema_metadata.get("extraction_priority", {}),
            },
        )
        bundle = self.normalize_service.build_bundle(record)
        record.normalized_path = bundle.normalized_path
        record.graph_bundle_refs = bundle.graph_bundle_refs
        record.claim_refs = bundle.claim_refs
        record.compile_mode = bundle.compile_mode
        record.compile_warnings = bundle.compile_warnings
        record.compile_backend = bundle.compile_backend
        record.compile_model = bundle.compile_model
        return record

    def _descriptor_path_for(self, path: Path) -> str | None:
        descriptor = path.with_suffix(".meta.yaml")
        if descriptor.exists():
            try:
                return str(descriptor.relative_to(self.config.root))
            except ValueError:
                return str(descriptor)
        return None

    def _canonical_asset_type(self, path: Path, descriptor_path: str | None) -> str:
        if descriptor_path or "主干链路sop" in path.stem.lower():
            return "ProcessFlow"
        return ""

    def _infer_process_attachment(self, path: Path, text: str, descriptor_path: str | None) -> tuple[str, str]:
        stem = path.stem
        lowered = stem.lower()
        if descriptor_path or "主干链路sop" in lowered:
            return "主干链路SOP", ""
        if "6大维度" in stem or "测图" in stem or "视觉" in text:
            return "第二阶段-产品塑造", "产品营销能力塑造"
        if "复盘" in stem:
            return "第四阶段-复盘", "复盘"
        if "上架" in stem or "孵化" in stem:
            return "第三阶段-爆款打造", "产品上架"
        return "", ""

    def _group_records(self, records: list[SourceRecord]) -> dict[str, list[SourceRecord]]:
        grouped: dict[str, list[SourceRecord]] = {}
        for record in records:
            grouped.setdefault(record.logical_source_id, []).append(record)
        return grouped
