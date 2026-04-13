from __future__ import annotations

from personal_brain.models import AnswerPlan, AnswerSection, EvidenceItem, MemoryRecallBundle


SECTION_GUIDANCE = {
    "fact": "State the directly supported takeaways from selected evidence.",
    "synthesis": "Connect evidence across multiple pages into a grounded synthesis.",
    "interpretation": "Offer cautious interpretation that stays separate from facts.",
    "recommendation": "Provide next steps or reuse guidance without overstating certainty.",
}


class AnswerPlanner:
    def plan(
        self,
        question: str,
        question_type: str,
        evidence: list[EvidenceItem],
        recalled_memory: MemoryRecallBundle | None,
    ) -> AnswerPlan:
        sections = [
            AnswerSection(name="fact", guidance=SECTION_GUIDANCE["fact"]),
            AnswerSection(name="synthesis", guidance=SECTION_GUIDANCE["synthesis"]),
            AnswerSection(name="interpretation", guidance=SECTION_GUIDANCE["interpretation"]),
            AnswerSection(name="recommendation", guidance=SECTION_GUIDANCE["recommendation"]),
        ]
        follow_ups: list[str] = []
        if question_type == "definition":
            follow_ups.append("是否需要把这个定义沉淀为更稳定的 principle 或 topic update？")
        elif question_type == "comparison":
            follow_ups.append("是否需要把这组对比整理成可复用的 decision 页面？")
        elif question_type == "project-status":
            follow_ups.append("目前还缺少哪些证据来判断项目下一步？")
        else:
            follow_ups.append("这个回答里哪些结论值得继续追问或写回 wiki？")

        if recalled_memory and recalled_memory.open_loops:
            follow_ups.extend(recalled_memory.open_loops[:2])

        notes = [f"question_type={question_type}", f"evidence_count={len(evidence)}"]
        return AnswerPlan(
            question=question,
            question_type=question_type,
            sections=sections,
            open_follow_ups=follow_ups,
            planning_notes=notes,
        )
