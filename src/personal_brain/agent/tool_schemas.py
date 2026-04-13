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
