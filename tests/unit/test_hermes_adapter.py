from __future__ import annotations

from personal_brain.agent.hermes_adapter import HermesAdapter
from personal_brain.agent.tool_schemas import ToolInvocation
from personal_brain.config import BrainConfig


def test_tool_schema_accepts_search_wiki_payload() -> None:
    invocation = ToolInvocation(tool_name="search_wiki", payload={"query": "品牌经营OS"})

    assert invocation.tool_name == "search_wiki"
    assert invocation.payload["query"] == "品牌经营OS"


def test_hermes_adapter_lists_and_invokes_tools(built_brain_workspace) -> None:
    adapter = HermesAdapter(BrainConfig(root=built_brain_workspace))

    names = {tool.name for tool in adapter.list_tools()}
    assert {"search_wiki", "read_page", "search_memory", "propose_writeback", "run_lint"}.issubset(names)

    result = adapter.invoke("search_wiki", {"query": "品牌经营OS"})
    assert result["results"]
