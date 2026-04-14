from __future__ import annotations

from personal_brain.config import BrainConfig
from personal_brain.models import ExtractionInterviewState, StagedWriteback, StopDecision
from personal_brain.writeback.router import WritebackContext, WritebackRouter


class WritebackStager:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.router = WritebackRouter()

    def stage(self, state: ExtractionInterviewState, stop_decision: StopDecision) -> StagedWriteback:
        session_level = {
            "interview_id": state.interview_id,
            "turn_index": state.turn_index,
            "known_slots": state.known_slots,
            "missing_slots": state.missing_slots,
            "summary": state.current_answer_summary,
        }

        knowledge_level = None
        asset_level = None
        projected = "session-level"

        if stop_decision.should_stop or state.turn_index >= 2:
            bundle = self.router.route(
                WritebackContext(
                    query_id=state.interview_id,
                    question=state.root_question,
                    question_type=state.question_type,
                    answer_summary=state.current_answer_summary or state.root_question,
                    retrieved_pages=state.ranked_pages,
                    evidence_refs=state.retrieved_sources,
                    asset_value_score=self._asset_value_score(state),
                )
            )
            knowledge_level = bundle.model_dump(mode="json")
            projected = "knowledge-level"

        if stop_decision.should_stop and self._should_stage_assets(state):
            asset_level = {
                "ontology_candidates": [
                    {
                        "candidate_type": "Concept",
                        "canonical_name": state.current_object,
                        "source_refs": state.retrieved_sources,
                        "supporting_slots": sorted(state.known_slots.keys()),
                    }
                ],
                "skill_candidates": [
                    {
                        "family": "decision_extraction" if state.question_type == "comparison" else "topic_synthesis",
                        "origin_interview_id": state.interview_id,
                        "supporting_pages": state.ranked_pages,
                    }
                ],
                "rationale": "Interview reached a stable, reusable state and can be staged for downstream durable assets.",
            }
            projected = "asset-level"

        return StagedWriteback(
            session_level=session_level,
            knowledge_level=knowledge_level,
            asset_level=asset_level,
            projected_writeback_level=projected,
        )

    def _asset_value_score(self, state: ExtractionInterviewState) -> float:
        slot_score = min(0.4, len(state.known_slots) * 0.08)
        page_score = min(0.3, len(state.ranked_pages) * 0.06)
        source_score = min(0.2, len(state.retrieved_sources) * 0.08)
        turn_score = 0.1 if state.turn_index >= 2 else 0.0
        return min(1.0, slot_score + page_score + source_score + turn_score)

    def _should_stage_assets(self, state: ExtractionInterviewState) -> bool:
        return not state.missing_slots and len(state.known_slots) >= 4
