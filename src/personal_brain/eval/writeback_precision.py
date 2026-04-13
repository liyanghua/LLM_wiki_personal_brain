from __future__ import annotations

from personal_brain.models import EvaluationCase, SessionRecord


def evaluate_writeback_precision(case: EvaluationCase, record: SessionRecord | None) -> tuple[float, list[str], list[str], str]:
    if record is None or record.writeback_plan is None:
        return 0.0, [], case.expected_writeback_targets, "No writeback plan available for this case."

    actual_targets = [target.target for target in record.writeback_plan.targets]
    matched = [expected for expected in case.expected_writeback_targets if any(target.startswith(expected) for target in actual_targets)]
    missing = [expected for expected in case.expected_writeback_targets if expected not in matched]
    score = len(matched) / len(case.expected_writeback_targets) if case.expected_writeback_targets else 1.0
    return score, matched, missing, "Writeback precision compares expected target prefixes with routed targets."
