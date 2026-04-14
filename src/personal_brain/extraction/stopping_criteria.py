from __future__ import annotations

from personal_brain.models import ExtractionInterviewState, StopDecision


class StoppingCriteria:
    def __init__(self, max_turns: int = 5) -> None:
        self.max_turns = max_turns

    def evaluate(self, state: ExtractionInterviewState, force: bool = False) -> StopDecision:
        if force:
            return StopDecision(should_stop=True, reason="forced-finish", confidence=1.0)
        if state.turns:
            latest_input = state.turns[-1].user_input.strip().lower()
            if latest_input in {"stop", "done", "enough", "结束", "可以了"}:
                return StopDecision(should_stop=True, reason="user-requested-stop", confidence=1.0)
        if not state.missing_slots:
            return StopDecision(should_stop=True, reason="all-required-slots-filled", confidence=0.95)
        if state.turn_index >= self.max_turns:
            return StopDecision(should_stop=True, reason="max-turns-reached", confidence=0.9)
        recent_turns = state.turns[-2:]
        if len(recent_turns) == 2 and all(not turn.newly_filled_slots for turn in recent_turns):
            return StopDecision(should_stop=True, reason="low-information-gain", confidence=0.75)
        return StopDecision(should_stop=False, reason="continue", confidence=0.8)
