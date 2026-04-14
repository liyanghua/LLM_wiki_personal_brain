from __future__ import annotations

from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[2]))

from apps.api.server import handle_request
from personal_brain.assets.service import AssetBuildService
from personal_brain.config import BrainConfig
from personal_brain.eval.runner import EvaluationRunner
from personal_brain.retrieval.query_engine import QueryEngine
from personal_brain.writeback.service import WritebackService


def test_api_routes_expose_ask_profile_and_wiki_data(built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)
    status, ask_payload = handle_request(
        "POST",
        "/api/ask",
        {"question": "品牌经营OS和SUPER指标之间是什么关系？"},
        config=config,
    )
    profile_status, profile_payload = handle_request("GET", "/api/profile/method", config=config)
    wiki_status, wiki_pages_payload = handle_request("GET", "/api/wiki/pages", config=config)

    assert status == 200
    assert profile_status == 200
    assert wiki_status == 200
    assert ask_payload["query_id"]
    assert ask_payload["question_classification"]["question_type"] in {
        "definition",
        "comparison",
        "open-ended-synthesis",
    }
    assert ask_payload["selected_evidence"]
    assert profile_payload["method_profile_id"] == "default-grounded"
    assert wiki_pages_payload["pages"]
    assert any(page["page_type"] == "topic" for page in wiki_pages_payload["pages"])
    assert any("品牌经营OS" in page["title"] for page in wiki_pages_payload["pages"])


def test_api_routes_expose_writeback_assets_eval_and_memory_data(built_brain_workspace) -> None:
    config = BrainConfig(root=built_brain_workspace)
    result = QueryEngine(config).ask("品牌经营OS和SUPER指标之间是什么关系？")
    QueryEngine(config).ask("如何把品牌经营OS整理成可复用的方法框架？")
    WritebackService(config).create_proposal(result.query_id)
    AssetBuildService(config).build()
    EvaluationRunner(config).run()

    list_status, proposal_list = handle_request("GET", "/api/writeback/proposals", config=config)
    detail_status, proposal_detail = handle_request("GET", f"/api/writeback/proposals/{result.query_id}", config=config)
    apply_status, applied = handle_request("POST", f"/api/writeback/proposals/{result.query_id}/apply", {}, config=config)
    ontology_status, ontology_candidates = handle_request("GET", "/api/assets/ontology-candidates", config=config)
    skill_status, skill_candidates = handle_request("GET", "/api/assets/skill-candidates", config=config)
    memory_status, recent_memory = handle_request("GET", "/api/memory/recent", config=config)
    reports_status, reports = handle_request("GET", "/api/eval/reports", config=config)
    report_status, report_detail = handle_request("GET", f"/api/eval/reports/{reports['reports'][0]['run_id']}", config=config)
    tree_status, wiki_tree = handle_request("GET", "/api/wiki/tree", config=config)
    page_status, wiki_page = handle_request("GET", f"/api/wiki/pages/{proposal_detail['targets'][0]['target']}", config=config)

    assert list_status == 200
    assert detail_status == 200
    assert apply_status == 200
    assert ontology_status == 200
    assert skill_status == 200
    assert memory_status == 200
    assert reports_status == 200
    assert report_status == 200
    assert tree_status == 200
    assert page_status == 200
    assert proposal_list["proposals"]
    assert proposal_detail["query_id"] == result.query_id
    assert applied["applied_targets"]
    assert ontology_candidates["candidates"]
    assert skill_candidates["candidates"]
    assert recent_memory["recent_session_summaries"]
    assert reports["reports"]
    assert report_detail["run_id"] == reports["reports"][0]["run_id"]
    assert wiki_tree["tree"]
    assert wiki_page["page"]["title"]
