import type {
  DocumentBlock,
  SourceKind,
  TaskCardDraft,
  TaskCardQualityScorecard,
  TaskContextPack,
  TaskEvidenceText,
  TaskRoleProfile,
  TaskQualitySummary,
  RoleContextIndex,
  TaskRulePack,
  TaskSourcePolicy,
  TaskTaxonomy,
  TaskTaxonomyElement,
  TaskTaxonomyModule,
  TaskModule,
  BusinessTaskStatus,
} from "@/lib/agent-mode-types"

export type TaskSheetType =
  | "weekly_review"
  | "monthly_review"
  | "weekly_plan"
  | "role_kpi"
  | "task_tracking"
  | "unknown"

export type TaskBlockType =
  | "role_table"
  | "kpi_table"
  | "weekly_review"
  | "monthly_review"
  | "action_plan"
  | "problem_block"
  | "quality_rule"
  | "collaboration_rule"
  | "review_block"
  | "unknown_block"

export interface WorkbookIR {
  docId: string
  sourcePath: string
  sourceName: string
  sourceType: "spreadsheet_markdown"
  sheets: SheetIR[]
  parseWarnings: string[]
}

export interface SheetIR {
  sheetId: string
  sheetName: string
  inferredSheetType: TaskSheetType
  headers: string[]
  rows: string[][]
  usedRange: string
  blocks: SheetBlock[]
}

export interface SheetBlock {
  blockId: string
  sheetName: string
  blockType: TaskBlockType
  title: string
  range: string
  headerRows: string[][]
  dataRows: string[][]
  evidenceAnchors: string[]
  confidence: number
  warnings: string[]
}

export interface TaskDocumentBlock {
  blockId: string
  blockType: TaskBlockType
  title: string
  text: string
  pageRange: string | null
  evidenceAnchors: string[]
  confidence: number
}

export interface RenderedTaskWikiPage {
  path: string
  content: string
}

function stableHash(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function uniq(items: readonly string[], max = Number.POSITIVE_INFINITY): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))).slice(0, max)
}

function cleanCell(value: string): string {
  return value
    .replace(/\\\|/g, "|")
    .replace(/\s+/g, " ")
    .replace(/\s+([（(])/g, "$1")
    .replace(/([）)])\s+/g, "$1")
    .trim()
}

function splitMarkdownRow(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return []
  return trimmed
    .slice(1, -1)
    .split("|")
    .map(cleanCell)
}

function normalizeWrappedMarkdownTableLines(lines: string[]): string[] {
  const normalized: string[] = []
  let pending = ""
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (pending) {
        normalized.push(pending)
        pending = ""
      }
      normalized.push(line)
      continue
    }
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (pending) {
        normalized.push(pending)
        pending = ""
      }
      normalized.push(line)
      continue
    }
    if (trimmed.startsWith("|")) {
      if (pending) normalized.push(pending)
      pending = trimmed
      continue
    }
    if (pending) {
      pending = `${pending}${trimmed.endsWith("|") ? "" : " "}${trimmed}`
      if (trimmed.endsWith("|")) {
        normalized.push(pending)
        pending = ""
      }
      continue
    }
    normalized.push(line)
  }
  if (pending) normalized.push(pending)
  return normalized
}

const MAX_WORKBOOK_SHEETS_FOR_TASK_PACK = 24
const MAX_WORKBOOK_ROWS_PER_SHEET_FOR_TASK_PACK = 250
const MAX_WORKBOOK_CELLS_PER_ROW_FOR_TASK_PACK = 80

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.trim()))
}

function inferSheetType(sheetName: string, headers: string[], rows: string[][]): TaskSheetType {
  const text = `${sheetName} ${headers.join(" ")} ${rows.slice(0, 5).flat().join(" ")}`.toLowerCase()
  if (/(周会|周复盘|本周|下周)/.test(text)) return "weekly_review"
  if (/(月会|月复盘|本月|下月|月度)/.test(text)) return "monthly_review"
  if (/(周计划|下周计划)/.test(text)) return "weekly_plan"
  if (/(岗位|职责|kpi|绩效|权重|考核)/i.test(text)) return "role_kpi"
  if (/(任务|负责人|完成情况|状态|截止)/.test(text)) return "task_tracking"
  return "unknown"
}

function inferBlockType(sheetType: TaskSheetType, headers: string[], rows: string[][]): TaskBlockType {
  const text = `${headers.join(" ")} ${rows.slice(0, 4).flat().join(" ")}`.toLowerCase()
  if (/(岗位|职责|kpi|绩效|权重|考核)/i.test(text)) return /(岗位|职责)/.test(text) ? "role_table" : "kpi_table"
  if (/(负责人|owner|下周计划|行动|动作|计划|任务)/i.test(text)) return "action_plan"
  if (/(问题|卡点|风险|不足|差距)/.test(text)) return "problem_block"
  if (/(指标|验收|标准|达标|评分|质量)/.test(text)) return "quality_rule"
  if (/(协同|配合|协作|支持)/.test(text)) return "collaboration_rule"
  if (/(复盘|回顾|总结|review)/i.test(text)) return "review_block"
  if (sheetType === "weekly_review") return "weekly_review"
  if (sheetType === "monthly_review") return "monthly_review"
  return "unknown_block"
}

function columnValue(headers: string[], row: string[], patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const index = headers.findIndex((header) => pattern.test(header))
    if (index >= 0) return cleanCell(row[index] ?? "")
  }
  return ""
}

function rangeForRows(startLine: number, rowCount: number, colCount: number): string {
  const lastCol = String.fromCharCode("A".charCodeAt(0) + Math.max(0, Math.min(colCount - 1, 25)))
  return `A${startLine}:${lastCol}${startLine + Math.max(0, rowCount - 1)}`
}

export function extractWorkbookIRFromMarkdown(input: {
  docId: string
  sourcePath: string
  sourceName: string
  markdown: string
}): WorkbookIR {
  const lines = normalizeWrappedMarkdownTableLines(input.markdown.replace(/\r\n/g, "\n").split("\n"))
  const sheetRanges: Array<{ name: string; start: number; end: number }> = []
  let current: { name: string; start: number } | null = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    const match = line.match(/^##\s+(.+)$/)
    if (!match) continue
    if (current) sheetRanges.push({ name: current.name, start: current.start, end: index })
    current = { name: match[1].trim(), start: index + 1 }
  }
  if (current) sheetRanges.push({ name: current.name, start: current.start, end: lines.length })
  if (sheetRanges.length === 0) sheetRanges.push({ name: input.sourceName.replace(/\.[^.]+$/, ""), start: 0, end: lines.length })

  const parseWarnings: string[] = []
  const sheets = sheetRanges.map((sheet, sheetIndex): SheetIR => {
    const sectionLines = lines.slice(sheet.start, sheet.end)
    const tableLines = sectionLines
      .map((line, offset) => ({ line, lineNo: sheet.start + offset + 1 }))
      .filter((item) => item.line.trim().startsWith("|") && item.line.trim().endsWith("|"))
    const parsedRows = tableLines
      .map((item) => ({ cells: splitMarkdownRow(item.line), lineNo: item.lineNo }))
      .filter((item) => item.cells.length > 0)
    const headers = parsedRows[0]?.cells ?? []
    const dataRows = parsedRows
      .slice(1)
      .filter((item) => !isSeparatorRow(item.cells))
      .slice(0, MAX_WORKBOOK_ROWS_PER_SHEET_FOR_TASK_PACK)
      .map((item) => item.cells.slice(0, MAX_WORKBOOK_CELLS_PER_ROW_FOR_TASK_PACK))
    if (headers.length === 0) parseWarnings.push(`Sheet ${sheet.name} did not expose a markdown table header.`)
    const inferredSheetType = inferSheetType(sheet.name, headers, dataRows)
    const blockType = inferBlockType(inferredSheetType, headers, dataRows)
    const range = rangeForRows(parsedRows[0]?.lineNo ?? sheet.start + 1, dataRows.length + 1, headers.length)
    const block: SheetBlock = {
      blockId: `${input.docId}-sheet-${sheetIndex + 1}-block-1`,
      sheetName: sheet.name,
      blockType,
      title: sheet.name,
      range,
      headerRows: headers.length > 0 ? [headers] : [],
      dataRows,
      evidenceAnchors: [`${input.sourcePath}#sheet=${sheet.name}&range=${range}`],
      confidence: blockType === "unknown_block" ? 0.42 : 0.78,
      warnings: headers.length > 0 ? [] : ["missing_table_header"],
    }
    return {
      sheetId: `${input.docId}-sheet-${sheetIndex + 1}`,
      sheetName: sheet.name,
      inferredSheetType,
      headers,
      rows: dataRows,
      usedRange: range,
      blocks: dataRows.length > 0 || headers.length > 0 ? [block] : [],
    }
  }).slice(0, MAX_WORKBOOK_SHEETS_FOR_TASK_PACK)

  return {
    docId: input.docId,
    sourcePath: input.sourcePath,
    sourceName: input.sourceName,
    sourceType: "spreadsheet_markdown",
    sheets,
    parseWarnings,
  }
}

function inferDocumentBlockType(block: DocumentBlock): TaskBlockType {
  const text = `${block.headingPath.join(" ")} ${block.textContent}`
  if (/(岗位|职责|角色)/i.test(text)) return "role_table"
  if (/(kpi|绩效|指标|权重|验收|达标)/i.test(text)) return "quality_rule"
  if (/(周会|月会|复盘|回顾)/.test(text)) return /月会|月度/.test(text) ? "monthly_review" : "weekly_review"
  if (/(问题|卡点|不足|风险|差距)/.test(text)) return "problem_block"
  if (/(计划|行动|动作|任务|下周|下一步)/.test(text)) return "action_plan"
  if (/(协同|协作|配合|支持)/.test(text)) return "collaboration_rule"
  return "unknown_block"
}

export function extractTaskDocumentBlocks(ir: { blocks: DocumentBlock[]; sourcePath: string }): TaskDocumentBlock[] {
  return ir.blocks
    .filter((block) => ["heading", "paragraph", "list", "table", "evidence"].includes(block.blockType))
    .map((block): TaskDocumentBlock => {
      const blockType = inferDocumentBlockType(block)
      return {
        blockId: block.blockId,
        blockType,
        title: block.headingPath[block.headingPath.length - 1] || block.textContent.slice(0, 40) || "文档片段",
        text: block.textContent,
        pageRange: block.page ? String(block.page) : null,
        evidenceAnchors: [`${block.sourceRefs[0] ?? ir.sourcePath}#${block.blockId}`],
        confidence: blockType === "unknown_block" ? 0.4 : 0.7,
      }
    })
}

function allRows(workbook: WorkbookIR | null | undefined): Array<{ sheet: SheetIR; block: SheetBlock; row: string[] }> {
  return (workbook?.sheets ?? []).flatMap((sheet) =>
    sheet.blocks.flatMap((block) => block.dataRows.map((row) => ({ sheet, block, row }))),
  )
}

function evidenceText(text: string, refs: string[]): TaskEvidenceText {
  return { text, evidenceRefs: uniq(refs, 5) }
}

const TASK_TAXONOMY_MODULES: Array<Omit<TaskTaxonomyModule, "evidenceRefs">> = [
  {
    moduleId: "new_product_launch",
    label: "新品/新链接规划与上线",
    aliases: ["新品", "新链接", "上新", "上线", "新画芯", "新款", "sku规划", "链接规划"],
    examples: ["中价透明链接精细化上线", "不同场景人群区分上线", "新品卖点挖掘规划"],
  },
  {
    moduleId: "existing_product_growth",
    label: "老链接/存量商品增长优化",
    aliases: ["老链接", "存量", "增长", "链接重新定位", "老页面", "转化目标", "存量商品"],
    examples: ["页面抓紧制作替换老页面", "优质计划做增长规划", "之前上的链接重新定位"],
  },
  {
    moduleId: "visual_content",
    label: "商品视觉与内容创作",
    aliases: ["主图", "详情页", "视觉", "视频", "拍摄", "素材", "创意图", "卖点", "晒图"],
    examples: ["主图策划", "主图视频策划", "红色印花类画芯寻找并通过"],
  },
  {
    moduleId: "traffic_promotion",
    label: "推广与流量运营",
    aliases: ["直通车", "推广", "投流", "流量", "关键词", "人群推广", "地域优化", "小预算测试"],
    examples: ["直通车计划调优", "人群推广介入", "成交计划小预算测试"],
  },
  {
    moduleId: "customer_conversion",
    label: "客服与转化运营",
    aliases: ["客服", "转化", "话术", "催付", "询单", "响应", "复购"],
    examples: ["整理客服话术", "客服转化目标", "询单定时检查"],
  },
  {
    moduleId: "creator_content",
    label: "达人与内容投放",
    aliases: ["达人", "买家秀", "种草", "内容投放", "达人投流"],
    examples: ["找买家秀达人", "主图视频拍摄找达人", "达人投流"],
  },
  {
    moduleId: "product_operations",
    label: "商品基础运营与管理",
    aliases: ["编码", "核价", "上架", "对接", "库存", "价格", "商品管理", "页面对接"],
    examples: ["组合编码和核价", "页面对接", "换成新画芯"],
  },
]

const TASK_TAXONOMY_ELEMENTS: Array<Omit<TaskTaxonomyElement, "evidenceRefs">> = [
  { fieldKey: "taskModule", label: "任务模块", aliases: ["任务模块", "业务分类", "工作板块"], requiredForReady: true },
  { fieldKey: "productId", label: "商品编号/ID", aliases: ["商品编号", "商品ID", "链接ID", "货号"], requiredForReady: false, conditionalRequirement: "商品/链接类任务建议补齐，用于按商品检索与复盘。" },
  { fieldKey: "taskItem", label: "任务事项", aliases: ["任务事项", "任务内容", "具体工作动作", "动作"], requiredForReady: true },
  { fieldKey: "businessGoal", label: "任务目标", aliases: ["任务目标", "经营目标", "目标"], requiredForReady: true },
  { fieldKey: "priority", label: "任务优先级", aliases: ["任务优先级", "优先级", "A1", "A2"], requiredForReady: false },
  { fieldKey: "cadence", label: "任务周期", aliases: ["任务周期", "周期", "截止", "时间范围"], requiredForReady: true },
  { fieldKey: "acceptanceMetrics", label: "任务验收标准", aliases: ["验收标准", "验收指标", "完成标准"], requiredForReady: true },
  { fieldKey: "ownerRole", label: "任务执行人", aliases: ["执行人", "负责人", "Owner"], requiredForReady: true },
  { fieldKey: "taskStatus", label: "任务执行状态", aliases: ["执行状态", "任务状态", "状态"], requiredForReady: false },
  { fieldKey: "resultFeedback", label: "任务结果反馈", aliases: ["结果反馈", "复盘", "数据反馈", "问题总结"], requiredForReady: false, conditionalRequirement: "已完成/复盘类任务需要补齐结果反馈。" },
]

function taskModuleLabel(moduleId: TaskModule): string {
  return TASK_TAXONOMY_MODULES.find((module) => module.moduleId === moduleId)?.label ?? "待分类"
}

function sourceTextForRoleDetection(input: {
  sourceName: string
  sourcePath: string
  documentBlocks: TaskDocumentBlock[]
}): string {
  return `${input.sourceName} ${input.sourcePath} ${input.documentBlocks.map((block) => `${block.title} ${block.text}`).join(" ")}`
}

function isTaskMetaStrategyText(text: string): boolean {
  return /(任务生成元策略|任务的维度拆解|任务包含元素|电商运营周计划任务种类总结|任务模块|商品编号\/?ID|任务事项|任务执行状态|任务结果反馈)/i.test(text)
}

function detectDocRole(input: {
  sourceName: string
  sourcePath: string
  workbook?: WorkbookIR | null
  documentBlocks: TaskDocumentBlock[]
}): TaskContextPack["docRole"] {
  const types = [
    ...(input.workbook?.sheets ?? []).map((sheet) => sheet.inferredSheetType),
    ...(input.workbook?.sheets ?? []).flatMap((sheet) => sheet.blocks.map((block) => block.blockType)),
    ...input.documentBlocks.map((block) => block.blockType),
  ].join(" ")
  const documentText = sourceTextForRoleDetection(input)
  if (
    isTaskMetaStrategyText(documentText)
    || (
      /(经营任务生成机制|任务生成机制|质量体系|任务质量|质量评分|评分规则|任务模板|核心要素)/.test(documentText) &&
      /(经营目标|任务对象|问题证据|策略路径|Owner|协同角色|验收指标|复盘要求|证据锚点)/i.test(documentText)
    )
  ) {
    return "task_mechanism_source"
  }
  if (/role_kpi|role_table|kpi_table/.test(types) && /weekly|monthly|action_plan/.test(types)) return "mixed_task_source"
  if (/role_kpi|role_table|kpi_table/.test(types)) return "role_kpi_source"
  if (/weekly|monthly|action_plan|review/.test(types)) return "meeting_task_source"
  if (/quality_rule|collaboration_rule/.test(types)) return "task_mechanism_source"
  return "unknown"
}

function sourcePolicyForDocRole(docRole: TaskContextPack["docRole"]): TaskSourcePolicy {
  if (docRole === "task_mechanism_source") {
    return {
      sourceDocRole: docRole,
      canGenerateTaskCards: false,
      canProvideRules: true,
      canProvideRoleContext: false,
      canProvideMetrics: true,
      defaultIndexVisibility: "context_only",
    }
  }
  if (docRole === "role_kpi_source") {
    return {
      sourceDocRole: docRole,
      canGenerateTaskCards: false,
      canProvideRules: false,
      canProvideRoleContext: true,
      canProvideMetrics: true,
      defaultIndexVisibility: "context_only",
    }
  }
  return {
    sourceDocRole: docRole,
    canGenerateTaskCards: docRole === "meeting_task_source" || docRole === "mixed_task_source",
    canProvideRules: docRole === "mixed_task_source",
    canProvideRoleContext: docRole === "mixed_task_source",
    canProvideMetrics: true,
    defaultIndexVisibility: docRole === "meeting_task_source" || docRole === "mixed_task_source"
      ? "task_index"
      : "hidden",
  }
}

function splitRoles(value: string): string[] {
  return uniq(value.split(/[、,，/／;；\s]+/), 8)
}

function normalizeRoleName(value: string): string {
  const trimmed = value.trim()
  if (!hasConcreteValue(trimmed)) return ""
  return trimmed
    .replace(/^(负责人|owner|Owner)[:：]?\s*/i, "")
    .replace(/\s+/g, "")
}

function inferTaskTimeRange(sheetName: string, sourceName: string, rowText: string): TaskCardDraft["timeRange"] {
  const text = `${sheetName} ${sourceName} ${rowText}`
  const fullDate = text.match(/(20\d{2})[./年-]\s*(\d{1,2})[./月-]\s*(\d{1,2})/)
  if (fullDate) {
    const year = fullDate[1]
    const month = fullDate[2].padStart(2, "0")
    const day = fullDate[3].padStart(2, "0")
    const date = `${year}-${month}-${day}`
    return { label: date, start: date, end: date }
  }
  const yearMonth = text.match(/(20\d{2})[./年-]\s*(\d{1,2})\s*(?:月)?/)
  if (yearMonth) {
    const year = yearMonth[1]
    const month = yearMonth[2].padStart(2, "0")
    return { label: `${year}-${month}`, start: `${year}-${month}-01`, end: `${year}-${month}-31` }
  }
  const monthOnly = text.match(/(?:^|[^0-9])(\d{1,2})\s*月/)
  if (monthOnly) {
    const month = monthOnly[1].padStart(2, "0")
    return { label: `${month}月` }
  }
  if (/下周|本周|周会|周计划|weekly/i.test(text)) return { label: "weekly" }
  if (/下月|本月|月会|月度|monthly/i.test(text)) return { label: "monthly" }
  return { label: "待确认" }
}

function inferPriority(headers: string[], row: string[], rowText: string): NonNullable<TaskCardDraft["priority"]> {
  const explicit = columnValue(headers, row, [/优先级/, /重要/, /等级/, /priority/i])
  const text = `${explicit} ${rowText}`
  if (/(p0|s级|a1|紧急|最高|critical|核心重点)/i.test(text)) return "critical"
  if (/(p1|a2|高|重点|重要|high)/i.test(text)) return "high"
  if (/(p3|低|观察|low)/i.test(text)) return "low"
  if (/(p2|中|一般|medium)/i.test(text)) return "medium"
  return "medium"
}

function inferBusinessTaskStatus(headers: string[], row: string[], rowText: string): BusinessTaskStatus {
  const explicit = columnValue(headers, row, [/状态/, /进度/, /完成情况/, /结果/])
  const text = `${explicit} ${rowText}`
  if (/(已完成|完成|done|finished|通过)/i.test(text)) return "done"
  if (/(执行中|进行中|处理中|in progress)/i.test(text)) return "in_progress"
  if (/(延期|延后|推迟|deferred)/i.test(text)) return "deferred"
  if (/(卡住|阻塞|blocked|风险|无法推进)/i.test(text)) return "blocked"
  if (/(未开始|待开始|待执行|todo|not started)/i.test(text)) return "not_started"
  return "unknown"
}

function moduleScore(text: string, module: Omit<TaskTaxonomyModule, "evidenceRefs">): number {
  const normalized = text.toLowerCase()
  return module.aliases.reduce((sum, alias) => (
    normalized.includes(alias.toLowerCase()) ? sum + Math.max(2, alias.length) : sum
  ), 0)
}

function inferTaskModule(text: string): TaskModule {
  let best: { moduleId: TaskModule; score: number } = { moduleId: "unknown", score: 0 }
  for (const module of TASK_TAXONOMY_MODULES) {
    const score = moduleScore(text, module)
    if (score > best.score) best = { moduleId: module.moduleId, score }
  }
  return best.score > 0 ? best.moduleId : "unknown"
}

function inferTaskModuleFromParts(parts: {
  explicitModule: string
  taskItem: string
  trigger: string
  metric: string
  rowText: string
}): TaskModule {
  const taskText = `${parts.taskItem} ${parts.trigger} ${parts.metric}`
  if (/(客服|转化|话术|催付|询单|响应|复购)/.test(taskText)) return "customer_conversion"
  if (/(直通车|推广|投流|流量|关键词|人群推广|地域优化|小预算测试|测款计划|成交计划)/.test(taskText)) return "traffic_promotion"
  if (/(主图|详情页|视觉|视频|拍摄|素材|创意图|卖点|晒图|画芯寻找)/.test(taskText)) return "visual_content"
  if (/(达人|买家秀|种草|内容投放)/.test(taskText)) return "creator_content"
  if (/(编码|核价|上架|页面对接|库存|价格|sku文案|SKU文案)/.test(taskText)) return "product_operations"
  if (/(新品|新链接|上新|上线|新画芯|新款|链接精细化)/.test(taskText)) return "new_product_launch"
  let best: { moduleId: TaskModule; score: number } = { moduleId: "unknown", score: 0 }
  for (const module of TASK_TAXONOMY_MODULES) {
    const score =
      + moduleScore(parts.taskItem, module) * 5
      + moduleScore(parts.trigger, module) * 3
      + moduleScore(parts.metric, module) * 2
      + moduleScore(parts.explicitModule, module) * 2
      + moduleScore(parts.rowText, module)
    if (score > best.score) best = { moduleId: module.moduleId, score }
  }
  return best.score > 0 ? best.moduleId : inferTaskModule(parts.rowText)
}

function extractProductId(headers: string[], row: string[], rowText: string): string {
  const explicit = columnValue(headers, row, [/商品.*(?:编号|id)/i, /链接.*(?:编号|id)/i, /货号/, /sku/i])
  if (hasConcreteValue(explicit)) {
    const explicitId = explicit.match(/(?:^|[^0-9])([1-9]\d{8,14})(?!\d)/)?.[1]
    return explicitId ?? explicit
  }
  const candidates = Array.from(rowText.matchAll(/(?:^|[^0-9])([1-9]\d{8,14})(?!\d)/g)).map((match) => match[1])
  return candidates[0] ?? ""
}

function inferTaskItem(action: string, trigger: string, rowText: string): string {
  const raw = action || trigger || rowText
  return raw
    .replace(/^(任务事项|任务|动作|行动|计划|下周计划|事项)[:：]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
}

function inferResultFeedback(headers: string[], row: string[], rowText: string): string[] {
  const explicit = columnValue(headers, row, [/结果反馈/, /反馈/, /复盘/, /完成情况/, /结果/, /评价/, /总结/])
  const fallback = /(提升|下降|完成|未完成|延期|通过|复盘|ROI|转化|点击率|GMV)/i.test(rowText) ? rowText : ""
  return uniq([explicit, fallback], 3)
}

function priorityScore(priority: TaskCardDraft["priority"]): number {
  switch (priority) {
    case "critical":
      return 100
    case "high":
      return 85
    case "medium":
      return 65
    case "low":
      return 40
    default:
      return 50
  }
}

function extractionWarningsForQuality(quality: TaskCardQualityScorecard): string[] {
  const map: Record<string, string> = {
    taskModule: "missing_task_module",
    taskItem: "missing_task_item",
    businessGoal: "missing_business_goal",
    targetObject: "missing_target_object",
    problem: "missing_problem",
    problemEvidence: "missing_problem_evidence",
    strategyPath: "missing_strategy_path",
    actionSteps: "missing_action_steps",
    ownerRole: "missing_owner_role",
    collaboratorRoles: "missing_collaborator_roles",
    cadence: "missing_cadence",
    acceptanceMetrics: "missing_acceptance_metrics",
    reviewRequirement: "missing_review_requirement",
    sourceRefs: "missing_source_refs",
    resultFeedback: "missing_result_feedback",
  }
  return quality.missingElements.map((item) => map[item] ?? `missing_${item}`)
}

const TASK_REQUIRED_ELEMENTS = [
  "经营目标",
  "任务对象",
  "经营问题",
  "问题证据",
  "策略路径",
  "具体动作",
  "Owner",
  "协同角色",
  "周期/截止",
  "验收指标",
  "复盘要求",
  "证据锚点",
]

function buildTaskTaxonomy(input: {
  docId: string
  sourceName: string
  sourcePath: string
  documentBlocks: TaskDocumentBlock[]
  evidenceAnchors: string[]
}): TaskTaxonomy | null {
  const sourceText = sourceTextForRoleDetection(input)
  if (!isTaskMetaStrategyText(sourceText)) return null
  return {
    taxonomyId: `taxonomy_${stableHash(`${input.docId}|${input.sourcePath}|task-meta`)}`,
    sourceDocId: input.docId,
    sourceName: input.sourceName,
    sourcePath: input.sourcePath,
    modules: TASK_TAXONOMY_MODULES.map((module) => ({
      ...module,
      evidenceRefs: input.evidenceAnchors,
    })),
    taskElements: TASK_TAXONOMY_ELEMENTS.map((element) => ({
      ...element,
      evidenceRefs: input.evidenceAnchors,
    })),
    priorityValues: ["A1", "A2", "critical", "high", "medium", "low"],
    statusValues: ["未开始", "执行中", "已完成", "延期", "阻塞"],
    evidenceRefs: input.evidenceAnchors,
  }
}

function buildTaskRulePack(documentBlocks: TaskDocumentBlock[], evidenceAnchors: string[], taxonomy?: TaskTaxonomy | null): TaskRulePack | null {
  const sourceText = documentBlocks.map((block) => block.text).join("\n")
  if (!sourceText.trim() && !taxonomy) return null
  const requiredElements = TASK_REQUIRED_ELEMENTS.filter((element) => {
    const aliases = element === "周期/截止" ? ["周期", "截止"] : [element]
    return aliases.some((alias) => sourceText.includes(alias))
  })
  return {
    taxonomyRef: taxonomy?.taxonomyId,
    requiredElements: requiredElements.length > 0 ? requiredElements : TASK_REQUIRED_ELEMENTS,
    taskElements: taxonomy?.taskElements,
    moduleClassificationRules: taxonomy?.modules.map((module) => ({
      moduleId: module.moduleId,
      label: module.label,
      aliases: module.aliases,
      examples: module.examples,
    })),
    fieldExtractionRules: [
      "从周会/月会/周计划行中抽取 taskItem，避免把整份机制文档当成任务。",
      "优先从商品/链接/货号/SKU列或长数字识别 productId。",
      "优先从状态/进度/完成情况列识别 taskStatus。",
      "已完成或复盘类任务应从反馈/结果/复盘列抽取 resultFeedback。",
    ],
    qualityRules: [
      "taskItem、ownerRole、acceptanceMetrics、sourceRefs 是 ready 硬门槛。",
      "taskModule 强影响质量分和检索排序；unknown 需要 Review。",
      "productId 只对商品/链接类任务加分，不作为所有任务硬门槛。",
      "resultFeedback 只对已完成/复盘类任务强约束。",
    ],
    scoringWeights: {
      completenessScore: 45,
      executableScore: 35,
      evidenceScore: 20,
    },
    qualityLevels: ["ready: >=85 且无 owner/指标/证据阻塞缺口", "needs_review: 低于85或存在阻塞缺口"],
    reviewReasons: [
      "missing_owner",
      "missing_metric",
      "missing_evidence",
      "missing_deadline",
      "weak_action",
      "ambiguous_strategy",
    ],
    taskTemplates: uniq(
      documentBlocks
        .filter((block) => /(模板|任务|动作|生成过程|核心要素)/.test(block.text))
        .map((block) => block.text),
      6,
    ),
    fixSuggestions: [
      "从角色/KPI上下文补齐 Owner、协同角色和验收指标。",
      "从会议/月会/周计划证据补齐任务对象、问题证据和周期。",
      "缺少关键字段的任务保留为 needs_review，不进入可执行 Skill。",
    ],
    evidenceRefs: evidenceAnchors,
  }
}

function buildRoleContextIndex(roleProfiles: TaskRoleProfile[], evidenceAnchors: string[]): RoleContextIndex | null {
  if (roleProfiles.length === 0) return null
  const responsibilities = uniq(roleProfiles.flatMap((role) => role.responsibilities), 40)
  const kpis = uniq(roleProfiles.flatMap((role) => role.kpis), 40)
  const collaboratorRoles = uniq(roleProfiles.flatMap((role) => role.collaboratorRoles), 40)
  return {
    roles: roleProfiles,
    responsibilities,
    kpis,
    collaboratorRoles,
    ownerInferenceHints: roleProfiles.map((role) => `${role.roleName}: ${role.responsibilities.join("；") || "职责待补充"}`),
    evidenceRefs: evidenceAnchors,
  }
}

function hasConcreteValue(value: string): boolean {
  const normalized = value.trim()
  return normalized.length > 0 && !["待确认", "待补充", "无", "暂无"].includes(normalized)
}

function countMissing(items: TaskCardQualityScorecard[], element: string): number {
  return items.filter((item) => item.missingElements.includes(element)).length
}

function buildTaskCardQuality(task: Omit<TaskCardDraft, "status" | "quality">): TaskCardQualityScorecard {
  const shouldRequireProductId = task.taskModule === "new_product_launch" || task.taskModule === "existing_product_growth"
  const shouldRequireResultFeedback = task.taskStatus === "done" || /复盘|完成|结果|反馈/.test(`${task.title} ${task.trigger} ${task.actionSteps.join(" ")}`)
  const checks: Array<{ key: string; ok: boolean; label: string }> = [
    { key: "taskModule", ok: Boolean(task.taskModule && task.taskModule !== "unknown"), label: "已归类任务模块" },
    { key: "taskItem", ok: hasConcreteValue(task.taskItem ?? ""), label: "已明确任务事项" },
    { key: "businessGoal", ok: hasConcreteValue(task.title), label: "已明确经营目标或任务标题" },
    { key: "targetObject", ok: hasConcreteValue(task.targetObject), label: "已明确任务对象" },
    { key: "problem", ok: hasConcreteValue(task.trigger), label: "已明确触发问题" },
    { key: "problemEvidence", ok: task.problemEvidence.some(hasConcreteValue), label: "已有问题证据" },
    { key: "strategyPath", ok: task.actionSteps.some((item) => /(策略|路径|打法|计划|方案|排查|优化|重建|调整)/.test(item)), label: "动作中包含策略路径" },
    { key: "actionSteps", ok: task.actionSteps.some(hasConcreteValue), label: "已有具体动作" },
    { key: "ownerRole", ok: hasConcreteValue(task.ownerRole), label: "已明确 Owner" },
    { key: "collaboratorRoles", ok: task.collaboratorRoles.some(hasConcreteValue), label: "已明确协同角色" },
    { key: "cadence", ok: hasConcreteValue(task.cadence), label: "已明确周期" },
    { key: "acceptanceMetrics", ok: task.acceptanceMetrics.some(hasConcreteValue), label: "已有验收指标" },
    { key: "reviewRequirement", ok: hasConcreteValue(task.reviewRequirement), label: "已有复盘要求" },
    { key: "sourceRefs", ok: task.sourceRefs.length > 0, label: "已有证据锚点" },
    { key: "productId", ok: !shouldRequireProductId || hasConcreteValue(task.productId ?? ""), label: "商品/链接类任务已识别商品编号" },
    { key: "resultFeedback", ok: !shouldRequireResultFeedback || (task.resultFeedback ?? []).some(hasConcreteValue), label: "已完成/复盘任务已有结果反馈" },
  ]
  const missingElements = checks.filter((item) => !item.ok).map((item) => item.key)
  const strengths = checks.filter((item) => item.ok).map((item) => item.label)
  const completenessScore = Math.round((strengths.length / checks.length) * 100)
  const executableChecks = checks.filter((item) =>
    ["taskItem", "businessGoal", "targetObject", "actionSteps", "ownerRole", "collaboratorRoles", "cadence", "acceptanceMetrics", "reviewRequirement"].includes(item.key)
  )
  const executableScore = Math.round(
    (executableChecks.filter((item) => item.ok).length / executableChecks.length) * 100,
  )
  const evidenceChecks = checks.filter((item) => ["problemEvidence", "sourceRefs"].includes(item.key))
  const evidenceScore = Math.round(
    (evidenceChecks.filter((item) => item.ok).length / evidenceChecks.length) * 100,
  )
  const score = Math.round((completenessScore * 0.45) + (executableScore * 0.35) + (evidenceScore * 0.2))
  const hasBlockingGap = ["taskItem", "ownerRole", "acceptanceMetrics", "sourceRefs"].some((key) => missingElements.includes(key))
  const level = score >= 85 && !hasBlockingGap ? "ready" : "needs_review"
  const reviewNotes = missingElements.map((key) => {
    if (key === "taskModule") return "补齐任务模块，便于按电商经营板块检索和排序。"
    if (key === "taskItem") return "补齐任务事项，明确这张任务卡到底要做什么。"
    if (key === "ownerRole") return "补齐任务 Owner，避免任务无法下发。"
    if (key === "acceptanceMetrics") return "补齐验收指标，明确任务完成后如何判断有效。"
    if (key === "sourceRefs") return "补齐证据锚点，确保任务可追溯到原始材料。"
    if (key === "strategyPath") return "补齐策略路径，说明为什么选择这组动作。"
    if (key === "collaboratorRoles") return "补齐协同角色，明确跨角色配合关系。"
    if (key === "productId") return "商品/链接类任务建议补齐商品编号或链接 ID，便于按商品追踪。"
    if (key === "resultFeedback") return "已完成或复盘类任务需要补齐结果反馈，便于后续沉淀有效动作。"
    return `补齐 ${key}。`
  })
  return {
    score,
    completenessScore,
    executableScore,
    evidenceScore,
    level,
    missingElements,
    strengths: strengths.slice(0, 6),
    reviewNotes,
  }
}

function summarizeTaskQuality(scorecards: TaskCardQualityScorecard[]): TaskQualitySummary {
  const total = scorecards.length
  const ready = scorecards.filter((item) => item.level === "ready").length
  const needsReview = total - ready
  const averageScore = total > 0
    ? Math.round(scorecards.reduce((sum, item) => sum + item.score, 0) / total)
    : 0
  const missingElements = Array.from(new Set(scorecards.flatMap((item) => item.missingElements)))
    .sort((a, b) => countMissing(scorecards, b) - countMissing(scorecards, a))
    .slice(0, 8)
  return {
    total,
    ready,
    needsReview,
    averageScore,
    topMissingElements: missingElements,
  }
}

export function buildTaskContextPack(input: {
  docId: string
  sourcePath: string
  sourceName: string
  sourceKind: SourceKind
  workbook?: WorkbookIR | null
  documentBlocks: TaskDocumentBlock[]
}): TaskContextPack {
  const rows = allRows(input.workbook)
  const qualityWarnings: string[] = [...(input.workbook?.parseWarnings ?? [])]
  const evidenceAnchors = uniq([
    ...rows.flatMap(({ block }) => block.evidenceAnchors),
    ...input.documentBlocks.flatMap((block) => block.evidenceAnchors),
  ], 40)

  const operatingGoals = uniq([
    ...rows.map(({ sheet, row }) => columnValue(sheet.headers, row, [/目标/, /经营目标/, /任务对象/])),
    ...input.documentBlocks.filter((block) => /(目标|提升|完成|达成)/.test(block.text)).map((block) => block.text),
  ], 12).map((text) => evidenceText(text, evidenceAnchors))

  const roleProfiles: TaskRoleProfile[] = []
  for (const { sheet, block, row } of rows) {
    const roleName = columnValue(sheet.headers, row, [/岗位/, /负责人/, /执行人/, /责任人/, /owner/i, /^角色$/])
    if (!roleName) continue
    const kpiValue = columnValue(sheet.headers, row, [/kpi/i, /绩效/, /指标/, /验收/])
    const weightValue = columnValue(sheet.headers, row, [/权重/])
    roleProfiles.push({
      roleName,
      responsibilities: uniq([columnValue(sheet.headers, row, [/职责/, /责任/, /工作内容/, /动作/, /计划/])], 6),
      kpis: uniq([kpiValue, weightValue], 8),
      collaboratorRoles: splitRoles(columnValue(sheet.headers, row, [/协作/, /协同/, /配合/, /支持对象/])),
      evidenceRefs: block.evidenceAnchors,
    })
  }

  const taskCandidates: TaskCardDraft[] = []
  const docRole = detectDocRole(input)
  const sourcePolicy = sourcePolicyForDocRole(docRole)
  const taskTaxonomy = sourcePolicy.canProvideRules
    ? buildTaskTaxonomy({
        docId: input.docId,
        sourceName: input.sourceName,
        sourcePath: input.sourcePath,
        documentBlocks: input.documentBlocks,
        evidenceAnchors,
      })
    : null
  rows.forEach(({ sheet, block, row }, index) => {
    if (!sourcePolicy.canGenerateTaskCards) return
    const rowText = row.join(" ")
    const ownerRole = columnValue(sheet.headers, row, [/负责人/, /执行人/, /责任人/, /跟进人/, /owner/i, /岗位/, /角色/])
    const action = columnValue(sheet.headers, row, [/计划节点/, /具体事项/, /任务事项/, /下周计划/, /动作/, /行动/, /任务/, /职责/, /计划/])
    const trigger = columnValue(sheet.headers, row, [/触发/, /问题/, /卡点/, /不足/, /差距/])
    const metric = columnValue(sheet.headers, row, [/指标/, /验收/, /kpi/i, /权重/, /评分/])
    const explicitModule = columnValue(sheet.headers, row, [/任务模块/, /模块/, /分类/, /业务板块/])
    const productId = extractProductId(sheet.headers, row, rowText)
    const taskItem = inferTaskItem(action, trigger, rowText)
    const taskModule = inferTaskModuleFromParts({ explicitModule, taskItem, trigger, metric, rowText })
    const taskStatus = inferBusinessTaskStatus(sheet.headers, row, rowText)
    const resultFeedback = inferResultFeedback(sheet.headers, row, rowText)
    const title = action || trigger || columnValue(sheet.headers, row, [/目标/, /任务对象/])
    if (!title || (!ownerRole && !action && !metric)) return
    const collaboratorRoles = splitRoles(columnValue(sheet.headers, row, [/协作/, /协同/, /配合/, /支持对象/]))
    const priority = inferPriority(sheet.headers, row, rowText)
    const timeRange = inferTaskTimeRange(sheet.sheetName, input.sourceName, rowText)
    const baseTask: Omit<TaskCardDraft, "status" | "quality"> = {
      taskId: `task_${stableHash(`${input.docId}|${sheet.sheetName}|${index}|${row.join("|")}`)}`,
      title,
      taskModule,
      productId,
      taskItem,
      taskStatus,
      resultFeedback,
      trigger: trigger || "由当前经营复盘或岗位责任触发",
      targetObject: columnValue(sheet.headers, row, [/目标/, /对象/, /商品/, /链接/, /品类/]) || sheet.sheetName,
      problemEvidence: uniq([trigger], 5),
      ownerRole: ownerRole || "待确认",
      normalizedOwnerRole: normalizeRoleName(ownerRole),
      collaboratorRoles,
      actionSteps: uniq([action], 8),
      acceptanceMetrics: uniq([metric], 8),
      cadence: /周/.test(sheet.sheetName) ? "weekly" : /月/.test(sheet.sheetName) ? "monthly" : "待确认",
      reviewRequirement: "完成后按指标验收，并在周会/月会中复盘。",
      sourceRefs: block.evidenceAnchors,
      timeRange,
      priority,
      importanceScore: priorityScore(priority),
      sourceDocType: docRole,
      generationSource: "meeting_action",
      completionSources: [],
      rulePackRefs: [],
      roleContextRefs: [],
    }
    const quality = buildTaskCardQuality(baseTask)
    taskCandidates.push({
      ...baseTask,
      executableScore: quality.executableScore,
      qualityScore: quality.score,
      extractionWarnings: extractionWarningsForQuality(quality),
      quality,
      status: quality.level === "ready" ? "draft" : "needs_review",
    })
  })

  const metricRules = uniq([
    ...roleProfiles.flatMap((role) => role.kpis),
    ...rows.map(({ sheet, row }) => columnValue(sheet.headers, row, [/指标/, /验收/, /kpi/i, /权重/, /评分/])),
    ...input.documentBlocks.filter((block) => /(指标|KPI|验收|评分|达标)/i.test(block.text)).map((block) => block.text),
  ], 16).map((text) => evidenceText(text, evidenceAnchors))

  const collaborationRules = uniq([
    ...roleProfiles.flatMap((role) => role.collaboratorRoles.map((item) => `${role.roleName} 协同 ${item}`)),
    ...input.documentBlocks.filter((block) => /(协同|协作|配合|支持)/.test(block.text)).map((block) => block.text),
  ], 12).map((text) => evidenceText(text, evidenceAnchors))

  const reviewRules = uniq([
    ...input.documentBlocks.filter((block) => /(复盘|回顾|总结|验证)/.test(block.text)).map((block) => block.text),
    ...taskCandidates.map((task) => task.reviewRequirement),
  ], 12).map((text) => evidenceText(text, evidenceAnchors))

  const taskTriggers = uniq([
    ...taskCandidates.map((task) => task.trigger),
    ...input.documentBlocks.filter((block) => /(问题|卡点|不足|触发|低于|下滑)/.test(block.text)).map((block) => block.text),
  ], 16).map((text) => evidenceText(text, evidenceAnchors))

  if (taskCandidates.some((task) => task.status === "needs_review")) {
    qualityWarnings.push("部分任务卡缺少 owner、指标或证据锚点，已标记 needs_review。")
  }
  const taskQualitySummary = summarizeTaskQuality(
    taskCandidates.map((task) => task.quality ?? buildTaskCardQuality(task)),
  )
  const taskRulePack = sourcePolicy.canProvideRules
    ? buildTaskRulePack(input.documentBlocks, evidenceAnchors, taskTaxonomy)
    : null
  const roleContextIndex = sourcePolicy.canProvideRoleContext || roleProfiles.length > 0
    ? buildRoleContextIndex(roleProfiles, evidenceAnchors)
    : null

  return {
    schemaVersion: "task_context_pack_v1",
    packId: `tcp_${stableHash(`${input.docId}|${input.sourcePath}`)}`,
    sourceDocId: input.docId,
    sourceName: input.sourceName,
    sourcePath: input.sourcePath,
    sourceKind: input.sourceKind,
    docRole,
    operatingGoals,
    roleProfiles,
    taskTriggers,
    taskCandidates,
    metricRules,
    collaborationRules,
    reviewRules,
    sourcePolicy,
    taskRulePack,
    taskTaxonomy,
    roleContextIndex,
    evidenceAnchors,
    qualityWarnings,
    taskQualitySummary,
  }
}

function frontmatter(type: string, title: string, sourceRefs: string[]): string {
  return [
    "---",
    `type: ${type}`,
    `title: ${JSON.stringify(title)}`,
    "scene_id: ecom_growth_task_generation",
    "source_refs:",
    ...(sourceRefs.length > 0 ? sourceRefs.map((ref) => `  - ${JSON.stringify(ref)}`) : ["  []"]),
    "---",
    "",
  ].join("\n")
}

function section(title: string, lines: string[]): string {
  return [`## ${title}`, "", ...(lines.length > 0 ? lines : ["- 暂无稳定内容"]), ""].join("\n")
}

export function buildTaskWikiPages(pack: TaskContextPack, docSlug: string): RenderedTaskWikiPage[] {
  const refs = uniq([pack.sourcePath, ...pack.evidenceAnchors], 20)
  const roleLines = pack.roleProfiles.flatMap((role) => [
    `### ${role.roleName}`,
    role.responsibilities.length ? `- 职责：${role.responsibilities.join("；")}` : "- 职责：待补充",
    role.kpis.length ? `- KPI/指标：${role.kpis.join("；")}` : "- KPI/指标：待补充",
    role.collaboratorRoles.length ? `- 协同对象：${role.collaboratorRoles.join("、")}` : "- 协同对象：待补充",
    "",
  ])
  const taskCardLines = pack.taskCandidates.flatMap((task, index) => {
    const quality = task.quality ?? buildTaskCardQuality(task)
    return [
      `### ${index + 1}. ${task.title}`,
      `- 任务模块：${task.taskModule && task.taskModule !== "unknown" ? taskModuleLabel(task.taskModule) : "待分类"}`,
      `- 商品编号/ID：${task.productId || "不适用/待确认"}`,
      `- 任务事项：${task.taskItem || task.title}`,
      `- 触发条件：${task.trigger}`,
      `- 任务对象：${task.targetObject}`,
      `- Owner：${task.ownerRole}`,
      `- 协同角色：${task.collaboratorRoles.join("、") || "待确认"}`,
      `- 动作拆解：${task.actionSteps.join("；") || "待补充"}`,
      `- 验收指标：${task.acceptanceMetrics.join("；") || "待补充"}`,
      `- 执行状态：${task.taskStatus || "unknown"}`,
      `- 结果反馈：${task.resultFeedback?.join("；") || "暂无/待复盘"}`,
      `- 复盘要求：${task.reviewRequirement}`,
      `- 质量分：${quality.score}/100（${quality.level === "ready" ? "可候选下发" : "需人工补齐"}）`,
      `- 缺失要素：${quality.missingElements.join("、") || "无"}`,
      `- Review 建议：${quality.reviewNotes.join("；") || "暂无"}`,
      `- 状态：${task.status}`,
      "",
    ]
  })
  const taskQualitySummary = pack.taskQualitySummary
    ?? summarizeTaskQuality(pack.taskCandidates.map((task) => task.quality ?? buildTaskCardQuality(task)))
  const qualitySummaryLines = [
    `- 任务卡总数：${taskQualitySummary.total}`,
    `- 可候选下发：${taskQualitySummary.ready}`,
    `- 需 Review：${taskQualitySummary.needsReview}`,
    `- 平均质量分：${taskQualitySummary.averageScore}/100`,
    `- 主要缺口：${taskQualitySummary.topMissingElements.join("、") || "暂无"}`,
  ]
  const pages: RenderedTaskWikiPage[] = [
    {
      path: `wiki/roles/${docSlug}.md`,
      content: [
        frontmatter("role", `${pack.sourceName.replace(/\.[^.]+$/, "")} · 角色与职责`, refs),
        `# ${pack.sourceName.replace(/\.[^.]+$/, "")} · 角色与职责`,
        "",
        ...roleLines,
      ].join("\n"),
    },
  ]
  if (pack.sourcePolicy?.canGenerateTaskCards !== false) {
    pages.push({
      path: `wiki/tasks/${docSlug}.md`,
      content: [
        frontmatter("task", `${pack.sourceName.replace(/\.[^.]+$/, "")} · 可执行任务卡`, refs),
        `# ${pack.sourceName.replace(/\.[^.]+$/, "")} · 可执行任务卡`,
        "",
        section("经营目标", pack.operatingGoals.map((item) => `- ${item.text}`)),
        section("任务卡草案", taskCardLines),
      ].join("\n"),
    })
  }
  if (pack.taskRulePack) {
    pages.push({
      path: `wiki/task-rules/${docSlug}.md`,
      content: [
        frontmatter("task_rule", `${pack.sourceName.replace(/\.[^.]+$/, "")} · 任务生成规则`, refs),
        `# ${pack.sourceName.replace(/\.[^.]+$/, "")} · 任务生成规则`,
        "",
        pack.taskTaxonomy ? section("任务分类法", pack.taskTaxonomy.modules.map((item) => `- ${item.label}（${item.moduleId}）：${item.aliases.join("、")}`)) : "",
        pack.taskTaxonomy ? section("任务字段定义", pack.taskTaxonomy.taskElements.map((item) => `- ${item.label}（${item.fieldKey}）：${item.requiredForReady ? "ready硬门槛" : item.conditionalRequirement || "补充字段"}`)) : "",
        section("任务核心要素", pack.taskRulePack.requiredElements.map((item) => `- ${item}`)),
        section("字段抽取规则", (pack.taskRulePack.fieldExtractionRules ?? []).map((item) => `- ${item}`)),
        section("专业质量规则", (pack.taskRulePack.qualityRules ?? []).map((item) => `- ${item}`)),
        section("质量等级", pack.taskRulePack.qualityLevels.map((item) => `- ${item}`)),
        section("Review 原因", pack.taskRulePack.reviewReasons.map((item) => `- ${item}`)),
        section("修复建议", pack.taskRulePack.fixSuggestions.map((item) => `- ${item}`)),
      ].join("\n"),
    })
  }
  pages.push(
    {
      path: `wiki/quality/${docSlug}.md`,
      content: [
        frontmatter("quality", `${pack.sourceName.replace(/\.[^.]+$/, "")} · 质量与验收`, refs),
        `# ${pack.sourceName.replace(/\.[^.]+$/, "")} · 质量与验收`,
        "",
        section("任务卡质量汇总", qualitySummaryLines),
        section("指标与验收规则", pack.metricRules.map((item) => `- ${item.text}`)),
        section("质量提示", pack.qualityWarnings.map((item) => `- ${item}`)),
      ].join("\n"),
    },
    {
      path: `wiki/collaboration/${docSlug}.md`,
      content: [
        frontmatter("collaboration", `${pack.sourceName.replace(/\.[^.]+$/, "")} · 协同关系`, refs),
        `# ${pack.sourceName.replace(/\.[^.]+$/, "")} · 协同关系`,
        "",
        section("协同规则", pack.collaborationRules.map((item) => `- ${item.text}`)),
      ].join("\n"),
    },
    {
      path: `wiki/reviews/${docSlug}.md`,
      content: [
        frontmatter("review", `${pack.sourceName.replace(/\.[^.]+$/, "")} · 复盘沉淀`, refs),
        `# ${pack.sourceName.replace(/\.[^.]+$/, "")} · 复盘沉淀`,
        "",
        section("复盘要求", pack.reviewRules.map((item) => `- ${item.text}`)),
      ].join("\n"),
    },
  )
  return pages
}
