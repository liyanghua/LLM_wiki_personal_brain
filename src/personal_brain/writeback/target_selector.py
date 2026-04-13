from __future__ import annotations

from typing import TYPE_CHECKING

from personal_brain.models import WritebackTargetDecision
from personal_brain.utils.text import slugify_title

if TYPE_CHECKING:
    from .router import WritebackContext


class WritebackTargetSelector:
    def select(self, context: WritebackContext) -> list[WritebackTargetDecision]:
        targets: list[WritebackTargetDecision] = []
        base_score = context.asset_value_score
        preview = context.answer_summary.strip()

        for page in context.retrieved_pages:
            if "/topics/" in page:
                targets.append(
                    WritebackTargetDecision(
                        target=page,
                        action="merge-update",
                        rationale="答案涉及已有 topic 页，适合追加可复用综合结论。",
                        confidence=min(0.95, base_score + 0.2),
                        long_term_value="把高频问答沉淀回主题页，降低未来重复解释成本。",
                        evidence_refs=context.evidence_refs,
                        content_preview=preview,
                    )
                )
            if "/principles/" in page:
                targets.append(
                    WritebackTargetDecision(
                        target=page,
                        action="merge-update",
                        rationale="答案与现有 principle 页直接相关，适合沉淀长期适用的解释。",
                        confidence=min(0.95, base_score + 0.15),
                        long_term_value="将临时回答升格为可复用原则，提升长期检索价值。",
                        evidence_refs=context.evidence_refs,
                        content_preview=preview,
                    )
                )

        if context.question_type in {"comparison", "open-ended-synthesis", "project-status"} and base_score >= 0.45:
            targets.append(
                WritebackTargetDecision(
                    target=f"wiki/decisions/{slugify_title(context.question)}-qa-note.md",
                    action="create-or-merge",
                    rationale="当前问题跨页综合度较高，适合形成 decision/QA note。",
                    confidence=min(0.95, base_score + 0.1),
                    long_term_value="把多页综合关系沉淀为决策笔记，便于后续追踪和复用。",
                    evidence_refs=context.evidence_refs,
                    content_preview=preview,
                )
            )

        if "原则" in preview and not any(target.target.startswith("wiki/principles/") for target in targets):
            targets.append(
                WritebackTargetDecision(
                    target=f"wiki/principles/{slugify_title(context.question)}.md",
                    action="create-or-merge",
                    rationale="答案显式形成原则性判断，但当前没有对应 principle 页。",
                    confidence=min(0.9, base_score + 0.05),
                    long_term_value="把原则化结论抽离为稳定资产，减少未来重复总结。",
                    evidence_refs=context.evidence_refs,
                    content_preview=preview,
                )
            )

        if base_score >= 0.5:
            targets.append(
                WritebackTargetDecision(
                    target=f"ontology/candidates/concept/{slugify_title(context.question)}.json",
                    action="candidate-only",
                    rationale="该回答可作为后续 ontology candidate 的输入，但仍需从 wiki 统一抽取。",
                    confidence=min(0.85, base_score),
                    long_term_value="为后续稳定概念抽取提供候选入口。",
                    evidence_refs=context.evidence_refs,
                    content_preview=preview,
                )
            )

        if base_score >= 0.65:
            targets.append(
                WritebackTargetDecision(
                    target=f"skills/candidates/{self._skill_family(context.question_type)}",
                    action="candidate-only",
                    rationale="该回答模式具有技能化潜力，但需要多轮样本后再打包。",
                    confidence=min(0.85, base_score),
                    long_term_value="把高价值工作模式转化为候选技能模板。",
                    evidence_refs=context.evidence_refs,
                    content_preview=preview,
                )
            )

        return self._dedupe(targets)

    def _skill_family(self, question_type: str) -> str:
        return {
            "comparison": "concept_comparison_table",
            "definition": "principle_distillation",
            "project-status": "project_context_refresh",
        }.get(question_type, "topic_synthesis")

    def _dedupe(self, targets: list[WritebackTargetDecision]) -> list[WritebackTargetDecision]:
        deduped: dict[str, WritebackTargetDecision] = {}
        for target in targets:
            current = deduped.get(target.target)
            if current is None or target.confidence > current.confidence:
                deduped[target.target] = target
        return list(deduped.values())
