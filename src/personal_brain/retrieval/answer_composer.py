from __future__ import annotations

from personal_brain.models import AnswerPlan, EvidenceItem, MemoryRecallBundle
from personal_brain.retrieval.provider import AnswerRewriteProvider


class AnswerComposer:
    def compose(
        self,
        plan: AnswerPlan,
        evidence: list[EvidenceItem],
        recalled_memory: MemoryRecallBundle,
        provider: AnswerRewriteProvider | None = None,
    ) -> tuple[dict[str, list[str]], str]:
        sections = {
            "fact": self._compose_fact(evidence),
            "synthesis": self._compose_synthesis(plan.question_type, evidence, recalled_memory),
            "interpretation": self._compose_interpretation(plan.question_type, evidence),
            "recommendation": self._compose_recommendation(plan, evidence),
        }
        if provider is not None:
            sections = provider.rewrite_sections(plan.question, plan.question_type, sections, evidence)
        answer_summary = "；".join(sections["synthesis"][:1] or sections["fact"][:1]) or "No answer summary available."
        return sections, answer_summary

    def _compose_fact(self, evidence: list[EvidenceItem]) -> list[str]:
        if not evidence:
            return ["当前 wiki 中没有足够证据支撑明确结论。"]
        return [f"{item.page_title}：{item.snippet}" for item in evidence[:2]]

    def _compose_synthesis(
        self,
        question_type: str,
        evidence: list[EvidenceItem],
        recalled_memory: MemoryRecallBundle,
    ) -> list[str]:
        if len(evidence) >= 2:
            titles = "、".join(item.page_title for item in evidence[:3])
            line = f"综合 {titles} 的信息，可以看到这些页面共同指向同一条知识链路，而不是孤立结论。"
        elif evidence:
            line = f"当前主要证据集中在 {evidence[0].page_title}，但它仍能和现有 wiki 结构形成初步综合。"
        else:
            line = "当前尚未形成可依赖的多页综合。"
        if recalled_memory.recent_session_summaries:
            line += " 这也延续了近期会话里重复出现的关注主题。"
        if question_type == "comparison":
            line += " 回答重点应放在相互关系和差异，而不是分别摘录。"
        return [line]

    def _compose_interpretation(self, question_type: str, evidence: list[EvidenceItem]) -> list[str]:
        if not evidence:
            return ["这部分仅能保持开放判断，暂不做强解释。"]
        if question_type == "definition":
            return ["从当前证据看，这更像一个可持续复用的知识框架，而不是一次性的术语解释。"]
        if question_type == "comparison":
            return ["从结构上看，这些页面之间是互补关系，前者提供框架，后者提供诊断抓手。"]
        if question_type == "project-status":
            return ["当前材料更能说明项目关注点，而不是完整执行状态。"]
        return ["这些证据更支持形成谨慎综合，而不是直接推出强结论。"]

    def _compose_recommendation(self, plan: AnswerPlan, evidence: list[EvidenceItem]) -> list[str]:
        recommendations = []
        if len(evidence) >= 2:
            recommendations.append("如果这个问题会反复出现，优先考虑把综合结论沉淀到 principle 或 decision 页面。")
        else:
            recommendations.append("先补足更多交叉证据，再决定是否写回 durable wiki 页面。")
        if plan.open_follow_ups:
            recommendations.append(f"下一步可继续追问：{plan.open_follow_ups[0]}")
        return recommendations
