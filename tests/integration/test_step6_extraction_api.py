from __future__ import annotations

from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[2]))

from apps.api.server import handle_request
from personal_brain.config import BrainConfig


def test_extraction_api_supports_multi_turn_interview_and_final_staging(built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)

    start_status, started = handle_request(
        "POST",
        "/api/extraction/interviews",
        {"question": "品牌经营OS和SUPER指标之间是什么关系？"},
        config=config,
    )
    assert start_status == 200
    assert started["status"] == "in_progress"
    assert started["interaction_mode"] == "extraction-interview"
    assert started["interview_id"]
    assert started["next_question_plan"]["candidate_questions"]

    interview_id = started["interview_id"]

    get_status, fetched = handle_request(
        "GET",
        f"/api/extraction/interviews/{interview_id}",
        config=config,
    )
    assert get_status == 200
    assert fetched["interview_id"] == interview_id

    turn_status, continued = handle_request(
        "POST",
        f"/api/extraction/interviews/{interview_id}/turns",
        {"user_answer": "品牌经营OS是一套围绕新品到成熟期的长期经营框架。"},
        config=config,
    )
    assert turn_status == 200
    assert continued["turn_index"] == started["turn_index"] + 1
    assert len(continued["known_slots"]) >= len(started["known_slots"])

    finish_status, finished = handle_request(
        "POST",
        f"/api/extraction/interviews/{interview_id}/finish",
        {},
        config=config,
    )
    assert finish_status == 200
    assert finished["status"] == "completed"
    assert finished["staged_writeback"]["session_level"] is not None
    assert finished["staged_writeback"]["knowledge_level"] is not None
    assert finished["state_path"]
    assert (built_brain_workspace / finished["state_path"]).exists()
