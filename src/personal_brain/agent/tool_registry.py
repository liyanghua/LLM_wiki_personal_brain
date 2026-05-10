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
            objective = str(payload.get("objective") or "").strip() or skill.title
            grounding_sources = payload.get("grounding_sources") or skill.wiki_refs or []
            return {
                "recommendation": objective,
                "why_now": f"通过项目已批准技能 {skill.title} 触发，建议结合当前业务 Wiki 执行。",
                "validation_plan": "请先在人审或策略工作台中验证输出，再决定是否进入修订闭环。",
                "evidence_refs": grounding_sources,
            }
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
