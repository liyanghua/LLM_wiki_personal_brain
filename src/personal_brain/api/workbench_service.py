from __future__ import annotations

import json
from pathlib import Path

from personal_brain.agent.method_profile import MethodProfileLoader
from personal_brain.assets.service import AssetBuildService
from personal_brain.config import BrainConfig
from personal_brain.eval.runner import EvaluationRunner
from personal_brain.extraction.service import ExtractionInterviewService
from personal_brain.models import EvaluationReport, OntologyCandidate, SessionRecord, SkillCandidateManifest, WritebackBundle
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
        question = str((payload or {}).get("question", "")).strip()
        scene_id_raw = (payload or {}).get("scene_id")
        scene_id = str(scene_id_raw).strip() or None if scene_id_raw is not None else None
        if not question:
            raise ApiBadRequest("question is required")
        return self.extraction_service.start(question, scene_id=scene_id).model_dump(mode="json")

    def get_extraction_interview(self, interview_id: str) -> dict:
        return self.extraction_service.get(interview_id).model_dump(mode="json")

    def continue_extraction_interview(self, interview_id: str, payload: dict | None = None) -> dict:
        user_answer = str((payload or {}).get("user_answer", "")).strip()
        if not user_answer:
            raise ApiBadRequest("user_answer is required")
        return self.extraction_service.continue_interview(interview_id, user_answer).model_dump(mode="json")

    def finish_extraction_interview(self, interview_id: str) -> dict:
        return self.extraction_service.finish(interview_id).model_dump(mode="json")

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
