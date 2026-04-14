from __future__ import annotations

from personal_brain.config import BrainConfig
from personal_brain.models import ExtractionInterviewState
from personal_brain.utils.files import iso_date, write_json


class ExtractionStateTracker:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.paths = config.paths

    def write(self, state: ExtractionInterviewState) -> str:
        created_at = state.created_at or state.updated_at
        if created_at is None:
            raise ValueError("Extraction interview state must include created_at before writing.")
        day = iso_date(created_at)
        path = self.paths.extraction_state_path(day, state.interview_id)
        write_json(path, state.model_dump(mode="json"))
        self._append_daily_summary(state, day)
        return str(path.relative_to(self.config.root))

    def load(self, interview_id: str) -> ExtractionInterviewState:
        for path in sorted(self.paths.extraction_dir.glob("20??-??-??/*.json"), reverse=True):
            state = ExtractionInterviewState.model_validate_json(path.read_text(encoding="utf-8"))
            if state.interview_id == interview_id:
                state.state_path = str(path.relative_to(self.config.root))
                return state
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
