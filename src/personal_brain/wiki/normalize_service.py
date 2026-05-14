from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from personal_brain.config import BrainConfig
from personal_brain.ingestion.parsers import parse_path
from personal_brain.llm.compile_service import LiteLLMCompileService
from personal_brain.models import SourceRecord
from personal_brain.utils.frontmatter import render_frontmatter
from personal_brain.utils.text import slugify_title, summarize_text


@dataclass
class NormalizedArtifactBundle:
    normalized_path: str
    graph_bundle_refs: list[str]
    claim_refs: list[str]
    compile_mode: str
    compile_warnings: list[str]
    compile_backend: str
    compile_model: str


class NormalizeService:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.paths = config.paths
        self.root = config.root.resolve()
        self.compile_service = LiteLLMCompileService(config)

    def build_bundle(self, record: SourceRecord) -> NormalizedArtifactBundle:
        source_path = self.config.root / record.path
        slug = slugify_title(record.title)
        normalized_md = self.paths.normalized / f"{slug}.md"
        normalized_meta = self.paths.normalized / f"{slug}.meta.yaml"
        normalized_graph = self.paths.normalized / f"{slug}.graph.json"
        claim_bank = self.paths.normalized_registries / "claim_bank.jsonl"
        node_registry = self.paths.normalized_registries / "node_registry.json"
        edge_registry = self.paths.normalized_registries / "edge_registry.json"

        text = ""
        warnings: list[str] = []
        if record.parse_error:
            warnings.append(f"parse_error:{record.parse_error}")
        else:
            try:
                text = parse_path(source_path)
            except Exception as exc:  # pragma: no cover - defensive fallback
                warnings.append(f"normalize_parse_failed:{exc}")

        graph_payload = self._load_graph_payload(source_path)
        meta_payload = self._load_meta_payload(source_path, record)
        compile_result = None
        compile_warnings = list(warnings)
        compile_mode = "rule_fallback"
        compile_backend = self.config.compile_backend
        compile_model = self.config.litellm_model if self.config.compile_backend == "litellm" else ""
        try:
            compile_result = self.compile_service.compile_record(record, text, graph_payload, meta_payload)
            compile_mode = "litellm" if self.config.compile_backend == "litellm" else compile_result.provider
            compile_backend = "litellm" if self.config.compile_backend == "litellm" else compile_result.provider
            compile_model = compile_result.model
            compile_warnings.extend(compile_result.warnings)
        except Exception as exc:
            compile_result = self.compile_service._fallback_compile(record, text, graph_payload)
            compile_warnings.append(str(exc))
            compile_mode = "rule_fallback"
            compile_backend = self.config.compile_backend
            compile_model = self.config.litellm_model if self.config.compile_backend == "litellm" else ""

        claims = self._extract_claims(record, text, graph_payload, compile_result)
        nodes, edges = self._extract_graph_registries(graph_payload)

        normalized_md.write_text(self._render_normalized_markdown(record, text, compile_result), encoding="utf-8")
        normalized_meta.write_text(self._render_normalized_meta(record, meta_payload), encoding="utf-8")
        normalized_graph.write_text(json.dumps(graph_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        claim_bank.write_text(
            "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in claims),
            encoding="utf-8",
        )
        node_registry.write_text(json.dumps(nodes, ensure_ascii=False, indent=2), encoding="utf-8")
        edge_registry.write_text(json.dumps(edges, ensure_ascii=False, indent=2), encoding="utf-8")

        return NormalizedArtifactBundle(
            normalized_path=str(normalized_md.resolve().relative_to(self.root)),
            graph_bundle_refs=[
                str(normalized_graph.resolve().relative_to(self.root)),
                str(normalized_meta.resolve().relative_to(self.root)),
            ],
            claim_refs=[str(claim_bank.resolve().relative_to(self.root))],
            compile_mode=compile_mode,
            compile_warnings=compile_warnings,
            compile_backend=compile_backend,
            compile_model=compile_model,
        )

    def _load_graph_payload(self, source_path: Path) -> dict:
        graph_path = source_path.with_suffix(".graph.json")
        if graph_path.exists():
            return json.loads(graph_path.read_text(encoding="utf-8"))
        return {"doc_id": source_path.stem, "title": source_path.stem, "nodes": [], "edges": []}

    def _load_meta_payload(self, source_path: Path, record: SourceRecord) -> dict:
        meta_path = source_path.with_suffix(".meta.yaml")
        if meta_path.exists():
            return {"raw": meta_path.read_text(encoding="utf-8")}
        return {
            "title": record.title,
            "canonical_asset_type": record.canonical_asset_type,
            "process_stage_id": record.process_stage_id,
            "process_step_id": record.process_step_id,
        }

    def _extract_claims(self, record: SourceRecord, text: str, graph_payload: dict, compile_result) -> list[dict]:
        claims: list[dict] = []
        if compile_result is not None and compile_result.claims:
            claims.extend(
                {
                    "claim_id": f"{slugify_title(record.title)}-{index}",
                    "claim_type": item.claim_type,
                    "text": item.text,
                    "refs": item.refs or [record.path],
                }
                for index, item in enumerate(compile_result.claims, start=1)
            )
        if record.canonical_asset_type == "ProcessFlow":
            for stage in graph_payload.get("stages", []):
                label = str(stage.get("label", "")).strip()
                if label:
                    claims.append(
                        {
                            "claim_id": f"{slugify_title(record.title)}-stage-{slugify_title(label)}",
                            "claim_type": "stage",
                            "text": label,
                            "refs": [record.path],
                        }
                    )
        summary = compile_result.summary if compile_result is not None else summarize_text(text, limit=3)
        if summary and summary != "No reliable summary extracted yet.":
            claims.append(
                {
                    "claim_id": f"{slugify_title(record.title)}-summary",
                    "claim_type": "summary",
                    "text": summary,
                    "refs": [record.path],
                }
            )
        return claims

    def _extract_graph_registries(self, graph_payload: dict) -> tuple[list[dict], list[dict]]:
        nodes = graph_payload.get("nodes", [])
        edges = graph_payload.get("edges", [])
        if not edges and graph_payload.get("stages"):
            synthetic_edges: list[dict] = []
            for node in nodes:
                stage = node.get("stage")
                if stage:
                    synthetic_edges.append(
                        {
                            "source": stage,
                            "target": node.get("label"),
                            "edge_type": "EXTRACTED",
                        }
                    )
            edges = synthetic_edges
        return nodes, edges

    def _render_normalized_markdown(self, record: SourceRecord, text: str, compile_result) -> str:
        metadata = render_frontmatter(
            {
                "source_path": record.path,
                "title": record.title,
                "canonical_asset_type": record.canonical_asset_type,
                "process_stage_id": record.process_stage_id,
                "process_step_id": record.process_step_id,
                "compile_mode": compile_result.provider if compile_result is not None else "deterministic",
            }
        )
        summary = compile_result.summary if compile_result is not None else summarize_text(text, limit=2)
        body = text or f"# {record.title}\n\n{record.title}\n"
        if summary and summary not in body:
            body = f"# {record.title}\n\n## Compiled Summary\n{summary}\n\n{body}"
        return f"{metadata}\n\n{body}"

    def _render_normalized_meta(self, record: SourceRecord, meta_payload: dict) -> str:
        if "raw" in meta_payload:
            return meta_payload["raw"]
        return render_frontmatter(meta_payload)
