export type ResearchPhase =
  | "clarify_scope"
  | "plan_queries"
  | "search_sources"
  | "extract_learnings"
  | "branch_followups"
  | "synthesize_report"
  | "save_research_asset"

export type ResearchStatus =
  | "idle"
  | "needs_input"
  | "blocked"
  | "running"
  | "done"
  | "error"

export type ResearchThreadEntryKind =
  | "clarification_requested"
  | "clarification_answered"
  | "queries_planned"
  | "search_started"
  | "search_result_selected"
  | "source_fetched"
  | "learning_extracted"
  | "followup_generated"
  | "report_generated"
  | "finding_extracted"
  | "finding_promoted"
  | "degraded"
  | "error"

export type ResearchFindingPromotionState =
  | "idle"
  | "promoted_to_revision"
  | "promoted_to_review"
  | "promoted_to_wiki_draft"

export interface ResearchProviderStatus {
  provider: "firecrawl" | "tavily" | "none"
  degraded: boolean
  detail: string
}

export interface ResearchThreadEntry {
  entryId: string
  sessionId: string
  phase: ResearchPhase
  kind: ResearchThreadEntryKind
  title: string
  detail: string
  createdAt: string
  query?: string | null
  url?: string | null
  findingId?: string | null
  data?: Record<string, unknown> | null
}

export interface StructuredFollowUp {
  followUpQuestion: string
  reason: string
  derivedFromLearning: string
  priority: "high" | "medium" | "low"
}

export interface ResearchReportSection {
  key:
    | "research_question"
    | "scope_and_assumptions"
    | "core_findings"
    | "evidence_sources"
    | "open_questions"
    | "revision_suggestions"
  title: string
  content: string
}

export interface ResearchReportSections {
  sections: ResearchReportSection[]
  parsed: boolean
}

export interface ResearchSourceEvidence {
  id: string
  query: string
  url: string
  title: string
  snippet: string
  source: string
  rawContent?: string | null
  reliabilityNote?: string | null
  learnedFacts: string[]
  openFollowUps: string[]
}

export interface ResearchFinding {
  id: string
  findingId: string
  kind: "business_conclusion" | "revision_suggestion"
  title: string
  summary: string
  evidenceSummary: string
  sourceUrls: string[]
  linkedDocId?: string | null
  targetFieldKey?: string | null
  researchSessionId?: string | null
  researchFindingId?: string | null
  promotionState: ResearchFindingPromotionState
}

export interface ResearchRuntime {
  sessionId: string
  phase: ResearchPhase
  status: ResearchStatus
  title: string
  detail: string
  currentRound: number
  maxDepth: number
  providerStatus?: ResearchProviderStatus | null
  visitedUrls: string[]
  learnings: string[]
  followUpQuestions: string[]
  pendingUserAnswers: string[]
  currentQueries: string[]
  acceptedSourcesCount: number
  completedArtifacts: string[]
  errorMessage?: string | null
  canResume: boolean
}

export interface ResearchSession {
  sessionId: string
  topic: string
  projectPath: string
  linkedDocId?: string | null
  targetFieldKey?: string | null
  triggerSource?: string | null
  breadth: number
  depth: number
  focus?: string | null
  status: ResearchStatus
  phase: ResearchPhase
  createdAt: number
  updatedAt: number
  followUpQuestions: string[]
  userAnswers: string[]
  plannedQueries: string[]
  sources: ResearchSourceEvidence[]
  learnings: string[]
  pendingFollowUps: StructuredFollowUp[]
  reportMarkdown: string
  notesMarkdown: string
  findings: ResearchFinding[]
  reportSections?: ResearchReportSections | null
  thread: ResearchThreadEntry[]
  visitedQueries: string[]
  currentRound: number
  providerStatus?: ResearchProviderStatus | null
  runtime: ResearchRuntime
  artifactDir?: string | null
  reportPath?: string | null
  sessionPath?: string | null
  sourcesPath?: string | null
  notesPath?: string | null
  errorMessage?: string | null
}

export interface EnterResearchWorkbenchInput {
  topic?: string
  linkedDocId?: string | null
  targetFieldKey?: string | null
  triggerSource?: string | null
  breadth?: number
  depth?: number
  focus?: string | null
  searchQueries?: string[]
}
