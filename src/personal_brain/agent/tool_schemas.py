from __future__ import annotations

from pydantic import BaseModel, Field


class ToolInvocation(BaseModel):
    tool_name: str
    payload: dict = Field(default_factory=dict)


class SearchWikiInput(BaseModel):
    query: str


class ReadPageInput(BaseModel):
    page_id: str


class SearchMemoryInput(BaseModel):
    query: str


class ProposeWritebackInput(BaseModel):
    query_id: str


class RunLintInput(BaseModel):
    include_stale: bool = True


class StartExtractionInterviewInput(BaseModel):
    question: str
    scene_id: str | None = None


class GetExtractionInterviewInput(BaseModel):
    interview_id: str


class ContinueExtractionInterviewInput(BaseModel):
    interview_id: str
    user_answer: str


class FinishExtractionInterviewInput(BaseModel):
    interview_id: str
