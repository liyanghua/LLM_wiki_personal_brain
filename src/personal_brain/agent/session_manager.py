from __future__ import annotations

import json

from personal_brain.config import BrainConfig
from personal_brain.models import SessionRecord


class SessionManager:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.paths = config.paths

    def write(self, record: SessionRecord) -> str:
        path = self.paths.session_record_path(record.session_date, record.query_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record.model_dump(mode="json"), ensure_ascii=False, indent=2), encoding="utf-8")
        self._append_daily_summary(record)
        return str(path.relative_to(self.config.root))

    def _append_daily_summary(self, record: SessionRecord) -> None:
        summary_path = self.paths.session_summary_path(record.session_date)
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        header = f"# Session Summary {record.session_date}\n\n"
        previous = summary_path.read_text(encoding="utf-8") if summary_path.exists() else header
        entry = [
            f"## {record.query_id}",
            f"- Query: {record.user_query}",
            f"- Type: {record.question_classification.question_type}",
            f"- Summary: {record.answer_summary}",
            f"- Pages: {', '.join(record.ranked_pages[:3])}",
        ]
        if record.open_follow_ups:
            entry.append(f"- Follow-ups: {' | '.join(record.open_follow_ups[:2])}")
        summary_path.write_text(previous + "\n".join(entry) + "\n\n", encoding="utf-8")
