from __future__ import annotations

from datetime import UTC, datetime

from personal_brain.models import PageCandidate, RankedPage
from personal_brain.utils.text import keyword_tokens, overlap_score


PAGE_TYPE_BONUS = {
    "topic": 2.5,
    "principle": 2.0,
    "project": 1.5,
    "decision": 1.0,
    "source": 0.5,
}


class PageRanker:
    def rank(self, question: str, candidates: list[PageCandidate], question_type: str | None = None) -> list[RankedPage]:
        ranked: list[RankedPage] = []
        for candidate in candidates:
            page = candidate.page
            title_score = overlap_score(question, page.title) * 3
            summary_score = overlap_score(question, page.summary) * 2
            body_score = overlap_score(question, candidate.body)
            link_score = min(len(page.links_to), 4) * 0.35
            page_type_bonus = PAGE_TYPE_BONUS.get(page.page_type, 0)
            recency_bonus = self._recency_bonus(page.updated_at)
            intent_bonus = self._intent_bonus(page.page_type, question_type)
            title_keyword_bonus = self._title_keyword_bonus(question, page.title)
            source_specific_bonus = 1.5 if page.page_type == "source" and title_score >= 3 else 0.0
            score = float(
                title_score
                + summary_score
                + body_score
                + link_score
                + page_type_bonus
                + recency_bonus
                + intent_bonus
                + title_keyword_bonus
                + source_specific_bonus
            )

            reasons = []
            if title_score:
                reasons.append(f"title:{title_score}")
            if summary_score:
                reasons.append(f"summary:{summary_score}")
            if body_score:
                reasons.append(f"body:{body_score}")
            if title_keyword_bonus:
                reasons.append(f"title-keyword:{title_keyword_bonus:.2f}")
            if link_score:
                reasons.append(f"links:{link_score:.2f}")
            if page_type_bonus:
                reasons.append(f"type:{page_type_bonus:.2f}")
            if intent_bonus:
                reasons.append(f"intent:{intent_bonus:.2f}")
            if source_specific_bonus:
                reasons.append(f"source-title:{source_specific_bonus:.2f}")

            ranked.append(RankedPage(page=page, body=candidate.body, score=score, reasons=reasons))

        ranked.sort(key=lambda item: item.score, reverse=True)
        return ranked

    def _recency_bonus(self, updated_at: str) -> float:
        try:
            value = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
        except ValueError:
            return 0.0
        age_days = max((datetime.now(UTC) - value).days, 0)
        return max(0.0, 1.5 - min(age_days / 30, 1.5))

    def _intent_bonus(self, page_type: str, question_type: str | None) -> float:
        if question_type == "project-status" and page_type == "project":
            return 2.0
        if question_type == "definition" and page_type in {"topic", "principle"}:
            return 1.25
        if question_type == "comparison" and page_type in {"topic", "principle", "source"}:
            return 1.0
        if question_type == "procedural" and page_type in {"principle", "project"}:
            return 1.2
        return 0.0

    def _title_keyword_bonus(self, question: str, title: str) -> float:
        lowered_title = title.lower()
        bonus = 0.0
        for token in keyword_tokens(question):
            if len(token) >= 2 and token.lower() in lowered_title:
                bonus += 0.6
        return min(bonus, 2.4)
