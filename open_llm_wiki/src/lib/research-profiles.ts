import type {
  OpportunityCard,
  ResearchReportSection,
  ResearchSession,
  ResearchTaskType,
} from "@/lib/research-types"

export interface ResearchProfile {
  taskType: ResearchTaskType
  label: string
  reportSections: ReadonlyArray<Pick<ResearchReportSection, "key" | "title">>
  buildClarificationSystemPrompt: (session: ResearchSession) => string[]
  buildQuerySystemPrompt: (session: ResearchSession) => string[]
  buildSourceSummarySystemPrompt: (session: ResearchSession) => string[]
  buildFollowUpSystemPrompt: (session: ResearchSession) => string[]
  buildReportSystemPrompt: (session: ResearchSession) => string[]
  buildFindingSystemPrompt: (session: ResearchSession) => string[]
  buildReportUserContext: (session: ResearchSession) => string[]
  buildFallbackQueries: (session: ResearchSession) => string[]
}

export const genericReportSections = [
  { key: "research_question", title: "研究问题" },
  { key: "scope_and_assumptions", title: "研究范围与前提" },
  { key: "core_findings", title: "核心结论" },
  { key: "evidence_sources", title: "证据来源" },
  { key: "open_questions", title: "未解决问题" },
  { key: "revision_suggestions", title: "可带入业务修订的建议" },
] as const

export const marketOpportunityReportSections = [
  { key: "research_question", title: "分析问题" },
  { key: "scope_and_assumptions", title: "市场范围与前提" },
  { key: "core_findings", title: "市场信号与核心洞察" },
  { key: "evidence_sources", title: "证据来源" },
  { key: "open_questions", title: "风险与证据缺口" },
  { key: "revision_suggestions", title: "机会卡片矩阵" },
] as const

function compact(items: Array<string | null | undefined | false>): string[] {
  return items.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

function splitListValue(value: string): string[] {
  return value
    .split(/[；;、，,]/g)
    .map((item) => item.trim())
    .filter(Boolean)
}

function clampConfidence(value: string | undefined): number {
  const parsed = Number(value?.match(/0?\.\d+|1(?:\.0+)?|\d+/)?.[0] ?? "")
  if (!Number.isFinite(parsed)) return 0.45
  if (parsed > 1) return Math.max(0, Math.min(1, parsed / 100))
  return Math.max(0, Math.min(1, parsed))
}

function stripOpportunityPrefix(title: string): string {
  return title
    .replace(/^机会[一二三四五六七八九十\d]+[：:、.\s-]*/u, "")
    .trim()
}

function valueAfterLabel(lines: string[], labels: string[]): string {
  for (const line of lines) {
    const normalized = line.replace(/^[-*\s]+/, "").trim()
    for (const label of labels) {
      const prefix = `${label}：`
      const asciiPrefix = `${label}:`
      if (normalized.startsWith(prefix)) return normalized.slice(prefix.length).trim()
      if (normalized.startsWith(asciiPrefix)) return normalized.slice(asciiPrefix.length).trim()
    }
  }
  return ""
}

function makeOpportunityCardId(session: ResearchSession, index: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || `card-${index + 1}`
  return `${session.sessionId}-opportunity-${index + 1}-${slug}`
}

function splitOpportunityBlocks(markdown: string): Array<{ title: string; body: string }> {
  const headingRegex = /^###\s+(.+)$/gm
  const matches = Array.from(markdown.matchAll(headingRegex))
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? markdown.length) : markdown.length
    return {
      title: match[1]?.trim() ?? "",
      body: markdown.slice(start, end),
    }
  })
}

export function buildOpportunityCardsFromReport(
  session: ResearchSession,
  reportMarkdown: string,
): OpportunityCard[] {
  if (!session.sources.length) return []
  const normalized = reportMarkdown.trim()
  if (!normalized) return []
  const blocks = splitOpportunityBlocks(normalized)
  const sourceUrls = session.sources.map((source) => source.url).filter(Boolean).slice(0, 8)
  const evidenceSummary = session.sources
    .flatMap((source) => source.learnedFacts)
    .filter(Boolean)
    .slice(0, 4)
    .join("；")

  return blocks
    .map((match, index): OpportunityCard | null => {
      const title = stripOpportunityPrefix(match.title)
      if (!title) return null
      const lines = match.body.split("\n")
      const targetSegment = valueAfterLabel(lines, ["目标客群", "目标人群", "目标市场"])
      const painPoint = valueAfterLabel(lines, ["痛点", "未满足需求", "核心痛点"])
      const opportunityHypothesis = valueAfterLabel(lines, ["机会假设", "商机假设", "机会"])
      const competitorSignals = splitListValue(valueAfterLabel(lines, ["竞品信号", "替代方案", "竞品/替代方案"]))
      const risks = splitListValue(valueAfterLabel(lines, ["风险", "风险与缺口", "证据缺口"]))
      const validationExperiments = splitListValue(valueAfterLabel(lines, ["验证实验", "验证动作", "下一步验证"]))
      const confidence = clampConfidence(valueAfterLabel(lines, ["置信度", "信心"]))
      const missingCoreFields = [targetSegment, painPoint, opportunityHypothesis, validationExperiments.join("")].filter(Boolean).length < 3

      return {
        cardId: makeOpportunityCardId(session, index, title),
        title,
        targetSegment: targetSegment || "待补充目标客群",
        painPoint: painPoint || "待补充痛点",
        opportunityHypothesis: opportunityHypothesis || "待补充机会假设",
        evidenceSummary: evidenceSummary || "当前机会卡来自外部研究来源，仍需人工确认。",
        sourceUrls,
        competitorSignals,
        risks: missingCoreFields
          ? Array.from(new Set([...risks, "关键字段不完整，需要补充证据后再进入策略链路。"]))
          : risks,
        validationExperiments,
        confidence: missingCoreFields ? Math.min(confidence, 0.4) : confidence,
        status: "draft",
        researchSessionId: session.sessionId,
        linkedDocId: session.linkedDocId ?? null,
        targetFieldKey: session.targetFieldKey ?? null,
        createdAt: new Date().toISOString(),
      }
    })
    .filter((card): card is OpportunityCard => Boolean(card))
    .slice(0, 8)
}

export function getResearchProfile(taskType: ResearchTaskType | undefined | null): ResearchProfile {
  return taskType === "market_opportunity_analysis" ? marketOpportunityProfile : genericResearchProfile
}

export const genericResearchProfile: ResearchProfile = {
  taskType: "generic_research",
  label: "通用深度研究",
  reportSections: genericReportSections,
  buildClarificationSystemPrompt: () => [
    "你是业务深度研究编排助手。",
    "请基于当前研究主题，提出 2 个最关键的澄清问题，帮助研究更贴近业务。",
    "严格输出 JSON 数组，每项是一个字符串。",
  ],
  buildQuerySystemPrompt: () => [
    "你是业务深度研究规划助手。",
    "请基于研究主题、项目目标、现有知识概览和专家澄清回答，生成一组适合网页搜索与整页抓取的查询。",
    "查询要覆盖 breadth / depth，不要泛泛而谈。",
    "严格输出 JSON 数组，每项是一个查询字符串。",
  ],
  buildSourceSummarySystemPrompt: () => [
    "你是业务研究证据提炼助手。",
    "请从单个来源中提炼：learnedFacts、openFollowUps、sourceReliabilityNote。",
    "严格输出 JSON 对象：{ learnedFacts: string[], openFollowUps: string[], sourceReliabilityNote: string }",
  ],
  buildFollowUpSystemPrompt: () => [
    "你是业务深度研究追问助手。",
    "基于当前 learnings，提出最多 3 个下一步需要继续追问的方向。",
    "严格输出 JSON 数组，每项包含：followUpQuestion, reason, derivedFromLearning, priority。",
    "priority 只能是 high、medium、low。",
  ],
  buildReportSystemPrompt: () => [
    "你是业务深度研究总结助手。",
    "请严格按以下结构输出研究报告：",
    "## 研究问题",
    "## 研究范围与前提",
    "## 核心结论",
    "## 证据来源",
    "## 未解决问题",
    "## 可带入业务修订的建议",
    "要求：标清哪些内容是已确认依据，哪些只是启发性延展。",
    "如果结果不足，请明确说明是证据不足、抓取降级还是外部来源冲突未解。",
  ],
  buildFindingSystemPrompt: () => [
    "你是业务研究结果结构化助手。",
    "请从研究报告中提炼候选结论。",
    "严格输出 JSON 数组，每项包含：kind, title, summary, evidenceSummary。",
    "kind 只能是 business_conclusion 或 revision_suggestion。",
  ],
  buildReportUserContext: () => [],
  buildFallbackQueries: (session) => [
    session.topic,
    `${session.topic} best practices`,
    `${session.topic} case study`,
    `${session.topic} metrics action framework`,
  ],
}

export const marketOpportunityProfile: ResearchProfile = {
  taskType: "market_opportunity_analysis",
  label: "商机/市场分析",
  reportSections: marketOpportunityReportSections,
  buildClarificationSystemPrompt: () => [
    "你是商机与市场分析编排助手。",
    "请提出 2 个最关键的澄清问题，用来界定目标市场、目标客群、商业约束或最想验证的机会假设。",
    "问题必须业务化、具体、可回答。",
    "严格输出 JSON 数组，每项是一个字符串。",
  ],
  buildQuerySystemPrompt: () => [
    "你是商机与市场分析研究规划助手。",
    "请按目标客群、痛点、现有替代方案、竞品信号、购买阻力、市场趋势、验证实验生成搜索查询。",
    "查询必须能找到外部市场信号、竞品信息、行业案例或用户需求证据。",
    "严格输出 JSON 数组，每项是一个查询字符串。",
  ],
  buildSourceSummarySystemPrompt: () => [
    "你是商机分析证据提炼助手。",
    "请从单个来源提炼与市场机会相关的 learnedFacts、openFollowUps、sourceReliabilityNote。",
    "优先提炼：目标客群、痛点、现有替代方案、竞品信号、价格/购买阻力、验证方法。",
    "严格输出 JSON 对象：{ learnedFacts: string[], openFollowUps: string[], sourceReliabilityNote: string }",
  ],
  buildFollowUpSystemPrompt: () => [
    "你是商机分析追问助手。",
    "基于当前 learnings，提出最多 3 个下一步需要继续追问的市场验证方向。",
    "优先补足：证据缺口、竞品差异、用户付费意愿、验证实验。",
    "严格输出 JSON 数组，每项包含：followUpQuestion, reason, derivedFromLearning, priority。",
    "priority 只能是 high、medium、low。",
  ],
  buildReportSystemPrompt: () => [
    "你是商机与市场分析总结助手。",
    "请严格按以下结构输出市场分析报告：",
    "## 分析问题",
    "## 市场范围与前提",
    "## 市场信号与核心洞察",
    "## 证据来源",
    "## 风险与证据缺口",
    "## 机会卡片矩阵",
    "在“机会卡片矩阵”下，用 `### 机会一：标题` 的形式输出 3-6 张机会卡。",
    "每张机会卡必须包含：目标客群、痛点、机会假设、竞品信号、风险、验证实验、置信度。",
    "缺少证据时必须写明证据缺口，并降低置信度。",
  ],
  buildFindingSystemPrompt: () => [
    "你是商机分析结果结构化助手。",
    "请从市场分析报告中提炼候选业务结论。",
    "严格输出 JSON 数组，每项包含：kind, title, summary, evidenceSummary。",
    "kind 只能是 business_conclusion 或 revision_suggestion。",
  ],
  buildReportUserContext: (session) => compact([
    session.businessContext ? `业务背景：${session.businessContext}` : null,
    session.targetMarket ? `目标市场：${session.targetMarket}` : null,
    session.targetAudience ? `目标客群：${session.targetAudience}` : null,
    session.constraints ? `已知约束：${session.constraints}` : null,
  ]),
  buildFallbackQueries: (session) => compact([
    `${session.topic} 目标客群 痛点 未满足需求`,
    `${session.topic} 市场趋势 行业报告 用户需求`,
    `${session.topic} 竞品 替代方案 定价`,
    `${session.topic} 购买阻力 转化障碍`,
    `${session.topic} case study validation experiment`,
    `${session.topic} 验证实验 MVP 增长策略`,
  ]),
}
