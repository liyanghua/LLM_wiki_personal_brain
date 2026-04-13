from __future__ import annotations

from pathlib import Path

from personal_brain.config import BrainConfig
from personal_brain.models import MemoryRecallBundle, SessionRecord
from personal_brain.utils.files import read_json
from personal_brain.utils.text import overlap_score


class MemoryRecall:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.paths = config.paths

    def recall(self, query: str, limit: int = 3) -> MemoryRecallBundle:
        session_records = self._load_session_records()
        scored = []
        for record in session_records:
            score = overlap_score(query, f"{record.user_query} {record.answer_summary}")
            scored.append((score, record))
        scored.sort(key=lambda item: item[0], reverse=True)

        recent_summaries = [record.answer_summary for score, record in scored[:limit] if score > 0]
        if not recent_summaries:
            recent_summaries = [record.answer_summary for _, record in scored[:1]]

        interests = read_json(self.paths.persistent_interests, default=[])
        principles = read_json(self.paths.persistent_principles, default=[])
        open_loops_raw = read_json(self.paths.persistent_open_loops, default=[])
        open_loops = [
            loop["question"] if isinstance(loop, dict) and "question" in loop else str(loop)
            for loop in open_loops_raw
        ]

        return MemoryRecallBundle(
            recent_session_summaries=recent_summaries,
            persistent_interests=interests,
            persistent_principles=principles,
            open_loops=open_loops,
        )

    def search(self, query: str) -> dict:
        bundle = self.recall(query)
        return {
            "recent_session_summaries": bundle.recent_session_summaries,
            "persistent_interests": [item for item in bundle.persistent_interests if item in query or query in item],
            "persistent_principles": [item for item in bundle.persistent_principles if item in query or query in item],
            "open_loops": [item for item in bundle.open_loops if item in query or query in item],
        }

    def _load_session_records(self) -> list[SessionRecord]:
        records: list[SessionRecord] = []
        session_root = self.paths.memory / "session"
        for path in sorted(session_root.glob("20??-??-??/*.json")):
            try:
                records.append(SessionRecord.model_validate_json(path.read_text(encoding="utf-8")))
            except Exception:
                continue
        return records
