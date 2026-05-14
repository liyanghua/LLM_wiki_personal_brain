from __future__ import annotations

from personal_brain.config import BrainConfig
from personal_brain.llm.contracts import CompileClaim, CompileObjectCandidate, CompileResult
from personal_brain.llm.litellm_client import LiteLLMClient
from personal_brain.llm.prompt_builder import CompilePromptBuilder
from personal_brain.models import CompiledProblem, SourceRecord
from personal_brain.utils.text import summarize_text


class LiteLLMCompileService:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.client = LiteLLMClient(config)
        self.prompt_builder = CompilePromptBuilder()

    def compile_record(
        self,
        record: SourceRecord,
        normalized_text: str,
        graph_payload: dict,
        meta_payload: dict,
    ) -> CompileResult:
        if self.config.compile_backend != "litellm":
            return self._fallback_compile(record, normalized_text, graph_payload)

        messages = self.prompt_builder.build_object_compile_messages(
            record=record,
            normalized_text=normalized_text,
            graph_payload=graph_payload,
            meta_payload=meta_payload,
        )
        payload = self.client.completion_json(messages=messages)
        return self._parse_compile_payload(payload, record, normalized_text, graph_payload)

    def build_followup_plan(self, problem: CompiledProblem) -> dict:
        if self.config.compile_backend != "litellm":
            return {
                "next_question_type": "slot-fill",
                "candidate_questions": [],
                "target_missing_slots": problem.missing_slots[:2],
                "warnings": [],
            }

        messages = self.prompt_builder.build_followup_messages(problem)
        payload = self.client.completion_json(messages=messages)
        return {
            "next_question_type": str(payload.get("next_question_type") or "slot-fill"),
            "candidate_questions": list(payload.get("candidate_questions") or []),
            "target_missing_slots": list(payload.get("target_missing_slots") or problem.missing_slots[:2]),
            "warnings": list(payload.get("warnings") or []),
        }

    def _parse_compile_payload(
        self,
        payload: dict,
        record: SourceRecord,
        normalized_text: str,
        graph_payload: dict,
    ) -> CompileResult:
        meta = payload.get("_meta", {})
        payload_warnings = list(payload.get("warnings") or [])
        meta_warnings = list(meta.get("warnings") or [])
        return CompileResult(
            summary=str(payload.get("summary") or summarize_text(normalized_text, limit=2)),
            structured_sections=dict(payload.get("structured_sections") or {}),
            claims=[
                CompileClaim(
                    claim_type=str(item.get("claim_type") or "claim"),
                    text=str(item.get("text") or ""),
                    refs=list(item.get("refs") or [record.path]),
                )
                for item in list(payload.get("claims") or [])
                if item.get("text")
            ],
            object_candidates=[
                CompileObjectCandidate(
                    object_type=str(item.get("object_type") or "concept"),
                    title=str(item.get("title") or record.title),
                    summary=str(item.get("summary") or ""),
                    refs=list(item.get("refs") or [record.path]),
                )
                for item in list(payload.get("object_candidates") or [])
            ],
            stage_id=str(payload.get("stage_id") or self._infer_stage(graph_payload)),
            step_id=str(payload.get("step_id") or self._infer_step(graph_payload)),
            confidence=float(payload.get("confidence") or 0.82),
            warnings=list(dict.fromkeys([*payload_warnings, *meta_warnings])),
            provider=str(meta.get("provider") or "litellm"),
            model=str(meta.get("model") or self.config.litellm_model),
            latency_ms=int(meta.get("latency_ms") or 0),
            token_usage=dict(meta.get("token_usage") or {}),
        )

    def _fallback_compile(self, record: SourceRecord, normalized_text: str, graph_payload: dict) -> CompileResult:
        summary = summarize_text(normalized_text, limit=2)
        return CompileResult(
            summary=summary,
            structured_sections={"compiled_summary": [summary]},
            claims=[
                CompileClaim(
                    claim_type="summary",
                    text=summary,
                    refs=[record.path],
                )
            ],
            object_candidates=[],
            stage_id=self._infer_stage(graph_payload),
            step_id=self._infer_step(graph_payload),
            confidence=0.65,
            warnings=[],
            provider="deterministic",
            model="",
            latency_ms=0,
            token_usage={},
        )

    def _infer_stage(self, graph_payload: dict) -> str:
        stages = graph_payload.get("stages") or []
        if stages:
            return str(stages[0].get("label") or "")
        return ""

    def _infer_step(self, graph_payload: dict) -> str:
        nodes = graph_payload.get("nodes") or []
        if nodes:
            return str(nodes[0].get("label") or "")
        return ""

    def _build_mock_result(self, *, summary: str, stage_id: str, step_id: str) -> CompileResult:
        return CompileResult(
            summary=summary,
            structured_sections={"compiled_summary": [summary]},
            claims=[CompileClaim(claim_type="summary", text=summary, refs=[])],
            object_candidates=[],
            stage_id=stage_id,
            step_id=step_id,
            confidence=0.88,
            warnings=[],
            provider="litellm",
            model=self.config.litellm_model,
            latency_ms=12,
            token_usage={"prompt_tokens": 100, "completion_tokens": 60, "total_tokens": 160},
        )
