from __future__ import annotations

import json

from personal_brain.config import BrainConfig
from personal_brain.retrieval.query_engine import QueryEngine


def test_ask_writes_dated_session_memory_and_keeps_persistent_files_unchanged(built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)
    before = {
        name: (built_brain_workspace / "memory" / "persistent" / name).read_text(encoding="utf-8")
        for name in ["profile.json", "interests.json", "principles.json", "open_loops.json"]
    }

    result = QueryEngine(config).ask("品牌经营OS和SUPER指标之间是什么关系？")

    assert "## Synthesis" in result.answer_markdown
    assert len(result.retrieved_pages) >= 2
    assert result.session_record_path
    session_path = built_brain_workspace / result.session_record_path
    assert session_path.exists()
    payload = json.loads(session_path.read_text(encoding="utf-8"))
    assert payload["persistent_memory_proposals"]
    assert payload["style_update_suggestions"] is not None

    after = {
        name: (built_brain_workspace / "memory" / "persistent" / name).read_text(encoding="utf-8")
        for name in ["profile.json", "interests.json", "principles.json", "open_loops.json"]
    }
    assert before == after


def test_consecutive_asks_reuse_session_memory_for_follow_up(built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)
    engine = QueryEngine(config)

    first = engine.ask("什么是品牌经营OS？")
    second = engine.ask("它和SUPER指标怎么结合？")

    assert second.recalled_memory.recent_session_summaries
    assert any("品牌经营OS" in summary for summary in second.recalled_memory.recent_session_summaries)
    assert second.open_follow_ups
