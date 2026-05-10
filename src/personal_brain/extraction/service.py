from __future__ import annotations

from datetime import UTC, datetime

from personal_brain.agent.memory_recall import MemoryRecall
from personal_brain.agent.method_profile import MethodProfileLoader
from personal_brain.agent.style_engine import StyleEngine
from personal_brain.agent.template_selector import TemplateSelector
from personal_brain.agent.trace_builder import AgentTraceBuilder
from personal_brain.config import BrainConfig
from personal_brain.extraction.candidate_extractor import CandidateExtractor
from personal_brain.extraction.problem_compiler import ProblemCompiler
from personal_brain.extraction.product_builder import ExtractionProductBuilder
from personal_brain.extraction.question_plan_builder import QuestionPlanBuilder
from personal_brain.extraction.retrieval_planner import RetrievalPlanner
from personal_brain.extraction.state_tracker import ExtractionStateTracker
from personal_brain.extraction.stopping_criteria import StoppingCriteria
from personal_brain.extraction.writeback_stager import WritebackStager
from personal_brain.ingestion.service import IngestionService
from personal_brain.models import CandidateAssetUpdate, ExtractionInterviewState, ExtractionTurn, InterviewSession
from personal_brain.models import ProcessContext
from personal_brain.retrieval.answer_composer import AnswerComposer
from personal_brain.retrieval.answer_planner import AnswerPlanner
from personal_brain.utils.files import utc_now


class ExtractionInterviewService:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.problem_compiler = ProblemCompiler(config)
        self.retrieval_planner = RetrievalPlanner(config)
        self.question_plan_builder = QuestionPlanBuilder(config)
        self.ingestion_service = IngestionService(config)
        self.state_tracker = ExtractionStateTracker(config)
        self.stopping_criteria = StoppingCriteria()
        self.writeback_stager = WritebackStager(config)
        self.candidate_extractor = CandidateExtractor()
        self.product_builder = ExtractionProductBuilder()
        self.memory_recall = MemoryRecall(config)
        self.profile_loader = MethodProfileLoader(config)
        self.template_selector = TemplateSelector()
        self.answer_planner = AnswerPlanner()
        self.answer_composer = AnswerComposer()
        self.style_engine = StyleEngine()
        self.trace_builder = AgentTraceBuilder(config)

    def start(
        self,
        question: str,
        scene_id: str | None = None,
        session_seed: dict[str, str] | None = None,
    ) -> ExtractionInterviewState:
        timestamp = utc_now()
        interview_id = datetime.now(UTC).strftime("extract-%Y%m%d-%H%M%S-%f")
        state = ExtractionInterviewState(
            interview_id=interview_id,
            root_question=question,
            scene_id=scene_id,
            session=InterviewSession(
                session_id=interview_id,
                title=(session_seed or {}).get("title", question.strip()),
                topic_type=(session_seed or {}).get("topic_type", "topic"),
                target_object=(session_seed or {}).get("target_object", ""),
                goal=(session_seed or {}).get("goal", question.strip()),
                created_by=(session_seed or {}).get("created_by", "expert"),
                status="in_progress",
                created_at=timestamp,
                current_stage=(session_seed or {}).get("mapped_stage", ""),
                current_step=(session_seed or {}).get("mapped_step", ""),
            ),
            current_stage=(session_seed or {}).get("mapped_stage", ""),
            current_step=(session_seed or {}).get("mapped_step", ""),
            process_context=ProcessContext(
                current_stage=(session_seed or {}).get("mapped_stage", ""),
                current_step=(session_seed or {}).get("mapped_step", ""),
                anchor_bundle_id=(session_seed or {}).get("anchor_bundle_id", ""),
                anchor_paths=(
                    [
                        "raw/industry_docs/主干链路SOP.md",
                        "raw/industry_docs/主干链路SOP.graph.json",
                        "raw/industry_docs/主干链路SOP.meta.yaml",
                    ]
                    if (session_seed or {}).get("anchor_bundle_id") == "sop_mainline_001"
                    else []
                ),
                answer_mode="",
            ),
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

    def skip_interview(self, interview_id: str) -> ExtractionInterviewState:
        state = self.state_tracker.load(interview_id)
        if state.status == "completed":
            return state
        skipped_prompt = ""
        if state.next_question_plan and state.next_question_plan.candidate_questions:
            skipped_prompt = state.next_question_plan.candidate_questions[0]
        user_input = f"跳过当前问题：{skipped_prompt or '未指定追问'}"
        return self._run_turn(state, user_input, [])

    def summarize_interview(self, interview_id: str) -> ExtractionInterviewState:
        state = self.state_tracker.load(interview_id)
        if state.status == "completed":
            return state
        stop_decision = self.stopping_criteria.evaluate(state, force=False)
        state.stop_decision = stop_decision
        state.updated_at = utc_now()
        self._refresh_product_state(state)
        state.current_trace = self.trace_builder.build_trace_from_state(state)
        state.state_path = self.state_tracker.write(state)
        return state

    def update_candidate_asset(
        self,
        interview_id: str,
        asset_id: str,
        payload: dict | None = None,
    ) -> ExtractionInterviewState:
        state = self.state_tracker.load(interview_id)
        update = CandidateAssetUpdate.model_validate(payload or {})
        updated_assets = []
        found = False
        for asset in state.candidate_assets:
            if asset.asset_id != asset_id:
                updated_assets.append(asset)
                continue
            found = True
            updated_assets.append(
                asset.model_copy(
                    update={
                        "status": update.status or asset.status,
                        "summary": update.summary or asset.summary,
                        "expert_note": update.expert_note or asset.expert_note,
                    }
                )
            )
        if not found:
            raise FileNotFoundError(f"candidate asset not found: {asset_id}")
        state.candidate_assets = updated_assets
        self._refresh_product_state(state)
        state.updated_at = utc_now()
        state.current_trace = self.trace_builder.build_trace_from_state(state)
        state.state_path = self.state_tracker.write(state)
        return state

    def finish(self, interview_id: str) -> ExtractionInterviewState:
        state = self.state_tracker.load(interview_id)
        stop_decision = self.stopping_criteria.evaluate(state, force=True)
        state.stop_decision = stop_decision
        state.status = "completed"
        state.staged_writeback = self.writeback_stager.stage(state, stop_decision)
        state.updated_at = utc_now()
        self._refresh_product_state(state)
        state.current_trace = self.trace_builder.build_trace_from_state(state)
        state.state_path = self.state_tracker.write(state)
        return state

    def _run_turn(
        self,
        state: ExtractionInterviewState,
        user_input: str,
        target_slots: list[str],
    ) -> ExtractionInterviewState:
        had_prior_turns = bool(state.turns)
        pinned_stage = not had_prior_turns and bool(state.current_stage)
        pinned_step = not had_prior_turns and bool(state.current_step)
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
        grounding_blocks = self.retrieval_planner.query_engine._build_grounding_blocks(
            retrieval.evidence_pages,
            retrieval.process_context,
        )
        question_plan = self.question_plan_builder.build(compiled)
        newly_filled_slots = [slot for slot in compiled.known_slots if slot not in previous_known]
        compile_backend, compile_model, compile_warnings = self._compile_metadata_for_sources(
            retrieval.retrieved_sources
        )

        state.turn_index += 1
        state.question_type = compiled.question_type
        state.current_object = compiled.current_object
        state.current_knowledge_goal = compiled.current_knowledge_goal
        if pinned_stage:
            retrieval.process_context.current_stage = state.current_stage
        else:
            state.current_stage = retrieval.process_context.current_stage or state.current_stage
        if pinned_step:
            retrieval.process_context.current_step = state.current_step
        else:
            state.current_step = retrieval.process_context.current_step or state.current_step
        if pinned_stage and not retrieval.process_context.matched_block_ids:
            if state.current_step:
                retrieval.process_context.matched_block_ids = [f"step::{state.current_step}"]
            elif state.current_stage:
                retrieval.process_context.matched_block_ids = [f"stage::{state.current_stage}"]
        state.known_slots = compiled.known_slots
        state.missing_slots = compiled.missing_slots
        state.retrieval_buckets = retrieval
        state.process_context = retrieval.process_context
        if state.current_stage and not state.process_context.current_stage:
            state.process_context.current_stage = state.current_stage
        if state.current_step and not state.process_context.current_step:
            state.process_context.current_step = state.current_step
        if not state.process_context.anchor_bundle_id and state.session is not None:
            state.process_context.anchor_bundle_id = "sop_mainline_001"
            state.process_context.anchor_paths = [
                "raw/industry_docs/主干链路SOP.md",
                "raw/industry_docs/主干链路SOP.graph.json",
                "raw/industry_docs/主干链路SOP.meta.yaml",
            ]
        state.current_answer_markdown = answer_markdown
        state.current_answer_summary = answer_summary
        state.answer_grounding_blocks = grounding_blocks
        state.next_question_plan = question_plan
        state.ranked_pages = retrieval.ranked_page_paths
        state.retrieved_sources = retrieval.retrieved_sources
        state.compile_backend = compile_backend
        state.compile_model = compile_model
        state.compile_warnings = compile_warnings
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
        current_trace = self.trace_builder.build_extraction_trace(
            root_question=state.root_question,
            latest_user_input=user_input,
            compiled_problem=compiled,
            retrieval_buckets=retrieval,
            question_plan=question_plan,
            stop_decision=stop_decision,
            compile_backend=compile_backend,
            compile_model=compile_model,
            compile_warnings=compile_warnings,
        )
        state.current_trace = current_trace
        state.turns[-1].agent_trace = current_trace
        self._refresh_product_state(state)
        state.state_path = self.state_tracker.write(state)
        return state

    def _compile_metadata_for_sources(self, source_paths: list[str]) -> tuple[str, str, list[str]]:
        records = {record.path: record for record in self.ingestion_service.load_records()}
        backends: list[str] = []
        models: list[str] = []
        for path in source_paths:
            record = records.get(path)
            if record is None:
                continue
            if record.compile_backend:
                backends.append(record.compile_backend)
            if record.compile_model:
                models.append(record.compile_model)
        backend = "litellm" if "litellm" in backends else (backends[0] if backends else self.config.compile_backend)
        model = models[0] if models else (self.config.litellm_model if backend == "litellm" else "")
        return backend, model, []

    def _refresh_product_state(self, state: ExtractionInterviewState) -> None:
        state.session = self.product_builder.build_session(state)
        state.candidate_assets = self.candidate_extractor.build(state)
        state.followup_questions = self.product_builder.build_followup_questions(state)
        state.session_summary = self.product_builder.build_session_summary(state)
