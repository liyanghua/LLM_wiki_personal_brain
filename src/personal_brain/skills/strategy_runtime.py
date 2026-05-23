from __future__ import annotations

import json
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from time import perf_counter
from pathlib import Path
from typing import Any

from personal_brain.config import BrainConfig
from personal_brain.llm.litellm_client import LiteLLMClient
from personal_brain.models import (
    AgentRunRequest,
    AgentRunResult,
    ApprovedSkillSpec,
    SkillExecutionSpec,
    SkillValidationError,
    StrategySkillCandidateManifest,
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _duration_ms(started_at: float) -> int:
    return max(0, int((perf_counter() - started_at) * 1000))


def _slugify(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value).strip("-")
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned or "skill"


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def _as_str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _coerce_str_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _read_text(path: Path) -> str:
    if not path.exists() or not path.is_file():
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def _truncate_text(value: Any, limit: int = 5000) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "\n...[已截断]"


def _schema_key(value: str, fallback: str) -> str:
    key = _slugify(value).replace("-", "_")
    return key or fallback


_FAMILY_LABELS = {
    "audience_segment_diagnosis": "人群诊断",
    "value_prop_selection": "卖点选择",
    "creative_asset_brief_generation": "素材表达",
    "metric_signal_diagnosis": "指标判断",
    "optimization_action_planning": "优化动作",
    "experiment_validation_plan": "实验验证",
    "generic": "业务策略",
}

_PROMOTION_STATE_LABELS = {
    "candidate": "待确认",
    "approved_pilot": "试运行",
    "approved_stable": "正式启用",
}

_RUN_MODE_LABELS = {
    "diagnose_document": "诊断当前文档",
    "generate_strategy": "生成下一轮策略",
    "generate_asset_brief": "生成素材说明",
    "validate_action_plan": "验证动作方案",
}

DEFAULT_EXECUTION_SPEC = {
    "executionMode": "single_plan_local_execute",
    "requiresHumanReview": True,
    "contextSources": ["wiki_refs", "strategy_bundle", "ground_truth"],
}

LLM_STRUCTURED_REQUIRED_OUTPUTS = [
    "output_artifact",
    "diagnosis",
    "recommended_changes",
    "action_steps",
    "validation_plan",
    "evidence_refs",
    "wiki_refs",
]


def _format_business_text(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    replacements = [
        (r"\bCTR\b", "点击率", 0),
        (r"\bCVR\b", "转化率", 0),
        (r"\bROI\b", "投入产出比", 0),
        (r"\bA/B test\b", "A/B 测试", re.IGNORECASE),
        (r"\bgenerate_asset_brief\b", "生成素材说明", re.IGNORECASE),
        (r"\bgenerate asset brief\b", "生成素材说明", re.IGNORECASE),
        (r"\basset brief\b", "素材说明", re.IGNORECASE),
        (r"\bbrief\b", "说明", re.IGNORECASE),
        (r"\bgeneric\b", "通用业务策略", re.IGNORECASE),
        (r"\bstrategy-action\b", "动作卡", re.IGNORECASE),
        (r"\bAgent\b", "智能执行助手", 0),
        (r"\bSkill\b", "业务能力", 0),
        (r"\bskill\b", "业务能力", 0),
        (r"\bobjective/context\b", "目标和上下文", re.IGNORECASE),
        (r"\bgrounding sources\b", "知识依据", re.IGNORECASE),
    ]
    for pattern, replacement, flags in replacements:
        text = re.sub(pattern, replacement, text, flags=flags)
    text = re.sub(r"([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", r"\1", text)
    text = re.sub(r"([\u4e00-\u9fff])\s+([，。；：、])", r"\1\2", text)
    text = re.sub(r"([，。；：、])\s+([\u4e00-\u9fff])", r"\1\2", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _format_business_list(value: Any) -> list[str]:
    return [_format_business_text(item) for item in _as_str_list(value)]


def _family_label(family: str) -> str:
    return _FAMILY_LABELS.get(family, _FAMILY_LABELS["generic"])


def _promotion_state_label(state: str) -> str:
    return _PROMOTION_STATE_LABELS.get(state, _format_business_text(state) or state)


def _looks_like_technical_title(value: str) -> bool:
    lowered = value.lower()
    return (
        not value
        or "default-business-scene" in lowered
        or "strategy-action" in lowered
        or "generic" in lowered
        or re.search(r"[a-z0-9]{5,}-[a-z0-9]{5,}", lowered) is not None
    )


def _business_title(raw_title: str, family: str, output_artifact: str) -> str:
    title = _format_business_text(raw_title)
    if not _looks_like_technical_title(title):
        return title
    artifact = _format_business_text(output_artifact) or "可执行动作"
    return f"{_family_label(family)}：{artifact}"


def _camelize(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


def _to_camel_payload(value: Any) -> Any:
    if isinstance(value, list):
        return [_to_camel_payload(item) for item in value]
    if isinstance(value, dict):
        return {_camelize(str(key)): _to_camel_payload(item) for key, item in value.items()}
    return value


def _first_existing_value(payload: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in payload and payload[key] not in {None, ""}:
            return payload[key]
    return None


class ExecutionTimelineRecorder:
    def __init__(self) -> None:
        self.entries: list[dict[str, Any]] = []

    def record(
        self,
        *,
        phase: str,
        status: str,
        title: str,
        detail: str = "",
        severity: str = "info",
        data: dict[str, Any] | None = None,
        started_at: float | None = None,
    ) -> None:
        ended_at = _utc_now()
        self.entries.append(
            {
                "phase": phase,
                "status": status,
                "title": title,
                "detail": detail,
                "startedAt": ended_at,
                "endedAt": ended_at,
                "durationMs": _duration_ms(started_at) if started_at is not None else 0,
                "severity": severity,
                "data": data or {},
            }
        )

    def extend(self, entries: list[dict[str, Any]]) -> None:
        self.entries.extend(entries)


def _classify_llm_failure(error: Exception) -> dict[str, Any]:
    message = str(error)
    lower = message.lower()
    missing_key = ""
    for key in ["OPENAI_API_KEY", "DASHSCOPE_API_KEY", "OPENROUTER_API_KEY"]:
        if key.lower() in lower:
            missing_key = key
            break
    if missing_key or "not_configured" in lower or "no configured litellm provider" in lower:
        key_detail = f"缺少 {missing_key}。" if missing_key else "当前没有可用的模型服务 Key。"
        return {
            "code": "llm_provider_unavailable",
            "title": "模型服务不可用，已降级生成",
            "detail": f"{key_detail}系统已改用模板兜底生成保守草案。",
            "recoverable": True,
            "recommendedAction": "请在 .env 或设置中配置模型 Key 后重试智能执行助手。",
        }
    if "litellm import failed" in lower or "no module named" in lower:
        return {
            "code": "litellm_unavailable",
            "title": "LiteLLM 运行依赖不可用，已降级生成",
            "detail": "当前 Python 环境无法加载 LiteLLM，因此无法调用结构化模型执行。",
            "recoverable": True,
            "recommendedAction": "请安装或修复 LiteLLM 依赖后重试。",
        }
    if "json" in lower:
        return {
            "code": "llm_invalid_json",
            "title": "模型返回格式不可用，已降级生成",
            "detail": "模型没有返回可解析的 JSON 结构，系统已使用模板兜底。",
            "recoverable": True,
            "recommendedAction": "请重试，或调整模型配置后再次运行。",
        }
    return {
        "code": "llm_call_failed",
        "title": "模型调用失败，已降级生成",
        "detail": _truncate_text(message, 220) or "模型调用出现未知错误，系统已使用模板兜底。",
        "recoverable": True,
        "recommendedAction": "请检查模型配置、网络或稍后重试。",
    }


def _step_degradation_reason(error: Exception, step_index: int) -> dict[str, Any]:
    reason = _classify_llm_failure(error)
    if reason["code"] == "llm_call_failed":
        reason["code"] = "step_model_failed"
        reason["title"] = f"第 {step_index} 步模型执行失败，已使用模板兜底"
        reason["recommendedAction"] = "请检查模型配置或补充输入后重试；当前结果中该步骤已标记为降级。"
    reason["detail"] = f"第 {step_index} 步无法完成模型结构化执行。{reason.get('detail', '')}"
    return reason


@dataclass
class SkillExecutionEngine:
    config: BrainConfig

    @property
    def workspace_root(self) -> Path:
        return (self.config.workspace_root or self.config.root).resolve()

    def execute(
        self,
        *,
        skill: ApprovedSkillSpec,
        request: AgentRunRequest,
        strategy_bundle: dict[str, Any],
    ) -> dict[str, Any]:
        recorder = ExecutionTimelineRecorder()
        started = perf_counter()
        skill_root = Path(skill.path)
        metadata = _read_json(skill_root / "metadata.json", {})
        execution_spec = SkillExecutionSpec.model_validate(
            self._normalize_execution_spec(_read_json(skill_root / "execution.json", DEFAULT_EXECUTION_SPEC))
        )
        skill_doc = ""
        skill_doc_path = skill_root / "SKILL.md"
        if skill_doc_path.exists():
            skill_doc = skill_doc_path.read_text(encoding="utf-8")
        recorder.record(
            phase="load_skill",
            status="completed",
            title="装载业务能力",
            detail=f"已装载「{skill.title}」，执行模式为 {execution_spec.execution_mode}。",
            data={
                "skillId": skill.skill_id,
                "skillTitle": skill.title,
                "executionMode": execution_spec.execution_mode,
                "hasSkillDoc": bool(skill_doc),
            },
            started_at=started,
        )
        task_input = request.task_input or {}
        started = perf_counter()
        validation_errors = self._validate_required_inputs(skill.input_schema, task_input)
        recorder.record(
            phase="validate_input",
            status="failed" if validation_errors else "completed",
            title="校验运行输入",
            detail="缺少必要输入，已停止执行。" if validation_errors else "必要输入已满足。",
            severity="error" if validation_errors else "info",
            data={
                "missingFields": [item.field for item in validation_errors],
                "providedInputKeys": sorted(str(key) for key in task_input.keys()),
            },
            started_at=started,
        )
        started = perf_counter()
        context = self._load_context(skill=skill, request=request, strategy_bundle=strategy_bundle, metadata=metadata)
        recorder.record(
            phase="load_context",
            status="degraded" if context["warnings"] else "completed",
            title="读取业务上下文",
            detail=f"读取知识页 {len(context['wiki_pages'])} 篇，动作卡 {len(context['action_cards'])} 张。",
            severity="warning" if context["warnings"] else "info",
            data={
                "wikiPageCount": len(context["wiki_pages"]),
                "actionCardCount": len(context["action_cards"]),
                "contextRefCount": len(context["refs"]),
                "warnings": context["warnings"],
            },
            started_at=started,
        )
        trace = [
            f"已装载业务能力：{skill.title}",
            f"执行模式：{execution_spec.execution_mode}",
            f"已读取技能说明：{'是' if skill_doc else '否'}",
            *context["warnings"],
        ]
        if validation_errors:
            return {
                "skill_id": skill.skill_id,
                "title": skill.title,
                "status": "needs_input",
                "structured_output": {},
                "validation_errors": [item.model_dump(mode="json") for item in validation_errors],
                "context_refs": context["refs"],
                "trace": trace + ["缺少必要输入，已停止执行。"],
                "execution_timeline": recorder.entries,
                "degradation_reason": None,
                "step_executions": [],
                "execution_plan": {},
                "execution_mode": execution_spec.execution_mode,
            }
        degraded = False
        degradation_reason: dict[str, Any] | None = None
        step_executions: list[dict[str, Any]] = []
        execution_plan: dict[str, Any] = {}
        if execution_spec.execution_mode == "single_plan_local_execute":
            steps = self._extract_execution_steps(skill, metadata)
            try:
                plan_started = perf_counter()
                plan_payload = LiteLLMClient(self.config).completion_json(
                    messages=self._build_execution_plan_prompt(
                        skill=skill,
                        metadata=metadata,
                        execution_spec=execution_spec,
                        skill_doc=skill_doc,
                        task_input=task_input,
                        context=context,
                        request=request,
                        steps=steps,
                    )
                )
                if not isinstance(plan_payload, dict):
                    raise ValueError("execution plan is not a JSON object")
                plan_payload.pop("_meta", None)
                execution_plan = self._normalize_execution_plan(
                    plan_payload,
                    steps=steps,
                    context=context,
                    metadata=metadata,
                )
                recorder.record(
                    phase="plan_execution",
                    status="completed",
                    title="一次性生成执行计划",
                    detail=execution_plan.get("summary") or "已生成一次性执行计划。",
                    data={
                        "stepTaskCount": len(execution_plan.get("stepTasks", [])),
                        "executionMode": execution_spec.execution_mode,
                    },
                    started_at=plan_started,
                )
                trace.append("已生成一次性执行计划，本地执行后续步骤。")
            except Exception as exc:
                degraded = True
                degradation_reason = _classify_llm_failure(exc)
                plan_started = perf_counter()
                execution_plan = self._fallback_execution_plan(
                    skill=skill,
                    metadata=metadata,
                    steps=steps,
                    context=context,
                    reason=degradation_reason,
                )
                recorder.record(
                    phase="plan_execution",
                    status="degraded",
                    title="一次性执行计划生成失败",
                    detail=degradation_reason["detail"],
                    severity="warning",
                    data={"reasonCode": degradation_reason["code"]},
                    started_at=plan_started,
                )
                recorder.record(
                    phase="fallback_template",
                    status="degraded",
                    title="模板计划兜底",
                    detail="计划生成失败，已按业务能力步骤生成本地执行计划。",
                    severity="warning",
                    data={"stepTaskCount": len(execution_plan.get("stepTasks", []))},
                )
                trace.append("一次性执行计划生成失败，已模板执行。")
            for task in execution_plan.get("stepTasks", []):
                step = self._execute_local_step_task(
                    task=task if isinstance(task, dict) else {},
                    task_input=task_input,
                    context=context,
                    previous_steps=step_executions,
                    recorder=recorder,
                )
                step_executions.append(step)
                if step["status"] == "degraded":
                    degraded = True
            synth_started = perf_counter()
            structured_output = self._synthesize_final_output_from_plan(
                skill=skill,
                metadata=metadata,
                execution_plan=execution_plan,
                step_executions=step_executions,
                context=context,
            )
            recorder.record(
                phase="synthesize_final",
                status="completed",
                title="合成最终业务产物",
                detail="已基于一次性计划和本地步骤结果合成最终业务产物。",
                data={"stepCount": len(step_executions), "outputKeys": sorted(structured_output.keys())},
                started_at=synth_started,
            )
        elif execution_spec.execution_mode == "llm_structured":
            steps = self._extract_execution_steps(skill, metadata)
            for index, step_title in enumerate(steps, start=1):
                step = self._execute_skill_step(
                    skill=skill,
                    metadata=metadata,
                    step_index=index,
                    step_title=step_title,
                    task_input=task_input,
                    context=context,
                    previous_steps=step_executions,
                    request=request,
                    recorder=recorder,
                )
                step_executions.append(step)
                if step["status"] == "degraded":
                    degraded = True
                    degradation_reason = degradation_reason or step.get("degradationReason")
                if step["status"] == "failed":
                    degraded = True
            synth_started = perf_counter()
            structured_output = self._synthesize_final_output(
                skill=skill,
                metadata=metadata,
                step_executions=step_executions,
                context=context,
            )
            recorder.record(
                phase="synthesize_final",
                status="completed",
                title="合成最终业务产物",
                detail="已基于逐步骤执行结果合成最终业务产物。",
                data={"stepCount": len(step_executions), "outputKeys": sorted(structured_output.keys())},
                started_at=synth_started,
            )
            trace.append("LLM 逐步骤结构化执行完成。")
        else:
            step_executions = [
                self._template_step_output(
                    step_index=index,
                    step_title=step_title,
                    task_input=task_input,
                    context=context,
                    status="completed",
                )
                for index, step_title in enumerate(self._extract_execution_steps(skill, metadata), start=1)
            ]
            fallback_started = perf_counter()
            structured_output = self._synthesize_final_output(
                skill=skill,
                metadata=metadata,
                step_executions=step_executions,
                context=context,
            )
            recorder.record(
                phase="fallback_template",
                status="completed",
                title="模板模式生成",
                detail="该业务能力配置为模板模式，按执行步骤生成草案。",
                data={"outputArtifact": structured_output.get("output_artifact", "")},
                started_at=fallback_started,
            )
        step_output_errors = [
            SkillValidationError(
                field="step_output",
                message=f"第 {step.get('stepIndex', '?')} 步输出缺失或格式不可用。",
                code="missing_step_output",
            )
            for step in step_executions
            if step.get("status") == "failed"
        ]
        started = perf_counter()
        output_errors = [
            *step_output_errors,
            *self._validate_output(
                skill.output_schema,
                structured_output,
                require_llm_fields=execution_spec.execution_mode == "llm_structured" and not degraded,
            ),
        ]
        recorder.record(
            phase="validate_output",
            status="failed" if output_errors else "completed",
            title="校验结构化产物",
            detail="输出结构校验失败。" if output_errors else "输出结构校验通过。",
            severity="error" if output_errors else "info",
            data={"missingFields": [item.field for item in output_errors]},
            started_at=started,
        )
        if output_errors:
            status = "validation_failed"
        elif degraded:
            status = "degraded"
        else:
            status = "completed"
        return {
            "skill_id": skill.skill_id,
            "title": skill.title,
            "status": status,
            "structured_output": structured_output,
            "validation_errors": [item.model_dump(mode="json") for item in output_errors],
            "context_refs": context["refs"],
            "trace": trace + (["输出结构校验通过。"] if not output_errors else ["输出结构校验失败。"]),
            "execution_timeline": recorder.entries,
            "degradation_reason": degradation_reason,
            "step_executions": step_executions,
            "execution_plan": execution_plan,
            "execution_mode": execution_spec.execution_mode,
        }

    def _normalize_execution_spec(self, raw: Any) -> dict[str, Any]:
        if not isinstance(raw, dict):
            return {
                "execution_mode": "template",
                "requires_human_review": True,
                "context_sources": ["wiki_refs", "strategy_bundle", "ground_truth"],
            }
        return {
            "execution_mode": raw.get("execution_mode") or raw.get("executionMode") or "template",
            "requires_human_review": raw.get("requires_human_review", raw.get("requiresHumanReview", True)),
            "context_sources": raw.get("context_sources") or raw.get("contextSources") or ["wiki_refs", "strategy_bundle", "ground_truth"],
        }

    def _validate_required_inputs(self, input_schema: dict[str, Any], task_input: dict[str, Any]) -> list[SkillValidationError]:
        errors: list[SkillValidationError] = []
        required = _as_str_list(input_schema.get("required"))
        properties = input_schema.get("properties") if isinstance(input_schema.get("properties"), dict) else {}
        for key, spec in properties.items():
            description = str(spec.get("description") or "") if isinstance(spec, dict) else ""
            if description and description not in required:
                required.append(description)
        for key in required:
            value = _first_existing_value(task_input, key, _schema_key(key, key), "objective" if key == "objective" else key)
            if value is None:
                errors.append(SkillValidationError(field=key, message=f"缺少必要输入：{key}"))
        return errors

    def _validate_output(
        self,
        output_schema: dict[str, Any],
        output: dict[str, Any],
        *,
        require_llm_fields: bool = False,
    ) -> list[SkillValidationError]:
        errors: list[SkillValidationError] = []
        required = _as_str_list(output_schema.get("required"))
        if require_llm_fields:
            required = list(dict.fromkeys([*required, *LLM_STRUCTURED_REQUIRED_OUTPUTS]))
        for key in required:
            value = output.get(key)
            if value is None or value == "" or (isinstance(value, list) and not value):
                errors.append(SkillValidationError(field=key, message=f"缺少必要输出：{key}", code="missing_required_output"))
        return errors

    def _load_context(
        self,
        *,
        skill: ApprovedSkillSpec,
        request: AgentRunRequest,
        strategy_bundle: dict[str, Any],
        metadata: dict[str, Any],
    ) -> dict[str, Any]:
        refs: list[str] = []
        warnings: list[str] = []
        wiki_pages: list[dict[str, str]] = []
        wiki_refs = list(dict.fromkeys([*skill.wiki_refs, *request.grounding_sources]))
        for ref in wiki_refs:
            refs.append(ref)
            path = self.workspace_root / ref
            if path.exists() and path.is_file():
                wiki_pages.append({"path": ref, "content": _read_text(path)})
            else:
                warnings.append(f"知识页缺失：{ref}")
        strategy_path = self.workspace_root / ".llm-wiki" / "strategy-cards" / f"{request.doc_id}.json"
        refs.append(str(strategy_path))
        strategy_content = _read_text(strategy_path)
        ground_truth_path = self.workspace_root / "deliverables" / "ground-truth" / f"{request.doc_id}.json"
        ground_truth_content = ""
        if ground_truth_path.exists():
            refs.append(str(ground_truth_path))
            ground_truth_content = self._load_ground_truth_context(ground_truth_path)
        else:
            warnings.append(f"业务底稿缺失：{ground_truth_path}")
        draft_path = self.workspace_root / "deliverables" / "revised-docs" / f"{request.doc_id}.md"
        draft_content = ""
        if draft_path.exists():
            refs.append(str(draft_path))
            draft_content = _read_text(draft_path)
        origin_action_ids = set(_as_str_list(metadata.get("origin_action_card_ids")))
        action_cards = [
            item for item in strategy_bundle.get("actionCards", [])
            if isinstance(item, dict) and (not origin_action_ids or str(item.get("actionCardId") or "") in origin_action_ids)
        ]
        return {
            "refs": list(dict.fromkeys(refs)),
            "warnings": warnings,
            "wiki_pages": wiki_pages,
            "action_cards": action_cards,
            "metadata": metadata,
            "strategy_bundle": strategy_bundle,
            "strategy_path": str(strategy_path),
            "strategy_content": strategy_content,
            "ground_truth_path": str(ground_truth_path),
            "ground_truth_content": ground_truth_content,
            "draft_path": str(draft_path),
            "draft_content": draft_content,
        }

    def _load_ground_truth_context(self, path: Path) -> str:
        payload = _read_json(path, None)
        if payload is None:
            return _read_text(path)
        return json.dumps(payload, ensure_ascii=False, indent=2)

    def _llm_structured_output(
        self,
        *,
        skill: ApprovedSkillSpec,
        metadata: dict[str, Any],
        messages: list[dict[str, str]],
    ) -> dict[str, Any]:
        client = LiteLLMClient(self.config)
        payload = client.completion_json(messages=messages)
        if not isinstance(payload, dict):
            raise ValueError("LLM 返回的结构不是 JSON object")
        payload.pop("_meta", None)
        return self._normalize_llm_output(payload, skill=skill, metadata=metadata)

    def _looks_like_legacy_final_output(self, payload: dict[str, Any]) -> bool:
        return "step_output" not in payload and any(
            key in payload
            for key in ["output_artifact", "recommended_changes", "action_steps", "validation_plan"]
        )

    def _extract_execution_steps(self, skill: ApprovedSkillSpec, metadata: dict[str, Any]) -> list[str]:
        steps = _format_business_list(metadata.get("action_steps"))
        if steps:
            return steps
        skill_doc = _read_text(Path(skill.path) / "SKILL.md")
        parsed: list[str] = []
        for line in skill_doc.splitlines():
            stripped = line.strip()
            match = re.match(r"^\d+[\.\、]\s*(.+)$", stripped)
            if match:
                parsed.append(_format_business_text(match.group(1)))
        return parsed or ["根据当前业务能力生成可审阅建议。"]

    def _build_execution_plan_prompt(
        self,
        *,
        skill: ApprovedSkillSpec,
        metadata: dict[str, Any],
        execution_spec: SkillExecutionSpec,
        skill_doc: str,
        task_input: dict[str, Any],
        context: dict[str, Any],
        request: AgentRunRequest,
        steps: list[str],
    ) -> list[dict[str, str]]:
        wiki_pages = context.get("wiki_pages") if isinstance(context.get("wiki_pages"), list) else []
        action_cards = context.get("action_cards") if isinstance(context.get("action_cards"), list) else []
        payload = {
            "doc_id": request.doc_id,
            "scene_id": request.scene_id,
            "run_mode": request.run_mode,
            "execution_mode": execution_spec.execution_mode,
            "skill": {
                "title": skill.title,
                "family": skill.family,
                "output_artifact": metadata.get("output_artifact", ""),
                "action_steps": steps,
            },
            "task_input": task_input,
            "action_cards": action_cards,
            "wiki_pages": [
                {
                    "path": item.get("path", ""),
                    "content": _truncate_text(item.get("content", ""), 3000),
                }
                for item in wiki_pages
                if isinstance(item, dict)
            ],
            "ground_truth": _truncate_text(context.get("ground_truth_content", ""), 3000),
            "latest_draft": _truncate_text(context.get("draft_content", ""), 3000),
            "skill_doc": _truncate_text(skill_doc, 5000),
        }
        return [
            {
                "role": "system",
                "content": "\n".join(
                    [
                        "你是 open_llm_wiki 的智能执行助手编排器。",
                        "请一次性生成执行计划，不要执行每个步骤，也不要输出最终业务报告。",
                        "计划要把步骤拆成本地可执行任务，尽量用读取文件、数据抽取、数据整理和专家确认。",
                        "只有确实需要模型判断时才标记为 llm_reasoning；本轮不会继续追加模型调用。",
                        "必须返回 JSON object，不要返回 Markdown。",
                    ]
                ),
            },
            {
                "role": "user",
                "content": "\n".join(
                    [
                        "请围绕下列业务能力一次性生成执行计划。任务类型只能使用：",
                        "read_file / local_tool / data_extract / data_transform / human_review / llm_reasoning",
                        "",
                        "返回 JSON 结构：",
                        json.dumps(
                            {
                                "summary": "这次计划如何完成业务能力",
                                "step_tasks": [
                                    {
                                        "step_index": 1,
                                        "step_title": "步骤标题",
                                        "task_type": "data_extract",
                                        "tool_name": "",
                                        "context_refs": ["wiki/business/example.md"],
                                        "input_keys": ["objective"],
                                        "data_needs": ["需要抽取的数据"],
                                        "expected_step_output": "本步骤期望产物",
                                    }
                                ],
                                "required_context_refs": ["需要读取的上下文 ref"],
                                "expected_output": "最终产出物",
                                "human_review_points": ["需要专家确认的点"],
                            },
                            ensure_ascii=False,
                            indent=2,
                        ),
                        "",
                        "业务上下文：",
                        json.dumps(payload, ensure_ascii=False, indent=2),
                    ]
                ),
            },
        ]

    def _normalize_execution_plan(
        self,
        payload: dict[str, Any],
        *,
        steps: list[str],
        context: dict[str, Any],
        metadata: dict[str, Any],
    ) -> dict[str, Any]:
        raw_tasks = payload.get("step_tasks") or payload.get("stepTasks") or []
        if not isinstance(raw_tasks, list) or not raw_tasks:
            raise ValueError("execution plan missing step_tasks")
        allowed_types = {
            "read_file",
            "local_tool",
            "data_extract",
            "data_transform",
            "human_review",
            "llm_reasoning",
        }
        step_tasks: list[dict[str, Any]] = []
        fallback_refs = self._default_plan_context_refs(context, metadata)
        for index, raw_task in enumerate(raw_tasks, start=1):
            if not isinstance(raw_task, dict):
                continue
            task_type = str(raw_task.get("task_type") or raw_task.get("taskType") or "data_transform").strip()
            if task_type not in allowed_types:
                task_type = "data_transform"
            step_index = int(raw_task.get("step_index") or raw_task.get("stepIndex") or index)
            step_title = _format_business_text(
                raw_task.get("step_title")
                or raw_task.get("stepTitle")
                or (steps[index - 1] if index - 1 < len(steps) else f"执行第 {step_index} 步")
            )
            step_tasks.append(
                {
                    "stepIndex": step_index,
                    "stepTitle": step_title,
                    "taskType": task_type,
                    "toolName": _format_business_text(raw_task.get("tool_name") or raw_task.get("toolName") or ""),
                    "contextRefs": _coerce_str_list(raw_task.get("context_refs") or raw_task.get("contextRefs")) or fallback_refs,
                    "inputKeys": _coerce_str_list(raw_task.get("input_keys") or raw_task.get("inputKeys")),
                    "dataNeeds": [_format_business_text(item) for item in _coerce_str_list(raw_task.get("data_needs") or raw_task.get("dataNeeds"))],
                    "expectedStepOutput": _format_business_text(raw_task.get("expected_step_output") or raw_task.get("expectedStepOutput") or ""),
                }
            )
        if not step_tasks:
            raise ValueError("execution plan contains no valid step tasks")
        return {
            "planId": f"execution-plan-{int(datetime.now(timezone.utc).timestamp())}",
            "executionMode": "single_plan_local_execute",
            "summary": _format_business_text(payload.get("summary") or "已生成一次性执行计划。"),
            "stepTasks": sorted(step_tasks, key=lambda item: item["stepIndex"]),
            "requiredContextRefs": _coerce_str_list(payload.get("required_context_refs") or payload.get("requiredContextRefs")) or fallback_refs,
            "expectedOutput": _format_business_text(payload.get("expected_output") or payload.get("expectedOutput") or metadata.get("output_artifact") or "结构化业务建议"),
            "humanReviewPoints": [_format_business_text(item) for item in _coerce_str_list(payload.get("human_review_points") or payload.get("humanReviewPoints"))],
        }

    def _fallback_execution_plan(
        self,
        *,
        skill: ApprovedSkillSpec,
        metadata: dict[str, Any],
        steps: list[str],
        context: dict[str, Any],
        reason: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        context_refs = self._default_plan_context_refs(context, metadata)
        step_tasks = []
        for index, step in enumerate(steps, start=1):
            task_type = "data_extract" if index == 1 else "data_transform"
            step_tasks.append(
                {
                    "stepIndex": index,
                    "stepTitle": step,
                    "taskType": task_type,
                    "toolName": "",
                    "contextRefs": context_refs,
                    "inputKeys": _format_business_list(metadata.get("required_inputs")),
                    "dataNeeds": [_format_business_text(metadata.get("output_artifact") or skill.title)],
                    "expectedStepOutput": f"围绕「{step}」生成可审阅中间产物。",
                }
            )
        return {
            "planId": f"fallback-execution-plan-{int(datetime.now(timezone.utc).timestamp())}",
            "executionMode": "single_plan_local_execute",
            "summary": "计划生成失败，已按业务能力原始步骤生成保守执行计划。",
            "stepTasks": step_tasks,
            "requiredContextRefs": context_refs,
            "expectedOutput": _format_business_text(metadata.get("output_artifact") or "结构化业务建议"),
            "humanReviewPoints": [reason.get("recommendedAction", "请专家复核模板计划。")] if reason else ["请专家复核模板计划。"],
        }

    def _default_plan_context_refs(self, context: dict[str, Any], metadata: dict[str, Any]) -> list[str]:
        wiki_refs = _as_str_list(metadata.get("wiki_refs"))
        refs = [*wiki_refs, *[item.get("path", "") for item in context.get("wiki_pages", []) if isinstance(item, dict)]]
        return list(dict.fromkeys(ref for ref in refs if ref)) or list(context.get("refs", []))

    def _execute_local_step_task(
        self,
        *,
        task: dict[str, Any],
        task_input: dict[str, Any],
        context: dict[str, Any],
        previous_steps: list[dict[str, Any]],
        recorder: ExecutionTimelineRecorder,
    ) -> dict[str, Any]:
        step_index = int(task.get("stepIndex") or len(previous_steps) + 1)
        step_title = _format_business_text(task.get("stepTitle") or f"执行第 {step_index} 步")
        task_type = str(task.get("taskType") or "data_transform")
        prepare_started = perf_counter()
        recorder.record(
            phase="prepare_step",
            status="completed",
            title=f"准备第 {step_index} 步",
            detail=f"{step_title}（{task_type}）",
            data={"stepIndex": step_index, "taskType": task_type, "previousStepCount": len(previous_steps)},
            started_at=prepare_started,
        )
        started_at = _utc_now()
        execute_started = perf_counter()
        context_refs = _coerce_str_list(task.get("contextRefs")) or list(context.get("refs", []))
        input_keys = _coerce_str_list(task.get("inputKeys"))
        used_inputs = self._task_input_refs(task_input, input_keys)
        evidence_refs = self._task_evidence_refs(context, context_refs)
        validation_notes: list[str] = []
        if task_type == "read_file":
            step_output = self._read_file_step_output(context, context_refs, task)
        elif task_type == "local_tool":
            step_output = self._local_tool_step_output(task=task, context=context, task_input=task_input)
        elif task_type == "data_extract":
            step_output = self._data_extract_step_output(task=task, task_input=task_input, context=context)
        elif task_type == "human_review":
            step_output = self._human_review_step_output(task=task, task_input=task_input, previous_steps=previous_steps)
            validation_notes.append("该步骤需要专家确认后再进入修订或知识沉淀。")
        elif task_type == "llm_reasoning":
            step_output = self._human_review_step_output(task=task, task_input=task_input, previous_steps=previous_steps)
            validation_notes.append("该步骤需要模型判断，快速模式下先转为待专家确认项。")
        else:
            step_output = self._data_transform_step_output(task=task, task_input=task_input, previous_steps=previous_steps, context=context)
        if not step_output:
            step_output = _format_business_text(task.get("expectedStepOutput") or f"已完成「{step_title}」的本地整理。")
        status = "completed"
        if task_type == "llm_reasoning":
            status = "degraded"
        if task.get("expectedStepOutput"):
            validation_notes.append(f"期望产物：{_format_business_text(task.get('expectedStepOutput'))}")
        step = {
            "stepIndex": step_index,
            "stepTitle": step_title,
            "taskType": task_type,
            "toolName": _format_business_text(task.get("toolName") or ""),
            "inputRefs": used_inputs or self._step_input_refs(task_input),
            "contextRefs": context_refs,
            "status": status,
            "reasoningSummary": _truncate_text(step_output, 240),
            "stepOutput": step_output,
            "evidenceRefs": evidence_refs,
            "validationNotes": validation_notes,
            "nextConstraints": _format_business_list(task.get("dataNeeds")),
            "startedAt": started_at,
            "endedAt": _utc_now(),
            "durationMs": _duration_ms(execute_started),
        }
        recorder.record(
            phase="execute_step",
            status=status,
            title=f"执行第 {step_index} 步",
            detail=f"本地执行任务类型：{task_type}",
            severity="warning" if status == "degraded" else "info",
            data={"taskType": task_type, "stepOutput": _truncate_text(step_output, 180)},
            started_at=execute_started,
        )
        recorder.record(
            phase="validate_step",
            status=status,
            title=f"校验第 {step_index} 步",
            detail="步骤输出可用。" if status == "completed" else "该步骤已转为待确认项。",
            severity="warning" if status == "degraded" else "info",
            data={"stepIndex": step_index, "taskType": task_type},
        )
        return step

    def _task_input_refs(self, task_input: dict[str, Any], input_keys: list[str]) -> list[str]:
        if not input_keys:
            return self._step_input_refs(task_input)
        refs: list[str] = []
        for key in input_keys:
            value = _first_existing_value(task_input, key, _schema_key(key, key))
            if isinstance(value, str) and value.strip():
                refs.append(_format_business_text(value))
            elif value not in {None, ""}:
                refs.append(_format_business_text(f"{key}: {value}"))
        return refs

    def _task_evidence_refs(self, context: dict[str, Any], context_refs: list[str]) -> list[str]:
        action_cards = context.get("action_cards") if isinstance(context.get("action_cards"), list) else []
        refs: list[str] = []
        for card in action_cards:
            if not isinstance(card, dict):
                continue
            card_wiki_refs = set(_as_str_list(card.get("wikiRefs")))
            if not context_refs or card_wiki_refs.intersection(context_refs):
                refs.extend(_as_str_list(card.get("evidenceRefs")))
        refs.extend(_as_str_list(context.get("metadata", {}).get("source_refs")))
        return list(dict.fromkeys(refs))

    def _context_text_for_refs(self, context: dict[str, Any], refs: list[str]) -> str:
        chunks: list[str] = []
        wiki_pages = context.get("wiki_pages") if isinstance(context.get("wiki_pages"), list) else []
        for item in wiki_pages:
            if not isinstance(item, dict):
                continue
            path = item.get("path", "")
            if not refs or path in refs:
                chunks.append(f"【{path}】\n{item.get('content', '')}")
        special_contexts = [
            ("strategy_bundle", context.get("strategy_content", "")),
            ("ground_truth", context.get("ground_truth_content", "")),
            ("draft", context.get("draft_content", "")),
        ]
        for label, content in special_contexts:
            if content and (not refs or label in refs or any(label in ref for ref in refs)):
                chunks.append(f"【{label}】\n{content}")
        return "\n\n".join(chunks).strip()

    def _read_file_step_output(self, context: dict[str, Any], context_refs: list[str], task: dict[str, Any]) -> str:
        text = self._context_text_for_refs(context, context_refs)
        if not text:
            return "没有读到匹配的上下文文件，请检查知识页或业务底稿是否存在。"
        return _truncate_text(text, 1200)

    def _local_tool_step_output(self, *, task: dict[str, Any], context: dict[str, Any], task_input: dict[str, Any]) -> str:
        tool_name = str(task.get("toolName") or task.get("tool_name") or "read_page").strip() or "read_page"
        if tool_name == "read_page":
            return self._read_file_step_output(context, _coerce_str_list(task.get("contextRefs")), task)
        if tool_name == "search_wiki":
            query = " ".join(_format_business_text(value) for value in task_input.values() if isinstance(value, str))
            pages = [
                item.get("path", "")
                for item in context.get("wiki_pages", [])
                if isinstance(item, dict) and (not query or query[:12] in item.get("content", ""))
            ]
            return f"本地检索知识页，候选页面：{'、'.join(pages) or '未命中明确页面'}。"
        if tool_name == "run_lint":
            warnings = context.get("warnings", [])
            return f"本地检查完成，上下文告警 {len(warnings)} 条。"
        return f"本地工具「{_format_business_text(tool_name)}」暂无专用实现，已记录为待人工复核步骤。"

    def _data_extract_step_output(self, *, task: dict[str, Any], task_input: dict[str, Any], context: dict[str, Any]) -> str:
        lines = [f"围绕「{_format_business_text(task.get('stepTitle'))}」完成本地数据抽取。"]
        input_refs = self._task_input_refs(task_input, _coerce_str_list(task.get("inputKeys")))
        if input_refs:
            lines.append(f"使用输入：{'；'.join(input_refs)}。")
        data_needs = _format_business_list(task.get("dataNeeds"))
        if data_needs:
            lines.append(f"抽取重点：{'、'.join(data_needs)}。")
        context_text = self._context_text_for_refs(context, _coerce_str_list(task.get("contextRefs")))
        if context_text:
            lines.append(f"上下文摘要：{_truncate_text(context_text, 500)}")
        return "\n".join(lines)

    def _data_transform_step_output(
        self,
        *,
        task: dict[str, Any],
        task_input: dict[str, Any],
        previous_steps: list[dict[str, Any]],
        context: dict[str, Any],
    ) -> str:
        lines = [f"围绕「{_format_business_text(task.get('stepTitle'))}」完成本地整理。"]
        if task.get("expectedStepOutput"):
            lines.append(f"整理目标：{_format_business_text(task.get('expectedStepOutput'))}。")
        if previous_steps:
            lines.append("承接前序结论：")
            lines.extend(f"- {_truncate_text(step.get('stepOutput', ''), 220)}" for step in previous_steps[-3:])
        input_refs = self._task_input_refs(task_input, _coerce_str_list(task.get("inputKeys")))
        if input_refs:
            lines.append(f"补充输入：{'；'.join(input_refs)}。")
        evidence_refs = self._task_evidence_refs(context, _coerce_str_list(task.get("contextRefs")))
        if evidence_refs:
            lines.append(f"引用证据：{'、'.join(evidence_refs)}。")
        return "\n".join(lines)

    def _human_review_step_output(
        self,
        *,
        task: dict[str, Any],
        task_input: dict[str, Any],
        previous_steps: list[dict[str, Any]],
    ) -> str:
        lines = [f"「{_format_business_text(task.get('stepTitle'))}」需要专家确认。"]
        if task.get("expectedStepOutput"):
            lines.append(f"请确认：{_format_business_text(task.get('expectedStepOutput'))}。")
        if previous_steps:
            lines.append(f"可参考上一结论：{_truncate_text(previous_steps[-1].get('stepOutput', ''), 260)}")
        input_refs = self._task_input_refs(task_input, _coerce_str_list(task.get("inputKeys")))
        if input_refs:
            lines.append(f"相关输入：{'；'.join(input_refs)}。")
        return "\n".join(lines)

    def _execute_skill_step(
        self,
        *,
        skill: ApprovedSkillSpec,
        metadata: dict[str, Any],
        step_index: int,
        step_title: str,
        task_input: dict[str, Any],
        context: dict[str, Any],
        previous_steps: list[dict[str, Any]],
        request: AgentRunRequest,
        recorder: ExecutionTimelineRecorder,
    ) -> dict[str, Any]:
        prepare_started = perf_counter()
        recorder.record(
            phase="prepare_step",
            status="completed",
            title=f"准备第 {step_index} 步",
            detail=step_title,
            data={"stepIndex": step_index, "previousStepCount": len(previous_steps)},
            started_at=prepare_started,
        )
        started_at = _utc_now()
        execute_started = perf_counter()
        step_status = "completed"
        step_payload: dict[str, Any]
        try:
            messages = self._build_step_execution_prompt(
                skill=skill,
                metadata=metadata,
                step_index=step_index,
                step_title=step_title,
                task_input=task_input,
                context=context,
                previous_steps=previous_steps,
                request=request,
            )
            payload = LiteLLMClient(self.config).completion_json(messages=messages)
            if not isinstance(payload, dict):
                raise ValueError("step output is not a JSON object")
            payload.pop("_meta", None)
            if self._looks_like_legacy_final_output(payload):
                payload = {
                    "step_output": payload.get("diagnosis") or "；".join(_coerce_str_list(payload.get("recommended_changes"))),
                    "used_inputs": self._step_input_refs(task_input),
                    "evidence_refs": payload.get("evidence_refs") or [],
                    "next_constraints": _coerce_str_list(payload.get("recommended_changes")),
                    "validation_notes": _coerce_str_list(payload.get("review_notes")),
                }
            step_payload = payload
            step = self._normalize_step_output(
                step_payload,
                step_index=step_index,
                step_title=step_title,
                task_input=task_input,
                context=context,
                status=step_status,
                started_at=started_at,
                duration_ms=_duration_ms(execute_started),
            )
            recorder.record(
                phase="execute_step",
                status=step["status"],
                title=f"执行第 {step_index} 步",
                detail=step_title,
                severity="error" if step["status"] == "failed" else "info",
                data={"stepOutput": _truncate_text(step["stepOutput"], 180)},
                started_at=execute_started,
            )
            recorder.record(
                phase="validate_step",
                status="failed" if step["status"] == "failed" else "completed",
                title=f"校验第 {step_index} 步",
                detail="步骤输出缺失。" if step["status"] == "failed" else "步骤输出可用。",
                severity="error" if step["status"] == "failed" else "info",
                data={"stepIndex": step_index},
            )
            return step
        except Exception as exc:
            reason = _step_degradation_reason(exc, step_index)
            step = self._template_step_output(
                step_index=step_index,
                step_title=step_title,
                task_input=task_input,
                context=context,
                status="degraded",
                started_at=started_at,
                duration_ms=_duration_ms(execute_started),
                degradation_reason=reason,
            )
            recorder.record(
                phase="execute_step",
                status="degraded",
                title=f"执行第 {step_index} 步",
                detail=reason["detail"],
                severity="warning",
                data={"reasonCode": reason["code"]},
                started_at=execute_started,
            )
            recorder.record(
                phase="fallback_template",
                status="degraded",
                title=f"第 {step_index} 步模板兜底",
                detail="模型步骤执行不可用，已用该步骤标题和已读取上下文生成保守草案。",
                severity="warning",
                data={"stepIndex": step_index, "reasonCode": reason["code"]},
            )
            recorder.record(
                phase="validate_step",
                status="degraded",
                title=f"校验第 {step_index} 步",
                detail="该步骤使用模板兜底，待专家复核。",
                severity="warning",
                data={"stepIndex": step_index},
            )
            return step

    def _build_step_execution_prompt(
        self,
        *,
        skill: ApprovedSkillSpec,
        metadata: dict[str, Any],
        step_index: int,
        step_title: str,
        task_input: dict[str, Any],
        context: dict[str, Any],
        previous_steps: list[dict[str, Any]],
        request: AgentRunRequest,
    ) -> list[dict[str, str]]:
        wiki_pages = context.get("wiki_pages") if isinstance(context.get("wiki_pages"), list) else []
        action_cards = context.get("action_cards") if isinstance(context.get("action_cards"), list) else []
        payload = {
            "doc_id": request.doc_id,
            "scene_id": request.scene_id,
            "run_mode": request.run_mode,
            "skill": {
                "title": skill.title,
                "family": skill.family,
                "output_artifact": metadata.get("output_artifact", ""),
            },
            "current_step": {
                "step_index": step_index,
                "step_title": step_title,
            },
            "task_input": task_input,
            "previous_steps": previous_steps,
            "action_cards": action_cards,
            "wiki_pages": [
                {
                    "path": item.get("path", ""),
                    "content": _truncate_text(item.get("content", ""), 2500),
                }
                for item in wiki_pages
                if isinstance(item, dict)
            ],
            "ground_truth": _truncate_text(context.get("ground_truth_content", ""), 2500),
            "latest_draft": _truncate_text(context.get("draft_content", ""), 2500),
        }
        return [
            {
                "role": "system",
                "content": "\n".join(
                    [
                        "你是 open_llm_wiki 的智能执行助手，正在逐步骤执行一个业务能力。",
                        "只执行当前步骤，不要一次性完成全部步骤。",
                        "必须返回 JSON object，不要返回 Markdown。",
                    ]
                ),
            },
            {
                "role": "user",
                "content": "\n".join(
                    [
                        "请执行当前步骤，并返回如下 JSON：",
                        json.dumps(
                            {
                                "step_output": "当前步骤的中间结论或产物",
                                "used_inputs": ["本步骤使用到的用户输入值或字段"],
                                "evidence_refs": ["本步骤使用到的证据 ref"],
                                "next_constraints": ["下一步需要遵守的约束"],
                                "validation_notes": ["需要专家确认或验证的事项"],
                            },
                            ensure_ascii=False,
                            indent=2,
                        ),
                        "",
                        "执行上下文：",
                        json.dumps(payload, ensure_ascii=False, indent=2),
                    ]
                ),
            },
        ]

    def _normalize_step_output(
        self,
        payload: dict[str, Any],
        *,
        step_index: int,
        step_title: str,
        task_input: dict[str, Any],
        context: dict[str, Any],
        status: str,
        started_at: str,
        duration_ms: int,
    ) -> dict[str, Any]:
        output = _format_business_text(payload.get("step_output") or payload.get("output") or "")
        output_missing = not output
        return {
            "stepIndex": step_index,
            "stepTitle": step_title,
            "inputRefs": _coerce_str_list(payload.get("used_inputs")) or self._step_input_refs(task_input),
            "contextRefs": context["refs"],
            "status": "failed" if output_missing else status,
            "reasoningSummary": output,
            "stepOutput": output,
            "evidenceRefs": _coerce_str_list(payload.get("evidence_refs")),
            "validationNotes": (
                [_format_business_text(item) for item in _coerce_str_list(payload.get("validation_notes"))]
                or (["步骤输出缺失。"] if output_missing else [])
            ),
            "nextConstraints": [_format_business_text(item) for item in _coerce_str_list(payload.get("next_constraints"))],
            "startedAt": started_at,
            "endedAt": _utc_now(),
            "durationMs": duration_ms,
        }

    def _template_step_output(
        self,
        *,
        step_index: int,
        step_title: str,
        task_input: dict[str, Any],
        context: dict[str, Any],
        status: str,
        started_at: str | None = None,
        duration_ms: int = 0,
        degradation_reason: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        started = started_at or _utc_now()
        notes = ["模板兜底：请专家确认该步骤产出。"] if status == "degraded" else ["模板步骤执行，建议人工复核。"]
        return {
            "stepIndex": step_index,
            "stepTitle": step_title,
            "inputRefs": self._step_input_refs(task_input),
            "contextRefs": context["refs"],
            "status": status,
            "reasoningSummary": f"围绕「{step_title}」生成保守执行草案。",
            "stepOutput": f"围绕「{step_title}」生成保守执行草案。",
            "evidenceRefs": _as_str_list(context.get("metadata", {}).get("source_refs")),
            "validationNotes": notes,
            "nextConstraints": [],
            "startedAt": started,
            "endedAt": _utc_now(),
            "durationMs": duration_ms,
            "degradationReason": degradation_reason,
        }

    def _step_input_refs(self, task_input: dict[str, Any]) -> list[str]:
        return [_format_business_text(value) for value in task_input.values() if isinstance(value, str) and value.strip()]

    def _synthesize_final_output(
        self,
        *,
        skill: ApprovedSkillSpec,
        metadata: dict[str, Any],
        step_executions: list[dict[str, Any]],
        context: dict[str, Any],
    ) -> dict[str, Any]:
        step_outputs = [step.get("stepOutput", "") for step in step_executions if step.get("stepOutput")]
        evidence_refs = list(dict.fromkeys(ref for step in step_executions for ref in step.get("evidenceRefs", [])))
        wiki_refs = list(dict.fromkeys(skill.wiki_refs))
        validation_notes = [note for step in step_executions for note in step.get("validationNotes", [])]
        output_artifact = _format_business_text(metadata.get("output_artifact") or "结构化业务建议")
        return {
            "output_artifact": output_artifact,
            "skill_title": skill.title,
            "diagnosis": step_outputs[0] if step_outputs else f"已按步骤生成「{output_artifact}」草案。",
            "recommended_changes": step_outputs,
            "action_steps": [step.get("stepTitle", "") for step in step_executions if step.get("stepTitle")],
            "validation_plan": "；".join(_format_business_list(metadata.get("validation_criteria"))) or "请结合当前业务指标验证输出建议。",
            "evidence_refs": evidence_refs or skill.source_refs,
            "wiki_refs": wiki_refs,
            "review_notes": validation_notes,
            "input_summary": {
                item: step_executions[0].get("inputRefs", [])
                for item in _format_business_list(metadata.get("required_inputs"))
            } if step_executions else {},
            "context_summary": f"读取知识页 {len(context['wiki_pages'])} 篇，动作卡 {len(context['action_cards'])} 张。",
        }

    def _synthesize_final_output_from_plan(
        self,
        *,
        skill: ApprovedSkillSpec,
        metadata: dict[str, Any],
        execution_plan: dict[str, Any],
        step_executions: list[dict[str, Any]],
        context: dict[str, Any],
    ) -> dict[str, Any]:
        output = self._synthesize_final_output(
            skill=skill,
            metadata=metadata,
            step_executions=step_executions,
            context=context,
        )
        human_review_points = _format_business_list(execution_plan.get("humanReviewPoints"))
        if human_review_points:
            output["review_notes"] = list(dict.fromkeys([*output.get("review_notes", []), *human_review_points]))
        plan_summary = _format_business_text(execution_plan.get("summary") or "")
        if plan_summary:
            output["diagnosis"] = f"{plan_summary}\n{output.get('diagnosis', '')}".strip()
        output["execution_mode"] = "single_plan_local_execute"
        output["execution_plan_summary"] = plan_summary
        output["action_steps"] = [
            _format_business_text(step.get("stepTitle", ""))
            for step in step_executions
            if step.get("stepTitle")
        ]
        return output

    def _build_skill_execution_prompt(
        self,
        *,
        skill: ApprovedSkillSpec,
        metadata: dict[str, Any],
        execution_spec: SkillExecutionSpec,
        skill_doc: str,
        task_input: dict[str, Any],
        context: dict[str, Any],
        request: AgentRunRequest,
    ) -> list[dict[str, str]]:
        action_cards = context.get("action_cards") if isinstance(context.get("action_cards"), list) else []
        wiki_pages = context.get("wiki_pages") if isinstance(context.get("wiki_pages"), list) else []
        user_payload = {
            "run_mode": request.run_mode,
            "doc_id": request.doc_id,
            "scene_id": request.scene_id,
            "task_input": task_input,
            "skill": {
                "skill_id": skill.skill_id,
                "title": skill.title,
                "family": skill.family,
                "tier": skill.tier,
                "source_refs": skill.source_refs,
                "wiki_refs": skill.wiki_refs,
            },
            "skill_metadata": metadata,
            "execution_spec": execution_spec.model_dump(mode="json"),
            "input_schema": skill.input_schema,
            "output_schema": skill.output_schema,
            "action_cards": action_cards,
            "wiki_pages": [
                {
                    "path": item.get("path", ""),
                    "content": _truncate_text(item.get("content", ""), 3000),
                }
                for item in wiki_pages
                if isinstance(item, dict)
            ],
            "ground_truth": _truncate_text(context.get("ground_truth_content", ""), 3000),
            "latest_draft": _truncate_text(context.get("draft_content", ""), 3000),
            "skill_doc": _truncate_text(skill_doc, 5000),
        }
        return [
            {
                "role": "system",
                "content": "\n".join(
                    [
                        "你是 open_llm_wiki 的智能执行助手，负责执行已启用的业务能力。",
                        "必须使用中文业务语言，避免暴露技术字段名、目录名或英文模板腔。",
                        "你只能基于传入的 Skill、业务知识页、策略动作卡、GroundTruth 与用户输入生成建议。",
                        "不要自动写回 wiki、GroundTruth 或 deliverables；输出必须是可审阅草案。",
                        "只返回 JSON object，不要返回 Markdown 或额外解释。",
                    ]
                ),
            },
            {
                "role": "user",
                "content": "\n".join(
                    [
                        "请执行这个业务能力，并返回满足以下结构的 JSON：",
                        json.dumps(
                            {
                                "output_artifact": "本次产出物名称",
                                "diagnosis": "基于输入和知识页得到的业务诊断",
                                "recommended_changes": ["具体建议动作"],
                                "action_steps": ["执行步骤"],
                                "validation_plan": "验证计划，包含指标和观察方式",
                                "evidence_refs": ["使用到的 evidence ref"],
                                "wiki_refs": ["使用到的 wiki 页面"],
                                "review_notes": ["需要专家确认的事项"],
                            },
                            ensure_ascii=False,
                            indent=2,
                        ),
                        "",
                        "上下文如下：",
                        json.dumps(user_payload, ensure_ascii=False, indent=2),
                    ]
                ),
            },
        ]

    def _normalize_llm_output(
        self,
        payload: dict[str, Any],
        *,
        skill: ApprovedSkillSpec,
        metadata: dict[str, Any],
    ) -> dict[str, Any]:
        output = dict(payload)
        output["output_artifact"] = _format_business_text(output.get("output_artifact") or "")
        output["skill_title"] = _format_business_text(output.get("skill_title") or skill.title)
        output["diagnosis"] = _format_business_text(output.get("diagnosis") or "")
        output["recommended_changes"] = [_format_business_text(item) for item in _coerce_str_list(output.get("recommended_changes"))]
        output["action_steps"] = [_format_business_text(item) for item in _coerce_str_list(output.get("action_steps"))]
        output["validation_plan"] = _format_business_text(output.get("validation_plan") or "")
        output["evidence_refs"] = _coerce_str_list(output.get("evidence_refs"))
        output["wiki_refs"] = _coerce_str_list(output.get("wiki_refs"))
        output["review_notes"] = [_format_business_text(item) for item in _coerce_str_list(output.get("review_notes"))]
        return output

    def _template_output(
        self,
        skill: ApprovedSkillSpec,
        metadata: dict[str, Any],
        task_input: dict[str, Any],
        context: dict[str, Any],
    ) -> dict[str, Any]:
        action_steps = _format_business_list(metadata.get("action_steps"))
        validation_criteria = _format_business_list(metadata.get("validation_criteria"))
        required_inputs = _format_business_list(metadata.get("required_inputs"))
        input_summary: dict[str, Any] = {}
        for item in required_inputs:
            input_summary[item] = _first_existing_value(task_input, item, _schema_key(item, item)) or ""
        return {
            "output_artifact": _format_business_text(metadata.get("output_artifact") or "结构化业务建议"),
            "skill_title": skill.title,
            "input_summary": input_summary,
            "action_steps": action_steps,
            "validation_plan": "；".join(validation_criteria) or "请结合当前业务指标验证输出建议。",
            "evidence_refs": skill.source_refs,
            "wiki_refs": skill.wiki_refs,
            "context_summary": f"读取知识页 {len(context['wiki_pages'])} 篇，动作卡 {len(context['action_cards'])} 张。",
        }


@dataclass
class StrategyRuntimeService:
    config: BrainConfig

    @property
    def paths(self):
        return self.config.paths

    def ensure_project_binding(self) -> dict[str, Any]:
        payload = {
            "projectPath": str((self.config.workspace_root or self.config.root).resolve()),
            "brainRoot": str(self.config.root.resolve()),
            "sourceRoot": str(self.paths.raw),
            "workspaceRoot": str((self.config.workspace_root or self.config.root).resolve()),
            "schemaEnabled": bool(self.config.schema_enabled),
            "createdAt": _utc_now(),
            "updatedAt": _utc_now(),
        }
        path = self.paths.brain_binding_dir / "open_llm_wiki.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return payload

    def _load_strategy_bundle(self, doc_id: str) -> dict[str, Any]:
        path = (self.config.workspace_root or self.config.root) / ".llm-wiki" / "strategy-cards" / f"{doc_id}.json"
        bundle = _read_json(path, {})
        if not isinstance(bundle, dict):
            raise ValueError(f"策略包不存在或无法读取：{path}")
        return bundle

    def _candidate_dir(self, skill_id: str) -> Path:
        return self.paths.skills_candidates / skill_id

    def _approved_dir(self, skill_id: str) -> Path:
        return self.paths.skills_approved / skill_id

    def generate_strategy_skill_candidates(self, doc_id: str, scene_id: str) -> list[StrategySkillCandidateManifest]:
        bundle = self._load_strategy_bundle(doc_id)
        cards = bundle.get("actionCards") or []
        legacy_cards = bundle.get("strategyCards") or []
        if not cards and legacy_cards:
            cards = legacy_cards
        manifests: list[StrategySkillCandidateManifest] = []
        for card in cards:
            if not isinstance(card, dict):
                continue
            if card.get("status") not in {"confirmed", "promoted_to_skill"}:
                continue
            family = str(card.get("skillFamily") or card.get("category") or card.get("cardType") or "generic").strip() or "generic"
            action_steps = _format_business_list(card.get("actionSteps"))
            required_inputs = _format_business_list(card.get("requiredInputs"))
            validation_metrics = _format_business_list(card.get("validationMetrics"))
            output_artifact = _format_business_text(card.get("outputArtifact") or "")
            trigger = _format_business_text(card.get("triggerCondition") or card.get("whyNow") or "")
            summary = (
                trigger
                or _format_business_text(card.get("recommendation") or "")
                or "来自已确认动作卡的业务能力候选。"
            )
            title = _business_title(str(card.get("title") or ""), family, output_artifact)
            action_id = str(card.get("actionCardId") or card.get("cardId") or "")
            skill_id = _slugify(f"{scene_id}-{doc_id}-{family}-{action_id or title}")
            manifest = StrategySkillCandidateManifest(
                skill_id=skill_id,
                family=family,
                title=title,
                summary=summary,
                scene_id=scene_id,
                linked_doc_ids=[doc_id],
                origin_strategy_card_ids=[str(card.get("cardId") or "")] if card.get("cardId") else [],
                origin_action_card_ids=[action_id] if action_id else [],
                wiki_refs=_as_str_list(card.get("wikiRefs")) or _as_str_list(bundle.get("linkedWikiRefs")),
                source_refs=[ref for ref in card.get("evidenceRefs", []) if isinstance(ref, str)],
                validation_criteria=validation_metrics or [
                    _format_business_text(card.get("validationPlan") or "") or "请结合当前业务指标验证输出建议。"
                ],
                required_inputs=required_inputs,
                output_artifact=output_artifact,
                action_steps=action_steps,
                schema_version=int(bundle.get("schemaVersion") or 1),
                promotion_state="approved_pilot" if card.get("status") == "promoted_to_skill" else "candidate",
                generated_at=_utc_now(),
            )
            self._write_candidate_package(manifest, card)
            manifests.append(manifest)

        index_path = self.paths.skills_candidates / "index.json"
        index_path.write_text(
            json.dumps([manifest.model_dump(mode="json") for manifest in manifests], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return manifests

    def _write_candidate_package(self, manifest: StrategySkillCandidateManifest, card: dict[str, Any]) -> None:
        root = self._candidate_dir(manifest.skill_id)
        examples = root / "examples"
        examples.mkdir(parents=True, exist_ok=True)
        (root / "SKILL.md").write_text(
            "\n".join(
                [
                    f"# {manifest.title}",
                    "",
                    manifest.summary,
                    "",
                    "## 触发条件",
                    "",
                    f"- {manifest.summary or '待补齐'}",
                    "",
                    "## 输入要求",
                    "",
                    *[f"- {item}" for item in manifest.required_inputs],
                    "",
                    "## 执行步骤",
                    "",
                    *[f"{index + 1}. {step}" for index, step in enumerate(manifest.action_steps)],
                    "",
                    "## 产出物",
                    "",
                    f"- {manifest.output_artifact or '结构化业务建议'}",
                    "",
                    "## 使用边界",
                    "",
                    "- 仅基于已确认的业务策略卡与业务知识页生成建议。",
                    "- 不能直接改写主知识层，结果应先作为建议或运行产物回看。",
                    "",
                    "## 验证标准",
                    "",
                    *[f"- {item}" for item in manifest.validation_criteria],
                    "",
                    "## 追溯信息",
                    "",
                    f"- 能力类型：{_family_label(manifest.family)}",
                    f"- 当前状态：{_promotion_state_label(manifest.promotion_state)}",
                    f"- 来源动作卡：{', '.join(manifest.origin_action_card_ids) or '无'}",
                    "",
                    "待人工确认后启用",
                ]
            ).strip() + "\n",
            encoding="utf-8",
        )
        input_schema = {
            "type": "object",
            "properties": {
                "objective": {"type": "string"},
                "grounding_sources": {"type": "array", "items": {"type": "string"}},
                "context": {"type": "string"},
                **{
                    _schema_key(item, f"input_{index + 1}"): {
                        "type": "string",
                        "description": item,
                    }
                    for index, item in enumerate(manifest.required_inputs)
                },
            },
            "required": ["objective"],
        }
        output_schema = {
            "type": "object",
            "properties": {
                "output_artifact": {
                    "type": "string",
                    "description": manifest.output_artifact or "业务能力运行产物",
                },
                "action_steps": {"type": "array", "items": {"type": "string"}},
                "validation_plan": {"type": "string"},
                "evidence_refs": {"type": "array", "items": {"type": "string"}},
                "wiki_refs": {"type": "array", "items": {"type": "string"}},
            },
        }
        (root / "input_schema.json").write_text(json.dumps(input_schema, ensure_ascii=False, indent=2), encoding="utf-8")
        (root / "output_schema.json").write_text(json.dumps(output_schema, ensure_ascii=False, indent=2), encoding="utf-8")
        (root / "execution.json").write_text(
            json.dumps(DEFAULT_EXECUTION_SPEC, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        (examples / "example_01.md").write_text(
            "\n".join(
                [
                    f"# {manifest.title}",
                    "",
                    f"- 触发条件：{_format_business_text(card.get('triggerCondition') or card.get('whyNow') or '')}",
                    f"- 产出物：{manifest.output_artifact}",
                    f"- 验证指标：{'、'.join(manifest.validation_criteria)}",
                    "",
                    "## 执行步骤",
                    *[f"- {step}" for step in manifest.action_steps],
                ]
            ).strip() + "\n",
            encoding="utf-8",
        )
        (root / "metadata.json").write_text(
            json.dumps(manifest.model_dump(mode="json"), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def approve_strategy_skill(self, skill_id: str, tier: str) -> ApprovedSkillSpec:
        source = self._candidate_dir(skill_id)
        if not source.exists():
            raise ValueError(f"技能候选不存在：{skill_id}")
        metadata = StrategySkillCandidateManifest.model_validate(_read_json(source / "metadata.json", {}))
        target = self._approved_dir(skill_id)
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(source, target)
        approved = ApprovedSkillSpec(
            skill_id=skill_id,
            title=_format_business_text(metadata.title),
            scene_id=metadata.scene_id,
            tier=tier,
            family=metadata.family,
            path=str(target),
            wiki_refs=metadata.wiki_refs,
            source_refs=metadata.source_refs,
            input_schema=_read_json(target / "input_schema.json", {}),
            output_schema=_read_json(target / "output_schema.json", {}),
            execution_spec=_read_json(target / "execution.json", DEFAULT_EXECUTION_SPEC),
        )
        merged_meta = {
            **metadata.model_dump(mode="json"),
            "promotion_state": f"approved_{tier}",
            "tier": tier,
            "approved_at": _utc_now(),
        }
        (target / "metadata.json").write_text(json.dumps(merged_meta, ensure_ascii=False, indent=2), encoding="utf-8")
        return approved

    def list_approved_skills(self) -> list[ApprovedSkillSpec]:
        items: list[ApprovedSkillSpec] = []
        for path in sorted(self.paths.skills_approved.iterdir()) if self.paths.skills_approved.exists() else []:
            if not path.is_dir():
                continue
            meta = _read_json(path / "metadata.json", {})
            if not isinstance(meta, dict):
                continue
            items.append(
                ApprovedSkillSpec(
                    skill_id=str(meta.get("skill_id") or path.name),
                    title=str(meta.get("title") or path.name),
                    scene_id=str(meta.get("scene_id") or ""),
                    tier=str(meta.get("tier") or "pilot"),
                    family=str(meta.get("family") or "generic"),
                    path=str(path),
                    wiki_refs=[item for item in meta.get("wiki_refs", []) if isinstance(item, str)],
                    source_refs=[item for item in meta.get("source_refs", []) if isinstance(item, str)],
                    input_schema=_read_json(path / "input_schema.json", {}),
                    output_schema=_read_json(path / "output_schema.json", {}),
                    execution_spec=_read_json(path / "execution.json", DEFAULT_EXECUTION_SPEC),
                )
            )
        return items

    def _auto_select_approved_skills(
        self,
        *,
        approved_skills: list[ApprovedSkillSpec],
        doc_id: str,
        scene_id: str,
    ) -> list[ApprovedSkillSpec]:
        selected: list[ApprovedSkillSpec] = []
        for skill in approved_skills:
            metadata = _read_json(Path(skill.path) / "metadata.json", {})
            linked_doc_ids = _as_str_list(metadata.get("linked_doc_ids"))
            scene_matches = not skill.scene_id or skill.scene_id == scene_id
            doc_matches = not linked_doc_ids or doc_id in linked_doc_ids
            if scene_matches and doc_matches:
                selected.append(skill)
        return selected

    def run_agent(self, request: AgentRunRequest) -> AgentRunResult:
        approved_skills = self.list_approved_skills()
        approved = {item.skill_id: item for item in approved_skills}
        selected = [approved[skill_id] for skill_id in request.selected_skill_ids if skill_id in approved]
        if request.selected_skill_ids and not selected:
            raise ValueError("当前没有可运行的已启用业务能力。请先把至少一个业务能力设为试运行或正式启用。")
        auto_selected = False
        if not request.selected_skill_ids:
            selected = self._auto_select_approved_skills(
                approved_skills=approved_skills,
                doc_id=request.doc_id,
                scene_id=request.scene_id,
            )
            auto_selected = bool(selected)
        selected_skill_ids = [item.skill_id for item in selected] if auto_selected else request.selected_skill_ids
        bundle = self._load_strategy_bundle(request.doc_id)
        engine = SkillExecutionEngine(self.config)
        summary_lines = [
            f"运行模式：{_RUN_MODE_LABELS.get(request.run_mode, _format_business_text(request.run_mode))}",
            f"文档：{request.doc_id}",
            f"场景：{request.scene_id}",
            f"已选业务能力：{', '.join(_format_business_text(item.title) for item in selected) if selected else '未指定，按当前策略卡总结'}",
        ]
        action_cards = bundle.get("actionCards") or []
        strategy_cards = bundle.get("strategyCards") or []
        traces = [
            "已读取策略包",
            f"动作卡数量：{len(action_cards)}",
            f"摘要策略卡数量：{len(strategy_cards)}",
            f"已启用业务能力数量：{len(selected)}",
            f"知识依据数量：{len(request.grounding_sources)}",
        ]
        if auto_selected:
            traces.append(f"自动选择已启用业务能力：{', '.join(item.skill_id for item in selected)}")
        execution_results: list[dict[str, Any]] = []
        if selected:
            for skill in selected:
                execution_results.append(engine.execute(skill=skill, request=request, strategy_bundle=bundle))
        else:
            for card in action_cards[:4]:
                if not isinstance(card, dict):
                    continue
                execution_results.append(self._fallback_card_execution(card, request))
        if not execution_results:
            execution_results.append({
                "skill_id": "",
                "title": "当前动作卡",
                "status": "needs_input",
                "structured_output": {},
                "validation_errors": [{"field": "action_card", "message": "当前没有可运行的动作卡。", "code": "missing_action_card"}],
                "context_refs": [],
                "trace": ["当前没有可运行的动作卡。"],
                "execution_timeline": [
                    {
                        "phase": "load_skill",
                        "status": "failed",
                        "title": "查找可运行能力",
                        "detail": "当前没有可运行的动作卡。",
                        "startedAt": _utc_now(),
                        "endedAt": _utc_now(),
                        "durationMs": 0,
                        "severity": "error",
                        "data": {},
                    }
                ],
                "degradation_reason": None,
                "step_executions": [],
                "execution_plan": {},
                "execution_mode": "none",
            })
        status = "completed"
        if any(item["status"] == "validation_failed" for item in execution_results):
            status = "validation_failed"
        if any(item["status"] == "needs_input" for item in execution_results):
            status = "needs_input"
        if status == "completed" and any(item["status"] == "degraded" for item in execution_results):
            status = "degraded"
        structured_output = execution_results[0].get("structured_output", {}) if len(execution_results) == 1 else {
            "skill_results": [item.get("structured_output", {}) for item in execution_results]
        }
        validation_errors = [
            error
            for item in execution_results
            for error in item.get("validation_errors", [])
        ]
        context_refs = list(dict.fromkeys(ref for item in execution_results for ref in item.get("context_refs", [])))
        traces.extend(trace for item in execution_results for trace in item.get("trace", []))
        execution_timeline = [
            entry
            for item in execution_results
            for entry in item.get("execution_timeline", [])
            if isinstance(entry, dict)
        ]
        step_executions = [
            step
            for item in execution_results
            for step in item.get("step_executions", [])
            if isinstance(step, dict)
        ]
        degradation_reason = next(
            (
                item.get("degradation_reason")
                for item in execution_results
                if item.get("degradation_reason")
            ),
            None,
        )
        if len(execution_results) == 1:
            execution_plan = execution_results[0].get("execution_plan", {})
            execution_mode = str(execution_results[0].get("execution_mode") or "")
        else:
            plans = [
                {
                    "skillId": item.get("skill_id", ""),
                    "title": item.get("title", ""),
                    "executionMode": item.get("execution_mode", ""),
                    "executionPlan": item.get("execution_plan", {}),
                }
                for item in execution_results
                if item.get("execution_plan")
            ]
            execution_plan = {"skillPlans": plans} if plans else {}
            modes = list(dict.fromkeys(str(item.get("execution_mode") or "") for item in execution_results if item.get("execution_mode")))
            execution_mode = ",".join(modes)
        conclusion = self._render_agent_summary(execution_results)
        artifacts_dir = self.paths.skill_runs_dir
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        run_id = f"agent-run-{request.doc_id}-{int(datetime.now(timezone.utc).timestamp())}"
        artifact_path = artifacts_dir / f"{run_id}.json"
        markdown_path = artifacts_dir / f"{run_id}.md"
        saved_at = _utc_now()
        execution_timeline.append(
            {
                "phase": "save_artifacts",
                "status": "completed",
                "title": "保存运行产物",
                "detail": "已保存 JSON 和 Markdown 运行记录。",
                "startedAt": saved_at,
                "endedAt": saved_at,
                "durationMs": 0,
                "severity": "info",
                "data": {
                    "jsonPath": str(artifact_path),
                    "markdownPath": str(markdown_path),
                },
            }
        )
        result = AgentRunResult(
            run_id=run_id,
            project_path=request.project_path,
            doc_id=request.doc_id,
            scene_id=request.scene_id,
            run_mode=request.run_mode,
            selected_skill_ids=selected_skill_ids,
            grounding_sources=request.grounding_sources,
            status=status,
            executed_skills=[
                _to_camel_payload({
                    "skill_id": item.get("skill_id", ""),
                    "title": item.get("title", ""),
                    "status": item.get("status", ""),
                })
                for item in execution_results
                if item.get("skill_id")
            ],
            context_refs=context_refs,
            structured_output=structured_output,
            validation_errors=validation_errors,
            execution_timeline=execution_timeline,
            degradation_reason=degradation_reason,
            step_executions=step_executions,
            execution_plan=execution_plan if isinstance(execution_plan, dict) else {},
            execution_mode=execution_mode,
            review_item_id=None,
            result_summary="\n".join(summary_lines + ["", conclusion]),
            trace=traces,
            output_artifacts=[str(artifact_path), str(markdown_path)],
            created_at=_utc_now(),
        )
        artifact_path.write_text(json.dumps(result.model_dump(mode="json"), ensure_ascii=False, indent=2), encoding="utf-8")
        markdown_path.write_text(self._render_run_markdown(result), encoding="utf-8")
        return result

    def _fallback_card_execution(self, card: dict[str, Any], request: AgentRunRequest) -> dict[str, Any]:
        action_steps = _format_business_list(card.get("actionSteps"))
        wiki_refs = _as_str_list(card.get("wikiRefs"))
        evidence_refs = _as_str_list(card.get("evidenceRefs"))
        timestamp = _utc_now()
        return {
            "skill_id": "",
            "title": _format_business_text(card.get("title") or card.get("category")),
            "status": "completed",
            "structured_output": {
                "output_artifact": _format_business_text(card.get("outputArtifact") or "结构化业务建议"),
                "action_steps": action_steps,
                "validation_plan": "；".join(_format_business_list(card.get("validationMetrics"))) or "待补齐",
                "evidence_refs": evidence_refs,
                "wiki_refs": wiki_refs,
            },
            "validation_errors": [],
            "context_refs": wiki_refs,
            "trace": ["未选择业务能力，按当前动作卡生成运行草案。"],
            "execution_timeline": [
                {
                    "phase": "fallback_template",
                    "status": "completed",
                    "title": "动作卡草案生成",
                    "detail": "未选择业务能力，按当前动作卡生成运行草案。",
                    "startedAt": _utc_now(),
                    "endedAt": _utc_now(),
                    "durationMs": 0,
                    "severity": "info",
                    "data": {"actionCardId": card.get("actionCardId", "")},
                }
            ],
            "degradation_reason": None,
            "step_executions": [
                {
                    "stepIndex": index,
                    "stepTitle": step,
                    "taskType": "data_transform",
                    "toolName": "",
                    "inputRefs": [],
                    "contextRefs": wiki_refs,
                    "status": "completed",
                    "reasoningSummary": f"按动作卡生成步骤草案：{step}",
                    "stepOutput": f"按动作卡生成步骤草案：{step}",
                    "evidenceRefs": evidence_refs,
                    "validationNotes": ["未选择业务能力，当前为动作卡草案。"],
                    "nextConstraints": [],
                    "startedAt": timestamp,
                    "endedAt": timestamp,
                    "durationMs": 0,
                }
                for index, step in enumerate(action_steps, start=1)
            ],
            "execution_plan": {},
            "execution_mode": "action_card_fallback",
        }

    def _render_agent_summary(self, execution_results: list[dict[str, Any]]) -> str:
        blocks: list[str] = []
        for item in execution_results:
            output = item.get("structured_output") if isinstance(item.get("structured_output"), dict) else {}
            errors = item.get("validation_errors") or []
            lines = [
                f"## {item.get('title') or '业务能力运行'}",
                f"- 状态：{item.get('status')}",
            ]
            if item.get("status") == "needs_input":
                lines.append(f"- 缺少必要输入：{'、'.join(str(error.get('field')) for error in errors)}")
            if output:
                lines.extend(
                    [
                        f"- 产出物：{output.get('output_artifact') or '结构化业务建议'}",
                    ]
                )
                if output.get("diagnosis"):
                    lines.append(f"- 诊断结论：{output.get('diagnosis')}")
                recommended_changes = _as_str_list(output.get("recommended_changes"))
                if recommended_changes:
                    lines.extend(["", "建议动作：", *[f"- {step}" for step in recommended_changes]])
                lines.extend(
                    [
                        f"- 验证方式：{output.get('validation_plan') or '待补齐'}",
                        "",
                        "执行步骤：",
                        *[f"{index + 1}. {step}" for index, step in enumerate(_as_str_list(output.get("action_steps")))],
                    ]
                )
                review_notes = _as_str_list(output.get("review_notes"))
                if review_notes:
                    lines.extend(["", "待专家确认：", *[f"- {item}" for item in review_notes]])
            blocks.append("\n".join(lines).strip())
        return "\n\n".join(blocks)

    def _render_run_markdown(self, result: AgentRunResult) -> str:
        return self._render_business_run_markdown(result)

    def _render_business_run_markdown(self, result: AgentRunResult) -> str:
        output = result.structured_output if isinstance(result.structured_output, dict) else {}
        lines = [
            f"# 智能执行助手运行记录：{result.run_id}",
            "",
            f"- 状态：{result.status}",
            f"- 文档：{result.doc_id}",
            f"- 场景：{result.scene_id}",
            f"- 运行模式：{_RUN_MODE_LABELS.get(result.run_mode, result.run_mode)}",
            "",
            "## 运行结果",
            "",
            result.result_summary,
        ]
        if output:
            lines.extend(["", "## 结构化产物", ""])
            if output.get("output_artifact"):
                lines.append(f"- 产出物：{output.get('output_artifact')}")
            if output.get("diagnosis"):
                lines.append(f"- 诊断结论：{output.get('diagnosis')}")
            for title, key in [
                ("建议动作", "recommended_changes"),
                ("执行步骤", "action_steps"),
                ("待专家确认", "review_notes"),
            ]:
                values = _as_str_list(output.get(key))
                if values:
                    lines.extend(["", f"### {title}", ""])
                    lines.extend(f"- {item}" for item in values)
            if output.get("validation_plan"):
                lines.extend(["", "### 验证计划", "", str(output.get("validation_plan"))])
        if result.degradation_reason:
            reason = result.degradation_reason
            lines.extend(
                [
                    "",
                    "## 降级原因",
                    "",
                    f"- 原因：{reason.get('title', '已降级生成')}",
                    f"- 说明：{reason.get('detail', '')}",
                    f"- 建议：{reason.get('recommendedAction', '')}",
                ]
            )
        if result.execution_timeline:
            lines.extend(["", "## 执行过程", ""])
            for entry in result.execution_timeline:
                lines.append(
                    f"- {entry.get('title', entry.get('phase', '执行阶段'))}："
                    f"{entry.get('status', '')}，耗时 {entry.get('durationMs', 0)}ms。"
                    f"{entry.get('detail', '')}"
                )
        if result.step_executions:
            lines.extend(["", "## 步骤执行结果", ""])
            for step in result.step_executions:
                lines.extend(
                    [
                        f"### 第 {step.get('stepIndex', '?')} 步：{step.get('stepTitle', '未命名步骤')}",
                        "",
                        f"- 状态：{step.get('status', '')}",
                        f"- 任务类型：{step.get('taskType', '未标注')}",
                        f"- 耗时：{step.get('durationMs', 0)}ms",
                    ]
                )
                input_refs = _as_str_list(step.get("inputRefs"))
                if input_refs:
                    lines.append(f"- 使用输入：{'；'.join(input_refs)}")
                if step.get("stepOutput"):
                    lines.extend(["", str(step.get("stepOutput"))])
                evidence_refs = _as_str_list(step.get("evidenceRefs"))
                if evidence_refs:
                    lines.append(f"- 证据引用：{'；'.join(evidence_refs)}")
                validation_notes = _as_str_list(step.get("validationNotes"))
                if validation_notes:
                    lines.append(f"- 待确认：{'；'.join(validation_notes)}")
        if result.execution_plan:
            lines.extend(["", "## 执行计划", "", f"- 执行模式：{result.execution_mode or '未标注'}"])
            if result.execution_plan.get("summary"):
                lines.append(f"- 计划摘要：{result.execution_plan.get('summary')}")
            for task in result.execution_plan.get("stepTasks", []):
                if isinstance(task, dict):
                    lines.append(
                        f"- 第 {task.get('stepIndex', '?')} 步：{task.get('stepTitle', '')}"
                        f"（{task.get('taskType', '未标注')}）"
                    )
        lines.extend(["", "## 追踪", "", *[f"- {item}" for item in result.trace]])
        return "\n".join(lines).strip() + "\n"
