export type IssueScope =
  | "source_document"
  | "wiki_compile"
  | "wiki_asset"
  | "retrieval_runtime"

export type RootCause =
  | "source_missing_required_field"
  | "source_weak_judgement_criteria"
  | "source_missing_validation_method"
  | "source_missing_boundary_condition"
  | "source_weak_traceability"
  | "source_execution_too_coarse"
  | "compile_field_drop"
  | "compile_wrong_attachment"
  | "compile_missing_stage_mapping"
  | "compile_missing_source_ref_projection"
  | "compile_missing_audience_projection"
  | "compile_missing_selling_point_projection"
  | "compile_missing_creative_asset_projection"
  | "compile_missing_metric_projection"
  | "compile_missing_action_projection"
  | "compile_missing_relation_projection"
  | "wiki_broken_link"
  | "wiki_orphan_page"
  | "wiki_no_outlinks"
  | "wiki_missing_metadata"
  | "wiki_missing_source_refs"
  | "wiki_contradiction"
  | "wiki_stale_claim"
  | "wiki_missing_topic_page"
  | "wiki_weak_summary"
  | "retrieval_not_indexed"
  | "retrieval_priority_miss"
  | "retrieval_grounding_gap"
  | "retrieval_answer_miss"

export type HealthStatus = "healthy" | "watch" | "at_risk"
export type GateStatus = "pass" | "warn" | "fail"

export interface HealthDimensionScore {
  key: string
  label: string
  score: number
  weight: number
  status: HealthStatus
  blockingBelow?: number
  rationale: string
  linkedIssueIds: string[]
}

export interface HealthScorecard {
  score: number
  status: HealthStatus
  summary: string
  dimensions: HealthDimensionScore[]
  updatedAt: string
}

export interface PublishGateRuleResult {
  ruleKey: string
  label: string
  status: GateStatus
  blocking: boolean
  message: string
  linkedIssueIds: string[]
}

export interface PublishGateDecision {
  gateKey: "revision_publish" | "wiki_publish"
  mode: "soft"
  status: GateStatus
  canPublish: boolean
  overrideRequired: boolean
  summary: string
  rules: PublishGateRuleResult[]
  generatedAt: string
}

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0
  return Math.max(0, Math.min(100, Math.round(score)))
}

export function deriveHealthStatus(score: number, watchBelow = 80, riskBelow = 60): HealthStatus {
  if (score < riskBelow) return "at_risk"
  if (score < watchBelow) return "watch"
  return "healthy"
}

export function deriveGateStatus(rules: PublishGateRuleResult[]): GateStatus {
  if (rules.some((rule) => rule.status === "fail")) return "fail"
  if (rules.some((rule) => rule.status === "warn")) return "warn"
  return "pass"
}

export function buildEmptyHealthScorecard(summary = "尚未生成健康评分。"): HealthScorecard {
  return {
    score: 0,
    status: "watch",
    summary,
    dimensions: [],
    updatedAt: new Date().toISOString(),
  }
}

export function buildEmptyPublishGateDecision(
  gateKey: PublishGateDecision["gateKey"],
  summary = "尚未生成发布门禁。",
): PublishGateDecision {
  return {
    gateKey,
    mode: "soft",
    status: "warn",
    canPublish: true,
    overrideRequired: false,
    summary,
    rules: [],
    generatedAt: new Date().toISOString(),
  }
}

export function labelForIssueScope(scope: IssueScope): string {
  switch (scope) {
    case "source_document":
      return "原文质量"
    case "wiki_compile":
      return "Wiki 编译"
    case "wiki_asset":
      return "Wiki 资产"
    case "retrieval_runtime":
      return "检索运行时"
  }
}

export function labelForHealthStatus(status: HealthStatus): string {
  switch (status) {
    case "healthy":
      return "健康"
    case "watch":
      return "关注"
    case "at_risk":
      return "风险"
  }
}

export function labelForGateStatus(status: GateStatus): string {
  switch (status) {
    case "pass":
      return "通过"
    case "warn":
      return "警告"
    case "fail":
      return "高风险"
  }
}

export function summarizeGateDecision(decision: PublishGateDecision): string {
  if (decision.rules.length === 0) return decision.summary
  const lead = labelForGateStatus(decision.status)
  const highlights = decision.rules
    .filter((rule) => rule.status !== "pass")
    .slice(0, 3)
    .map((rule) => rule.label)
  if (highlights.length === 0) return `${lead}：当前没有明显阻塞项。`
  return `${lead}：${highlights.join("；")}`
}
