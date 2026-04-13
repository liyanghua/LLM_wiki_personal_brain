from __future__ import annotations

from datetime import UTC, datetime

from personal_brain.agent.memory_policy import MemoryPolicy
from personal_brain.agent.memory_recall import MemoryRecall
from personal_brain.agent.method_profile import MethodProfileLoader
from personal_brain.agent.method_reflector import MethodReflector
from personal_brain.agent.session_manager import SessionManager
from personal_brain.agent.style_engine import StyleEngine
from personal_brain.agent.template_selector import TemplateSelector
from personal_brain.config import BrainConfig
from personal_brain.models import (
    AnswerRecord,
    AskResult,
    AssetValueSignals,
    MethodSuggestion,
    PageCandidate,
    SessionRecord,
    WikiPage,
)
from personal_brain.retrieval.answer_composer import AnswerComposer
from personal_brain.retrieval.answer_planner import AnswerPlanner
from personal_brain.retrieval.evidence_selector import EvidenceSelector
from personal_brain.retrieval.page_ranker import PageRanker
from personal_brain.retrieval.question_classifier import QuestionClassifier
from personal_brain.utils.files import append_jsonl, iso_date, utc_now
from personal_brain.utils.frontmatter import parse_frontmatter
from personal_brain.utils.text import overlap_score
from personal_brain.writeback.router import WritebackContext, WritebackRouter


class QueryEngine:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.paths = config.paths
        self.classifier = QuestionClassifier()
        self.page_ranker = PageRanker()
        self.evidence_selector = EvidenceSelector()
        self.answer_planner = AnswerPlanner()
        self.answer_composer = AnswerComposer()
        self.memory_recall = MemoryRecall(config)
        self.memory_policy = MemoryPolicy()
        self.session_manager = SessionManager(config)
        self.profile_loader = MethodProfileLoader(config)
        self.method_reflector = MethodReflector()
        self.template_selector = TemplateSelector()
        self.style_engine = StyleEngine()
        self.writeback_router = WritebackRouter()

    def ask(self, question: str) -> AskResult:
        classification = self.classifier.classify(question)
        recalled_memory = self.memory_recall.recall(question)
        candidates = self._retrieve_candidates(question)
        ranked = self.page_ranker.rank(question, candidates, classification.question_type)
        selected_evidence = self.evidence_selector.select(ranked, limit=3)
        plan = self.answer_planner.plan(question, classification.question_type, selected_evidence, recalled_memory)

        profile = self.profile_loader.load()
        template = self.template_selector.select(classification.question_type, profile)
        sections, answer_summary = self.answer_composer.compose(
            plan,
            selected_evidence,
            recalled_memory,
            template=template,
        )
        method_suggestions = self.method_reflector.suggest(profile, question, template, sections)
        style_suggestions = [suggestion.rationale for suggestion in method_suggestions] or ["当前方法配置与答案结构基本一致，无需自动更新。"]
        answer_markdown = self.style_engine.render(question, sections, selected_evidence, profile, template=template)

        created_at = utc_now()
        query_id = datetime.now(UTC).strftime("%Y%m%d-%H%M%S-%f")
        answer_path = self.paths.answers_dir / f"{query_id}.md"
        answer_path.write_text(answer_markdown, encoding="utf-8")

        ranked_page_paths = [item.page.path for item in ranked[:5] if item.score > 0]
        retrieved_pages = [item.page_path for item in selected_evidence]
        retrieved_sources = list(dict.fromkeys(source for item in selected_evidence for source in item.source_refs))
        asset_value_signals = self._score_asset_value(
            selected_evidence=selected_evidence,
            ranked_page_paths=ranked_page_paths,
            retrieved_sources=retrieved_sources,
            recalled_memory=recalled_memory,
            open_follow_ups=plan.open_follow_ups,
        )
        writeback_plan = self.writeback_router.route(
            WritebackContext(
                query_id=query_id,
                question=question,
                question_type=classification.question_type,
                answer_summary=answer_summary,
                retrieved_pages=ranked_page_paths or retrieved_pages,
                evidence_refs=retrieved_sources,
                asset_value_score=asset_value_signals.overall_score,
            )
        )
        writeback_targets = [target.target for target in writeback_plan.targets]
        persistent_memory_proposals = self.memory_policy.propose(
            user_query=question,
            answer_summary=answer_summary,
            retrieved_pages=retrieved_pages,
            recalled_memory=recalled_memory,
            open_follow_ups=plan.open_follow_ups,
        )

        session_record = SessionRecord(
            query_id=query_id,
            session_date=iso_date(created_at),
            user_query=question,
            question_classification=classification,
            recalled_memory=recalled_memory,
            ranked_pages=ranked_page_paths,
            selected_evidence=selected_evidence,
            answer_summary=answer_summary,
            open_follow_ups=plan.open_follow_ups,
            method_profile_id=profile.method_profile_id,
            template_id=template.template_id,
            writeback_plan=writeback_plan,
            asset_value_signals=asset_value_signals,
            writeback_proposed=any(target.approval_status != "rejected" for target in writeback_plan.targets),
            writeback_targets=writeback_targets,
            persistent_memory_proposals=persistent_memory_proposals,
            method_update_suggestions=method_suggestions,
            style_update_suggestions=style_suggestions,
            style_profile_id=profile.method_profile_id,
            answer_path=str(answer_path.relative_to(self.config.root)),
            created_at=created_at,
        )
        session_record_path = self.session_manager.write(session_record)

        record = AnswerRecord(
            query_id=query_id,
            user_query=question,
            question_classification=classification,
            ranked_pages=ranked_page_paths,
            retrieved_pages=retrieved_pages,
            retrieved_sources=retrieved_sources,
            selected_evidence=selected_evidence,
            answer_path=str(answer_path.relative_to(self.config.root)),
            session_record_path=session_record_path,
            method_profile_id=profile.method_profile_id,
            template_id=template.template_id,
            writeback_plan=writeback_plan,
            asset_value_signals=asset_value_signals,
            style_profile_id=profile.method_profile_id,
            writeback_proposed=any(target.approval_status != "rejected" for target in writeback_plan.targets),
            writeback_targets=writeback_targets,
            persistent_memory_proposals=persistent_memory_proposals,
            created_at=created_at,
        )
        append_jsonl(self.paths.answer_records, record)
        self._append_log(question, retrieved_pages)
        return AskResult(
            query_id=query_id,
            user_query=question,
            question_classification=classification,
            answer_markdown=answer_markdown,
            ranked_pages=ranked_page_paths,
            retrieved_pages=retrieved_pages,
            retrieved_sources=retrieved_sources,
            selected_evidence=selected_evidence,
            recalled_memory=recalled_memory,
            open_follow_ups=plan.open_follow_ups,
            answer_path=str(answer_path.relative_to(self.config.root)),
            session_record_path=session_record_path,
            method_profile_id=profile.method_profile_id,
            template_id=template.template_id,
            writeback_plan=writeback_plan,
            asset_value_signals=asset_value_signals,
            style_profile_id=profile.method_profile_id,
            writeback_proposed=any(target.approval_status != "rejected" for target in writeback_plan.targets),
            writeback_targets=writeback_targets,
            persistent_memory_proposals=persistent_memory_proposals,
            method_update_suggestions=method_suggestions,
            style_update_suggestions=style_suggestions,
            applied_memory_writes=[],
            created_at=created_at,
        )

    def load_candidates(self) -> list[PageCandidate]:
        candidates: list[PageCandidate] = []
        for relative in self._load_candidates_from_index():
            page = self._load_page(relative)
            if page is not None:
                candidates.append(page)
        return candidates

    def search_wiki(self, query: str) -> list[dict]:
        classification = self.classifier.classify(query)
        ranked = self.page_ranker.rank(query, self._retrieve_candidates(query), classification.question_type)
        return [
            {
                "page_id": item.page.page_id,
                "title": item.page.title,
                "path": item.page.path,
                "summary": item.page.summary,
                "score": item.score,
            }
            for item in ranked[:5]
        ]

    def read_page(self, page_id: str) -> dict:
        for candidate in self.load_candidates():
            if candidate.page.page_id == page_id or candidate.page.path == page_id:
                return {
                    "page_id": candidate.page.page_id,
                    "title": candidate.page.title,
                    "path": candidate.page.path,
                    "summary": candidate.page.summary,
                    "source_refs": candidate.page.source_refs,
                    "body": candidate.body,
                }
        raise FileNotFoundError(f"Page not found: {page_id}")

    def _retrieve_candidates(self, question: str) -> list[PageCandidate]:
        candidates = self.load_candidates()
        seed_scores: list[tuple[int, PageCandidate]] = []
        for candidate in candidates:
            seed = overlap_score(question, f"{candidate.page.title} {candidate.page.summary}")
            seed_scores.append((seed, candidate))
        seed_scores.sort(key=lambda item: item[0], reverse=True)
        chosen = {candidate.page.path: candidate for _, candidate in seed_scores[:5]}
        by_path = {candidate.page.path: candidate for candidate in candidates}
        for _, candidate in seed_scores[:5]:
            for linked in candidate.page.links_to:
                if linked in by_path:
                    chosen[linked] = by_path[linked]
        return list(chosen.values()) if chosen else candidates

    def _load_page(self, relative: str) -> PageCandidate | None:
        path = self.paths.wiki / relative
        if not path.exists():
            return None
        metadata, body = parse_frontmatter(path.read_text(encoding="utf-8"))
        if not metadata:
            return None
        try:
            metadata["path"] = str(path.resolve().relative_to(self.config.root.resolve()))
        except ValueError:
            metadata["path"] = str(path.relative_to(self.paths.wiki.parent))
        page = WikiPage.model_validate(metadata)
        return PageCandidate(page=page, body=body)

    def _append_log(self, question: str, retrieved_pages: list[str]) -> None:
        entry = f"## [{utc_now()}] ask | {question} | pages={len(retrieved_pages)}\n"
        previous = self.paths.wiki_log.read_text(encoding="utf-8") if self.paths.wiki_log.exists() else "# Wiki Log\n\n"
        self.paths.wiki_log.write_text(previous + entry, encoding="utf-8")

    def _load_candidates_from_index(self) -> list[str]:
        if not self.paths.wiki_index.exists():
            return []
        candidates: list[str] = []
        for line in self.paths.wiki_index.read_text(encoding="utf-8").splitlines():
            if "](" not in line:
                continue
            try:
                relative = line.split("](", 1)[1].split(")", 1)[0]
            except IndexError:
                continue
            if relative.endswith(".md"):
                candidates.append(relative)
        return candidates

    def _score_asset_value(
        self,
        *,
        selected_evidence,
        ranked_page_paths: list[str],
        retrieved_sources: list[str],
        recalled_memory,
        open_follow_ups: list[str],
    ) -> AssetValueSignals:
        page_types = {path.split("/", 2)[1] for path in ranked_page_paths if "/" in path}
        evidence_score = min(0.35, len(selected_evidence) * 0.12)
        source_score = min(0.25, len(retrieved_sources) * 0.08)
        diversity_score = 0.2 if len(page_types) >= 2 else 0.1 if page_types else 0.0
        recurrence_score = 0.1 if recalled_memory.recent_session_summaries else 0.0
        follow_up_score = 0.1 if open_follow_ups else 0.0
        overall = min(1.0, evidence_score + source_score + diversity_score + recurrence_score + follow_up_score)
        reasons = []
        if len(selected_evidence) >= 2:
            reasons.append("multi-page evidence")
        if len(retrieved_sources) >= 2:
            reasons.append("multi-source grounding")
        if len(page_types) >= 2:
            reasons.append("cross-page-type synthesis")
        if recalled_memory.recent_session_summaries:
            reasons.append("recent recurrence")
        if open_follow_ups:
            reasons.append("follow-up potential")
        return AssetValueSignals(
            overall_score=overall,
            reasons=reasons,
            signals={
                "evidence_density": evidence_score,
                "source_grounding": source_score,
                "page_diversity": diversity_score,
                "recent_recurrence": recurrence_score,
                "follow_up_depth": follow_up_score,
            },
        )
