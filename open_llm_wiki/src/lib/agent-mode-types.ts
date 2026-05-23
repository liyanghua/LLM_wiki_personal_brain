export type FieldCoverageStatus =
  | "covered"
  | "missing"
  | "weak"
  | "needs_confirmation"
  | "inferred"

export type ImprovementActionType =
  | "supplement"
  | "clarify"
  | "rewrite"
  | "confirm"

export type ImprovementPriority = "high" | "medium" | "low"

export type InteractiveGoal = "supplement" | "clarify" | "rewrite" | "confirm"

export type BlockIssueType =
  | "missing_required_field"
  | "weak_field"
  | "missing_criteria"
  | "missing_validation"
  | "missing_boundary"
  | "structure_mismatch"
  | "source_grounding_gap"

export type IssueSeverity = "P1" | "P2" | "P3"

export type PatchMode = "replace" | "insert_after" | "split_block" | "confirm_only"

export type RevisionCardStatus =
  | "open"
  | "in_review"
  | "accepted"
  | "edited"
  | "resolved"
  | "dismissed"
  | "deferred"

export type GroundTruthFieldStatus =
  | "seeded"
  | "inferred"
  | "confirmed"
  | "revised"
  | "needs_review"

export type TriggerSource =
  | "manual_start"
  | "issue_card"
  | "publish_gate"
  | "wiki_health_feedback"

export type AgentWorkbenchPhase =
  | "enter_workbench"
  | "restore_workspace"
  | "prepare_task"
  | "accept_writeback"
  | "partial_recompute"
  | "publish_and_health_check"

export type AgentWorkbenchPhaseStatus = "idle" | "running" | "done" | "error"

export type AgentLoopStatus =
  | "idle"
  | "active"
  | "awaiting_expert"
  | "recomputing"
  | "ready_to_publish"
  | "feedback_pending"
  | "completed"

export type LoopTaskType = "revision_card" | "wiki_feedback"
export type LoopTaskStatus = "open" | "active" | "resolved" | "deferred"

import type { FileFingerprint } from "@/lib/source-fingerprint"
import type {
  GateStatus,
  HealthScorecard,
  PublishGateDecision,
  RootCause,
} from "@/lib/quality-contracts"

export interface ScenePackManifest {
  scene_id: string
  scene_name: string
  doc_type: string
  default_output_language: string
  profiles_version: string
  source_snapshot_origin: string
}

export interface ScenePackPaths {
  manifestPath: string
  purposePath: string
  schemaPath: string
  schemaProfilePath: string
  expertGuidancePath: string
  evaluationProfilePath: string
  strategyProfilePath: string
  snapshotDir: string
}

export interface ScenePack {
  manifest: ScenePackManifest
  paths: ScenePackPaths
  purposeMarkdown: string
  schemaMarkdown: string
  schemaProfile: Record<string, unknown>
  expertGuidanceProfile: Record<string, unknown>
  evaluationProfile: Record<string, unknown>
  strategyProfile?: Record<string, unknown>
}

export interface DocumentBlock {
  blockId: string
  blockType:
    | "heading"
    | "paragraph"
    | "list"
    | "table"
    | "quote"
    | "code"
    | "evidence"
    | "image"
    | "mindmap_node"
    | "revision_mark"
  textContent: string
  parentBlockId: string | null
  childBlockIds: string[]
  sourceRefs: string[]
  headingPath: string[]
  level?: number
  lineStart: number
  lineEnd: number
  page?: number | null
  bbox?: [number, number, number, number] | null
  readingOrder?: number | null
  blockRole?: string | null
  ocrUsed?: boolean
  sourceAnchorId?: string | null
  assetPath?: string | null
  approximateAnchor?: boolean
  nodePath?: string[]
  evidenceKind?: "text" | "table" | "image" | "revision" | "mindmap"
}

export interface DocumentIR {
  docId: string
  sourceName: string
  sourcePath: string
  createdAt: string
  blocks: DocumentBlock[]
}

export interface TaskEvidenceText {
  text: string
  evidenceRefs: string[]
}

export interface TaskRoleProfile {
  roleName: string
  responsibilities: string[]
  kpis: string[]
  collaboratorRoles: string[]
  evidenceRefs: string[]
}

export type TaskModule =
  | "new_product_launch"
  | "existing_product_growth"
  | "visual_content"
  | "traffic_promotion"
  | "customer_conversion"
  | "creator_content"
  | "product_operations"
  | "unknown"

export type BusinessTaskStatus =
  | "not_started"
  | "in_progress"
  | "blocked"
  | "done"
  | "deferred"
  | "unknown"

export interface TaskTaxonomyElement {
  fieldKey: string
  label: string
  aliases: string[]
  requiredForReady: boolean
  conditionalRequirement?: string
  evidenceRefs: string[]
}

export interface TaskTaxonomyModule {
  moduleId: TaskModule
  label: string
  aliases: string[]
  examples: string[]
  evidenceRefs: string[]
}

export interface TaskTaxonomy {
  taxonomyId: string
  sourceDocId: string
  sourceName: string
  sourcePath: string
  modules: TaskTaxonomyModule[]
  taskElements: TaskTaxonomyElement[]
  priorityValues: string[]
  statusValues: string[]
  evidenceRefs: string[]
}

export interface TaskCardDraft {
  taskId: string
  title: string
  taskModule?: TaskModule
  productId?: string
  taskItem?: string
  taskStatus?: BusinessTaskStatus
  resultFeedback?: string[]
  trigger: string
  targetObject: string
  problemEvidence: string[]
  ownerRole: string
  normalizedOwnerRole?: string
  collaboratorRoles: string[]
  actionSteps: string[]
  acceptanceMetrics: string[]
  cadence: string
  reviewRequirement: string
  sourceRefs: string[]
  status: "draft" | "needs_review"
  timeRange?: {
    label: string
    start?: string | null
    end?: string | null
  }
  priority?: "critical" | "high" | "medium" | "low" | "unknown"
  importanceScore?: number
  executableScore?: number
  qualityScore?: number
  sourceDocType?: TaskContextPack["docRole"]
  generationSource?: "meeting_action" | "manual_confirmed" | "derived_from_review"
  completionSources?: string[]
  rulePackRefs?: string[]
  roleContextRefs?: string[]
  extractionWarnings?: string[]
  quality?: TaskCardQualityScorecard
}

export interface TaskCardQualityScorecard {
  score: number
  completenessScore?: number
  executableScore?: number
  evidenceScore?: number
  level: "ready" | "needs_review"
  missingElements: string[]
  strengths: string[]
  reviewNotes: string[]
}

export interface TaskQualitySummary {
  total: number
  ready: number
  needsReview: number
  averageScore: number
  topMissingElements: string[]
}

export interface TaskSourcePolicy {
  sourceDocRole: TaskContextPack["docRole"]
  canGenerateTaskCards: boolean
  canProvideRules: boolean
  canProvideRoleContext: boolean
  canProvideMetrics: boolean
  defaultIndexVisibility: "task_index" | "context_only" | "hidden"
}

export interface TaskRulePack {
  taxonomyRef?: string
  requiredElements: string[]
  taskElements?: TaskTaxonomyElement[]
  moduleClassificationRules?: Array<{
    moduleId: TaskModule
    label: string
    aliases: string[]
    examples: string[]
  }>
  fieldExtractionRules?: string[]
  qualityRules?: string[]
  scoringWeights: Record<string, number>
  qualityLevels: string[]
  reviewReasons: string[]
  taskTemplates: string[]
  fixSuggestions: string[]
  evidenceRefs: string[]
}

export interface RoleContextIndex {
  roles: TaskRoleProfile[]
  responsibilities: string[]
  kpis: string[]
  collaboratorRoles: string[]
  ownerInferenceHints: string[]
  evidenceRefs: string[]
}

export interface TaskContextPack {
  schemaVersion: "task_context_pack_v1"
  packId: string
  sourceDocId: string
  sourceName: string
  sourcePath: string
  sourceKind: SourceKind
  docRole: "role_kpi_source" | "meeting_task_source" | "task_mechanism_source" | "mixed_task_source" | "unknown"
  operatingGoals: TaskEvidenceText[]
  roleProfiles: TaskRoleProfile[]
  taskTriggers: TaskEvidenceText[]
  taskCandidates: TaskCardDraft[]
  metricRules: TaskEvidenceText[]
  collaborationRules: TaskEvidenceText[]
  reviewRules: TaskEvidenceText[]
  sourcePolicy?: TaskSourcePolicy
  taskRulePack?: TaskRulePack | null
  taskTaxonomy?: TaskTaxonomy | null
  roleContextIndex?: RoleContextIndex | null
  evidenceAnchors: string[]
  qualityWarnings: string[]
  taskQualitySummary?: TaskQualitySummary
}

export type SourceKind = "pdf" | "docx" | "doc" | "xmind" | "xlsx" | "xls" | "ods" | "generic"
export type PdfBackendMode = "pdfium" | "opendataloader"
export type DocumentBackendMode =
  | PdfBackendMode
  | "docx_core"
  | "docx_enhanced"
  | "xmind_core"
  | "spreadsheet_core"
  | "soffice_docx_bridge"
  | "generic"

export interface DocumentBackendStatus {
  mode: DocumentBackendMode
  status: "ready" | "fallback" | "error" | "unavailable"
  detail: string
  degraded: boolean
}

export interface SourceAnchor {
  anchorId: string
  label: string
  blockId?: string | null
  page?: number | null
  nodePath?: string[]
}

export interface RawParserTable {
  tableId: string
  headingPath: string[]
  headers: string[]
  rows: string[][]
  sourceAnchorId?: string | null
}

export interface RawParserImage {
  imageId: string
  assetPath: string
  title?: string
  page?: number | null
  sourceAnchorId?: string | null
  approximateAnchor?: boolean
  caption?: string
}

export interface RawParserRevisionMark {
  markId: string
  kind: string
  text: string
  sourceAnchorId?: string | null
}

export interface MindmapNode {
  nodeId: string
  title: string
  nodePath: string[]
  notes?: string
  labels: string[]
  markers: string[]
  attachmentRefs: string[]
  imageRefs: string[]
  relationshipRefs: string[]
  childNodeIds: string[]
}

export interface RawParserBundle {
  plainText: string
  analysisMarkdown: string
  headingCandidates: string[]
  tables: RawParserTable[]
  images: RawParserImage[]
  revisionMarks: RawParserRevisionMark[]
  mindmapNodes: MindmapNode[]
  sourceAnchors: SourceAnchor[]
  warnings: string[]
}

export interface NormalizedTable {
  tableId: string
  headingPath: string[]
  headers: string[]
  rows: string[][]
  sourceAnchorId?: string | null
}

export interface DecisionPoint {
  title: string
  condition: string
  action: string
  evidenceBlockRefs: string[]
}

export interface EntityCandidate {
  name: string
  entityType: string
  aliases: string[]
  evidenceBlockRefs: string[]
  confidence: number
}

export type BusinessObjectType =
  | "audience_segment"
  | "value_proposition"
  | "creative_asset_pattern"
  | "metric_signal"
  | "optimization_action"

export type BusinessRelationType =
  | "cares_about"
  | "expressed_by"
  | "influences"
  | "triggers"
  | "targets"
  | "tests"

export interface BusinessObjectProjection {
  objectId: string
  objectType: BusinessObjectType
  label: string
  summary: string
  evidenceBlockRefs: string[]
  confidence: number
}

export interface BusinessRelationProjection {
  relationId: string
  type: BusinessRelationType
  fromObjectId: string
  toObjectId: string
  rationale: string
  evidenceBlockRefs: string[]
  confidence: number
}

export interface NormalizedDocumentBundle {
  sourceKind: SourceKind
  sourcePath: string
  analysisMarkdown: string
  plainText: string
  headings: string[]
  tables: NormalizedTable[]
  images: RawParserImage[]
  revisionMarks: RawParserRevisionMark[]
  mindmapNodes: MindmapNode[]
  sourceAnchors: SourceAnchor[]
  sopSteps: string[]
  businessRules: string[]
  decisionPoints: DecisionPoint[]
  entityCandidates: EntityCandidate[]
  missingFieldKeys: string[]
  mindmapSummary: string[]
  warnings: string[]
}

export interface EnhancedDocumentArtifactManifest {
  docId: string
  sourcePath: string
  sourceKind: SourceKind
  backend: DocumentBackendMode
  artifactSchemaVersion?: number
  sourceFingerprint?: FileFingerprint
  prepareOptionsSignature?: string
  generatedAt: string
  outputDir: string
  analysisPath: string | null
  markdownPath: string | null
  jsonPath: string | null
  htmlPath: string | null
  normalizedPath: string | null
  documentIrPath: string | null
  convertedSourcePath?: string | null
  assetDirPath?: string | null
  pageCount: number | null
  ocrUsed: boolean
  degraded: boolean
  detail: string
  availableEnhancers?: string[]
  missingEnhancers?: string[]
  warnings?: string[]
}

export type EnhancedPdfArtifactManifest = EnhancedDocumentArtifactManifest

export interface PreparedDocumentArtifact {
  sourceKind: SourceKind
  backendStatus: DocumentBackendStatus
  artifactManifest: EnhancedDocumentArtifactManifest | null
  analysisMarkdown: string | null
  enhancedMarkdown?: string | null
  documentIr: DocumentIR | null
  normalizedBundle: NormalizedDocumentBundle | null
  convertedSourcePath?: string | null
}

export type PreparedPdfIngestArtifact = PreparedDocumentArtifact

export interface DocumentUnderstanding {
  title: string
  summary: string
  mainlineSteps: string[]
  sopSteps: string[]
  keyJudgements: string[]
  businessRules: string[]
  decisionPoints: DecisionPoint[]
  entityCandidates: EntityCandidate[]
  businessObjects: BusinessObjectProjection[]
  businessRelations: BusinessRelationProjection[]
  evidenceHighlights: string[]
  imageEvidenceHighlights: string[]
  mindmapSummary: string[]
  terminology: string[]
  risks: string[]
  openQuestions: string[]
  missingFieldKeys: string[]
}

export interface GroundTruthFieldValue {
  key: string
  label: string
  value: string
  semanticUnitIds?: string[]
  evidenceBlockRefs: string[]
  notes?: string
  status: GroundTruthFieldStatus
  lastUpdatedAt: string
  updatedFromCardId: string | null
  acceptedPatchIds: string[]
}

export interface GroundTruthDraft {
  docId: string
  sceneId: string
  title: string
  fields: GroundTruthFieldValue[]
  mainlineSteps: string[]
  keyJudgements: string[]
  boundaries: string[]
  evidenceNotes: string[]
  evaluationContentPath: string
  revisionCount: number
  lastAcceptedCardId: string | null
  updatedAt: string
  lastUpdatedAt: string
}

export interface FieldAssessment {
  fieldKey: string
  label: string
  status: FieldCoverageStatus
  score: number
  rationale: string
  evidenceBlockRefs: string[]
  recommendedAction: ImprovementActionType
  issueScope: "source_document"
  rootCause: RootCause | null
  blocking: boolean
}

export interface BlockAssessment {
  issueId: string
  blockId: string
  issueType: BlockIssueType
  severity: IssueSeverity
  confidence: number
  linkedFieldKeys: string[]
  whyProblematic: string
  sourceRefs: string[]
  issueScope: "source_document"
  rootCause: RootCause
  blocking: boolean
}

export interface RevisionIssueCard {
  issueId: string
  cardId: string
  primaryBlockId: string | null
  anchorBlockId: string | null
  targetFieldKey: string | null
  issueTitle: string
  issueType: BlockIssueType
  severity: IssueSeverity
  confidence: number
  originalExcerpt: string
  diagnosis: string
  suggestedRevision: string
  followupQuestion: string | null
  patchMode: PatchMode
  linkedFieldKeys: string[]
  sourceRefs: string[]
  status: RevisionCardStatus
  issueScope: "source_document"
  rootCause: RootCause
  blocking: boolean
  impactsDimensions: string[]
}

export interface ReviewSummary {
  highPriorityCount: number
  mediumPriorityCount: number
  lowPriorityCount: number
  criticalThemes: string[]
  nextBestAction: string
}

export interface ImprovementTask {
  taskId: string
  title: string
  targetBlockIds: string[]
  targetField: string
  actionType: ImprovementActionType
  priority: ImprovementPriority
  rationale: string
  promptSeed: string
  status: "open" | "selected" | "done" | "dismissed"
}

export interface SceneCompilePagePlan {
  pageKey: string
  title: string
  path: string
  pageType:
    | "business_index"
    | "mainline_steps"
    | "key_judgements"
    | "boundaries"
    | "evidence_cases"
    | "source_summary"
    | "mindmap_structure"
    | "task_roles"
    | "task_cards"
    | "task_quality"
    | "task_collaboration"
    | "task_reviews"
    | "hero_audiences"
    | "hero_value_props"
    | "hero_creative_assets"
    | "hero_metric_judgement"
    | "hero_actions_experiments"
  sectionKeys: string[]
  requiredFieldKeys: string[]
  promoteToReference?: boolean
}

export interface SceneCompilePlan {
  docId: string
  sceneId: string
  compileMode: "scene_business_dominant"
  pagePlans: SceneCompilePagePlan[]
  sectionMappings: Record<string, string>
  fieldToPageMap: Record<string, string>
  requiredFieldKeys: string[]
}

export interface CompileIR {
  sourceSummary: string
  taskContextPack?: TaskContextPack | null
  consumedSemanticUnitIds?: string[]
  unresolvedSemanticRelationIds?: string[]
  mainlineSteps: string[]
  sopSteps: string[]
  keyJudgements: string[]
  businessRules: string[]
  decisionPoints: DecisionPoint[]
  boundaries: string[]
  evidenceCases: string[]
  imageEvidence: string[]
  imageEvidenceRefs?: KnowledgeImageEvidenceRef[]
  metrics: string[]
  keyEntities: EntityCandidate[]
  businessObjects: BusinessObjectProjection[]
  businessRelations: BusinessRelationProjection[]
  fieldValueMap: Record<string, string>
  fieldLabelMap: Record<string, string>
  fieldEvidenceMap: Record<string, string[]>
  revisionSignals: string[]
  terminology: string[]
  mindmapSummary?: string[]
  openQuestions: string[]
  sourceRefsByField: Record<string, string[]>
}

export interface KnowledgeImageEvidenceRef {
  imageId: string
  url: string
  caption: string
  sourceRef: string
  sourceAnchorId?: string | null
  page?: number | null
}

export interface CompileCoverageEntry {
  fieldKey: string
  label: string
  written: boolean
  pageKey: string | null
  pagePath: string | null
  sectionKey: string | null
  evidenceRefs: string[]
  rootCause:
    | "written"
    | "missing_value"
    | "missing_page_plan"
    | "missing_section_mapping"
    | "missing_source_ref"
    | "parser_missing"
    | "normalizer_drop"
    | "schema_unmapped"
    | "weak_evidence"
    | "missing_audience_projection"
    | "missing_selling_point_projection"
    | "missing_creative_asset_projection"
    | "missing_metric_projection"
    | "missing_action_projection"
    | "missing_relation_projection"
}

export interface CompileCoverageReport {
  docId: string
  generatedAt: string
  entries: CompileCoverageEntry[]
}

export type StrategyCardType =
  | "audience_segment_diagnosis"
  | "value_prop_selection"
  | "creative_asset_brief_generation"
  | "metric_signal_diagnosis"
  | "optimization_action_planning"
  | "experiment_validation_plan"
  | "generic"

export type StrategyCardStatus = "draft" | "confirmed" | "rejected" | "promoted_to_skill"

export type StrategyActionCardStatus = StrategyCardStatus

export interface StrategyCategory {
  categoryId: StrategyCardType
  label: string
  sourceFieldKeys: string[]
  actionCardIds: string[]
  summary: string
}

export interface StrategyActionCard {
  actionCardId: string
  fingerprint: string
  sceneId: string
  docId: string
  category: StrategyCardType
  title: string
  triggerCondition: string
  requiredInputs: string[]
  actionSteps: string[]
  outputArtifact: string
  validationMetrics: string[]
  evidenceRefs: string[]
  semanticUnitIds?: string[]
  blockedBySemanticRelationIds?: string[]
  wikiRefs: string[]
  missingInputs: string[]
  confidence: number
  skillFamily: StrategyCardType
  targetFieldKey?: string | null
  sourceFieldKeys: string[]
  sourceFindingIds?: string[]
  status: StrategyActionCardStatus
  createdAt: string
  updatedAt: string
}

export interface StrategyCard {
  cardId: string
  sceneId: string
  docId: string
  cardType: StrategyCardType
  title: string
  recommendation: string
  whyNow: string
  validationPlan: string
  evidenceRefs: string[]
  semanticUnitIds?: string[]
  blockedBySemanticRelationIds?: string[]
  linkedWikiRefs: string[]
  linkedDecisionPointIds: string[]
  targetFieldKey?: string | null
  sourceFindingIds?: string[]
  status: StrategyCardStatus
  createdAt: string
  updatedAt: string
}

export interface StrategyBundle {
  schemaVersion?: number
  bundleId: string
  docId: string
  sceneId: string
  title: string
  summary: string
  strategyMarkdown: string
  strategyCards: StrategyCard[]
  strategyCategories?: StrategyCategory[]
  actionCards?: StrategyActionCard[]
  warnings?: string[]
  llmEnhanced?: boolean
  linkedResearchFindingIds: string[]
  consumedSemanticUnitIds?: string[]
  unresolvedSemanticRelationIds?: string[]
  linkedRevisionCardIds: string[]
  linkedWikiRefs: string[]
  evidenceRefs: string[]
  generatedAt: string
}

export interface StrategyCoverageEntry {
  dimension:
    | "business_goal"
    | "audience_segment"
    | "value_proposition"
    | "creative_asset_pattern"
    | "metric_signal"
    | "optimization_action"
    | "validation_plan"
  covered: boolean
  detail: string
  linkedCardIds: string[]
  rootCause:
    | "written"
    | "missing_source_evidence"
    | "missing_decision_projection"
    | "missing_validation_plan"
    | "missing_scene_mapping"
    | "missing_trigger_condition"
    | "missing_action_steps"
    | "missing_output_artifact"
    | "missing_validation_metric"
    | "missing_wiki_refs"
    | "missing_evidence_refs"
    | "not_skill_ready"
}

export interface StrategyCoverageReport {
  docId: string
  generatedAt: string
  entries: StrategyCoverageEntry[]
}

export interface ProjectBrainBinding {
  projectPath: string
  brainRoot: string
  sourceRoot: string
  workspaceRoot: string
  schemaEnabled: boolean
  createdAt: string
  updatedAt: string
}

export type SkillPromotionState = "candidate" | "approved_pilot" | "approved_stable"

export interface StrategySkillCandidateManifest {
  skillId: string
  family: StrategyCardType
  title: string
  summary: string
  sceneId: string
  linkedDocIds: string[]
  originStrategyCardIds: string[]
  originActionCardIds?: string[]
  wikiRefs: string[]
  sourceRefs: string[]
  validationCriteria: string[]
  requiredInputs?: string[]
  outputArtifact?: string
  actionSteps?: string[]
  schemaVersion?: number
  promotionState: SkillPromotionState
  generatedAt: string
}

export interface ApprovedSkillSpec {
  skillId: string
  title: string
  sceneId: string
  tier: "pilot" | "stable"
  family: string
  path: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  executionSpec?: Record<string, unknown>
  wikiRefs: string[]
  sourceRefs: string[]
}

export type AgentRunMode =
  | "diagnose_document"
  | "generate_strategy"
  | "generate_asset_brief"
  | "validate_action_plan"

export interface AgentRunRequest {
  projectPath: string
  docId: string
  sceneId: string
  runMode: AgentRunMode
  selectedSkillIds: string[]
  groundingSources: string[]
  taskInput?: Record<string, unknown>
  createReviewItem?: boolean
}

export type ExecutionPhaseStatus = "pending" | "running" | "completed" | "degraded" | "failed" | "skipped"

export interface ExecutionTimelineEntry {
  phase: string
  status: ExecutionPhaseStatus
  title: string
  detail: string
  startedAt: string
  endedAt: string
  durationMs: number
  severity: "info" | "warning" | "error"
  data?: Record<string, unknown>
}

export interface AgentRunDegradationReason {
  code: string
  title: string
  detail: string
  recoverable: boolean
  recommendedAction: string
}

export type SkillStepStatus = "completed" | "degraded" | "failed" | "skipped"
export type SkillStepTaskType =
  | "read_file"
  | "local_tool"
  | "data_extract"
  | "data_transform"
  | "human_review"
  | "llm_reasoning"

export interface SkillStepTask {
  stepIndex: number
  stepTitle: string
  taskType: SkillStepTaskType
  toolName?: string
  contextRefs: string[]
  inputKeys: string[]
  dataNeeds: string[]
  expectedStepOutput: string
}

export interface SkillExecutionPlan {
  planId: string
  executionMode: string
  summary: string
  stepTasks: SkillStepTask[]
  requiredContextRefs: string[]
  expectedOutput: string
  humanReviewPoints: string[]
}

export interface SkillStepExecution {
  stepIndex: number
  stepTitle: string
  taskType?: SkillStepTaskType | string
  toolName?: string
  inputRefs: string[]
  contextRefs: string[]
  status: SkillStepStatus
  reasoningSummary?: string
  stepOutput: string
  evidenceRefs: string[]
  validationNotes: string[]
  nextConstraints?: string[]
  startedAt: string
  endedAt: string
  durationMs: number
  degradationReason?: AgentRunDegradationReason | null
}

export interface AgentRunResult {
  runId: string
  projectPath: string
  docId: string
  sceneId: string
  runMode: AgentRunMode
  selectedSkillIds: string[]
  groundingSources: string[]
  status?: "needs_input" | "running" | "completed" | "validation_failed" | "degraded" | "error"
  executedSkills?: Array<Record<string, unknown>>
  contextRefs?: string[]
  structuredOutput?: Record<string, unknown>
  validationErrors?: Array<Record<string, unknown>>
  executionTimeline?: ExecutionTimelineEntry[]
  degradationReason?: AgentRunDegradationReason | null
  stepExecutions?: SkillStepExecution[]
  executionPlan?: SkillExecutionPlan | Record<string, unknown>
  executionMode?: string
  reviewItemId?: string | null
  resultSummary: string
  trace: string[]
  outputArtifacts: string[]
  createdAt: string
}

export interface WikiCompileSidecar {
  docId: string
  compileMode: "two-stage+structuring"
  sourcePath: string
  sourceName: string
  structuredContext: string
  generatedAt: string
  qualityScore: number
  warnings: string[]
  compilePlan?: SceneCompilePlan
  compileCoverage?: CompileCoverageReport
}

export interface AgentModeReport {
  docId: string
  sourceKind: SourceKind
  sourceName: string
  sourcePath: string
  sourceContent: string
  sceneId: string
  generatedAt: string
  analysis: string
  documentIr: DocumentIR
  understanding: DocumentUnderstanding
  groundTruth: GroundTruthDraft
  fieldAssessments: FieldAssessment[]
  blockAssessments: BlockAssessment[]
  revisionIssueCards: RevisionIssueCard[]
  reviewSummary: ReviewSummary
  activeCriticalCardIds: string[]
  improvementTasks: ImprovementTask[]
  qualityScore: number
  qualitySummary: string
  sourceHealth: HealthScorecard
  publishGate: PublishGateDecision
  warnings: string[]
  llmEnhanced: boolean
  supportingWikiPages: string[]
  compileSidecar: WikiCompileSidecar
  compilePlan: SceneCompilePlan
  compileCoverage: CompileCoverageReport
  compileIr: CompileIR
  strategyBundle?: StrategyBundle | null
  strategyCoverage?: StrategyCoverageReport | null
  confirmedStrategyCardIds?: string[]
  documentBackend: DocumentBackendMode
  documentBackendStatus: DocumentBackendStatus
  documentArtifacts?: EnhancedDocumentArtifactManifest | null
  pdfArtifacts?: EnhancedPdfArtifactManifest | null
  taskContextPack?: TaskContextPack | null
}

export interface LoopTask {
  taskId: string
  taskType: LoopTaskType
  docId: string
  linkedCardId: string | null
  linkedLintIssueId: string | null
  targetFieldKey: string | null
  priority: ImprovementPriority
  status: LoopTaskStatus
  entryHint: string
  whyNow: string
}

export interface AgentLoopSession {
  loopId: string
  docId: string
  status: AgentLoopStatus
  triggerSource: TriggerSource
  iteration: number
  activeTaskId: string | null
  activeCardId: string | null
  completedCardIds: string[]
  deferredCardIds: string[]
  feedbackTaskIds: string[]
  lastRecomputeAt: string | null
  lastRecomputeMode: "partial"
  startedAt: string
  updatedAt: string
  recommendedValidationQuestion: string | null
  tasks: LoopTask[]
}

export interface AgentWorkbenchRuntime {
  phase: AgentWorkbenchPhase
  status: AgentWorkbenchPhaseStatus
  title: string
  detail: string
  docId: string | null
  taskId: string | null
  startedAt: string
  updatedAt: string
  completedArtifacts: string[]
  errorMessage?: string
  canRetry: boolean
}

export interface InteractiveMessage {
  id: string
  role: "system" | "assistant" | "user"
  content: string
  createdAt: string
}

export interface RevisionSuggestion {
  id: string
  sessionId: string
  docId: string
  cardId: string | null
  targetFieldKey: string | null
  targetBlockIds: string[]
  anchorBlockId: string | null
  actionType: ImprovementActionType
  patchMode: PatchMode
  suggestionText: string
  revisedMarkdown: string
  rationale: string
  writeTarget: "draft" | "ground_truth" | "both"
  createdAt: string
}

export interface InteractiveSession {
  sessionId: string
  docId: string
  sceneId: string
  taskId: string | null
  cardId: string | null
  primaryBlockId: string | null
  anchorBlockId: string | null
  targetBlockIds: string[]
  targetFieldKey: string | null
  goal: InteractiveGoal
  sessionGoal: string
  status: "active" | "completed"
  startedAt: string
  updatedAt: string
  messages: InteractiveMessage[]
  writebackPreview: string | null
  latestSuggestion: RevisionSuggestion | null
}

export interface RevisionPatch {
  patchId: string
  cardId: string | null
  targetBlockIds: string[]
  anchorBlockId: string | null
  patchMode: PatchMode
  revisedMarkdown: string
  appliedAt: string
}

export interface RevisionDraft {
  docId: string
  versionId: string
  sourcePath: string
  baseContent: string
  content: string
  updatedAt: string
  appliedSuggestionIds: string[]
  appliedPatches: RevisionPatch[]
}

export interface RevisionVersion {
  docId: string
  versionId: string
  sourcePath: string
  contentPath: string
  groundTruthPath: string
  qualityReportPath: string
  publishedAt: string
  wikiRebuildStatus: "pending" | "done" | "skipped" | "failed"
  sourcePublishGateStatus: GateStatus
  wikiPublishGateStatus: GateStatus
  publishedWithOverride: boolean
  overrideReason?: string
  wikiHealthReportPath?: string
}
