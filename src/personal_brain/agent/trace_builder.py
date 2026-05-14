from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from personal_brain.config import BrainConfig
from personal_brain.models import (
    AgentTraceBundle,
    CompiledProblem,
    EvidenceItem,
    ExtractionInterviewState,
    QuestionClassification,
    QuestionPlan,
    RankedPage,
    RetrievalBuckets,
    SearchTrace,
    StopDecision,
    TraceLogEntry,
    TraceStage,
)
from personal_brain.retrieval.wiki_page_store import WikiPageStore


WIKI_RECALL_LABEL = "Agent 是否能从原始 wiki 中获得有用知识？"
CONTEXT_EXPAND_LABEL = "Agent 是否能扩展相关对象与证据链？"
ONTOLOGY_DECISION_LABEL = "Agent 是否能通过本体做状态判断与动作选择？"
SKILL_REUSE_LABEL = "Agent 是否能通过 skill 稳定复用经验？"
THIN_WIKI_WARNING = "wiki source page is too thin for direct answering"


@dataclass(frozen=True)
class ThinSourceGap:
    wiki_path: str
    raw_path: str
    raw_snippet: str


class AgentTraceBuilder:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.page_store = WikiPageStore(config)

    def build_answer_trace(
        self,
        *,
        question: str,
        classification: QuestionClassification,
        search_trace: SearchTrace,
        ranked: list[RankedPage],
        selected_evidence: list[EvidenceItem],
        raw_evidence: list[EvidenceItem],
        compile_backend: str = "deterministic",
        compile_model: str = "",
        compile_warnings: list[str] | None = None,
    ) -> AgentTraceBundle:
        gaps = self.detect_thin_source_gaps(ranked_pages=ranked)
        warnings = [THIN_WIKI_WARNING] if gaps else []
        compile_warnings = list(compile_warnings or [])
        warnings = self._unique(warnings + compile_warnings)
        wiki_hits = self._unique(item.page.path for item in ranked if item.page.path.startswith("wiki/"))
        raw_hits = self._unique(
            [item.page_path for item in raw_evidence if item.page_path.startswith((self.config.source_prefix + "/", "raw/"))]
            + [gap.raw_path for gap in gaps]
        )
        top_hits = self._build_top_hits(ranked=ranked, raw_evidence=raw_evidence, gaps=gaps)
        evidence_refs = self._unique(
            [item.page_path for item in selected_evidence]
            + [ref for item in selected_evidence for ref in item.source_refs]
            + [gap.wiki_path for gap in gaps]
            + [gap.raw_path for gap in gaps]
        )

        current_object = ranked[0].page.title if ranked else question
        decision_trace = {
            "question_type": classification.question_type,
            "current_object": current_object,
            "knowledge_goal": question,
            "recommended_action": "answer",
            "target_missing_slots": [],
            "stop_reason": "inactive",
        }
        retrieval_trace = {
            "backend": search_trace.backend,
            "mode": search_trace.retrieval_mode,
            "collection": search_trace.collection,
            "retrieval_explain": list(search_trace.explain),
            "wiki_hits": wiki_hits,
            "raw_hits": raw_hits,
            "top_hits": top_hits,
            "warnings": warnings,
        }
        llm_log = [
            TraceLogEntry(
                component="query_engine",
                step="classify",
                input_summary=f"question={question}",
                output_summary=f"question_type={classification.question_type}",
                refs=[],
                warnings=[],
            ),
            TraceLogEntry(
                component="normalize_service",
                step="llm_object_compile",
                input_summary=f"compile_backend={compile_backend}; model={compile_model or 'none'}",
                output_summary=(
                    "compiled wiki-backed artifacts available"
                    if compile_backend == "litellm"
                    else "using deterministic compile fallback"
                ),
                refs=evidence_refs[:4],
                warnings=compile_warnings,
            ),
            TraceLogEntry(
                component="query_engine",
                step="search",
                input_summary=f"backend={search_trace.backend}; mode={search_trace.retrieval_mode}",
                output_summary=self._search_summary(wiki_hits=wiki_hits, raw_hits=raw_hits, warnings=warnings),
                refs=wiki_hits[:3] + raw_hits[:2],
                warnings=warnings,
            ),
            TraceLogEntry(
                component="query_engine",
                step="page_rank",
                input_summary=f"ranked_candidates={len(ranked)}",
                output_summary=f"top_pages={', '.join(hit['title'] for hit in top_hits[:3]) or 'none'}",
                refs=[hit["path"] for hit in top_hits[:3]],
                warnings=[],
            ),
            TraceLogEntry(
                component="query_engine",
                step="evidence_select",
                input_summary=f"candidate_evidence={len(selected_evidence)}",
                output_summary=f"selected {len(selected_evidence)} evidence snippets",
                refs=evidence_refs[:5],
                warnings=warnings,
            ),
            TraceLogEntry(
                component="query_engine",
                step="answer_plan",
                input_summary=f"question_type={classification.question_type}",
                output_summary="structured answer composed from selected evidence",
                refs=[item.page_path for item in selected_evidence[:3]],
                warnings=[],
            ),
        ]

        return AgentTraceBundle(
            stage_checks=[
                self._build_wiki_recall_stage(wiki_hits=wiki_hits, evidence_refs=evidence_refs, warnings=warnings),
                self._build_context_expand_stage(
                    wiki_hits=wiki_hits,
                    linked_context=sum(len(item.page.links_to) for item in ranked[:3]),
                    evidence_refs=[item.page.path for item in ranked[:3]],
                ),
                self._build_quick_ontology_decision_stage(question_type=classification.question_type, question=question),
                self._build_skill_reuse_stage(),
            ],
            retrieval_trace=retrieval_trace,
            decision_trace=decision_trace,
            llm_log=llm_log,
        )

    def build_extraction_trace(
        self,
        *,
        root_question: str,
        latest_user_input: str,
        compiled_problem: CompiledProblem,
        retrieval_buckets: RetrievalBuckets,
        question_plan: QuestionPlan | None,
        stop_decision: StopDecision | None,
        compile_backend: str = "deterministic",
        compile_model: str = "",
        compile_warnings: list[str] | None = None,
    ) -> AgentTraceBundle:
        gaps = self.detect_thin_source_gaps(ranked_paths=retrieval_buckets.ranked_page_paths)
        compile_warnings = list(compile_warnings or [])
        warnings = self._unique(
            list(retrieval_buckets.retrieval_explain) + ([THIN_WIKI_WARNING] if gaps else []) + compile_warnings
        )
        wiki_hits = self._unique(path for path in retrieval_buckets.ranked_page_paths if path.startswith("wiki/"))
        raw_hits = self._unique(
            [
                item.page_path
                for item in retrieval_buckets.evidence_pages
                if item.page_path.startswith((self.config.source_prefix + "/", "raw/"))
            ]
            + [gap.raw_path for gap in gaps]
        )
        top_hits = self._build_extraction_top_hits(retrieval_buckets, gaps)
        target_missing_slots = question_plan.target_missing_slots if question_plan is not None else compiled_problem.missing_slots
        stop_reason = stop_decision.reason if stop_decision is not None else "continue"
        evidence_refs = self._unique(
            wiki_hits
            + raw_hits
            + [item.page_path for item in retrieval_buckets.evidence_pages]
            + [hit.path for hit in retrieval_buckets.object_pages[:3]]
            + [hit.path for hit in retrieval_buckets.pattern_hits[:3]]
        )
        decision_trace = {
            "question_type": compiled_problem.question_type,
            "current_object": compiled_problem.current_object,
            "knowledge_goal": compiled_problem.current_knowledge_goal,
            "recommended_action": compiled_problem.recommended_action,
            "target_missing_slots": list(target_missing_slots),
            "stop_reason": stop_reason,
        }
        retrieval_trace = {
            "backend": retrieval_buckets.retrieval_backend,
            "mode": retrieval_buckets.retrieval_mode,
            "collection": retrieval_buckets.retrieval_collection,
            "retrieval_explain": list(retrieval_buckets.retrieval_explain),
            "wiki_hits": wiki_hits,
            "raw_hits": raw_hits,
            "top_hits": top_hits,
            "warnings": warnings,
        }
        llm_log = [
            TraceLogEntry(
                component="problem_compiler",
                step="compile",
                input_summary=f"root={root_question}; latest={latest_user_input}",
                output_summary=(
                    f"object={compiled_problem.current_object}; "
                    f"missing_slots={','.join(compiled_problem.missing_slots) or 'none'}"
                ),
                refs=[],
                warnings=[],
            ),
            TraceLogEntry(
                component="normalize_service",
                step="llm_object_compile",
                input_summary=f"compile_backend={compile_backend}; model={compile_model or 'none'}",
                output_summary=(
                    "compiled source bundle available for extraction"
                    if compile_backend == "litellm"
                    else "using deterministic compile fallback"
                ),
                refs=evidence_refs[:4],
                warnings=compile_warnings,
            ),
            TraceLogEntry(
                component="retrieval_planner",
                step="retrieve",
                input_summary=(
                    f"query={compiled_problem.current_object} {compiled_problem.current_knowledge_goal}".strip()
                ),
                output_summary=(
                    "bucket_counts="
                    f"object:{len(retrieval_buckets.object_pages)} "
                    f"evidence:{len(retrieval_buckets.evidence_pages)} "
                    f"pattern:{len(retrieval_buckets.pattern_hits)}"
                ),
                refs=evidence_refs[:5],
                warnings=warnings,
            ),
            TraceLogEntry(
                component="answer_planner",
                step="compose_answer",
                input_summary=f"question_type={compiled_problem.question_type}",
                output_summary=f"retrieved_sources={len(retrieval_buckets.retrieved_sources)}",
                refs=[item.page_path for item in retrieval_buckets.evidence_pages[:3]],
                warnings=[],
            ),
            TraceLogEntry(
                component="question_plan_builder",
                step="next_question",
                input_summary=f"missing_slots={','.join(compiled_problem.missing_slots) or 'none'}",
                output_summary=(
                    f"next_question_type={question_plan.next_question_type}"
                    if question_plan is not None
                    else "next_question_type=unknown"
                ),
                refs=(question_plan.candidate_questions[:2] if question_plan is not None else []),
                warnings=[],
            ),
            TraceLogEntry(
                component="stopping_criteria",
                step="evaluate",
                input_summary=f"turns={compiled_problem.known_slots.keys()}",
                output_summary=f"stop={stop_reason}",
                refs=[],
                warnings=[],
            ),
        ]

        return AgentTraceBundle(
            stage_checks=[
                self._build_wiki_recall_stage(wiki_hits=wiki_hits, evidence_refs=evidence_refs, warnings=warnings),
                self._build_context_expand_stage(
                    wiki_hits=wiki_hits,
                    linked_context=(
                        len(retrieval_buckets.object_pages)
                        + len(retrieval_buckets.pattern_hits)
                        + len(retrieval_buckets.conversation_hits)
                    ),
                    evidence_refs=[
                        hit.path for hit in retrieval_buckets.object_pages[:2] + retrieval_buckets.pattern_hits[:2]
                    ],
                ),
                self._build_extraction_ontology_decision_stage(
                    compiled_problem=compiled_problem,
                    question_plan=question_plan,
                    stop_decision=stop_decision,
                ),
                self._build_skill_reuse_stage(),
            ],
            retrieval_trace=retrieval_trace,
            decision_trace=decision_trace,
            llm_log=llm_log,
        )

    def build_trace_from_state(self, state: ExtractionInterviewState) -> AgentTraceBundle:
        latest_turn = state.turns[-1] if state.turns else None
        if latest_turn is not None and latest_turn.compiled_problem is not None:
            return self.build_extraction_trace(
                root_question=state.root_question,
                latest_user_input=latest_turn.user_input,
                compiled_problem=latest_turn.compiled_problem,
                retrieval_buckets=latest_turn.retrieval_buckets or state.retrieval_buckets or RetrievalBuckets(),
                question_plan=latest_turn.question_plan or state.next_question_plan,
                stop_decision=state.stop_decision,
            )

        compiled_problem = CompiledProblem(
            scene_id=state.scene_id,
            slot_schema_source="legacy-state",
            current_object=state.current_object or state.root_question,
            current_knowledge_goal=state.current_knowledge_goal or state.root_question,
            question_type=state.question_type,
            known_slots=dict(state.known_slots),
            missing_slots=list(state.missing_slots),
            recommended_action="write_back" if not state.missing_slots else "ask_follow_up",
            slot_names=list(state.known_slots.keys()),
            cues=[],
        )
        return self.build_extraction_trace(
            root_question=state.root_question,
            latest_user_input=latest_turn.user_input if latest_turn is not None else state.root_question,
            compiled_problem=compiled_problem,
            retrieval_buckets=state.retrieval_buckets or RetrievalBuckets(),
            question_plan=state.next_question_plan,
            stop_decision=state.stop_decision,
        )

    def build_trace_for_turn(self, state: ExtractionInterviewState, turn_index: int) -> AgentTraceBundle:
        turn = next((item for item in state.turns if item.turn_index == turn_index), None)
        if turn is None or turn.compiled_problem is None:
            return self.build_trace_from_state(state)
        return self.build_extraction_trace(
            root_question=state.root_question,
            latest_user_input=turn.user_input,
            compiled_problem=turn.compiled_problem,
            retrieval_buckets=turn.retrieval_buckets or state.retrieval_buckets or RetrievalBuckets(),
            question_plan=turn.question_plan or state.next_question_plan,
            stop_decision=state.stop_decision,
        )

    def detect_thin_source_gaps(
        self,
        *,
        ranked_pages: list[RankedPage] | None = None,
        ranked_paths: list[str] | None = None,
    ) -> list[ThinSourceGap]:
        gaps: list[ThinSourceGap] = []
        candidates = list(ranked_pages or [])
        if ranked_paths:
            for path in ranked_paths:
                candidate = self.page_store.load_by_path(path)
                if candidate is not None:
                    candidates.append(
                        RankedPage(
                            page=candidate.page,
                            body=candidate.body,
                            score=0.0,
                            reasons=[],
                        )
                    )
        seen: set[str] = set()
        for item in candidates:
            if item.page.path in seen or not item.page.path.startswith("wiki/sources/"):
                continue
            seen.add(item.page.path)
            raw_path = next(
                (
                    ref
                    for ref in item.page.source_refs
                    if ref.startswith((self.config.source_prefix + "/", "raw/"))
                ),
                "",
            )
            if not raw_path:
                continue
            raw_file = self.config.root / raw_path
            if not raw_file.exists():
                continue
            raw_text = raw_file.read_text(encoding="utf-8")
            if self._is_thin_source_page(item.body, raw_text):
                gaps.append(
                    ThinSourceGap(
                        wiki_path=item.page.path,
                        raw_path=raw_path,
                        raw_snippet=self._extract_raw_snippet(raw_path, raw_text),
                    )
                )
        return gaps

    def _build_wiki_recall_stage(
        self,
        *,
        wiki_hits: list[str],
        evidence_refs: list[str],
        warnings: list[str],
    ) -> TraceStage:
        if not wiki_hits:
            return TraceStage(
                stage_id="wiki_recall",
                label=WIKI_RECALL_LABEL,
                status="fail",
                reason="未召回相关 wiki 页面，回答缺少主知识层 grounding。",
                pass_criteria="能召回，不乱引",
                evidence_refs=evidence_refs[:5],
                warnings=warnings,
            )
        if THIN_WIKI_WARNING in warnings:
            return TraceStage(
                stage_id="wiki_recall",
                label=WIKI_RECALL_LABEL,
                status="partial",
                reason="召回到了 wiki 页面，但页面正文过薄，需要 raw 补证据。",
                pass_criteria="能召回，不乱引",
                evidence_refs=evidence_refs[:6],
                warnings=warnings,
            )
        return TraceStage(
            stage_id="wiki_recall",
            label=WIKI_RECALL_LABEL,
            status="pass",
            reason="已召回正确 wiki 页面，并抽取到足以支撑回答的证据片段。",
            pass_criteria="能召回，不乱引",
            evidence_refs=evidence_refs[:5],
            warnings=warnings,
        )

    def _build_context_expand_stage(
        self,
        *,
        wiki_hits: list[str],
        linked_context: int,
        evidence_refs: list[str],
    ) -> TraceStage:
        if linked_context >= 2 or len(wiki_hits) >= 2:
            return TraceStage(
                stage_id="context_expand",
                label=CONTEXT_EXPAND_LABEL,
                status="pass",
                reason="已经扩展到关联对象、pattern 或 conversation 证据链。",
                pass_criteria="能找到相关对象与证据链",
                evidence_refs=evidence_refs[:5],
                warnings=[],
            )
        if wiki_hits:
            return TraceStage(
                stage_id="context_expand",
                label=CONTEXT_EXPAND_LABEL,
                status="partial",
                reason="当前仍以单页命中为主，关联上下文扩展较弱。",
                pass_criteria="能找到相关对象与证据链",
                evidence_refs=evidence_refs[:3],
                warnings=[],
            )
        return TraceStage(
            stage_id="context_expand",
            label=CONTEXT_EXPAND_LABEL,
            status="fail",
            reason="尚未形成可用的关联对象或证据链扩展。",
            pass_criteria="能找到相关对象与证据链",
            evidence_refs=[],
            warnings=[],
        )

    def _build_quick_ontology_decision_stage(self, *, question_type: str, question: str) -> TraceStage:
        return TraceStage(
            stage_id="ontology_decision",
            label=ONTOLOGY_DECISION_LABEL,
            status="inactive",
            reason=f"Quick Answer 仍是单轮问答，没有显式 {question_type} 状态机来处理“{question}”。",
            pass_criteria="能从“知道”走到“判断”",
            evidence_refs=[],
            warnings=[],
        )

    def _build_extraction_ontology_decision_stage(
        self,
        *,
        compiled_problem: CompiledProblem,
        question_plan: QuestionPlan | None,
        stop_decision: StopDecision | None,
    ) -> TraceStage:
        if question_plan is not None and (question_plan.candidate_questions or question_plan.target_missing_slots):
            return TraceStage(
                stage_id="ontology_decision",
                label=ONTOLOGY_DECISION_LABEL,
                status="pass",
                reason=(
                    f"已基于 {compiled_problem.recommended_action} 生成缺槽收敛与下一问，"
                    f"stop_reason={stop_decision.reason if stop_decision is not None else 'continue'}。"
                ),
                pass_criteria="能从“知道”走到“判断”",
                evidence_refs=list(question_plan.target_missing_slots[:3]),
                warnings=[],
            )
        if stop_decision is not None:
            return TraceStage(
                stage_id="ontology_decision",
                label=ONTOLOGY_DECISION_LABEL,
                status="partial",
                reason=f"已有 stop decision={stop_decision.reason}，但下一问计划仍然较弱。",
                pass_criteria="能从“知道”走到“判断”",
                evidence_refs=[],
                warnings=[],
            )
        return TraceStage(
            stage_id="ontology_decision",
            label=ONTOLOGY_DECISION_LABEL,
            status="fail",
            reason="尚未形成明确的状态判断或动作选择。",
            pass_criteria="能从“知道”走到“判断”",
            evidence_refs=[],
            warnings=[],
        )

    def _build_skill_reuse_stage(self) -> TraceStage:
        return TraceStage(
            stage_id="skill_reuse",
            label=SKILL_REUSE_LABEL,
            status="inactive",
            reason="当前回答链路还没有命中 runtime skill 或稳定复用 procedure。",
            pass_criteria="同类任务表现明显更稳",
            evidence_refs=[],
            warnings=[],
        )

    def _build_top_hits(
        self,
        *,
        ranked: list[RankedPage],
        raw_evidence: list[EvidenceItem],
        gaps: list[ThinSourceGap],
    ) -> list[dict[str, object]]:
        hits: list[dict[str, object]] = []
        seen: set[str] = set()
        for item in ranked[:4]:
            if item.page.path in seen:
                continue
            seen.add(item.page.path)
            hits.append(
                {
                    "path": item.page.path,
                    "title": item.page.title,
                    "score": round(item.score, 4),
                    "snippet": self._ranked_snippet(item),
                }
            )
        for item in raw_evidence[:2]:
            if item.page_path in seen:
                continue
            seen.add(item.page_path)
            hits.append(
                {
                    "path": item.page_path,
                    "title": item.page_title,
                    "score": round(item.relevance_score, 4),
                    "snippet": item.snippet,
                }
            )
        for gap in gaps:
            if gap.raw_path in seen:
                continue
            seen.add(gap.raw_path)
            hits.append(
                {
                    "path": gap.raw_path,
                    "title": self._title_from_path(gap.raw_path),
                    "score": 0.75,
                    "snippet": gap.raw_snippet,
                }
            )
        return hits[:6]

    def _build_extraction_top_hits(
        self,
        retrieval_buckets: RetrievalBuckets,
        gaps: list[ThinSourceGap],
    ) -> list[dict[str, object]]:
        hits: list[dict[str, object]] = []
        seen: set[str] = set()
        for item in retrieval_buckets.object_pages[:3]:
            if item.path in seen:
                continue
            seen.add(item.path)
            hits.append(
                {
                    "path": item.path,
                    "title": item.title,
                    "score": round(item.score, 4),
                    "snippet": item.snippet,
                }
            )
        for item in retrieval_buckets.evidence_pages[:3]:
            if item.page_path in seen:
                continue
            seen.add(item.page_path)
            hits.append(
                {
                    "path": item.page_path,
                    "title": item.page_title,
                    "score": round(item.relevance_score, 4),
                    "snippet": item.snippet,
                }
            )
        for gap in gaps:
            if gap.raw_path in seen:
                continue
            seen.add(gap.raw_path)
            hits.append(
                {
                    "path": gap.raw_path,
                    "title": self._title_from_path(gap.raw_path),
                    "score": 0.75,
                    "snippet": gap.raw_snippet,
                }
            )
        return hits[:6]

    def _ranked_snippet(self, item: RankedPage) -> str:
        content = item.page.summary.strip() or item.body.strip()
        return content.splitlines()[0][:240] if content else item.page.title

    def _search_summary(self, *, wiki_hits: list[str], raw_hits: list[str], warnings: list[str]) -> str:
        hit_summary = []
        if wiki_hits:
            hit_summary.append("wiki hit")
        if raw_hits:
            hit_summary.append("raw support hit")
        if not hit_summary:
            hit_summary.append("no useful hit")
        if warnings:
            hit_summary.append("warning raised")
        return " + ".join(hit_summary)

    def _is_thin_source_page(self, wiki_body: str, raw_text: str) -> bool:
        wiki_lines = [line.strip() for line in wiki_body.splitlines() if line.strip()]
        raw_lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
        wiki_table_rows = sum(line.startswith("|") for line in wiki_lines)
        raw_table_rows = sum(line.startswith("|") for line in raw_lines)
        wiki_heading_count = sum(line.startswith("##") for line in wiki_lines)
        raw_heading_count = sum(line.startswith("##") for line in raw_lines)
        wiki_text = " ".join(
            line
            for line in wiki_lines
            if not line.startswith(("Source path:", "Source type:", "Logical source id:", "Checksum:"))
        )
        raw_text_flat = " ".join(raw_lines)
        has_summary_shell = "## Summary" in wiki_body and wiki_table_rows == 0 and wiki_heading_count <= 1
        raw_has_rich_structure = raw_table_rows >= 3 or raw_heading_count >= 1
        if has_summary_shell and raw_has_rich_structure:
            return True
        return (
            len(wiki_text) < 700
            and len(raw_text_flat) > max(200, int(len(wiki_text) * 1.1))
            and (raw_table_rows > wiki_table_rows or len(raw_lines) > max(8, len(wiki_lines) + 2))
        )

    def _extract_raw_snippet(self, raw_path: str, raw_text: str) -> str:
        for line in raw_text.splitlines():
            stripped = line.strip()
            if stripped.startswith("## "):
                return stripped.removeprefix("## ").strip()
        for line in raw_text.splitlines():
            stripped = line.strip()
            if stripped and not stripped.startswith("#"):
                return stripped[:240]
        return self._title_from_path(raw_path)

    def _title_from_path(self, path: str) -> str:
        return Path(path).stem

    def _unique(self, values: Iterable[str]) -> list[str]:
        seen: set[str] = set()
        ordered: list[str] = []
        for value in values:
            if not value or value in seen:
                continue
            seen.add(value)
            ordered.append(value)
        return ordered
