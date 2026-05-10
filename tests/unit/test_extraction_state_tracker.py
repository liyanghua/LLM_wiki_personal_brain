from __future__ import annotations

import json

from personal_brain.config import BrainConfig
from personal_brain.extraction.state_tracker import ExtractionStateTracker
from personal_brain.models import ExtractionInterviewState


def test_state_tracker_write_persists_state_path_on_first_write(brain_workspace) -> None:
    config = BrainConfig(root=brain_workspace)
    tracker = ExtractionStateTracker(config)
    state = ExtractionInterviewState(
        interview_id="extract-write-first",
        root_question="品牌经营OS和SUPER指标之间是什么关系？",
        current_object="品牌经营OS",
        current_knowledge_goal="理解它和SUPER指标的关系",
        created_at="2026-04-14T00:00:00Z",
        updated_at="2026-04-14T00:00:00Z",
    )

    state_path = tracker.write(state)
    payload = json.loads((brain_workspace / state_path).read_text(encoding="utf-8"))

    assert payload["state_path"] == state_path


def test_state_tracker_load_normalizes_legacy_state_shape(brain_workspace) -> None:
    config = BrainConfig(root=brain_workspace)
    tracker = ExtractionStateTracker(config)
    path = config.paths.extraction_state_path("2026-04-14", "extract-legacy-shape")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "interview_id": "extract-legacy-shape",
                "root_question": "品牌经营OS和SUPER指标之间是什么关系？",
                "interaction_mode": "extraction-interview",
                "status": "in_progress",
                "question_type": "open-ended-synthesis",
                "turn_index": 1,
                "current_object": "品牌经营OS和SUPER指标",
                "current_knowledge_goal": "品牌经营OS和SUPER指标之间是什么关系？",
                "known_slots": {"current_object": "品牌经营OS和SUPER指标"},
                "missing_slots": ["object", "key_claims"],
                "retrieval_buckets": None,
                "current_answer_markdown": "",
                "current_answer_summary": "待补齐",
                "next_question_plan": None,
                "stop_decision": None,
                "staged_writeback": None,
                "ranked_pages": [],
                "retrieved_sources": [],
                "turns": [],
                "state_path": None,
                "created_at": "2026-04-14T00:00:00Z",
                "updated_at": "2026-04-14T00:00:00Z",
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    state = tracker.load("extract-legacy-shape")

    assert state.state_path == "memory/session/extraction/2026-04-14/extract-legacy-shape.json"
    assert state.retrieval_buckets is not None
    assert state.retrieval_buckets.object_pages == []
    assert state.next_question_plan is not None
    assert state.next_question_plan.target_missing_slots == ["object", "key_claims"]
    assert state.stop_decision is not None
    assert state.stop_decision.reason == "continue"
    assert state.staged_writeback is not None
    assert state.staged_writeback.projected_writeback_level == "session-level"
