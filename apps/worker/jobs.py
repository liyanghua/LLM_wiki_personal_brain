from __future__ import annotations

from pathlib import Path

from personal_brain.config import BrainConfig
from personal_brain.ingestion.service import IngestionService
from personal_brain.retrieval.query_engine import QueryEngine
from personal_brain.wiki.compiler import WikiCompiler


def run_ingest_job(*paths: str) -> int:
    service = IngestionService(BrainConfig.from_env())
    return len(service.ingest_paths([Path(path) for path in paths]))


def run_build_job() -> int:
    result = WikiCompiler(BrainConfig.from_env()).build()
    return len(result.source_pages) + len(result.derived_pages)


def run_ask_job(question: str) -> str:
    return QueryEngine(BrainConfig.from_env()).ask(question).answer_markdown
