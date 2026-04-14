from __future__ import annotations

from personal_brain.models import CompiledProblem, QuestionPlan


SLOT_QUESTION_TEMPLATES = {
    "definition": "{object_name} 的定义应该怎么表述才最稳定？",
    "scope": "{object_name} 的适用范围和边界是什么？",
    "purpose": "{object_name} 解决的核心目标是什么？",
    "evidence": "哪些证据最能支撑你对 {object_name} 的判断？",
    "object_a": "比较中的第一个对象具体指什么？",
    "object_b": "比较中的第二个对象具体指什么？",
    "comparison_axes": "你最关心用哪些维度来比较 {object_name}？",
    "relationship": "{object_name} 和相关对象之间的关系更像互补、包含还是替代？",
    "implications": "如果这个判断成立，后续意味着什么？",
    "project": "当前在说的是哪个项目或对象？",
    "current_state": "它现在处于什么阶段？",
    "blockers": "目前最大的阻塞是什么？",
    "next_step": "你希望下一步推进什么动作？",
    "goal": "你想通过 {object_name} 达到什么目标？",
    "constraints": "{object_name} 现在有哪些关键约束？",
    "steps": "如果要落地 {object_name}，核心步骤有哪些？",
    "examples": "有没有一个最能说明 {object_name} 的例子？",
    "success_criteria": "什么结果能说明 {object_name} 已经成功？",
    "object": "这里最核心的对象到底是什么？",
    "knowledge_goal": "这轮采掘最想补齐的知识目标是什么？",
    "key_claims": "你现在最想确认的关键结论是什么？",
    "supporting_evidence": "这些结论目前有哪些支撑证据？",
    "open_questions": "还有哪些开放问题必须补齐？",
}


class QuestionPlanBuilder:
    def build(self, problem: CompiledProblem) -> QuestionPlan:
        target_missing_slots = problem.missing_slots[:2]
        candidate_questions = [
            self._question_for_slot(slot, problem.current_object, problem.current_knowledge_goal)
            for slot in target_missing_slots
        ]
        if not candidate_questions and problem.current_knowledge_goal:
            candidate_questions = [f"针对“{problem.current_knowledge_goal}”，还有哪一点最值得继续追问？"]
        return QuestionPlan(
            next_question_type="slot-fill" if target_missing_slots else "stop",
            candidate_questions=candidate_questions,
            target_missing_slots=target_missing_slots,
            stop_if=[
                "all target missing slots are filled",
                "the user says the interview has enough context",
            ],
        )

    def _question_for_slot(self, slot_name: str, object_name: str, knowledge_goal: str) -> str:
        template = SLOT_QUESTION_TEMPLATES.get(slot_name)
        if template is None:
            return f"关于 {object_name or knowledge_goal}，你能补充一下 {slot_name} 吗？"
        return template.format(object_name=object_name or knowledge_goal)
