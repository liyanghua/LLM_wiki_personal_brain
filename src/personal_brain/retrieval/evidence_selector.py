from __future__ import annotations

import re

from personal_brain.models import EvidenceItem, RankedPage
from personal_brain.utils.text import summarize_text


class EvidenceSelector:
    def select(self, ranked_pages: list[RankedPage], limit: int = 3) -> list[EvidenceItem]:
        selected: list[EvidenceItem] = []
        for ranked in ranked_pages[: max(limit, 5)]:
            if ranked.score <= 0:
                continue
            snippet = self._select_snippet(ranked)
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

    def _select_snippet(self, ranked: RankedPage) -> str:
        if ranked.page.page_type == "process":
            process_steps = self._extract_process_steps(ranked.body)
            if process_steps:
                return "；".join(process_steps[:4])
        if ranked.page.page_type in {"stage", "step"}:
            process_steps = self._extract_process_steps(ranked.body)
            if process_steps:
                return "；".join(process_steps[:3])
        return summarize_text(ranked.body, limit=1)

    def _extract_process_steps(self, body: str) -> list[str]:
        lines: list[str] = []
        for raw in body.splitlines():
            line = raw.strip()
            if re.match(r"^[0-9]+\.\s+", line):
                lines.append(re.sub(r"^[0-9]+\.\s+", "", line).strip())
        return lines
