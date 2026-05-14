import type {
  AgentRunDegradationReason,
  AgentRunResult,
  ExecutionPhaseStatus,
  ExecutionTimelineEntry,
  SkillStepExecution,
  SkillStepTaskType,
  SkillStepStatus,
  StrategyActionCardStatus,
  StrategyCardType,
  StrategySkillCandidateManifest,
} from "@/lib/agent-mode-types"

export type SkillTier = "pilot" | "stable"

const TYPE_LABELS: Record<StrategyCardType, string> = {
  audience_segment_diagnosis: "人群诊断",
  value_prop_selection: "卖点选择",
  creative_asset_brief_generation: "素材表达",
  metric_signal_diagnosis: "指标判断",
  optimization_action_planning: "优化动作",
  experiment_validation_plan: "实验验证",
  generic: "业务策略",
}

const STATUS_LABELS: Record<StrategyActionCardStatus, string> = {
  draft: "待确认",
  confirmed: "已确认",
  rejected: "暂不采用",
  promoted_to_skill: "可生成能力",
}

const TIER_LABELS: Record<SkillTier, string> = {
  pilot: "试运行",
  stable: "正式启用",
}

const TIER_DESCRIPTIONS: Record<SkillTier, string> = {
  pilot: "先用于当前项目人工触发验证",
  stable: "可作为常用业务能力调用",
}

export function strategyCardTypeLabel(type: StrategyCardType): string {
  return TYPE_LABELS[type] ?? TYPE_LABELS.generic
}

export function strategyActionStatusLabel(status: StrategyActionCardStatus): string {
  return STATUS_LABELS[status] ?? status
}

export function skillTierLabel(tier: SkillTier): string {
  return TIER_LABELS[tier]
}

export function skillTierDescription(tier: SkillTier): string {
  return TIER_DESCRIPTIONS[tier]
}

export function formatBusinessText(value: string): string {
  return value
    .replace(/\bCTR\b/g, "点击率")
    .replace(/\bCVR\b/g, "转化率")
    .replace(/\bROI\b/g, "投入产出比")
    .replace(/\bA\/B test\b/gi, "A/B 测试")
    .replace(/\bgenerate_asset_brief\b/gi, "生成素材说明")
    .replace(/\bdiagnose_document\b/gi, "诊断当前文档")
    .replace(/\bgenerate_strategy\b/gi, "生成下一轮策略")
    .replace(/\bvalidate_action_plan\b/gi, "验证动作方案")
    .replace(/\bgenerate asset brief\b/gi, "生成素材说明")
    .replace(/\basset brief\b/gi, "素材说明")
    .replace(/\bbrief\b/gi, "说明")
    .replace(/\bwith\b/gi, "与")
    .replace(/\bgeneric\b/gi, "通用业务策略")
    .replace(/\bstrategy-action\b/gi, "动作卡")
    .replace(/\bAgent\b/g, "智能执行助手")
    .replace(/\bSkill\b/g, "业务能力")
    .replace(/\bskill\b/g, "业务能力")
    .replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, "$1")
    .replace(/([\u4e00-\u9fff])\s+([，。；：、])/g, "$1$2")
    .replace(/([，。；：、])\s+([\u4e00-\u9fff])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim()
}

export function skillCandidateDisplayName(candidate: StrategySkillCandidateManifest): string {
  const title = formatBusinessText(candidate.title || "").trim()
  if (title) return title
  const artifact = formatBusinessText(candidate.outputArtifact || "").trim()
  if (artifact) return `${strategyCardTypeLabel(candidate.family)}：${artifact}`
  return strategyCardTypeLabel(candidate.family)
}

export function skillCandidateSummary(candidate: StrategySkillCandidateManifest): string {
  return formatBusinessText(candidate.summary || candidate.outputArtifact || "来自已确认动作卡的业务能力候选。")
}

export function strategyInputFieldLabel(label: string): string {
  if (label === "objective") return "本次要产出的业务结果"
  if (label === "decision_rules") return "业务判断规则"
  if (label === "current_hero_image_urls") return "当前主图链接或截图路径"
  if (label === "current_ctr_data") return "当前点击率数据"
  return formatBusinessText(label)
}

export function strategyInputFieldExample(label: string): string {
  if (label === "objective") return "生成一版可交付给设计的主图素材说明，明确人群、卖点、画面元素和验证指标。"
  if (label === "decision_rules") {
    return [
      "1. 如果点击率低于类目均值，先检查第一眼是否能看懂核心卖点。",
      "2. 如果收藏加购高但转化率低，优先检查价格、信任背书和详情承接。",
      "3. 如果新客点击弱，主图先强化使用场景和人群痛点，不先堆参数。",
    ].join("\n")
  }
  if (label === "current_hero_image_urls") {
    return [
      "https://example.com/current-main-image-1.png",
      "/Users/xxx/Desktop/main-image-a.png",
      "当前主图是白底产品图，左侧产品，右侧卖点文案“护眼防滑”，没有明显使用场景。",
    ].join("\n")
  }
  if (label === "current_ctr_data") {
    return [
      "当前主图点击率 2.1%，类目均值 3.5%，近 7 天曝光 12,000，点击 252。",
      "A 图点击率 2.1%，B 图点击率 3.0%，B 图使用了场景化背景和更大的核心卖点。",
      "如果没有精确数据：点击率低于预期，收藏加购正常，怀疑第一眼卖点不清晰。",
    ].join("\n")
  }
  return ""
}

export function strategyInputFieldPlaceholder(label: string): string {
  const example = strategyInputFieldExample(label)
  if (!example) return `请输入${strategyInputFieldLabel(label)}`
  return `可直接点击“应用实例”，或参考填写：\n${example}`
}

export function strategyInputFieldHelp(label: string): string[] {
  if (label === "decision_rules") {
    return [
      "写“什么信号出现时，判断什么问题，下一步优先改什么”。",
      "案例：点击率低 + 卖点不突出 -> 先改首屏卖点表达和视觉焦点。",
      "案例：转化率低 + 点击率正常 -> 不急着换图，先检查价格、评价、详情承接。",
    ]
  }
  if (label === "current_hero_image_urls") {
    return [
      "可填图片 URL、本地截图路径，或直接用文字描述当前主图。",
      "案例：主图是蓝色背景，产品在中间，文案强调“防滑耐脏”，没有出现使用场景。",
      "案例：填写 2-3 张竞品/当前主图链接，便于对比素材表达。",
    ]
  }
  if (label === "current_ctr_data") {
    return [
      "建议写清楚时间范围、曝光量、点击量、点击率，以及对比基准。",
      "案例：近 7 天点击率 2.1%，类目均值 3.5%，主要问题是曝光够但点击弱。",
      "案例：测试图 A 点击率 2.1%，测试图 B 点击率 3.0%，B 图胜出，差异是卖点更明显。",
    ]
  }
  return []
}

function asString(value: unknown): string {
  return typeof value === "string" ? formatBusinessText(value) : ""
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => asString(item)).filter(Boolean)
  }
  const text = asString(value)
  return text ? [text] : []
}

export interface BusinessRunSection {
  title: string
  body?: string
  items?: string[]
}

export function agentRunStatusLabel(status: AgentRunResult["status"]): string {
  if (status === "needs_input") return "需要补充输入"
  if (status === "validation_failed") return "输出校验未通过"
  if (status === "degraded") return "已降级生成"
  if (status === "error") return "运行失败"
  if (status === "running") return "运行中"
  return "已完成"
}

const TIMELINE_STATUS_LABELS: Record<ExecutionPhaseStatus, string> = {
  pending: "等待中",
  running: "运行中",
  completed: "已完成",
  degraded: "已降级",
  failed: "失败",
  skipped: "已跳过",
}

export function executionTimelineStatusLabel(status: ExecutionPhaseStatus): string {
  return TIMELINE_STATUS_LABELS[status] ?? status
}

const STEP_STATUS_LABELS: Record<SkillStepStatus, string> = {
  completed: "已完成",
  degraded: "模板兜底",
  failed: "步骤失败",
  skipped: "已跳过",
}

export function skillStepStatusLabel(status: SkillStepStatus): string {
  return STEP_STATUS_LABELS[status] ?? status
}

const STEP_TASK_TYPE_LABELS: Record<SkillStepTaskType, string> = {
  read_file: "读取文件",
  local_tool: "本地工具",
  data_extract: "数据抽取",
  data_transform: "数据整理",
  human_review: "专家确认",
  llm_reasoning: "模型判断",
}

export function skillStepTaskTypeLabel(type?: string): string {
  if (!type) return "本地执行"
  return STEP_TASK_TYPE_LABELS[type as SkillStepTaskType] ?? formatBusinessText(type)
}

export function formatExecutionDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "瞬时"
  if (durationMs < 1000) return `${durationMs}ms`
  return `${(durationMs / 1000).toFixed(1)}s`
}

export function buildExecutionTimelineItems(entries?: ExecutionTimelineEntry[]): ExecutionTimelineEntry[] {
  return (entries ?? []).filter((entry) => entry.phase && entry.title)
}

export function buildSkillStepExecutionItems(steps?: SkillStepExecution[]): SkillStepExecution[] {
  return (steps ?? [])
    .filter((step) => Number.isFinite(step.stepIndex) && step.stepTitle)
    .sort((left, right) => left.stepIndex - right.stepIndex)
}

export function formatDegradationReason(reason?: AgentRunDegradationReason | null): string {
  if (!reason) return ""
  return `${reason.title}：${reason.detail}${reason.recommendedAction ? ` 建议：${reason.recommendedAction}` : ""}`
}

export function buildAgentRunBusinessSections(output?: Record<string, unknown>): BusinessRunSection[] {
  if (!output) return []
  const sections: BusinessRunSection[] = []
  const outputArtifact = asString(output.output_artifact)
  if (outputArtifact) {
    sections.push({ title: "交付产物", body: outputArtifact })
  }
  const diagnosis = asString(output.diagnosis)
  if (diagnosis) {
    sections.push({ title: "诊断结论", body: diagnosis })
  }
  const recommendedChanges = asStringList(output.recommended_changes)
  if (recommendedChanges.length > 0) {
    sections.push({ title: "建议动作", items: recommendedChanges })
  }
  const actionSteps = asStringList(output.action_steps)
  if (actionSteps.length > 0) {
    sections.push({ title: "执行步骤", items: actionSteps })
  }
  const validationPlan = asString(output.validation_plan)
  if (validationPlan) {
    sections.push({ title: "验证计划", body: validationPlan })
  }
  const evidenceRefs = asStringList(output.evidence_refs)
  const wikiRefs = asStringList(output.wiki_refs)
  const refs = [...evidenceRefs, ...wikiRefs]
  if (refs.length > 0) {
    sections.push({ title: "依据来源", items: refs })
  }
  const reviewNotes = asStringList(output.review_notes)
  if (reviewNotes.length > 0) {
    sections.push({ title: "待专家确认", items: reviewNotes })
  }
  return sections
}
