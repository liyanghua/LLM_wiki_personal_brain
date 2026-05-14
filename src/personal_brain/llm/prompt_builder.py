from __future__ import annotations

import json

from personal_brain.models import CompiledProblem, SourceRecord


class CompilePromptBuilder:
    _TEXT_LIMIT = 6000
    _META_LIMIT = 1500
    _NODE_LIMIT = 40
    _EDGE_LIMIT = 60

    def build_object_compile_messages(
        self,
        *,
        record: SourceRecord,
        normalized_text: str,
        graph_payload: dict,
        meta_payload: dict,
    ) -> list[dict[str, str]]:
        system = (
            "You are a schema-aware knowledge compiler. "
            "Extract grounded objects, stage/step attachment, and a concise summary. "
            "Return strict JSON only."
        )
        compact_record = {
            "path": record.path,
            "title": record.title,
            "source_type": record.source_type,
            "schema_route": record.schema_route,
            "source_family": record.source_family,
            "role_in_pipeline": record.role_in_pipeline,
            "authority_level": record.authority_level,
            "trust_level": record.trust_level,
            "maturity_level": record.maturity_level,
            "domain_profiles": record.domain_profiles,
            "canonical_asset_type": record.canonical_asset_type,
            "process_stage_id": record.process_stage_id,
            "process_step_id": record.process_step_id,
            "attachment_refs": record.attachment_refs,
        }
        compact_graph = {
            "title": graph_payload.get("title") or record.title,
            "doc_id": graph_payload.get("doc_id") or record.logical_source_id,
            "stages": list(graph_payload.get("stages") or [])[: self._NODE_LIMIT],
            "nodes_preview": list(graph_payload.get("nodes") or [])[: self._NODE_LIMIT],
            "edges_preview": list(graph_payload.get("edges") or [])[: self._EDGE_LIMIT],
            "node_count": len(list(graph_payload.get("nodes") or [])),
            "edge_count": len(list(graph_payload.get("edges") or [])),
        }
        compact_meta = self._trim_text(
            meta_payload.get("raw") if isinstance(meta_payload.get("raw"), str) else json.dumps(meta_payload, ensure_ascii=False),
            self._META_LIMIT,
        )
        user = (
            f"record_summary={json.dumps(compact_record, ensure_ascii=False)}\n"
            f"graph_payload_summary={json.dumps(compact_graph, ensure_ascii=False)}\n"
            f"meta_payload_excerpt={compact_meta}\n"
            f"normalized_text_excerpt=\n{self._trim_text(normalized_text, self._TEXT_LIMIT)}\n"
        )
        return [{"role": "system", "content": system}, {"role": "user", "content": user}]

    def build_followup_messages(self, problem: CompiledProblem) -> list[dict[str, str]]:
        system = (
            "You generate the next best follow-up question for a knowledge extraction interview. "
            "Return strict JSON only."
        )
        user = (
            f"current_object={problem.current_object}\n"
            f"knowledge_goal={problem.current_knowledge_goal}\n"
            f"question_type={problem.question_type}\n"
            f"known_slots={problem.known_slots}\n"
            f"missing_slots={problem.missing_slots}\n"
        )
        return [{"role": "system", "content": system}, {"role": "user", "content": user}]

    def _trim_text(self, value: str, limit: int) -> str:
        normalized = value.strip()
        if len(normalized) <= limit:
            return normalized
        return f"{normalized[:limit]}\n...[truncated]"
