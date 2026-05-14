from __future__ import annotations

from personal_brain.models import ExtractionInterviewState, FollowupQuestion, InterviewSession, SessionSummary
from personal_brain.utils.text import slugify_title


class ExtractionProductBuilder:
    def build_session(self, state: ExtractionInterviewState) -> InterviewSession:
        existing = state.session
        title = existing.title if existing and existing.title.strip() else state.root_question.strip()
        topic_type = existing.topic_type if existing and existing.topic_type.strip() else self._infer_topic_type(state)
        target_object = (
            existing.target_object if existing and existing.target_object.strip() else state.current_object or state.root_question
        )
        goal = existing.goal if existing and existing.goal.strip() else state.current_knowledge_goal or state.root_question
        created_by = existing.created_by if existing and existing.created_by.strip() else "expert"
        created_at = existing.created_at if existing and existing.created_at else state.created_at
        completed_at = state.updated_at if state.status == "completed" else (existing.completed_at if existing else None)
        return InterviewSession(
            session_id=state.interview_id,
            title=title,
            topic_type=topic_type,
            target_object=target_object,
            goal=goal,
            status=state.status,
            created_by=created_by,
            created_at=created_at,
            completed_at=completed_at,
            current_stage=state.current_stage,
            current_step=state.current_step,
        )

    def build_followup_questions(self, state: ExtractionInterviewState) -> list[FollowupQuestion]:
        existing_by_text = {item.question_text: item for item in state.followup_questions}
        generated: list[FollowupQuestion] = []

        for index, question_text in enumerate(state.next_question_plan.candidate_questions if state.next_question_plan else []):
            existing = existing_by_text.get(question_text)
            generated.append(
                FollowupQuestion(
                    question_id=existing.question_id if existing else f"followup-{slugify_title(question_text)}",
                    session_id=state.interview_id,
                    question_text=question_text,
                    question_type=state.next_question_plan.next_question_type if state.next_question_plan else state.question_type,
                    reason=self._slot_reason(state, index),
                    priority="high" if index == 0 else "medium",
                    status="selected" if index == 0 else "open",
                    source_asset_ids=self._related_asset_ids(state),
                    target_missing_slots=list(state.next_question_plan.target_missing_slots if state.next_question_plan else []),
                    linked_stage=state.current_stage,
                    linked_step=state.current_step,
                    gap_type=self._gap_type(state, question_text),
                )
            )

        for asset in state.candidate_assets:
            if asset.status != "needs_clarification":
                continue
            question_text = f"请补充澄清：{asset.title} 当前还缺少哪些边界或例外？"
            if any(item.question_text == question_text for item in generated):
                continue
            generated.append(
                FollowupQuestion(
                    question_id=f"followup-{slugify_title(question_text)}",
                    session_id=state.interview_id,
                    question_text=question_text,
                    question_type="clarification",
                    reason=f"{asset.title} 当前状态为 needs_clarification",
                    priority="medium",
                    status="open",
                    source_asset_ids=[asset.asset_id],
                    target_missing_slots=list(state.missing_slots[:2]),
                    linked_stage=state.current_stage,
                    linked_step=state.current_step,
                    gap_type="boundary_gap",
                )
            )

        active_texts = {item.question_text for item in generated}
        for existing in state.followup_questions:
            if existing.question_text in active_texts:
                continue
            fallback_status = "answered" if existing.status in {"open", "selected"} else existing.status
            generated.append(existing.model_copy(update={"status": fallback_status}))
        return generated

    def build_session_summary(self, state: ExtractionInterviewState) -> SessionSummary:
        concepts = [item.title for item in state.candidate_assets if item.asset_type == "concept" and item.status != "rejected"]
        heuristics = [
            item.title for item in state.candidate_assets if item.asset_type == "heuristic" and item.status != "rejected"
        ]
        cases = [item.title for item in state.candidate_assets if item.asset_type == "case" and item.status != "rejected"]
        boundaries = [
            item.title for item in state.candidate_assets if item.asset_type == "boundary" and item.status != "rejected"
        ]
        unresolved_items = list(state.missing_slots)
        unresolved_items.extend(
            asset.title for asset in state.candidate_assets if asset.status in {"needs_clarification", "rejected"}
        )
        summary_text = state.current_answer_summary or state.root_question
        mainline_steps = [
            item.title
            for item in state.candidate_assets
            if item.card_group == "mainline_step" and item.status != "rejected"
        ]
        judgements = [
            item.title
            for item in state.candidate_assets
            if item.card_group == "judgement" and item.status != "rejected"
        ]
        evidence = [
            ref
            for item in state.candidate_assets
            if item.card_group == "evidence" and item.status != "rejected"
            for ref in item.evidence_refs
        ]
        if mainline_steps:
            summary_text = (
                f"已确认主链路步骤：{'；'.join(mainline_steps[:4])}"
                + (f"；关键判断：{'；'.join(judgements[:3])}" if judgements else "")
                + (f"；待补证据：{' | '.join(dict.fromkeys(evidence[:3]))}" if evidence else "")
            )
        return SessionSummary(
            summary_id=f"summary-{state.interview_id}",
            session_id=state.interview_id,
            summary_text=summary_text,
            key_concepts=concepts,
            key_heuristics=heuristics,
            key_cases=cases,
            key_boundaries=boundaries,
            unresolved_items=list(dict.fromkeys(item for item in unresolved_items if item)),
        )

    def _infer_topic_type(self, state: ExtractionInterviewState) -> str:
        if state.question_type in {"definition", "comparison"}:
            return "strategy"
        if state.question_type == "project-status":
            return "project"
        return "topic"

    def _slot_reason(self, state: ExtractionInterviewState, index: int) -> str:
        target_slots = state.next_question_plan.target_missing_slots if state.next_question_plan else []
        if target_slots:
            slot = target_slots[min(index, len(target_slots) - 1)]
            return f"待补齐槽位：{slot}"
        if state.missing_slots:
            return f"待补齐槽位：{state.missing_slots[0]}"
        return "继续收敛当前问题"

    def _related_asset_ids(self, state: ExtractionInterviewState) -> list[str]:
        return [asset.asset_id for asset in state.candidate_assets[:2]]

    def _gap_type(self, state: ExtractionInterviewState, question_text: str) -> str:
        if state.process_context.answer_mode in {"mainline_step_question", "stage_question"}:
            return "stage_step_gap"
        if "判断" in question_text:
            return "judgement_gap"
        if "边界" in question_text or "例外" in question_text:
            return "boundary_gap"
        if "证据" in question_text:
            return "evidence_gap"
        return "stage_step_gap" if state.current_step else "judgement_gap"
