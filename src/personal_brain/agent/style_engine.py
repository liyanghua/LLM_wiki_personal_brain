from __future__ import annotations

from personal_brain.models import EvidenceItem, PersonalStyleProfile


class StyleEngine:
    """Apply presentation preferences without changing the evidence payload."""

    def render(
        self,
        question: str,
        sections: dict[str, list[str]],
        evidence: list[EvidenceItem],
        profile: PersonalStyleProfile,
    ) -> str:
        ordered = [name for name in profile.preferred_answer_structure if name in sections]
        for name in sections:
            if name not in ordered:
                ordered.append(name)

        lines = [f"# Answer: {question}", ""]
        for section_name in ordered:
            heading = section_name.capitalize()
            lines.append(f"## {heading}")
            for line in self._transform_lines(section_name, sections[section_name], profile):
                lines.append(f"- {line}" if not line.startswith("- ") and len(sections[section_name]) > 1 else line)
            lines.append("")

        if profile.citation_preference != "none":
            lines.append("## Citations")
            for item in evidence[:3]:
                lines.append(f"- `{item.page_path}`")
                for source in item.source_refs[:3]:
                    lines.append(f"- `{source}`")
            lines.append("")
        return "\n".join(lines).strip() + "\n"

    def apply(self, content: str) -> str:
        return content

    def _transform_lines(
        self,
        section_name: str,
        lines: list[str],
        profile: PersonalStyleProfile,
    ) -> list[str]:
        transformed = list(lines)
        if section_name == "recommendation" and profile.actionability_preference == "high":
            transformed = [line if line.startswith("建议") else f"建议：{line}" for line in transformed]
        if profile.abstraction_level == "high":
            transformed = [line.replace("当前", "从更高层看，当前") if "当前" in line else line for line in transformed]
        return transformed
