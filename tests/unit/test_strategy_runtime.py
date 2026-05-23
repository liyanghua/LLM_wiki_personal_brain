from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import personal_brain.skills.strategy_runtime as strategy_runtime
from personal_brain.config import BrainConfig
from personal_brain.models import AgentRunRequest
from personal_brain.agent.tool_registry import ToolRegistry
from personal_brain.skills.strategy_runtime import StrategyRuntimeService


TEMPLATE_EXECUTION_SPEC = {
    "executionMode": "template",
    "requiresHumanReview": True,
    "contextSources": ["wiki_refs", "strategy_bundle", "ground_truth"],
}

LLM_STRUCTURED_EXECUTION_SPEC = {
    "executionMode": "llm_structured",
    "requiresHumanReview": True,
    "contextSources": ["wiki_refs", "strategy_bundle", "ground_truth"],
}


def write_strategy_bundle(root, doc_id: str = "doc-hero-sop") -> None:
    path = root / ".llm-wiki" / "strategy-cards" / f"{doc_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schemaVersion": 2,
                "bundleId": f"strategy-bundle-{doc_id}",
                "docId": doc_id,
                "sceneId": "ecom_growth_hero_image",
                "title": "主图设计 SOP 策略包",
                "linkedWikiRefs": ["wiki/business/主图设计sop/素材与版式.md"],
                "actionCards": [
                    {
                        "actionCardId": "action-confirmed-1",
                        "category": "creative_asset_brief_generation",
                        "skillFamily": "creative_asset_brief_generation",
                        "title": "素材表达：生成主图素材 brief",
                        "status": "confirmed",
                        "triggerCondition": "当 CTR 低且主图表达弱时",
                        "requiredInputs": ["目标人群", "核心卖点", "素材元素"],
                        "actionSteps": [
                            "确认当前主图要打给哪类人群。",
                            "把核心卖点翻译成主图画面、文案和版式。",
                            "输出一版可交付给设计的素材 brief。",
                        ],
                        "outputArtifact": "主图素材 brief",
                        "validationMetrics": ["CTR", "CVR"],
                        "wikiRefs": ["wiki/business/主图设计sop/素材与版式.md"],
                        "evidenceRefs": ["block-asset-1", "block-metric-1"],
                    },
                    {
                        "actionCardId": "action-draft-1",
                        "category": "metric_signal_diagnosis",
                        "skillFamily": "metric_signal_diagnosis",
                        "title": "未确认指标动作",
                        "status": "draft",
                        "triggerCondition": "当指标异常时",
                        "requiredInputs": ["指标信号"],
                        "actionSteps": ["诊断指标。"],
                        "outputArtifact": "指标诊断表",
                        "validationMetrics": ["CTR"],
                        "wikiRefs": ["wiki/business/主图设计sop/指标与判断.md"],
                        "evidenceRefs": ["block-metric-1"],
                    },
                ],
                "strategyCards": [],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def force_template_execution(root, skill_id: str) -> None:
    for base in ["candidates", "approved"]:
        path = root / "skills" / base / skill_id / "execution.json"
        if path.exists():
            path.write_text(json.dumps(TEMPLATE_EXECUTION_SPEC, ensure_ascii=False, indent=2), encoding="utf-8")


def force_llm_structured_execution(root, skill_id: str) -> None:
    for base in ["candidates", "approved"]:
        path = root / "skills" / base / skill_id / "execution.json"
        if path.exists():
            path.write_text(json.dumps(LLM_STRUCTURED_EXECUTION_SPEC, ensure_ascii=False, indent=2), encoding="utf-8")


def write_wiki_context(root) -> None:
    path = root / "wiki" / "business" / "主图设计sop" / "素材与版式.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(
            [
                "# 素材与版式",
                "",
                "当前主图需要优先让家长在第一眼识别护眼、防滑、易清洁三类卖点。",
                "设计上建议使用真实桌面学习场景，避免只放白底产品图和参数堆叠。",
                "验证时重点观察点击率、收藏加购率和转化率的变化。",
            ]
        ),
        encoding="utf-8",
    )


def test_strategy_skill_candidates_are_generated_from_confirmed_action_cards(tmp_path) -> None:
    write_strategy_bundle(tmp_path)
    service = StrategyRuntimeService(BrainConfig(root=tmp_path, workspace_root=tmp_path))

    manifests = service.generate_strategy_skill_candidates("doc-hero-sop", "ecom_growth_hero_image")

    assert len(manifests) == 1
    manifest = manifests[0]
    assert manifest.origin_action_card_ids == ["action-confirmed-1"]
    assert manifest.origin_strategy_card_ids == []
    assert manifest.required_inputs == ["目标人群", "核心卖点", "素材元素"]
    assert manifest.title == "素材表达：生成主图素材说明"
    assert manifest.summary == "当点击率低且主图表达弱时"
    assert manifest.output_artifact == "主图素材说明"
    assert manifest.action_steps[0] == "确认当前主图要打给哪类人群。"
    assert manifest.action_steps[-1] == "输出一版可交付给设计的素材说明。"
    assert manifest.schema_version == 2
    assert "brief" not in manifest.title
    assert "CTR" not in manifest.summary

    candidate_dir = tmp_path / "skills" / "candidates" / manifest.skill_id
    input_schema = json.loads((candidate_dir / "input_schema.json").read_text(encoding="utf-8"))
    output_schema = json.loads((candidate_dir / "output_schema.json").read_text(encoding="utf-8"))
    skill_doc = (candidate_dir / "SKILL.md").read_text(encoding="utf-8")
    execution_spec = json.loads((candidate_dir / "execution.json").read_text(encoding="utf-8"))

    assert any(prop.get("description") == "目标人群" for prop in input_schema["properties"].values())
    assert output_schema["properties"]["output_artifact"]["description"] == "主图素材说明"
    assert execution_spec == {
        "executionMode": "single_plan_local_execute",
        "requiresHumanReview": True,
        "contextSources": ["wiki_refs", "strategy_bundle", "ground_truth"],
    }
    assert "确认当前主图要打给哪类人群。" in skill_doc
    assert "触发条件" in skill_doc
    assert "能力类型" in skill_doc
    assert "当前状态" in skill_doc
    assert "Trigger:" not in skill_doc
    assert "Output Artifact:" not in skill_doc
    assert "Validation Metrics:" not in skill_doc
    assert "Family:" not in skill_doc
    assert "Promotion State:" not in skill_doc
    assert "action-draft-1" not in json.dumps([item.model_dump() for item in manifests], ensure_ascii=False)

    example_doc = (candidate_dir / "examples" / "example_01.md").read_text(encoding="utf-8")
    assert "触发条件：" in example_doc
    assert "产出物：" in example_doc
    assert "验证指标：" in example_doc
    assert "执行步骤" in example_doc
    assert "Trigger:" not in example_doc
    assert "Output Artifact:" not in example_doc


def test_agent_run_uses_approved_skill_action_steps_and_writes_run_artifact(tmp_path) -> None:
    write_strategy_bundle(tmp_path)
    service = StrategyRuntimeService(BrainConfig(root=tmp_path, workspace_root=tmp_path))
    manifest = service.generate_strategy_skill_candidates("doc-hero-sop", "ecom_growth_hero_image")[0]
    force_template_execution(tmp_path, manifest.skill_id)
    service.approve_strategy_skill(manifest.skill_id, "pilot")
    force_template_execution(tmp_path, manifest.skill_id)

    result = service.run_agent(
        AgentRunRequest(
            project_path=str(tmp_path),
            doc_id="doc-hero-sop",
            scene_id="ecom_growth_hero_image",
            run_mode="generate_asset_brief",
            selected_skill_ids=[manifest.skill_id],
            grounding_sources=["wiki/business/主图设计sop/素材与版式.md"],
            task_input={
                "objective": "生成一版主图素材说明",
                "目标人群": "儿童学习桌垫购买决策者",
                "核心卖点": "护眼、防滑、易清洁",
                "素材元素": "桌面场景、产品细节、卖点短文案",
            },
        )
    )

    assert result.status == "completed"
    assert "主图素材说明" in result.result_summary
    assert "确认当前主图要打给哪类人群。" in result.result_summary
    assert result.executed_skills[0]["skillId"] == manifest.skill_id
    assert result.structured_output["output_artifact"] == "主图素材说明"
    assert "儿童学习桌垫购买决策者" in result.step_executions[0]["inputRefs"]
    assert "wiki/business/主图设计sop/素材与版式.md" in result.context_refs
    assert "已启用业务能力数量：1" in result.trace
    assert result.validation_errors == []
    assert result.output_artifacts
    assert (tmp_path / "memory" / "skills" / "runs" / f"{result.run_id}.json").exists()
    assert (tmp_path / "memory" / "skills" / "runs" / f"{result.run_id}.md").exists()


def test_agent_run_single_plan_mode_calls_llm_once_and_executes_local_steps(tmp_path, monkeypatch) -> None:
    write_strategy_bundle(tmp_path)
    write_wiki_context(tmp_path)
    calls = {"count": 0}

    class FakeLiteLLMClient:
        def __init__(self, config) -> None:
            pass

        def completion_json(self, *, messages):
            calls["count"] += 1
            joined = "\n".join(message["content"] for message in messages)
            assert "一次性生成执行计划" in joined
            assert "素材与版式" in joined
            return {
                "summary": "先读取知识页，再抽取卖点，最后整理成素材说明。",
                "step_tasks": [
                    {
                        "step_index": 1,
                        "step_title": "确认当前主图要打给哪类人群。",
                        "task_type": "data_extract",
                        "context_refs": ["wiki/business/主图设计sop/素材与版式.md"],
                        "input_keys": ["目标人群"],
                        "data_needs": ["人群"],
                        "expected_step_output": "识别目标人群与购物任务。",
                    },
                    {
                        "step_index": 2,
                        "step_title": "把核心卖点翻译成主图画面、文案和版式。",
                        "task_type": "read_file",
                        "context_refs": ["wiki/business/主图设计sop/素材与版式.md"],
                        "input_keys": ["核心卖点", "素材元素"],
                        "data_needs": ["卖点", "素材"],
                        "expected_step_output": "读取素材与版式知识页并提取表达要求。",
                    },
                    {
                        "step_index": 3,
                        "step_title": "输出一版可交付给设计的素材说明。",
                        "task_type": "data_transform",
                        "context_refs": ["wiki/business/主图设计sop/素材与版式.md"],
                        "input_keys": ["objective"],
                        "data_needs": ["素材说明"],
                        "expected_step_output": "整理为设计可执行素材说明。",
                    },
                ],
                "required_context_refs": ["wiki/business/主图设计sop/素材与版式.md"],
                "expected_output": "主图素材说明",
                "human_review_points": ["确认当前主图截图是否准确。"],
            }

    monkeypatch.setattr(strategy_runtime, "LiteLLMClient", FakeLiteLLMClient, raising=False)
    service = StrategyRuntimeService(BrainConfig(root=tmp_path, workspace_root=tmp_path))
    manifest = service.generate_strategy_skill_candidates("doc-hero-sop", "ecom_growth_hero_image")[0]
    service.approve_strategy_skill(manifest.skill_id, "pilot")

    result = service.run_agent(
        AgentRunRequest(
            project_path=str(tmp_path),
            doc_id="doc-hero-sop",
            scene_id="ecom_growth_hero_image",
            run_mode="generate_asset_brief",
            selected_skill_ids=[manifest.skill_id],
            grounding_sources=["wiki/business/主图设计sop/素材与版式.md"],
            task_input={
                "objective": "生成一版主图素材说明",
                "目标人群": "儿童学习桌垫购买决策者",
                "核心卖点": "护眼、防滑、易清洁",
                "素材元素": "桌面场景、产品细节、卖点短文案",
            },
        )
    )

    assert calls["count"] == 1
    assert result.status == "completed"
    assert result.execution_mode == "single_plan_local_execute"
    assert result.execution_plan["summary"] == "先读取知识页，再抽取卖点，最后整理成素材说明。"
    assert len(result.execution_plan["stepTasks"]) == 3
    assert len(result.step_executions) == 3
    assert [item["taskType"] for item in result.step_executions] == ["data_extract", "read_file", "data_transform"]
    assert "wiki/business/主图设计sop/素材与版式.md" in result.step_executions[1]["contextRefs"]
    assert "当前主图需要优先让家长" in result.step_executions[1]["stepOutput"]
    assert any(item["phase"] == "plan_execution" and item["status"] == "completed" for item in result.execution_timeline)
    assert any("一次性执行计划" in item for item in result.trace)


def test_agent_run_auto_selects_matching_approved_skill_when_selection_is_empty(tmp_path) -> None:
    write_strategy_bundle(tmp_path)
    service = StrategyRuntimeService(BrainConfig(root=tmp_path, workspace_root=tmp_path))
    manifest = service.generate_strategy_skill_candidates("doc-hero-sop", "ecom_growth_hero_image")[0]
    force_template_execution(tmp_path, manifest.skill_id)
    force_template_execution(tmp_path, manifest.skill_id)
    service.approve_strategy_skill(manifest.skill_id, "pilot")
    force_template_execution(tmp_path, manifest.skill_id)

    result = service.run_agent(
        AgentRunRequest(
            project_path=str(tmp_path),
            doc_id="doc-hero-sop",
            scene_id="ecom_growth_hero_image",
            run_mode="generate_asset_brief",
            selected_skill_ids=[],
            grounding_sources=["wiki/business/主图设计sop/素材与版式.md"],
            task_input={
                "objective": "生成一版主图素材说明",
                "目标人群": "儿童学习桌垫购买决策者",
                "核心卖点": "护眼、防滑、易清洁",
                "素材元素": "桌面场景、产品细节、卖点短文案",
            },
        )
    )

    assert result.status == "completed"
    assert result.selected_skill_ids == [manifest.skill_id]
    assert result.executed_skills[0]["skillId"] == manifest.skill_id
    assert any("自动选择已启用业务能力" in item for item in result.trace)
    assert "已选业务能力" in result.result_summary


def test_agent_run_uses_llm_structured_execution_with_wiki_and_skill_context(tmp_path, monkeypatch) -> None:
    write_strategy_bundle(tmp_path)
    write_wiki_context(tmp_path)
    captured: dict[str, object] = {}

    class FakeLiteLLMClient:
        def __init__(self, config) -> None:
            captured["config"] = config

        def completion_json(self, *, messages):
            captured["messages"] = messages
            joined = "\n".join(message["content"] for message in messages)
            assert "素材与版式" in joined
            assert "护眼、防滑、易清洁" in joined
            assert "current_step" in joined
            assert "儿童学习桌垫购买决策者" in joined
            return {
                "step_output": "当前主图第一眼卖点不够集中，需要用真实桌面学习场景强化护眼、防滑、易清洁利益点。",
                "used_inputs": ["儿童学习桌垫购买决策者", "护眼、防滑、易清洁"],
                "evidence_refs": ["block-asset-1", "block-metric-1"],
                "next_constraints": ["保持卖点第一眼可识别"],
                "validation_notes": ["需要专家确认当前主图截图是否与描述一致。"],
            }

    monkeypatch.setattr(strategy_runtime, "LiteLLMClient", FakeLiteLLMClient, raising=False)
    service = StrategyRuntimeService(BrainConfig(root=tmp_path, workspace_root=tmp_path))
    manifest = service.generate_strategy_skill_candidates("doc-hero-sop", "ecom_growth_hero_image")[0]
    force_llm_structured_execution(tmp_path, manifest.skill_id)
    service.approve_strategy_skill(manifest.skill_id, "pilot")
    force_llm_structured_execution(tmp_path, manifest.skill_id)

    result = service.run_agent(
        AgentRunRequest(
            project_path=str(tmp_path),
            doc_id="doc-hero-sop",
            scene_id="ecom_growth_hero_image",
            run_mode="generate_asset_brief",
            selected_skill_ids=[manifest.skill_id],
            grounding_sources=["wiki/business/主图设计sop/素材与版式.md"],
            task_input={
                "objective": "生成一版主图素材说明",
                "目标人群": "儿童学习桌垫购买决策者",
                "核心卖点": "护眼、防滑、易清洁",
                "素材元素": "桌面场景、产品细节、卖点短文案",
            },
        )
    )

    assert result.status == "completed"
    assert result.structured_output["diagnosis"].startswith("当前主图第一眼卖点")
    assert "真实桌面学习场景" in result.structured_output["recommended_changes"][0]
    assert any("LLM 逐步骤结构化执行完成" in item for item in result.trace)
    assert result.validation_errors == []
    assert "messages" in captured
    assert result.degradation_reason is None
    timeline = result.execution_timeline
    phases = [item["phase"] for item in timeline]
    assert "load_skill" in phases
    assert "validate_input" in phases
    assert "load_context" in phases
    assert "prepare_step" in phases
    assert "execute_step" in phases
    assert "validate_output" in phases
    assert "save_artifacts" in phases
    assert all(item["durationMs"] >= 0 for item in timeline)
    assert any(item["phase"] == "load_context" and item["data"]["wikiPageCount"] == 1 for item in timeline)
    assert len(result.step_executions) == 3
    assert [item["stepIndex"] for item in result.step_executions] == [1, 2, 3]
    assert all(item["status"] == "completed" for item in result.step_executions)
    assert result.step_executions[0]["stepTitle"] == "确认当前主图要打给哪类人群。"
    assert "儿童学习桌垫购买决策者" in result.step_executions[0]["inputRefs"]
    assert result.step_executions[0]["stepOutput"]
    assert any(item["phase"] == "execute_step" for item in timeline)
    assert any(item["phase"] == "synthesize_final" for item in timeline)


def test_agent_run_continues_when_one_step_degrades(tmp_path, monkeypatch) -> None:
    write_strategy_bundle(tmp_path)
    calls = {"count": 0}

    class FlakyLiteLLMClient:
        def __init__(self, config) -> None:
            pass

        def completion_json(self, *, messages):
            calls["count"] += 1
            if calls["count"] == 2:
                raise RuntimeError("step model failed")
            return {
                "step_output": f"第 {calls['count']} 步完成",
                "used_inputs": ["目标人群"],
                "evidence_refs": ["block-asset-1"],
                "next_constraints": ["继续保持卖点清晰"],
                "validation_notes": ["需要专家确认"],
            }

    monkeypatch.setattr(strategy_runtime, "LiteLLMClient", FlakyLiteLLMClient, raising=False)
    service = StrategyRuntimeService(BrainConfig(root=tmp_path, workspace_root=tmp_path))
    manifest = service.generate_strategy_skill_candidates("doc-hero-sop", "ecom_growth_hero_image")[0]
    force_llm_structured_execution(tmp_path, manifest.skill_id)
    service.approve_strategy_skill(manifest.skill_id, "pilot")
    force_llm_structured_execution(tmp_path, manifest.skill_id)

    result = service.run_agent(
        AgentRunRequest(
            project_path=str(tmp_path),
            doc_id="doc-hero-sop",
            scene_id="ecom_growth_hero_image",
            run_mode="generate_asset_brief",
            selected_skill_ids=[manifest.skill_id],
            grounding_sources=["wiki/business/主图设计sop/素材与版式.md"],
            task_input={
                "objective": "生成一版主图素材说明",
                "目标人群": "儿童学习桌垫购买决策者",
                "核心卖点": "护眼、防滑、易清洁",
                "素材元素": "桌面场景、产品细节、卖点短文案",
            },
        )
    )

    assert result.status == "degraded"
    assert len(result.step_executions) == 3
    assert result.step_executions[1]["status"] == "degraded"
    assert "模板兜底" in result.step_executions[1]["validationNotes"][0]
    assert result.degradation_reason is not None
    assert result.degradation_reason["code"] == "step_model_failed"
    assert any(item["phase"] == "execute_step" and item["status"] == "degraded" for item in result.execution_timeline)


def test_agent_run_degrades_to_template_when_llm_is_unavailable(tmp_path, monkeypatch) -> None:
    write_strategy_bundle(tmp_path)

    class FailingLiteLLMClient:
        def __init__(self, config) -> None:
            pass

        def completion_json(self, *, messages):
            raise RuntimeError("no configured LiteLLM provider")

    monkeypatch.setattr(strategy_runtime, "LiteLLMClient", FailingLiteLLMClient, raising=False)
    service = StrategyRuntimeService(BrainConfig(root=tmp_path, workspace_root=tmp_path))
    manifest = service.generate_strategy_skill_candidates("doc-hero-sop", "ecom_growth_hero_image")[0]
    force_llm_structured_execution(tmp_path, manifest.skill_id)
    service.approve_strategy_skill(manifest.skill_id, "pilot")
    force_llm_structured_execution(tmp_path, manifest.skill_id)

    result = service.run_agent(
        AgentRunRequest(
            project_path=str(tmp_path),
            doc_id="doc-hero-sop",
            scene_id="ecom_growth_hero_image",
            run_mode="generate_asset_brief",
            selected_skill_ids=[manifest.skill_id],
            grounding_sources=["wiki/business/主图设计sop/素材与版式.md"],
            task_input={
                "objective": "生成一版主图素材说明",
                "目标人群": "儿童学习桌垫购买决策者",
                "核心卖点": "护眼、防滑、易清洁",
                "素材元素": "桌面场景、产品细节、卖点短文案",
            },
        )
    )

    assert result.status == "degraded"
    assert result.structured_output["output_artifact"] == "主图素材说明"
    assert any("逐步骤" in item for item in result.trace)
    assert result.degradation_reason is not None
    assert result.degradation_reason["code"] == "llm_provider_unavailable"
    assert "模型服务不可用" in result.degradation_reason["title"]
    assert "配置模型 Key" in result.degradation_reason["recommendedAction"]
    assert any(item["phase"] == "fallback_template" and item["status"] == "degraded" for item in result.execution_timeline)


def test_agent_run_returns_validation_failed_when_llm_output_breaks_schema(tmp_path, monkeypatch) -> None:
    write_strategy_bundle(tmp_path)

    class InvalidLiteLLMClient:
        def __init__(self, config) -> None:
            pass

        def completion_json(self, *, messages):
            return {
                "diagnosis": "只有诊断，没有必要产物字段。",
            }

    monkeypatch.setattr(strategy_runtime, "LiteLLMClient", InvalidLiteLLMClient, raising=False)
    service = StrategyRuntimeService(BrainConfig(root=tmp_path, workspace_root=tmp_path))
    manifest = service.generate_strategy_skill_candidates("doc-hero-sop", "ecom_growth_hero_image")[0]
    force_llm_structured_execution(tmp_path, manifest.skill_id)
    service.approve_strategy_skill(manifest.skill_id, "pilot")
    force_llm_structured_execution(tmp_path, manifest.skill_id)

    result = service.run_agent(
        AgentRunRequest(
            project_path=str(tmp_path),
            doc_id="doc-hero-sop",
            scene_id="ecom_growth_hero_image",
            run_mode="generate_asset_brief",
            selected_skill_ids=[manifest.skill_id],
            grounding_sources=["wiki/business/主图设计sop/素材与版式.md"],
            task_input={
                "objective": "生成一版主图素材说明",
                "目标人群": "儿童学习桌垫购买决策者",
                "核心卖点": "护眼、防滑、易清洁",
                "素材元素": "桌面场景、产品细节、卖点短文案",
            },
        )
    )

    assert result.status == "validation_failed"
    assert {item["field"] for item in result.validation_errors} >= {"step_output"}
    assert result.degradation_reason is None
    assert any(item["phase"] == "validate_output" and item["status"] == "failed" for item in result.execution_timeline)


def test_agent_run_returns_needs_input_for_required_skill_fields(tmp_path) -> None:
    write_strategy_bundle(tmp_path)
    service = StrategyRuntimeService(BrainConfig(root=tmp_path, workspace_root=tmp_path))
    manifest = service.generate_strategy_skill_candidates("doc-hero-sop", "ecom_growth_hero_image")[0]
    force_template_execution(tmp_path, manifest.skill_id)
    service.approve_strategy_skill(manifest.skill_id, "pilot")
    force_template_execution(tmp_path, manifest.skill_id)

    result = service.run_agent(
        AgentRunRequest(
            project_path=str(tmp_path),
            doc_id="doc-hero-sop",
            scene_id="ecom_growth_hero_image",
            run_mode="generate_asset_brief",
            selected_skill_ids=[manifest.skill_id],
            grounding_sources=["wiki/business/主图设计sop/素材与版式.md"],
            task_input={"objective": "生成一版主图素材说明"},
        )
    )

    assert result.status == "needs_input"
    assert "缺少必要输入" in result.result_summary
    assert {item["field"] for item in result.validation_errors} == {"目标人群", "核心卖点", "素材元素"}
    assert result.structured_output == {}
    phases = [item["phase"] for item in result.execution_timeline]
    assert "validate_input" in phases
    assert "execute_step" not in phases
    assert result.step_executions == []


def test_agent_run_handles_missing_wiki_context_without_crashing(tmp_path) -> None:
    write_strategy_bundle(tmp_path)
    service = StrategyRuntimeService(BrainConfig(root=tmp_path, workspace_root=tmp_path))
    manifest = service.generate_strategy_skill_candidates("doc-hero-sop", "ecom_growth_hero_image")[0]
    force_template_execution(tmp_path, manifest.skill_id)
    service.approve_strategy_skill(manifest.skill_id, "pilot")
    force_template_execution(tmp_path, manifest.skill_id)

    result = service.run_agent(
        AgentRunRequest(
            project_path=str(tmp_path),
            doc_id="doc-hero-sop",
            scene_id="ecom_growth_hero_image",
            run_mode="generate_asset_brief",
            selected_skill_ids=[manifest.skill_id],
            grounding_sources=["wiki/business/主图设计sop/素材与版式.md"],
            task_input={
                "objective": "生成一版主图素材说明",
                "目标人群": "儿童学习桌垫购买决策者",
                "核心卖点": "护眼、防滑、易清洁",
                "素材元素": "桌面场景、产品细节、卖点短文案",
            },
        )
    )

    assert result.status == "completed"
    assert any("知识页缺失" in item for item in result.trace)


def test_tool_registry_invokes_approved_skill_execution_engine(tmp_path) -> None:
    write_strategy_bundle(tmp_path)
    config = BrainConfig(root=tmp_path, workspace_root=tmp_path)
    service = StrategyRuntimeService(config)
    manifest = service.generate_strategy_skill_candidates("doc-hero-sop", "ecom_growth_hero_image")[0]
    force_template_execution(tmp_path, manifest.skill_id)
    service.approve_strategy_skill(manifest.skill_id, "pilot")
    force_template_execution(tmp_path, manifest.skill_id)
    registry = ToolRegistry(config)

    output = registry.invoke(
        f"approved_skill::{manifest.skill_id}",
        {
            "project_path": str(tmp_path),
            "doc_id": "doc-hero-sop",
            "scene_id": "ecom_growth_hero_image",
            "run_mode": "generate_asset_brief",
            "objective": "生成一版主图素材说明",
            "目标人群": "儿童学习桌垫购买决策者",
            "核心卖点": "护眼、防滑、易清洁",
            "素材元素": "桌面场景、产品细节、卖点短文案",
        },
    )

    assert output["status"] == "completed"
    assert output["structured_output"]["output_artifact"] == "主图素材说明"


def test_strategy_runtime_cli_outputs_tauri_camel_case_payload(tmp_path) -> None:
    write_strategy_bundle(tmp_path)
    env = {
        **os.environ,
        "BRAIN_ROOT": str(tmp_path),
        "BRAIN_SOURCE_ROOT": str(tmp_path / "raw"),
        "BRAIN_WORKSPACE_ROOT": str(tmp_path),
        "BRAIN_SCHEMA_ENABLED": "false",
    }

    result = subprocess.run(
        [
            sys.executable,
            str(Path(__file__).resolve().parents[2] / "scripts" / "run_strategy_runtime.py"),
            "generate-skill-candidates",
            "--doc-id",
            "doc-hero-sop",
            "--scene-id",
            "ecom_growth_hero_image",
        ],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )

    payload = json.loads(result.stdout)
    assert payload
    assert "skillId" in payload[0]
    assert "originActionCardIds" in payload[0]
    assert "requiredInputs" in payload[0]
    assert "outputArtifact" in payload[0]
    assert "skill_id" not in payload[0]


def test_strategy_runtime_cli_accepts_tauri_camel_case_agent_payload(tmp_path) -> None:
    write_strategy_bundle(tmp_path)
    service = StrategyRuntimeService(BrainConfig(root=tmp_path, workspace_root=tmp_path))
    manifest = service.generate_strategy_skill_candidates("doc-hero-sop", "ecom_growth_hero_image")[0]
    force_template_execution(tmp_path, manifest.skill_id)
    service.approve_strategy_skill(manifest.skill_id, "pilot")
    force_template_execution(tmp_path, manifest.skill_id)
    env = {
        **os.environ,
        "BRAIN_ROOT": str(tmp_path),
        "BRAIN_SOURCE_ROOT": str(tmp_path / "raw"),
        "BRAIN_WORKSPACE_ROOT": str(tmp_path),
        "BRAIN_SCHEMA_ENABLED": "false",
    }
    payload = {
        "projectPath": str(tmp_path),
        "docId": "doc-hero-sop",
        "sceneId": "ecom_growth_hero_image",
        "runMode": "generate_asset_brief",
        "selectedSkillIds": [manifest.skill_id],
        "groundingSources": ["wiki/business/主图设计sop/素材与版式.md"],
        "taskInput": {
            "objective": "生成一版主图素材说明",
            "目标人群": "儿童学习桌垫购买决策者",
            "核心卖点": "护眼、防滑、易清洁",
            "素材元素": "桌面场景、产品细节、卖点短文案",
        },
        "createReviewItem": False,
    }

    result = subprocess.run(
        [
            sys.executable,
            str(Path(__file__).resolve().parents[2] / "scripts" / "run_strategy_runtime.py"),
            "run-agent",
            "--payload-json",
            json.dumps(payload, ensure_ascii=False),
        ],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )

    output = json.loads(result.stdout)
    assert output["docId"] == "doc-hero-sop"
    assert output["selectedSkillIds"] == [manifest.skill_id]
    assert output["status"] == "completed"
    assert output["structuredOutput"]["outputArtifact"] == "主图素材说明"
    assert "主图素材说明" in output["resultSummary"]
    assert "brief" not in output["resultSummary"]
    assert "doc_id" not in output
