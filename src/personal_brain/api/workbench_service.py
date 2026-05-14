from __future__ import annotations

import json
from pathlib import Path

from personal_brain.agent.method_profile import MethodProfileLoader
from personal_brain.assets.service import AssetBuildService
from personal_brain.config import BrainConfig
from personal_brain.eval.runner import EvaluationRunner
from personal_brain.extraction.service import ExtractionInterviewService
from personal_brain.models import EvaluationReport, OntologyCandidate, SessionRecord, SkillCandidateManifest, WritebackBundle
from personal_brain.models import ExtractionInterviewState
from personal_brain.retrieval.query_engine import QueryEngine
from personal_brain.utils.files import read_json
from personal_brain.writeback.service import WritebackService


class ApiBadRequest(ValueError):
    """Raised when an API payload is missing required fields."""


class ApiNotFound(FileNotFoundError):
    """Raised when an API resource cannot be located."""


class WorkbenchApiService:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.paths = config.paths
        self.query_engine = QueryEngine(config)
        self.writeback_service = WritebackService(config)
        self.asset_service = AssetBuildService(config)
        self.extraction_service = ExtractionInterviewService(config)

    def ask(self, payload: dict | None = None) -> dict:
        question = str((payload or {}).get("question", "")).strip()
        if not question:
            raise ApiBadRequest("question is required")
        return self.query_engine.ask(question).model_dump(mode="json")

    def start_extraction_interview(self, payload: dict | None = None) -> dict:
        payload = payload or {}
        topic = str(payload.get("topic", "")).strip()
        goal = str(payload.get("goal", "")).strip()
        question = str(payload.get("question", "")).strip()
        if not question and topic:
            question = f"{topic}：{goal}" if goal else topic
        scene_id_raw = (payload or {}).get("scene_id")
        scene_id = str(scene_id_raw).strip() or None if scene_id_raw is not None else None
        session_seed = {
            "title": str(payload.get("title", "")).strip() or topic,
            "topic_type": str(payload.get("topic_type", "")).strip(),
            "target_object": str(payload.get("target_object", "")).strip() or topic,
            "goal": goal,
            "created_by": str(payload.get("created_by", "")).strip(),
            "mapped_stage": str(payload.get("mapped_stage", "")).strip(),
            "mapped_step": str(payload.get("mapped_step", "")).strip(),
            "anchor_mode": str(payload.get("anchor_mode", "")).strip() or "sop_bundle",
            "anchor_bundle_id": str(payload.get("anchor_bundle_id", "")).strip() or "sop_mainline_001",
        }
        if not question:
            raise ApiBadRequest("question is required")
        return self._serialize_extraction_state(
            self.extraction_service.start(question, scene_id=scene_id, session_seed=session_seed)
        )

    def get_extraction_interview(self, interview_id: str) -> dict:
        return self._serialize_extraction_state(self.extraction_service.get(interview_id))

    def continue_extraction_interview(self, interview_id: str, payload: dict | None = None) -> dict:
        payload = payload or {}
        turn_action = str(payload.get("turn_action", "answer")).strip() or "answer"
        user_answer = str(payload.get("user_answer", "")).strip()
        if turn_action == "answer" and not user_answer:
            raise ApiBadRequest("user_answer is required")
        if turn_action == "skip":
            return self._serialize_extraction_state(self.extraction_service.skip_interview(interview_id))
        if turn_action == "summarize":
            return self._serialize_extraction_state(self.extraction_service.summarize_interview(interview_id))
        if turn_action != "answer":
            raise ApiBadRequest(f"unsupported turn_action: {turn_action}")
        return self._serialize_extraction_state(self.extraction_service.continue_interview(interview_id, user_answer))

    def finish_extraction_interview(self, interview_id: str) -> dict:
        return self._serialize_extraction_state(self.extraction_service.finish(interview_id))

    def update_extraction_candidate_asset(self, interview_id: str, asset_id: str, payload: dict | None = None) -> dict:
        return self._serialize_extraction_state(
            self.extraction_service.update_candidate_asset(interview_id, asset_id, payload)
        )

    def _serialize_extraction_state(self, state: ExtractionInterviewState) -> dict:
        payload = state.model_dump(mode="json")
        payload["interview_view"] = self._build_interview_view(state)
        payload["autosave_state"] = {
            "saved": bool(state.state_path),
            "state_path": state.state_path or "",
            "updated_at": state.updated_at or "",
            "status": "saved" if state.state_path else "pending",
        }
        payload["degraded_retrieval_mode"] = self._build_degraded_retrieval_mode(state)
        return payload

    def _build_interview_view(self, state: ExtractionInterviewState) -> dict:
        candidate_questions = list(state.next_question_plan.candidate_questions if state.next_question_plan else [])
        followup_questions = [
            item.question_text
            for item in state.followup_questions
            if item.status in {"selected", "open", "pending"}
        ]
        recommended_followups = list(dict.fromkeys([*candidate_questions, *followup_questions]))[:4]
        current_prompt = recommended_followups[0] if recommended_followups else ""
        if state.status == "completed":
            current_prompt = "访谈已完成，可以查看本次总结与候选资产。"
        elif not current_prompt:
            current_prompt = "请继续补充这个主题里最关键的判断、条件或反例。"

        return {
            "current_prompt": current_prompt,
            "prompt_type_label": self._prompt_type_label(
                state.next_question_plan.next_question_type if state.next_question_plan else state.question_type
            ),
            "phase_label": self._phase_label(state),
            "recommended_followups": recommended_followups,
            "structure_counts": self._structure_counts(state),
            "answer_frame": self._build_answer_frame(state),
            "can_skip": state.status != "completed",
            "can_summarize": state.status != "completed",
            "autosave_state": "saved" if state.state_path else "pending",
        }

    def _prompt_type_label(self, question_type: str) -> str:
        labels = {
            "definition": "当前在问：定义澄清",
            "judgement": "当前在问：判断逻辑",
            "condition": "当前在问：适用条件",
            "counterexample": "当前在问：反例",
            "boundary": "当前在问：边界/例外",
            "evidence": "当前在问：证据依据",
            "slot-fill": "当前在问：关键缺口",
            "clarification": "当前在问：澄清补充",
            "stop": "当前在做：收束总结",
        }
        return labels.get(question_type, "当前在问：知识榨取")

    def _phase_label(self, state: ExtractionInterviewState) -> str:
        if state.status == "completed":
            return "已完成"
        if state.current_stage:
            return f"正在围绕 {state.current_stage} 推进"
        if state.turn_index <= 1:
            return "正在建立主题"
        if any(asset.status == "needs_clarification" for asset in state.candidate_assets):
            return "正在补边界条件"
        return "正在抽取判断逻辑"

    def _structure_counts(self, state: ExtractionInterviewState) -> dict[str, int]:
        counts = {"concepts": 0, "heuristics": 0, "cases": 0, "boundaries": 0}
        for asset in state.candidate_assets:
            if asset.status == "rejected":
                continue
            if asset.asset_type == "concept":
                counts["concepts"] += 1
            elif asset.asset_type == "heuristic":
                counts["heuristics"] += 1
            elif asset.asset_type == "case":
                counts["cases"] += 1
            elif asset.asset_type == "boundary":
                counts["boundaries"] += 1
        return counts

    def _build_answer_frame(self, state: ExtractionInterviewState) -> dict:
        mainline_steps = [
            asset.title
            for asset in state.candidate_assets
            if asset.card_group == "mainline_step" and asset.status != "rejected"
        ]
        key_judgements = [
            asset.title
            for asset in state.candidate_assets
            if asset.card_group == "judgement" and asset.status != "rejected"
        ]
        evidence_refs: list[str] = []
        for asset in state.candidate_assets:
            if asset.card_group == "evidence" and asset.status != "rejected":
                evidence_refs.extend(asset.evidence_refs)
        if not evidence_refs:
            for block in state.answer_grounding_blocks[:4]:
                evidence_refs.extend(block.refs)
        return {
            "primary_answer": state.current_answer_summary or "",
            "mainline_steps": list(dict.fromkeys(mainline_steps)),
            "key_judgements": list(dict.fromkeys(key_judgements)),
            "evidence_refs": list(dict.fromkeys(ref for ref in evidence_refs if ref)),
        }

    def _build_degraded_retrieval_mode(self, state: ExtractionInterviewState) -> dict:
        buckets = state.retrieval_buckets
        backend = buckets.retrieval_backend if buckets else "legacy"
        expected = self.config.search_backend
        active = expected == "qmd" and backend != "qmd"
        return {
            "active": active,
            "configured_backend": expected,
            "actual_backend": backend,
            "reason": "qmd unavailable or returned no mappable hits" if active else "",
        }

    def recent_memory(self) -> dict:
        session_records = self._load_session_records()
        recent = [
            {
                "query_id": record.query_id,
                "question": record.user_query,
                "question_type": record.question_classification.question_type,
                "summary": record.answer_summary,
                "created_at": record.created_at,
            }
            for record in session_records[:5]
        ]
        return {
            "recent_queries": recent,
            "recent_session_summaries": [record.answer_summary for record in session_records[:5]],
            "persistent_interests": read_json(self.paths.persistent_interests, default=[]),
            "persistent_principles": read_json(self.paths.persistent_principles, default=[]),
            "open_loops": read_json(self.paths.persistent_open_loops, default=[]),
        }

    def list_writeback_proposals(self) -> dict:
        proposals = [
            self._summarize_bundle(WritebackBundle.model_validate_json(path.read_text(encoding="utf-8")))
            for path in sorted(self.paths.writeback_dir.glob("*.json"), reverse=True)
        ]
        return {"proposals": proposals}

    def get_writeback_proposal(self, query_id: str) -> dict:
        path = self.paths.writeback_dir / f"{query_id}.json"
        if not path.exists():
            raise ApiNotFound(f"writeback proposal not found: {query_id}")
        return WritebackBundle.model_validate_json(path.read_text(encoding="utf-8")).model_dump(mode="json")

    def apply_writeback(self, query_id: str) -> dict:
        return self.writeback_service.create_proposal(query_id, apply=True).model_dump(mode="json")

    def list_ontology_candidates(self) -> dict:
        candidates = self._load_ontology_candidates()
        if not candidates:
            self.asset_service.build()
            candidates = self._load_ontology_candidates()
        return {"candidates": [candidate.model_dump(mode="json") for candidate in candidates]}

    def list_skill_candidates(self) -> dict:
        manifests = self._load_skill_candidates()
        if not manifests:
            self.asset_service.build()
            manifests = self._load_skill_candidates()
        return {"candidates": [manifest.model_dump(mode="json") for manifest in manifests]}

    def get_method_profile(self) -> dict:
        return MethodProfileLoader(self.config).load().model_dump(mode="json")

    def get_persistent_memory(self) -> dict:
        return {
            "profile": self.get_method_profile(),
            "interests": read_json(self.paths.persistent_interests, default=[]),
            "principles": read_json(self.paths.persistent_principles, default=[]),
            "open_loops": read_json(self.paths.persistent_open_loops, default=[]),
        }

    def get_profile_proposals(self) -> dict:
        session_records = self._load_session_records()
        method_suggestions = []
        style_suggestions = []
        persistent_memory_proposals = []
        for record in session_records[:10]:
            for suggestion in record.method_update_suggestions:
                method_suggestions.append(
                    {
                        "query_id": record.query_id,
                        "field_name": suggestion.field_name,
                        "current_value": suggestion.current_value,
                        "suggested_value": suggestion.suggested_value,
                        "rationale": suggestion.rationale,
                    }
                )
            for suggestion in record.style_update_suggestions:
                style_suggestions.append(
                    {
                        "query_id": record.query_id,
                        "rationale": suggestion,
                    }
                )
            for proposal in record.persistent_memory_proposals:
                persistent_memory_proposals.append(
                    {
                        "query_id": record.query_id,
                        **proposal.model_dump(mode="json"),
                    }
                )
        return {
            "method_suggestions": method_suggestions,
            "style_suggestions": style_suggestions,
            "persistent_memory_proposals": persistent_memory_proposals,
        }

    def list_eval_reports(self) -> dict:
        reports = []
        for path in sorted(self.paths.eval_reports.glob("*.json"), reverse=True):
            report = EvaluationReport.model_validate_json(path.read_text(encoding="utf-8"))
            reports.append(
                {
                    "run_id": report.run_id,
                    "created_at": report.created_at,
                    "metrics": report.metrics,
                    "report_path_json": report.report_path_json,
                    "report_path_markdown": report.report_path_markdown,
                }
            )
        if not reports:
            report = EvaluationRunner(self.config).run()
            return self.list_eval_reports() if report else {"reports": []}
        return {"reports": reports}

    def get_eval_report(self, run_id: str) -> dict:
        path = self.paths.eval_reports / f"{run_id}.json"
        if not path.exists():
            raise ApiNotFound(f"eval report not found: {run_id}")
        return EvaluationReport.model_validate_json(path.read_text(encoding="utf-8")).model_dump(mode="json")

    def list_wiki_pages(self) -> dict:
        pages = []
        backlinks = self._backlinks()
        for candidate in self.query_engine.load_candidates():
            page = candidate.page
            pages.append(
                {
                    **page.model_dump(mode="json"),
                    "backlinks": backlinks.get(page.path, []),
                }
            )
        pages.sort(key=lambda item: (item["page_type"], item["title"]))
        return {"pages": pages}

    def get_wiki_tree(self) -> dict:
        pages = self.list_wiki_pages()["pages"]
        grouped: dict[str, list[dict]] = {}
        for page in pages:
            grouped.setdefault(page["page_type"], []).append(
                {
                    "page_id": page["page_id"],
                    "title": page["title"],
                    "path": page["path"],
                }
            )
        tree = [
            {"page_type": page_type, "count": len(items), "pages": items}
            for page_type, items in sorted(grouped.items())
        ]
        return {"tree": tree}

    def get_wiki_page(self, identifier: str) -> dict:
        backlinks = self._backlinks()
        linked_titles = {page.page.path: page.page.title for page in self.query_engine.load_candidates()}
        for candidate in self.query_engine.load_candidates():
            page = candidate.page
            if identifier in {page.page_id, page.path}:
                return {
                    "page": {
                        **page.model_dump(mode="json"),
                        "backlinks": backlinks.get(page.path, []),
                        "linked_pages": [
                            {"path": path, "title": linked_titles.get(path, path)}
                            for path in page.links_to
                        ],
                        "markdown": candidate.body,
                    }
                }
        raise ApiNotFound(f"wiki page not found: {identifier}")

    def _load_session_records(self) -> list[SessionRecord]:
        records = []
        for path in sorted((self.paths.memory / "session").glob("20??-??-??/*.json"), reverse=True):
            records.append(SessionRecord.model_validate_json(path.read_text(encoding="utf-8")))
        records.sort(key=lambda item: item.created_at, reverse=True)
        return records

    def _load_ontology_candidates(self) -> list[OntologyCandidate]:
        index_path = self.paths.ontology_candidates / "index.json"
        if not index_path.exists():
            return []
        payload = json.loads(index_path.read_text(encoding="utf-8"))
        return [OntologyCandidate.model_validate(item) for item in payload]

    def _load_skill_candidates(self) -> list[SkillCandidateManifest]:
        index_path = self.paths.skills_candidates / "index.json"
        if not index_path.exists():
            return []
        payload = json.loads(index_path.read_text(encoding="utf-8"))
        return [SkillCandidateManifest.model_validate(item) for item in payload]

    def _backlinks(self) -> dict[str, list[str]]:
        backlinks: dict[str, list[str]] = {}
        for candidate in self.query_engine.load_candidates():
            for linked in candidate.page.links_to:
                backlinks.setdefault(linked, []).append(candidate.page.path)
        return backlinks

    def _summarize_bundle(self, bundle: WritebackBundle) -> dict:
        top_target = bundle.targets[0] if bundle.targets else None
        return {
            "query_id": bundle.query_id,
            "question": bundle.question,
            "created_at": bundle.created_at,
            "targets": bundle.target_paths,
            "primary_target": top_target.target if top_target else None,
            "primary_status": top_target.approval_status if top_target else "pending",
            "primary_confidence": top_target.confidence if top_target else 0.0,
        }
