from __future__ import annotations

from typing import Protocol

from personal_brain.models import EvidenceItem


class AnswerRewriteProvider(Protocol):
    """Optional provider hook for future model-assisted answer shaping."""

    def rewrite_sections(
        self,
        question: str,
        question_type: str,
        sections: dict[str, list[str]],
        evidence: list[EvidenceItem],
    ) -> dict[str, list[str]]: ...
