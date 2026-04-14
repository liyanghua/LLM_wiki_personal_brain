from __future__ import annotations

from personal_brain.agent.memory_recall import MemoryRecall
from personal_brain.agent.tool_schemas import (
    ContinueExtractionInterviewInput,
    FinishExtractionInterviewInput,
    GetExtractionInterviewInput,
    ProposeWritebackInput,
    ReadPageInput,
    RunLintInput,
    SearchMemoryInput,
    SearchWikiInput,
    StartExtractionInterviewInput,
)
from personal_brain.config import BrainConfig
from personal_brain.extraction.service import ExtractionInterviewService
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
        self.extraction_service = ExtractionInterviewService(config)

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
            ToolSpec(
                name="start_extraction_interview",
                description="Start a multi-turn extraction interview from an initial question.",
                input_schema=StartExtractionInterviewInput.model_json_schema(),
                output_schema={"type": "object", "properties": {"interview_id": {"type": "string"}}},
            ),
            ToolSpec(
                name="get_extraction_interview",
                description="Load the current state of an extraction interview.",
                input_schema=GetExtractionInterviewInput.model_json_schema(),
                output_schema={"type": "object", "properties": {"interview_id": {"type": "string"}}},
            ),
            ToolSpec(
                name="continue_extraction_interview",
                description="Submit the next user answer to an extraction interview.",
                input_schema=ContinueExtractionInterviewInput.model_json_schema(),
                output_schema={"type": "object", "properties": {"interview_id": {"type": "string"}}},
            ),
            ToolSpec(
                name="finish_extraction_interview",
                description="Force-stop an extraction interview and stage final writeback previews.",
                input_schema=FinishExtractionInterviewInput.model_json_schema(),
                output_schema={"type": "object", "properties": {"interview_id": {"type": "string"}}},
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
        if name == "start_extraction_interview":
            validated = StartExtractionInterviewInput.model_validate(payload)
            return self.extraction_service.start(validated.question, scene_id=validated.scene_id).model_dump(mode="json")
        if name == "get_extraction_interview":
            validated = GetExtractionInterviewInput.model_validate(payload)
            return self.extraction_service.get(validated.interview_id).model_dump(mode="json")
        if name == "continue_extraction_interview":
            validated = ContinueExtractionInterviewInput.model_validate(payload)
            return self.extraction_service.continue_interview(
                validated.interview_id,
                validated.user_answer,
            ).model_dump(mode="json")
        if name == "finish_extraction_interview":
            validated = FinishExtractionInterviewInput.model_validate(payload)
            return self.extraction_service.finish(validated.interview_id).model_dump(mode="json")
        raise KeyError(f"Unknown tool: {name}")
