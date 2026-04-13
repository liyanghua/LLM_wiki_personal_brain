from __future__ import annotations

from personal_brain.models import MethodProfile, TemplatePlan


CORE_SECTIONS = ["fact", "synthesis", "interpretation", "recommendation"]


class TemplateSelector:
    def select(self, question_type: str, profile: MethodProfile) -> TemplatePlan:
        sections = [name for name in profile.preferred_answer_structure if name in CORE_SECTIONS]
        for name in CORE_SECTIONS:
            if name not in sections:
                sections.append(name)

        method_section = self._pick_method_section(question_type, profile)
        if method_section:
            sections.append(method_section)

        template_id = f"{profile.explanation_pattern}-{method_section or 'core-four-part'}"
        return TemplatePlan(
            template_id=template_id,
            sections=sections,
            method_section=method_section,
            explanation_pattern=profile.explanation_pattern,
        )

    def _pick_method_section(self, question_type: str, profile: MethodProfile) -> str | None:
        preferences = profile.reusable_asset_preferences
        if question_type == "comparison":
            if "mapping" in preferences:
                return "mapping"
            if "table" in preferences:
                return "table"
        if question_type == "project-status" and "roadmap" in preferences:
            return "roadmap"
        if question_type == "definition" and "schema" in preferences:
            return "schema"
        if question_type in {"definition", "open-ended-synthesis"} and "object_model" in preferences:
            return "object_model"
        if question_type in {"comparison", "open-ended-synthesis"} and "mapping" in preferences:
            return "mapping"
        return None
