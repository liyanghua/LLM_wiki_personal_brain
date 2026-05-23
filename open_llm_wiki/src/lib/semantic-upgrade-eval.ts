import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { AgentModeReport, StrategyCardType } from "@/lib/agent-mode-types"

export type EvaluationTaskType = "wiki_compile" | "strategy" | "agent" | "qa"

export interface EvaluationCase {
  caseId: string
  sourcePaths: string[]
  sceneId: string
  taskTypes: EvaluationTaskType[]
  goldAnnotationPath: string
  gold?: GoldAnnotation
  expectedQueries?: GoldExpectedQuery[]
  expectedAgentTasks?: GoldExpectedAgentTask[]
}

export interface GoldAnnotation {
  expectedFields: GoldExpectedField[]
  expectedSemanticUnits: GoldExpectedSemanticUnit[]
  expectedEvidenceRefs: GoldExpectedEvidenceRef[]
  expectedRelations: GoldExpectedRelation[]
  expectedWikiPages: string[]
  expectedStrategyCards: GoldExpectedStrategyCard[]
  expectedQueries?: GoldExpectedQuery[]
  expectedAgentTasks?: GoldExpectedAgentTask[]
}

export interface GoldExpectedField {
  key: string
  required?: boolean
}

export interface GoldExpectedSemanticUnit {
  unitType?: string
  text: string
  targetFieldKey?: string | null
}

export interface GoldExpectedEvidenceRef {
  fieldKey: string
  refs: string[]
}

export interface GoldExpectedRelation {
  relationType: string
}

export interface GoldExpectedStrategyCard {
  category: StrategyCardType | string
}

export interface GoldExpectedQuery {
  query: string
  expectedEvidenceRefs: string[]
  expectedImageRefs?: string[]
}

export interface GoldExpectedAgentTask {
  skillFamily: StrategyCardType | string
  expectedEvidenceRefs: string[]
}

export interface MetricPair {
  baseline: number
  upgraded: number
  delta: number
}

export interface EvaluationLayerMetrics {
  parsingQuality: MetricPair
  semanticQuality: MetricPair
  evidenceQuality: MetricPair
  wikiStrategyQuality: MetricPair
  agentQaQuality: MetricPair
}

export interface EvaluationAggregateMetrics extends EvaluationLayerMetrics {
  overallScore: MetricPair
  evidence: {
    precision: MetricPair
    coverage: MetricPair
  }
  fieldCoverage: MetricPair
}

export interface EvaluationCaseResult {
  caseId: string
  sceneId: string
  baselineScore: number
  upgradedScore: number
  delta: number
  layerMetrics: EvaluationLayerMetrics
  evidencePrecision: MetricPair
  fieldCoverage: MetricPair
  findings: string[]
  regressions: string[]
  recommendation: string
}

export interface EvaluationRunReport {
  runId: string
  mode: "baseline" | "upgraded" | "compare"
  baselineVersion: string
  upgradedVersion: string
  generatedAt: string
  caseResults: EvaluationCaseResult[]
  aggregateMetrics: EvaluationAggregateMetrics
  regressions: string[]
  recommendedFixes: string[]
}

export interface BuildSemanticUpgradeEvaluationReportInput {
  runId: string
  cases: EvaluationCase[]
  baselineReports?: AgentModeReport[]
  upgradedReports?: AgentModeReport[]
  baselineVersion?: string
  upgradedVersion?: string
  generatedAt?: string
  mode?: "baseline" | "upgraded" | "compare"
}

export interface RunSemanticUpgradeEvalInput extends BuildSemanticUpgradeEvaluationReportInput {
  mode: "baseline" | "upgraded" | "compare"
}

export interface RunSemanticUpgradeEvalResult {
  outputDir: string
  report: EvaluationRunReport
}

export interface EvaluationCasesFile {
  runId?: string
  baselineVersion?: string
  upgradedVersion?: string
  baselineReportPaths?: string[]
  upgradedReportPaths?: string[]
  cases: EvaluationCase[]
}

const WEIGHTS = {
  parsingQuality: 0.15,
  semanticQuality: 0.25,
  evidenceQuality: 0.25,
  wikiStrategyQuality: 0.2,
  agentQaQuality: 0.15,
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function percentScore(value: number): number {
  return round(clamp01(value) * 100, 2)
}

function pair(baseline: number, upgraded: number): MetricPair {
  const b = round(baseline, 2)
  const u = round(upgraded, 2)
  return { baseline: b, upgraded: u, delta: round(u - b, 2) }
}

function uniq(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)))
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bctr\b/g, "点击率")
    .replace(/\bcvr\b/g, "转化率")
    .replace(/\broi\b/g, "投入产出比")
    .replace(/[，。、“”‘’：:；;,.!?！？()[\]{}<>《》/\s-]/g, "")
    .trim()
}

function textMatches(actual: string, expected: string): boolean {
  const a = normalizeText(actual)
  const e = normalizeText(expected)
  if (!a || !e) return false
  return a.includes(e) || e.includes(a)
}

function reportForCase(reports: AgentModeReport[] | undefined, evaluationCase: EvaluationCase): AgentModeReport | null {
  return reports?.find((report) =>
    report.sceneId === evaluationCase.sceneId
      && (evaluationCase.sourcePaths.includes(report.sourcePath) || evaluationCase.sourcePaths.includes(report.sourceName) || report.docId === evaluationCase.caseId),
  ) ?? reports?.find((report) => report.sceneId === evaluationCase.sceneId) ?? reports?.[0] ?? null
}

function allFieldEvidenceRefs(report: AgentModeReport): string[] {
  return uniq([
    ...Object.values(report.compileIr.fieldEvidenceMap ?? {}).flat(),
    ...Object.values(report.compileIr.sourceRefsByField ?? {}).flat(),
    ...(report.groundTruth.fields ?? []).flatMap((field) => field.evidenceBlockRefs ?? []),
  ])
}

function semanticUnitIds(report: AgentModeReport): string[] {
  return uniq([
    ...(report.compileIr.consumedSemanticUnitIds ?? []),
    ...(report.groundTruth.fields ?? []).flatMap((field) => field.semanticUnitIds ?? []),
    ...(report.strategyBundle?.consumedSemanticUnitIds ?? []),
    ...(report.strategyBundle?.actionCards ?? []).flatMap((card) => card.semanticUnitIds ?? []),
    ...(report.strategyBundle?.strategyCards ?? []).flatMap((card) => card.semanticUnitIds ?? []),
  ])
}

function expectedFields(gold: GoldAnnotation): GoldExpectedField[] {
  return gold.expectedFields ?? []
}

function fieldCoverage(report: AgentModeReport | null, gold: GoldAnnotation): number {
  if (!report) return 0
  const expected = expectedFields(gold)
  if (expected.length === 0) return 1
  let covered = 0
  for (const field of expected) {
    const gt = report.groundTruth.fields.find((item) => item.key === field.key && item.value.trim())
    const compiled = report.compileIr.fieldValueMap?.[field.key]?.trim()
    if (gt || compiled) covered += 1
  }
  return covered / expected.length
}

function evidenceCoverage(report: AgentModeReport | null, gold: GoldAnnotation): number {
  if (!report) return 0
  const expected = gold.expectedEvidenceRefs ?? []
  if (expected.length === 0) return 1
  let covered = 0
  for (const item of expected) {
    const refs = new Set([
      ...(report.compileIr.fieldEvidenceMap?.[item.fieldKey] ?? []),
      ...(report.compileIr.sourceRefsByField?.[item.fieldKey] ?? []),
      ...(report.groundTruth.fields.find((field) => field.key === item.fieldKey)?.evidenceBlockRefs ?? []),
    ])
    if (item.refs.some((ref) => refs.has(ref))) covered += 1
  }
  return covered / expected.length
}

function evidencePrecision(report: AgentModeReport | null, gold: GoldAnnotation): number {
  if (!report) return 0
  const expected = gold.expectedEvidenceRefs ?? []
  if (expected.length === 0) return 1
  let actualCount = 0
  let hitCount = 0
  for (const item of expected) {
    const directRefs = uniq([
      ...(report.compileIr.fieldEvidenceMap?.[item.fieldKey] ?? []),
      ...(report.groundTruth.fields.find((field) => field.key === item.fieldKey)?.evidenceBlockRefs ?? []),
    ])
    const refs = directRefs.length > 0
      ? directRefs
      : uniq(report.compileIr.sourceRefsByField?.[item.fieldKey] ?? [])
    actualCount += refs.length
    const expectedRefs = new Set(item.refs)
    hitCount += refs.filter((ref) => expectedRefs.has(ref)).length
  }
  if (actualCount === 0) return 0
  return hitCount / actualCount
}

function semanticUnitCoverage(report: AgentModeReport | null, gold: GoldAnnotation): number {
  if (!report) return 0
  const expected = gold.expectedSemanticUnits ?? []
  if (expected.length === 0) return 1
  const semanticIds = semanticUnitIds(report)
  const fieldTexts = [
    ...report.groundTruth.fields.map((field) => `${field.key} ${field.value}`),
    ...Object.entries(report.compileIr.fieldValueMap ?? {}).map(([key, value]) => `${key} ${value}`),
    ...report.compileIr.businessRules,
    ...report.compileIr.metrics,
  ]
  let covered = 0
  for (const unit of expected) {
    const fieldHit = unit.targetFieldKey
      ? report.groundTruth.fields.some((field) => field.key === unit.targetFieldKey && field.semanticUnitIds?.length)
        || (report.strategyBundle?.actionCards ?? []).some((card) => card.semanticUnitIds?.length && card.sourceFieldKeys.includes(unit.targetFieldKey ?? ""))
      : semanticIds.length > 0
    const textHit = fieldTexts.some((text) => textMatches(text, unit.text))
    if (fieldHit || textHit) covered += 1
  }
  return covered / expected.length
}

function relationCoverage(report: AgentModeReport | null, gold: GoldAnnotation): number {
  if (!report) return 0
  const expected = gold.expectedRelations ?? []
  if (expected.length === 0) return 1
  const relationRefs = [
    ...(report.compileIr.unresolvedSemanticRelationIds ?? []),
    ...(report.strategyBundle?.unresolvedSemanticRelationIds ?? []),
    ...(report.strategyBundle?.actionCards ?? []).flatMap((card) => card.blockedBySemanticRelationIds ?? []),
    ...(report.strategyBundle?.strategyCards ?? []).flatMap((card) => card.blockedBySemanticRelationIds ?? []),
  ]
  if (relationRefs.length === 0) return 0
  return Math.min(1, relationRefs.length / expected.length)
}

function parsingQuality(report: AgentModeReport | null): number {
  if (!report) return 0
  const blocks = report.documentIr.blocks ?? []
  if (blocks.length === 0) return 0
  const headings = blocks.filter((block) => block.blockType === "heading" || block.headingPath.length > 0).length
  const anchors = blocks.filter((block) => block.sourceAnchorId || block.sourceRefs.length > 0).length
  const images = blocks.filter((block) => block.blockType === "image" || block.evidenceKind === "image" || block.assetPath).length
  const tables = blocks.filter((block) => block.blockType === "table" || block.evidenceKind === "table").length
  return (
    0.35
    + 0.25 * clamp01(headings / blocks.length)
    + 0.25 * clamp01(anchors / blocks.length)
    + 0.1 * clamp01(images)
    + 0.05 * clamp01(tables)
  )
}

function wikiStrategyQuality(report: AgentModeReport | null, gold: GoldAnnotation): number {
  if (!report) return 0
  const expectedPages = gold.expectedWikiPages ?? []
  const writtenPages = new Set([
    ...report.compileCoverage.entries.flatMap((entry) => entry.pagePath ? [entry.pagePath] : []),
    ...(report.strategyBundle?.linkedWikiRefs ?? []),
    ...(report.strategyBundle?.actionCards ?? []).flatMap((card) => card.wikiRefs),
  ])
  const pageCoverage = expectedPages.length === 0
    ? 1
    : expectedPages.filter((page) => writtenPages.has(page)).length / expectedPages.length
  const expectedCards = gold.expectedStrategyCards ?? []
  const actionCards = report.strategyBundle?.actionCards ?? []
  const cardCoverage = expectedCards.length === 0
    ? 1
    : expectedCards.filter((expected) => actionCards.some((card) => card.category === expected.category || card.skillFamily === expected.category)).length / expectedCards.length
  const writtenCoverage = report.compileCoverage.entries.length === 0
    ? fieldCoverage(report, gold)
    : report.compileCoverage.entries.filter((entry) => entry.written && entry.evidenceRefs.length > 0).length / report.compileCoverage.entries.length
  return 0.35 * pageCoverage + 0.35 * cardCoverage + 0.3 * writtenCoverage
}

function agentQaQuality(report: AgentModeReport | null, gold: GoldAnnotation): number {
  if (!report) return 0
  const expectedTasks = gold.expectedAgentTasks ?? []
  const actionCards = report.strategyBundle?.actionCards ?? []
  const taskCoverage = expectedTasks.length === 0
    ? 1
    : expectedTasks.filter((task) =>
      actionCards.some((card) =>
        (card.skillFamily === task.skillFamily || card.category === task.skillFamily)
        && task.expectedEvidenceRefs.some((ref) => card.evidenceRefs.includes(ref)),
      ),
    ).length / expectedTasks.length

  const expectedQueries = gold.expectedQueries ?? []
  const imageRefs = report.compileIr.imageEvidenceRefs ?? []
  const queryCoverage = expectedQueries.length === 0
    ? 1
    : expectedQueries.filter((query) =>
      (query.expectedImageRefs ?? []).some((url) => imageRefs.some((image) => image.url === url))
      || query.expectedEvidenceRefs.some((ref) => allFieldEvidenceRefs(report).includes(ref) || imageRefs.some((image) => image.imageId === ref)),
    ).length / expectedQueries.length

  return 0.55 * taskCoverage + 0.45 * queryCoverage
}

function scoreCaseSide(report: AgentModeReport | null, gold: GoldAnnotation): {
  parsingQuality: number
  semanticQuality: number
  evidenceQuality: number
  wikiStrategyQuality: number
  agentQaQuality: number
  fieldCoverage: number
  evidencePrecision: number
  evidenceCoverage: number
  overallScore: number
} {
  const field = fieldCoverage(report, gold)
  const evidence = evidenceCoverage(report, gold)
  const precision = evidencePrecision(report, gold)
  const semantic = 0.7 * semanticUnitCoverage(report, gold) + 0.3 * relationCoverage(report, gold)
  const parsing = parsingQuality(report)
  const wikiStrategy = wikiStrategyQuality(report, gold)
  const agentQa = agentQaQuality(report, gold)
  const evidenceQuality = 0.6 * evidence + 0.4 * precision
  const overall =
    WEIGHTS.parsingQuality * parsing
    + WEIGHTS.semanticQuality * semantic
    + WEIGHTS.evidenceQuality * evidenceQuality
    + WEIGHTS.wikiStrategyQuality * wikiStrategy
    + WEIGHTS.agentQaQuality * agentQa
  return {
    parsingQuality: percentScore(parsing),
    semanticQuality: percentScore(semantic),
    evidenceQuality: percentScore(evidenceQuality),
    wikiStrategyQuality: percentScore(wikiStrategy),
    agentQaQuality: percentScore(agentQa),
    fieldCoverage: percentScore(field),
    evidencePrecision: round(precision, 4),
    evidenceCoverage: percentScore(evidence),
    overallScore: percentScore(overall),
  }
}

function buildCaseResult(evaluationCase: EvaluationCase, baseline: AgentModeReport | null, upgraded: AgentModeReport | null): EvaluationCaseResult {
  const gold = evaluationCase.gold ?? {
    expectedFields: [],
    expectedSemanticUnits: [],
    expectedEvidenceRefs: [],
    expectedRelations: [],
    expectedWikiPages: [],
    expectedStrategyCards: [],
  }
  const baselineScore = scoreCaseSide(baseline, gold)
  const upgradedScore = scoreCaseSide(upgraded, gold)
  const layerMetrics: EvaluationLayerMetrics = {
    parsingQuality: pair(baselineScore.parsingQuality, upgradedScore.parsingQuality),
    semanticQuality: pair(baselineScore.semanticQuality, upgradedScore.semanticQuality),
    evidenceQuality: pair(baselineScore.evidenceQuality, upgradedScore.evidenceQuality),
    wikiStrategyQuality: pair(baselineScore.wikiStrategyQuality, upgradedScore.wikiStrategyQuality),
    agentQaQuality: pair(baselineScore.agentQaQuality, upgradedScore.agentQaQuality),
  }
  const regressions: string[] = []
  for (const [key, metric] of Object.entries(layerMetrics)) {
    if (metric.delta < -5) regressions.push(`${key} regressed by ${Math.abs(metric.delta)} points`)
  }
  if (upgradedScore.evidencePrecision < 0.8 && (gold.expectedEvidenceRefs ?? []).length > 0) {
    regressions.push("evidence precision below 0.8")
  }
  const delta = round(upgradedScore.overallScore - baselineScore.overallScore, 2)
  const findings = [
    `字段覆盖率 ${baselineScore.fieldCoverage}% -> ${upgradedScore.fieldCoverage}%`,
    `证据 precision ${baselineScore.evidencePrecision} -> ${upgradedScore.evidencePrecision}`,
    `语义层 ${baselineScore.semanticQuality}% -> ${upgradedScore.semanticQuality}%`,
  ]
  return {
    caseId: evaluationCase.caseId,
    sceneId: evaluationCase.sceneId,
    baselineScore: baselineScore.overallScore,
    upgradedScore: upgradedScore.overallScore,
    delta,
    layerMetrics,
    evidencePrecision: pair(baselineScore.evidencePrecision, upgradedScore.evidencePrecision),
    fieldCoverage: pair(baselineScore.fieldCoverage, upgradedScore.fieldCoverage),
    findings,
    regressions,
    recommendation: delta >= 20 && regressions.length === 0 ? "升级效果明显，可进入下一轮扩大评估。" : "升级收益不足或存在回归，需要继续修正。",
  }
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return round(values.reduce((sum, item) => sum + item, 0) / values.length, 2)
}

function aggregatePair(results: EvaluationCaseResult[], pick: (result: EvaluationCaseResult) => MetricPair): MetricPair {
  return pair(
    average(results.map((result) => pick(result).baseline)),
    average(results.map((result) => pick(result).upgraded)),
  )
}

function aggregateMetrics(results: EvaluationCaseResult[]): EvaluationAggregateMetrics {
  const layerMetrics: EvaluationLayerMetrics = {
    parsingQuality: aggregatePair(results, (result) => result.layerMetrics.parsingQuality),
    semanticQuality: aggregatePair(results, (result) => result.layerMetrics.semanticQuality),
    evidenceQuality: aggregatePair(results, (result) => result.layerMetrics.evidenceQuality),
    wikiStrategyQuality: aggregatePair(results, (result) => result.layerMetrics.wikiStrategyQuality),
    agentQaQuality: aggregatePair(results, (result) => result.layerMetrics.agentQaQuality),
  }
  return {
    ...layerMetrics,
    overallScore: pair(
      average(results.map((result) => result.baselineScore)),
      average(results.map((result) => result.upgradedScore)),
    ),
    evidence: {
      precision: aggregatePair(results, (result) => result.evidencePrecision),
      coverage: layerMetrics.evidenceQuality,
    },
    fieldCoverage: aggregatePair(results, (result) => result.fieldCoverage),
  }
}

function recommendedFixesFor(results: EvaluationCaseResult[]): string[] {
  const fixes: string[] = []
  if (results.some((result) => result.layerMetrics.semanticQuality.upgraded < 70)) {
    fixes.push("优先检查语义单元边界和字段匹配，避免生成更多但不可用的语义单元。")
  }
  if (results.some((result) => result.evidencePrecision.upgraded < 0.8)) {
    fixes.push("补强 schema-guided evidence map，确保字段证据引用真实命中 gold refs。")
  }
  if (results.some((result) => result.layerMetrics.agentQaQuality.upgraded < 70)) {
    fixes.push("检查策略卡、Skill 和问答图片证据是否消费了语义单元与 evidence refs。")
  }
  return fixes.length > 0 ? fixes : ["暂无 P0 修复项，可扩大评测集继续验证。"]
}

export function buildSemanticUpgradeEvaluationReport(input: BuildSemanticUpgradeEvaluationReportInput): EvaluationRunReport {
  const generatedAt = input.generatedAt ?? new Date().toISOString()
  const caseResults = input.cases.map((evaluationCase) => buildCaseResult(
    evaluationCase,
    reportForCase(input.baselineReports, evaluationCase),
    reportForCase(input.upgradedReports, evaluationCase),
  ))
  const regressions = caseResults.flatMap((result) => result.regressions.map((item) => `${result.caseId}: ${item}`))
  return {
    runId: input.runId,
    mode: input.mode ?? "compare",
    baselineVersion: input.baselineVersion ?? "baseline",
    upgradedVersion: input.upgradedVersion ?? "upgraded",
    generatedAt,
    caseResults,
    aggregateMetrics: aggregateMetrics(caseResults),
    regressions,
    recommendedFixes: recommendedFixesFor(caseResults),
  }
}

function renderDelta(metric: MetricPair): string {
  const sign = metric.delta > 0 ? "+" : ""
  return `${metric.baseline} -> ${metric.upgraded} (${sign}${metric.delta})`
}

export function renderSemanticUpgradeScorecard(report: EvaluationRunReport): string {
  return [
    "# 语义单元升级评估",
    "",
    `- runId: ${report.runId}`,
    `- mode: ${report.mode}`,
    `- baseline: ${report.baselineVersion}`,
    `- upgraded: ${report.upgradedVersion}`,
    `- generatedAt: ${report.generatedAt}`,
    "",
    "## 总览",
    "",
    `- 端到端总分：${renderDelta(report.aggregateMetrics.overallScore)}`,
    `- 解析质量：${renderDelta(report.aggregateMetrics.parsingQuality)}`,
    `- 语义单元质量：${renderDelta(report.aggregateMetrics.semanticQuality)}`,
    `- 证据映射质量：${renderDelta(report.aggregateMetrics.evidenceQuality)}`,
    `- Wiki/策略产物质量：${renderDelta(report.aggregateMetrics.wikiStrategyQuality)}`,
    `- Agent/问答可用性：${renderDelta(report.aggregateMetrics.agentQaQuality)}`,
    `- 证据 precision：${renderDelta(report.aggregateMetrics.evidence.precision)}`,
    `- 字段覆盖率：${renderDelta(report.aggregateMetrics.fieldCoverage)}`,
    "",
    "## 回归与建议",
    "",
    ...(report.regressions.length > 0 ? report.regressions.map((item) => `- ${item}`) : ["- 无 P0 回归"]),
    "",
    ...report.recommendedFixes.map((item) => `- ${item}`),
  ].join("\n")
}

function renderCaseDiff(result: EvaluationCaseResult): string {
  return [
    `# Case Diff: ${result.caseId}`,
    "",
    `- sceneId: ${result.sceneId}`,
    `- overall: ${result.baselineScore} -> ${result.upgradedScore} (${result.delta >= 0 ? "+" : ""}${result.delta})`,
    `- recommendation: ${result.recommendation}`,
    "",
    "## Layer Metrics",
    "",
    `- parsing: ${renderDelta(result.layerMetrics.parsingQuality)}`,
    `- semantic: ${renderDelta(result.layerMetrics.semanticQuality)}`,
    `- evidence: ${renderDelta(result.layerMetrics.evidenceQuality)}`,
    `- wiki/strategy: ${renderDelta(result.layerMetrics.wikiStrategyQuality)}`,
    `- agent/qa: ${renderDelta(result.layerMetrics.agentQaQuality)}`,
    "",
    "## Findings",
    "",
    ...result.findings.map((item) => `- ${item}`),
    "",
    "## Regressions",
    "",
    ...(result.regressions.length > 0 ? result.regressions.map((item) => `- ${item}`) : ["- 无"]),
  ].join("\n")
}

export async function runSemanticUpgradeEval(projectPath: string, input: RunSemanticUpgradeEvalInput): Promise<RunSemanticUpgradeEvalResult> {
  const pp = normalizePath(projectPath)
  const report = buildSemanticUpgradeEvaluationReport(input)
  const outputDir = `${pp}/.llm-wiki/evals/${input.runId}`
  await createDirectory(outputDir)
  await createDirectory(`${outputDir}/case-diffs`)
  await writeFile(`${outputDir}/metrics.json`, JSON.stringify(report, null, 2))
  await writeFile(`${outputDir}/scorecard.md`, renderSemanticUpgradeScorecard(report))
  for (const result of report.caseResults) {
    await writeFile(`${outputDir}/case-diffs/${result.caseId}.md`, renderCaseDiff(result))
  }
  return { outputDir, report }
}

function resolveProjectPath(projectPath: string, candidate: string): string {
  const normalized = normalizePath(candidate)
  if (/^\/|^[A-Za-z]:\//.test(normalized)) return normalized
  return `${normalizePath(projectPath)}/${normalized.replace(/^\.?\//, "")}`
}

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T
  } catch (error) {
    throw new Error(`failed_to_parse_semantic_eval_json:${label}:${error instanceof Error ? error.message : String(error)}`)
  }
}

async function readReportsFromPaths(projectPath: string, paths: string[] | undefined): Promise<AgentModeReport[]> {
  const reports: AgentModeReport[] = []
  for (const path of paths ?? []) {
    const resolved = resolveProjectPath(projectPath, path)
    const parsed = parseJson<AgentModeReport | AgentModeReport[]>(await readFile(resolved), resolved)
    reports.push(...(Array.isArray(parsed) ? parsed : [parsed]))
  }
  return reports
}

export async function runSemanticUpgradeEvalFromFiles(
  projectPath: string,
  casesPath: string,
  mode: "baseline" | "upgraded" | "compare",
  options: {
    runId?: string
    baselineVersion?: string
    upgradedVersion?: string
    generatedAt?: string
  } = {},
): Promise<RunSemanticUpgradeEvalResult> {
  const resolvedCasesPath = resolveProjectPath(projectPath, casesPath)
  const casesFile = parseJson<EvaluationCasesFile>(await readFile(resolvedCasesPath), resolvedCasesPath)
  return runSemanticUpgradeEval(projectPath, {
    runId: options.runId ?? casesFile.runId ?? `semantic-eval-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    mode,
    cases: casesFile.cases,
    baselineReports: await readReportsFromPaths(projectPath, casesFile.baselineReportPaths),
    upgradedReports: await readReportsFromPaths(projectPath, casesFile.upgradedReportPaths),
    baselineVersion: options.baselineVersion ?? casesFile.baselineVersion ?? "baseline",
    upgradedVersion: options.upgradedVersion ?? casesFile.upgradedVersion ?? "upgraded",
    generatedAt: options.generatedAt,
  })
}
