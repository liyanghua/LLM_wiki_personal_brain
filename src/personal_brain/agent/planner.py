from __future__ import annotations

from personal_brain.models import QuestionClassification


class BrainPlanner:
    """TODO(HERMES_PHASE_2_RUNTIME): Connect tool planning to a real Hermes runtime executor."""

    def plan(self, classification: QuestionClassification) -> list[str]:
        if classification.question_type == "definition":
            return ["search_wiki", "read_page"]
        if classification.question_type == "comparison":
            return ["search_wiki", "read_page", "search_memory"]
        if classification.question_type == "project-status":
            return ["search_wiki", "read_page", "search_memory", "propose_writeback"]
        return ["search_wiki", "read_page", "search_memory"]
