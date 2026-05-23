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
    SearchTasksInput,
    SearchWikiInput,
    StartExtractionInterviewInput,
)
from personal_brain.config import BrainConfig
from personal_brain.extraction.service import ExtractionInterviewService
from personal_brain.lint.service import WikiLintService
from personal_brain.models import AgentRunRequest, ToolSpec
from personal_brain.retrieval.query_engine import QueryEngine
from personal_brain.skills.strategy_runtime import StrategyRuntimeService
from personal_brain.writeback.service import WritebackService


class ToolRegistry:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.query_engine = QueryEngine(config)
        self.memory_recall = MemoryRecall(config)
        self.writeback_service = WritebackService(config)
        self.lint_service = WikiLintService(config)
        self.extraction_service = ExtractionInterviewService(config)
        self.strategy_runtime = StrategyRuntimeService(config)

    def list_specs(self) -> list[ToolSpec]:
        builtins = [
            ToolSpec(
                name="search_wiki",
                description="Search wiki pages relevant to a query.",
                input_schema=SearchWikiInput.model_json_schema(),
                output_schema={
                    "type": "object",
                    "properties": {
                        "backend": {"type": "string"},
                        "mode": {"type": "string"},
                        "collection": {"type": "string"},
                        "results": {"type": "array"},
                    },
                },
            ),
            ToolSpec(
                name="search_tasks",
                description="Search structured business task cards by role, time range, quality, and query text.",
                input_schema=SearchTasksInput.model_json_schema(),
                output_schema={
                    "type": "object",
                    "properties": {
                        "backend": {"type": "string"},
                        "index_path": {"type": "string"},
                        "results": {"type": "array"},
                        "warnings": {"type": "array"},
                    },
                },
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
        approved_specs = [
            ToolSpec(
                name=f"approved_skill::{skill.skill_id}",
                description=f"Run approved project skill: {skill.title}",
                input_schema=skill.input_schema,
                output_schema=skill.output_schema,
            )
            for skill in self.strategy_runtime.list_approved_skills()
        ]
        return builtins + approved_specs

    def invoke(self, name: str, payload: dict) -> dict:
        if name.startswith("approved_skill::"):
            skill_id = name.split("::", 1)[1]
            approved = {item.skill_id: item for item in self.strategy_runtime.list_approved_skills()}
            skill = approved.get(skill_id)
            if not skill:
                raise KeyError(f"Unknown approved skill: {skill_id}")
            doc_id = str(payload.get("doc_id") or "").strip()
            if not doc_id:
                raise ValueError("approved skill execution requires doc_id")
            task_input = {key: value for key, value in payload.items() if key not in {
                "project_path",
                "doc_id",
                "scene_id",
                "run_mode",
                "selected_skill_ids",
                "grounding_sources",
                "create_review_item",
            }}
            request = AgentRunRequest(
                project_path=str(payload.get("project_path") or (self.config.workspace_root or self.config.root)),
                doc_id=doc_id,
                scene_id=str(payload.get("scene_id") or skill.scene_id),
                run_mode=str(payload.get("run_mode") or "generate_strategy"),
                selected_skill_ids=[skill_id],
                grounding_sources=[item for item in payload.get("grounding_sources", skill.wiki_refs) if isinstance(item, str)],
                task_input=task_input,
                create_review_item=bool(payload.get("create_review_item", False)),
            )
            return self.strategy_runtime.run_agent(request).model_dump(mode="json")
        if name == "search_wiki":
            validated = SearchWikiInput.model_validate(payload)
            return self.query_engine.search_wiki(validated.query)
        if name == "search_tasks":
            validated = SearchTasksInput.model_validate(payload)
            return self.query_engine.search_tasks(
                query=validated.query,
                role=validated.role,
                start_date=validated.start_date,
                end_date=validated.end_date,
                task_module=validated.task_module,
                product_id=validated.product_id,
                task_status=validated.task_status,
                include_needs_review=validated.include_needs_review,
                limit=validated.limit,
            )
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
