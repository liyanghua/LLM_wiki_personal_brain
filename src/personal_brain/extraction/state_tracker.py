from __future__ import annotations

import json

from personal_brain.agent.trace_builder import AgentTraceBuilder
from personal_brain.config import BrainConfig
from personal_brain.extraction.candidate_extractor import CandidateExtractor
from personal_brain.extraction.product_builder import ExtractionProductBuilder
from personal_brain.models import (
    AgentTraceBundle,
    ExtractionInterviewState,
    ExtractionTurn,
    InterviewSession,
    QuestionPlan,
    RetrievalBuckets,
    SessionSummary,
    StagedWriteback,
    StopDecision,
)
from personal_brain.utils.files import iso_date, write_json


class ExtractionStateTracker:
    DEFAULT_STOP_IF = [
        "all target missing slots are filled",
        "the user says the interview has enough context",
    ]

    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.paths = config.paths
        self.trace_builder = AgentTraceBuilder(config)
        self.candidate_extractor = CandidateExtractor()
        self.product_builder = ExtractionProductBuilder()

    def write(self, state: ExtractionInterviewState) -> str:
        created_at = state.created_at or state.updated_at
        if created_at is None:
            raise ValueError("Extraction interview state must include created_at before writing.")
        day = iso_date(created_at)
        path = self.paths.extraction_state_path(day, state.interview_id)
        relative_path = str(path.relative_to(self.config.root))
        normalized = self._normalize_state(state, relative_path)
        write_json(path, normalized.model_dump(mode="json"))
        self._append_daily_summary(normalized, day)
        return relative_path

    def load(self, interview_id: str) -> ExtractionInterviewState:
        for path in sorted(self.paths.extraction_dir.glob("20??-??-??/*.json"), reverse=True):
            payload = json.loads(path.read_text(encoding="utf-8"))
            if payload.get("interview_id") == interview_id:
                state = ExtractionInterviewState.model_validate(payload)
                return self._normalize_state(state, str(path.relative_to(self.config.root)))
        raise FileNotFoundError(f"Extraction interview not found: {interview_id}")

    def _append_daily_summary(self, state: ExtractionInterviewState, day: str) -> None:
        path = self.paths.extraction_summary_path(day)
        header = f"# Extraction Summary {day}\n\n"
        previous = path.read_text(encoding="utf-8") if path.exists() else header
        last_question = ""
        if state.next_question_plan and state.next_question_plan.candidate_questions:
            last_question = state.next_question_plan.candidate_questions[0]
        entry = [
            f"## {state.interview_id}",
            f"- Root question: {state.root_question}",
            f"- Status: {state.status}",
            f"- Object: {state.current_object}",
            f"- Missing slots: {', '.join(state.missing_slots) if state.missing_slots else 'none'}",
            f"- Next question: {last_question or 'n/a'}",
        ]
        path.write_text(previous + "\n".join(entry) + "\n\n", encoding="utf-8")

    def _normalize_state(
        self,
        state: ExtractionInterviewState,
        state_path: str,
    ) -> ExtractionInterviewState:
        normalized = state.model_copy(deep=True)
        normalized.state_path = state_path
        normalized.retrieval_buckets = normalized.retrieval_buckets or RetrievalBuckets()
        normalized.next_question_plan = normalized.next_question_plan or self._default_question_plan(normalized)
        normalized.stop_decision = normalized.stop_decision or self._default_stop_decision(normalized)
        normalized.staged_writeback = normalized.staged_writeback or self._default_staged_writeback(normalized)
        normalized.session = normalized.session or self._default_session(normalized)
        normalized.candidate_assets = normalized.candidate_assets or self.candidate_extractor.build(normalized)
        normalized.followup_questions = normalized.followup_questions or self.product_builder.build_followup_questions(normalized)
        normalized.session_summary = normalized.session_summary or self._default_session_summary(normalized)
        normalized.turns = [self._normalize_turn(normalized, turn) for turn in normalized.turns]
        normalized.current_trace = normalized.current_trace or self._default_agent_trace(normalized)
        return normalized

    def _normalize_turn(
        self,
        state: ExtractionInterviewState,
        turn: ExtractionTurn,
    ) -> ExtractionTurn:
        normalized_turn = turn.model_copy(deep=True)
        normalized_turn.retrieval_buckets = normalized_turn.retrieval_buckets or state.retrieval_buckets or RetrievalBuckets()
        normalized_turn.agent_trace = normalized_turn.agent_trace or self.trace_builder.build_trace_for_turn(
            state,
            normalized_turn.turn_index,
        )
        return normalized_turn

    def _default_question_plan(self, state: ExtractionInterviewState) -> QuestionPlan:
        should_stop = state.status == "completed" or not state.missing_slots
        return QuestionPlan(
            next_question_type="stop" if should_stop else "slot-fill",
            candidate_questions=[],
            target_missing_slots=list(state.missing_slots),
            stop_if=list(self.DEFAULT_STOP_IF),
        )

    def _default_stop_decision(self, state: ExtractionInterviewState) -> StopDecision:
        if state.status == "completed":
            return StopDecision(should_stop=True, reason="completed-state", confidence=0.95)
        if not state.missing_slots:
            return StopDecision(should_stop=True, reason="all-required-slots-filled", confidence=0.95)
        return StopDecision(should_stop=False, reason="continue", confidence=0.8)

    def _default_staged_writeback(self, state: ExtractionInterviewState) -> StagedWriteback:
        return StagedWriteback(
            session_level={
                "interview_id": state.interview_id,
                "turn_index": state.turn_index,
                "known_slots": state.known_slots,
                "missing_slots": state.missing_slots,
                "summary": state.current_answer_summary,
            },
            knowledge_level=None,
            asset_level=None,
            projected_writeback_level=self._default_projected_level(state),
        )

    def _default_projected_level(self, state: ExtractionInterviewState) -> str:
        if state.status == "completed" and not state.missing_slots and len(state.known_slots) >= 4:
            return "asset-level"
        if state.status == "completed" or state.turn_index >= 2:
            return "knowledge-level"
        return "session-level"

    def _default_agent_trace(self, state: ExtractionInterviewState) -> AgentTraceBundle:
        return self.trace_builder.build_trace_from_state(state)

    def _default_session(self, state: ExtractionInterviewState) -> InterviewSession:
        return self.product_builder.build_session(state)

    def _default_session_summary(self, state: ExtractionInterviewState) -> SessionSummary:
        return self.product_builder.build_session_summary(state)
