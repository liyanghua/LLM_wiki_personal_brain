from __future__ import annotations

import re

from personal_brain.models import AnswerPlan, EvidenceItem, MemoryRecallBundle, TemplatePlan
from personal_brain.retrieval.provider import AnswerRewriteProvider


class AnswerComposer:
    def compose(
        self,
        plan: AnswerPlan,
        evidence: list[EvidenceItem],
        recalled_memory: MemoryRecallBundle,
        provider: AnswerRewriteProvider | None = None,
        template: TemplatePlan | None = None,
    ) -> tuple[dict[str, list[str]], str]:
        sections = {
            "direct_answer": self._compose_direct_answer(plan.question, evidence),
            "fact": self._compose_fact(evidence),
            "synthesis": self._compose_synthesis(plan.question, plan.question_type, evidence, recalled_memory),
            "interpretation": self._compose_interpretation(plan.question_type, evidence),
            "recommendation": self._compose_recommendation(plan, evidence),
        }
        if template is not None and template.method_section is not None:
            sections[template.method_section] = self._compose_method_section(template.method_section, evidence, sections)
        if provider is not None:
            sections = provider.rewrite_sections(plan.question, plan.question_type, sections, evidence)
        answer_summary = (
            "；".join(sections["direct_answer"][:1] or sections["synthesis"][:1] or sections["fact"][:1])
            or "No answer summary available."
        )
        return sections, answer_summary

    def _compose_direct_answer(self, question: str, evidence: list[EvidenceItem]) -> list[str]:
        out_of_scope = self._compose_sop_scope_guard(question, evidence)
        if out_of_scope is not None:
            return [out_of_scope]
        if self._looks_like_process_question(question):
            process_answer = self._compose_process_answer(question, evidence)
            if process_answer:
                first_step = next(
                    (
                        match.group(1).strip()
                        for line in process_answer
                        if (match := re.match(r"^\d+\.\s+(.+)$", line))
                    ),
                    "",
                )
                if first_step:
                    return [f"主干链路先看{first_step}。"]
        priority_line = self._compose_priority_answer(question, evidence)
        if priority_line is not None:
            return [priority_line]

        process_answer = self._compose_process_answer(question, evidence)
        if process_answer:
            return process_answer

        if evidence:
            return [f"当前最直接的依据来自 {evidence[0].page_title}：{evidence[0].snippet}"]
        return ["当前证据不足，暂时不能给出稳定直接答案。"]

    def _compose_fact(self, evidence: list[EvidenceItem]) -> list[str]:
        if not evidence:
            return ["当前 wiki 中没有足够证据支撑明确结论。"]
        return [f"{item.page_title}：{item.snippet}" for item in evidence[:2]]

    def _compose_synthesis(
        self,
        question: str,
        question_type: str,
        evidence: list[EvidenceItem],
        recalled_memory: MemoryRecallBundle,
    ) -> list[str]:
        out_of_scope = self._compose_sop_scope_guard(question, evidence)
        if out_of_scope is not None:
            return [out_of_scope]
        process_answer = self._compose_process_answer(question, evidence)
        if process_answer:
            return process_answer
        priority_line = self._compose_priority_answer(question, evidence)
        if priority_line is not None:
            return [priority_line]
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

    def _compose_priority_answer(self, question: str, evidence: list[EvidenceItem]) -> str | None:
        if not self._looks_like_priority_question(question):
            return None
        direct = next(
            (
                item.snippet
                for item in evidence
                if item.page_path.startswith(("raw/", "raw_new/"))
                and item.snippet
                and ("维度" in item.snippet or re.search(r"[第首优先].{0,4}", item.snippet))
            ),
            None,
        )
        if direct is None:
            return None
        return f"如果只回答先看哪个，当前证据首先指向“{direct}”。"

    def _looks_like_priority_question(self, question: str) -> bool:
        normalized = question.strip()
        return any(token in normalized for token in ["首先", "先看哪个", "优先", "第一步", "哪个维度"])

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
        if self._compose_sop_scope_guard(plan.question, evidence) is not None:
            recommendations.append("当前 session 只锚定主干链路SOP；如需回答这个问题，需要显式扩展到 SOP 外上下文。")
            return recommendations
        if self._looks_like_process_question(plan.question):
            recommendations.append("先围绕当前 stage/step 补齐关键判断，再追问边界、反例和证据。")
        if len(evidence) >= 2:
            recommendations.append("如果这个问题会反复出现，优先考虑把综合结论沉淀到 principle 或 decision 页面。")
        else:
            recommendations.append("先补足更多交叉证据，再决定是否写回 durable wiki 页面。")
        if plan.open_follow_ups:
            recommendations.append(f"下一步可继续追问：{plan.open_follow_ups[0]}")
        return recommendations

    def _compose_method_section(
        self,
        section_name: str,
        evidence: list[EvidenceItem],
        sections: dict[str, list[str]],
    ) -> list[str]:
        titles = [item.page_title for item in evidence[:3]]
        if section_name == "mapping":
            if len(titles) >= 2:
                return [f"{titles[0]} -> {titles[1]} -> 可复用沉淀路径"]
            return ["当前证据不足以形成稳定映射，但可先保留问题与页面之间的对应关系。"]
        if section_name == "roadmap":
            return ["先确认现有证据，再补关键缺口，最后判断是否适合沉淀为长期资产。"]
        if section_name == "schema":
            return ["核心结构：定义对象 -> 证据页 -> 适用范围 -> 可沉淀资产。"]
        if section_name == "table":
            return ["可进一步把相关页面整理成对比表，用于后续复用。"]
        if section_name == "object_model":
            return ["建议把当前回答抽象成对象、关系和证据三层结构。"]
        return sections["synthesis"][:1]

    def _compose_process_answer(self, question: str, evidence: list[EvidenceItem]) -> list[str]:
        if not self._looks_like_process_question(question):
            return []

        step_lines: list[str] = []
        supporting_refs: list[str] = []
        for item in evidence:
            extracted = self._extract_steps_from_snippet(item.snippet)
            if extracted:
                step_lines.extend(extracted)
                supporting_refs.extend(item.source_refs or [item.page_path])

        deduped_steps: list[str] = []
        seen: set[str] = set()
        for step in step_lines:
            if step in seen:
                continue
            deduped_steps.append(step)
            seen.add(step)

        if not deduped_steps:
            return []

        lines = ["主链路步骤"]
        lines.extend([f"{index}. {step}" for index, step in enumerate(deduped_steps[:6], start=1)])
        if supporting_refs:
            lines.append(f"支撑证据：{' | '.join(dict.fromkeys(supporting_refs))}")
        return lines

    def _compose_sop_scope_guard(self, question: str, evidence: list[EvidenceItem]) -> str | None:
        if "主干链路" in question or "SOP" in question:
            return None
        if any(token in question for token in ["6大维度", "维度1", "维度2"]):
            if not any("主干链路SOP" in ref for item in evidence for ref in item.source_refs):
                return "这个问题超出当前主干链路SOP锚定范围；当前 session 不会把 SOP 外文档结论伪装成主干链路答案。"
        return None

    def _extract_steps_from_snippet(self, snippet: str) -> list[str]:
        cleaned = snippet.replace("；", "\n")
        steps: list[str] = []
        for raw in cleaned.splitlines():
            line = raw.strip(" -")
            if not line:
                continue
            if re.match(r"^[0-9]+\.\s*", line):
                line = re.sub(r"^[0-9]+\.\s*", "", line)
            if len(line) >= 4:
                steps.append(line.strip())
        return steps

    def _looks_like_process_question(self, question: str) -> bool:
        normalized = question.strip()
        return any(token in normalized for token in ["主干链路", "阶段", "步骤", "第一环节", "产品塑造", "爆款打造", "复盘"])
