from __future__ import annotations

from personal_brain.models import SessionRecord


def evaluate_asset_value(record: SessionRecord | None) -> tuple[float, str]:
    if record is None:
        return 0.0, "No matching session record found."
    return record.asset_value_signals.overall_score, "Asset value derived from stored session asset signals."
