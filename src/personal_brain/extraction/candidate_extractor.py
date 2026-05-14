from __future__ import annotations

from personal_brain.models import CandidateAsset, ExtractionInterviewState
from personal_brain.utils.text import slugify_title, summarize_text


class CandidateExtractor:
    def build(self, state: ExtractionInterviewState) -> list[CandidateAsset]:
        existing_by_id = {asset.asset_id: asset for asset in state.candidate_assets}
        generated: list[CandidateAsset] = []

        process_cards = self._build_process_cards(state)
        for card in process_cards:
            generated.append(self._merge(existing_by_id.get(card.asset_id), card))

        concept = self._build_concept(state)
        if concept is not None:
            generated.append(self._merge(existing_by_id.get(concept.asset_id), concept))

        heuristic = self._build_heuristic(state)
        if heuristic is not None:
            generated.append(self._merge(existing_by_id.get(heuristic.asset_id), heuristic))

        case = self._build_case(state)
        if case is not None:
            generated.append(self._merge(existing_by_id.get(case.asset_id), case))

        signal = self._build_signal(state)
        if signal is not None:
            generated.append(self._merge(existing_by_id.get(signal.asset_id), signal))

        boundary = self._build_boundary(state)
        if boundary is not None:
            generated.append(self._merge(existing_by_id.get(boundary.asset_id), boundary))

        seen_ids = {asset.asset_id for asset in generated}
        for existing in state.candidate_assets:
            if existing.asset_id not in seen_ids:
                generated.append(existing)
        finalized: list[CandidateAsset] = []
        for asset in generated:
            if asset.anchor_block_refs:
                finalized.append(asset)
            else:
                finalized.append(asset.model_copy(update={"anchor_block_refs": self._default_anchor_block_refs(asset)}))
        return finalized

    def _build_process_cards(self, state: ExtractionInterviewState) -> list[CandidateAsset]:
        if state.process_context.anchor_bundle_id != "sop_mainline_001":
            return []

        cards: list[CandidateAsset] = []
        answer_mode = state.process_context.answer_mode
        for index, block in enumerate(state.answer_grounding_blocks, start=1):
            block_ref = state.process_context.matched_block_ids[index - 1] if len(state.process_context.matched_block_ids) >= index else f"evidence-{index}"
            if answer_mode == "mainline_step_question" and block.text:
                for order, line in enumerate(self._extract_mainline_lines(block.text), start=1):
                    cards.append(
                        CandidateAsset(
                            asset_id=f"mainline-step-{slugify_title(line)}",
                            session_id=state.interview_id,
                            asset_type="heuristic",
                            title=line,
                            summary=f"主链路步骤 {order}",
                            content_json={"step_text": line, "order": order},
                            confidence=0.92,
                            source_turn_ids=[state.turn_index],
                            evidence_refs=list(block.refs),
                            status="draft",
                            stage_refs=[block.stage] if block.stage else ([state.current_stage] if state.current_stage else []),
                            step_refs=[line],
                            decision_refs=[],
                            card_group="mainline_step",
                            card_order=order,
                            anchor_block_refs=[block_ref],
                        )
                    )
            if "判断" in block.label or answer_mode == "judgement_question":
                cards.append(
                    CandidateAsset(
                        asset_id=f"judgement-{slugify_title(block.label or block.text[:20])}",
                        session_id=state.interview_id,
                        asset_type="heuristic",
                        title=block.label or "关键判断",
                        summary=block.text,
                        content_json={"judgement_text": block.text},
                        confidence=0.86,
                        source_turn_ids=[state.turn_index],
                        evidence_refs=list(block.refs),
                        status="draft",
                        stage_refs=[block.stage] if block.stage else ([state.current_stage] if state.current_stage else []),
                        step_refs=[block.step] if block.step else ([state.current_step] if state.current_step else []),
                        decision_refs=[],
                        card_group="judgement",
                        card_order=20 + index,
                        anchor_block_refs=[block_ref],
                    )
                )
            cards.append(
                CandidateAsset(
                    asset_id=f"evidence-{slugify_title(block.label or block_ref)}",
                    session_id=state.interview_id,
                    asset_type="signal",
                    title=block.label or f"支撑证据 {index}",
                    summary=block.text,
                    content_json={"evidence_text": block.text},
                    confidence=0.95,
                    source_turn_ids=[state.turn_index],
                    evidence_refs=list(block.refs),
                    status="draft",
                    stage_refs=[block.stage] if block.stage else ([state.current_stage] if state.current_stage else []),
                    step_refs=[block.step] if block.step else ([state.current_step] if state.current_step else []),
                    decision_refs=[],
                    card_group="evidence",
                    card_order=80 + index,
                    anchor_block_refs=[block_ref],
                )
            )

        if not any(card.card_group == "judgement" for card in cards):
            judgement_title = (
                state.current_step
                or state.process_context.linked_rules[0] if state.process_context.linked_rules else ""
            )
            judgement_summary = (
                f"当前主干优先围绕 {state.current_stage or '当前阶段'} 的关键判断展开，先确认步骤是否成立，再补边界与证据。"
            )
            if state.process_context.answer_mode == "mainline_step_question":
                mainline_lines = [
                    card.title
                    for card in cards
                    if card.card_group == "mainline_step"
                ]
                if mainline_lines:
                    judgement_summary = f"当前先确认主链路是否应从“{mainline_lines[0]}”开始，并校验后续步骤衔接是否成立。"
            cards.append(
                CandidateAsset(
                    asset_id=f"judgement-{slugify_title(judgement_title or state.current_stage or state.root_question)}",
                    session_id=state.interview_id,
                    asset_type="heuristic",
                    title=judgement_title or f"{state.current_stage or '当前阶段'}关键判断",
                    summary=judgement_summary,
                    content_json={"judgement_text": judgement_summary},
                    confidence=0.72,
                    source_turn_ids=[state.turn_index],
                    evidence_refs=list(dict.fromkeys(state.retrieved_sources[:3])),
                    status="draft",
                    stage_refs=[state.current_stage] if state.current_stage else [],
                    step_refs=[state.current_step] if state.current_step else [],
                    decision_refs=list(state.process_context.linked_rules[:2]),
                    card_group="judgement",
                    card_order=60,
                    anchor_block_refs=list(state.process_context.matched_block_ids[:1]) or ["judgement-fallback"],
                )
            )

        if not any(card.card_group == "boundary" for card in cards):
            cards.append(
                CandidateAsset(
                    asset_id=f"boundary-{slugify_title(state.current_object or state.root_question)}",
                    session_id=state.interview_id,
                    asset_type="boundary",
                    title=f"{state.current_stage or '当前阶段'}待澄清边界",
                    summary=f"仍需补齐：{', '.join(state.missing_slots[:2])}" if state.missing_slots else "当前边界待专家确认",
                    content_json={"missing_slots": list(state.missing_slots[:2])},
                    confidence=0.55,
                    source_turn_ids=[state.turn_index],
                    evidence_refs=list(state.retrieved_sources[:2]),
                    status="needs_clarification" if state.missing_slots else "draft",
                    stage_refs=[state.current_stage] if state.current_stage else [],
                    step_refs=[state.current_step] if state.current_step else [],
                    decision_refs=[],
                    card_group="boundary",
                    card_order=120,
                    anchor_block_refs=list(state.process_context.matched_block_ids[:1]),
                )
            )
        return cards

    def _build_concept(self, state: ExtractionInterviewState) -> CandidateAsset | None:
        label = state.current_object.strip()
        summary = (
            state.known_slots.get("definition")
            or state.known_slots.get("key_claims")
            or state.current_answer_summary.strip()
        )
        if not label or not summary:
            return None
        return CandidateAsset(
            asset_id=f"concept-{slugify_title(label)}",
            session_id=state.interview_id,
            asset_type="concept",
            title=label,
            summary=summary,
            content_json={
                "label": label,
                "draft_definition": summary,
                "scope_hint": state.known_slots.get("scope", ""),
                "goal_hint": state.current_knowledge_goal,
            },
            confidence=0.88 if state.known_slots.get("definition") else 0.74,
            source_turn_ids=[state.turn_index],
            evidence_refs=list(state.retrieved_sources[:3]),
            stage_refs=[state.current_stage] if state.current_stage else [],
            step_refs=[state.current_step] if state.current_step else [],
            decision_refs=list(state.process_context.linked_rules[:2]),
        )

    def _build_heuristic(self, state: ExtractionInterviewState) -> CandidateAsset | None:
        statement = state.current_answer_summary.strip()
        if not statement:
            return None
        applicable_conditions = (
            state.known_slots.get("scope")
            or state.known_slots.get("constraints")
            or state.known_slots.get("comparison_axes")
            or ""
        )
        non_applicable_conditions = state.known_slots.get("open_questions", "")
        return CandidateAsset(
            asset_id=f"heuristic-{slugify_title(state.current_object or state.root_question)}",
            session_id=state.interview_id,
            asset_type="heuristic",
            title=f"{state.current_object or '当前主题'}判断规则",
            summary=statement,
            content_json={
                "statement": statement,
                "rationale": state.current_knowledge_goal,
                "applicable_conditions": applicable_conditions,
                "non_applicable_conditions": non_applicable_conditions,
            },
            confidence=0.7,
            source_turn_ids=[state.turn_index],
            evidence_refs=list(state.retrieved_sources[:3]),
            stage_refs=[state.current_stage] if state.current_stage else [],
            step_refs=[state.current_step] if state.current_step else [],
            decision_refs=list(state.process_context.linked_rules[:2]),
        )

    def _build_case(self, state: ExtractionInterviewState) -> CandidateAsset | None:
        latest_input = state.turns[-1].user_input if state.turns else state.root_question
        case_text = state.known_slots.get("examples") or latest_input
        if not any(token in case_text for token in ["案例", "例如", "比如", "一次", "项目"]):
            return None
        summary = summarize_text(case_text, limit=1)
        return CandidateAsset(
            asset_id=f"case-{slugify_title(state.current_object or case_text)}",
            session_id=state.interview_id,
            asset_type="case",
            title=f"{state.current_object or '当前主题'}案例",
            summary=summary,
            content_json={
                "title": f"{state.current_object or '当前主题'}案例",
                "scenario": case_text,
                "action": state.current_answer_summary,
                "result": summary,
                "lesson": state.current_knowledge_goal,
            },
            confidence=0.58,
            source_turn_ids=[state.turn_index],
            evidence_refs=list(state.retrieved_sources[:2]),
            stage_refs=[state.current_stage] if state.current_stage else [],
            step_refs=[state.current_step] if state.current_step else [],
            decision_refs=list(state.process_context.linked_cases[:2]),
        )

    def _build_signal(self, state: ExtractionInterviewState) -> CandidateAsset | None:
        if state.retrieval_buckets is None or not state.retrieval_buckets.evidence_pages:
            return None
        evidence = state.retrieval_buckets.evidence_pages[0]
        summary = summarize_text(evidence.snippet, limit=1)
        return CandidateAsset(
            asset_id=f"signal-{slugify_title(state.current_object or evidence.page_title)}",
            session_id=state.interview_id,
            asset_type="signal",
            title=f"{state.current_object or evidence.page_title}关键证据",
            summary=summary,
            content_json={
                "signal_name": evidence.page_title,
                "meaning": summary,
                "positive_or_negative": "supporting",
            },
            confidence=min(0.95, max(0.45, evidence.relevance_score)),
            source_turn_ids=[state.turn_index],
            evidence_refs=list(evidence.source_refs),
            stage_refs=[state.current_stage] if state.current_stage else [],
            step_refs=[state.current_step] if state.current_step else [],
            decision_refs=list(state.process_context.linked_rules[:2]),
        )

    def _build_boundary(self, state: ExtractionInterviewState) -> CandidateAsset | None:
        boundary_text = state.known_slots.get("scope") or state.known_slots.get("open_questions")
        if not boundary_text and not state.missing_slots:
            return None
        summary = boundary_text or f"仍需补齐：{', '.join(state.missing_slots[:2])}"
        return CandidateAsset(
            asset_id=f"boundary-{slugify_title(state.current_object or state.root_question)}",
            session_id=state.interview_id,
            asset_type="boundary",
            title=f"{state.current_object or '当前主题'}边界",
            summary=summary,
            content_json={
                "boundary_statement": summary,
                "trigger_condition": state.known_slots.get("constraints", ""),
                "effect": "边界不清时，当前判断还不能直接沉淀为稳定规则。",
            },
            confidence=0.62 if boundary_text else 0.45,
            source_turn_ids=[state.turn_index],
            evidence_refs=list(state.retrieved_sources[:2]),
            status="needs_clarification" if state.missing_slots else "draft",
            stage_refs=[state.current_stage] if state.current_stage else [],
            step_refs=[state.current_step] if state.current_step else [],
            decision_refs=list(state.process_context.linked_rules[:2]),
        )

    def _merge(self, existing: CandidateAsset | None, generated: CandidateAsset) -> CandidateAsset:
        if existing is None:
            if generated.anchor_block_refs:
                return generated
            return generated.model_copy(
                update={"anchor_block_refs": self._default_anchor_block_refs(generated)}
            )
        locked = existing.status != "draft" or bool(existing.expert_note.strip())
        summary = existing.summary if locked and existing.summary else generated.summary
        content_json = existing.content_json if locked and existing.content_json else generated.content_json
        return generated.model_copy(
            update={
                "summary": summary,
                "content_json": content_json,
                "status": existing.status,
                "expert_note": existing.expert_note,
                "source_turn_ids": sorted(set(existing.source_turn_ids + generated.source_turn_ids)),
                "evidence_refs": sorted(set(existing.evidence_refs + generated.evidence_refs)),
                "confidence": max(existing.confidence, generated.confidence),
                "card_group": existing.card_group or generated.card_group,
                "card_order": existing.card_order or generated.card_order,
                "anchor_block_refs": sorted(set(existing.anchor_block_refs + generated.anchor_block_refs)),
            }
        )

    def _extract_mainline_lines(self, text: str) -> list[str]:
        lines: list[str] = []
        for raw in text.splitlines():
            cleaned = raw.strip(" -")
            if not cleaned:
                continue
            if cleaned[0].isdigit() and "." in cleaned:
                cleaned = cleaned.split(".", 1)[1].strip()
            if len(cleaned) >= 4:
                if "；" in cleaned:
                    for part in cleaned.split("；"):
                        candidate = part.strip()
                        if self._is_process_step_candidate(candidate):
                            lines.append(candidate)
                elif self._is_process_step_candidate(cleaned):
                    lines.append(cleaned.strip())
        if not lines and text.strip():
            parts = [item.strip() for item in text.split("；") if item.strip()]
            lines.extend([item for item in parts if self._is_process_step_candidate(item)])
        deduped: list[str] = []
        seen: set[str] = set()
        for line in lines:
            if line in seen:
                continue
            seen.add(line)
            deduped.append(line)
        return deduped

    def _is_process_step_candidate(self, text: str) -> bool:
        cleaned = text.strip()
        if len(cleaned) < 4:
            return False
        if cleaned in {"主链路步骤", "总体主链路"}:
            return False
        if cleaned.startswith(("第一环节", "第二阶段", "第三阶段", "第四阶段")) and "：" not in cleaned:
            return False
        return True

    def _default_anchor_block_refs(self, asset: CandidateAsset) -> list[str]:
        if asset.card_group:
            return [f"{asset.card_group}:{asset.asset_id}"]
        return [f"asset:{asset.asset_id}"]
