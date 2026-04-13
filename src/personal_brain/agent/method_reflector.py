from __future__ import annotations

from personal_brain.models import MethodProfile, MethodSuggestion, TemplatePlan


class MethodReflector:
    def suggest(
        self,
        profile: MethodProfile,
        question: str,
        template: TemplatePlan,
        sections: dict[str, list[str]],
    ) -> list[MethodSuggestion]:
        suggestions: list[MethodSuggestion] = []
        if ("怎么" in question or question.startswith("如何")) and profile.operationalization_level != "high":
            suggestions.append(
                MethodSuggestion(
                    field_name="operationalization_level",
                    current_value=profile.operationalization_level,
                    suggested_value="high",
                    rationale="近期问题更偏行动化，建议提高方法层的可执行粒度。",
                )
            )
        if template.method_section is None and "mapping" in profile.reusable_asset_preferences:
            suggestions.append(
                MethodSuggestion(
                    field_name="reusable_asset_preferences",
                    current_value=profile.reusable_asset_preferences,
                    suggested_value=["mapping", *profile.reusable_asset_preferences],
                    rationale="该问题适合沉淀映射式资产，可考虑提高 mapping 偏好。",
                )
            )
        if len(sections.get("fact", [])) > 1 and profile.citation_preference != "high":
            suggestions.append(
                MethodSuggestion(
                    field_name="citation_preference",
                    current_value=profile.citation_preference,
                    suggested_value="high",
                    rationale="当前答案依赖多条证据，建议保持高引用密度。",
                )
            )
        return suggestions
