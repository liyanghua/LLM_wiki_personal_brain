from __future__ import annotations

from pydantic import BaseModel, Field


class CompileClaim(BaseModel):
    claim_type: str
    text: str
    refs: list[str] = Field(default_factory=list)


class CompileObjectCandidate(BaseModel):
    object_type: str
    title: str
    summary: str
    refs: list[str] = Field(default_factory=list)


class CompileResult(BaseModel):
    summary: str
    structured_sections: dict[str, list[str]] = Field(default_factory=dict)
    claims: list[CompileClaim] = Field(default_factory=list)
    object_candidates: list[CompileObjectCandidate] = Field(default_factory=list)
    stage_id: str = ""
    step_id: str = ""
    confidence: float = 0.0
    warnings: list[str] = Field(default_factory=list)
    provider: str = "deterministic"
    model: str = ""
    latency_ms: int = 0
    token_usage: dict[str, int] = Field(default_factory=dict)
