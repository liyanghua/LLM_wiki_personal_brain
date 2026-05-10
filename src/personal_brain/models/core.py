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
    schema_path: str | None = None
    schema_route: str | None = None
    source_family: str = "unclassified"
    role_in_pipeline: str = "unknown"
    authority_level: str = "medium"
    trust_level: str = "draft"
    maturity_level: str = "raw"
    preferred_outputs: list[str] = Field(default_factory=list)
    not_for_direct_publish: list[str] = Field(default_factory=list)
    risk_flags: list[str] = Field(default_factory=list)
    routing_policy: dict[str, Any] = Field(default_factory=dict)
    retrieval_policy: dict[str, Any] = Field(default_factory=dict)
    governance_policy: dict[str, Any] = Field(default_factory=dict)
    domain_profiles: list[str] = Field(default_factory=list)
    ingest_trace: dict[str, Any] = Field(default_factory=dict)
    descriptor_path: str | None = None
    canonical_asset_type: str = ""
    process_stage_id: str = ""
    process_step_id: str = ""
    attachment_refs: list[str] = Field(default_factory=list)
    graph_node_refs: list[str] = Field(default_factory=list)
    compile_confidence: float = 0.0
    normalized_path: str | None = None
    graph_bundle_refs: list[str] = Field(default_factory=list)
    claim_refs: list[str] = Field(default_factory=list)
    compile_mode: str = "rule_fallback"
    compile_warnings: list[str] = Field(default_factory=list)
    compile_backend: str = "deterministic"
    compile_model: str = ""


class WikiPage(BaseModel):
    page_id: str
    page_type: str
    title: str
    path: str
    summary: str
    source_refs: list[str] = Field(default_factory=list)
    links_to: list[str] = Field(default_factory=list)
    updated_at: str
    schema_route: str | None = None
    source_family: str = "legacy"
    confidence: float = 0.0
    governance_status: str = "draft"
    retrieval_tags: list[str] = Field(default_factory=list)
    stage_id: str | None = None
    step_id: str | None = None
    linked_stage: str | None = None
    linked_step: str | None = None
    stage_order: list[str] = Field(default_factory=list)
    linked_steps: list[str] = Field(default_factory=list)


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


class SearchHit(BaseModel):
    title: str
    path: str
    snippet: str
    score: float
    source_refs: list[str] = Field(default_factory=list)
    collection: str = "wiki"
    retrieval_mode: str = "heuristic"
    explain: list[str] = Field(default_factory=list)
    page_type: str | None = None


class SearchTrace(BaseModel):
    backend: str = "legacy"
    retrieval_mode: str = "heuristic"
    collection: str = "wiki"
    explain: list[str] = Field(default_factory=list)


class ProcessContext(BaseModel):
    current_stage: str = ""
    current_step: str = ""
    linked_rules: list[str] = Field(default_factory=list)
    linked_cases: list[str] = Field(default_factory=list)
    linked_sources: list[str] = Field(default_factory=list)
    anchor_bundle_id: str = ""
    anchor_paths: list[str] = Field(default_factory=list)
    matched_block_ids: list[str] = Field(default_factory=list)
    answer_mode: str = ""


class AnswerGroundingBlock(BaseModel):
    label: str
    block_type: str = "evidence"
    text: str
    refs: list[str] = Field(default_factory=list)
    stage: str = ""
    step: str = ""


class TraceStage(BaseModel):
    stage_id: str
    label: str
    status: str
    reason: str
    pass_criteria: str
    evidence_refs: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class TraceLogEntry(BaseModel):
    component: str
    step: str
    input_summary: str
    output_summary: str
    refs: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class AgentTraceBundle(BaseModel):
    stage_checks: list[TraceStage] = Field(default_factory=list)
    retrieval_trace: dict[str, Any] = Field(default_factory=dict)
    decision_trace: dict[str, Any] = Field(default_factory=dict)
    llm_log: list[TraceLogEntry] = Field(default_factory=list)


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


class StrategySkillCandidateManifest(BaseModel):
    skill_id: str
    family: str
    title: str
    summary: str
    scene_id: str
    linked_doc_ids: list[str] = Field(default_factory=list)
    origin_strategy_card_ids: list[str] = Field(default_factory=list)
    wiki_refs: list[str] = Field(default_factory=list)
    source_refs: list[str] = Field(default_factory=list)
    validation_criteria: list[str] = Field(default_factory=list)
    promotion_state: str = "candidate"
    generated_at: str


class ApprovedSkillSpec(BaseModel):
    skill_id: str
    title: str
    scene_id: str
    tier: str
    family: str
    path: str
    wiki_refs: list[str] = Field(default_factory=list)
    source_refs: list[str] = Field(default_factory=list)
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] = Field(default_factory=dict)


class AgentRunRequest(BaseModel):
    project_path: str
    doc_id: str
    scene_id: str
    run_mode: str
    selected_skill_ids: list[str] = Field(default_factory=list)
    grounding_sources: list[str] = Field(default_factory=list)


class AgentRunResult(BaseModel):
    run_id: str
    project_path: str
    doc_id: str
    scene_id: str
    run_mode: str
    selected_skill_ids: list[str] = Field(default_factory=list)
    grounding_sources: list[str] = Field(default_factory=list)
    result_summary: str
    trace: list[str] = Field(default_factory=list)
    output_artifacts: list[str] = Field(default_factory=list)
    created_at: str


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
    process_context: ProcessContext = Field(default_factory=ProcessContext)
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
    retrieval_backend: str = "legacy"
    retrieval_mode: str = "heuristic"
    retrieval_collection: str = "wiki"
    retrieval_explain: list[str] = Field(default_factory=list)
    process_context: ProcessContext = Field(default_factory=ProcessContext)
    answer_grounding_blocks: list[AnswerGroundingBlock] = Field(default_factory=list)
    compile_warnings: list[str] = Field(default_factory=list)
    compile_backend: str = "deterministic"
    compile_model: str = ""
    agent_trace: AgentTraceBundle = Field(default_factory=AgentTraceBundle)
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


class SceneSlotDefinition(BaseModel):
    name: str
    required: bool = True
    description: str = ""


class SceneSlotSchema(BaseModel):
    scene_id: str
    current_object: str | None = None
    knowledge_goal: str | None = None
    slots: list[SceneSlotDefinition] = Field(default_factory=list)


class CompiledProblem(BaseModel):
    scene_id: str | None = None
    slot_schema_source: str
    current_object: str
    current_knowledge_goal: str
    question_type: str
    known_slots: dict[str, str] = Field(default_factory=dict)
    missing_slots: list[str] = Field(default_factory=list)
    recommended_action: str
    slot_names: list[str] = Field(default_factory=list)
    cues: list[str] = Field(default_factory=list)


class RetrievalHit(BaseModel):
    title: str
    path: str
    snippet: str
    score: float = 0.0
    source_refs: list[str] = Field(default_factory=list)


class RetrievalBuckets(BaseModel):
    object_pages: list[RetrievalHit] = Field(default_factory=list)
    evidence_pages: list[EvidenceItem] = Field(default_factory=list)
    conversation_hits: list[RetrievalHit] = Field(default_factory=list)
    pattern_hits: list[RetrievalHit] = Field(default_factory=list)
    ranked_page_paths: list[str] = Field(default_factory=list)
    retrieved_sources: list[str] = Field(default_factory=list)
    retrieval_backend: str = "legacy"
    retrieval_mode: str = "heuristic"
    retrieval_collection: str = "wiki"
    retrieval_explain: list[str] = Field(default_factory=list)
    process_context: ProcessContext = Field(default_factory=ProcessContext)


class QuestionPlan(BaseModel):
    next_question_type: str
    candidate_questions: list[str] = Field(default_factory=list)
    target_missing_slots: list[str] = Field(default_factory=list)
    stop_if: list[str] = Field(default_factory=list)


class StopDecision(BaseModel):
    should_stop: bool
    reason: str
    confidence: float = 1.0


class StagedWriteback(BaseModel):
    session_level: dict[str, Any] | None = None
    knowledge_level: dict[str, Any] | None = None
    asset_level: dict[str, Any] | None = None
    projected_writeback_level: str = "session-level"


class InterviewSession(BaseModel):
    session_id: str
    title: str
    topic_type: str = "topic"
    target_object: str = ""
    goal: str = ""
    status: str = "in_progress"
    created_by: str = "expert"
    created_at: str | None = None
    completed_at: str | None = None
    current_stage: str = ""
    current_step: str = ""


class CandidateAsset(BaseModel):
    asset_id: str
    session_id: str
    asset_type: str
    title: str
    summary: str
    content_json: dict[str, Any] = Field(default_factory=dict)
    confidence: float = 0.0
    source_turn_ids: list[int] = Field(default_factory=list)
    evidence_refs: list[str] = Field(default_factory=list)
    status: str = "draft"
    expert_note: str = ""
    stage_refs: list[str] = Field(default_factory=list)
    step_refs: list[str] = Field(default_factory=list)
    decision_refs: list[str] = Field(default_factory=list)
    card_group: str = ""
    card_order: int = 0
    anchor_block_refs: list[str] = Field(default_factory=list)


class CandidateAssetUpdate(BaseModel):
    status: str | None = None
    summary: str | None = None
    expert_note: str | None = None


class FollowupQuestion(BaseModel):
    question_id: str
    session_id: str
    question_text: str
    question_type: str
    reason: str
    priority: str = "medium"
    status: str = "open"
    source_asset_ids: list[str] = Field(default_factory=list)
    target_missing_slots: list[str] = Field(default_factory=list)
    linked_stage: str = ""
    linked_step: str = ""
    gap_type: str = ""


class InterviewAnswerFrame(BaseModel):
    primary_answer: str = ""
    mainline_steps: list[str] = Field(default_factory=list)
    key_judgements: list[str] = Field(default_factory=list)
    evidence_refs: list[str] = Field(default_factory=list)


class SessionSummary(BaseModel):
    summary_id: str
    session_id: str
    summary_text: str
    key_concepts: list[str] = Field(default_factory=list)
    key_heuristics: list[str] = Field(default_factory=list)
    key_cases: list[str] = Field(default_factory=list)
    key_boundaries: list[str] = Field(default_factory=list)
    unresolved_items: list[str] = Field(default_factory=list)


class InterviewView(BaseModel):
    current_prompt: str = ""
    prompt_type_label: str = ""
    phase_label: str = ""
    recommended_followups: list[str] = Field(default_factory=list)
    structure_counts: dict[str, int] = Field(default_factory=dict)
    answer_frame: InterviewAnswerFrame = Field(default_factory=InterviewAnswerFrame)
    can_skip: bool = True
    can_summarize: bool = True
    autosave_state: str = "pending"


class ExtractionTurn(BaseModel):
    turn_index: int
    user_input: str
    compiled_problem: CompiledProblem | None = None
    retrieval_buckets: RetrievalBuckets | None = None
    answer_summary: str = ""
    answer_markdown: str = ""
    question_plan: QuestionPlan | None = None
    newly_filled_slots: list[str] = Field(default_factory=list)
    agent_trace: AgentTraceBundle | None = None
    created_at: str | None = None


class ExtractionInterviewState(BaseModel):
    interview_id: str
    root_question: str
    interaction_mode: str = "extraction-interview"
    session: InterviewSession | None = None
    scene_id: str | None = None
    status: str = "in_progress"
    question_type: str = "open-ended-synthesis"
    turn_index: int = 0
    current_object: str = ""
    current_knowledge_goal: str = ""
    current_stage: str = ""
    current_step: str = ""
    known_slots: dict[str, str] = Field(default_factory=dict)
    missing_slots: list[str] = Field(default_factory=list)
    retrieval_buckets: RetrievalBuckets | None = None
    process_context: ProcessContext = Field(default_factory=ProcessContext)
    current_answer_markdown: str = ""
    current_answer_summary: str = ""
    answer_grounding_blocks: list[AnswerGroundingBlock] = Field(default_factory=list)
    next_question_plan: QuestionPlan | None = None
    stop_decision: StopDecision | None = None
    staged_writeback: StagedWriteback | None = None
    candidate_assets: list[CandidateAsset] = Field(default_factory=list)
    followup_questions: list[FollowupQuestion] = Field(default_factory=list)
    session_summary: SessionSummary | None = None
    current_trace: AgentTraceBundle | None = None
    compile_warnings: list[str] = Field(default_factory=list)
    compile_backend: str = "deterministic"
    compile_model: str = ""
    ranked_pages: list[str] = Field(default_factory=list)
    retrieved_sources: list[str] = Field(default_factory=list)
    turns: list[ExtractionTurn] = Field(default_factory=list)
    state_path: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class BuildResult(BaseModel):
    source_pages: list[WikiPage] = Field(default_factory=list)
    derived_pages: list[WikiPage] = Field(default_factory=list)
    candidate_artifacts: list[str] = Field(default_factory=list)
    compile_backend: str = "deterministic"
    compile_model: str = ""
    fallback_count: int = 0


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
    metrics: dict[str, float] = Field(default_factory=dict)
    report_path_json: str | None = None
    report_path_markdown: str | None = None


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
