from __future__ import annotations

from dataclasses import dataclass

from personal_brain.models import AssetValueSignals, WritebackBundle
from personal_brain.utils.files import utc_now

from .quality_gate import WritebackQualityGate
from .target_selector import WritebackTargetSelector


@dataclass(slots=True)
class WritebackContext:
    query_id: str
    question: str
    question_type: str
    answer_summary: str
    retrieved_pages: list[str]
    evidence_refs: list[str]
    asset_value_score: float


class WritebackRouter:
    def __init__(self) -> None:
        self.selector = WritebackTargetSelector()
        self.quality_gate = WritebackQualityGate()

    def route(self, context: WritebackContext) -> WritebackBundle:
        targets = self.selector.select(context)
        reviewed = self.quality_gate.review(targets)
        return WritebackBundle(
            query_id=context.query_id,
            question=context.question,
            targets=reviewed,
            target_paths=[item.target for item in reviewed],
            created_at=utc_now(),
        )


def context_from_session_record(session_record, asset_value_signals: AssetValueSignals | None = None) -> WritebackContext:
    score = asset_value_signals.overall_score if asset_value_signals is not None else session_record.asset_value_signals.overall_score
    evidence_refs = list(dict.fromkeys(source for item in session_record.selected_evidence for source in item.source_refs))
    return WritebackContext(
        query_id=session_record.query_id,
        question=session_record.user_query,
        question_type=session_record.question_classification.question_type,
        answer_summary=session_record.answer_summary,
        retrieved_pages=session_record.ranked_pages or [item.page_path for item in session_record.selected_evidence],
        evidence_refs=evidence_refs,
        asset_value_score=score,
    )
