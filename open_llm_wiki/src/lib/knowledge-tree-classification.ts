export interface WikiPageInfo {
  path: string
  title: string
  type: string
  tags: string[]
  origin?: string
}

const TYPE_ALIASES: Record<string, string> = {
  task_mechanism: "task-mechanism",
  task_generation_mechanism: "task-mechanism",
  business_judgement: "business_judgements",
  business_judgment: "business_judgements",
  business_judgments: "business_judgements",
  business_strategy_overview: "business_strategy",
}

export function normalizeKnowledgePageType(value: string | null | undefined): string {
  const normalized = (value ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
  if (!normalized) return "other"
  return TYPE_ALIASES[normalized] ?? normalized
}

export function parseKnowledgePageInfo(path: string, fileName: string, content: string): WikiPageInfo {
  let type = "other"
  let title = fileName.replace(/\.md$/i, "").replace(/-/g, " ")
  const fallbackTitle = title
  const tags: string[] = []
  let origin: string | undefined

  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (fmMatch) {
    const fm = fmMatch[1]
    const frontmatterType = scalarField(fm, "type") ?? scalarField(fm, "page_type")
    type = normalizeKnowledgePageType(frontmatterType)

    const frontmatterTitle = scalarField(fm, "title")
    if (frontmatterTitle) title = frontmatterTitle

    const inlineTags = inlineArrayField(fm, "tags")
    if (inlineTags.length > 0) tags.push(...inlineTags)

    origin = scalarField(fm, "origin") ?? undefined
  }

  if (title === fallbackTitle) {
    const headingMatch = content.match(/^#\s+(.+)$/m)
    if (headingMatch) title = headingMatch[1].trim()
  }

  if (type === "other") {
    type = inferKnowledgePageTypeFromPath(path, fileName)
  }

  return { path, title, type, tags, origin }
}

export function inferKnowledgePageTypeFromPath(path: string, fileName: string): string {
  const relativeWikiPath = toRelativeWikiPath(path)
  const parts = relativeWikiPath.split("/").filter(Boolean)
  const topLevelDir = parts[0] ?? ""
  const stem = fileName.replace(/\.md$/i, "")

  if (fileName === "overview.md") return "overview"

  if (topLevelDir === "business") {
    if (fileName === "index.md") return "business_index"
    if (stem === "主链路步骤") return "business_process"
    if (stem === "关键判断") return "business_judgements"
    if (stem === "证据与案例") return "business_evidence"
    if (stem === "边界与例外") return "business_boundaries"
    if (stem === "策略总览") return "business_strategy"
    return "business_knowledge"
  }

  if (topLevelDir === "roles" || relativeWikiPath.includes("/roles/")) return "role"
  if (topLevelDir === "mechanisms" || relativeWikiPath.includes("/mechanisms/")) return "task-mechanism"
  if (topLevelDir === "meetings" || relativeWikiPath.includes("/meetings/")) return "meeting"
  if (topLevelDir === "tasks" || relativeWikiPath.includes("/tasks/")) return "task"
  if (topLevelDir === "quality" || relativeWikiPath.includes("/quality/")) return "quality"
  if (topLevelDir === "collaboration" || relativeWikiPath.includes("/collaboration/")) return "collaboration"
  if (topLevelDir === "reviews" || relativeWikiPath.includes("/reviews/")) return "review"
  if (topLevelDir === "entities" || relativeWikiPath.includes("/entities/")) return "entity"
  if (topLevelDir === "concepts" || relativeWikiPath.includes("/concepts/")) return "concept"
  if (topLevelDir === "sources" || relativeWikiPath.includes("/sources/")) return "source"
  if (topLevelDir === "queries" || relativeWikiPath.includes("/queries/")) return "query"
  if (topLevelDir === "comparisons" || relativeWikiPath.includes("/comparisons/")) return "comparison"
  if (topLevelDir === "synthesis" || relativeWikiPath.includes("/synthesis/")) return "synthesis"

  return "other"
}

function scalarField(frontmatter: string, key: string): string | null {
  const match = frontmatter.match(new RegExp(`^${escapeRegExp(key)}:\\s*["']?(.+?)["']?\\s*$`, "m"))
  return match ? match[1].trim() : null
}

function inlineArrayField(frontmatter: string, key: string): string[] {
  const match = frontmatter.match(new RegExp(`^${escapeRegExp(key)}:\\s*\\[(.+?)\\]`, "m"))
  if (!match) return []
  return match[1]
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
}

function toRelativeWikiPath(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  const wikiIndex = normalized.lastIndexOf("/wiki/")
  if (wikiIndex >= 0) return normalized.slice(wikiIndex + "/wiki/".length)
  if (normalized.startsWith("wiki/")) return normalized.slice("wiki/".length)
  return normalized.replace(/^\/+/, "")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
