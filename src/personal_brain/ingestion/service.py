from __future__ import annotations

import shutil
from pathlib import Path

from personal_brain.config import BrainConfig
from personal_brain.ingestion.parsers import SUPPORTED_SUFFIXES, parse_path
from personal_brain.models import SourceRecord
from personal_brain.utils.files import append_jsonl, checksum_file, read_jsonl, utc_now
from personal_brain.utils.text import extract_title, normalize_title


EXTENSION_PRIORITY = {".md": 0, ".txt": 1, ".docx": 2, ".doc": 3}


class IngestionService:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.paths = config.paths

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
        for group in grouped.values():
            primary = min(group, key=lambda item: EXTENSION_PRIORITY.get(Path(item.path).suffix.lower(), 99))
            variants = [item.path for item in group]
            for item in group:
                item.variant_group = variants
                item.is_primary_variant = item.source_id == primary.source_id
                append_jsonl(self.paths.source_manifest, item)
        return records

    def load_records(self) -> list[SourceRecord]:
        rows = read_jsonl(self.paths.source_manifest)
        deduped: dict[str, SourceRecord] = {}
        for row in rows:
            record = SourceRecord.model_validate(row)
            deduped[record.source_id] = record
        grouped = self._group_records(list(deduped.values()))
        for group in grouped.values():
            primary = min(group, key=lambda item: EXTENSION_PRIORITY.get(Path(item.path).suffix.lower(), 99))
            variants = [item.path for item in group]
            for item in group:
                item.variant_group = variants
                item.is_primary_variant = item.source_id == primary.source_id
        return list(deduped.values())

    def _iter_supported_files(self, path: Path) -> list[Path]:
        return [
            candidate
            for candidate in path.rglob("*")
            if candidate.is_file() and candidate.suffix.lower() in SUPPORTED_SUFFIXES and not candidate.name.startswith(".")
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
        relative_path = path.resolve().relative_to(self.config.root.resolve())
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
        return SourceRecord(
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
        )

    def _group_records(self, records: list[SourceRecord]) -> dict[str, list[SourceRecord]]:
        grouped: dict[str, list[SourceRecord]] = {}
        for record in records:
            grouped.setdefault(record.logical_source_id, []).append(record)
        return grouped
