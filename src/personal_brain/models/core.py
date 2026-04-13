from __future__ import annotations

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


class MethodProfile(BaseModel):
    method_profile_id: str = "default-grounded"
    preferred_answer_structure: list[str] = Field(
        default_factory=lambda: ["fact", "synthesis", "interpretation", "recommendation"]
    )
    abstraction_depth: str = "balanced"
    operationalization_level: str = "medium"
    explanation_pattern: str = "hybrid"
    reusable_asset_preferences: list[str] = Field(default_factory=lambda: ["mapping"])
    citation_preference: str = "high"
    assetization_preference: str = "proposal-first"
    favored_output_forms: list[str] = Field(default_factory=lambda: ["markdown"])
    preferred_tone: str = "grounded"
    actionability_preference: str = "medium"

    @property
    def profile_id(self) -> str:
        return self.method_profile_id

    @property
    def abstraction_level(self) -> str:
        return self.abstraction_depth


class MethodSuggestion(BaseModel):
    field_name: str
    current_value: Any
    suggested_value: Any
    rationale: str


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


class TemplatePlan(BaseModel):
    template_id: str
    sections: list[str]
    method_section: str | None = None
    explanation_pattern: str = "hybrid"


class MemoryProposal(BaseModel):
    proposal_type: str
    target_file: str
    key: str
    value: Any
    rationale: str


class AssetValueSignals(BaseModel):
    overall_score: float = 0.0
    reasons: list[str] = Field(default_factory=list)
    signals: dict[str, float] = Field(default_factory=dict)


class WritebackTargetDecision(BaseModel):
    target: str
    action: str
    rationale: str
    confidence: float
    long_term_value: str
    evidence_refs: list[str] = Field(default_factory=list)
    content_preview: str
    approval_status: str = "pending"
    rejection_reason: str | None = None


class WritebackBundle(BaseModel):
    query_id: str
    question: str
    targets: list[WritebackTargetDecision] = Field(default_factory=list)
    target_paths: list[str] = Field(default_factory=list)
    applied_targets: list[str] = Field(default_factory=list)
    created_at: str


class OntologyCandidate(BaseModel):
    candidate_id: str
    candidate_type: str
    canonical_name: str
    summary: str
    wiki_refs: list[str] = Field(default_factory=list)
    source_refs: list[str] = Field(default_factory=list)
    attributes: dict[str, Any] = Field(default_factory=dict)
    status: str = "candidate/pending-approval"


class SkillCandidateManifest(BaseModel):
    skill_id: str
    family: str
    title: str
    summary: str
    origin_query_ids: list[str] = Field(default_factory=list)
    origin_wiki_pages: list[str] = Field(default_factory=list)
    source_refs: list[str] = Field(default_factory=list)
    asset_value_score: float = 0.0
    status: str = "candidate/pending-approval"


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
    method_profile_id: str = "default-grounded"
    template_id: str = "core-four-part"
    writeback_plan: WritebackBundle | None = None
    asset_value_signals: AssetValueSignals = Field(default_factory=AssetValueSignals)
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
    method_profile_id: str = "default-grounded"
    template_id: str = "core-four-part"
    writeback_plan: WritebackBundle | None = None
    asset_value_signals: AssetValueSignals = Field(default_factory=AssetValueSignals)
    style_profile_id: str = "default-grounded"
    writeback_proposed: bool = False
    writeback_targets: list[str] = Field(default_factory=list)
    persistent_memory_proposals: list[MemoryProposal] = Field(default_factory=list)
    method_update_suggestions: list[MethodSuggestion] = Field(default_factory=list)
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
    method_profile_id: str = "default-grounded"
    template_id: str = "core-four-part"
    writeback_plan: WritebackBundle | None = None
    asset_value_signals: AssetValueSignals = Field(default_factory=AssetValueSignals)
    writeback_proposed: bool = False
    writeback_targets: list[str] = Field(default_factory=list)
    persistent_memory_proposals: list[MemoryProposal] = Field(default_factory=list)
    method_update_suggestions: list[MethodSuggestion] = Field(default_factory=list)
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


class AssetBuildResult(BaseModel):
    ontology_candidates: int = 0
    skill_candidates: int = 0
    ontology_index_path: str | None = None
    skills_index_path: str | None = None


class LintIssue(BaseModel):
    code: str
    message: str
    path: str | None = None


class LintResult(BaseModel):
    issues: list[LintIssue] = Field(default_factory=list)


class EvaluationCase(BaseModel):
    case_id: str
    question: str
    expected_writeback_targets: list[str] = Field(default_factory=list)
    expected_candidate_types: list[str] = Field(default_factory=list)
    expected_skill_families: list[str] = Field(default_factory=list)


class EvaluationCaseResult(BaseModel):
    case_id: str
    question: str
    scores: dict[str, float] = Field(default_factory=dict)
    matched_targets: list[str] = Field(default_factory=list)
    missing_targets: list[str] = Field(default_factory=list)
    explanation: str = ""


class EvaluationReport(BaseModel):
    run_id: str
    created_at: str
    metrics: dict[str, float] = Field(default_factory=dict)
    case_results: list[EvaluationCaseResult] = Field(default_factory=list)
    report_path_json: str | None = None
    report_path_markdown: str | None = None


class WritebackProposal(WritebackBundle):
    """Compatibility alias retained for Step1/Step2 tests and tool surfaces."""
