import type { TFunction } from "i18next"

export type FileTreeTone = "business" | "system" | "neutral"

export interface FileTreeDisplayMeta {
  displayName: string
  rawName: string
  hint?: string
  defaultExpanded: boolean
  tone: FileTreeTone
}

interface AliasDefinition {
  key: string
  defaultExpanded: boolean
  tone: FileTreeTone
  hintKey?: string
}

const ALIAS_MAP: Record<string, AliasDefinition> = {
  "raw": { key: "rawRoot", defaultExpanded: true, tone: "business" },
  "raw/sources": { key: "rawSources", defaultExpanded: true, tone: "business" },
  "raw/sources/.cache": { key: "rawSourcesCache", defaultExpanded: false, tone: "system" },

  "wiki": { key: "wikiRoot", defaultExpanded: true, tone: "business" },
  "wiki/business": { key: "wikiBusiness", defaultExpanded: true, tone: "business" },
  "wiki/entities": { key: "wikiEntities", defaultExpanded: false, tone: "business" },
  "wiki/concepts": { key: "wikiConcepts", defaultExpanded: false, tone: "business" },
  "wiki/sources": { key: "wikiSources", defaultExpanded: false, tone: "business" },
  "wiki/queries": { key: "wikiQueries", defaultExpanded: false, tone: "business" },
  "wiki/synthesis": { key: "wikiSynthesis", defaultExpanded: false, tone: "business" },
  "wiki/comparisons": { key: "wikiComparisons", defaultExpanded: false, tone: "business" },

  "deliverables": { key: "deliverablesRoot", defaultExpanded: true, tone: "business" },
  "deliverables/revised-docs": { key: "deliverablesRevisedDocs", defaultExpanded: false, tone: "business" },
  "deliverables/ground-truth": { key: "deliverablesGroundTruth", defaultExpanded: false, tone: "business" },
  "deliverables/reports": { key: "deliverablesReports", defaultExpanded: false, tone: "business" },

  ".llm-wiki": { key: "systemRoot", defaultExpanded: false, tone: "system" },
  ".llm-wiki/agent-mode": { key: "systemAgentMode", defaultExpanded: false, tone: "system" },
  ".llm-wiki/agent-loops": { key: "systemAgentLoops", defaultExpanded: false, tone: "system" },
  ".llm-wiki/interactive-sessions": { key: "systemInteractiveSessions", defaultExpanded: false, tone: "system" },
  ".llm-wiki/revision-cards": { key: "systemRevisionCards", defaultExpanded: false, tone: "system" },
  ".llm-wiki/revisions": { key: "systemRevisions", defaultExpanded: false, tone: "system" },
  ".llm-wiki/ground-truth": { key: "systemGroundTruth", defaultExpanded: false, tone: "system" },
  ".llm-wiki/document-ir": { key: "systemDocumentIr", defaultExpanded: false, tone: "system" },
  ".llm-wiki/document-understanding": { key: "systemDocumentUnderstanding", defaultExpanded: false, tone: "system" },
  ".llm-wiki/field-assessments": { key: "systemFieldAssessments", defaultExpanded: false, tone: "system" },
  ".llm-wiki/improvement-plans": { key: "systemImprovementPlans", defaultExpanded: false, tone: "system" },
  ".llm-wiki/wiki-health": { key: "systemWikiHealth", defaultExpanded: false, tone: "system" },
  ".llm-wiki/pdf-artifacts": { key: "systemPdfArtifacts", defaultExpanded: false, tone: "system" },
  ".llm-wiki/scene": { key: "systemScene", defaultExpanded: false, tone: "system" },
  ".llm-wiki/chats": { key: "systemChats", defaultExpanded: false, tone: "system" },
  ".llm-wiki/review.json": { key: "systemReviewQueue", defaultExpanded: false, tone: "system" },
  ".llm-wiki/conversations.json": { key: "systemConversations", defaultExpanded: false, tone: "system" },
  ".llm-wiki/ingest-cache.json": { key: "systemIngestCache", defaultExpanded: false, tone: "system" },
  ".llm-wiki/ingest-queue.json": { key: "systemIngestQueue", defaultExpanded: false, tone: "system" },

  "purpose.md": { key: "purposeFile", defaultExpanded: false, tone: "business" },
  "schema.md": { key: "schemaFile", defaultExpanded: false, tone: "business" },

  "wiki/index.md": { key: "wikiIndexFile", defaultExpanded: false, tone: "business" },
  "wiki/overview.md": { key: "wikiOverviewFile", defaultExpanded: false, tone: "business" },
  "wiki/log.md": { key: "wikiLogFile", defaultExpanded: false, tone: "business" },
}

export function getRelativeNodePath(projectPath: string, nodePath: string): string {
  const normalizedProjectPath = projectPath.replace(/\\/g, "/").replace(/\/+$/, "")
  const normalizedNodePath = nodePath.replace(/\\/g, "/")
  if (!normalizedNodePath.startsWith(normalizedProjectPath)) {
    return normalizedNodePath.replace(/^\/+/, "")
  }
  return normalizedNodePath
    .slice(normalizedProjectPath.length)
    .replace(/^\/+/, "")
}

export function getFileTreeDisplayMeta(
  t: TFunction,
  projectPath: string,
  nodePath: string,
  rawName: string,
  isDir: boolean,
  depth: number,
): FileTreeDisplayMeta {
  const relativePath = getRelativeNodePath(projectPath, nodePath)
  const alias = ALIAS_MAP[relativePath]
  const defaultExpanded = alias
    ? alias.defaultExpanded
    : depth < 1 && relativePath !== ".llm-wiki"

  if (!alias) {
    return {
      displayName: rawName,
      rawName,
      defaultExpanded,
      tone: "neutral",
    }
  }

  const displayName = t(`fileTree.aliases.${alias.key}`)
  const hint = alias.hintKey ? t(`fileTree.hints.${alias.hintKey}`) : undefined

  return {
    displayName,
    rawName,
    hint,
    defaultExpanded: isDir ? defaultExpanded : false,
    tone: alias.tone,
  }
}
