from __future__ import annotations

from pathlib import Path

from personal_brain.agent.memory_policy import MemoryPolicy
from personal_brain.agent.memory_recall import MemoryRecall
from personal_brain.agent.session_manager import SessionManager
from personal_brain.agent.style_engine import StyleEngine
from personal_brain.agent.style_profile_loader import StyleProfileLoader
from personal_brain.agent.style_reflector import StyleReflector
from personal_brain.config import BrainConfig
from personal_brain.models import (
    AnswerRecord,
    AskResult,
    EvidenceItem,
    MemoryRecallBundle,
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
from personal_brain.utils.text import overlap_score, slugify_title, summarize_text


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
        self.style_loader = StyleProfileLoader(config)
        self.style_engine = StyleEngine()
        self.style_reflector = StyleReflector()

    def ask(self, question: str) -> AskResult:
        classification = self.classifier.classify(question)
        recalled_memory = self.memory_recall.recall(question)
        candidates = self._retrieve_candidates(question)
        ranked = self.page_ranker.rank(question, candidates, classification.question_type)
        selected_evidence = self.evidence_selector.select(ranked, limit=3)
        plan = self.answer_planner.plan(question, classification.question_type, selected_evidence, recalled_memory)
        sections, answer_summary = self.answer_composer.compose(plan, selected_evidence, recalled_memory)
        profile = self.style_loader.load()
        style_suggestions = self.style_reflector.suggest(profile, question, sections)
        answer_markdown = self.style_engine.render(question, sections, selected_evidence, profile)

        created_at = utc_now()
        query_id = created_at.replace("-", "").replace(":", "").replace("T", "-").replace("Z", "")
        answer_path = self.paths.answers_dir / f"{query_id}.md"
        answer_path.write_text(answer_markdown, encoding="utf-8")

        ranked_page_paths = [item.page.path for item in ranked[:5] if item.score > 0]
        retrieved_pages = [item.page_path for item in selected_evidence]
        retrieved_sources = list(dict.fromkeys(source for item in selected_evidence for source in item.source_refs))
        writeback_targets = self._proposed_writeback_targets(question, retrieved_pages)
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
            writeback_proposed=bool(writeback_targets),
            writeback_targets=writeback_targets,
            persistent_memory_proposals=persistent_memory_proposals,
            style_update_suggestions=style_suggestions,
            style_profile_id=profile.profile_id,
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
            style_profile_id=profile.profile_id,
            writeback_proposed=bool(writeback_targets),
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
            style_profile_id=profile.profile_id,
            writeback_proposed=bool(writeback_targets),
            writeback_targets=writeback_targets,
            persistent_memory_proposals=persistent_memory_proposals,
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
        metadata["path"] = str(path.relative_to(self.config.root))
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

    def _proposed_writeback_targets(self, question: str, retrieved_pages: list[str]) -> list[str]:
        if not retrieved_pages:
            return []
        stem = slugify_title(question or Path(retrieved_pages[0]).stem)
        return [f"wiki/decisions/{stem}-qa-note.md"]
