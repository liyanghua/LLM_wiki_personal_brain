import { createDirectory, fileExists, listDirectory, readFile, writeFile } from "@/commands/fs"
import type {
  AgentModeReport,
  StrategyActionCard,
  StrategyBundle,
  StrategyCard,
  StrategyCardStatus,
  StrategyCardType,
  StrategyCategory,
  StrategyCoverageReport,
} from "@/lib/agent-mode-types"
import type { ResearchSession } from "@/lib/research-types"
import { getFileStem, normalizePath } from "@/lib/path-utils"
import type { ScenePack } from "@/lib/agent-mode-types"
import type { LlmConfig } from "@/stores/wiki-store"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { streamChat } from "@/lib/llm-client"
import { extractJsonObject } from "@/lib/sweep-reviews"
import { formatBusinessText, strategyCardTypeLabel as displayStrategyCardTypeLabel } from "@/lib/strategy-display"
import {
  loadSemanticUnitIndex,
  semanticUnitIdsForField,
  unresolvedRelationIdsForUnits,
} from "@/lib/semantic-units"

interface StrategySourceBundle {
  docSlug: string
  wikiPages: Record<string, string>
  groundTruthFields: Record<string, string>
  fieldEvidence: Record<string, string[]>
  semanticUnitIdsByField: Record<string, string[]>
  unresolvedSemanticRelationIdsByField: Record<string, string[]>
}

interface StrategyTemplate {
  triggerCues: string[]
  requiredInputs: string[]
  outputArtifact: string
  validationMetrics: string[]
}

interface LlmActionCardPatch {
  actionCardId?: string
  triggerCondition?: string
  requiredInputs?: string[]
  actionSteps?: string[]
  outputArtifact?: string
  validationMetrics?: string[]
  missingInputs?: string[]
  confidence?: number
}

interface LlmEnhanceResult {
  cards: StrategyActionCard[]
  warnings: string[]
  enhanced: boolean
}

const HERO_TYPES: StrategyCardType[] = [
  "audience_segment_diagnosis",
  "value_prop_selection",
  "creative_asset_brief_generation",
  "metric_signal_diagnosis",
  "optimization_action_planning",
  "experiment_validation_plan",
]

const HERO_WIKI_PAGE_BY_TYPE: Record<StrategyCardType, string[]> = {
  audience_segment_diagnosis: ["人群与场景.md", "index.md"],
  value_prop_selection: ["卖点与表达.md", "指标与判断.md"],
  creative_asset_brief_generation: ["素材与版式.md", "卖点与表达.md"],
  metric_signal_diagnosis: ["指标与判断.md", "证据与案例.md"],
  optimization_action_planning: ["动作与实验.md", "指标与判断.md"],
  experiment_validation_plan: ["动作与实验.md", "证据与案例.md"],
  generic: ["index.md"],
}

const TASK_WIKI_REFS = [
  "wiki/tasks/{docSlug}.md",
  "wiki/roles/{docSlug}.md",
  "wiki/quality/{docSlug}.md",
  "wiki/collaboration/{docSlug}.md",
  "wiki/reviews/{docSlug}.md",
]

function nowIso(): string {
  return new Date().toISOString()
}

function nextId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim()
  return ""
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => asString(item)).filter(Boolean) : []
}

function uniq(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)))
}

function compactText(value: string, max = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max).trim()}...`
}

function slugForDoc(report: Pick<AgentModeReport, "sourceName">): string {
  return getFileStem(report.sourceName)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function strategyCardTypeLabel(type: StrategyCardType): string {
  return displayStrategyCardTypeLabel(type)
}

function isTaskGenerationScene(report: Pick<AgentModeReport, "sceneId">): boolean {
  return report.sceneId === "ecom_growth_task_generation"
}

function strategyFieldKeys(scenePack: ScenePack, type: StrategyCardType): string[] {
  const raw = scenePack.strategyProfile?.card_types
  if (Array.isArray(raw)) {
    const matched = raw.find((item) => {
      if (!item || typeof item !== "object") return false
      return asString((item as Record<string, unknown>).key) === type
    }) as Record<string, unknown> | undefined
    const keys = asStringArray(matched?.source_field_keys)
    if (keys.length > 0) return keys
  }
  switch (type) {
    case "audience_segment_diagnosis":
      return ["target_audiences", "audience_situations"]
    case "value_prop_selection":
      return ["selling_points", "decision_rules"]
    case "creative_asset_brief_generation":
      return ["creative_assets", "selling_points"]
    case "metric_signal_diagnosis":
      return ["metric_signals", "decision_rules"]
    case "optimization_action_planning":
      return ["action_playbook", "decision_rules"]
    case "experiment_validation_plan":
      return ["experiment_evidence", "action_playbook", "metric_signals"]
    default:
      return ["business_goal", "decision_rules"]
  }
}

function strategyTemplate(scenePack: ScenePack, type: StrategyCardType): StrategyTemplate {
  const raw = scenePack.strategyProfile?.card_types
  const matched = Array.isArray(raw)
    ? raw.find((item) => item && typeof item === "object" && asString((item as Record<string, unknown>).key) === type)
    : null
  const template = matched && typeof matched === "object"
    ? (matched as Record<string, unknown>).action_template as Record<string, unknown> | undefined
    : undefined
  return {
    triggerCues: asStringArray(template?.trigger_cues),
    requiredInputs: asStringArray(template?.required_inputs),
    outputArtifact: asString(template?.output_artifact),
    validationMetrics: asStringArray(template?.validation_metrics),
  }
}

function targetFieldKeyForCard(type: StrategyCardType): string | null {
  switch (type) {
    case "audience_segment_diagnosis":
      return "target_audiences"
    case "value_prop_selection":
      return "selling_points"
    case "creative_asset_brief_generation":
      return "creative_assets"
    case "metric_signal_diagnosis":
      return "metric_signals"
    case "optimization_action_planning":
      return "action_playbook"
    case "experiment_validation_plan":
      return "experiment_evidence"
    default:
      return null
  }
}

function decisionPointIds(report: AgentModeReport, type: StrategyCardType): string[] {
  const points = report.understanding.decisionPoints
  if (type === "metric_signal_diagnosis" || type === "optimization_action_planning" || type === "experiment_validation_plan") {
    return points.map((_, index) => `decision-point-${index + 1}`).slice(0, 4)
  }
  return []
}

function stableFingerprint(type: StrategyCardType, triggerCondition: string, outputArtifact: string, targetFieldKey: string | null): string {
  return [type, triggerCondition, outputArtifact, targetFieldKey ?? ""]
    .join("|")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function fieldValue(report: AgentModeReport, key: string): string {
  return report.groundTruth.fields.find((field) => field.key === key)?.value?.trim() ?? ""
}

function fieldEvidence(report: AgentModeReport, key: string): string[] {
  return report.compileIr.fieldEvidenceMap?.[key] ?? report.compileIr.sourceRefsByField?.[key] ?? []
}

function wikiRefsForType(report: AgentModeReport, source: StrategySourceBundle, type: StrategyCardType): string[] {
  if (isTaskGenerationScene(report)) {
    const refs = TASK_WIKI_REFS
      .map((template) => template.replace("{docSlug}", source.docSlug))
      .filter((ref) => source.wikiPages[ref]?.trim())
    return refs.length > 0 ? refs : report.supportingWikiPages
  }
  const pageNames = HERO_WIKI_PAGE_BY_TYPE[type] ?? ["index.md"]
  return pageNames
    .filter((pageName) => source.wikiPages[pageName]?.trim())
    .map((pageName) => `wiki/business/${source.docSlug}/${pageName}`)
}

function sourceTextForType(source: StrategySourceBundle, type: StrategyCardType, sourceKeys: string[]): string {
  const wikiText = Object.entries(source.wikiPages)
    .filter(([key, value]) => {
      if (!value) return false
      if (key.startsWith("wiki/")) return true
      return (HERO_WIKI_PAGE_BY_TYPE[type] ?? []).includes(key)
    })
    .map(([, value]) => value)
    .join("\n\n")
  const fieldText = sourceKeys.map((key) => source.groundTruthFields[key] ?? "").filter(Boolean).join("\n")
  return [wikiText, fieldText].filter(Boolean).join("\n\n")
}

function splitCandidateItems(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n")
  const listItems = normalized
    .split("\n")
    .map((line) => line.replace(/^#{1,6}\s*/, "").replace(/^[-*]\s*/, "").replace(/^\d+[.)、]\s*/, "").trim())
    .filter((line) => line.length >= 8)
    .filter((line) => !/^(当前状态|证据锚点|来源|source_refs|updated|page id)/i.test(line))
  if (listItems.length > 0) return uniq(listItems).slice(0, 6)
  return normalized
    .split(/[。；;]\s*/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 8)
    .slice(0, 6)
}

function triggerForType(type: StrategyCardType, template: StrategyTemplate, candidate: string): string {
  void template
  switch (type) {
    case "audience_segment_diagnosis":
      return formatBusinessText(`当目标人群或购物场景不清晰时，先核对：${compactText(candidate, 72)}`)
    case "value_prop_selection":
      return formatBusinessText(`当卖点不聚焦或证明点不足时，先判断：${compactText(candidate, 72)}`)
    case "creative_asset_brief_generation":
      return formatBusinessText(`当主图表达弱、素材不匹配或版式混乱时，先处理：${compactText(candidate, 72)}`)
    case "metric_signal_diagnosis":
      return formatBusinessText(`当指标信号异常或判断规则不清时，先定位：${compactText(candidate, 72)}`)
    case "experiment_validation_plan":
      return formatBusinessText(`当策略缺少验证闭环时，先设计验证：${compactText(candidate, 72)}`)
    case "optimization_action_planning":
      return formatBusinessText(`当需要把判断转成下一步动作时，先拆解：${compactText(candidate, 72)}`)
    default:
      return formatBusinessText(`当需要处理${strategyCardTypeLabel(type)}时，先判断：${compactText(candidate, 72)}`)
  }
}

function defaultActionTitle(type: StrategyCardType, outputArtifact: string, firstCandidate: string): string {
  const artifact = formatBusinessText(outputArtifact).replace(/^可交付设计的/, "")
  if (artifact) return `${strategyCardTypeLabel(type)}：生成${artifact}`
  return `${strategyCardTypeLabel(type)}：${compactText(formatBusinessText(firstCandidate), 28)}`
}

function actionStepsForType(type: StrategyCardType, candidate: string, sourceKeys: string[]): string[] {
  const base = compactText(candidate, 120)
  switch (type) {
    case "audience_segment_diagnosis":
      return [
        "列出当前资料中的目标人群、购物任务和使用场景。",
        `用资料中的线索校验该人群是否应优先处理：${base}`,
        "输出人群-场景-关注点矩阵，并标出缺失输入。",
      ]
    case "value_prop_selection":
      return [
        "汇总候选卖点、利益点和证明点。",
        `按人群需求与判断规则选择优先卖点：${base}`,
        "输出卖点优先级和需要补证的证明材料。",
      ]
    case "creative_asset_brief_generation":
      return [
        "把核心卖点翻译成主图画面、文案、版式和素材元素。",
        `生成一版素材说明，并标注禁忌项：${base}`,
        "明确需要设计或运营补充的图片、文案和实验变量。",
      ]
    case "metric_signal_diagnosis":
      return [
        "读取点击率、转化率、加购、投入产出比等指标信号和判断规则。",
        `判断指标异常优先归因到人群、卖点还是素材：${base}`,
        "输出异常归因表和下一步需要验证的指标口径。",
      ]
    case "optimization_action_planning":
      return [
        "把当前问题归因映射到可调整的人群、卖点、素材或实验动作。",
        `按影响面和验证成本排序动作：${base}`,
        "输出可执行动作清单、负责人输入项和验证顺序。",
      ]
    case "experiment_validation_plan":
      return [
        "把待验证假设拆成实验变量、对照组和指标口径。",
        `形成 A/B 或小流量验证计划：${base}`,
        "输出实验成功/失败后的后续动作。",
      ]
    default:
      return [
        `根据字段 ${sourceKeys.join(", ")} 提炼业务动作。`,
        `输出可执行建议：${base}`,
        "补齐验证方式和证据引用。",
      ]
  }
}

function missingInputs(requiredInputs: string[], sourceText: string): string[] {
  const lower = sourceText.toLowerCase()
  return requiredInputs.filter((item) => !lower.includes(item.toLowerCase()))
}

function clampConfidence(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(0.1, Math.min(0.99, value))
}

function normalizePatchList(raw: unknown): LlmActionCardPatch[] {
  if (!raw || typeof raw !== "object") return []
  const source = raw as Record<string, unknown>
  const cards = Array.isArray(source.actionCards)
    ? source.actionCards
    : Array.isArray(source.action_cards)
      ? source.action_cards
      : []
  return cards.filter((item): item is LlmActionCardPatch => Boolean(item && typeof item === "object"))
}

function mergeLlmPatch(card: StrategyActionCard, patch: LlmActionCardPatch): StrategyActionCard {
  const triggerCondition = formatBusinessText(asString(patch.triggerCondition) || card.triggerCondition)
  const requiredInputs = asStringArray(patch.requiredInputs).length > 0
    ? asStringArray(patch.requiredInputs).map(formatBusinessText)
    : card.requiredInputs
  const actionSteps = asStringArray(patch.actionSteps).length > 0
    ? asStringArray(patch.actionSteps).map(formatBusinessText)
    : card.actionSteps
  const outputArtifact = formatBusinessText(asString(patch.outputArtifact) || card.outputArtifact)
  const validationMetrics = asStringArray(patch.validationMetrics).length > 0
    ? asStringArray(patch.validationMetrics).map(formatBusinessText)
    : card.validationMetrics
  const missing = asStringArray(patch.missingInputs).map(formatBusinessText)
  return {
    ...card,
    triggerCondition,
    requiredInputs,
    actionSteps,
    outputArtifact,
    validationMetrics,
    title: defaultActionTitle(card.category, outputArtifact, card.title),
    missingInputs: missing.length > 0 ? missing : card.missingInputs,
    confidence: clampConfidence(patch.confidence, card.confidence),
    fingerprint: stableFingerprint(card.category, triggerCondition, outputArtifact, card.targetFieldKey ?? null),
    updatedAt: nowIso(),
  }
}

async function enhanceActionCardsWithLlm(input: {
  report: AgentModeReport
  source: StrategySourceBundle
  scenePack: ScenePack
  cards: StrategyActionCard[]
  llmConfig?: LlmConfig | null
  signal?: AbortSignal
}): Promise<LlmEnhanceResult> {
  if (!input.llmConfig || !hasUsableLlm(input.llmConfig) || input.cards.length === 0) {
    return {
      cards: input.cards,
      warnings: ["LLM 增强未启用：当前采用 schema + wiki 的规则优先动作卡编译。"],
      enhanced: false,
    }
  }
  let output = ""
  let failed = false
  await streamChat(
    input.llmConfig,
    [
      {
        role: "system",
        content: [
          "你是业务策略动作卡编译器。",
          "任务：基于 SchemaProfile/StrategyProfile、wiki/business 页面、GroundTruth 和规则候选卡，补全更可执行的动作卡。",
          "只允许返回 JSON，不要输出解释。",
          "JSON 格式：{\"actionCards\":[{\"actionCardId\":\"...\",\"triggerCondition\":\"...\",\"requiredInputs\":[\"...\"],\"actionSteps\":[\"...\"],\"outputArtifact\":\"...\",\"validationMetrics\":[\"...\"],\"missingInputs\":[\"...\"],\"confidence\":0.8}]}。",
          "不要新增 actionCardId；只能按输入 actionCardId 修改字段。",
          "不要把整段 GroundTruth 原文直接塞进 actionSteps；每个 actionSteps 必须是可执行步骤。",
          "缺少输入时写入 missingInputs，不要伪造证据。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `## Scene\n${JSON.stringify(input.scenePack.manifest, null, 2)}`,
          `## StrategyProfile\n${JSON.stringify(input.scenePack.strategyProfile ?? {}, null, 2)}`,
          `## Wiki Business Pages\n${JSON.stringify(input.source.wikiPages, null, 2)}`,
          `## GroundTruth Fields\n${JSON.stringify(input.source.groundTruthFields, null, 2)}`,
          `## Rule Candidate Action Cards\n${JSON.stringify(input.cards, null, 2)}`,
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
  if (failed || !output.trim()) {
    return {
      cards: input.cards,
      warnings: ["LLM 增强失败：已降级为 schema + wiki 的规则动作卡。"],
      enhanced: false,
    }
  }
  try {
    const parsed = JSON.parse(extractJsonObject(output))
    const patches = normalizePatchList(parsed)
    const patchById = new Map(patches.map((patch) => [asString(patch.actionCardId), patch]))
    const cards = input.cards.map((card) => {
      const patch = patchById.get(card.actionCardId)
      return patch ? mergeLlmPatch(card, patch) : card
    })
    return {
      cards,
      warnings: patches.length > 0 ? [] : ["LLM 增强未返回可用动作卡补丁：已保留规则动作卡。"],
      enhanced: patches.length > 0,
    }
  } catch {
    return {
      cards: input.cards,
      warnings: ["LLM 增强 JSON 解析失败：已保留规则动作卡。"],
      enhanced: false,
    }
  }
}

async function loadStrategySourceBundle(projectPath: string, report: AgentModeReport): Promise<StrategySourceBundle> {
  const pp = normalizePath(projectPath)
  const docSlug = slugForDoc(report)
  const pagePaths = isTaskGenerationScene(report)
    ? [
        `wiki/tasks/${docSlug}.md`,
        `wiki/roles/${docSlug}.md`,
        `wiki/quality/${docSlug}.md`,
        `wiki/collaboration/${docSlug}.md`,
        `wiki/reviews/${docSlug}.md`,
      ]
    : ["index.md", "人群与场景.md", "卖点与表达.md", "素材与版式.md", "指标与判断.md", "动作与实验.md", "证据与案例.md"]
  const wikiPages: Record<string, string> = {}
  for (const pageName of pagePaths) {
    const path = pageName.startsWith("wiki/")
      ? `${pp}/${pageName}`
      : `${pp}/wiki/business/${docSlug}/${pageName}`
    const exists = await fileExists(path).catch(() => false)
    wikiPages[pageName] = exists ? await readFile(path).catch(() => "") : ""
  }
  const groundTruthFields: Record<string, string> = {}
  const fieldEvidenceMap: Record<string, string[]> = {}
  const semanticIndex = await loadSemanticUnitIndex(pp)
  const semanticUnitIdsByField: Record<string, string[]> = {}
  const unresolvedSemanticRelationIdsByField: Record<string, string[]> = {}
  for (const field of report.groundTruth.fields) {
    groundTruthFields[field.key] = field.value ?? ""
    fieldEvidenceMap[field.key] = uniq([
      ...(field.evidenceBlockRefs ?? []),
      ...fieldEvidence(report, field.key),
    ])
    const semanticUnitIds = semanticUnitIdsForField(semanticIndex, report.docId, [field.key])
    semanticUnitIdsByField[field.key] = semanticUnitIds
    unresolvedSemanticRelationIdsByField[field.key] = unresolvedRelationIdsForUnits(semanticIndex, semanticUnitIds)
  }
  return {
    docSlug,
    wikiPages,
    groundTruthFields,
    fieldEvidence: fieldEvidenceMap,
    semanticUnitIdsByField,
    unresolvedSemanticRelationIdsByField,
  }
}

function buildActionCards(
  report: AgentModeReport,
  scenePack: ScenePack,
  source: StrategySourceBundle,
  linkedResearchFindingIds: string[],
): StrategyActionCard[] {
  const now = nowIso()
  const types = report.sceneId === "ecom_growth_hero_image" ? HERO_TYPES : (["generic"] as StrategyCardType[])
  const cards: StrategyActionCard[] = []
  for (const type of types) {
    const sourceKeys = strategyFieldKeys(scenePack, type)
    const template = strategyTemplate(scenePack, type)
    const combined = sourceTextForType(source, type, sourceKeys)
    if (!combined.trim()) continue
    const candidates = splitCandidateItems(combined)
    const firstCandidate = candidates[0] ?? combined
    const candidateGroup = candidates.slice(0, 3).join("；")
    const triggerCondition = triggerForType(type, template, firstCandidate)
    const outputArtifact = formatBusinessText(template.outputArtifact || `${strategyCardTypeLabel(type)}执行产物`)
    const targetFieldKey = targetFieldKeyForCard(type)
    const wikiRefs = wikiRefsForType(report, source, type)
    const evidenceRefs = uniq(sourceKeys.flatMap((key) => source.fieldEvidence[key] ?? []))
    const semanticUnitIds = uniq(sourceKeys.flatMap((key) => source.semanticUnitIdsByField[key] ?? []))
    const blockedBySemanticRelationIds = uniq(sourceKeys.flatMap((key) => source.unresolvedSemanticRelationIdsByField[key] ?? []))
    const requiredInputs = template.requiredInputs.length > 0
      ? template.requiredInputs.map(formatBusinessText)
      : sourceKeys.map((key) => formatBusinessText(key.replace(/_/g, " ")))
    const actionSteps = actionStepsForType(type, candidateGroup || firstCandidate, sourceKeys).map(formatBusinessText)
    const validationMetrics = template.validationMetrics.length > 0
      ? template.validationMetrics.map(formatBusinessText)
      : uniq([fieldValue(report, "metric_signals"), fieldValue(report, "experiment_evidence")].map(formatBusinessText)).slice(0, 3)
    const missing = missingInputs(requiredInputs, combined).map(formatBusinessText)
    const fingerprint = stableFingerprint(type, triggerCondition, outputArtifact, targetFieldKey)
    cards.push({
      actionCardId: nextId("strategy-action"),
      fingerprint,
      sceneId: report.sceneId,
      docId: report.docId,
      category: type,
      title: defaultActionTitle(type, outputArtifact, firstCandidate),
      triggerCondition,
      requiredInputs,
      actionSteps,
      outputArtifact,
      validationMetrics,
      evidenceRefs,
      semanticUnitIds,
      blockedBySemanticRelationIds,
      wikiRefs,
      missingInputs: missing,
      confidence: Math.max(0.35, Math.min(0.95, 0.45 + evidenceRefs.length * 0.08 + wikiRefs.length * 0.08 - missing.length * 0.05)),
      skillFamily: type,
      targetFieldKey,
      sourceFieldKeys: sourceKeys,
      sourceFindingIds: linkedResearchFindingIds,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    })
  }
  return cards
}

function mergeActionStatuses(nextCards: StrategyActionCard[], previous: StrategyBundle | null): StrategyActionCard[] {
  const previousActionByFingerprint = new Map((previous?.actionCards ?? []).map((card) => [card.fingerprint, card]))
  const previousSummaryByType = new Map((previous?.strategyCards ?? []).map((card) => [card.cardType, card]))
  return nextCards.map((card) => {
    const matched = previousActionByFingerprint.get(card.fingerprint)
    if (matched) {
      const safeStatus = card.blockedBySemanticRelationIds && card.blockedBySemanticRelationIds.length > 0
        ? "draft"
        : matched.status
      return {
        ...card,
        actionCardId: matched.actionCardId,
        status: safeStatus,
        createdAt: matched.createdAt,
        updatedAt: nowIso(),
      }
    }
    const legacy = previousSummaryByType.get(card.category)
    if ((legacy?.status === "confirmed" || legacy?.status === "promoted_to_skill") && (!card.blockedBySemanticRelationIds || card.blockedBySemanticRelationIds.length === 0)) {
      return {
        ...card,
        status: legacy.status as StrategyCardStatus,
      }
    }
    return card
  })
}

function buildCategories(scenePack: ScenePack, actionCards: StrategyActionCard[]): StrategyCategory[] {
  const types = actionCards.length > 0 ? uniq(actionCards.map((card) => card.category)) as StrategyCardType[] : HERO_TYPES
  return types.map((type) => {
    const cards = actionCards.filter((card) => card.category === type)
    const sourceFieldKeys = strategyFieldKeys(scenePack, type)
    return {
      categoryId: type,
      label: strategyCardTypeLabel(type),
      sourceFieldKeys,
      actionCardIds: cards.map((card) => card.actionCardId),
      summary: cards.length > 0
        ? `已形成 ${cards.length} 张可执行动作卡。`
        : "当前还没有形成稳定动作卡。",
    }
  })
}

function buildSummaryCards(
  report: AgentModeReport,
  actionCards: StrategyActionCard[],
  linkedResearchFindingIds: string[],
): StrategyCard[] {
  const now = nowIso()
  const byType = new Map<StrategyCardType, StrategyActionCard[]>()
  for (const card of actionCards) {
    byType.set(card.category, [...(byType.get(card.category) ?? []), card])
  }
  return Array.from(byType.entries()).map(([type, cards]) => {
    const primary = cards[0]
    return {
      cardId: `summary-${type}`,
      sceneId: report.sceneId,
      docId: report.docId,
      cardType: type,
      title: `${strategyCardTypeLabel(type)}：${cards.length} 张动作卡`,
      recommendation: cards.map((card) => `- ${card.triggerCondition} -> ${card.outputArtifact}`).join("\n"),
      whyNow: primary.triggerCondition,
      validationPlan: primary.validationMetrics.join("、") || "请结合业务指标验证动作效果。",
      evidenceRefs: uniq(cards.flatMap((card) => card.evidenceRefs)),
      semanticUnitIds: uniq(cards.flatMap((card) => card.semanticUnitIds ?? [])),
      blockedBySemanticRelationIds: uniq(cards.flatMap((card) => card.blockedBySemanticRelationIds ?? [])),
      linkedWikiRefs: uniq(cards.flatMap((card) => card.wikiRefs)),
      linkedDecisionPointIds: decisionPointIds(report, type),
      targetFieldKey: targetFieldKeyForCard(type),
      sourceFindingIds: linkedResearchFindingIds,
      status: cards.some((card) => card.status === "promoted_to_skill")
        ? "promoted_to_skill"
        : cards.some((card) => card.status === "confirmed")
          ? "confirmed"
          : "draft",
      createdAt: now,
      updatedAt: now,
    }
  })
}

function buildStrategyMarkdown(report: AgentModeReport, actionCards: StrategyActionCard[], categories: StrategyCategory[]): string {
  const unresolvedRelations = uniq(actionCards.flatMap((card) => card.blockedBySemanticRelationIds ?? []))
  const lines = [
    `# ${report.sourceName} 策略总览`,
    "",
    report.understanding.summary || "当前资料已经编译为一组待确认策略。",
    "",
    "## 可执行动作卡矩阵",
    "",
  ]
  if (actionCards.length === 0) {
    lines.push("- 当前还没有生成稳定动作卡，请先补齐业务结构、Wiki 投影和修订。")
  } else {
    for (const category of categories) {
      const cards = actionCards.filter((card) => card.category === category.categoryId)
      if (cards.length === 0) continue
      lines.push(`### ${category.label}`)
      lines.push("")
      for (const card of cards) {
        lines.push(`#### ${card.title}`)
        lines.push("")
        lines.push(`- 触发条件：${card.triggerCondition}`)
        lines.push(`- 必要输入：${card.requiredInputs.join("、") || "待补齐"}`)
        lines.push(`- 产出物：${card.outputArtifact}`)
        lines.push(`- 验证指标：${card.validationMetrics.join("、") || "待补齐"}`)
        lines.push(`- 当前状态：${card.status}`)
        if (card.missingInputs.length > 0) lines.push(`- 待补输入：${card.missingInputs.join("、")}`)
        if ((card.blockedBySemanticRelationIds ?? []).length > 0) {
          lines.push(`- 语义冲突提示：存在 ${card.blockedBySemanticRelationIds?.length ?? 0} 条未裁决关系，确认前不应生成业务能力。`)
        }
        lines.push("")
        lines.push("执行步骤：")
        for (const step of card.actionSteps) lines.push(`- ${step}`)
        if (card.wikiRefs.length > 0) lines.push(`- Wiki 引用：${card.wikiRefs.join(" · ")}`)
        if (card.evidenceRefs.length > 0) lines.push(`- 证据锚点：${card.evidenceRefs.slice(0, 8).join(" · ")}`)
        lines.push("")
      }
    }
  }
  lines.push("", "## 多来源证据与分歧", "")
  if (unresolvedRelations.length === 0) {
    lines.push("- 当前策略包没有命中未裁决的跨文档语义冲突。")
  } else {
    lines.push("- 当前策略包命中了未裁决的跨文档语义冲突，以下动作卡在确认前不会进入业务能力生成链路。")
    for (const card of actionCards.filter((item) => (item.blockedBySemanticRelationIds ?? []).length > 0)) {
      lines.push(`- ${card.title}：关联未裁决关系 ${(card.blockedBySemanticRelationIds ?? []).join("、")}`)
    }
  }
  return `${lines.join("\n").trim()}\n`
}

function toCoverage(report: AgentModeReport, actionCards: StrategyActionCard[]): StrategyCoverageReport {
  const byType = new Map<StrategyCardType, StrategyActionCard[]>()
  for (const card of actionCards) {
    byType.set(card.category, [...(byType.get(card.category) ?? []), card])
  }
  const dimensionByType: Array<[StrategyCoverageReport["entries"][number]["dimension"], StrategyCardType, string]> = [
    ["audience_segment", "audience_segment_diagnosis", "未形成稳定人群诊断动作卡。"],
    ["value_proposition", "value_prop_selection", "未形成稳定卖点选择动作卡。"],
    ["creative_asset_pattern", "creative_asset_brief_generation", "未形成稳定素材表达动作卡。"],
    ["metric_signal", "metric_signal_diagnosis", "未形成稳定指标诊断动作卡。"],
    ["optimization_action", "optimization_action_planning", "未形成稳定优化动作卡。"],
    ["validation_plan", "experiment_validation_plan", "未形成稳定实验验证动作卡。"],
  ]
  return {
    docId: report.docId,
    generatedAt: nowIso(),
    entries: [
      {
        dimension: "business_goal",
        covered: Boolean(fieldValue(report, "business_goal")),
        detail: fieldValue(report, "business_goal") || "未抽到明确业务目标。",
        linkedCardIds: [],
        rootCause: fieldValue(report, "business_goal") ? "written" : "missing_source_evidence",
      },
      ...dimensionByType.map(([dimension, type, missingDetail]) => {
        const cards = byType.get(type) ?? []
        const first = cards[0]
        let rootCause: StrategyCoverageReport["entries"][number]["rootCause"] = cards.length > 0 ? "written" : "missing_decision_projection"
        if (first && !first.triggerCondition) rootCause = "missing_trigger_condition"
        else if (first && first.actionSteps.length === 0) rootCause = "missing_action_steps"
        else if (first && !first.outputArtifact) rootCause = "missing_output_artifact"
        else if (first && first.validationMetrics.length === 0) rootCause = "missing_validation_metric"
        else if (first && first.wikiRefs.length === 0) rootCause = "missing_wiki_refs"
        else if (first && first.evidenceRefs.length === 0) rootCause = "missing_evidence_refs"
        else if (first && first.missingInputs.length > 0) rootCause = "not_skill_ready"
        return {
          dimension,
          covered: cards.length > 0,
          detail: first ? `${cards.length} 张动作卡：${first.title}` : missingDetail,
          linkedCardIds: cards.map((card) => card.actionCardId),
          rootCause,
        }
      }),
    ],
  }
}

async function loadConfirmedResearchFindingIds(projectPath: string, docId: string): Promise<string[]> {
  const root = `${normalizePath(projectPath)}/wiki/research`
  const exists = await fileExists(root).catch(() => false)
  if (!exists) return []
  const nodes = await listDirectory(root).catch(() => [])
  const findingIds: string[] = []
  for (const node of nodes) {
    if (!node.is_dir) continue
    const sessionPath = `${node.path}/session.json`
    const hasSession = await fileExists(sessionPath).catch(() => false)
    if (!hasSession) continue
    try {
      const session = JSON.parse(await readFile(sessionPath)) as ResearchSession
      for (const finding of session.findings ?? []) {
        if (finding.linkedDocId !== docId) continue
        if (finding.promotionState === "idle") continue
        findingIds.push(finding.findingId ?? finding.id)
      }
    } catch {
      // ignore broken session files
    }
  }
  return uniq(findingIds)
}

async function loadExistingBundle(projectPath: string, docId: string): Promise<StrategyBundle | null> {
  const path = `${normalizePath(projectPath)}/.llm-wiki/strategy-cards/${docId}.json`
  const exists = await fileExists(path).catch(() => false)
  if (!exists) return null
  try {
    const content = await readFile(path)
    return JSON.parse(content) as StrategyBundle
  } catch {
    return null
  }
}

export async function writeStrategyBundle(
  projectPath: string,
  report: AgentModeReport,
  scenePack: ScenePack,
  options: { llmConfig?: LlmConfig | null; signal?: AbortSignal; enhanceWithLlm?: boolean } = {},
): Promise<{ bundle: StrategyBundle; coverage: StrategyCoverageReport; writtenPaths: string[] }> {
  const pp = normalizePath(projectPath)
  await createDirectory(`${pp}/.llm-wiki/strategy-cards`).catch(() => {})
  await createDirectory(`${pp}/ontology/scenes/${report.sceneId}/strategy-bundles`).catch(() => {})
  const previous = await loadExistingBundle(pp, report.docId)
  const linkedResearchFindingIds = await loadConfirmedResearchFindingIds(pp, report.docId)
  const source = await loadStrategySourceBundle(pp, report)
  const ruleCards = buildActionCards(report, scenePack, source, linkedResearchFindingIds)
  const llmResult = await enhanceActionCardsWithLlm({
    report,
    source,
    scenePack,
    cards: ruleCards,
    llmConfig: options.enhanceWithLlm === false ? null : options.llmConfig ?? null,
    signal: options.signal,
  })
  const actionCards = mergeActionStatuses(
    llmResult.cards,
    previous,
  )
  const categories = buildCategories(scenePack, actionCards)
  const summaryCards = buildSummaryCards(report, actionCards, linkedResearchFindingIds)
  const markdown = buildStrategyMarkdown(report, actionCards, categories)
  const bundle: StrategyBundle = {
    schemaVersion: 2,
    bundleId: `strategy-bundle-${report.docId}`,
    docId: report.docId,
    sceneId: report.sceneId,
    title: `${report.sourceName} 策略包`,
    summary: report.understanding.summary || report.qualitySummary,
    strategyMarkdown: markdown,
    strategyCards: summaryCards,
    strategyCategories: categories,
    actionCards,
    warnings: llmResult.warnings,
    llmEnhanced: llmResult.enhanced,
    linkedResearchFindingIds,
    linkedRevisionCardIds: uniq(report.revisionIssueCards.map((card) => card.cardId)),
    linkedWikiRefs: uniq([
      ...report.supportingWikiPages,
      ...actionCards.flatMap((card) => card.wikiRefs),
      ...(isTaskGenerationScene(report)
        ? TASK_WIKI_REFS.map((template) => template.replace("{docSlug}", source.docSlug))
        : [
            `wiki/business/${source.docSlug}/index.md`,
            `wiki/business/${source.docSlug}/动作与实验.md`,
          ]),
    ]),
    evidenceRefs: uniq(actionCards.flatMap((card) => card.evidenceRefs)),
    consumedSemanticUnitIds: uniq(actionCards.flatMap((card) => card.semanticUnitIds ?? [])),
    unresolvedSemanticRelationIds: uniq(actionCards.flatMap((card) => card.blockedBySemanticRelationIds ?? [])),
    generatedAt: nowIso(),
  }
  const coverage = toCoverage(report, actionCards)
  const machinePath = `${pp}/ontology/scenes/${report.sceneId}/strategy-bundles/${report.docId}.json`
  const sidecarPath = `${pp}/.llm-wiki/strategy-cards/${report.docId}.json`
  const summaryPath = isTaskGenerationScene(report)
    ? `${pp}/wiki/tasks/${source.docSlug}-策略总览.md`
    : `${pp}/wiki/business/${source.docSlug}/策略总览.md`
  await createDirectory(isTaskGenerationScene(report) ? `${pp}/wiki/tasks` : `${pp}/wiki/business/${source.docSlug}`).catch(() => {})
  await writeFile(machinePath, JSON.stringify(bundle, null, 2))
  await writeFile(sidecarPath, JSON.stringify(bundle, null, 2))
  await writeFile(summaryPath, markdown)
  return {
    bundle,
    coverage,
    writtenPaths: [machinePath, sidecarPath, summaryPath],
  }
}
