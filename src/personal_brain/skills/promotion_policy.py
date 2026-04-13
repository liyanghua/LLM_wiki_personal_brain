from __future__ import annotations

from personal_brain.models import SessionRecord


class SkillPromotionPolicy:
    def allow(self, records: list[SessionRecord]) -> bool:
        if len(records) < 2:
            return False
        average_score = sum(record.asset_value_signals.overall_score for record in records) / len(records)
        return average_score >= 0.65
