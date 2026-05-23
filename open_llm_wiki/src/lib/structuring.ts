import { streamChat } from "@/lib/llm-client"
import { buildDocumentIR } from "@/lib/document-ir"
import { extractJsonObject } from "@/lib/sweep-reviews"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { buildSceneCompileArtifacts } from "@/lib/scene-compile"
import { enhancePdfDocument } from "@/lib/pdf-enhanced"
import { detectSourceKind } from "@/lib/document-preparation"
import {
  buildTaskContextPack,
  extractTaskDocumentBlocks,
  extractWorkbookIRFromMarkdown,
} from "@/lib/task-context-pack"
import type { LlmConfig } from "@/stores/wiki-store"
import { useWikiStore } from "@/stores/wiki-store"
import type {
  AgentModeReport,
  BusinessObjectProjection,
  BusinessRelationProjection,
  BlockAssessment,
  DecisionPoint,
  DocumentIR,
  DocumentUnderstanding,
  EntityCandidate,
  FieldAssessment,
  FieldCoverageStatus,
  GroundTruthDraft,
  GroundTruthFieldValue,
  ImprovementActionType,
  ImprovementPriority,
  ImprovementTask,
  IssueSeverity,
  BlockIssueType,
  PreparedDocumentArtifact,
  ReviewSummary,
  RevisionIssueCard,
  ScenePack,
  WikiCompileSidecar,
} from "@/lib/agent-mode-types"
import {
  clampScore,
  deriveGateStatus,
  deriveHealthStatus,
  type HealthDimensionScore,
  type HealthScorecard,
  type PublishGateDecision,
  type PublishGateRuleResult,
  type RootCause,
} from "@/lib/quality-contracts"

interface RunStructuringInput {
  projectPath: string
  sourcePath: string
  sourceContent: string
  analysis: string
  scenePack: ScenePack
  llmConfig: LlmConfig
  signal?: AbortSignal
  preparedDocumentArtifact?: PreparedDocumentArtifact | null
  skipLlmRefinement?: boolean
}

type StructuringJson = Partial<{
  summary: string
  title: string
  mainline_steps: string[]
  sop_steps: string[]
  key_judgements: string[]
  business_rules: string[]
  decision_points: Array<{
    title?: string
    condition?: string
    action?: string
    evidence_block_refs?: string[]
  }>
  entity_candidates: Array<{
    name?: string
    entity_type?: string
    aliases?: string[]
    evidence_block_refs?: string[]
    confidence?: number
  }>
  evidence_highlights: string[]
  image_evidence_highlights: string[]
  mindmap_summary: string[]
  terminology: string[]
  risks: string[]
  open_questions: string[]
  missing_field_keys: string[]
  fields: Array<{
    key: string
    label: string
    value: string
    notes?: string
    evidence_block_refs?: string[]
  }>
}>

function isHeroImageScene(scenePack: ScenePack): boolean {
  return scenePack.manifest.scene_id === "ecom_growth_hero_image"
}

function isTaskGenerationScene(scenePack: ScenePack): boolean {
  return scenePack.manifest.scene_id === "ecom_growth_task_generation"
}

function readSceneFields(scenePack: ScenePack): Array<{ key: string; label: string; required: boolean; cues: string[] }> {
  const rawFields = Array.isArray(scenePack.schemaProfile.fields)
    ? scenePack.schemaProfile.fields
    : []
  return rawFields
    .map((field) => {
      if (!field || typeof field !== "object") return null
      const obj = field as Record<string, unknown>
      return {
        key: String(obj.key ?? ""),
        label: String(obj.label ?? obj.key ?? ""),
        required: Boolean(obj.required),
        cues: Array.isArray(obj.cues) ? obj.cues.map((item) => String(item)) : [],
      }
    })
    .filter((item): item is { key: string; label: string; required: boolean; cues: string[] } => Boolean(item?.key))
}

function compactLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function coerceTrimmedString(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim()
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    for (const key of ["value", "text", "label", "title", "content", "name"]) {
      const candidate = record[key]
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim()
      }
    }
  }
  return ""
}

function takeUnique(items: readonly unknown[], max: number): string[] {
  return Array.from(new Set(items.map((item) => coerceTrimmedString(item)).filter(Boolean))).slice(0, max)
}

function collectByPattern(lines: string[], pattern: RegExp, max: number): string[] {
  return takeUnique(
    lines
      .filter((line) => pattern.test(line))
      .map((line) => line.replace(/^[-*\d.\s]+/, "").trim()),
    max,
  )
}

function inferSummary(lines: string[]): string {
  const opening = takeUnique(lines.slice(0, 8), 3)
  return opening.join(" ").slice(0, 320) || "这是一份待整理的业务文档，建议结合主流程、关键判断和证据进一步沉淀。"
}

function inferMainlineSteps(lines: string[]): string[] {
  const numbered = collectByPattern(lines, /^\d+\.\s+/, 8)
  if (numbered.length > 0) return numbered
  return collectByPattern(lines, /(步骤|阶段|第一步|第二步|流程|先)/, 8)
}

function inferJudgements(lines: string[]): string[] {
  return collectByPattern(lines, /(判断|标准|需要看|优先|核心|关键|决定)/, 8)
}

function inferEvidence(lines: string[]): string[] {
  return collectByPattern(lines, /(数据|案例|证据|CTR|ROI|转化|指标)/i, 6)
}

function inferBoundaries(lines: string[]): string[] {
  return collectByPattern(lines, /(边界|例外|风险|不适用|注意|误区)/, 6)
}

function inferOpenQuestions(lines: string[]): string[] {
  return collectByPattern(lines, /(\?|待确认|待补充|待验证|进一步)/, 6)
}

function inferBusinessRules(lines: string[]): string[] {
  return collectByPattern(lines, /(必须|需要|应当|禁止|建议|优先|标准|规则)/, 10)
}

function inferDecisionPoints(lines: string[]): DecisionPoint[] {
  return takeUnique(
    lines.filter((line) => /(如果|当|是否|判断|条件|异常|达标)/.test(line)).slice(0, 8),
    8,
  ).map((line, index) => ({
    title: `决策点 ${index + 1}`,
    condition: line,
    action: "需要结合上下文确认下一步动作。",
    evidenceBlockRefs: [],
  }))
}

function inferEntityCandidates(lines: string[]): EntityCandidate[] {
  const stopwords = new Set(["步骤", "流程", "内容", "这个", "当前", "业务", "资料", "方法", "问题", "目标", "方案", "阶段"])
  const counts = new Map<string, number>()
  for (const token of lines.flatMap((line) => line.match(/[A-Za-z0-9\u4e00-\u9fff]{2,24}/g) ?? [])) {
    const normalized = token.trim()
    if (!normalized || stopwords.has(normalized)) continue
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 12)
    .map(([name, count], index) => ({
      name,
      entityType:
        /(人群|用户|买家|客户|同事|商家)/.test(name)
          ? "audience"
          : /(主图|素材|页面|详情|海报|视频|图标)/.test(name)
            ? "asset"
            : /(sku|商品|产品|类目|品牌|店铺)/i.test(name)
              ? "business_object"
              : index < 4
                ? "core_business_entity"
                : "business_term",
      aliases: [],
      evidenceBlockRefs: [],
      confidence: Math.max(0.42, Math.min(0.88, 0.45 + (count * 0.08))),
    }))
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function truncateInline(value: string, max = 140): string {
  const normalized = normalizeInlineText(value)
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(0, max - 1)).trim()}…`
}

function formatDecisionPoint(point: DecisionPoint, index: number): string {
  const title = point.title?.trim() || `决策点 ${index + 1}`
  const condition = point.condition?.trim() || "待补充判断条件"
  const action = point.action?.trim() || "待补充后续动作"
  return `${title}：当「${condition}」时，建议「${action}」`
}

function inferMetricSignals(lines: string[]): string[] {
  return collectByPattern(lines, /(gmv|roi|ctr|cvr|cv|点击|曝光|转化|客单|退款|成交|利润|成本|消耗|留存|完播|收藏|加购)/i, 12)
}

function buildTableEvidenceHighlights(
  normalized: PreparedDocumentArtifact["normalizedBundle"] | null | undefined,
): string[] {
  return takeUnique(
    (normalized?.tables ?? []).flatMap((table, index) => {
      const heading = table.headingPath.filter(Boolean).join(" / ")
      const headerLine = table.headers.filter(Boolean).slice(0, 5).join("、")
      const sampleRow = table.rows
        .find((row) => row.some((cell) => coerceTrimmedString(cell)))
        ?.map((cell, columnIndex) => {
          const header = table.headers[columnIndex] || `字段${columnIndex + 1}`
          const value = coerceTrimmedString(cell)
          return value ? `${header}=${value}` : ""
        })
        .filter(Boolean)
        .slice(0, 4)
        .join("；")
      const summary = [
        heading ? `表格证据：${heading}` : `表格证据 ${index + 1}`,
        headerLine ? `字段包含 ${headerLine}` : "",
        sampleRow ? `样例 ${sampleRow}` : "",
      ].filter(Boolean).join("；")
      return summary ? [summary] : []
    }),
    8,
  )
}

function buildImageEvidenceHighlights(
  normalized: PreparedDocumentArtifact["normalizedBundle"] | null | undefined,
): string[] {
  return takeUnique(
    (normalized?.images ?? []).map((image, index) => {
      const title = coerceTrimmedString(image.title ?? image.caption ?? image.assetPath)
      const anchor = coerceTrimmedString(image.sourceAnchorId)
      return [
        `图片证据：${title || `图片 ${index + 1}`}`,
        image.approximateAnchor ? "当前挂载点为近似位置" : "",
        anchor ? `锚点 ${anchor}` : "",
      ].filter(Boolean).join("；")
    }),
    8,
  )
}

function buildRevisionHighlights(
  normalized: PreparedDocumentArtifact["normalizedBundle"] | null | undefined,
): string[] {
  return takeUnique(
    (normalized?.revisionMarks ?? []).map((mark, index) => {
      const kind = coerceTrimmedString(mark.kind) || `revision_${index + 1}`
      const text = truncateInline(coerceTrimmedString(mark.text), 110)
      if (!text) return ""
      return `修订痕迹：${kind}：${text}`
    }),
    6,
  )
}

function mergeDecisionPoints(...groups: Array<DecisionPoint[] | null | undefined>): DecisionPoint[] {
  const merged = new Map<string, DecisionPoint>()
  for (const group of groups) {
    for (const item of group ?? []) {
      const title = coerceTrimmedString(item.title)
      const condition = coerceTrimmedString(item.condition)
      const action = coerceTrimmedString(item.action)
      const key = `${title}::${condition}::${action}`
      if (!condition && !action) continue
      if (!merged.has(key)) {
        merged.set(key, {
          title: title || `决策点 ${merged.size + 1}`,
          condition,
          action,
          evidenceBlockRefs: takeUnique(item.evidenceBlockRefs ?? [], 6),
        })
      }
    }
  }
  return Array.from(merged.values()).slice(0, 10)
}

function mergeEntityCandidates(...groups: Array<EntityCandidate[] | null | undefined>): EntityCandidate[] {
  const merged = new Map<string, EntityCandidate>()
  for (const group of groups) {
    for (const item of group ?? []) {
      const name = coerceTrimmedString(item.name)
      if (!name) continue
      const existing = merged.get(name)
      const next: EntityCandidate = {
        name,
        entityType: coerceTrimmedString(item.entityType) || existing?.entityType || "business_term",
        aliases: takeUnique([...(existing?.aliases ?? []), ...(item.aliases ?? [])], 8),
        evidenceBlockRefs: takeUnique([...(existing?.evidenceBlockRefs ?? []), ...(item.evidenceBlockRefs ?? [])], 8),
        confidence: Math.max(existing?.confidence ?? 0, Number(item.confidence ?? 0) || 0),
      }
      merged.set(name, next)
    }
  }
  return Array.from(merged.values())
    .sort((a, b) => b.confidence - a.confidence || b.name.length - a.name.length)
    .slice(0, 12)
}

function buildBusinessSummary(
  fallbackSummary: string,
  mainlineSteps: string[],
  keyJudgements: string[],
  metrics: string[],
  businessRules: string[],
): string {
  const opening = coerceTrimmedString(fallbackSummary)
  const pieces = [
    opening,
    mainlineSteps[0] ? `主链路起点通常是：${truncateInline(mainlineSteps[0], 48)}` : "",
    keyJudgements[0] ? `关键判断聚焦：${truncateInline(keyJudgements[0], 48)}` : "",
    metrics.length > 0 ? `常被提到的指标包括：${metrics.slice(0, 3).join("、")}` : "",
    businessRules[0] ? `文档里已有较强规则信号：${truncateInline(businessRules[0], 52)}` : "",
  ].filter(Boolean)
  return truncateInline(pieces.join(" "), 320) || "这是一份待整理的业务文档，建议结合主流程、关键判断和证据进一步沉淀。"
}

function normalizeBusinessLabel(label: string): string {
  return label
    .replace(/^[-*\d.\s]+/, "")
    .replace(/^[：:]/, "")
    .replace(/\s+/g, " ")
    .trim()
}

function inferAudienceSignals(lines: string[]): string[] {
  return collectByPattern(lines, /(人群|用户|客户|买家|受众|消费者|宝妈|学生|白领|新手|老客|高客单|价格敏感)/, 10)
}

function inferSellingPointSignals(lines: string[]): string[] {
  return collectByPattern(lines, /(卖点|利益点|核心点|价值点|购买理由|痛点|省时|省力|好看|性价比|品质|功效)/, 10)
}

function inferCreativeAssetSignals(lines: string[]): string[] {
  return collectByPattern(lines, /(主图|素材|版式|构图|文案|背景|模特|细节图|场景图|视觉|颜色|标题|字体|icon)/i, 10)
}

function inferActionSignals(lines: string[]): string[] {
  return collectByPattern(lines, /(优化|调整|替换|增加|减少|强化|突出|弱化|测试|AB|A\/B|先改|优先改|动作)/i, 12)
}

function inferAudienceObjects(lines: string[]): string[] {
  return takeUnique([
    ...inferAudienceSignals(lines),
    ...lines.flatMap((line) => line.match(/(宝妈|学生党|通勤族|上班族|新客|老客|高消费人群|价格敏感人群|送礼人群|复购人群)/g) ?? []),
  ], 8).map(normalizeBusinessLabel)
}

function inferValueProps(lines: string[]): string[] {
  return takeUnique([
    ...inferSellingPointSignals(lines),
    ...lines.flatMap((line) => line.match(/(低价|优惠|高颜值|高品质|安全|方便|显瘦|速干|大容量|正品|保暖|轻便|高转化)/g) ?? []),
  ], 8).map(normalizeBusinessLabel)
}

function inferCreativeAssets(lines: string[], normalized: PreparedDocumentArtifact["normalizedBundle"] | null | undefined): string[] {
  const imageHints = (normalized?.images ?? [])
    .map((image) => normalizeBusinessLabel(coerceTrimmedString(image.title ?? image.caption ?? image.assetPath)))
    .filter(Boolean)
  return takeUnique([
    ...inferCreativeAssetSignals(lines),
    ...imageHints,
  ], 8).map(normalizeBusinessLabel)
}

function inferMetricObjects(lines: string[]): string[] {
  return takeUnique([
    ...inferMetricSignals(lines),
    ...lines.flatMap((line) => line.match(/(CTR|CVR|ROI|GMV|点击率|转化率|跳失率|加购率|退款率|停留时长|曝光量)/gi) ?? []),
  ], 8).map(normalizeBusinessLabel)
}

function inferActionObjects(lines: string[]): string[] {
  return takeUnique([
    ...inferActionSignals(lines),
    ...lines.flatMap((line) => line.match(/(替换主图|强化文案|突出卖点|更换背景|增加对比|提高信息密度|增加信任元素|做AB测试|细分人群)/g) ?? []),
  ], 8).map(normalizeBusinessLabel)
}

function slugifyProjectionId(parts: string[]): string {
  const raw = parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return raw || "projection"
}

function toBusinessObjects(
  objectType: BusinessObjectProjection["objectType"],
  labels: string[],
  entityCandidates: EntityCandidate[],
): BusinessObjectProjection[] {
  return labels
    .filter(Boolean)
    .map((label, index) => {
      const related = entityCandidates.find((candidate) => candidate.name.includes(label) || label.includes(candidate.name))
      return {
        objectId: `${objectType}-${slugifyProjectionId([label, String(index + 1)])}`,
        objectType,
        label,
        summary: label,
        evidenceBlockRefs: related?.evidenceBlockRefs ?? [],
        confidence: related?.confidence ?? 0.68,
      }
    })
}

function createRelation(
  type: BusinessRelationProjection["type"],
  fromObject: BusinessObjectProjection | undefined,
  toObject: BusinessObjectProjection | undefined,
  rationale: string,
): BusinessRelationProjection | null {
  if (!fromObject || !toObject) return null
  return {
    relationId: `${type}-${fromObject.objectId}-${toObject.objectId}`,
    type,
    fromObjectId: fromObject.objectId,
    toObjectId: toObject.objectId,
    rationale,
    evidenceBlockRefs: takeUnique([
      ...fromObject.evidenceBlockRefs,
      ...toObject.evidenceBlockRefs,
    ], 6),
    confidence: Math.max(0.62, Math.min(0.9, (fromObject.confidence + toObject.confidence) / 2)),
  }
}

function buildHeroImageBusinessProjection(
  lines: string[],
  normalized: PreparedDocumentArtifact["normalizedBundle"] | null | undefined,
  entityCandidates: EntityCandidate[],
): {
  businessObjects: BusinessObjectProjection[]
  businessRelations: BusinessRelationProjection[]
} {
  const audienceObjects = toBusinessObjects("audience_segment", inferAudienceObjects(lines), entityCandidates)
  const valueObjects = toBusinessObjects("value_proposition", inferValueProps(lines), entityCandidates)
  const creativeObjects = toBusinessObjects("creative_asset_pattern", inferCreativeAssets(lines, normalized), entityCandidates)
  const metricObjects = toBusinessObjects("metric_signal", inferMetricObjects(lines), entityCandidates)
  const actionObjects = toBusinessObjects("optimization_action", inferActionObjects(lines), entityCandidates)
  const businessObjects = [
    ...audienceObjects,
    ...valueObjects,
    ...creativeObjects,
    ...metricObjects,
    ...actionObjects,
  ].slice(0, 24)
  const relations = [
    createRelation("cares_about", audienceObjects[0], valueObjects[0], "该人群优先关注这类卖点或利益点。"),
    createRelation("expressed_by", valueObjects[0], creativeObjects[0], "该卖点通过主图素材、文案或版式被表达出来。"),
    createRelation("influences", creativeObjects[0], metricObjects[0], "素材或版式变化会直接影响该指标信号。"),
    createRelation("triggers", metricObjects[0], actionObjects[0], "当指标异常时，会触发对应优化动作。"),
    createRelation("targets", actionObjects[0], audienceObjects[0], "该优化动作主要针对这类人群。"),
    createRelation("tests", actionObjects[0], creativeObjects[0], "该动作通过测试或替换素材模式来验证。"),
  ].filter((item): item is BusinessRelationProjection => Boolean(item))
  return {
    businessObjects,
    businessRelations: relations,
  }
}

function mapFieldAssessmentStatus(value: string, required: boolean): FieldCoverageStatus {
  if (!value.trim()) return required ? "missing" : "weak"
  if (value.trim().length < 30) return required ? "weak" : "needs_confirmation"
  return "covered"
}

function rootCauseForField(fieldKey: string, status: FieldCoverageStatus): RootCause | null {
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

function actionForStatus(status: FieldCoverageStatus): ImprovementActionType {
  switch (status) {
    case "missing":
      return "supplement"
    case "weak":
      return "rewrite"
    case "needs_confirmation":
      return "confirm"
    case "inferred":
      return "clarify"
    default:
      return "confirm"
  }
}

function priorityForStatus(status: FieldCoverageStatus): ImprovementPriority {
  switch (status) {
    case "missing":
      return "high"
    case "weak":
      return "high"
    case "needs_confirmation":
      return "medium"
    case "inferred":
      return "medium"
    default:
      return "low"
  }
}

function scoreForStatus(status: FieldCoverageStatus): number {
  switch (status) {
    case "covered":
      return 1
    case "needs_confirmation":
      return 0.65
    case "inferred":
      return 0.55
    case "weak":
      return 0.35
    case "missing":
      return 0
  }
}

function buildFieldValues(
  ir: DocumentIR,
  understanding: DocumentUnderstanding,
  scenePack: ScenePack,
): GroundTruthFieldValue[] {
  const blocksText = ir.blocks.map((block) => block.textContent)
  const sceneFields = readSceneFields(scenePack)
  const fields: GroundTruthFieldValue[] = []

  for (const field of sceneFields) {
    const matchingBlocks = ir.blocks.filter((block) =>
      field.cues.some((cue) => block.textContent.includes(cue)),
    )
    let value = ""
    if (field.key === "mainline_steps") {
      value = understanding.mainlineSteps.join("\n")
    } else if (field.key === "key_judgements") {
      value = understanding.keyJudgements.join("\n")
    } else if (field.key === "evidence") {
      value = understanding.evidenceHighlights.join("\n")
    } else if (field.key === "boundaries") {
      value = understanding.risks.join("\n")
    } else if (field.key === "target_audiences") {
      value = understanding.businessObjects
        .filter((item) => item.objectType === "audience_segment")
        .map((item) => item.label)
        .join("\n")
    } else if (field.key === "audience_situations") {
      value = understanding.businessRules
        .filter((item) => /(场景|需求|痛点|任务|用户)/.test(item))
        .join("\n")
    } else if (field.key === "selling_points") {
      value = understanding.businessObjects
        .filter((item) => item.objectType === "value_proposition")
        .map((item) => item.label)
        .join("\n")
    } else if (field.key === "creative_assets") {
      value = understanding.businessObjects
        .filter((item) => item.objectType === "creative_asset_pattern")
        .map((item) => item.label)
        .join("\n")
    } else if (field.key === "metric_signals") {
      value = understanding.businessObjects
        .filter((item) => item.objectType === "metric_signal")
        .map((item) => item.label)
        .join("\n")
    } else if (field.key === "action_playbook") {
      value = understanding.businessObjects
        .filter((item) => item.objectType === "optimization_action")
        .map((item) => item.label)
        .join("\n")
    } else if (field.key === "decision_rules") {
      value = understanding.decisionPoints
        .map((item, index) => formatDecisionPoint(item, index))
        .join("\n")
    } else if (field.key === "experiment_evidence") {
      value = takeUnique([
        ...understanding.evidenceHighlights,
        ...understanding.businessRules.filter((item) => /(实验|测试|AB|A\/B|验证|复盘)/i.test(item)),
      ], 10).join("\n")
    } else if (field.key === "metrics") {
      value = understanding.evidenceHighlights
        .filter((item) => /(gmv|roi|ctr|cvr|点击|曝光|转化|客单|退款|成交|利润|留存)/i.test(item))
        .join("\n")
    } else if (field.key === "business_goal" || field.key === "goal" || field.key === "objective" || field.key === "summary") {
      value = understanding.summary
    } else if (field.key === "validation_methods") {
      value = understanding.businessRules
        .filter((item) => /(验证|复盘|观察|对比|测试|AB|A\/B|看数据|指标)/i.test(item))
        .join("\n")
    } else if (field.key === "judgment_criteria") {
      value = understanding.keyJudgements
        .filter((item) => /(标准|阈值|判断|优先|达标|异常|条件)/.test(item))
        .join("\n")
    } else {
      value = matchingBlocks
        .slice(0, 3)
        .map((block) => block.textContent)
        .join("\n\n")
    }
    if (!value && blocksText.length > 0 && field.required) {
      value = blocksText.slice(0, 2).join("\n\n")
    }
    fields.push({
      key: field.key,
      label: field.label,
      value,
      evidenceBlockRefs: matchingBlocks.slice(0, 4).map((block) => block.blockId),
      status: value.trim() ? "seeded" : "inferred",
      lastUpdatedAt: new Date().toISOString(),
      updatedFromCardId: null,
      acceptedPatchIds: [],
    })
  }

  if (fields.length === 0) {
    fields.push(
      {
        key: "mainline_steps",
        label: "主链路步骤",
        value: understanding.mainlineSteps.join("\n"),
        evidenceBlockRefs: ir.blocks.slice(0, 4).map((block) => block.blockId),
        status: understanding.mainlineSteps.length > 0 ? "seeded" : "inferred",
        lastUpdatedAt: new Date().toISOString(),
        updatedFromCardId: null,
        acceptedPatchIds: [],
      },
      {
        key: "key_judgements",
        label: "关键判断",
        value: understanding.keyJudgements.join("\n"),
        evidenceBlockRefs: ir.blocks.slice(0, 4).map((block) => block.blockId),
        status: understanding.keyJudgements.length > 0 ? "seeded" : "inferred",
        lastUpdatedAt: new Date().toISOString(),
        updatedFromCardId: null,
        acceptedPatchIds: [],
      },
    )
  }

  return fields
}

function buildFallbackUnderstanding(
  sourceName: string,
  sourceContent: string,
  analysis: string,
  prepared: PreparedDocumentArtifact | null | undefined,
  scenePack?: ScenePack,
): DocumentUnderstanding {
  const lines = compactLines([analysis, prepared?.analysisMarkdown, sourceContent].filter(Boolean).join("\n"))
  const normalized = prepared?.normalizedBundle
  const mainlineSteps = normalized?.sopSteps.length ? normalized.sopSteps : inferMainlineSteps(lines)
  const businessRules = takeUnique([
    ...(normalized?.businessRules ?? []),
    ...inferBusinessRules(lines),
    ...buildRevisionHighlights(normalized),
  ], 12)
  const decisionPoints = mergeDecisionPoints(
    normalized?.decisionPoints,
    inferDecisionPoints(lines),
  )
  const entities = mergeEntityCandidates(
    normalized?.entityCandidates,
    inferEntityCandidates(lines),
  )
  const tableEvidence = buildTableEvidenceHighlights(normalized)
  const imageEvidence = buildImageEvidenceHighlights(normalized)
  const metricSignals = inferMetricSignals(lines)
  const evidenceHighlights = takeUnique([
    ...inferEvidence(lines),
    ...tableEvidence,
    ...imageEvidence,
    ...buildRevisionHighlights(normalized),
    ...metricSignals,
  ], 12)
  const keyJudgements = takeUnique([
    ...inferJudgements(lines),
    ...businessRules
      .filter((item) => /(必须|禁止|优先|标准|判断|达标|例外|不要|先|后)/.test(item))
      .slice(0, 6),
    ...decisionPoints.map((point, index) => formatDecisionPoint(point, index)),
  ], 10)
  const risks = takeUnique([
    ...inferBoundaries(lines),
    ...businessRules.filter((item) => /(风险|边界|不适用|误区|例外|禁止)/.test(item)),
  ], 8)
  const terminology = takeUnique([
    ...collectByPattern(lines, /(类目|人群|需求|价格带|CTR|ROI|产品|品牌|转化|测图|卖点|素材|标题|详情|客单|活动)/i, 12),
    ...entities.slice(0, 6).map((item) => item.name),
  ], 12)
  const openQuestions = takeUnique([
    ...inferOpenQuestions(lines),
    ...(normalized?.missingFieldKeys ?? []).map((key) => `字段待确认：${key}`),
  ], 8)
  const heroProjection = isHeroImageScene(scenePack ?? ({ manifest: { scene_id: "" } } as ScenePack))
    ? buildHeroImageBusinessProjection(lines, normalized, entities)
    : { businessObjects: [], businessRelations: [] }
  const summary = buildBusinessSummary(
    inferSummary(lines),
    mainlineSteps,
    keyJudgements,
    metricSignals,
    businessRules,
  )
  return {
    title: sourceName.replace(/\.[^.]+$/, ""),
    summary,
    mainlineSteps,
    sopSteps: mainlineSteps,
    keyJudgements,
    businessRules,
    decisionPoints,
    entityCandidates: entities,
    businessObjects: heroProjection.businessObjects,
    businessRelations: heroProjection.businessRelations,
    evidenceHighlights,
    imageEvidenceHighlights: takeUnique([
      ...imageEvidence,
      ...(normalized?.images ?? []).slice(0, 8).map((image) => image.title ?? image.caption ?? image.assetPath),
    ], 8),
    mindmapSummary: normalized?.mindmapSummary ?? [],
    terminology,
    risks,
    openQuestions,
    missingFieldKeys: normalized?.missingFieldKeys ?? [],
  }
}

function buildAssessments(
  fields: GroundTruthFieldValue[],
  scenePack: ScenePack,
): FieldAssessment[] {
  const requiredLookup = new Map(readSceneFields(scenePack).map((field) => [field.key, field.required]))
  return fields.map((field) => {
    const status = mapFieldAssessmentStatus(field.value, requiredLookup.get(field.key) ?? false)
    return {
      fieldKey: field.key,
      label: field.label,
      status,
      score: scoreForStatus(status),
      rationale:
        status === "covered"
          ? "当前字段已有较完整内容，可继续微调。"
          : status === "weak"
            ? "当前字段内容偏弱，建议补充更明确的步骤、判断或证据。"
            : status === "missing"
              ? "当前字段基本缺失，建议优先补齐。"
              : "当前字段需要专家进一步确认与澄清。",
      evidenceBlockRefs: field.evidenceBlockRefs,
      recommendedAction: actionForStatus(status),
      issueScope: "source_document",
      rootCause: rootCauseForField(field.key, status),
      blocking: false,
    }
  })
}

function severityRank(severity: IssueSeverity): number {
  if (severity === "P1") return 3
  if (severity === "P2") return 2
  return 1
}

function confidenceFromStatus(status: FieldCoverageStatus): number {
  switch (status) {
    case "covered":
      return 0.88
    case "needs_confirmation":
      return 0.7
    case "inferred":
      return 0.62
    case "weak":
      return 0.82
    case "missing":
      return 0.9
  }
}

function severityForField(fieldKey: string, status: FieldCoverageStatus): IssueSeverity {
  const criticalFields = new Set(["judgment_criteria", "validation_methods", "execution_steps", "process_flow_or_business_model"])
  if (status === "missing" && criticalFields.has(fieldKey)) return "P1"
  if (status === "weak" && (fieldKey === "judgment_criteria" || fieldKey === "validation_methods")) return "P1"
  if (status === "missing" || status === "weak") return "P2"
  return "P3"
}

function issueTypeForField(fieldKey: string, status: FieldCoverageStatus): BlockIssueType {
  if (fieldKey === "judgment_criteria") return status === "missing" ? "missing_criteria" : "weak_field"
  if (fieldKey === "validation_methods") return status === "missing" ? "missing_validation" : "weak_field"
  if (fieldKey === "exceptions_and_non_applicable_scope" || fieldKey === "boundaries") return "missing_boundary"
  if (status === "missing") return "missing_required_field"
  return "weak_field"
}

function rootCauseForIssueType(issueType: BlockIssueType): RootCause {
  switch (issueType) {
    case "missing_criteria":
      return "source_weak_judgement_criteria"
    case "missing_validation":
      return "source_missing_validation_method"
    case "missing_boundary":
      return "source_missing_boundary_condition"
    case "structure_mismatch":
      return "source_execution_too_coarse"
    case "source_grounding_gap":
      return "source_weak_traceability"
    case "missing_required_field":
      return "source_missing_required_field"
    case "weak_field":
    default:
      return "source_missing_required_field"
  }
}

function blockingForField(fieldKey: string, status: FieldCoverageStatus): boolean {
  if (status === "covered" || status === "inferred" || status === "needs_confirmation") return false
  if (fieldKey === "judgment_criteria" && (status === "missing" || status === "weak")) return true
  if (fieldKey === "validation_methods" && (status === "missing" || status === "weak")) return true
  return status === "missing"
}

function impactsDimensionsForField(fieldKey: string): string[] {
  if (fieldKey === "judgment_criteria") return ["schema_coverage", "judgement_quality", "actionability"]
  if (fieldKey === "validation_methods") return ["schema_coverage", "validation_quality", "traceability"]
  if (fieldKey === "exceptions_and_non_applicable_scope" || fieldKey === "boundaries") {
    return ["schema_coverage", "boundary_quality"]
  }
  if (fieldKey === "execution_steps" || fieldKey === "process_flow_or_business_model") {
    return ["schema_coverage", "actionability"]
  }
  if (fieldKey === "evidence" || fieldKey === "source_refs" || fieldKey === "traceability") {
    return ["traceability", "validation_quality"]
  }
  return ["schema_coverage"]
}

function fallbackFollowup(fieldKey: string): string | null {
  if (fieldKey === "judgment_criteria") return "这些指标分别怎样才算差、合格、优秀？"
  if (fieldKey === "validation_methods") return "你会用什么数据或结果来证明这些动作真的有效？"
  if (fieldKey === "termination_conditions") return "什么情况下停止优化、转入维持或换策略？"
  if (fieldKey === "exceptions_and_non_applicable_scope" || fieldKey === "boundaries") return "这种判断在哪些情况下不成立，或需要特殊处理？"
  if (fieldKey === "execution_steps") return "这一步是否还应该拆成更细的动作和判断节点？"
  return "这里如果要让一线同事直接执行，还缺哪句关键判断或动作说明？"
}

function chooseAnchorBlockId(ir: DocumentIR, fieldKey: string, evidenceRefs: string[]): string | null {
  if (evidenceRefs[0]) return evidenceRefs[0]
  const priorityPatterns: Array<{ fieldKey: string; pattern: RegExp }> = [
    { fieldKey: "judgment_criteria", pattern: /(标准|阈值|等级|判断)/ },
    { fieldKey: "validation_methods", pattern: /(验证|复盘|效果|证明)/ },
    { fieldKey: "execution_steps", pattern: /(步骤|流程|阶段|第一步|第二步)/ },
    { fieldKey: "process_flow_or_business_model", pattern: /(模型|框架|方法论|公式)/ },
    { fieldKey: "exceptions_and_non_applicable_scope", pattern: /(边界|例外|风险|不适用)/ },
  ]
  const mapping = priorityPatterns.find((item) => item.fieldKey === fieldKey)
  if (mapping) {
    const matched = ir.blocks.find((block) => mapping.pattern.test(block.textContent))
    if (matched) return matched.blockId
  }
  return ir.blocks.find((block) => block.blockType === "heading")?.blockId ?? ir.blocks[0]?.blockId ?? null
}

function lookupExcerpt(ir: DocumentIR, blockId: string | null): string {
  if (!blockId) return "当前原文中没有直接对应的段落，需要在合适位置补充这一部分。"
  const block = ir.blocks.find((item) => item.blockId === blockId)
  if (!block) return "当前原文中没有直接对应的段落，需要在合适位置补充这一部分。"
  return block.textContent.slice(0, 280)
}

function buildSuggestedRevision(field: GroundTruthFieldValue, assessment: FieldAssessment, understanding: DocumentUnderstanding): string {
  if (assessment.fieldKey === "judgment_criteria") {
    return [
      "建议补成“指标 + 标准 + 判断结论”的写法，例如：",
      "- 点击率：低于类目均值时，优先判断主图利益点和人群标签是否错位。",
      "- 转化率：连续 7 天低于目标值时，优先排查详情承接、价格带和评价信任。",
    ].join("\n")
  }
  if (assessment.fieldKey === "validation_methods") {
    return [
      "建议补成“动作后看什么”的验证句式，例如：",
      "- 主图优化后，观察 3-7 天点击率变化，并对比同周期转化率是否同步改善。",
      "- 价格带调整后，观察客单价、支付转化率和退款率是否同时满足目标。",
    ].join("\n")
  }
  if (assessment.fieldKey === "execution_steps") {
    const steps = understanding.mainlineSteps.slice(0, 4)
    if (steps.length > 0) {
      return steps.map((step, index) => `${index + 1}. ${step}`).join("\n")
    }
  }
  if (field.value.trim()) return field.value.trim()
  return `建议围绕「${assessment.label}」补充一段更可执行的专家表达，明确判断逻辑、动作和验证方式。`
}

function makeEmptyGroundTruthField(key: string, label: string): GroundTruthFieldValue {
  return {
    key,
    label,
    value: "",
    evidenceBlockRefs: [],
    status: "inferred",
    lastUpdatedAt: new Date().toISOString(),
    updatedFromCardId: null,
    acceptedPatchIds: [],
  }
}

function buildBlockAssessments(
  ir: DocumentIR,
  fields: GroundTruthFieldValue[],
  assessments: FieldAssessment[],
): BlockAssessment[] {
  const byField = new Map(fields.map((field) => [field.key, field]))
  const items: BlockAssessment[] = []
  for (const assessment of assessments) {
    if (assessment.status === "covered") continue
    const field = byField.get(assessment.fieldKey)
    const severity = severityForField(assessment.fieldKey, assessment.status)
    const issueType = issueTypeForField(assessment.fieldKey, assessment.status)
    const rootCause = rootCauseForIssueType(issueType)
    const blocking = assessment.blocking
    const blockIds = assessment.evidenceBlockRefs.length > 0
      ? assessment.evidenceBlockRefs
      : [chooseAnchorBlockId(ir, assessment.fieldKey, field?.evidenceBlockRefs ?? [])].filter(Boolean) as string[]
    if (blockIds.length === 0) {
      items.push({
        issueId: `issue-${assessment.fieldKey}-missing-anchor`,
        blockId: "missing-anchor",
        issueType,
        severity,
        confidence: confidenceFromStatus(assessment.status),
        linkedFieldKeys: [assessment.fieldKey],
        whyProblematic: assessment.rationale,
        sourceRefs: [ir.sourcePath],
        issueScope: "source_document",
        rootCause,
        blocking,
      })
      continue
    }
    for (const blockId of blockIds) {
      const block = ir.blocks.find((item) => item.blockId === blockId)
      items.push({
        issueId: `issue-${assessment.fieldKey}-${blockId}`,
        blockId,
        issueType,
        severity,
        confidence: confidenceFromStatus(assessment.status),
        linkedFieldKeys: [assessment.fieldKey],
        whyProblematic: assessment.rationale,
        sourceRefs: block?.sourceRefs ?? [ir.sourcePath],
        issueScope: "source_document",
        rootCause,
        blocking,
      })
    }
  }
  return items.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
}

function buildRevisionIssueCards(
  ir: DocumentIR,
  understanding: DocumentUnderstanding,
  fields: GroundTruthFieldValue[],
  assessments: FieldAssessment[],
  blockAssessments: BlockAssessment[],
): RevisionIssueCard[] {
  const fieldMap = new Map(fields.map((field) => [field.key, field]))
  const cards: RevisionIssueCard[] = assessments
    .filter((assessment) => assessment.status !== "covered")
    .map((assessment, index) => {
      const field = fieldMap.get(assessment.fieldKey)
      const severity = severityForField(assessment.fieldKey, assessment.status)
      const issueType = issueTypeForField(assessment.fieldKey, assessment.status)
      const rootCause = rootCauseForIssueType(issueType)
      const primaryBlockId = assessment.evidenceBlockRefs[0] ?? chooseAnchorBlockId(ir, assessment.fieldKey, field?.evidenceBlockRefs ?? [])
      const anchorBlockId = chooseAnchorBlockId(ir, assessment.fieldKey, assessment.evidenceBlockRefs)
      return {
        issueId: `issue-card-${assessment.fieldKey}-${index + 1}`,
        cardId: `card-${index + 1}-${assessment.fieldKey}`,
        primaryBlockId: assessment.evidenceBlockRefs[0] ?? null,
        anchorBlockId,
        targetFieldKey: assessment.fieldKey,
        issueTitle:
          severity === "P1"
            ? `优先补齐「${assessment.label}」`
            : `优化「${assessment.label}」的表达与闭环`,
        issueType,
        severity,
        confidence: confidenceFromStatus(assessment.status),
        originalExcerpt: lookupExcerpt(ir, primaryBlockId ?? anchorBlockId),
        diagnosis: assessment.rationale,
        suggestedRevision: buildSuggestedRevision(
          field ?? makeEmptyGroundTruthField(assessment.fieldKey, assessment.label),
          assessment,
          understanding,
        ),
        followupQuestion: fallbackFollowup(assessment.fieldKey),
        patchMode: primaryBlockId ? "replace" : "insert_after",
        linkedFieldKeys: [assessment.fieldKey],
        sourceRefs: primaryBlockId
          ? (ir.blocks.find((block) => block.blockId === primaryBlockId)?.sourceRefs ?? [ir.sourcePath])
          : [ir.sourcePath],
        status: "open",
        issueScope: "source_document",
        rootCause,
        blocking: assessment.blocking,
        impactsDimensions: impactsDimensionsForField(assessment.fieldKey),
      }
    })

  const groundedGaps = blockAssessments.filter((item) => item.issueType === "source_grounding_gap")
  for (const gap of groundedGaps) {
    const existing = cards.find((card) => card.primaryBlockId === gap.blockId && card.issueType === gap.issueType)
    if (!existing) {
      cards.push({
        issueId: `issue-card-grounding-${gap.blockId}`,
        cardId: `card-grounding-${gap.blockId}`,
        primaryBlockId: gap.blockId,
        anchorBlockId: gap.blockId,
        targetFieldKey: gap.linkedFieldKeys[0] ?? null,
        issueTitle: "补强这一段的来源与判断依据",
        issueType: gap.issueType,
        severity: gap.severity,
        confidence: gap.confidence,
        originalExcerpt: lookupExcerpt(ir, gap.blockId),
        diagnosis: gap.whyProblematic,
        suggestedRevision: "建议在这一段补充更明确的数据口径、案例来源或判断条件，避免结论悬空。",
        followupQuestion: "这段判断具体是基于什么数据、案例或对标结论得出的？",
        patchMode: "replace",
        linkedFieldKeys: gap.linkedFieldKeys,
        sourceRefs: gap.sourceRefs,
        status: "open",
        issueScope: "source_document",
        rootCause: gap.rootCause,
        blocking: gap.blocking,
        impactsDimensions: ["traceability", "validation_quality"],
      })
    }
  }

  return cards
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.confidence - a.confidence)
    .slice(0, 16)
}

function buildReviewSummary(cards: RevisionIssueCard[]): ReviewSummary {
  const high = cards.filter((card) => card.severity === "P1").length
  const medium = cards.filter((card) => card.severity === "P2").length
  const low = cards.filter((card) => card.severity === "P3").length
  const themes = takeUnique(cards.map((card) => card.issueTitle), 4)
  return {
    highPriorityCount: high,
    mediumPriorityCount: medium,
    lowPriorityCount: low,
    criticalThemes: themes,
    nextBestAction:
      cards[0]?.followupQuestion
      ?? cards[0]?.issueTitle
      ?? "先补齐最关键的判断标准和验证方式，再进入逐段修订。",
  }
}

function buildTasks(
  assessments: FieldAssessment[],
  understanding: DocumentUnderstanding,
  cards?: RevisionIssueCard[],
): ImprovementTask[] {
  if (cards && cards.length > 0) {
    return cards.map((card, index) => ({
      taskId: `task-card-${index + 1}-${card.cardId}`,
      title: card.issueTitle,
      targetBlockIds: [card.primaryBlockId, card.anchorBlockId].filter(Boolean) as string[],
      targetField: card.targetFieldKey ?? "open_question",
      actionType: card.patchMode === "confirm_only" ? "confirm" : "rewrite",
      priority: card.severity === "P1" ? "high" : card.severity === "P2" ? "medium" : "low",
      rationale: card.diagnosis,
      promptSeed: card.followupQuestion ?? `请围绕这张修订卡补齐更准确的专家表达：${card.issueTitle}`,
      status: index === 0 ? "selected" : "open",
    }))
  }
  const baseTasks: ImprovementTask[] = assessments
    .sort((a, b) => b.score - a.score)
    .map((assessment, index): ImprovementTask => {
      const promptSeed =
        assessment.fieldKey === "mainline_steps"
          ? "请补齐这份业务文档的主链路步骤，并说明每一步的目的。"
          : assessment.fieldKey === "key_judgements"
            ? "请补齐关键判断标准，并说明为什么这样判断。"
            : assessment.fieldKey === "evidence"
              ? "请补充支持这些结论的数据、案例或证据。"
              : `请围绕“${assessment.label}”补充更清晰、更可执行的内容。`
      return {
        taskId: `task-${index + 1}-${assessment.fieldKey}`,
        title:
          assessment.status === "covered"
            ? `确认「${assessment.label}」是否还能更精炼`
            : `完善「${assessment.label}」`,
        targetBlockIds: assessment.evidenceBlockRefs,
        targetField: assessment.fieldKey,
        actionType: assessment.recommendedAction,
        priority: priorityForStatus(assessment.status),
        rationale: assessment.rationale,
        promptSeed,
        status: index === 0 ? "selected" : "open",
      }
    })
  return baseTasks.concat(
    understanding.openQuestions.slice(0, 2).map((question, index): ImprovementTask => ({
        taskId: `task-question-${index + 1}`,
        title: `澄清未决问题 ${index + 1}`,
        targetBlockIds: [],
        targetField: "open_question",
        actionType: "clarify",
        priority: "medium",
        rationale: question,
        promptSeed: `请围绕这个未决问题给出更明确的补充：${question}`,
        status: "open",
      })),
  )
}

function computeQualityScore(assessments: FieldAssessment[], understanding: DocumentUnderstanding): number {
  const base = assessments.length > 0
    ? assessments.reduce((sum, item) => sum + item.score, 0) / assessments.length
    : 0.4
  const evidenceBoost = understanding.evidenceHighlights.length > 0 ? 0.08 : 0
  const mainlineBoost = understanding.mainlineSteps.length >= 3 ? 0.08 : 0
  return Math.round(Math.min(1, base + evidenceBoost + mainlineBoost) * 100)
}

function computeSourceHealth(
  reportLike: {
    fieldAssessments: FieldAssessment[]
    revisionIssueCards: RevisionIssueCard[]
    understanding: DocumentUnderstanding
  },
): HealthScorecard {
  const scoreByField = new Map(reportLike.fieldAssessments.map((item) => [item.fieldKey, item.score]))
  const findIssues = (dimensionKey: string): string[] =>
    reportLike.revisionIssueCards
      .filter((card) => card.impactsDimensions.includes(dimensionKey))
      .map((card) => card.issueId)

  const dimensionDefs: Array<{
    key: string
    label: string
    weight: number
    blockingBelow?: number
    compute: () => number
    rationale: string
  }> = [
    {
      key: "schema_coverage",
      label: "Schema 覆盖",
      weight: 0.25,
      blockingBelow: 50,
      compute: () => {
        const items = reportLike.fieldAssessments
        if (items.length === 0) return 40
        return items.reduce((sum, item) => sum + item.score * 100, 0) / items.length
      },
      rationale: "看必填字段和核心结构是否被原文覆盖。",
    },
    {
      key: "actionability",
      label: "可执行性",
      weight: 0.2,
      blockingBelow: 55,
      compute: () => {
        const execution = scoreByField.get("execution_steps") ?? scoreByField.get("mainline_steps") ?? 0.4
        const flow = scoreByField.get("process_flow_or_business_model") ?? 0.5
        return ((execution * 0.7) + (flow * 0.3)) * 100
      },
      rationale: "看步骤是否足够清晰，能否直接指导业务动作。",
    },
    {
      key: "judgement_quality",
      label: "判断标准",
      weight: 0.2,
      blockingBelow: 60,
      compute: () => (scoreByField.get("judgment_criteria") ?? 0.35) * 100,
      rationale: "看是否写清楚了何时判断为好、差、异常或优先。",
    },
    {
      key: "validation_quality",
      label: "验证闭环",
      weight: 0.15,
      blockingBelow: 55,
      compute: () => (scoreByField.get("validation_methods") ?? 0.35) * 100,
      rationale: "看动作之后是否有验证方法、数据口径和复盘方式。",
    },
    {
      key: "boundary_quality",
      label: "边界条件",
      weight: 0.1,
      blockingBelow: 45,
      compute: () => {
        const boundary = scoreByField.get("exceptions_and_non_applicable_scope")
          ?? scoreByField.get("boundaries")
          ?? (reportLike.understanding.risks.length > 0 ? 0.65 : 0.3)
        return boundary * 100
      },
      rationale: "看文档是否说明适用范围、例外情况和风险边界。",
    },
    {
      key: "traceability",
      label: "可追溯性",
      weight: 0.1,
      blockingBelow: 50,
      compute: () => {
        const evidence = scoreByField.get("evidence") ?? 0.45
        const refs = scoreByField.get("traceability") ?? scoreByField.get("source_refs") ?? evidence
        return ((evidence * 0.6) + (refs * 0.4)) * 100
      },
      rationale: "看关键结论是否能回到原文段落、数据或案例来源。",
    },
  ]

  const dimensions: HealthDimensionScore[] = dimensionDefs.map((definition) => {
    const score = clampScore(definition.compute())
    return {
      key: definition.key,
      label: definition.label,
      score,
      weight: definition.weight,
      status: deriveHealthStatus(
        score,
        definition.blockingBelow ? definition.blockingBelow + 20 : 80,
        definition.blockingBelow ?? 60,
      ),
      blockingBelow: definition.blockingBelow,
      rationale: definition.rationale,
      linkedIssueIds: findIssues(definition.key),
    }
  })

  const total = clampScore(
    dimensions.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0),
  )
  return {
    score: total,
    status: deriveHealthStatus(total, 80, 60),
    summary: qualitySummary(total),
    dimensions,
    updatedAt: new Date().toISOString(),
  }
}

function buildRevisionPublishGate(
  sourceHealth: HealthScorecard,
  cards: RevisionIssueCard[],
): PublishGateDecision {
  const hasIssue = (rootCause: RootCause) =>
    cards.filter((card) => card.rootCause === rootCause && card.severity === "P1")
  const traceability = sourceHealth.dimensions.find((item) => item.key === "traceability")?.score ?? 0
  const rules: PublishGateRuleResult[] = [
    {
      ruleKey: "required_fields",
      label: "必填字段缺失",
      status: hasIssue("source_missing_required_field").length > 0 ? "fail" : "pass",
      blocking: hasIssue("source_missing_required_field").length > 0,
      message: hasIssue("source_missing_required_field").length > 0 ? "存在阻塞发布的必填字段缺失。" : "未发现阻塞发布的必填字段缺失。",
      linkedIssueIds: hasIssue("source_missing_required_field").map((card) => card.issueId),
    },
    {
      ruleKey: "judgement_or_validation",
      label: "关键判断或验证方式不足",
      status:
        hasIssue("source_weak_judgement_criteria").length > 0 || hasIssue("source_missing_validation_method").length > 0
          ? "fail"
          : "pass",
      blocking:
        hasIssue("source_weak_judgement_criteria").length > 0 || hasIssue("source_missing_validation_method").length > 0,
      message:
        hasIssue("source_weak_judgement_criteria").length > 0 || hasIssue("source_missing_validation_method").length > 0
          ? "关键判断标准或验证方式仍明显偏弱。"
          : "关键判断标准与验证方式没有阻塞项。",
      linkedIssueIds: [
        ...hasIssue("source_weak_judgement_criteria").map((card) => card.issueId),
        ...hasIssue("source_missing_validation_method").map((card) => card.issueId),
      ],
    },
    {
      ruleKey: "traceability_floor",
      label: "可追溯性底线",
      status: traceability < 50 ? "fail" : "pass",
      blocking: traceability < 50,
      message: traceability < 50 ? "关键结论缺少足够的来源和证据锚点。" : "关键结论具备基本可追溯性。",
      linkedIssueIds: cards
        .filter((card) => card.impactsDimensions.includes("traceability"))
        .map((card) => card.issueId),
    },
    {
      ruleKey: "overall_score",
      label: "原文总质量分",
      status: sourceHealth.score < 70 ? "warn" : "pass",
      blocking: false,
      message: sourceHealth.score < 70 ? "当前原文整体质量仍偏低，建议继续修订后再发布。" : "当前原文总质量分达到建议发布区间。",
      linkedIssueIds: cards
        .filter((card) => card.severity !== "P3")
        .map((card) => card.issueId),
    },
  ]
  const status = deriveGateStatus(rules)
  return {
    gateKey: "revision_publish",
    mode: "soft",
    status,
    canPublish: true,
    overrideRequired: status === "fail",
    summary:
      status === "fail"
        ? "存在高风险原文缺口，仍可发布，但需要明确记录 override 原因。"
        : status === "warn"
          ? "当前可以发布，但建议先继续补齐关键问题。"
          : "当前原文质量已达到正常发布区间。",
    rules,
    generatedAt: new Date().toISOString(),
  }
}

function qualitySummary(score: number): string {
  if (score >= 85) return "结构比较完整，已经具备较好的知识沉淀基础。"
  if (score >= 65) return "核心内容已成形，但还有关键字段需要补强。"
  if (score >= 45) return "文档已有一些有效信息，但步骤、判断或证据仍明显不足。"
  return "当前文档更像原始草稿，建议先补齐主链路、关键判断和证据。"
}

function buildGroundTruth(
  docId: string,
  scenePack: ScenePack,
  understanding: DocumentUnderstanding,
  fields: GroundTruthFieldValue[],
): GroundTruthDraft {
  const now = new Date().toISOString()
  return {
    docId,
    sceneId: scenePack.manifest.scene_id,
    title: understanding.title,
    fields,
    mainlineSteps: understanding.mainlineSteps,
    keyJudgements: understanding.keyJudgements,
    boundaries: understanding.risks,
    evidenceNotes: understanding.evidenceHighlights,
    evaluationContentPath: "",
    revisionCount: 0,
    lastAcceptedCardId: null,
    updatedAt: now,
    lastUpdatedAt: now,
  }
}

function buildCompileSidecar(
  report: Pick<AgentModeReport, "docId" | "sourcePath" | "sourceName" | "qualityScore" | "warnings">,
): WikiCompileSidecar {
  return {
    docId: report.docId,
    compileMode: "two-stage+structuring",
    sourcePath: report.sourcePath,
    sourceName: report.sourceName,
    structuredContext: "",
    generatedAt: new Date().toISOString(),
    qualityScore: report.qualityScore,
    warnings: report.warnings,
  }
}

async function refineWithLlm(
  input: RunStructuringInput,
  fallback: {
    understanding: DocumentUnderstanding
    fields: GroundTruthFieldValue[]
  },
): Promise<StructuringJson | null> {
  if (!hasUsableLlm(input.llmConfig)) return null
  const schemaFields = readSceneFields(input.scenePack)
  let output = ""
  let failed = false
  await streamChat(
    input.llmConfig,
    [
      {
        role: "system",
        content: [
          "你是一个业务文档结构化编译器。",
          "请基于原文、阶段一分析、purpose、schema 和 scene profiles，输出一个 JSON 对象。",
          "只允许输出 JSON，不要输出解释。",
          "字段包括：title, summary, mainline_steps, sop_steps, key_judgements, business_rules, decision_points, entity_candidates, evidence_highlights, image_evidence_highlights, terminology, risks, open_questions, missing_field_keys, fields。",
          "fields 是数组，每项包含 key, label, value, notes, evidence_block_refs。",
          "请优先把这份业务资料里的主链路步骤、关键判断、表格证据、图片证据、指标口径、边界条件和未解问题抽出来。",
          "不要写泛化空话，尽量给出可执行的业务表达；如果有规则、条件、动作、指标，请分别拆开。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `## purpose.md\n${input.scenePack.purposeMarkdown}`,
          `## schema.md\n${input.scenePack.schemaMarkdown}`,
          `## SchemaProfile\n${JSON.stringify(input.scenePack.schemaProfile, null, 2)}`,
          `## ExpertGuidanceProfile\n${JSON.stringify(input.scenePack.expertGuidanceProfile, null, 2)}`,
          `## EvaluationProfile\n${JSON.stringify(input.scenePack.evaluationProfile, null, 2)}`,
          `## Stage 1 analysis\n${input.analysis}`,
          `## 原始文档\n${input.sourceContent.slice(0, 16000)}`,
          `## prepared analysis markdown\n${input.preparedDocumentArtifact?.analysisMarkdown?.slice(0, 16000) ?? ""}`,
          `## normalized bundle\n${JSON.stringify(input.preparedDocumentArtifact?.normalizedBundle ?? null, null, 2)}`,
          `## fallback understanding\n${JSON.stringify(fallback.understanding, null, 2)}`,
          `## fallback fields\n${JSON.stringify(fallback.fields, null, 2)}`,
          `## schema fields\n${JSON.stringify(schemaFields, null, 2)}`,
        ].join("\n\n"),
      },
    ],
    {
      onToken: (token) => {
        output += token
      },
      onDone: () => {},
      onError: () => {
        failed = true
      },
    },
    input.signal,
    { temperature: 0.1 },
  )

  if (failed || !output.trim()) return null
  try {
    const json = extractJsonObject(output)
    if (!json) return null
    return JSON.parse(json) as StructuringJson
  } catch {
    return null
  }
}

function mergeLlmRefinement(
  fallback: {
    understanding: DocumentUnderstanding
    fields: GroundTruthFieldValue[]
  },
  refined: StructuringJson | null,
): {
  understanding: DocumentUnderstanding
  fields: GroundTruthFieldValue[]
  llmEnhanced: boolean
} {
  if (!refined) {
    return { ...fallback, llmEnhanced: false }
  }
  const understanding: DocumentUnderstanding = {
    title: refined.title?.trim() || fallback.understanding.title,
    summary: refined.summary?.trim() || fallback.understanding.summary,
    mainlineSteps: takeUnique(refined.mainline_steps ?? fallback.understanding.mainlineSteps, 10),
    sopSteps: takeUnique(refined.sop_steps ?? refined.mainline_steps ?? fallback.understanding.sopSteps, 10),
    keyJudgements: takeUnique(refined.key_judgements ?? fallback.understanding.keyJudgements, 10),
    businessRules: takeUnique(refined.business_rules ?? fallback.understanding.businessRules, 12),
    decisionPoints: Array.isArray(refined.decision_points) && refined.decision_points.length > 0
      ? refined.decision_points.map((item, index) => ({
          title: item.title?.trim() || `决策点 ${index + 1}`,
          condition: item.condition?.trim() || "",
          action: item.action?.trim() || "",
          evidenceBlockRefs: takeUnique(item.evidence_block_refs ?? [], 6),
        }))
      : fallback.understanding.decisionPoints,
    entityCandidates: Array.isArray(refined.entity_candidates) && refined.entity_candidates.length > 0
      ? refined.entity_candidates
          .map((item) => ({
            name: item.name?.trim() || "",
            entityType: item.entity_type?.trim() || "business_term",
            aliases: takeUnique(item.aliases ?? [], 6),
            evidenceBlockRefs: takeUnique(item.evidence_block_refs ?? [], 6),
            confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0.6) || 0.6)),
          }))
          .filter((item) => item.name)
      : fallback.understanding.entityCandidates,
    businessObjects: fallback.understanding.businessObjects,
    businessRelations: fallback.understanding.businessRelations,
    evidenceHighlights: takeUnique(refined.evidence_highlights ?? fallback.understanding.evidenceHighlights, 8),
    imageEvidenceHighlights: takeUnique(refined.image_evidence_highlights ?? fallback.understanding.imageEvidenceHighlights, 8),
    mindmapSummary: takeUnique(refined.mindmap_summary ?? fallback.understanding.mindmapSummary, 12),
    terminology: takeUnique(refined.terminology ?? fallback.understanding.terminology, 10),
    risks: takeUnique(refined.risks ?? fallback.understanding.risks, 8),
    openQuestions: takeUnique(refined.open_questions ?? fallback.understanding.openQuestions, 8),
    missingFieldKeys: takeUnique(refined.missing_field_keys ?? fallback.understanding.missingFieldKeys, 12),
  }
  const fieldMap = new Map(fallback.fields.map((field) => [field.key, field]))
  for (const field of refined.fields ?? []) {
    if (!field || typeof field !== "object") continue
    const current = fieldMap.get(field.key)
    const normalizedEvidenceRefs = Array.isArray(field.evidence_block_refs)
      ? field.evidence_block_refs
          .map((item) => coerceTrimmedString(item))
          .filter(Boolean)
      : current?.evidenceBlockRefs ?? []
    fieldMap.set(field.key, {
      key: field.key,
      label: field.label || current?.label || field.key,
      value: field.value?.trim() || current?.value || "",
      notes: field.notes || current?.notes,
      evidenceBlockRefs: normalizedEvidenceRefs,
      status: current?.status ?? ((field.value?.trim() || current?.value?.trim()) ? "seeded" : "inferred"),
      lastUpdatedAt: current?.lastUpdatedAt ?? new Date().toISOString(),
      updatedFromCardId: current?.updatedFromCardId ?? null,
      acceptedPatchIds: current?.acceptedPatchIds ?? [],
    })
  }
  return {
    understanding,
    fields: Array.from(fieldMap.values()),
    llmEnhanced: true,
  }
}

function toPreparedPdfArtifact(result: Awaited<ReturnType<typeof enhancePdfDocument>>): PreparedDocumentArtifact {
  return {
    sourceKind: "pdf",
    backendStatus: result.backendStatus,
    artifactManifest: result.artifactManifest,
    analysisMarkdown: result.enhancedMarkdown,
    enhancedMarkdown: result.enhancedMarkdown,
    documentIr: result.documentIr,
    normalizedBundle: null,
    convertedSourcePath: null,
  }
}

function compactIngestTextForStructuring(text: string, maxChars = 120_000): string {
  if (text.length <= maxChars) return text
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const keep: string[] = []
  const sheetRowCounts = new Map<string, number>()
  let currentSection = ""
  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)$/)
    if (heading) {
      currentSection = heading[1]
      keep.push(line)
      continue
    }
    const trimmed = line.trim()
    const isTableRow = trimmed.startsWith("|") && trimmed.endsWith("|")
    if (isTableRow) {
      const count = sheetRowCounts.get(currentSection) ?? 0
      if (count < 80 || /(负责人|owner|任务|行动|计划|指标|验收|状态|反馈|商品|链接|岗位|职责|KPI|权重|协同|问题|复盘)/i.test(line)) {
        keep.push(line)
      }
      sheetRowCounts.set(currentSection, count + 1)
      continue
    }
    if (trimmed.length === 0 || /(负责人|owner|任务|行动|计划|指标|验收|状态|反馈|商品|链接|岗位|职责|KPI|权重|协同|问题|复盘|目标|A1|A2)/i.test(trimmed)) {
      keep.push(line)
    }
    if (keep.join("\n").length >= maxChars) break
  }
  const compacted = keep.join("\n")
  return compacted.length > maxChars
    ? `${compacted.slice(0, maxChars)}\n\n<!-- structuring input truncated for memory safety -->`
    : `${compacted}\n\n<!-- structuring input compacted from ${text.length} chars for memory safety -->`
}

export function buildStructuredContext(report: AgentModeReport, scenePack: ScenePack): string {
  const fieldSummary = report.fieldAssessments
    .map((assessment) => `- ${assessment.label}: ${assessment.status}（${assessment.rationale}）`)
    .join("\n")
  const tasks = report.revisionIssueCards
    .slice(0, 5)
    .map((card) => `- [${card.severity}] ${card.issueTitle}: ${card.diagnosis}`)
    .join("\n")
  return [
    "## Step 1.5 Structuring Context",
    `Scene: ${scenePack.manifest.scene_name} (${scenePack.manifest.scene_id})`,
    `Quality Score: ${report.qualityScore}/100`,
    `Publish Gate: ${report.publishGate.status}`,
    "",
    "### Document Understanding",
    report.understanding.summary,
    "",
    "### Mainline Steps",
    report.understanding.mainlineSteps.length > 0 ? report.understanding.mainlineSteps.map((step, index) => `${index + 1}. ${step}`).join("\n") : "- 暂未稳定抽出主链路步骤",
    "",
    "### Key Judgements",
    report.understanding.keyJudgements.length > 0 ? report.understanding.keyJudgements.map((item) => `- ${item}`).join("\n") : "- 暂未稳定抽出关键判断",
    "",
    "### Business Rules",
    report.understanding.businessRules.length > 0 ? report.understanding.businessRules.map((item) => `- ${item}`).join("\n") : "- 暂未稳定抽出业务规则",
    "",
    "### Decision Points",
    report.understanding.decisionPoints.length > 0
      ? report.understanding.decisionPoints.map((item, index) => `- ${formatDecisionPoint(item, index)}`).join("\n")
      : "- 暂未稳定抽出决策点",
    "",
    "### Evidence Highlights",
    report.understanding.evidenceHighlights.length > 0 ? report.understanding.evidenceHighlights.map((item) => `- ${item}`).join("\n") : "- 暂未稳定抽出证据亮点",
    "",
    "### Field Assessments",
    fieldSummary || "- 暂无字段诊断",
    "",
    "### Improvement Priorities",
    tasks || "- 暂无优先修订任务",
  ].join("\n")
}

export async function runStep15Structuring(input: RunStructuringInput): Promise<AgentModeReport> {
  const isPdf = input.sourcePath.toLowerCase().endsWith(".pdf")
  const sourceKind = input.preparedDocumentArtifact?.sourceKind ?? detectSourceKind(input.sourcePath)
  const preparedAnalysisForTasks = compactIngestTextForStructuring(input.preparedDocumentArtifact?.analysisMarkdown ?? "", 120_000)
  const sourceContentForTasks = compactIngestTextForStructuring(input.sourceContent, 80_000)
  const analysisForTasks = compactIngestTextForStructuring(input.analysis, 60_000)
  const preferredPdfBackend = useWikiStore.getState().pdfBackendMode
  const fallbackIr = buildDocumentIR(input.projectPath, input.sourcePath, input.sourceContent)
  const enhancedDocument = input.preparedDocumentArtifact ?? (isPdf
    ? await enhancePdfDocument(
        input.projectPath,
        input.sourcePath,
        fallbackIr.docId,
        fallbackIr.sourceName,
        preferredPdfBackend,
      ).then(toPreparedPdfArtifact).catch(() => null)
    : null)
  const ir = enhancedDocument?.documentIr ?? fallbackIr
  const fallbackUnderstanding = buildFallbackUnderstanding(
    ir.sourceName,
    input.sourceContent,
    input.analysis,
    enhancedDocument,
    input.scenePack,
  )
  const fallbackFields = buildFieldValues(ir, fallbackUnderstanding, input.scenePack)
  const refined = input.skipLlmRefinement
    ? null
    : await refineWithLlm(input, {
        understanding: fallbackUnderstanding,
        fields: fallbackFields,
      })
  const merged = mergeLlmRefinement(
    { understanding: fallbackUnderstanding, fields: fallbackFields },
    refined,
  )
  const groundTruth = buildGroundTruth(ir.docId, input.scenePack, merged.understanding, merged.fields)
  groundTruth.evaluationContentPath = input.sourcePath
  const fieldAssessments = buildAssessments(groundTruth.fields, input.scenePack).map((assessment) => ({
    ...assessment,
    blocking: blockingForField(assessment.fieldKey, assessment.status),
  }))
  const blockAssessments = buildBlockAssessments(ir, groundTruth.fields, fieldAssessments)
  const revisionIssueCards = buildRevisionIssueCards(
    ir,
    merged.understanding,
    groundTruth.fields,
    fieldAssessments,
    blockAssessments,
  )
  const reviewSummary = buildReviewSummary(revisionIssueCards)
  const activeCriticalCardIds = revisionIssueCards
    .filter((card) => card.severity === "P1" || card.severity === "P2")
    .slice(0, 8)
    .map((card) => card.cardId)
  const improvementTasks = buildTasks(fieldAssessments, merged.understanding, revisionIssueCards)
  const sourceHealth = computeSourceHealth({
    fieldAssessments,
    revisionIssueCards,
    understanding: merged.understanding,
  })
  const publishGate = buildRevisionPublishGate(sourceHealth, revisionIssueCards)
  const qualityScore = sourceHealth.score || computeQualityScore(fieldAssessments, merged.understanding)
  const warnings: string[] = []
  if (!merged.llmEnhanced && hasUsableLlm(input.llmConfig)) {
    warnings.push("Step 1.5 已使用回退结构化结果，未拿到稳定的 LLM JSON 输出。")
  }
  if (enhancedDocument?.backendStatus.degraded) {
    warnings.push(`${sourceKind.toUpperCase()} 增强理解已降级：${enhancedDocument.backendStatus.detail}`)
  } else if (enhancedDocument?.backendStatus.detail) {
    warnings.push(`${sourceKind.toUpperCase()} 增强理解已启用：${enhancedDocument.backendStatus.detail}`)
  }
  const taskContextPack = isTaskGenerationScene(input.scenePack)
    ? buildTaskContextPack({
        docId: ir.docId,
        sourcePath: ir.sourcePath,
        sourceName: ir.sourceName,
        sourceKind,
        workbook: extractWorkbookIRFromMarkdown({
          docId: ir.docId,
          sourcePath: ir.sourcePath,
          sourceName: ir.sourceName,
          markdown: [preparedAnalysisForTasks, sourceContentForTasks, analysisForTasks].filter(Boolean).join("\n\n"),
        }),
        documentBlocks: extractTaskDocumentBlocks(ir),
      })
    : null
  if (taskContextPack?.qualityWarnings.length) {
    warnings.push(...taskContextPack.qualityWarnings.map((item) => `任务上下文提示：${item}`))
  }
  const compileArtifacts = buildSceneCompileArtifacts({
    docId: ir.docId,
    sourceKind,
    sourceName: ir.sourceName,
    sourcePath: ir.sourcePath,
    sourceContent: input.sourceContent,
    sceneId: input.scenePack.manifest.scene_id,
    generatedAt: new Date().toISOString(),
    analysis: input.analysis,
    documentIr: ir,
    understanding: merged.understanding,
    groundTruth,
    fieldAssessments,
    blockAssessments,
    revisionIssueCards,
    reviewSummary,
    activeCriticalCardIds,
    improvementTasks,
    qualityScore,
    qualitySummary: sourceHealth.summary,
    sourceHealth,
    publishGate,
    warnings,
    llmEnhanced: merged.llmEnhanced,
    supportingWikiPages: [],
    compileSidecar: buildCompileSidecar({
      docId: ir.docId,
      sourceName: ir.sourceName,
      sourcePath: ir.sourcePath,
      qualityScore,
      warnings,
    }),
    compilePlan: {
      docId: ir.docId,
      sceneId: input.scenePack.manifest.scene_id,
      compileMode: "scene_business_dominant",
      pagePlans: [],
      sectionMappings: {},
      fieldToPageMap: {},
      requiredFieldKeys: [],
    },
    compileCoverage: {
      docId: ir.docId,
      generatedAt: new Date().toISOString(),
      entries: [],
    },
    compileIr: {
      sourceSummary: "",
      taskContextPack,
      mainlineSteps: [],
      sopSteps: [],
      keyJudgements: [],
      businessRules: [],
      decisionPoints: [],
      boundaries: [],
      evidenceCases: [],
      imageEvidence: [],
      metrics: [],
      keyEntities: [],
      businessObjects: [],
      businessRelations: [],
      fieldValueMap: {},
      fieldLabelMap: {},
      fieldEvidenceMap: {},
      revisionSignals: [],
      terminology: [],
      mindmapSummary: [],
      openQuestions: [],
      sourceRefsByField: {},
    },
    documentBackend: enhancedDocument?.backendStatus.mode ?? (isPdf ? preferredPdfBackend : "generic"),
    documentBackendStatus: enhancedDocument?.backendStatus ?? {
      mode: isPdf ? preferredPdfBackend : "generic",
      status: isPdf ? "fallback" : "ready",
      detail: isPdf ? "PDF 增强后端未产出结构化 sidecar，当前使用通用文本链路。" : "当前文档使用通用结构化链路。",
      degraded: isPdf,
    },
    documentArtifacts: enhancedDocument?.artifactManifest ?? null,
    pdfArtifacts: sourceKind === "pdf" ? enhancedDocument?.artifactManifest ?? null : null,
    taskContextPack,
  }, input.scenePack)
  const report: AgentModeReport = {
    docId: ir.docId,
    sourceKind,
    sourceName: ir.sourceName,
    sourcePath: ir.sourcePath,
    sourceContent: input.sourceContent,
    sceneId: input.scenePack.manifest.scene_id,
    generatedAt: new Date().toISOString(),
    analysis: input.analysis,
    documentIr: ir,
    understanding: merged.understanding,
    groundTruth,
    fieldAssessments,
    blockAssessments,
    revisionIssueCards,
    reviewSummary,
    activeCriticalCardIds,
    improvementTasks,
    qualityScore,
    qualitySummary: sourceHealth.summary,
    sourceHealth,
    publishGate,
    warnings,
    llmEnhanced: merged.llmEnhanced,
    supportingWikiPages: compileArtifacts.supportingWikiPages,
    compileSidecar: buildCompileSidecar({
      docId: ir.docId,
      sourceName: ir.sourceName,
      sourcePath: ir.sourcePath,
      qualityScore,
      warnings,
    }),
    compilePlan: compileArtifacts.plan,
    compileCoverage: compileArtifacts.compileCoverage,
    compileIr: compileArtifacts.compileIr,
    documentBackend: enhancedDocument?.backendStatus.mode ?? (isPdf ? preferredPdfBackend : "generic"),
    documentBackendStatus: enhancedDocument?.backendStatus ?? {
      mode: isPdf ? preferredPdfBackend : "generic",
      status: isPdf ? "fallback" : "ready",
      detail: isPdf ? "PDF 增强后端未产出结构化 sidecar，当前使用通用文本链路。" : "当前文档使用通用结构化链路。",
      degraded: isPdf,
    },
    documentArtifacts: enhancedDocument?.artifactManifest ?? null,
    pdfArtifacts: sourceKind === "pdf" ? enhancedDocument?.artifactManifest ?? null : null,
    taskContextPack,
  }
  report.compileSidecar.compilePlan = compileArtifacts.plan
  report.compileSidecar.compileCoverage = compileArtifacts.compileCoverage
  report.compileSidecar.structuredContext = buildStructuredContext(report, input.scenePack)
  return report
}
