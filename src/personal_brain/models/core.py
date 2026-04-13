from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field


class SourceRecord(BaseModel):
    source_id: str
    path: str
    source_type: str
    title: str
    created_at: str
    ingested_at: str
    tags: list[str] = Field(default_factory=list)
    checksum: str
    logical_source_id: str
    variant_group: list[str] = Field(default_factory=list)
    is_primary_variant: bool = False
    parse_error: str | None = None


class WikiPage(BaseModel):
    page_id: str
    page_type: str
    title: str
    path: str
    summary: str
    source_refs: list[str] = Field(default_factory=list)
    links_to: list[str] = Field(default_factory=list)
    updated_at: str


class OntologyObject(BaseModel):
    object_id: str
    object_type: str
    canonical_name: str
    aliases: list[str] = Field(default_factory=list)
    attributes: dict[str, str] = Field(default_factory=dict)
    evidence_refs: list[str] = Field(default_factory=list)
    wiki_refs: list[str] = Field(default_factory=list)


class PersonalStyleProfile(BaseModel):
    profile_id: str = "default-grounded"
    preferred_tone: str = "grounded"
    preferred_answer_structure: list[str] = Field(
        default_factory=lambda: ["fact", "synthesis", "interpretation", "recommendation"]
    )
    abstraction_level: str = "balanced"
    actionability_preference: str = "medium"
    citation_preference: str = "high"
    favored_output_forms: list[str] = Field(default_factory=lambda: ["markdown"])
    reuse_preference: str = "proposal-first"


class QuestionClassification(BaseModel):
    question_type: str
    confidence: float = 1.0
    cues: list[str] = Field(default_factory=list)


class PageCandidate(BaseModel):
    page: WikiPage
    body: str


class RankedPage(BaseModel):
    page: WikiPage
    body: str
    score: float
    reasons: list[str] = Field(default_factory=list)


class EvidenceItem(BaseModel):
    page_id: str
    page_title: str
    page_path: str
    source_refs: list[str] = Field(default_factory=list)
    snippet: str
    relevance_score: float


class AnswerSection(BaseModel):
    name: str
    guidance: str


class MemoryRecallBundle(BaseModel):
    recent_session_summaries: list[str] = Field(default_factory=list)
    persistent_interests: list[str] = Field(default_factory=list)
    persistent_principles: list[str] = Field(default_factory=list)
    open_loops: list[str] = Field(default_factory=list)


class AnswerPlan(BaseModel):
    question: str
    question_type: str
    sections: list[AnswerSection]
    open_follow_ups: list[str] = Field(default_factory=list)
    planning_notes: list[str] = Field(default_factory=list)


class MemoryProposal(BaseModel):
    proposal_type: str
    target_file: str
    key: str
    value: Any
    rationale: str


class AnswerRecord(BaseModel):
    query_id: str
    user_query: str
    question_classification: QuestionClassification = Field(
        default_factory=lambda: QuestionClassification(question_type="unknown", confidence=0.0, cues=["legacy-record"])
    )
    ranked_pages: list[str] = Field(default_factory=list)
    retrieved_pages: list[str]
    retrieved_sources: list[str]
    selected_evidence: list[EvidenceItem] = Field(default_factory=list)
    answer_path: str
    session_record_path: str | None = None
    style_profile_id: str = "default-grounded"
    writeback_proposed: bool = False
    writeback_targets: list[str] = Field(default_factory=list)
    persistent_memory_proposals: list[MemoryProposal] = Field(default_factory=list)
    created_at: str


class AskResult(BaseModel):
    query_id: str
    user_query: str
    question_classification: QuestionClassification = Field(
        default_factory=lambda: QuestionClassification(question_type="unknown", confidence=0.0, cues=["legacy-result"])
    )
    answer_markdown: str
    ranked_pages: list[str] = Field(default_factory=list)
    retrieved_pages: list[str]
    retrieved_sources: list[str]
    selected_evidence: list[EvidenceItem] = Field(default_factory=list)
    recalled_memory: MemoryRecallBundle = Field(default_factory=MemoryRecallBundle)
    open_follow_ups: list[str] = Field(default_factory=list)
    answer_path: str
    session_record_path: str | None = None
    style_profile_id: str = "default-grounded"
    writeback_proposed: bool = False
    writeback_targets: list[str] = Field(default_factory=list)
    persistent_memory_proposals: list[MemoryProposal] = Field(default_factory=list)
    style_update_suggestions: list[str] = Field(default_factory=list)
    applied_memory_writes: list[str] = Field(default_factory=list)
    created_at: str


class SessionRecord(BaseModel):
    query_id: str
    session_date: str
    user_query: str
    question_classification: QuestionClassification
    recalled_memory: MemoryRecallBundle
    ranked_pages: list[str] = Field(default_factory=list)
    selected_evidence: list[EvidenceItem] = Field(default_factory=list)
    answer_summary: str
    open_follow_ups: list[str] = Field(default_factory=list)
    writeback_proposed: bool = False
    writeback_targets: list[str] = Field(default_factory=list)
    persistent_memory_proposals: list[MemoryProposal] = Field(default_factory=list)
    style_update_suggestions: list[str] = Field(default_factory=list)
    style_profile_id: str = "default-grounded"
    answer_path: str
    created_at: str


class ToolSpec(BaseModel):
    name: str
    description: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]


class BuildResult(BaseModel):
    source_pages: list[WikiPage] = Field(default_factory=list)
    derived_pages: list[WikiPage] = Field(default_factory=list)


class LintIssue(BaseModel):
    code: str
    message: str
    path: str | None = None


class LintResult(BaseModel):
    issues: list[LintIssue] = Field(default_factory=list)


class WritebackProposal(BaseModel):
    query_id: str
    reason: str
    content: str
    target_paths: list[Path] = Field(default_factory=list)
    created_at: str
