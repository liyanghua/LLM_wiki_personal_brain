from __future__ import annotations

from personal_brain.models import EvidenceItem, RankedPage
from personal_brain.utils.text import summarize_text


class EvidenceSelector:
    def select(self, ranked_pages: list[RankedPage], limit: int = 3) -> list[EvidenceItem]:
        selected: list[EvidenceItem] = []
        for ranked in ranked_pages[: max(limit, 5)]:
            if ranked.score <= 0:
                continue
            snippet = summarize_text(ranked.body, limit=1)
            selected.append(
                EvidenceItem(
                    page_id=ranked.page.page_id,
                    page_title=ranked.page.title,
                    page_path=ranked.page.path,
                    source_refs=ranked.page.source_refs,
                    snippet=snippet,
                    relevance_score=ranked.score,
                )
            )
            if len(selected) >= limit:
                break
        return selected
