from __future__ import annotations

from datetime import UTC, datetime

from personal_brain.agent.memory_recall import MemoryRecall
from personal_brain.agent.method_profile import MethodProfileLoader
from personal_brain.agent.style_engine import StyleEngine
from personal_brain.agent.template_selector import TemplateSelector
from personal_brain.config import BrainConfig
from personal_brain.extraction.problem_compiler import ProblemCompiler
from personal_brain.extraction.question_plan_builder import QuestionPlanBuilder
from personal_brain.extraction.retrieval_planner import RetrievalPlanner
from personal_brain.extraction.state_tracker import ExtractionStateTracker
from personal_brain.extraction.stopping_criteria import StoppingCriteria
from personal_brain.extraction.writeback_stager import WritebackStager
from personal_brain.models import ExtractionInterviewState, ExtractionTurn
from personal_brain.retrieval.answer_composer import AnswerComposer
from personal_brain.retrieval.answer_planner import AnswerPlanner
from personal_brain.utils.files import utc_now


class ExtractionInterviewService:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.problem_compiler = ProblemCompiler(config)
        self.retrieval_planner = RetrievalPlanner(config)
        self.question_plan_builder = QuestionPlanBuilder()
        self.state_tracker = ExtractionStateTracker(config)
        self.stopping_criteria = StoppingCriteria()
        self.writeback_stager = WritebackStager(config)
        self.memory_recall = MemoryRecall(config)
        self.profile_loader = MethodProfileLoader(config)
        self.template_selector = TemplateSelector()
        self.answer_planner = AnswerPlanner()
        self.answer_composer = AnswerComposer()
        self.style_engine = StyleEngine()

    def start(self, question: str, scene_id: str | None = None) -> ExtractionInterviewState:
        timestamp = utc_now()
        state = ExtractionInterviewState(
            interview_id=datetime.now(UTC).strftime("extract-%Y%m%d-%H%M%S-%f"),
            root_question=question,
            scene_id=scene_id,
            created_at=timestamp,
            updated_at=timestamp,
        )
        return self._run_turn(state, question, [])

    def get(self, interview_id: str) -> ExtractionInterviewState:
        return self.state_tracker.load(interview_id)

    def continue_interview(self, interview_id: str, user_answer: str) -> ExtractionInterviewState:
        state = self.state_tracker.load(interview_id)
        if state.status == "completed":
            return state
        target_slots = []
        if state.next_question_plan is not None:
            target_slots = state.next_question_plan.target_missing_slots
        return self._run_turn(state, user_answer, target_slots)

    def finish(self, interview_id: str) -> ExtractionInterviewState:
        state = self.state_tracker.load(interview_id)
        stop_decision = self.stopping_criteria.evaluate(state, force=True)
        state.stop_decision = stop_decision
        state.status = "completed"
        state.staged_writeback = self.writeback_stager.stage(state, stop_decision)
        state.updated_at = utc_now()
        state.state_path = self.state_tracker.write(state)
        return state

    def _run_turn(
        self,
        state: ExtractionInterviewState,
        user_input: str,
        target_slots: list[str],
    ) -> ExtractionInterviewState:
        previous_known = dict(state.known_slots)
        compiled = self.problem_compiler.compile(
            root_question=state.root_question,
            latest_user_input=user_input,
            scene_id=state.scene_id,
            known_slots=state.known_slots,
            targeted_slots=target_slots,
            turn_index=state.turn_index,
        )
        retrieval = self.retrieval_planner.plan(compiled, state)
        recalled_memory = self.memory_recall.recall(state.root_question)
        answer_plan = self.answer_planner.plan(
            state.root_question,
            compiled.question_type,
            retrieval.evidence_pages,
            recalled_memory,
        )
        profile = self.profile_loader.load()
        template = self.template_selector.select(compiled.question_type, profile)
        sections, answer_summary = self.answer_composer.compose(
            answer_plan,
            retrieval.evidence_pages,
            recalled_memory,
            template=template,
        )
        answer_markdown = self.style_engine.render(
            state.root_question,
            sections,
            retrieval.evidence_pages,
            profile,
            template=template,
        )
        question_plan = self.question_plan_builder.build(compiled)
        newly_filled_slots = [slot for slot in compiled.known_slots if slot not in previous_known]

        state.turn_index += 1
        state.question_type = compiled.question_type
        state.current_object = compiled.current_object
        state.current_knowledge_goal = compiled.current_knowledge_goal
        state.known_slots = compiled.known_slots
        state.missing_slots = compiled.missing_slots
        state.retrieval_buckets = retrieval
        state.current_answer_markdown = answer_markdown
        state.current_answer_summary = answer_summary
        state.next_question_plan = question_plan
        state.ranked_pages = retrieval.ranked_page_paths
        state.retrieved_sources = retrieval.retrieved_sources
        state.updated_at = utc_now()
        state.turns.append(
            ExtractionTurn(
                turn_index=state.turn_index,
                user_input=user_input,
                compiled_problem=compiled,
                retrieval_buckets=retrieval,
                answer_summary=answer_summary,
                answer_markdown=answer_markdown,
                question_plan=question_plan,
                newly_filled_slots=newly_filled_slots,
                created_at=state.updated_at,
            )
        )

        stop_decision = self.stopping_criteria.evaluate(state)
        state.stop_decision = stop_decision
        state.status = "completed" if stop_decision.should_stop else "in_progress"
        state.staged_writeback = self.writeback_stager.stage(state, stop_decision)
        state.state_path = self.state_tracker.write(state)
        return state
