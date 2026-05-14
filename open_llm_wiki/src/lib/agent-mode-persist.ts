import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { getFileName, normalizePath } from "@/lib/path-utils"
import type {
  AgentLoopSession,
  AgentModeReport,
  BlockAssessment,
  FieldAssessment,
  GroundTruthDraft,
  InteractiveSession,
  LoopTask,
  RevisionIssueCard,
  RevisionPatch,
  RevisionDraft,
  RevisionVersion,
} from "@/lib/agent-mode-types"
import {
  buildEmptyHealthScorecard,
  buildEmptyPublishGateDecision,
  type RootCause,
} from "@/lib/quality-contracts"

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function normalizeSuggestion<T extends InteractiveSession["latestSuggestion"]>(raw: T): T {
  if (!raw) return raw
  return {
    ...raw,
    cardId: raw.cardId ?? null,
    targetFieldKey: raw.targetFieldKey ?? null,
    targetBlockIds: Array.isArray(raw.targetBlockIds) ? raw.targetBlockIds : [],
    anchorBlockId: raw.anchorBlockId ?? null,
    patchMode: raw.patchMode ?? "replace",
    suggestionText: raw.suggestionText ?? raw.revisedMarkdown ?? "",
    revisedMarkdown: raw.revisedMarkdown ?? raw.suggestionText ?? "",
  }
}

function normalizeRevisionDraft(raw: RevisionDraft | null, sourceContent = ""): RevisionDraft | null {
  if (!raw) return null
  return {
    ...raw,
    baseContent: raw.baseContent ?? raw.content ?? sourceContent,
    content: raw.content ?? sourceContent,
    appliedSuggestionIds: Array.isArray(raw.appliedSuggestionIds) ? raw.appliedSuggestionIds : [],
    appliedPatches: Array.isArray(raw.appliedPatches) ? raw.appliedPatches : [],
  }
}

function normalizeLoopTask(raw: LoopTask): LoopTask {
  return {
    ...raw,
    linkedCardId: raw.linkedCardId ?? null,
    linkedLintIssueId: raw.linkedLintIssueId ?? null,
    targetFieldKey: raw.targetFieldKey ?? null,
    status: raw.status ?? "open",
    taskType: raw.taskType ?? "revision_card",
    priority: raw.priority ?? "medium",
    entryHint: raw.entryHint ?? "",
    whyNow: raw.whyNow ?? "",
  }
}

function normalizeGroundTruthDraft(raw: GroundTruthDraft | null): GroundTruthDraft | null {
  if (!raw) return null
  const now = raw.updatedAt ?? new Date().toISOString()
  return {
    ...raw,
    evaluationContentPath: raw.evaluationContentPath ?? raw.docId,
    revisionCount: raw.revisionCount ?? 0,
    lastAcceptedCardId: raw.lastAcceptedCardId ?? null,
    updatedAt: raw.updatedAt ?? now,
    lastUpdatedAt: raw.lastUpdatedAt ?? raw.updatedAt ?? now,
    fields: Array.isArray(raw.fields)
      ? raw.fields.map((field) => ({
          ...field,
          evidenceBlockRefs: Array.isArray(field.evidenceBlockRefs) ? field.evidenceBlockRefs : [],
          status: field.status ?? (field.value?.trim() ? "seeded" : "inferred"),
          lastUpdatedAt: field.lastUpdatedAt ?? raw.updatedAt ?? now,
          updatedFromCardId: field.updatedFromCardId ?? null,
          acceptedPatchIds: Array.isArray(field.acceptedPatchIds) ? field.acceptedPatchIds : [],
        }))
      : [],
  }
}

function normalizeDocumentUnderstanding(raw: AgentModeReport["understanding"] | null) {
  if (!raw) return null
  return {
    ...raw,
    sopSteps: Array.isArray(raw.sopSteps) ? raw.sopSteps : raw.mainlineSteps ?? [],
    businessRules: Array.isArray(raw.businessRules) ? raw.businessRules : [],
    decisionPoints: Array.isArray(raw.decisionPoints) ? raw.decisionPoints : [],
    entityCandidates: Array.isArray(raw.entityCandidates) ? raw.entityCandidates : [],
    imageEvidenceHighlights: Array.isArray(raw.imageEvidenceHighlights) ? raw.imageEvidenceHighlights : [],
    mindmapSummary: Array.isArray(raw.mindmapSummary) ? raw.mindmapSummary : [],
    missingFieldKeys: Array.isArray(raw.missingFieldKeys) ? raw.missingFieldKeys : [],
  }
}

function normalizeAgentLoopSession(raw: AgentLoopSession | null): AgentLoopSession | null {
  if (!raw) return null
  return {
    ...raw,
    status: raw.status ?? "idle",
    triggerSource: raw.triggerSource ?? "manual_start",
    iteration: raw.iteration ?? 1,
    activeTaskId: raw.activeTaskId ?? null,
    activeCardId: raw.activeCardId ?? null,
    completedCardIds: Array.isArray(raw.completedCardIds) ? raw.completedCardIds : [],
    deferredCardIds: Array.isArray(raw.deferredCardIds) ? raw.deferredCardIds : [],
    feedbackTaskIds: Array.isArray(raw.feedbackTaskIds) ? raw.feedbackTaskIds : [],
    lastRecomputeAt: raw.lastRecomputeAt ?? null,
    lastRecomputeMode: "partial",
    recommendedValidationQuestion: raw.recommendedValidationQuestion ?? null,
    tasks: Array.isArray(raw.tasks) ? raw.tasks.map(normalizeLoopTask) : [],
  }
}

function normalizeInteractiveSession(raw: InteractiveSession | null): InteractiveSession | null {
  if (!raw) return null
  return {
    ...raw,
    cardId: raw.cardId ?? null,
    primaryBlockId: raw.primaryBlockId ?? null,
    anchorBlockId: raw.anchorBlockId ?? null,
    sessionGoal: raw.sessionGoal ?? "围绕当前修订卡补齐信息",
    writebackPreview: raw.writebackPreview ?? raw.latestSuggestion?.revisedMarkdown ?? raw.latestSuggestion?.suggestionText ?? null,
    latestSuggestion: normalizeSuggestion(raw.latestSuggestion),
  }
}

function inferRootCauseFromFieldKey(
  fieldKey: string,
  status: FieldAssessment["status"],
): RootCause | null {
  if (status === "covered") return null
  if (fieldKey === "judgment_criteria") {
    return status === "missing" ? "source_missing_required_field" : "source_weak_judgement_criteria"
  }
  if (fieldKey === "validation_methods") return "source_missing_validation_method"
  if (fieldKey === "exceptions_and_non_applicable_scope" || fieldKey === "boundaries") {
    return "source_missing_boundary_condition"
  }
  if (fieldKey === "execution_steps") return "source_execution_too_coarse"
  if (fieldKey === "evidence" || fieldKey === "source_refs" || fieldKey === "traceability") {
    return "source_weak_traceability"
  }
  return "source_missing_required_field"
}

function inferRootCauseFromBlockIssue(
  issueType: BlockAssessment["issueType"],
): RootCause {
  switch (issueType) {
    case "missing_criteria":
      return "source_weak_judgement_criteria"
    case "missing_validation":
      return "source_missing_validation_method"
    case "missing_boundary":
      return "source_missing_boundary_condition"
    case "source_grounding_gap":
      return "source_weak_traceability"
    case "structure_mismatch":
      return "source_execution_too_coarse"
    case "missing_required_field":
      return "source_missing_required_field"
    case "weak_field":
    default:
      return "source_missing_required_field"
  }
}

function normalizeAgentModeReport(raw: AgentModeReport | null): AgentModeReport | null {
  if (!raw) return null
  const legacyHealth = raw.sourceHealth ?? {
    ...buildEmptyHealthScorecard(raw.qualitySummary ?? "当前报告来自旧版本数据，建议重新生成原文质量评分。"),
    score: raw.qualityScore ?? 0,
    summary: raw.qualitySummary ?? "当前报告来自旧版本数据，建议重新生成原文质量评分。",
  }
  const legacyGate = raw.publishGate ?? {
    ...buildEmptyPublishGateDecision("revision_publish", "当前报告来自旧版本数据，建议重新计算发布门禁。"),
    status: "warn" as const,
    summary: "当前报告来自旧版本数据，建议重新计算发布门禁。",
  }
  return {
    ...raw,
    sourceKind: raw.sourceKind ?? "generic",
    understanding: normalizeDocumentUnderstanding(raw.understanding) ?? raw.understanding,
    groundTruth: normalizeGroundTruthDraft(raw.groundTruth) ?? raw.groundTruth,
    fieldAssessments: Array.isArray(raw.fieldAssessments)
      ? raw.fieldAssessments.map((item) => ({
          ...item,
          issueScope: "source_document" as const,
          rootCause: item.rootCause ?? inferRootCauseFromFieldKey(item.fieldKey, item.status),
          blocking: item.blocking ?? false,
        }))
      : [],
    blockAssessments: Array.isArray(raw.blockAssessments)
      ? raw.blockAssessments.map((item, index) => ({
          ...item,
          issueId: item.issueId ?? `legacy-block-${raw.docId}-${index + 1}`,
          issueScope: "source_document" as const,
          rootCause: item.rootCause ?? inferRootCauseFromBlockIssue(item.issueType),
          blocking: item.blocking ?? item.severity === "P1",
        }))
      : [],
    revisionIssueCards: Array.isArray(raw.revisionIssueCards)
      ? raw.revisionIssueCards.map((item, index) => ({
          ...item,
          issueId: item.issueId ?? item.cardId ?? `legacy-card-${raw.docId}-${index + 1}`,
          issueScope: "source_document" as const,
          rootCause: item.rootCause ?? inferRootCauseFromBlockIssue(item.issueType),
          blocking: item.blocking ?? item.severity === "P1",
          impactsDimensions: Array.isArray(item.impactsDimensions) ? item.impactsDimensions : [],
        }))
      : [],
    reviewSummary: raw.reviewSummary ?? {
      highPriorityCount: 0,
      mediumPriorityCount: 0,
      lowPriorityCount: 0,
      criticalThemes: [],
      nextBestAction: "请重新运行一次导入或结构化分析，以生成新的问题卡。",
    },
    activeCriticalCardIds: Array.isArray(raw.activeCriticalCardIds) ? raw.activeCriticalCardIds : [],
    sourceHealth: {
      ...legacyHealth,
      score: raw.qualityScore ?? legacyHealth.score,
      summary: raw.qualitySummary ?? legacyHealth.summary,
    },
    publishGate: legacyGate,
    qualityScore: raw.qualityScore ?? legacyHealth.score,
    qualitySummary: raw.qualitySummary ?? legacyHealth.summary,
    documentBackend: raw.documentBackend ?? "generic",
    documentBackendStatus: raw.documentBackendStatus ?? {
      mode: "generic",
      status: "ready",
      detail: "旧版本报告，未记录文档后端信息。",
      degraded: false,
    },
    strategyBundle: raw.strategyBundle ?? null,
    strategyCoverage: raw.strategyCoverage ?? null,
    confirmedStrategyCardIds: Array.isArray(raw.confirmedStrategyCardIds)
      ? raw.confirmedStrategyCardIds
      : (raw.strategyBundle?.strategyCards ?? [])
        .filter((card) => card.status === "confirmed" || card.status === "promoted_to_skill")
        .map((card) => card.cardId),
    documentArtifacts: raw.documentArtifacts ?? raw.pdfArtifacts ?? null,
  }
}

async function tryReadFile(path: string): Promise<string> {
  try {
    return await readFile(path)
  } catch {
    return ""
  }
}

export async function ensureAgentModeDirs(projectPath: string): Promise<void> {
  const pp = normalizePath(projectPath)
  await createDirectory(`${pp}/.llm-wiki/scene`).catch(() => {})
  await createDirectory(`${pp}/.llm-wiki/analysis`).catch(() => {})
  await createDirectory(`${pp}/.llm-wiki/document-ir`).catch(() => {})
  await createDirectory(`${pp}/.llm-wiki/document-understanding`).catch(() => {})
  await createDirectory(`${pp}/.llm-wiki/ground-truth`).catch(() => {})
  await createDirectory(`${pp}/.llm-wiki/field-assessments`).catch(() => {})
  await createDirectory(`${pp}/.llm-wiki/block-assessments`).catch(() => {})
  await createDirectory(`${pp}/.llm-wiki/improvement-plans`).catch(() => {})
  await createDirectory(`${pp}/.llm-wiki/revision-cards`).catch(() => {})
  await createDirectory(`${pp}/.llm-wiki/wiki-compile`).catch(() => {})
  await createDirectory(`${pp}/.llm-wiki/document-artifacts`).catch(() => {})
  await createDirectory(`${pp}/.llm-wiki/source-conversions`).catch(() => {})
  await createDirectory(`${pp}/.llm-wiki/agent-mode`).catch(() => {})
  await createDirectory(`${pp}/.llm-wiki/agent-loops`).catch(() => {})
  await createDirectory(`${pp}/.llm-wiki/interactive-sessions`).catch(() => {})
  await createDirectory(`${pp}/.llm-wiki/revisions`).catch(() => {})
  await createDirectory(`${pp}/.llm-wiki/strategy-cards`).catch(() => {})
  await createDirectory(`${pp}/.llm-wiki/strategy-coverage`).catch(() => {})
  await createDirectory(`${pp}/deliverables/revised-docs`).catch(() => {})
  await createDirectory(`${pp}/deliverables/ground-truth`).catch(() => {})
  await createDirectory(`${pp}/deliverables/reports`).catch(() => {})
  await createDirectory(`${pp}/ontology/scenes`).catch(() => {})
  await createDirectory(`${pp}/memory/skills/runs`).catch(() => {})
  await createDirectory(`${pp}/skills/candidates`).catch(() => {})
  await createDirectory(`${pp}/skills/approved`).catch(() => {})
  await createDirectory(`${pp}/memory/brain-binding`).catch(() => {})
}

export async function saveAgentModeReport(projectPath: string, report: AgentModeReport): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureAgentModeDirs(pp)
  await writeFile(`${pp}/.llm-wiki/analysis/${report.docId}.md`, report.analysis)
  await writeFile(`${pp}/.llm-wiki/document-ir/${report.docId}.json`, JSON.stringify(report.documentIr, null, 2))
  await writeFile(`${pp}/.llm-wiki/document-understanding/${report.docId}.json`, JSON.stringify(report.understanding, null, 2))
  await writeFile(
    `${pp}/.llm-wiki/ground-truth/${report.docId}.json`,
    JSON.stringify(normalizeGroundTruthDraft(report.groundTruth), null, 2),
  )
  await writeFile(`${pp}/.llm-wiki/field-assessments/${report.docId}.json`, JSON.stringify(report.fieldAssessments, null, 2))
  await writeFile(`${pp}/.llm-wiki/block-assessments/${report.docId}.json`, JSON.stringify(report.blockAssessments, null, 2))
  await writeFile(`${pp}/.llm-wiki/improvement-plans/${report.docId}.json`, JSON.stringify(report.improvementTasks, null, 2))
  await writeFile(`${pp}/.llm-wiki/revision-cards/${report.docId}.json`, JSON.stringify(report.revisionIssueCards, null, 2))
  await writeFile(`${pp}/.llm-wiki/wiki-compile/${report.docId}.json`, JSON.stringify(report.compileSidecar, null, 2))
  if (report.strategyBundle) {
    await writeFile(`${pp}/.llm-wiki/strategy-cards/${report.docId}.json`, JSON.stringify(report.strategyBundle, null, 2))
  }
  if (report.strategyCoverage) {
    await writeFile(`${pp}/.llm-wiki/strategy-coverage/${report.docId}.json`, JSON.stringify(report.strategyCoverage, null, 2))
  }
  await writeFile(`${pp}/.llm-wiki/agent-mode/${report.docId}.json`, JSON.stringify(report, null, 2))
  const rawIndex = await tryReadFile(`${pp}/.llm-wiki/agent-mode/index.json`)
  const index = safeJsonParse<string[]>(rawIndex, [])
  const nextIndex = Array.from(new Set([report.docId, ...index]))
  await writeFile(`${pp}/.llm-wiki/agent-mode/index.json`, JSON.stringify(nextIndex, null, 2))
}

export async function loadAgentModeReports(projectPath: string): Promise<AgentModeReport[]> {
  const pp = normalizePath(projectPath)
  const reportsIndexRaw = await tryReadFile(`${pp}/.llm-wiki/agent-mode/index.json`)
  if (reportsIndexRaw.trim()) {
    const index = safeJsonParse<string[]>(reportsIndexRaw, [])
    const reports = await Promise.all(
      index.map(async (docId) => {
        const raw = await tryReadFile(`${pp}/.llm-wiki/agent-mode/${docId}.json`)
        return raw.trim() ? normalizeAgentModeReport(safeJsonParse<AgentModeReport | null>(raw, null)) : null
      }),
    )
    return reports.filter((item): item is AgentModeReport => Boolean(item))
  }
  return []
}

export async function refreshAgentModeReportIndex(projectPath: string, reports: AgentModeReport[]): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureAgentModeDirs(pp)
  await writeFile(
    `${pp}/.llm-wiki/agent-mode/index.json`,
    JSON.stringify(reports.map((report) => report.docId), null, 2),
  )
}

export async function saveInteractiveSession(projectPath: string, session: InteractiveSession): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureAgentModeDirs(pp)
  await writeFile(`${pp}/.llm-wiki/interactive-sessions/${session.sessionId}.json`, JSON.stringify(session, null, 2))
  const rawIndex = await tryReadFile(`${pp}/.llm-wiki/interactive-sessions/index.json`)
  const index = safeJsonParse<string[]>(rawIndex, [])
  const nextIndex = Array.from(new Set([session.sessionId, ...index]))
  await writeFile(`${pp}/.llm-wiki/interactive-sessions/index.json`, JSON.stringify(nextIndex, null, 2))
}

export async function loadInteractiveSessions(projectPath: string): Promise<InteractiveSession[]> {
  const pp = normalizePath(projectPath)
  const raw = await tryReadFile(`${pp}/.llm-wiki/interactive-sessions/index.json`)
  const index = safeJsonParse<string[]>(raw, [])
  const sessions = await Promise.all(
    index.map(async (id) => {
      const content = await tryReadFile(`${pp}/.llm-wiki/interactive-sessions/${id}.json`)
      return content.trim() ? normalizeInteractiveSession(safeJsonParse<InteractiveSession | null>(content, null)) : null
    }),
  )
  return sessions.filter((item): item is InteractiveSession => Boolean(item))
}

export async function refreshInteractiveSessionIndex(projectPath: string, sessions: InteractiveSession[]): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureAgentModeDirs(pp)
  await writeFile(
    `${pp}/.llm-wiki/interactive-sessions/index.json`,
    JSON.stringify(sessions.map((session) => session.sessionId), null, 2),
  )
}

export async function ensureWorkingDraft(
  projectPath: string,
  docId: string,
  sourcePath: string,
  sourceContent: string,
): Promise<RevisionDraft> {
  const pp = normalizePath(projectPath)
  await ensureAgentModeDirs(pp)
  const draftDir = `${pp}/deliverables/revised-docs/${docId}`
  await createDirectory(draftDir).catch(() => {})
  const draftPath = `${draftDir}/draft.md`
  const existing = await tryReadFile(draftPath)
  if (existing.trim()) {
    const rawMeta = await tryReadFile(`${pp}/.llm-wiki/revisions/${docId}-draft.json`)
    const meta = rawMeta.trim() ? safeJsonParse<RevisionDraft | null>(rawMeta, null) : null
    return {
      docId,
      versionId: "draft",
      sourcePath,
      baseContent: meta?.baseContent ?? sourceContent,
      content: existing,
      updatedAt: new Date().toISOString(),
      appliedSuggestionIds: meta?.appliedSuggestionIds ?? [],
      appliedPatches: meta?.appliedPatches ?? [],
    }
  }
  await writeFile(draftPath, sourceContent)
  return {
    docId,
    versionId: "draft",
    sourcePath,
    baseContent: sourceContent,
    content: sourceContent,
    updatedAt: new Date().toISOString(),
    appliedSuggestionIds: [],
    appliedPatches: [],
  }
}

export async function saveRevisionDraft(projectPath: string, draft: RevisionDraft): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureAgentModeDirs(pp)
  await createDirectory(`${pp}/deliverables/revised-docs/${draft.docId}`).catch(() => {})
  await writeFile(`${pp}/deliverables/revised-docs/${draft.docId}/draft.md`, draft.content)
  await writeFile(`${pp}/.llm-wiki/revisions/${draft.docId}-draft.json`, JSON.stringify(draft, null, 2))
  const rawIndex = await tryReadFile(`${pp}/.llm-wiki/revisions/index.json`)
  const index = safeJsonParse<string[]>(rawIndex, [])
  const nextIndex = Array.from(new Set([draft.docId, ...index]))
  await writeFile(`${pp}/.llm-wiki/revisions/index.json`, JSON.stringify(nextIndex, null, 2))
}

export async function loadRevisionDrafts(projectPath: string): Promise<RevisionDraft[]> {
  const pp = normalizePath(projectPath)
  const raw = await tryReadFile(`${pp}/.llm-wiki/revisions/index.json`)
  const index = safeJsonParse<string[]>(raw, [])
  const drafts = await Promise.all(
    index.map(async (id) => {
      const content = await tryReadFile(`${pp}/.llm-wiki/revisions/${id}-draft.json`)
      return content.trim() ? normalizeRevisionDraft(safeJsonParse<RevisionDraft | null>(content, null)) : null
    }),
  )
  return drafts.filter((item): item is RevisionDraft => Boolean(item))
}

export async function refreshRevisionDraftIndex(projectPath: string, drafts: RevisionDraft[]): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureAgentModeDirs(pp)
  await writeFile(
    `${pp}/.llm-wiki/revisions/index.json`,
    JSON.stringify(drafts.map((draft) => draft.docId), null, 2),
  )
}

export async function saveGroundTruthDraftSnapshot(projectPath: string, draft: GroundTruthDraft): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureAgentModeDirs(pp)
  await createDirectory(`${pp}/deliverables/ground-truth/${draft.docId}`).catch(() => {})
  await writeFile(
    `${pp}/.llm-wiki/ground-truth/${draft.docId}.json`,
    JSON.stringify(normalizeGroundTruthDraft(draft), null, 2),
  )
  await writeFile(
    `${pp}/deliverables/ground-truth/${draft.docId}/draft.json`,
    JSON.stringify(normalizeGroundTruthDraft(draft), null, 2),
  )
}

export async function saveAgentLoopSession(projectPath: string, session: AgentLoopSession): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureAgentModeDirs(pp)
  const normalized = normalizeAgentLoopSession(session) ?? session
  await writeFile(`${pp}/.llm-wiki/agent-loops/${session.docId}.json`, JSON.stringify(normalized, null, 2))
  const rawIndex = await tryReadFile(`${pp}/.llm-wiki/agent-loops/index.json`)
  const index = safeJsonParse<string[]>(rawIndex, [])
  const nextIndex = Array.from(new Set([session.docId, ...index]))
  await writeFile(`${pp}/.llm-wiki/agent-loops/index.json`, JSON.stringify(nextIndex, null, 2))
}

export async function loadAgentLoopSessions(projectPath: string): Promise<AgentLoopSession[]> {
  const pp = normalizePath(projectPath)
  const raw = await tryReadFile(`${pp}/.llm-wiki/agent-loops/index.json`)
  const index = safeJsonParse<string[]>(raw, [])
  const sessions = await Promise.all(
    index.map(async (docId) => {
      const content = await tryReadFile(`${pp}/.llm-wiki/agent-loops/${docId}.json`)
      return content.trim()
        ? normalizeAgentLoopSession(safeJsonParse<AgentLoopSession | null>(content, null))
        : null
    }),
  )
  return sessions.filter((item): item is AgentLoopSession => Boolean(item))
}

export async function refreshAgentLoopSessionIndex(projectPath: string, sessions: AgentLoopSession[]): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureAgentModeDirs(pp)
  await writeFile(
    `${pp}/.llm-wiki/agent-loops/index.json`,
    JSON.stringify(sessions.map((session) => session.docId), null, 2),
  )
}

export async function appendQualityDraftReport(
  projectPath: string,
  docId: string,
  title: string,
  score: number,
  summary: string,
): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureAgentModeDirs(pp)
  await createDirectory(`${pp}/deliverables/reports/${docId}`).catch(() => {})
  const markdown = [
    `# ${title} 质量报告`,
    "",
    `- 文档 ID：${docId}`,
    `- 当前质量分：${score}/100`,
    "",
    "## 结论",
    "",
    summary,
    "",
    `更新时间：${new Date().toISOString()}`,
  ].join("\n")
  await writeFile(`${pp}/deliverables/reports/${docId}/quality-draft.md`, markdown)
}

export function makeVersionFileName(versionCount: number): string {
  return `v${String(versionCount).padStart(3, "0")}`
}

export async function loadRevisionVersions(projectPath: string): Promise<RevisionVersion[]> {
  const pp = normalizePath(projectPath)
  const raw = await tryReadFile(`${pp}/.llm-wiki/revisions/versions.json`)
  return safeJsonParse<RevisionVersion[]>(raw, []).map((item) => ({
    ...item,
    sourcePublishGateStatus: item.sourcePublishGateStatus ?? "warn",
    wikiPublishGateStatus: item.wikiPublishGateStatus ?? "warn",
    publishedWithOverride: item.publishedWithOverride ?? false,
    overrideReason: item.overrideReason,
    wikiHealthReportPath: item.wikiHealthReportPath,
  }))
}

export async function saveRevisionVersions(projectPath: string, versions: RevisionVersion[]): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureAgentModeDirs(pp)
  await writeFile(`${pp}/.llm-wiki/revisions/versions.json`, JSON.stringify(versions, null, 2))
}

export async function saveRevisionVersion(projectPath: string, version: RevisionVersion): Promise<void> {
  const versions = await loadRevisionVersions(projectPath)
  const merged = [version, ...versions.filter((item) => item.versionId !== version.versionId)]
  await saveRevisionVersions(projectPath, merged)
}

export async function saveBlockAssessments(
  projectPath: string,
  docId: string,
  blockAssessments: BlockAssessment[],
): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureAgentModeDirs(pp)
  await writeFile(`${pp}/.llm-wiki/block-assessments/${docId}.json`, JSON.stringify(blockAssessments, null, 2))
}

export async function saveRevisionCards(
  projectPath: string,
  docId: string,
  cards: RevisionIssueCard[],
): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureAgentModeDirs(pp)
  await writeFile(`${pp}/.llm-wiki/revision-cards/${docId}.json`, JSON.stringify(cards, null, 2))
}

export async function saveRevisionPatches(
  projectPath: string,
  docId: string,
  patches: RevisionPatch[],
): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureAgentModeDirs(pp)
  await writeFile(`${pp}/.llm-wiki/revisions/${docId}-patches.json`, JSON.stringify(patches, null, 2))
}

export function renderDraftMarkdown(title: string, content: string): string {
  const trimmed = content.trim()
  if (trimmed.startsWith("#")) return trimmed
  return [`# ${title}`, "", trimmed].join("\n")
}

export function projectDocTitle(sourcePath: string): string {
  return getFileName(sourcePath).replace(/\.[^.]+$/, "")
}
