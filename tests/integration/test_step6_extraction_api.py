from __future__ import annotations

import json
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
    assert started["current_trace"]["stage_checks"]
    assert started["turns"][0]["agent_trace"]["llm_log"]
    assert started["interview_view"]["current_prompt"]
    assert started["interview_view"]["can_skip"] is True
    assert started["interview_view"]["can_summarize"] is True
    assert started["interview_view"]["structure_counts"]["concepts"] >= 0
    assert started["autosave_state"]["saved"] is True
    assert started["degraded_retrieval_mode"]["active"] in {True, False}

    interview_id = started["interview_id"]

    get_status, fetched = handle_request(
        "GET",
        f"/api/extraction/interviews/{interview_id}",
        config=config,
    )
    assert get_status == 200
    assert fetched["interview_id"] == interview_id
    assert fetched["interview_view"]["current_prompt"]
    assert fetched["autosave_state"]["saved"] is True

    turn_status, continued = handle_request(
        "POST",
        f"/api/extraction/interviews/{interview_id}/turns",
        {
            "turn_action": "answer",
            "user_answer": "品牌经营OS是一套围绕新品到成熟期的长期经营框架。",
        },
        config=config,
    )
    assert turn_status == 200
    assert continued["turn_index"] == started["turn_index"] + 1
    assert len(continued["known_slots"]) >= len(started["known_slots"])
    assert continued["current_trace"]["decision_trace"]["current_object"]
    assert continued["turns"][-1]["agent_trace"]["decision_trace"]["recommended_action"]
    assert continued["candidate_assets"]
    assert continued["followup_questions"]
    assert continued["session_summary"]["session_id"] == interview_id
    assert continued["interview_view"]["current_prompt"]
    assert continued["interview_view"]["recommended_followups"]
    assert continued["autosave_state"]["saved"] is True

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
    assert finished["session"]["status"] == "completed"
    assert finished["session_summary"]["summary_text"]


def test_extraction_api_restores_legacy_state_shape_and_continues_after_refresh(built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)

    start_status, started = handle_request(
        "POST",
        "/api/extraction/interviews",
        {"question": "品牌经营OS和SUPER指标之间是什么关系？"},
        config=config,
    )
    assert start_status == 200

    state_path = built_brain_workspace / started["state_path"]
    payload = json.loads(state_path.read_text(encoding="utf-8"))
    payload["retrieval_buckets"] = None
    payload["next_question_plan"] = None
    payload["stop_decision"] = None
    payload["staged_writeback"] = None
    payload["state_path"] = None
    state_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    get_status, restored = handle_request(
        "GET",
        f"/api/extraction/interviews/{started['interview_id']}",
        config=config,
    )
    assert get_status == 200
    assert restored["state_path"] == started["state_path"]
    assert restored["retrieval_buckets"] is not None
    assert restored["next_question_plan"] is not None
    assert restored["stop_decision"] is not None
    assert restored["staged_writeback"] is not None
    assert restored["current_trace"] is not None

    turn_status, continued = handle_request(
        "POST",
        f"/api/extraction/interviews/{started['interview_id']}/turns",
        {
            "turn_action": "answer",
            "user_answer": "核心对象是品牌经营OS，SUPER是衡量货品经营健康度的指标框架。",
        },
        config=config,
    )
    assert turn_status == 200
    assert continued["interview_id"] == started["interview_id"]
    assert continued["turn_index"] == restored["turn_index"] + 1
    assert continued["state_path"] == started["state_path"]
    assert continued["current_trace"]["llm_log"]


def test_extraction_api_emits_product_contracts_and_persists_asset_feedback(built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)

    start_status, started = handle_request(
        "POST",
        "/api/extraction/interviews",
        {
            "question": "6大维度首先看哪个维度？",
            "title": "6大维度拆解访谈",
            "topic_type": "策略",
            "target_object": "6大维度",
            "goal": "沉淀优先判断顺序",
            "created_by": "expert",
        },
        config=config,
    )

    assert start_status == 200
    assert started["session"]["title"] == "6大维度拆解访谈"
    assert started["session"]["topic_type"] == "策略"
    assert started["session"]["target_object"] == "6大维度"
    assert started["session"]["goal"] == "沉淀优先判断顺序"
    assert started["interview_view"]["phase_label"]
    assert started["interview_view"]["current_prompt"]
    assert len(started["interview_view"]["recommended_followups"]) <= 4
    assert started["candidate_assets"]
    assert started["followup_questions"]
    assert started["session_summary"]["summary_id"]

    first_asset = started["candidate_assets"][0]
    assert first_asset["asset_type"] in {"concept", "heuristic", "case", "signal", "boundary"}
    assert first_asset["status"] in {"draft", "needs_clarification"}
    assert first_asset["content_json"]

    first_followup = started["followup_questions"][0]
    assert first_followup["reason"]
    assert first_followup["priority"] in {"high", "medium", "low"}
    assert first_followup["status"] in {"open", "selected", "answered", "frozen"}

    update_status, updated = handle_request(
        "POST",
        f"/api/extraction/interviews/{started['interview_id']}/assets/{first_asset['asset_id']}",
        {
            "status": "confirmed",
            "summary": "维度1：视觉核心层（决定第一眼停留）",
            "expert_note": "这个结论应作为当前问题的直接答案。",
        },
        config=config,
    )

    assert update_status == 200
    refreshed_asset = next(item for item in updated["candidate_assets"] if item["asset_id"] == first_asset["asset_id"])
    assert refreshed_asset["status"] == "confirmed"
    assert refreshed_asset["summary"] == "维度1：视觉核心层（决定第一眼停留）"
    assert refreshed_asset["expert_note"] == "这个结论应作为当前问题的直接答案。"


def test_ask_and_extraction_api_emit_process_context_for_process_spine_questions(built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)

    ask_status, ask_payload = handle_request(
        "POST",
        "/api/ask",
        {"question": "主干链路SOP里产品塑造阶段要看哪些关键判断？"},
        config=config,
    )
    assert ask_status == 200
    assert ask_payload["process_context"]["current_stage"] == "第二阶段-产品塑造"
    assert ask_payload["process_context"]["linked_rules"]
    assert ask_payload["process_context"]["linked_sources"]
    assert "compile_backend" in ask_payload
    assert "compile_model" in ask_payload
    assert "compile_warnings" in ask_payload

    start_status, started = handle_request(
        "POST",
        "/api/extraction/interviews",
        {"question": "主干链路SOP里产品塑造阶段要看哪些关键判断？"},
        config=config,
    )
    assert start_status == 200
    assert started["session"]["current_stage"] == "第二阶段-产品塑造"
    assert started["current_stage"] == "第二阶段-产品塑造"
    assert started["current_step"]
    assert started["interview_view"]["phase_label"]
    assert started["candidate_assets"]
    assert any(asset["stage_refs"] for asset in started["candidate_assets"])
    assert any(question["linked_stage"] for question in started["followup_questions"])
    assert "compile_backend" in started
    assert "compile_model" in started
    assert "compile_warnings" in started


def test_extraction_api_supports_topic_goal_start_payload_and_turn_actions(built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)

    start_status, started = handle_request(
        "POST",
        "/api/extraction/interviews",
        {
            "topic": "主干链路SOP",
            "goal": "梳理主链路步骤与关键判断",
            "mapped_stage": "第一环节-洞察分析",
            "mapped_step": "类目可行性分析，确定最优叶子类目",
        },
        config=config,
    )
    assert start_status == 200
    assert started["session"]["title"] == "主干链路SOP"
    assert started["session"]["goal"] == "梳理主链路步骤与关键判断"
    assert started["session"]["current_stage"] == "第一环节-洞察分析"
    assert started["session"]["current_step"] == "类目可行性分析，确定最优叶子类目"
    assert started["interview_view"]["can_skip"] is True
    assert started["interview_view"]["can_summarize"] is True

    skip_status, skipped = handle_request(
        "POST",
        f"/api/extraction/interviews/{started['interview_id']}/turns",
        {"turn_action": "skip"},
        config=config,
    )
    assert skip_status == 200
    assert skipped["turn_index"] == started["turn_index"] + 1
    assert skipped["interview_view"]["current_prompt"]

    summarize_status, summarized = handle_request(
        "POST",
        f"/api/extraction/interviews/{started['interview_id']}/turns",
        {"turn_action": "summarize"},
        config=config,
    )
    assert summarize_status == 200
    assert summarized["status"] in {"in_progress", "completed"}
    assert summarized["session_summary"]["summary_text"]
    assert summarized["interview_view"]["can_summarize"] in {True, False}


def test_extraction_api_defaults_to_sop_bundle_anchor_and_answer_frame(built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)

    start_status, started = handle_request(
        "POST",
        "/api/extraction/interviews",
        {
            "topic": "主干链路首先看哪几个步骤",
            "goal": "提炼主链路步骤表",
        },
        config=config,
    )

    assert start_status == 200
    assert started["process_context"]["anchor_bundle_id"] == "sop_mainline_001"
    assert started["process_context"]["answer_mode"] == "mainline_step_question"
    assert started["process_context"]["anchor_paths"] == [
        "raw/industry_docs/主干链路SOP.md",
        "raw/industry_docs/主干链路SOP.graph.json",
        "raw/industry_docs/主干链路SOP.meta.yaml",
    ]
    assert started["interview_view"]["answer_frame"]["primary_answer"].startswith("主干链路先看")
    assert started["interview_view"]["answer_frame"]["mainline_steps"][:4] == [
        "类目可行性分析，确定最优叶子类目",
        "确定叶子类目后价格带地图（店铺+人群）",
        "确定叶子类目后的精准需求词分析",
        "第一环节结束后，产品基本定型：产品满足的人群及人群需求+产品定价的价格带",
    ]
    assert "主链路步骤" in started["current_answer_markdown"]
    assert all(
        ref.startswith("raw/industry_docs/主干链路SOP") or ref.startswith("wiki/")
        for ref in started["retrieved_sources"]
    )

    card_groups = {asset["card_group"] for asset in started["candidate_assets"]}
    assert {"mainline_step", "judgement", "evidence", "boundary"}.issubset(card_groups)
    assert all(asset["anchor_block_refs"] for asset in started["candidate_assets"])
    assert started["followup_questions"][0]["gap_type"] in {
        "stage_step_gap",
        "judgement_gap",
        "boundary_gap",
        "evidence_gap",
    }


def test_extraction_api_keeps_non_sop_questions_inside_sop_anchor_scope(built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)

    start_status, started = handle_request(
        "POST",
        "/api/extraction/interviews",
        {
            "topic": "6大维度首先看哪个维度",
            "goal": "找出优先判断维度",
        },
        config=config,
    )

    assert start_status == 200
    assert started["process_context"]["anchor_bundle_id"] == "sop_mainline_001"
    assert started["process_context"]["answer_mode"] == "out_of_scope"
    assert "超出当前主干链路SOP锚定范围" in started["interview_view"]["answer_frame"]["primary_answer"]
    assert all("6大维度" not in source for source in started["retrieved_sources"])


def test_extraction_api_returns_structured_recoverable_error_payloads(built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)

    status, payload = handle_request(
        "POST",
        "/api/extraction/interviews/non-existent/turns",
        {"turn_action": "answer", "user_answer": "test"},
        config=config,
    )

    assert status == 404
    assert payload["error"]
    assert payload["stage"] == "continue"
    assert payload["recoverable"] is True
    assert payload["interview_id"] == "non-existent"
    assert payload["diagnostic_code"]


def test_extraction_agent_marks_non_sop_priority_question_as_out_of_scope(built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)

    start_status, started = handle_request(
        "POST",
        "/api/extraction/interviews",
        {
            "topic": "6大维度首先看哪个维度",
            "goal": "找出优先判断维度",
        },
        config=config,
    )

    assert start_status == 200
    assert started["process_context"]["anchor_bundle_id"] == "sop_mainline_001"
    assert started["process_context"]["answer_mode"] == "out_of_scope"
    assert "超出当前主干链路SOP锚定范围" in started["current_answer_markdown"]
    assert started["answer_grounding_blocks"] == []
