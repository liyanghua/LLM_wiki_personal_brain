from __future__ import annotations

import json

from personal_brain.config import BrainConfig
from personal_brain.ingestion.service import IngestionService
from personal_brain.lint.service import WikiLintService
from personal_brain.retrieval.query_engine import QueryEngine
from personal_brain.wiki.compiler import WikiCompiler
from personal_brain.writeback.service import WritebackService


def test_build_ask_lint_and_writeback_flow(brain_workspace) -> None:
    config = BrainConfig(root=brain_workspace)
    ingest_service = IngestionService(config)
    compiler = WikiCompiler(config)
    query_engine = QueryEngine(config)
    lint_service = WikiLintService(config)
    writeback_service = WritebackService(config)

    ingest_service.ingest_paths(
        [
            brain_workspace / "raw" / "industry_docs",
            brain_workspace / "raw" / "conversations",
        ]
    )
    build_result = compiler.build()

    assert (brain_workspace / "wiki" / "index.md").exists()
    assert (brain_workspace / "wiki" / "log.md").exists()
    assert len(build_result.source_pages) == 6
    assert (brain_workspace / "wiki" / "topics" / "品牌经营os.md").exists()
    assert (brain_workspace / "wiki" / "projects" / "儿童学习桌垫单因子测图.md").exists()
    assert (brain_workspace / "wiki" / "principles" / "商品全生命周期运营原则.md").exists()

    answer = query_engine.ask("什么是品牌经营OS？")
    assert "## Fact" in answer.answer_markdown
    assert "## Synthesis" in answer.answer_markdown
    assert "## Interpretation" in answer.answer_markdown
    assert "## Recommendation" in answer.answer_markdown
    assert answer.retrieved_pages
    assert (brain_workspace / "memory" / "session" / "answers" / f"{answer.query_id}.md").exists()

    lint_result = lint_service.run()
    assert lint_result.issues == []

    proposal = writeback_service.create_proposal(answer.query_id)
    assert proposal.target_paths
    assert all(not path.exists() for path in proposal.target_paths)

    proposal_path = brain_workspace / "memory" / "session" / "writeback" / f"{answer.query_id}.json"
    stored = json.loads(proposal_path.read_text(encoding="utf-8"))
    assert stored["query_id"] == answer.query_id
