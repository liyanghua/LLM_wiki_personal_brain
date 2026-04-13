from __future__ import annotations

from personal_brain.models import PersonalStyleProfile


class StyleReflector:
    def suggest(
        self,
        profile: PersonalStyleProfile,
        question: str,
        sections: dict[str, list[str]],
    ) -> list[str]:
        suggestions: list[str] = []
        if "怎么" in question or question.startswith("如何"):
            if profile.actionability_preference != "high":
                suggestions.append("用户最近更偏向可执行建议，可考虑把 actionability_preference 调高一级。")
        if len(sections.get("fact", [])) > 1 and profile.citation_preference != "high":
            suggestions.append("当前问题依赖多条证据，建议维持较高 citation preference。")
        if not suggestions:
            suggestions.append("当前风格配置与答案结构基本一致，无需自动更新。")
        return suggestions
