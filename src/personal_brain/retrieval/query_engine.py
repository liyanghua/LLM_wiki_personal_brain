from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from personal_brain.agent.memory_policy import MemoryPolicy
from personal_brain.agent.memory_recall import MemoryRecall
from personal_brain.agent.method_profile import MethodProfileLoader
from personal_brain.agent.method_reflector import MethodReflector
from personal_brain.agent.session_manager import SessionManager
from personal_brain.agent.style_engine import StyleEngine
from personal_brain.agent.template_selector import TemplateSelector
from personal_brain.agent.trace_builder import AgentTraceBuilder
from personal_brain.config import BrainConfig
from personal_brain.ingestion.service import IngestionService
from personal_brain.models import (
    AnswerRecord,
    AnswerGroundingBlock,
    AskResult,
    AssetValueSignals,
    EvidenceItem,
    PageCandidate,
    RankedPage,
    SearchHit,
    ProcessContext,
    SearchTrace,
    SessionRecord,
)
from personal_brain.retrieval.answer_composer import AnswerComposer
from personal_brain.retrieval.answer_planner import AnswerPlanner
from personal_brain.retrieval.evidence_selector import EvidenceSelector
from personal_brain.retrieval.page_ranker import PageRanker
from personal_brain.retrieval.question_classifier import QuestionClassifier
from personal_brain.retrieval.search_provider import (
    LegacyWikiSearchProvider,
    SearchBackendUnavailable,
    build_search_provider,
)
from personal_brain.retrieval.wiki_page_store import WikiPageStore
from personal_brain.utils.files import append_jsonl, iso_date, utc_now
from personal_brain.writeback.router import WritebackContext, WritebackRouter


class QueryEngine:
    SOP_BUNDLE_ID = "sop_mainline_001"
    SOP_ANCHOR_PATHS = [
        "raw/industry_docs/主干链路SOP.md",
        "raw/industry_docs/主干链路SOP.graph.json",
        "raw/industry_docs/主干链路SOP.meta.yaml",
    ]

    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.paths = config.paths
        self.classifier = QuestionClassifier()
        self.ingestion_service = IngestionService(config)
        self.page_store = WikiPageStore(config)
        self.search_provider = build_search_provider(config, self.page_store)
        self.legacy_search_provider = LegacyWikiSearchProvider(config, self.page_store)
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
        self.trace_builder = AgentTraceBuilder(config)

    def _compile_metadata_for_paths(self, paths: list[str]) -> tuple[str, str, list[str]]:
        records = self._records_by_source_path()
        backends: list[str] = []
        models: list[str] = []
        for path in paths:
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

    def _records_by_source_path(self):
        if not hasattr(self, "_source_record_cache"):
            records = self.ingestion_service.load_records()
            self._source_record_cache = {record.path: record for record in records}
        return self._source_record_cache

    def ask(self, question: str) -> AskResult:
        classification = self.classifier.classify(question)
        recalled_memory = self.memory_recall.recall(question)
        ranked, search_trace = self.rank_pages(question, classification.question_type)
        selected_evidence = self.evidence_selector.select(ranked, limit=3)
        thin_source_evidence = self.collect_thin_source_gap_evidence(ranked)
        raw_evidence = self.collect_raw_evidence(
            question,
            exclude_paths={item.page_path for item in selected_evidence},
        )
        selected_evidence = self.prioritize_evidence(thin_source_evidence, selected_evidence, raw_evidence)
        plan = self.answer_planner.plan(question, classification.question_type, selected_evidence, recalled_memory)
        process_context = self._derive_process_context(question=question, ranked=ranked, selected_evidence=selected_evidence)
        grounding_blocks = self._build_grounding_blocks(selected_evidence, process_context)

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
        compile_backend, compile_model, compile_warnings = self._compile_metadata_for_paths(retrieved_sources)
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
            answer_path=str(answer_path.resolve().relative_to(self.config.root.resolve())),
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
            answer_path=str(answer_path.resolve().relative_to(self.config.root.resolve())),
            session_record_path=session_record_path,
            method_profile_id=profile.method_profile_id,
            template_id=template.template_id,
            writeback_plan=writeback_plan,
            asset_value_signals=asset_value_signals,
            style_profile_id=profile.method_profile_id,
            writeback_proposed=any(target.approval_status != "rejected" for target in writeback_plan.targets),
            writeback_targets=writeback_targets,
            persistent_memory_proposals=persistent_memory_proposals,
            process_context=process_context,
            answer_grounding_blocks=grounding_blocks,
            created_at=created_at,
        )
        append_jsonl(self.paths.answer_records, record)
        self._append_log(question, retrieved_pages)
        agent_trace = self.trace_builder.build_answer_trace(
            question=question,
            classification=classification,
            search_trace=search_trace,
            ranked=ranked,
            selected_evidence=selected_evidence,
            raw_evidence=raw_evidence,
            compile_backend=compile_backend,
            compile_model=compile_model,
            compile_warnings=compile_warnings,
        )
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
            answer_path=str(answer_path.resolve().relative_to(self.config.root.resolve())),
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
            retrieval_backend=search_trace.backend,
            retrieval_mode=search_trace.retrieval_mode,
            retrieval_collection=search_trace.collection,
            retrieval_explain=search_trace.explain,
            process_context=process_context,
            answer_grounding_blocks=grounding_blocks,
            compile_warnings=compile_warnings,
            compile_backend=compile_backend,
            compile_model=compile_model,
            agent_trace=agent_trace,
            created_at=created_at,
        )

    def load_candidates(self) -> list[PageCandidate]:
        return self.page_store.load_candidates()

    def load_sop_candidates(self) -> list[PageCandidate]:
        explicit_paths = [
            "wiki/主干链路SOP.md",
            "wiki/index/process_sop_index.md",
        ]
        explicit_paths.extend(
            f"wiki/stages/{path.name}" for path in sorted((self.paths.wiki / "stages").glob("*.md"))
        )
        explicit_paths.extend(
            f"wiki/steps/{path.name}" for path in sorted((self.paths.wiki / "steps").glob("*.md"))
        )
        filtered: list[PageCandidate] = []
        seen: set[str] = set()
        for relative in explicit_paths:
            candidate = self.page_store.load_by_path(relative)
            if candidate is None or candidate.page.path in seen:
                continue
            seen.add(candidate.page.path)
            filtered.append(candidate)
        return filtered

    def is_sop_anchor_question(self, question: str) -> bool:
        normalized = question.strip()
        return any(
            token in normalized
            for token in ["主干链路", "产品塑造", "第一环节", "第二阶段", "第三阶段", "第四阶段", "步骤", "关键判断", "SOP"]
        )

    def detect_sop_answer_mode(self, question: str, ranked: list[RankedPage], selected_evidence: list[EvidenceItem]) -> str:
        normalized = question.strip()
        if not self.is_sop_anchor_question(question):
            return "out_of_scope"
        if any(token in normalized for token in ["首先", "先看哪几个步骤", "步骤"]):
            return "mainline_step_question"
        if any(token in normalized for token in ["关键判断", "判断标准"]):
            return "judgement_question"
        if any(token in normalized for token in ["边界", "例外"]):
            return "boundary_question"
        if any(item.page.page_type == "stage" for item in ranked[:4]):
            return "stage_question"
        if any(item.page.page_type == "step" for item in ranked[:4]):
            return "step_detail_question"
        if selected_evidence:
            return "sop_general"
        return "out_of_scope"

    def extract_sop_steps(self, ranked: list[RankedPage], selected_evidence: list[EvidenceItem]) -> list[str]:
        steps: list[str] = []
        seen: set[str] = set()

        for item in ranked:
            if item.page.path == "wiki/主干链路SOP.md":
                for line in self.answer_composer._extract_steps_from_snippet(item.body):
                    if line not in seen:
                        steps.append(line)
                        seen.add(line)
                if steps:
                    return steps

        for item in selected_evidence:
            for line in self.answer_composer._extract_steps_from_snippet(item.snippet):
                if line not in seen:
                    steps.append(line)
                    seen.add(line)
        return steps

    def rank_pages(self, question: str, question_type: str | None = None) -> tuple[list[RankedPage], SearchTrace]:
        trace = SearchTrace()
        if self.is_sop_anchor_question(question):
            candidates = self.load_sop_candidates()
            ranked = self.page_ranker.rank(question, candidates, question_type, retrieval_mode="sop-anchor")
            trace.backend = "legacy"
            trace.retrieval_mode = "sop-anchor"
            trace.collection = "sop-bundle"
            return ranked, trace
        try:
            hits = self.search_provider.search(
                question,
                limit=8,
                collection=self.config.qmd_collection_name if self.config.search_backend == "qmd" else "wiki",
                explain=self.config.qmd_enable_explain,
            )
            trace = SearchTrace(
                backend=self.search_provider.backend_name,
                retrieval_mode=self.search_provider.retrieval_mode,
                collection=getattr(self.search_provider, "default_collection", "wiki"),
                explain=[explain for hit in hits[:3] for explain in hit.explain[:2]],
            )
        except SearchBackendUnavailable as exc:
            hits = self.legacy_search_provider.search(question, limit=8, collection="wiki", explain=False)
            trace = SearchTrace(
                backend="legacy",
                retrieval_mode="heuristic",
                collection="wiki",
                explain=[f"fallback:{exc}"],
            )

        candidates = self._candidates_from_hits(hits)
        if not candidates:
            candidates = self.load_candidates()
            trace = SearchTrace(backend="legacy", retrieval_mode="heuristic", collection="wiki")
            hits = self.legacy_search_provider.search(question, limit=8, collection="wiki", explain=False)

        ranked = self.page_ranker.rank(
            question,
            candidates,
            question_type,
            seed_scores={hit.path: hit.score for hit in hits},
            retrieval_mode=trace.retrieval_mode,
        )
        return ranked, trace

    def collect_raw_evidence(
        self,
        query: str,
        *,
        exclude_paths: set[str] | None = None,
    ) -> list[EvidenceItem]:
        if self.config.search_backend != "qmd" or not self.config.qmd_enable_raw_evidence:
            return []

        try:
            hits = self.search_provider.search(
                query,
                limit=self.config.qmd_raw_evidence_limit,
                collection=self.config.qmd_raw_collection_name,
                explain=False,
            )
        except SearchBackendUnavailable:
            return []

        evidence: list[EvidenceItem] = []
        seen_paths = set(exclude_paths or set())
        for hit in hits:
            if not hit.path.startswith(f"{self.config.source_prefix}/") or hit.path in seen_paths:
                continue
            evidence.append(self._evidence_from_hit(hit))
            seen_paths.add(hit.path)
        return evidence

    def collect_thin_source_gap_evidence(self, ranked_pages: list[RankedPage]) -> list[EvidenceItem]:
        score_by_wiki_path = {item.page.path: item.score for item in ranked_pages}
        evidence: list[EvidenceItem] = []
        for gap in self.trace_builder.detect_thin_source_gaps(ranked_pages=ranked_pages):
            evidence.append(
                EvidenceItem(
                    page_id=gap.raw_path,
                    page_title=Path(gap.raw_path).stem,
                    page_path=gap.raw_path,
                    source_refs=[gap.raw_path, gap.wiki_path],
                    snippet=gap.raw_snippet,
                    relevance_score=max(0.75, score_by_wiki_path.get(gap.wiki_path, 0.0) + 0.01),
                )
            )
        return evidence

    def search_wiki(self, query: str) -> dict:
        classification = self.classifier.classify(query)
        ranked, trace = self.rank_pages(query, classification.question_type)
        return {
            "backend": trace.backend,
            "mode": trace.retrieval_mode,
            "collection": trace.collection,
            "explain": trace.explain,
            "results": [
                {
                    "page_id": item.page.page_id,
                    "title": item.page.title,
                    "path": item.page.path,
                    "summary": item.page.summary,
                    "score": item.score,
                    "reasons": item.reasons,
                }
                for item in ranked[:5]
            ],
        }

    def search_tasks(
        self,
        *,
        query: str = "",
        role: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        task_module: str | None = None,
        product_id: str | None = None,
        task_status: str | None = None,
        include_needs_review: bool = True,
        limit: int = 12,
    ) -> dict:
        index_path = (self.config.workspace_root or self.config.root) / ".llm-wiki" / "task-index.json"
        if not index_path.exists():
            return {
                "backend": "task-index",
                "index_path": index_path.as_posix(),
                "results": [],
                "warnings": ["task_index_missing"],
            }
        try:
            payload = json.loads(index_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {
                "backend": "task-index",
                "index_path": index_path.as_posix(),
                "results": [],
                "warnings": ["task_index_invalid_json"],
            }
        entries = payload.get("entries") if isinstance(payload, dict) else []
        if not isinstance(entries, list):
            entries = []

        def norm(value: str | None) -> str:
            return (value or "").lower().replace(" ", "")

        def role_matches(entry: dict) -> tuple[bool, list[str], int]:
            if not role:
                return True, [], 0
            needle = norm(role)
            candidates = [
                norm(str(entry.get("ownerRole") or "")),
                norm(str(entry.get("normalizedOwnerRole") or "")),
                *[norm(str(item)) for item in entry.get("collaboratorRoles") or []],
            ]
            ok = any(needle in item or item in needle for item in candidates if item)
            return ok, ([f"角色匹配：{role}"] if ok else []), (45 if ok else 0)

        def time_matches(entry: dict) -> tuple[bool, list[str], int]:
            if not start_date and not end_date:
                return True, [], 0
            time_range = entry.get("timeRange") or {}
            label = str(time_range.get("label") or "")
            start = str(time_range.get("start") or "")
            end = str(time_range.get("end") or "")
            filter_start = start_date or end_date or ""
            filter_end = end_date or start_date or ""
            ok = False
            if start and end and filter_start and filter_end:
                ok = start <= filter_end and end >= filter_start
            elif filter_start[:7] and filter_start[:7] in label:
                ok = True
            return ok, ([f"时间匹配：{label}"] if ok else []), (35 if ok else 0)

        def text_score(entry: dict) -> tuple[list[str], int]:
            tokens = [item for item in query.lower().replace("/", " ").split() if len(item) >= 2]
            haystack = norm(" ".join([
                str(entry.get("title") or ""),
                str(entry.get("taskModule") or ""),
                str(entry.get("taskModuleLabel") or ""),
                str(entry.get("productId") or ""),
                str(entry.get("taskItem") or ""),
                str(entry.get("taskStatus") or ""),
                str(entry.get("ownerRole") or ""),
                str(entry.get("targetObject") or ""),
                " ".join(str(item) for item in entry.get("actionSteps") or []),
                " ".join(str(item) for item in entry.get("acceptanceMetrics") or []),
                " ".join(str(item) for item in entry.get("resultFeedback") or []),
            ]))
            score = min(sum(8 for token in tokens if norm(token) in haystack), 40)
            return (["内容命中任务标题/动作/指标"] if score else []), score

        results: list[dict] = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            if not include_needs_review and entry.get("qualityBand") == "needs_review":
                continue
            if task_module and str(entry.get("taskModule") or "") != task_module:
                continue
            if product_id and product_id not in str(entry.get("productId") or ""):
                continue
            if task_status and str(entry.get("taskStatus") or "") != task_status:
                continue
            role_ok, role_reasons, role_score = role_matches(entry)
            if not role_ok:
                continue
            time_ok, time_reasons, time_score = time_matches(entry)
            if not time_ok:
                continue
            text_reasons, score = text_score(entry)
            quality = int(entry.get("qualityScore") or 0)
            executable = int(entry.get("executableScore") or 0)
            importance = int(entry.get("importanceScore") or 0)
            ready_boost = 18 if entry.get("qualityBand") == "ready" else 0
            rank_score = role_score + time_score + score + round(quality * 0.25 + executable * 0.2 + importance * 0.2) + ready_boost
            result = dict(entry)
            result["matchedReasons"] = role_reasons + time_reasons + text_reasons
            result["rankScore"] = rank_score
            results.append(result)

        results.sort(key=lambda item: (item.get("rankScore", 0), item.get("qualityScore", 0)), reverse=True)
        return {
            "backend": "task-index",
            "index_path": index_path.as_posix(),
            "results": results[: max(1, min(limit, 50))],
            "warnings": [],
        }

    def _evidence_from_hit(self, hit: SearchHit) -> EvidenceItem:
        return EvidenceItem(
            page_id=hit.path,
            page_title=hit.title,
            page_path=hit.path,
            source_refs=hit.source_refs or [hit.path],
            snippet=hit.snippet,
            relevance_score=hit.score,
        )

    def merge_evidence(self, wiki_evidence: list[EvidenceItem], raw_evidence: list[EvidenceItem]) -> list[EvidenceItem]:
        merged = list(wiki_evidence)
        seen_paths = {item.page_path for item in merged}
        for item in raw_evidence:
            if item.page_path in seen_paths:
                continue
            merged.append(item)
            seen_paths.add(item.page_path)
        return merged

    def prioritize_evidence(
        self,
        priority_evidence: list[EvidenceItem],
        wiki_evidence: list[EvidenceItem],
        raw_evidence: list[EvidenceItem],
        *,
        limit: int = 4,
    ) -> list[EvidenceItem]:
        ordered: list[EvidenceItem] = []
        seen_paths: set[str] = set()
        for bucket in (priority_evidence, wiki_evidence, raw_evidence):
            for item in bucket:
                if item.page_path in seen_paths:
                    continue
                ordered.append(item)
                seen_paths.add(item.page_path)
                if len(ordered) >= limit:
                    return ordered
        return ordered

    def read_page(self, page_id: str) -> dict:
        candidate = self.page_store.load_by_identifier(page_id)
        if candidate is not None:
            return {
                "page_id": candidate.page.page_id,
                "title": candidate.page.title,
                "path": candidate.page.path,
                "summary": candidate.page.summary,
                "source_refs": candidate.page.source_refs,
                "body": candidate.body,
            }
        raise FileNotFoundError(f"Page not found: {page_id}")

    def _candidates_from_hits(self, hits) -> list[PageCandidate]:
        by_path = self.page_store.by_path()
        chosen: dict[str, PageCandidate] = {}
        for hit in hits:
            candidate = by_path.get(hit.path)
            if candidate is None:
                continue
            chosen[candidate.page.path] = candidate
            for linked in candidate.page.links_to:
                linked_candidate = by_path.get(linked)
                if linked_candidate is not None:
                    chosen[linked_candidate.page.path] = linked_candidate
        return list(chosen.values())

    def _append_log(self, question: str, retrieved_pages: list[str]) -> None:
        entry = f"## [{utc_now()}] ask | {question} | pages={len(retrieved_pages)}\n"
        previous = self.paths.wiki_log.read_text(encoding="utf-8") if self.paths.wiki_log.exists() else "# Wiki Log\n\n"
        self.paths.wiki_log.write_text(previous + entry, encoding="utf-8")

    def _derive_process_context(
        self,
        *,
        question: str,
        ranked: list[RankedPage],
        selected_evidence: list[EvidenceItem],
    ) -> ProcessContext:
        ranked_candidates = ranked[:6]
        stage = ""
        step = ""
        linked_rules: list[str] = []
        linked_cases: list[str] = []
        linked_sources: list[str] = []

        for item in ranked_candidates:
            page = item.page
            if page.page_type == "stage" and not stage:
                stage = page.stage_id or page.title
            if page.page_type == "step" and not step:
                step = page.step_id or page.title
                stage = stage or page.linked_stage or page.stage_id
            if page.linked_stage and not stage:
                stage = page.linked_stage
            if page.linked_step and not step:
                step = page.linked_step
            if page.page_type in {"topic", "principle", "step"}:
                linked_rules.append(page.title)
            if page.page_type in {"project", "case"}:
                linked_cases.append(page.title)
            linked_sources.extend(page.source_refs)

        if not stage:
            if "产品塑造" in question or any("产品塑造" in item.page.title for item in ranked_candidates):
                stage = "第二阶段-产品塑造"
            elif "爆款" in question:
                stage = "第三阶段-爆款打造"
            elif "复盘" in question:
                stage = "第四阶段-复盘"

        if not step and stage == "第二阶段-产品塑造":
            if "营销" in question or "视觉" in question or any("视觉" in item.snippet for item in selected_evidence):
                step = "产品营销能力塑造"

        linked_sources.extend(item.page_path for item in selected_evidence if item.page_path.startswith((self.config.source_prefix + "/", "raw/")))
        answer_mode = self.detect_sop_answer_mode(question, ranked_candidates, selected_evidence)
        matched_block_ids: list[str] = []
        if step:
            matched_block_ids.append(f"step::{step}")
        elif stage:
            matched_block_ids.append(f"stage::{stage}")
        return ProcessContext(
            current_stage=stage or "",
            current_step=step or "",
            linked_rules=list(dict.fromkeys(item for item in linked_rules if item)),
            linked_cases=list(dict.fromkeys(item for item in linked_cases if item)),
            linked_sources=list(dict.fromkeys(item for item in linked_sources if item)),
            anchor_bundle_id=self.SOP_BUNDLE_ID if self.is_sop_anchor_question(question) or answer_mode == "out_of_scope" else "",
            anchor_paths=list(self.SOP_ANCHOR_PATHS if self.is_sop_anchor_question(question) or answer_mode == "out_of_scope" else []),
            matched_block_ids=matched_block_ids,
            answer_mode=answer_mode,
        )

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

    def _build_grounding_blocks(
        self,
        selected_evidence: list[EvidenceItem],
        process_context: ProcessContext,
    ) -> list[AnswerGroundingBlock]:
        blocks: list[AnswerGroundingBlock] = []
        for item in selected_evidence[:4]:
            blocks.append(
                AnswerGroundingBlock(
                    label=item.page_title,
                    block_type="evidence",
                    text=item.snippet,
                    refs=list(dict.fromkeys(item.source_refs or [item.page_path])),
                    stage=process_context.current_stage,
                    step=process_context.current_step,
                )
            )
        return blocks
