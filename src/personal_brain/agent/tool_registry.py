from __future__ import annotations

from personal_brain.agent.memory_recall import MemoryRecall
from personal_brain.agent.tool_schemas import (
    ProposeWritebackInput,
    ReadPageInput,
    RunLintInput,
    SearchMemoryInput,
    SearchWikiInput,
)
from personal_brain.config import BrainConfig
from personal_brain.lint.service import WikiLintService
from personal_brain.models import ToolSpec
from personal_brain.retrieval.query_engine import QueryEngine
from personal_brain.writeback.service import WritebackService


class ToolRegistry:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.query_engine = QueryEngine(config)
        self.memory_recall = MemoryRecall(config)
        self.writeback_service = WritebackService(config)
        self.lint_service = WikiLintService(config)

    def list_specs(self) -> list[ToolSpec]:
        return [
            ToolSpec(
                name="search_wiki",
                description="Search wiki pages relevant to a query.",
                input_schema=SearchWikiInput.model_json_schema(),
                output_schema={"type": "object", "properties": {"results": {"type": "array"}}},
            ),
            ToolSpec(
                name="read_page",
                description="Read a wiki page by page_id.",
                input_schema=ReadPageInput.model_json_schema(),
                output_schema={"type": "object", "properties": {"page": {"type": "object"}}},
            ),
            ToolSpec(
                name="search_memory",
                description="Search recent session memory and persistent memory.",
                input_schema=SearchMemoryInput.model_json_schema(),
                output_schema={"type": "object", "properties": {"recent_session_summaries": {"type": "array"}}},
            ),
            ToolSpec(
                name="propose_writeback",
                description="Create a writeback proposal for a query id.",
                input_schema=ProposeWritebackInput.model_json_schema(),
                output_schema={"type": "object", "properties": {"query_id": {"type": "string"}}},
            ),
            ToolSpec(
                name="run_lint",
                description="Run wiki lint checks.",
                input_schema=RunLintInput.model_json_schema(),
                output_schema={"type": "object", "properties": {"issues": {"type": "array"}}},
            ),
        ]

    def invoke(self, name: str, payload: dict) -> dict:
        if name == "search_wiki":
            validated = SearchWikiInput.model_validate(payload)
            return {"results": self.query_engine.search_wiki(validated.query)}
        if name == "read_page":
            validated = ReadPageInput.model_validate(payload)
            return {"page": self.query_engine.read_page(validated.page_id)}
        if name == "search_memory":
            validated = SearchMemoryInput.model_validate(payload)
            return self.memory_recall.search(validated.query)
        if name == "propose_writeback":
            validated = ProposeWritebackInput.model_validate(payload)
            return self.writeback_service.create_proposal(validated.query_id).model_dump(mode="json")
        if name == "run_lint":
            RunLintInput.model_validate(payload)
            return self.lint_service.run().model_dump(mode="json")
        raise KeyError(f"Unknown tool: {name}")
