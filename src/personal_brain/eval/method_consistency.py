from __future__ import annotations

from pathlib import Path

from personal_brain.models import MethodProfile, SessionRecord


def evaluate_method_consistency(record: SessionRecord | None, profile: MethodProfile, root: Path) -> tuple[float, str]:
    if record is None:
        return 0.0, "No matching session record found."
    answer_path = root / record.answer_path
    if not answer_path.exists():
        return 0.0, "Answer markdown missing."

    answer_text = answer_path.read_text(encoding="utf-8")
    ordered_sections = [f"## {name.title()}" for name in profile.preferred_answer_structure]
    seen = [heading for heading in ordered_sections if heading in answer_text]
    if len(seen) < 4:
        return 0.4, "Answer markdown is missing one or more core method sections."
    if record.method_profile_id and record.template_id:
        return 1.0, "Answer preserved the core four-part structure with stored method/template identifiers."
    return 0.6, "Answer structure exists but method/template metadata is incomplete."
