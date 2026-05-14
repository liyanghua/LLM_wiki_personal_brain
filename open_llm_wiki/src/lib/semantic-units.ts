import { createDirectory, fileExists, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type {
  AgentModeReport,
  BusinessObjectProjection,
  DecisionPoint,
  DocumentBlock,
  GroundTruthFieldValue,
} from "@/lib/agent-mode-types"
import type { ReviewItem } from "@/stores/review-store"

export type SemanticUnitType =
  | "claim"
  | "rule"
  | "decision_point"
  | "metric_definition"
  | "action_recommendation"
  | "exception"
  | "evidence_case"

export type SemanticUnitStatus =
  | "candidate"
  | "confirmed"
  | "accepted"
  | "adjudicated"
  | "rejected"
  | "superseded"
  | "needs_review"

export type SemanticRelationType =
  | "supports"
  | "duplicates"
  | "refines"
  | "contradicts"
  | "supersedes"
  | "scope_differs"

export type SemanticRelationStatus = "active" | "pending_review" | "resolved" | "dismissed"

export interface SemanticUnit {
  unitId: string
  projectId: string
  sceneId: string
  docId: string
  sourceName: string
  unitType: SemanticUnitType
  canonicalText: string
  normalizedKey: string
  scope: string
  targetFieldKey: string | null
  businessObjectIds: string[]
  evidenceRefs: string[]
  sourceRefs: string[]
  status: SemanticUnitStatus
  confidence: number
  createdAt: string
  updatedAt: string
}

export interface SemanticRelation {
  relationId: string
  fromUnitId: string
  toUnitId: string
  relationType: SemanticRelationType
  rationale: string
  evidenceRefs: string[]
  confidence: number
  status: SemanticRelationStatus
  createdAt: string
}

export interface SemanticConflictReviewPayload {
  conflictId: string
  unitA: SemanticUnit
  unitB: SemanticUnit
  conflictType: Extract<SemanticRelationType, "contradicts" | "scope_differs">
  summary: string
  suggestedResolution: string
  reviewState: "pending" | "resolved" | "dismissed"
}

export interface SemanticUnitIndex {
  schemaVersion: "semantic_units_v1"
  projectId: string
  generatedAt: string
  units: SemanticUnit[]
  relations: SemanticRelation[]
  conflicts: SemanticConflictReviewPayload[]
}

const SEMANTIC_INDEX_PATH = ".llm-wiki/semantic-units/index.json"
const MAX_FIELD_TEXT = 700

function nowIso(): string {
  return new Date().toISOString()
}

function uniq(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)))
}

function compileFieldEvidence(report: AgentModeReport, fieldKey: string): string[] {
  return report.compileIr.fieldEvidenceMap?.[fieldKey] ?? report.compileIr.sourceRefsByField?.[fieldKey] ?? []
}

function compactText(value: string, max = MAX_FIELD_TEXT): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max).trim()}...`
}

function stableHash(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function normalizeForKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bctr\b/g, "点击率")
    .replace(/\bcvr\b/g, "转化率")
    .replace(/\broi\b/g, "投入产出比")
    .replace(/[，。、“”‘’：:；;,.!?！？()[\]{}<>《》]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function tokenize(value: string): string[] {
  const normalized = normalizeForKey(value)
  const ascii = normalized.match(/[a-z0-9%]+/g) ?? []
  const cjk = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? []
  const cjkBigrams = cjk.flatMap((segment) => {
    const grams: string[] = []
    for (let i = 0; i < segment.length - 1; i += 1) grams.push(segment.slice(i, i + 2))
    return grams
  })
  return uniq([...ascii, ...cjk, ...cjkBigrams])
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const left = new Set(a)
  const right = new Set(b)
  let intersection = 0
  for (const item of left) {
    if (right.has(item)) intersection += 1
  }
  return intersection / (left.size + right.size - intersection)
}

function unitTypeForField(fieldKey: string): SemanticUnitType {
  if (/decision|rule|criteria|判断|规则/.test(fieldKey)) return "rule"
  if (/metric|signal|指标|口径/.test(fieldKey)) return "metric_definition"
  if (/action|playbook|experiment|validation|动作|实验|验证/.test(fieldKey)) return "action_recommendation"
  if (/evidence|case|source|证据|案例/.test(fieldKey)) return "evidence_case"
  if (/exception|boundary|scope|边界|例外|适用/.test(fieldKey)) return "exception"
  return "claim"
}

function statusForField(field: GroundTruthFieldValue): SemanticUnitStatus {
  if (field.status === "confirmed" || field.status === "revised") return "confirmed"
  if (field.status === "needs_review") return "needs_review"
  return "candidate"
}

function inferScope(text: string): string {
  const scopes = [
    "开学季",
    "大促",
    "日销",
    "新品",
    "老品",
    "儿童",
    "家长",
    "低价",
    "高客单",
    "主图",
    "详情页",
  ]
  const matched = scopes.filter((scope) => text.includes(scope))
  return matched.length > 0 ? matched.join(" / ") : "通用"
}

function extractNumbers(text: string): string[] {
  return (normalizeForKey(text).match(/\d+(?:\.\d+)?\s*%?/g) ?? []).map((item) => item.replace(/\s+/g, ""))
}

function hasNegationShift(a: string, b: string): boolean {
  const negations = ["不", "不要", "不能", "无需", "避免", "禁止"]
  return negations.some((word) => a.includes(word) !== b.includes(word))
}

function fieldSemanticStem(fieldKey: string, text: string): string {
  const normalized = normalizeForKey(text)
  const knownSignals = [
    "点击率",
    "转化率",
    "投入产出比",
    "主图",
    "素材",
    "卖点",
    "价格",
    "人群",
    "实验",
    "护眼",
  ].filter((token) => normalized.includes(token))
  return uniq([fieldKey, ...knownSignals]).join("|")
}

function unitIdFor(input: {
  sceneId: string
  docId: string
  unitType: string
  targetFieldKey: string | null
  text: string
  scope: string
}): string {
  const seed = [
    input.sceneId,
    input.docId,
    input.unitType,
    input.targetFieldKey ?? "",
    input.scope,
    normalizeForKey(input.text).slice(0, 180),
  ].join("|")
  return `sem_${stableHash(seed)}`
}

function relationIdFor(a: SemanticUnit, b: SemanticUnit, type: SemanticRelationType): string {
  const ids = [a.unitId, b.unitId].sort().join("|")
  return `semrel_${type}_${stableHash(ids)}`
}

function sourceRefsForReport(report: AgentModeReport): string[] {
  return uniq([report.sourcePath, report.sourceName])
}

function unitFromField(report: AgentModeReport, field: GroundTruthFieldValue, now: string): SemanticUnit | null {
  const text = compactText(field.value ?? "")
  if (!text) return null
  const unitType = unitTypeForField(field.key)
  const scope = inferScope(`${field.label} ${text}`)
  const normalizedKey = [
    report.sceneId,
    unitType,
    field.key,
    fieldSemanticStem(field.key, text),
    scope,
  ].join("|")
  const unitId = unitIdFor({
    sceneId: report.sceneId,
    docId: report.docId,
    unitType,
    targetFieldKey: field.key,
    text,
    scope,
  })
  return {
    unitId,
    projectId: "local-project",
    sceneId: report.sceneId,
    docId: report.docId,
    sourceName: report.sourceName,
    unitType,
    canonicalText: text,
    normalizedKey,
    scope,
    targetFieldKey: field.key,
    businessObjectIds: [],
    evidenceRefs: uniq([...(field.evidenceBlockRefs ?? []), ...compileFieldEvidence(report, field.key)]),
    sourceRefs: sourceRefsForReport(report),
    status: statusForField(field),
    confidence: field.status === "confirmed" || field.status === "revised" ? 0.86 : 0.62,
    createdAt: now,
    updatedAt: now,
  }
}

function unitFromDecisionPoint(report: AgentModeReport, point: DecisionPoint, index: number, now: string): SemanticUnit | null {
  const text = compactText([point.title, point.condition, point.action].filter(Boolean).join("："))
  if (!text) return null
  const scope = inferScope(text)
  const unitId = unitIdFor({
    sceneId: report.sceneId,
    docId: report.docId,
    unitType: "decision_point",
    targetFieldKey: "decision_points",
    text,
    scope,
  })
  return {
    unitId,
    projectId: "local-project",
    sceneId: report.sceneId,
    docId: report.docId,
    sourceName: report.sourceName,
    unitType: "decision_point",
    canonicalText: text,
    normalizedKey: [report.sceneId, "decision_point", fieldSemanticStem("decision_points", text), scope].join("|"),
    scope,
    targetFieldKey: "decision_points",
    businessObjectIds: [],
    evidenceRefs: uniq(point.evidenceBlockRefs ?? []),
    sourceRefs: sourceRefsForReport(report),
    status: "candidate",
    confidence: Math.max(0.5, 0.72 - index * 0.02),
    createdAt: now,
    updatedAt: now,
  }
}

function unitFromBusinessObject(report: AgentModeReport, object: BusinessObjectProjection, now: string): SemanticUnit | null {
  const text = compactText(`${object.label}：${object.summary}`)
  if (!text) return null
  const scope = inferScope(text)
  const unitId = unitIdFor({
    sceneId: report.sceneId,
    docId: report.docId,
    unitType: "claim",
    targetFieldKey: object.objectType,
    text,
    scope,
  })
  return {
    unitId,
    projectId: "local-project",
    sceneId: report.sceneId,
    docId: report.docId,
    sourceName: report.sourceName,
    unitType: "claim",
    canonicalText: text,
    normalizedKey: [report.sceneId, "claim", object.objectType, fieldSemanticStem(object.objectType, text), scope].join("|"),
    scope,
    targetFieldKey: object.objectType,
    businessObjectIds: [object.objectId],
    evidenceRefs: uniq(object.evidenceBlockRefs ?? []),
    sourceRefs: sourceRefsForReport(report),
    status: "candidate",
    confidence: object.confidence,
    createdAt: now,
    updatedAt: now,
  }
}

function unitFromText(input: {
  report: AgentModeReport
  unitType: SemanticUnitType
  text: string
  targetFieldKey: string | null
  evidenceRefs: string[]
  businessObjectIds?: string[]
  confidence?: number
  now: string
}): SemanticUnit | null {
  const text = compactText(input.text)
  if (text.length < 8) return null
  const scope = inferScope(text)
  const unitId = unitIdFor({
    sceneId: input.report.sceneId,
    docId: input.report.docId,
    unitType: input.unitType,
    targetFieldKey: input.targetFieldKey,
    text,
    scope,
  })
  return {
    unitId,
    projectId: "local-project",
    sceneId: input.report.sceneId,
    docId: input.report.docId,
    sourceName: input.report.sourceName,
    unitType: input.unitType,
    canonicalText: text,
    normalizedKey: [input.report.sceneId, input.unitType, input.targetFieldKey ?? "general", fieldSemanticStem(input.targetFieldKey ?? input.unitType, text), scope].join("|"),
    scope,
    targetFieldKey: input.targetFieldKey,
    businessObjectIds: input.businessObjectIds ?? [],
    evidenceRefs: uniq(input.evidenceRefs),
    sourceRefs: sourceRefsForReport(input.report),
    status: "candidate",
    confidence: input.confidence ?? 0.58,
    createdAt: input.now,
    updatedAt: input.now,
  }
}

function unitsFromCompileIr(report: AgentModeReport, now: string): SemanticUnit[] {
  const units: SemanticUnit[] = []
  for (const rule of report.compileIr.businessRules ?? []) {
    const unit = unitFromText({
      report,
      unitType: "rule",
      text: rule,
      targetFieldKey: "business_rules",
      evidenceRefs: compileFieldEvidence(report, "business_rules"),
      now,
    })
    if (unit) units.push(unit)
  }
  for (const metric of report.compileIr.metrics ?? []) {
    const unit = unitFromText({
      report,
      unitType: "metric_definition",
      text: metric,
      targetFieldKey: "metric_signals",
      evidenceRefs: compileFieldEvidence(report, "metric_signals"),
      now,
    })
    if (unit) units.push(unit)
  }
  for (const action of report.compileIr.evidenceCases ?? []) {
    const unit = unitFromText({
      report,
      unitType: "evidence_case",
      text: action,
      targetFieldKey: "evidence_cases",
      evidenceRefs: compileFieldEvidence(report, "evidence_cases"),
      now,
    })
    if (unit) units.push(unit)
  }
  for (const action of report.compileIr.sopSteps ?? report.compileIr.mainlineSteps ?? []) {
    const unit = unitFromText({
      report,
      unitType: "action_recommendation",
      text: action,
      targetFieldKey: "execution_steps",
      evidenceRefs: compileFieldEvidence(report, "execution_steps"),
      now,
    })
    if (unit) units.push(unit)
  }
  return units
}

function unitTypeFromBlock(block: DocumentBlock): SemanticUnitType | null {
  const text = `${block.headingPath.join(" ")} ${block.textContent}`
  if (/判断|规则|criteria|rule/i.test(text)) return "rule"
  if (/指标|点击率|转化率|ctr|cvr|roi|metric/i.test(text)) return "metric_definition"
  if (/动作|步骤|实验|验证|action|step|test/i.test(text)) return "action_recommendation"
  if (/证据|案例|case|evidence/i.test(text) || block.evidenceKind === "image" || block.evidenceKind === "table") return "evidence_case"
  return null
}

function unitsFromDocumentIr(report: AgentModeReport, now: string): SemanticUnit[] {
  const units: SemanticUnit[] = []
  for (const block of report.documentIr.blocks ?? []) {
    const unitType = unitTypeFromBlock(block)
    if (!unitType) continue
    const text = block.textContent.trim()
    if (!text || text.length < 8) continue
    const unit = unitFromText({
      report,
      unitType,
      text,
      targetFieldKey: block.blockRole ?? block.evidenceKind ?? unitType,
      evidenceRefs: uniq([block.blockId, ...(block.sourceRefs ?? []), block.sourceAnchorId ?? ""]),
      confidence: block.approximateAnchor ? 0.48 : 0.56,
      now,
    })
    if (unit) units.push(unit)
  }
  return units
}

export function extractSemanticUnitsFromReport(report: AgentModeReport, generatedAt = nowIso()): SemanticUnit[] {
  const units: SemanticUnit[] = []
  for (const field of report.groundTruth.fields ?? []) {
    const unit = unitFromField(report, field, generatedAt)
    if (unit) units.push(unit)
  }
  for (const [index, point] of (report.understanding.decisionPoints ?? []).entries()) {
    const unit = unitFromDecisionPoint(report, point, index, generatedAt)
    if (unit) units.push(unit)
  }
  for (const object of report.understanding.businessObjects ?? []) {
    const unit = unitFromBusinessObject(report, object, generatedAt)
    if (unit) units.push(unit)
  }
  units.push(...unitsFromCompileIr(report, generatedAt))
  units.push(...unitsFromDocumentIr(report, generatedAt))
  const byId = new Map<string, SemanticUnit>()
  for (const unit of units) byId.set(unit.unitId, unit)
  return Array.from(byId.values())
}

function sameComparisonBucket(a: SemanticUnit, b: SemanticUnit): boolean {
  if (a.unitId === b.unitId || a.docId === b.docId) return false
  if (a.sceneId !== b.sceneId) return false
  if (a.unitType !== b.unitType) return false
  if ((a.targetFieldKey ?? "") !== (b.targetFieldKey ?? "")) return false
  return true
}

function classifyRelation(a: SemanticUnit, b: SemanticUnit): Omit<SemanticRelation, "relationId" | "fromUnitId" | "toUnitId" | "createdAt"> | null {
  if (!sameComparisonBucket(a, b)) return null
  const textA = normalizeForKey(a.canonicalText)
  const textB = normalizeForKey(b.canonicalText)
  const similarity = jaccard(tokenize(textA), tokenize(textB))
  const numbersA = extractNumbers(textA)
  const numbersB = extractNumbers(textB)
  const sameNumbers = numbersA.join("|") === numbersB.join("|")
  const bothHaveNumbers = numbersA.length > 0 && numbersB.length > 0
  const scopeDiffers = a.scope !== b.scope && a.scope !== "通用" && b.scope !== "通用"
  const relatedEnough = similarity >= 0.18 || normalizeForKey(a.normalizedKey) === normalizeForKey(b.normalizedKey)
  if (!relatedEnough) return null

  const evidenceRefs = uniq([...a.evidenceRefs, ...b.evidenceRefs])
  if (scopeDiffers) {
    return {
      relationType: "scope_differs",
      rationale: `两条语义单元主题相近，但适用范围不同：${a.scope} vs ${b.scope}。`,
      evidenceRefs,
      confidence: Math.max(0.55, Math.min(0.9, similarity + 0.35)),
      status: "active",
    }
  }
  if ((bothHaveNumbers && !sameNumbers) || hasNegationShift(textA, textB)) {
    return {
      relationType: "contradicts",
      rationale: "两条语义单元指向同一字段或规则，但阈值、否定/优先级表达不一致，需要人工裁决。",
      evidenceRefs,
      confidence: Math.max(0.6, Math.min(0.95, similarity + 0.45)),
      status: "pending_review",
    }
  }
  if (similarity >= 0.72) {
    return {
      relationType: "duplicates",
      rationale: "两条语义单元语义高度重合，可视为同一结论的重复表达。",
      evidenceRefs,
      confidence: Math.min(0.96, similarity),
      status: "active",
    }
  }
  if (similarity >= 0.18) {
    return {
      relationType: "supports",
      rationale: "两条语义单元表达相近，形成跨文档支持证据。",
      evidenceRefs,
      confidence: Math.max(0.55, Math.min(0.88, similarity + 0.35)),
      status: "active",
    }
  }
  return null
}

export function buildSemanticRelations(units: SemanticUnit[], generatedAt = nowIso()): SemanticRelation[] {
  const relations: SemanticRelation[] = []
  const seen = new Set<string>()
  for (let i = 0; i < units.length; i += 1) {
    for (let j = i + 1; j < units.length; j += 1) {
      const left = units[i]
      const right = units[j]
      if (!left || !right) continue
      const classified = classifyRelation(left, right)
      if (!classified) continue
      const relationId = relationIdFor(left, right, classified.relationType)
      if (seen.has(relationId)) continue
      seen.add(relationId)
      relations.push({
        relationId,
        fromUnitId: left.unitId,
        toUnitId: right.unitId,
        createdAt: generatedAt,
        ...classified,
      })
    }
  }
  return relations
}

export function buildSemanticConflicts(units: SemanticUnit[], relations: SemanticRelation[]): SemanticConflictReviewPayload[] {
  const byId = new Map(units.map((unit) => [unit.unitId, unit]))
  const conflicts: SemanticConflictReviewPayload[] = []
  for (const relation of relations) {
    if (relation.relationType !== "contradicts" && relation.relationType !== "scope_differs") continue
    if (relation.status !== "pending_review") continue
    const unitA = byId.get(relation.fromUnitId)
    const unitB = byId.get(relation.toUnitId)
    if (!unitA || !unitB) continue
    conflicts.push({
      conflictId: `semconf_${stableHash(relation.relationId)}`,
      unitA,
      unitB,
      conflictType: relation.relationType,
      summary: relation.relationType === "contradicts"
        ? `「${unitA.sourceName}」与「${unitB.sourceName}」对「${unitA.targetFieldKey ?? unitA.unitType}」的描述存在冲突。`
        : `「${unitA.sourceName}」与「${unitB.sourceName}」描述相近，但适用范围不同。`,
      suggestedResolution: relation.relationType === "contradicts"
        ? "请确认采用哪一份文档的口径，或补充适用条件后再进入 GroundTruth / 策略 / Skill。"
        : "请确认这是否是场景范围差异；如果是，建议分别保留适用范围。",
      reviewState: "pending",
    })
  }
  return conflicts
}

export function buildSemanticUnitIndex(reports: AgentModeReport[], generatedAt = nowIso()): SemanticUnitIndex {
  const units = reports.flatMap((report) => extractSemanticUnitsFromReport(report, generatedAt))
  const relations = buildSemanticRelations(units, generatedAt)
  return {
    schemaVersion: "semantic_units_v1",
    projectId: "local-project",
    generatedAt,
    units,
    relations,
    conflicts: buildSemanticConflicts(units, relations),
  }
}

export async function saveSemanticUnitIndex(projectPath: string, index: SemanticUnitIndex): Promise<void> {
  const pp = normalizePath(projectPath)
  await createDirectory(`${pp}/.llm-wiki/semantic-units`).catch(() => {})
  await writeFile(`${pp}/${SEMANTIC_INDEX_PATH}`, JSON.stringify(index, null, 2))
}

export async function loadSemanticUnitIndex(projectPath: string): Promise<SemanticUnitIndex> {
  const pp = normalizePath(projectPath)
  const path = `${pp}/${SEMANTIC_INDEX_PATH}`
  const exists = await fileExists(path).catch(() => false)
  if (!exists) {
    return {
      schemaVersion: "semantic_units_v1",
      projectId: "local-project",
      generatedAt: nowIso(),
      units: [],
      relations: [],
      conflicts: [],
    }
  }
  try {
    const parsed = JSON.parse(await readFile(path)) as Partial<SemanticUnitIndex>
    const units = Array.isArray(parsed.units) ? parsed.units : []
    const relations = Array.isArray(parsed.relations) ? parsed.relations : []
    return {
      schemaVersion: "semantic_units_v1",
      projectId: parsed.projectId ?? "local-project",
      generatedAt: parsed.generatedAt ?? nowIso(),
      units,
      relations,
      conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : buildSemanticConflicts(units, relations),
    }
  } catch {
    return {
      schemaVersion: "semantic_units_v1",
      projectId: "local-project",
      generatedAt: nowIso(),
      units: [],
      relations: [],
      conflicts: [],
    }
  }
}

export async function rebuildSemanticUnitIndex(projectPath: string, reports: AgentModeReport[]): Promise<SemanticUnitIndex> {
  const index = buildSemanticUnitIndex(reports)
  await saveSemanticUnitIndex(projectPath, index)
  return index
}

export function buildSemanticConflictReviewItems(index: SemanticUnitIndex): Omit<ReviewItem, "id" | "resolved" | "createdAt">[] {
  const relationByUnits = new Map(index.relations.map((relation) => [`${relation.fromUnitId}|${relation.toUnitId}`, relation]))
  return index.conflicts
    .filter((conflict) => conflict.conflictType === "contradicts")
    .map((conflict) => {
      const relation = relationByUnits.get(`${conflict.unitA.unitId}|${conflict.unitB.unitId}`)
      return {
        type: "contradiction",
        title: `语义冲突：${conflict.unitA.targetFieldKey ?? conflict.unitA.unitType}`,
        description: [
          conflict.summary,
          "",
          `A：${conflict.unitA.canonicalText}`,
          `来源：${conflict.unitA.sourceName}`,
          "",
          `B：${conflict.unitB.canonicalText}`,
          `来源：${conflict.unitB.sourceName}`,
          "",
          conflict.suggestedResolution,
        ].join("\n"),
        sourcePath: conflict.unitA.sourceRefs[0] ?? conflict.unitA.sourceName,
        affectedPages: uniq([...conflict.unitA.sourceRefs, ...conflict.unitB.sourceRefs]),
        options: [
          { label: "采用 A 口径", action: "accept_unit_a" },
          { label: "采用 B 口径", action: "accept_unit_b" },
          { label: "保留为适用范围差异", action: "mark_scope_differs" },
          { label: "暂不处理", action: "defer" },
        ],
        origin: "agent_mode",
        issueScope: "wiki_asset",
        rootCause: "wiki_contradiction",
        linkedDocId: conflict.unitA.docId,
        targetFieldKey: conflict.unitA.targetFieldKey,
        semanticUnitIds: [conflict.unitA.unitId, conflict.unitB.unitId],
        semanticRelationIds: relation ? [relation.relationId] : [],
        conflictType: conflict.conflictType,
        resolutionAction: null,
      }
    })
}

export function unresolvedSemanticRelationsForDoc(index: SemanticUnitIndex, docId: string): SemanticRelation[] {
  const unitIds = new Set(index.units.filter((unit) => unit.docId === docId).map((unit) => unit.unitId))
  return index.relations.filter((relation) =>
    relation.status === "pending_review"
    && (unitIds.has(relation.fromUnitId) || unitIds.has(relation.toUnitId))
  )
}

export function semanticUnitIdsForField(index: SemanticUnitIndex, docId: string, fieldKeys: string[]): string[] {
  const fields = new Set(fieldKeys)
  return index.units
    .filter((unit) => unit.docId === docId)
    .filter((unit) => unit.status === "confirmed" || unit.status === "accepted" || unit.status === "adjudicated")
    .filter((unit) => unit.targetFieldKey && fields.has(unit.targetFieldKey))
    .map((unit) => unit.unitId)
}

export function unresolvedRelationIdsForUnits(index: SemanticUnitIndex, unitIds: string[]): string[] {
  const unitSet = new Set(unitIds)
  return index.relations
    .filter((relation) => relation.status === "pending_review")
    .filter((relation) => unitSet.has(relation.fromUnitId) || unitSet.has(relation.toUnitId))
    .map((relation) => relation.relationId)
}

export function semanticContextForQuery(index: SemanticUnitIndex, query: string, limit = 6): string {
  if (index.units.length === 0) return ""
  const queryTokens = tokenize(query)
  const scored = index.units
    .map((unit) => ({
      unit,
      score: jaccard(queryTokens, tokenize(`${unit.canonicalText} ${unit.sourceName} ${unit.targetFieldKey ?? ""}`)),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  if (scored.length === 0) return ""
  const unitIds = new Set(scored.map((item) => item.unit.unitId))
  const relations = index.relations.filter((relation) => unitIds.has(relation.fromUnitId) || unitIds.has(relation.toUnitId))
  const lines = [
    "## Semantic Unit Evidence",
    "",
    "这些是跨文档抽取出的语义单元及其关系。若存在冲突，请明确说明尚需人工裁决，不要把冲突内容当成已确认结论。",
    "",
    ...scored.map(({ unit }, index) =>
      `- [S${index + 1}] ${unit.unitType}/${unit.targetFieldKey ?? "general"}：${unit.canonicalText}（来源：${unit.sourceName}；状态：${unit.status}；范围：${unit.scope}）`
    ),
  ]
  if (relations.length > 0) {
    lines.push("", "### Relations")
    for (const relation of relations.slice(0, 8)) {
      lines.push(`- ${relation.relationType}：${relation.rationale}（状态：${relation.status}）`)
    }
  }
  return lines.join("\n")
}
