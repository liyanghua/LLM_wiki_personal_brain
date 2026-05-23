import { invoke } from "@tauri-apps/api/core"
import type { FileNode, WikiProject } from "@/types/wiki"
import { ensureProjectId, upsertProjectInfo } from "@/lib/project-identity"

/** Raw shape returned by the Rust commands — id is attached client-side. */
interface RawProject {
  name: string
  path: string
}

export async function readFile(path: string): Promise<string> {
  return invoke<string>("read_file", { path })
}

export async function writeFile(path: string, contents: string): Promise<void> {
  return invoke<void>("write_file", { path, contents })
}

export async function listDirectory(path: string): Promise<FileNode[]> {
  return invoke<FileNode[]>("list_directory", { path })
}

export async function copyFile(
  source: string,
  destination: string
): Promise<void> {
  return invoke("copy_file", { source, destination })
}

export async function preprocessFile(path: string): Promise<string> {
  return invoke<string>("preprocess_file", { path })
}

export interface FileFingerprintStat {
  sourcePath: string
  sizeBytes: number
  modifiedMs: number
}

export async function fileFingerprint(path: string): Promise<FileFingerprintStat> {
  return invoke<FileFingerprintStat>("file_fingerprint", { path })
}

export async function deleteFile(path: string): Promise<void> {
  return invoke("delete_file", { path })
}

export async function findRelatedWikiPages(
  projectPath: string,
  sourceName: string
): Promise<string[]> {
  return invoke<string[]>("find_related_wiki_pages", { projectPath, sourceName })
}

export async function createDirectory(path: string): Promise<void> {
  return invoke<void>("create_directory", { path })
}

export async function fileExists(path: string): Promise<boolean> {
  return invoke<boolean>("file_exists", { path })
}

/** Mirror of `commands::fs::FileBase64` (Rust side). */
export interface FileBase64 {
  base64: string
  mimeType: string
}

/**
 * Read any file off disk as base64 + a guessed mime type. The
 * vision-caption pipeline uses this to pick up extracted images
 * without having to read them as UTF-8 strings (PNG bytes aren't
 * valid UTF-8 — `readFile` would corrupt them).
 */
export async function readFileAsBase64(path: string): Promise<FileBase64> {
  return invoke<FileBase64>("read_file_as_base64", { path })
}

export async function createProject(
  name: string,
  path: string,
): Promise<WikiProject> {
  const raw = await invoke<RawProject>("create_project", { name, path })
  const id = await ensureProjectId(raw.path)
  await upsertProjectInfo(id, raw.path, raw.name)
  return { id, name: raw.name, path: raw.path }
}

export async function openProject(path: string): Promise<WikiProject> {
  const raw = await invoke<RawProject>("open_project", { path })
  const id = await ensureProjectId(raw.path)
  await upsertProjectInfo(id, raw.path, raw.name)
  return { id, name: raw.name, path: raw.path }
}

export async function clipServerStatus(): Promise<string> {
  return invoke<string>("clip_server_status")
}

export interface PdfBackendArtifactResult {
  backend: "pdfium" | "opendataloader"
  status: "ready" | "fallback" | "error" | "unavailable"
  detail: string
  degraded: boolean
  markdownPath: string | null
  jsonPath: string | null
  htmlPath: string | null
  pageCount: number | null
  ocrUsed: boolean
}

export interface DocumentBackendArtifactResult {
  sourceKind: "pdf" | "docx" | "doc" | "xmind" | "xlsx" | "xls" | "ods" | "generic"
  backend:
    | "pdfium"
    | "opendataloader"
    | "docx_core"
    | "docx_enhanced"
    | "xmind_core"
    | "spreadsheet_core"
    | "soffice_docx_bridge"
    | "generic"
  status: "ready" | "fallback" | "error" | "unavailable"
  detail: string
  degraded: boolean
  analysisPath: string | null
  markdownPath: string | null
  jsonPath: string | null
  htmlPath: string | null
  normalizedPath: string | null
  documentIrPath: string | null
  convertedSourcePath: string | null
  assetDirPath: string | null
  pageCount: number | null
  ocrUsed: boolean
  availableEnhancers: string[]
  missingEnhancers: string[]
  warnings: string[]
}

export async function analyzePdfWithBackend(
  sourcePath: string,
  outputDir: string,
  backendMode: "pdfium" | "opendataloader",
): Promise<PdfBackendArtifactResult> {
  return invoke<PdfBackendArtifactResult>("analyze_pdf_with_backend", {
    sourcePath,
    outputDir,
    backendMode,
  })
}

export async function analyzeDocumentWithBackend(
  projectPath: string,
  sourcePath: string,
  outputDir: string,
  sourceKind: DocumentBackendArtifactResult["sourceKind"],
  options?: {
    multimodalEnabled?: boolean
    multimodalAvailable?: boolean
  },
): Promise<DocumentBackendArtifactResult> {
  return invoke<DocumentBackendArtifactResult>("analyze_document_with_backend", {
    projectPath,
    sourcePath,
    outputDir,
    sourceKind,
    multimodalEnabled: options?.multimodalEnabled ?? false,
    multimodalAvailable: options?.multimodalAvailable ?? false,
  })
}

export async function convertDocToDocx(
  sourcePath: string,
  outputDir: string,
): Promise<string> {
  return invoke<string>("convert_doc_to_docx", {
    sourcePath,
    outputDir,
  })
}

export interface ProjectBrainBindingResult {
  projectPath: string
  brainRoot: string
  sourceRoot: string
  workspaceRoot: string
  schemaEnabled: boolean
  createdAt: string
  updatedAt: string
}

export interface StrategySkillCandidateManifestResult {
  skillId: string
  family: string
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
  promotionState: string
  generatedAt: string
}

export interface ApprovedSkillSpecResult {
  skillId: string
  title: string
  sceneId: string
  tier: string
  family: string
  path: string
  wikiRefs: string[]
  sourceRefs: string[]
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  executionSpec?: Record<string, unknown>
}

export type ExecutionPhaseStatus = "pending" | "running" | "completed" | "degraded" | "failed" | "skipped"

export interface ExecutionTimelineEntryResult {
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

export interface AgentRunDegradationReasonResult {
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

export interface SkillStepTaskResult {
  stepIndex: number
  stepTitle: string
  taskType: SkillStepTaskType
  toolName?: string
  contextRefs: string[]
  inputKeys: string[]
  dataNeeds: string[]
  expectedStepOutput: string
}

export interface SkillExecutionPlanResult {
  planId: string
  executionMode: string
  summary: string
  stepTasks: SkillStepTaskResult[]
  requiredContextRefs: string[]
  expectedOutput: string
  humanReviewPoints: string[]
}

export interface SkillStepExecutionResult {
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
  degradationReason?: AgentRunDegradationReasonResult | null
}

export interface ProjectAgentRunResult {
  runId: string
  projectPath: string
  docId: string
  sceneId: string
  runMode: string
  selectedSkillIds: string[]
  groundingSources: string[]
  status?: "needs_input" | "running" | "completed" | "validation_failed" | "degraded" | "error"
  executedSkills?: Array<Record<string, unknown>>
  contextRefs?: string[]
  structuredOutput?: Record<string, unknown>
  validationErrors?: Array<Record<string, unknown>>
  executionTimeline?: ExecutionTimelineEntryResult[]
  degradationReason?: AgentRunDegradationReasonResult | null
  stepExecutions?: SkillStepExecutionResult[]
  executionPlan?: SkillExecutionPlanResult | Record<string, unknown>
  executionMode?: string
  reviewItemId?: string | null
  resultSummary: string
  trace: string[]
  outputArtifacts: string[]
  createdAt: string
}

export async function ensureProjectBrainBinding(
  projectPath: string,
): Promise<ProjectBrainBindingResult> {
  return invoke<ProjectBrainBindingResult>("ensure_project_brain_binding", { projectPath })
}

export async function generateStrategySkillCandidates(
  projectPath: string,
  docId: string,
  sceneId: string,
): Promise<StrategySkillCandidateManifestResult[]> {
  return invoke<StrategySkillCandidateManifestResult[]>("generate_strategy_skill_candidates", {
    projectPath,
    docId,
    sceneId,
  })
}

export async function approveStrategySkill(
  projectPath: string,
  skillId: string,
  tier: "pilot" | "stable",
): Promise<ApprovedSkillSpecResult> {
  return invoke<ApprovedSkillSpecResult>("approve_strategy_skill", {
    projectPath,
    skillId,
    tier,
  })
}

export async function runProjectAgent(
  projectPath: string,
  payload: {
    projectPath: string
    docId: string
    sceneId: string
    runMode: "diagnose_document" | "generate_strategy" | "generate_asset_brief" | "validate_action_plan"
    selectedSkillIds: string[]
    groundingSources: string[]
    taskInput?: Record<string, unknown>
    createReviewItem?: boolean
  },
): Promise<ProjectAgentRunResult> {
  return invoke<ProjectAgentRunResult>("run_project_agent", {
    projectPath,
    payloadJson: JSON.stringify(payload),
  })
}
