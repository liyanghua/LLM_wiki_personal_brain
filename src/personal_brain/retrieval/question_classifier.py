from __future__ import annotations

from personal_brain.models import QuestionClassification


class QuestionClassifier:
    def classify(self, question: str) -> QuestionClassification:
        normalized = question.strip()
        lowered = normalized.lower()
        cues: list[str] = []

        if normalized.startswith("什么是") or lowered.startswith("what is"):
            cues.append("definition-prefix")
            return QuestionClassification(question_type="definition", confidence=0.95, cues=cues)
        if "比较" in normalized or "区别" in normalized or "vs" in lowered:
            cues.append("comparison-keyword")
            return QuestionClassification(question_type="comparison", confidence=0.9, cues=cues)
        if "项目" in normalized or "进展" in normalized or "目前" in normalized or "聚焦" in normalized:
            cues.append("project-status-keyword")
            return QuestionClassification(question_type="project-status", confidence=0.82, cues=cues)
        if normalized.startswith("如何") or "怎么" in normalized or lowered.startswith("how"):
            cues.append("procedural-keyword")
            return QuestionClassification(question_type="procedural", confidence=0.88, cues=cues)

        cues.append("fallback-synthesis")
        return QuestionClassification(question_type="open-ended-synthesis", confidence=0.6, cues=cues)
