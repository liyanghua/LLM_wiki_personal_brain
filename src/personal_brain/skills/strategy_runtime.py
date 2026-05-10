from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from personal_brain.config import BrainConfig
from personal_brain.models import (
    AgentRunRequest,
    AgentRunResult,
    ApprovedSkillSpec,
    StrategySkillCandidateManifest,
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


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
        cards = bundle.get("strategyCards") or []
        manifests: list[StrategySkillCandidateManifest] = []
        for card in cards:
            if not isinstance(card, dict):
                continue
            if card.get("status") not in {"confirmed", "promoted_to_skill"}:
                continue
            family = str(card.get("cardType") or "generic").strip() or "generic"
            recommendation = str(card.get("recommendation") or "").strip()
            title = str(card.get("title") or family).strip() or family
            skill_id = _slugify(f"{scene_id}-{doc_id}-{family}")
            manifest = StrategySkillCandidateManifest(
                skill_id=skill_id,
                family=family,
                title=title,
                summary=recommendation or "来自已确认策略卡的业务技能候选。",
                scene_id=scene_id,
                linked_doc_ids=[doc_id],
                origin_strategy_card_ids=[str(card.get("cardId") or "")],
                wiki_refs=[ref for ref in bundle.get("linkedWikiRefs", []) if isinstance(ref, str)],
                source_refs=[ref for ref in card.get("evidenceRefs", []) if isinstance(ref, str)],
                validation_criteria=[
                    str(card.get("validationPlan") or "").strip() or "请结合当前业务指标验证输出建议。"
                ],
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
                    "## 使用边界",
                    "",
                    "- 仅基于已确认的业务策略卡与业务 Wiki 生成建议。",
                    "- 不能直接改写主知识层，结果应先作为建议或运行产物回看。",
                    "",
                    "## 验证标准",
                    "",
                    *[f"- {item}" for item in manifest.validation_criteria],
                    "",
                    f"- Family: `{manifest.family}`",
                    f"- Promotion State: `{manifest.promotion_state}`",
                    "",
                    "TODO(HUMAN_APPROVAL_WORKFLOW)",
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
            },
            "required": ["objective"],
        }
        output_schema = {
            "type": "object",
            "properties": {
                "recommendation": {"type": "string"},
                "why_now": {"type": "string"},
                "validation_plan": {"type": "string"},
                "evidence_refs": {"type": "array", "items": {"type": "string"}},
            },
        }
        (root / "input_schema.json").write_text(json.dumps(input_schema, ensure_ascii=False, indent=2), encoding="utf-8")
        (root / "output_schema.json").write_text(json.dumps(output_schema, ensure_ascii=False, indent=2), encoding="utf-8")
        (examples / "example_01.md").write_text(
            "\n".join(
                [
                    f"# {manifest.title}",
                    "",
                    f"- Recommendation: {str(card.get('recommendation') or '').strip()}",
                    f"- Why Now: {str(card.get('whyNow') or '').strip()}",
                    f"- Validation Plan: {str(card.get('validationPlan') or '').strip()}",
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
            title=metadata.title,
            scene_id=metadata.scene_id,
            tier=tier,
            family=metadata.family,
            path=str(target),
            wiki_refs=metadata.wiki_refs,
            source_refs=metadata.source_refs,
            input_schema=_read_json(target / "input_schema.json", {}),
            output_schema=_read_json(target / "output_schema.json", {}),
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
                )
            )
        return items

    def run_agent(self, request: AgentRunRequest) -> AgentRunResult:
        approved = {item.skill_id: item for item in self.list_approved_skills()}
        selected = [approved[skill_id] for skill_id in request.selected_skill_ids if skill_id in approved]
        if request.selected_skill_ids and not selected:
            raise ValueError("当前没有可运行的已批准技能。请先提升至少一个 approved skill。")
        bundle = self._load_strategy_bundle(request.doc_id)
        summary_lines = [
            f"运行模式：{request.run_mode}",
            f"文档：{request.doc_id}",
            f"场景：{request.scene_id}",
            f"已选技能：{', '.join(item.title for item in selected) if selected else '未指定，按当前策略卡总结'}",
        ]
        strategy_cards = bundle.get("strategyCards") or []
        traces = [
            "已读取策略包",
            f"策略卡数量：{len(strategy_cards)}",
            f"已批准技能数量：{len(selected)}",
            f"grounding sources：{len(request.grounding_sources)}",
        ]
        if request.run_mode == "diagnose_document":
            conclusion = "基于当前策略卡，优先检查人群-卖点-素材-指标链路是否闭环。"
        elif request.run_mode == "generate_strategy":
            conclusion = "基于已确认策略卡生成下一轮策略建议，优先落到动作与实验验证。"
        elif request.run_mode == "generate_asset_brief":
            conclusion = "基于当前卖点与素材策略，生成一版素材 brief，供创意执行参考。"
        else:
            conclusion = "基于当前动作策略与验证标准，复核这轮方案是否具备可验证性。"
        artifacts_dir = self.paths.skill_runs_dir
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        run_id = f"agent-run-{request.doc_id}-{int(datetime.now(timezone.utc).timestamp())}"
        artifact_path = artifacts_dir / f"{run_id}.json"
        result = AgentRunResult(
            run_id=run_id,
            project_path=request.project_path,
            doc_id=request.doc_id,
            scene_id=request.scene_id,
            run_mode=request.run_mode,
            selected_skill_ids=request.selected_skill_ids,
            grounding_sources=request.grounding_sources,
            result_summary="\n".join(summary_lines + ["", conclusion]),
            trace=traces,
            output_artifacts=[str(artifact_path)],
            created_at=_utc_now(),
        )
        artifact_path.write_text(json.dumps(result.model_dump(mode="json"), ensure_ascii=False, indent=2), encoding="utf-8")
        return result
