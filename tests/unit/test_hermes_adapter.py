from __future__ import annotations

from personal_brain.agent.hermes_adapter import HermesAdapter
from personal_brain.agent.tool_schemas import ToolInvocation
from personal_brain.config import BrainConfig


def test_tool_schema_accepts_search_wiki_payload() -> None:
    invocation = ToolInvocation(tool_name="search_wiki", payload={"query": "品牌经营OS"})

    assert invocation.tool_name == "search_wiki"
    assert invocation.payload["query"] == "品牌经营OS"


def test_search_tasks_tool_reads_structured_task_index(tmp_path) -> None:
    index_dir = tmp_path / ".llm-wiki"
    index_dir.mkdir()
    (index_dir / "task-index.json").write_text(
        """
        {
          "schemaVersion": "task_index_v1",
          "entries": [
            {
              "taskId": "task-ready",
              "title": "优化主图点击率",
              "taskModule": "visual_content",
              "taskModuleLabel": "商品视觉与内容创作",
              "productId": "741405253807",
              "taskItem": "优化主图细节图",
              "taskStatus": "in_progress",
              "resultFeedback": [],
              "ownerRole": "运营负责人",
              "normalizedOwnerRole": "运营负责人",
              "collaboratorRoles": ["美工"],
              "timeRange": {"label": "2026-05", "start": "2026-05-01", "end": "2026-05-31"},
              "cadence": "weekly",
              "priority": "high",
              "importanceScore": 90,
              "executableScore": 92,
              "qualityScore": 94,
              "qualityBand": "ready",
              "status": "draft",
              "targetObject": "主图",
              "problemEvidence": ["点击率下滑"],
              "actionSteps": ["优化主图细节图"],
              "acceptanceMetrics": ["点击率提升10%"],
              "reviewRequirement": "下周周会复盘",
              "missingElements": [],
              "sourceRefs": ["raw/week.xlsx#sheet=周会"],
              "wikiRefs": ["wiki/tasks/week.md"],
              "sourceDocId": "doc-week",
              "sourceName": "运营周会.xlsx",
              "sourceDocType": "meeting_task_source"
            }
          ]
        }
        """,
        encoding="utf-8",
    )
    adapter = HermesAdapter(BrainConfig(root=tmp_path))

    names = {tool.name for tool in adapter.list_tools()}
    assert "search_tasks" in names

    result = adapter.invoke(
        "search_tasks",
        {
            "query": "运营负责人 5月任务列表",
            "role": "运营负责人",
            "start_date": "2026-05-01",
            "end_date": "2026-05-31",
            "task_module": "visual_content",
            "product_id": "741405253807",
            "task_status": "in_progress",
            "include_needs_review": True,
        },
    )

    assert result["results"][0]["taskId"] == "task-ready"
    assert result["results"][0]["taskModule"] == "visual_content"
    assert result["results"][0]["productId"] == "741405253807"
    assert result["results"][0]["qualityBand"] == "ready"
    assert "角色匹配" in " ".join(result["results"][0]["matchedReasons"])


def test_hermes_adapter_lists_and_invokes_tools(built_brain_workspace) -> None:
    adapter = HermesAdapter(BrainConfig(root=built_brain_workspace))

    names = {tool.name for tool in adapter.list_tools()}
    assert {
        "search_wiki",
        "read_page",
        "search_memory",
        "propose_writeback",
        "run_lint",
        "start_extraction_interview",
        "get_extraction_interview",
        "continue_extraction_interview",
        "finish_extraction_interview",
    }.issubset(names)

    result = adapter.invoke("search_wiki", {"query": "品牌经营OS"})
    assert result["results"]

    started = adapter.invoke("start_extraction_interview", {"question": "什么是品牌经营OS？"})
    interview_id = started["interview_id"]

    fetched = adapter.invoke("get_extraction_interview", {"interview_id": interview_id})
    continued = adapter.invoke(
        "continue_extraction_interview",
        {"interview_id": interview_id, "user_answer": "它是一套围绕长期经营的品牌方法。"},
    )
    finished = adapter.invoke("finish_extraction_interview", {"interview_id": interview_id})

    assert fetched["interview_id"] == interview_id
    assert continued["turn_index"] > started["turn_index"]
    assert finished["status"] == "completed"
