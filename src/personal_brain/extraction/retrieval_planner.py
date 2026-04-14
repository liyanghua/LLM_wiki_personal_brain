from __future__ import annotations

from personal_brain.agent.memory_recall import MemoryRecall
from personal_brain.config import BrainConfig
from personal_brain.models import CompiledProblem, ExtractionInterviewState, RetrievalBuckets, RetrievalHit
from personal_brain.retrieval.evidence_selector import EvidenceSelector
from personal_brain.retrieval.page_ranker import PageRanker
from personal_brain.retrieval.query_engine import QueryEngine


class RetrievalPlanner:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.query_engine = QueryEngine(config)
        self.page_ranker = PageRanker()
        self.evidence_selector = EvidenceSelector()
        self.memory_recall = MemoryRecall(config)

    def plan(
        self,
        problem: CompiledProblem,
        state: ExtractionInterviewState | None = None,
    ) -> RetrievalBuckets:
        query = f"{problem.current_object} {problem.current_knowledge_goal}".strip()
        candidates = self.query_engine.load_candidates()
        ranked = self.page_ranker.rank(query, candidates, problem.question_type)
        object_pages = [
            self._page_hit(item.page.title, item.page.path, item.page.summary, item.score, item.page.source_refs)
            for item in ranked[:5]
            if problem.current_object in item.page.title or item.score > 0
        ][:3]
        evidence = self.evidence_selector.select(ranked, limit=3)
        conversation_hits = self._conversation_hits(state, query)
        pattern_hits = self._pattern_hits(ranked, query)
        return RetrievalBuckets(
            object_pages=object_pages,
            evidence_pages=evidence,
            conversation_hits=conversation_hits,
            pattern_hits=pattern_hits,
            ranked_page_paths=[item.page.path for item in ranked[:5] if item.score > 0],
            retrieved_sources=list(dict.fromkeys(source for item in evidence for source in item.source_refs)),
        )

    def _conversation_hits(self, state: ExtractionInterviewState | None, query: str) -> list[RetrievalHit]:
        hits: list[RetrievalHit] = []
        if state is not None:
            for turn in state.turns[-3:]:
                text = turn.answer_summary or turn.user_input
                if text:
                    hits.append(
                        RetrievalHit(
                            title=f"Interview turn {turn.turn_index}",
                            path=f"interview:{state.interview_id}#turn-{turn.turn_index}",
                            snippet=text,
                            score=1.0,
                        )
                    )
        recalled = self.memory_recall.recall(query)
        for idx, summary in enumerate(recalled.recent_session_summaries[:2], start=1):
            hits.append(
                RetrievalHit(
                    title=f"Recent session summary {idx}",
                    path=f"memory:recent-session-{idx}",
                    snippet=summary,
                    score=0.7,
                )
            )
        return hits

    def _pattern_hits(self, ranked, query: str) -> list[RetrievalHit]:
        hits: list[RetrievalHit] = []
        recalled = self.memory_recall.recall(query)
        for idx, principle in enumerate(recalled.persistent_principles[:3], start=1):
            hits.append(
                RetrievalHit(
                    title=f"Persistent principle {idx}",
                    path=f"memory:persistent-principle-{idx}",
                    snippet=principle,
                    score=0.8,
                )
            )
        for item in ranked:
            if "/principles/" in item.page.path or "/decisions/" in item.page.path:
                hits.append(
                    self._page_hit(item.page.title, item.page.path, item.page.summary, item.score, item.page.source_refs)
                )
            if len(hits) >= 3:
                break
        return hits

    def _page_hit(
        self,
        title: str,
        path: str,
        snippet: str,
        score: float,
        source_refs: list[str],
    ) -> RetrievalHit:
        return RetrievalHit(
            title=title,
            path=path,
            snippet=snippet,
            score=score,
            source_refs=source_refs,
        )
