from __future__ import annotations

from pathlib import Path

from personal_brain.config import BrainConfig
from personal_brain.ingestion.service import IngestionService
from personal_brain.llm.prompt_builder import CompilePromptBuilder
from personal_brain.models import SourceRecord
from personal_brain.utils.files import append_jsonl


def _load_sop_record(config: BrainConfig) -> SourceRecord:
    records = IngestionService(config).load_records()
    return next(item for item in records if item.title == "主干链路SOP")


def test_normalize_service_uses_litellm_backend_when_configured(monkeypatch, built_brain_workspace: Path) -> None:
    config = BrainConfig(root=built_brain_workspace, compile_backend="litellm", litellm_model="gpt-4o-mini")

    from personal_brain.llm.compile_service import LiteLLMCompileService
    from personal_brain.wiki.normalize_service import NormalizeService

    monkeypatch.setattr(
        LiteLLMCompileService,
        "compile_record",
        lambda self, record, normalized_text, graph_payload, meta_payload: self._build_mock_result(
            summary="主干链路SOP 的主链路步骤包括类目可行性分析和产品塑造。",
            stage_id="第一环节-洞察分析",
            step_id="类目可行性分析，确定最优叶子类目",
        ),
    )

    record = _load_sop_record(config)
    bundle = NormalizeService(config).build_bundle(record)

    assert bundle.compile_mode == "litellm"
    assert bundle.compile_backend == "litellm"
    assert bundle.compile_model == "gpt-4o-mini"
    assert not bundle.compile_warnings


def test_normalize_service_marks_real_litellm_provider_as_litellm_mode(monkeypatch, built_brain_workspace: Path) -> None:
    config = BrainConfig(root=built_brain_workspace, compile_backend="litellm", litellm_model="dashscope/qwen-max")

    from personal_brain.llm.compile_service import LiteLLMCompileService
    from personal_brain.llm.contracts import CompileResult
    from personal_brain.wiki.normalize_service import NormalizeService

    monkeypatch.setattr(
        LiteLLMCompileService,
        "compile_record",
        lambda self, record, normalized_text, graph_payload, meta_payload: CompileResult(
            summary="主干链路SOP 的主链路步骤包括类目可行性分析和产品塑造。",
            structured_sections={},
            claims=[],
            object_candidates=[],
            stage_id="第一环节-洞察分析",
            step_id="类目可行性分析，确定最优叶子类目",
            confidence=0.88,
            warnings=[],
            provider="dashscope",
            model="dashscope/qwen-max",
            latency_ms=321,
            token_usage={},
        ),
    )

    record = _load_sop_record(config)
    bundle = NormalizeService(config).build_bundle(record)

    assert bundle.compile_mode == "litellm"
    assert bundle.compile_backend == "litellm"
    assert bundle.compile_model == "dashscope/qwen-max"


def test_normalize_service_falls_back_when_litellm_provider_fails(monkeypatch, built_brain_workspace: Path) -> None:
    config = BrainConfig(root=built_brain_workspace, compile_backend="litellm", litellm_model="gpt-4o-mini")

    from personal_brain.llm.compile_service import LiteLLMCompileService
    from personal_brain.wiki.normalize_service import NormalizeService

    def boom(*_args, **_kwargs):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(LiteLLMCompileService, "compile_record", boom)

    record = _load_sop_record(config)
    bundle = NormalizeService(config).build_bundle(record)

    assert bundle.compile_mode == "rule_fallback"
    assert bundle.compile_backend == "litellm"
    assert bundle.compile_model == "gpt-4o-mini"
    assert any("provider unavailable" in warning for warning in bundle.compile_warnings)


def test_question_plan_builder_uses_litellm_when_enabled(monkeypatch) -> None:
    from personal_brain.extraction.question_plan_builder import QuestionPlanBuilder
    from personal_brain.llm.compile_service import LiteLLMCompileService
    from personal_brain.models import CompiledProblem

    config = BrainConfig(compile_backend="litellm", litellm_model="gpt-4o-mini")
    builder = QuestionPlanBuilder(config)

    monkeypatch.setattr(
        LiteLLMCompileService,
        "build_followup_plan",
        lambda self, problem: {
            "next_question_type": "process-gap",
            "candidate_questions": ["在第一环节里，你最想先确认哪个判断节点？"],
            "target_missing_slots": ["supporting_evidence"],
            "warnings": [],
        },
    )

    plan = builder.build(
        CompiledProblem(
            slot_schema_source="fallback",
            current_object="主干链路SOP",
            current_knowledge_goal="补齐第一环节的关键判断",
            question_type="procedural",
            known_slots={"current_object": "主干链路SOP"},
            missing_slots=["supporting_evidence"],
            recommended_action="ask_follow_up",
        )
    )

    assert plan.next_question_type == "process-gap"
    assert plan.candidate_questions[0] == "在第一环节里，你最想先确认哪个判断节点？"


def test_brain_config_loads_dotenv_without_overriding_existing_env(monkeypatch, tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "DASHSCOPE_API_KEY=from-dotenv",
                "BRAIN_LITELLM_MODEL=dashscope/qwen-plus",
                "BRAIN_COMPILE_BACKEND=litellm",
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    monkeypatch.setenv("BRAIN_LITELLM_MODEL", "openrouter/qwen/qwen3-235b-a22b-2507")

    config = BrainConfig.from_env()

    assert config.compile_backend == "litellm"
    assert config.litellm_model == "openrouter/qwen/qwen3-235b-a22b-2507"
    assert config.litellm_provider_order == ["dashscope", "openrouter", "openai"]
    assert config.litellm_fallback_models == []


def test_litellm_defaults_to_dashscope_qwen_max_when_dashscope_key_exists(monkeypatch) -> None:
    monkeypatch.delenv("BRAIN_LITELLM_MODEL", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("DASHSCOPE_API_KEY", "dashscope-key")

    config = BrainConfig()

    assert config.litellm_model == "dashscope/qwen-max"


def test_litellm_provider_config_checks_model_prefix(monkeypatch) -> None:
    from personal_brain.llm.litellm_client import LiteLLMClient

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    dashscope_client = LiteLLMClient(BrainConfig(litellm_model="dashscope/qwen-max"))
    assert not dashscope_client._provider_configured("dashscope/qwen-max")
    monkeypatch.setenv("DASHSCOPE_API_KEY", "dashscope-key")
    assert dashscope_client._provider_configured("dashscope/qwen-max")

    openrouter_client = LiteLLMClient(BrainConfig(litellm_model="openrouter/qwen/qwen3-235b-a22b-2507"))
    assert not openrouter_client._provider_configured("openrouter/qwen/qwen3-235b-a22b-2507")
    monkeypatch.setenv("OPENROUTER_API_KEY", "openrouter-key")
    assert openrouter_client._provider_configured("openrouter/qwen/qwen3-235b-a22b-2507")


def test_litellm_client_finds_repo_vendor_when_workspace_root_is_project(tmp_path) -> None:
    from personal_brain.llm.litellm_client import LiteLLMClient

    client = LiteLLMClient(BrainConfig(root=tmp_path, workspace_root=tmp_path))

    vendor_path = client._vendor_src_path()

    assert vendor_path is not None
    assert (vendor_path / "litellm").exists()


def test_litellm_client_falls_back_to_openrouter_after_dashscope_failure(monkeypatch) -> None:
    from personal_brain.llm.litellm_client import LiteLLMClient

    monkeypatch.setenv("DASHSCOPE_API_KEY", "dashscope-key")
    monkeypatch.setenv("OPENROUTER_API_KEY", "openrouter-key")
    config = BrainConfig(
        compile_backend="litellm",
        litellm_model="dashscope/qwen-max",
        litellm_fallback_models=["openrouter/qwen/qwen3-235b-a22b-2507"],
    )
    client = LiteLLMClient(config)
    attempted: list[str] = []

    def fake_completion(**kwargs):
        attempted.append(kwargs["model"])
        if kwargs["model"] == "dashscope/qwen-max":
            raise RuntimeError("dashscope down")
        return {
            "choices": [{"message": {"content": '{"summary":"fallback ok"}'}}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
        }

    monkeypatch.setattr(client, "_load_completion", lambda: fake_completion)

    payload = client.completion_json(messages=[{"role": "user", "content": "hello"}])

    assert attempted == ["dashscope/qwen-max", "openrouter/qwen/qwen3-235b-a22b-2507"]
    assert payload["summary"] == "fallback ok"
    assert payload["_meta"]["model"] == "openrouter/qwen/qwen3-235b-a22b-2507"
    assert any("dashscope down" in warning for warning in payload["_meta"]["warnings"])


def test_compile_prompt_builder_trims_large_payloads() -> None:
    builder = CompilePromptBuilder()
    record = SourceRecord(
        source_id="src-1",
        path="raw_new/industry_docs/主干链路SOP.md",
        source_type="md",
        title="主干链路SOP",
        created_at="2026-04-16T00:00:00Z",
        ingested_at="2026-04-16T00:00:00Z",
        checksum="abc",
        logical_source_id="主干链路sop",
        schema_route="direct_rule_compile",
        source_family="domain_knowledge",
        role_in_pipeline="rule_source",
        authority_level="medium_high",
        trust_level="working_doc",
        maturity_level="working",
        domain_profiles=["ecommerce_term_dictionary"],
        canonical_asset_type="ProcessFlow",
        process_stage_id="主干链路SOP",
        process_step_id="",
        attachment_refs=["raw_new/industry_docs/主干链路SOP.graph.json"],
    )

    messages = builder.build_object_compile_messages(
        record=record,
        normalized_text="A" * 12000,
        graph_payload={"nodes": [{"id": str(i), "label": f"node-{i}"} for i in range(500)]},
        meta_payload={"raw": "B" * 5000},
    )

    user_content = messages[1]["content"]
    assert "checksum" not in user_content
    assert len(user_content) < 12000
    assert "normalized_text_excerpt" in user_content
    assert "graph_payload_summary" in user_content


def test_ingestion_load_records_prefers_latest_record_for_same_path(built_brain_workspace: Path) -> None:
    config = BrainConfig(root=built_brain_workspace)
    manifest = config.paths.source_manifest
    base = {
        "source_id": "old",
        "path": "raw_new/industry_docs/主干链路SOP.md",
        "source_type": "md",
        "title": "主干链路SOP",
        "created_at": "2026-04-16T00:00:00Z",
        "ingested_at": "2026-04-16T00:00:00Z",
        "checksum": "old",
        "logical_source_id": "主干链路sop",
        "compile_mode": "rule_fallback",
        "compile_warnings": ["old warning"],
    }
    append_jsonl(manifest, base)
    append_jsonl(
        manifest,
        {
            **base,
            "source_id": "new",
            "checksum": "new",
            "compile_mode": "litellm",
            "compile_warnings": [],
        },
    )

    records = IngestionService(config).load_records()
    matching = [item for item in records if item.path == "raw_new/industry_docs/主干链路SOP.md"]

    assert len(matching) == 1
    assert matching[0].source_id == "new"
    assert matching[0].compile_warnings == []
