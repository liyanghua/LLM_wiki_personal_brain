from __future__ import annotations

from personal_brain.models import EvidenceItem, MethodProfile, PersonalStyleProfile, TemplatePlan


class StyleEngine:
    """Render answers using method-oriented structure without changing evidence."""

    def render(
        self,
        question: str,
        sections: dict[str, list[str]],
        evidence: list[EvidenceItem],
        profile: MethodProfile | PersonalStyleProfile,
        template: TemplatePlan | None = None,
    ) -> str:
        ordered = list(template.sections) if template is not None else self._fallback_order(sections, profile)

        lines = [f"# Answer: {question}", ""]
        for section_name in ordered:
            if section_name not in sections:
                continue
            lines.append(f"## {self._section_label(section_name)}")
            for line in self._transform_lines(section_name, sections[section_name], profile):
                lines.append(f"- {line}" if not line.startswith("- ") and len(sections[section_name]) > 1 else line)
            lines.append("")

        if getattr(profile, "citation_preference", "high") != "none":
            lines.append("## Citations")
            for item in evidence[:3]:
                lines.append(f"- `{item.page_path}`")
                for source in item.source_refs[:3]:
                    lines.append(f"- `{source}`")
            lines.append("")
        return "\n".join(lines).strip() + "\n"

    def apply(self, content: str) -> str:
        return content

    def _fallback_order(
        self,
        sections: dict[str, list[str]],
        profile: MethodProfile | PersonalStyleProfile,
    ) -> list[str]:
        preferred = getattr(profile, "preferred_answer_structure", [])
        ordered = [name for name in preferred if name in sections]
        for name in sections:
            if name not in ordered:
                ordered.append(name)
        return ordered

    def _transform_lines(
        self,
        section_name: str,
        lines: list[str],
        profile: MethodProfile | PersonalStyleProfile,
    ) -> list[str]:
        transformed = list(lines)
        if section_name == "recommendation" and getattr(profile, "actionability_preference", "medium") == "high":
            transformed = [line if line.startswith("建议") else f"建议：{line}" for line in transformed]
        abstraction = getattr(profile, "abstraction_depth", getattr(profile, "abstraction_level", "balanced"))
        if abstraction == "high":
            transformed = [line.replace("当前", "从更高层看，当前") if "当前" in line else line for line in transformed]
        return transformed

    def _section_label(self, section_name: str) -> str:
        if section_name == "object_model":
            return "Object Model"
        return section_name.replace("_", " ").title()
