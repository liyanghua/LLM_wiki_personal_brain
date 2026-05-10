import { createDirectory, fileExists, listDirectory, readFile, writeFile } from "@/commands/fs"
import type {
  AgentModeReport,
  StrategyBundle,
  StrategyCard,
  StrategyCardStatus,
  StrategyCardType,
  StrategyCoverageReport,
} from "@/lib/agent-mode-types"
import type { ResearchSession } from "@/lib/research-types"
import { getFileStem, normalizePath } from "@/lib/path-utils"
import type { ScenePack } from "@/lib/agent-mode-types"

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

function uniq(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)))
}

function slugForDoc(report: Pick<AgentModeReport, "sourceName">): string {
  return getFileStem(report.sourceName)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function strategyCardTypeLabel(type: StrategyCardType): string {
  switch (type) {
    case "audience_segment_diagnosis":
      return "人群诊断"
    case "value_prop_selection":
      return "卖点选择"
    case "creative_asset_brief_generation":
      return "素材表达"
    case "metric_signal_diagnosis":
      return "指标诊断"
    case "optimization_action_planning":
      return "优化动作"
    case "experiment_validation_plan":
      return "实验验证"
    case "generic":
    default:
      return "业务策略"
  }
}

function strategyFieldKeys(scenePack: ScenePack, type: StrategyCardType): string[] {
  const raw = scenePack.strategyProfile?.card_types
  if (Array.isArray(raw)) {
    const matched = raw.find((item) => {
      if (!item || typeof item !== "object") return false
      return asString((item as Record<string, unknown>).key) === type
    }) as Record<string, unknown> | undefined
    const keys = Array.isArray(matched?.source_field_keys)
      ? matched?.source_field_keys.map((item) => asString(item)).filter(Boolean)
      : []
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

function fieldValue(report: AgentModeReport, key: string): string {
  return report.groundTruth.fields.find((field) => field.key === key)?.value?.trim() ?? ""
}

function fieldEvidence(report: AgentModeReport, key: string): string[] {
  return report.compileIr.fieldEvidenceMap[key] ?? report.compileIr.sourceRefsByField[key] ?? []
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

function buildStrategyCard(
  report: AgentModeReport,
  type: StrategyCardType,
  scenePack: ScenePack,
  linkedResearchFindingIds: string[],
): StrategyCard | null {
  const sourceKeys = strategyFieldKeys(scenePack, type)
  const values = uniq(sourceKeys.map((key) => fieldValue(report, key)).filter(Boolean))
  if (values.length === 0) return null
  const evidenceRefs = uniq(sourceKeys.flatMap((key) => fieldEvidence(report, key)))
  const linkedWikiRefs = uniq([
    ...report.supportingWikiPages,
    `wiki/business/${slugForDoc(report)}/index.md`,
  ])
  const primary = values[0]
  const title = `${strategyCardTypeLabel(type)}：${primary.slice(0, 28)}`
  const validationPlan = fieldValue(report, "experiment_evidence")
    || fieldValue(report, "metric_signals")
    || "请结合当前修订稿中的指标信号与 A/B 测试计划做验证。"
  const whyNow = fieldValue(report, "decision_rules")
    || report.understanding.summary
    || "当前资料已经形成一轮可执行策略，建议进入验证。"
  const now = nowIso()
  return {
    cardId: nextId("strategy-card"),
    sceneId: report.sceneId,
    docId: report.docId,
    cardType: type,
    title,
    recommendation: primary,
    whyNow,
    validationPlan,
    evidenceRefs,
    linkedWikiRefs,
    linkedDecisionPointIds: decisionPointIds(report, type),
    targetFieldKey: targetFieldKeyForCard(type),
    sourceFindingIds: linkedResearchFindingIds,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  }
}

function buildStrategyMarkdown(report: AgentModeReport, cards: StrategyCard[]): string {
  const lines = [
    `# ${report.sourceName} 策略总览`,
    "",
    report.understanding.summary || "当前资料已经编译为一组待确认策略。",
    "",
    "## 当前策略卡",
    "",
  ]
  if (cards.length === 0) {
    lines.push("- 当前还没有生成稳定策略卡，请先补齐业务结构与修订。")
  } else {
    for (const card of cards) {
      lines.push(`### ${card.title}`)
      lines.push("")
      lines.push(card.recommendation)
      lines.push("")
      lines.push(`- 为什么现在做：${card.whyNow}`)
      lines.push(`- 如何验证：${card.validationPlan}`)
      lines.push(`- 当前状态：${card.status}`)
      lines.push("")
    }
  }
  return `${lines.join("\n").trim()}\n`
}

function toCoverage(report: AgentModeReport, cards: StrategyCard[]): StrategyCoverageReport {
  const byType = new Map(cards.map((card) => [card.cardType, card]))
  const entries: StrategyCoverageReport["entries"] = [
    {
      dimension: "business_goal",
      covered: Boolean(fieldValue(report, "business_goal")),
      detail: fieldValue(report, "business_goal") || "未抽到明确业务目标。",
      linkedCardIds: [],
      rootCause: fieldValue(report, "business_goal") ? "written" : "missing_source_evidence",
    },
    {
      dimension: "audience_segment",
      covered: byType.has("audience_segment_diagnosis"),
      detail: byType.get("audience_segment_diagnosis")?.title || "未形成稳定人群诊断策略卡。",
      linkedCardIds: byType.get("audience_segment_diagnosis") ? [byType.get("audience_segment_diagnosis")!.cardId] : [],
      rootCause: byType.has("audience_segment_diagnosis") ? "written" : "missing_decision_projection",
    },
    {
      dimension: "value_proposition",
      covered: byType.has("value_prop_selection"),
      detail: byType.get("value_prop_selection")?.title || "未形成稳定卖点选择策略卡。",
      linkedCardIds: byType.get("value_prop_selection") ? [byType.get("value_prop_selection")!.cardId] : [],
      rootCause: byType.has("value_prop_selection") ? "written" : "missing_decision_projection",
    },
    {
      dimension: "creative_asset_pattern",
      covered: byType.has("creative_asset_brief_generation"),
      detail: byType.get("creative_asset_brief_generation")?.title || "未形成稳定素材表达策略卡。",
      linkedCardIds: byType.get("creative_asset_brief_generation") ? [byType.get("creative_asset_brief_generation")!.cardId] : [],
      rootCause: byType.has("creative_asset_brief_generation") ? "written" : "missing_decision_projection",
    },
    {
      dimension: "metric_signal",
      covered: byType.has("metric_signal_diagnosis"),
      detail: byType.get("metric_signal_diagnosis")?.title || "未形成稳定指标诊断策略卡。",
      linkedCardIds: byType.get("metric_signal_diagnosis") ? [byType.get("metric_signal_diagnosis")!.cardId] : [],
      rootCause: byType.has("metric_signal_diagnosis") ? "written" : "missing_decision_projection",
    },
    {
      dimension: "optimization_action",
      covered: byType.has("optimization_action_planning"),
      detail: byType.get("optimization_action_planning")?.title || "未形成稳定优化动作策略卡。",
      linkedCardIds: byType.get("optimization_action_planning") ? [byType.get("optimization_action_planning")!.cardId] : [],
      rootCause: byType.has("optimization_action_planning") ? "written" : "missing_decision_projection",
    },
    {
      dimension: "validation_plan",
      covered: byType.has("experiment_validation_plan"),
      detail: byType.get("experiment_validation_plan")?.validationPlan || "未形成稳定实验验证策略卡。",
      linkedCardIds: byType.get("experiment_validation_plan") ? [byType.get("experiment_validation_plan")!.cardId] : [],
      rootCause: byType.has("experiment_validation_plan") ? "written" : "missing_validation_plan",
    },
  ]
  return {
    docId: report.docId,
    generatedAt: nowIso(),
    entries,
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

function mergeStatuses(nextCards: StrategyCard[], previous: StrategyBundle | null): StrategyCard[] {
  const previousByTitle = new Map((previous?.strategyCards ?? []).map((card) => [card.title, card]))
  return nextCards.map((card) => {
    const matched = previousByTitle.get(card.title)
    if (!matched) return card
    return {
      ...card,
      cardId: matched.cardId,
      status: matched.status as StrategyCardStatus,
      createdAt: matched.createdAt,
      updatedAt: nowIso(),
    }
  })
}

export async function writeStrategyBundle(
  projectPath: string,
  report: AgentModeReport,
  scenePack: ScenePack,
): Promise<{ bundle: StrategyBundle; coverage: StrategyCoverageReport; writtenPaths: string[] }> {
  const pp = normalizePath(projectPath)
  await createDirectory(`${pp}/.llm-wiki/strategy-cards`).catch(() => {})
  await createDirectory(`${pp}/ontology/scenes/${report.sceneId}/strategy-bundles`).catch(() => {})
  const previous = await loadExistingBundle(pp, report.docId)
  const linkedResearchFindingIds = await loadConfirmedResearchFindingIds(pp, report.docId)
  const supportedTypes: StrategyCardType[] = report.sceneId === "ecom_growth_hero_image"
    ? [
        "audience_segment_diagnosis",
        "value_prop_selection",
        "creative_asset_brief_generation",
        "metric_signal_diagnosis",
        "optimization_action_planning",
        "experiment_validation_plan",
      ]
    : ["generic"]
  const cards = mergeStatuses(
    supportedTypes
      .map((type) => buildStrategyCard(report, type, scenePack, linkedResearchFindingIds))
      .filter((item): item is StrategyCard => Boolean(item)),
    previous,
  )
  const markdown = buildStrategyMarkdown(report, cards)
  const bundle: StrategyBundle = {
    bundleId: `strategy-bundle-${report.docId}`,
    docId: report.docId,
    sceneId: report.sceneId,
    title: `${report.sourceName} 策略包`,
    summary: report.understanding.summary || report.qualitySummary,
    strategyMarkdown: markdown,
    strategyCards: cards,
    linkedResearchFindingIds,
    linkedRevisionCardIds: uniq(report.revisionIssueCards.map((card) => card.cardId)),
    linkedWikiRefs: uniq([
      ...report.supportingWikiPages,
      `wiki/business/${slugForDoc(report)}/index.md`,
      `wiki/business/${slugForDoc(report)}/动作与实验.md`,
    ]),
    evidenceRefs: uniq(cards.flatMap((card) => card.evidenceRefs)),
    generatedAt: nowIso(),
  }
  const coverage = toCoverage(report, cards)
  const machinePath = `${pp}/ontology/scenes/${report.sceneId}/strategy-bundles/${report.docId}.json`
  const sidecarPath = `${pp}/.llm-wiki/strategy-cards/${report.docId}.json`
  const summaryPath = `${pp}/wiki/business/${slugForDoc(report)}/策略总览.md`
  await createDirectory(`${pp}/wiki/business/${slugForDoc(report)}`).catch(() => {})
  await writeFile(machinePath, JSON.stringify(bundle, null, 2))
  await writeFile(sidecarPath, JSON.stringify(bundle, null, 2))
  await writeFile(summaryPath, markdown)
  return {
    bundle,
    coverage,
    writtenPaths: [machinePath, sidecarPath, summaryPath],
  }
}
