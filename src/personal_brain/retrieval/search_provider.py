from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Protocol

from personal_brain.config import BrainConfig
from personal_brain.models import SearchHit
from personal_brain.retrieval.wiki_page_store import WikiPageStore
from personal_brain.utils.files import read_json, utc_now, write_json
from personal_brain.utils.text import overlap_score


class SearchBackendUnavailable(RuntimeError):
    """Raised when the configured search backend cannot serve a request."""


class SearchProvider(Protocol):
    backend_name: str
    retrieval_mode: str
    default_collection: str

    def search(
        self,
        query: str,
        *,
        limit: int = 5,
        collection: str | None = None,
        explain: bool = False,
    ) -> list[SearchHit]: ...

    def rebuild_wiki_index(self) -> dict[str, object]: ...


class LegacyWikiSearchProvider:
    backend_name = "legacy"
    retrieval_mode = "heuristic"
    default_collection = "wiki"

    def __init__(self, config: BrainConfig, page_store: WikiPageStore) -> None:
        self.config = config
        self.page_store = page_store

    def search(
        self,
        query: str,
        *,
        limit: int = 5,
        collection: str | None = None,
        explain: bool = False,
    ) -> list[SearchHit]:
        candidates = self.page_store.load_candidates()
        seed_scores: list[tuple[int, object]] = []
        for candidate in candidates:
            seed = overlap_score(query, f"{candidate.page.title} {candidate.page.summary}")
            seed_scores.append((seed, candidate))
        seed_scores.sort(key=lambda item: item[0], reverse=True)
        chosen = {candidate.page.path: candidate for _, candidate in seed_scores[:5]}
        by_path = {candidate.page.path: candidate for candidate in candidates}
        for _, candidate in seed_scores[:5]:
            for linked in candidate.page.links_to:
                if linked in by_path:
                    chosen[linked] = by_path[linked]

        hits: list[SearchHit] = []
        for candidate in chosen.values():
            score = float(
                overlap_score(query, candidate.page.title) * 3
                + overlap_score(query, candidate.page.summary) * 2
                + overlap_score(query, candidate.body)
            )
            if score <= 0:
                continue
            explain_rows = []
            if explain:
                explain_rows.append(f"heuristic-score:{score:.2f}")
            hits.append(
                SearchHit(
                    title=candidate.page.title,
                    path=candidate.page.path,
                    snippet=candidate.page.summary,
                    score=score,
                    source_refs=candidate.page.source_refs,
                    collection=collection or self.default_collection,
                    retrieval_mode=self.retrieval_mode,
                    explain=explain_rows,
                    page_type=candidate.page.page_type,
                )
            )
        hits.sort(key=lambda item: item.score, reverse=True)
        return hits[:limit]

    def rebuild_wiki_index(self) -> dict[str, object]:
        return {"backend": self.backend_name, "updated": False, "reason": "legacy-backend"}


class QmdSearchProvider:
    backend_name = "qmd"
    retrieval_mode = "hybrid"

    def __init__(self, config: BrainConfig, page_store: WikiPageStore) -> None:
        self.config = config
        self.page_store = page_store
        self.default_collection = config.qmd_collection_name
        self._alias_cache: dict[str, dict[str, str]] = {}

    def search(
        self,
        query: str,
        *,
        limit: int = 5,
        collection: str | None = None,
        explain: bool = False,
    ) -> list[SearchHit]:
        if not self.is_available():
            raise SearchBackendUnavailable("qmd binary not found")

        self.ensure_ready()
        active_collection = collection or self.default_collection
        structured_query = self._build_structured_query(query)
        command = [
            self.config.qmd_bin,
            "--index",
            self.config.resolved_qmd_index_name,
            "query",
            structured_query,
            "--json",
            "-n",
            str(limit),
            "-c",
            active_collection,
        ]
        if not self.config.qmd_enable_rerank:
            command.append("--no-rerank")
        if explain:
            command.append("--explain")

        completed = self._run(command)
        payload = self._load_json_output(completed.stdout)
        raw_items = self._extract_result_items(payload)
        return [self._normalize_hit(item, active_collection) for item in raw_items[:limit]]

    def rebuild_wiki_index(self) -> dict[str, object]:
        if not self.is_available():
            raise SearchBackendUnavailable("qmd binary not found")

        wiki_root = self.config.paths.wiki
        collection = self.default_collection
        raw_collection = self.config.qmd_raw_collection_name
        base = [self.config.qmd_bin, "--index", self.config.resolved_qmd_index_name]

        self._ensure_collection(base, wiki_root, collection)
        if self.config.qmd_enable_raw_evidence:
            self._ensure_collection(base, self.config.paths.raw, raw_collection)

        for suffix, context in {
            "topics": "Topic pages define reusable concepts and stable definitions for the personal brain.",
            "principles": "Principle pages encode reusable rules, heuristics, and operating methods.",
            "projects": "Project pages focus on active execution context, status, and project-specific learnings.",
            "sources": "Source pages preserve provenance and should be treated as supporting evidence, not default answer targets.",
        }.items():
            self._run(
                [
                    *base,
                    "context",
                    "add",
                    f"qmd://{collection}/{suffix}",
                    context,
                ],
                allow_failure=True,
            )
        if self.config.qmd_enable_raw_evidence:
            for suffix, context in {
                "industry_docs": "Original domain and industry markdown files used as evidence fallback and provenance support.",
                "conversations": "Conversation logs and interview notes used for evidence augmentation, nuance, and examples.",
                "notes": "Working notes are lower-confidence raw material and should support, not replace, wiki-grounded answers.",
            }.items():
                self._run(
                    [
                        *base,
                        "context",
                        "add",
                        f"qmd://{raw_collection}/{suffix}",
                        context,
                    ],
                    allow_failure=True,
                )

        self._run([*base, "update"])
        self._run([*base, "embed"])

        state = {
            "backend": self.backend_name,
            "index_name": self.config.resolved_qmd_index_name,
            "collection": collection,
            "raw_collection": raw_collection if self.config.qmd_enable_raw_evidence else None,
            "embed_model": self.config.qmd_embed_model,
            "updated_at": utc_now(),
        }
        write_json(self.config.paths.qmd_state, state)
        return {"backend": self.backend_name, "updated": True, **state}

    def _ensure_collection(self, base: list[str], wiki_root: Path, collection: str) -> None:
        try:
            self._run(
                [
                    *base,
                    "collection",
                    "add",
                    str(wiki_root),
                    "--name",
                    collection,
                    "--mask",
                    "**/*.md",
                ]
            )
        except SearchBackendUnavailable as exc:
            if "already exists" not in str(exc):
                raise

    def ensure_ready(self) -> None:
        state = read_json(self.config.paths.qmd_state, default={})
        needs_rebuild = (
            not state
            or state.get("index_name") != self.config.resolved_qmd_index_name
            or state.get("collection") != self.default_collection
            or (
                self.config.qmd_enable_raw_evidence
                and state.get("raw_collection") != self.config.qmd_raw_collection_name
            )
            or state.get("embed_model") != self.config.qmd_embed_model
        )
        if needs_rebuild:
            self.rebuild_wiki_index()

    def is_available(self) -> bool:
        return shutil.which(self.config.qmd_bin) is not None

    def _run(self, command: list[str], allow_failure: bool = False) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["XDG_CACHE_HOME"] = str(self.config.paths.search_cache_home)
        env["XDG_CONFIG_HOME"] = str(self.config.paths.search_dir)
        env["QMD_EMBED_MODEL"] = self.config.qmd_embed_model
        env["QMD_LLAMA_GPU"] = self.config.qmd_llama_gpu

        completed = subprocess.run(
            command,
            capture_output=True,
            check=False,
            text=True,
            env=env,
        )
        if completed.returncode != 0 and not allow_failure:
            raise SearchBackendUnavailable(completed.stderr.strip() or "qmd command failed")
        return completed

    def _load_json_output(self, stdout: str) -> object:
        if not stdout.strip():
            return []
        try:
            return json.loads(stdout)
        except json.JSONDecodeError as exc:
            raise SearchBackendUnavailable(f"qmd returned non-json output: {exc}") from exc

    def _extract_result_items(self, payload: object) -> list[dict[str, object]]:
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        if isinstance(payload, dict):
            for key in ("results", "hits", "items"):
                value = payload.get(key)
                if isinstance(value, list):
                    return [item for item in value if isinstance(item, dict)]
        return []

    def _normalize_hit(self, payload: dict[str, object], collection: str) -> SearchHit:
        raw_path = str(payload.get("path") or payload.get("file") or payload.get("relative_path") or "")
        normalized_path = self._normalize_path(raw_path)
        page = self.page_store.load_by_path(normalized_path)
        resolved_path = page.page.path if page else normalized_path
        explain_rows: list[str] = []
        context = payload.get("context")
        if isinstance(context, str) and context:
            explain_rows.append(context)
        explanation = payload.get("explain")
        if isinstance(explanation, list):
            explain_rows.extend(str(item) for item in explanation)
        elif isinstance(explanation, str) and explanation:
            explain_rows.append(explanation)

        return SearchHit(
            title=str(payload.get("title") or (page.page.title if page else Path(normalized_path).stem)),
            path=resolved_path,
            snippet=str(payload.get("snippet") or payload.get("preview") or (page.page.summary if page else "")),
            score=float(payload.get("score") or payload.get("relevance") or 0.0),
            source_refs=page.page.source_refs if page else ([normalized_path] if normalized_path.startswith(f"{self.config.source_prefix}/") else []),
            collection=str(payload.get("collection") or collection),
            retrieval_mode=self.retrieval_mode,
            explain=explain_rows,
            page_type=page.page.page_type if page else None,
        )

    def _normalize_path(self, raw_path: str) -> str:
        cleaned = raw_path.strip().removeprefix("./")
        if cleaned.startswith("qmd://"):
            virtual_path = cleaned.removeprefix("qmd://")
            collection_name, _, relative_path = virtual_path.partition("/")
            cleaned = f"{collection_name}/{relative_path}" if relative_path else collection_name
        if cleaned.startswith(str(self.config.paths.raw.resolve())):
            cleaned = str(Path(cleaned).resolve().relative_to(self.config.root.resolve()))
        if cleaned.startswith(str(self.config.paths.wiki.resolve())):
            cleaned = str(Path(cleaned).resolve().relative_to(self.config.root.resolve()))
        if cleaned.startswith(("wiki/", f"{self.config.source_prefix}/")):
            return self._resolve_collection_alias(cleaned) or cleaned
        relative = cleaned.lstrip("/")
        if (self.config.paths.raw / relative).exists():
            return f"{self.config.source_prefix}/{relative}"
        if (self.config.paths.wiki / relative).exists():
            return f"wiki/{relative}"
        return f"wiki/{relative}"

    def _resolve_collection_alias(self, cleaned: str) -> str | None:
        if cleaned.startswith(f"{self.config.source_prefix}/"):
            return self._resolve_alias_for_root(cleaned, self.config.paths.raw, self.config.source_prefix)
        if cleaned.startswith("wiki/"):
            return self._resolve_alias_for_root(cleaned, self.config.paths.wiki, "wiki")
        return None

    def _resolve_alias_for_root(self, cleaned: str, root: Path, prefix: str) -> str | None:
        actual_path = self.config.root / cleaned
        if actual_path.exists():
            return cleaned
        aliases = self._alias_cache.get(prefix)
        if aliases is None:
            aliases = self._build_alias_map(root, prefix)
            self._alias_cache[prefix] = aliases
        return aliases.get(cleaned)

    def _build_alias_map(self, root: Path, prefix: str) -> dict[str, str]:
        aliases: dict[str, str] = {}
        for path in root.rglob("*.md"):
            relative = path.relative_to(root)
            normalized_relative = "/".join(self._normalize_qmd_component(part) for part in relative.parts)
            aliases[f"{prefix}/{normalized_relative}"] = f"{prefix}/{relative.as_posix()}"
        return aliases

    def _normalize_qmd_component(self, component: str) -> str:
        path = Path(component)
        if path.suffix:
            normalized_stem = re.sub(r"[^0-9a-zA-Z\u4e00-\u9fff]+", "-", path.stem).strip("-").lower()
            return f"{normalized_stem}{path.suffix.lower()}"
        return re.sub(r"[^0-9a-zA-Z\u4e00-\u9fff]+", "-", component).strip("-").lower()

    def _build_structured_query(self, query: str) -> str:
        # qmd's plain `query` path triggers automatic query expansion, which can
        # stall local generation on first request. We keep hybrid retrieval but
        # force an explicit lex+vec query document to skip that expansion step.
        normalized = " ".join(query.split())
        return f"lex: {normalized}\nvec: {normalized}"


class SearchIndexManager:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.page_store = WikiPageStore(config)
        self.provider = build_search_provider(config, self.page_store)

    def rebuild(self) -> dict[str, object]:
        try:
            return self.provider.rebuild_wiki_index()
        except SearchBackendUnavailable as exc:
            return {"backend": getattr(self.provider, "backend_name", "legacy"), "updated": False, "error": str(exc)}

    def refresh(self) -> dict[str, object]:
        if self.config.search_backend != "qmd":
            return {"backend": "legacy", "updated": False, "reason": "legacy-backend"}
        return self.rebuild()


def build_search_provider(config: BrainConfig, page_store: WikiPageStore) -> SearchProvider:
    if config.search_backend == "qmd":
        return QmdSearchProvider(config, page_store)
    return LegacyWikiSearchProvider(config, page_store)
