import { afterEach, describe, expect, it, vi } from "vitest"
import { createTempProject, fileExists, readFileRaw, realFs } from "@/test-helpers/fs-temp"
import type { AgentModeReport } from "@/lib/agent-mode-types"
import {
  buildSemanticUpgradeEvaluationReport,
  runSemanticUpgradeEval,
  runSemanticUpgradeEvalFromFiles,
  type EvaluationCase,
  type GoldAnnotation,
} from "@/lib/semantic-upgrade-eval"

vi.mock("@/commands/fs", () => realFs)

let cleanup: (() => Promise<void>) | null = null

function makeReport(overrides: Partial<AgentModeReport> = {}): AgentModeReport {
  const now = "2026-05-14T00:00:00.000Z"
  const docId = overrides.docId ?? "doc-hero"
  const sourceName = overrides.sourceName ?? `${docId}.docx`
  return {
    docId,
    sourceKind: "docx",
    sourceName,
    sourcePath: `/tmp/${sourceName}`,
    sourceContent: "source",
    sceneId: "ecom_growth_hero_image",
    generatedAt: now,
    analysis: "analysis",
    documentIr: {
      docId,
      sourceName,
      sourcePath: `/tmp/${sourceName}`,
      createdAt: now,
      blocks: [],
    },
    understanding: {
      title: sourceName,
      summary: "主图优化文档",
      mainlineSteps: [],
      sopSteps: [],
      keyJudgements: [],
      businessRules: [],
      decisionPoints: [],
      entityCandidates: [],
      businessObjects: [],
      businessRelations: [],
      evidenceHighlights: [],
      imageEvidenceHighlights: [],
      mindmapSummary: [],
      terminology: [],
      risks: [],
      openQuestions: [],
      missingFieldKeys: [],
    },
    groundTruth: {
      docId,
      sceneId: "ecom_growth_hero_image",
      title: sourceName,
      fields: [],
      mainlineSteps: [],
      keyJudgements: [],
      boundaries: [],
      evidenceNotes: [],
      evaluationContentPath: "",
      revisionCount: 0,
      lastAcceptedCardId: null,
      updatedAt: now,
      lastUpdatedAt: now,
    },
    fieldAssessments: [],
    blockAssessments: [],
    revisionIssueCards: [],
    reviewSummary: {
      highPriorityCount: 0,
      mediumPriorityCount: 0,
      lowPriorityCount: 0,
      criticalThemes: [],
      nextBestAction: "确认",
    },
    activeCriticalCardIds: [],
    improvementTasks: [],
    qualityScore: 70,
    qualitySummary: "ok",
    sourceHealth: {
      score: 70,
      status: "watch",
      summary: "ok",
      dimensions: [],
      updatedAt: now,
    },
    publishGate: {
      gateKey: "revision_publish",
      mode: "soft",
      status: "warn",
      canPublish: true,
      overrideRequired: false,
      summary: "ok",
      rules: [],
      generatedAt: now,
    },
    warnings: [],
    llmEnhanced: false,
    supportingWikiPages: [],
    compileSidecar: {
      docId,
      compileMode: "two-stage+structuring",
      sourcePath: `/tmp/${sourceName}`,
      sourceName,
      structuredContext: "",
      generatedAt: now,
      qualityScore: 70,
      warnings: [],
    },
    compilePlan: {
      docId,
      sceneId: "ecom_growth_hero_image",
      compileMode: "scene_business_dominant",
      pagePlans: [],
      sectionMappings: {},
      fieldToPageMap: {},
      requiredFieldKeys: [],
    },
    compileCoverage: {
      docId,
      generatedAt: now,
      entries: [],
    },
    compileIr: {
      sourceSummary: "主图优化",
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
      openQuestions: [],
      sourceRefsByField: {},
    },
    strategyBundle: null,
    strategyCoverage: null,
    confirmedStrategyCardIds: [],
    documentBackend: "docx_enhanced",
    documentBackendStatus: {
      mode: "docx_enhanced",
      status: "ready",
      detail: "ready",
      degraded: false,
    },
    documentArtifacts: null,
    pdfArtifacts: null,
    ...overrides,
  }
}

const gold: GoldAnnotation = {
  expectedFields: [
    { key: "target_audiences", required: true },
    { key: "creative_assets", required: true },
    { key: "decision_rules", required: true },
  ],
  expectedSemanticUnits: [
    { unitType: "claim", text: "儿童学习桌垫家长", targetFieldKey: "target_audiences" },
    { unitType: "rule", text: "点击率低时优先检查主图素材", targetFieldKey: "decision_rules" },
  ],
  expectedEvidenceRefs: [
    { fieldKey: "target_audiences", refs: ["block-audience-1"] },
    { fieldKey: "decision_rules", refs: ["block-rule-1"] },
  ],
  expectedRelations: [{ relationType: "supports" }],
  expectedWikiPages: ["wiki/business/主图设计/素材与版式.md"],
  expectedStrategyCards: [{ category: "creative_asset_brief_generation" }],
  expectedQueries: [
    { query: "如何提升主图设计细节", expectedEvidenceRefs: ["image-hero-1"], expectedImageRefs: ["media/hero/img-1.png"] },
  ],
  expectedAgentTasks: [
    { skillFamily: "creative_asset_brief_generation", expectedEvidenceRefs: ["block-rule-1"] },
  ],
}

const evaluationCase: EvaluationCase = {
  caseId: "hero-image-details",
  sourcePaths: ["/tmp/主图设计.docx"],
  sceneId: "ecom_growth_hero_image",
  taskTypes: ["wiki_compile", "strategy", "agent", "qa"],
  goldAnnotationPath: "gold/hero-image-details.json",
  gold,
  expectedQueries: gold.expectedQueries,
  expectedAgentTasks: gold.expectedAgentTasks,
}

afterEach(async () => {
  if (cleanup) {
    await cleanup()
    cleanup = null
  }
})

describe("semantic upgrade evaluation", () => {
  it("scores upgraded reports higher when semantic units, evidence, strategy and QA evidence improve", () => {
    const baseline = makeReport({
      qualityScore: 55,
      documentIr: {
        docId: "doc-hero",
        sourceName: "主图设计.docx",
        sourcePath: "/tmp/主图设计.docx",
        createdAt: "2026-05-14T00:00:00.000Z",
        blocks: [
          { blockId: "block-audience-1", blockType: "paragraph", textContent: "儿童学习桌垫家长", parentBlockId: null, childBlockIds: [], sourceRefs: ["/tmp/主图设计.docx"], headingPath: [], lineStart: 1, lineEnd: 1 },
        ],
      },
      groundTruth: {
        ...makeReport().groundTruth,
        fields: [
          { key: "target_audiences", label: "目标人群", value: "儿童学习桌垫家长", evidenceBlockRefs: ["block-audience-1"], status: "confirmed", lastUpdatedAt: "2026-05-14T00:00:00.000Z", updatedFromCardId: null, acceptedPatchIds: [] },
        ],
      },
      compileIr: {
        ...makeReport().compileIr,
        fieldValueMap: { target_audiences: "儿童学习桌垫家长" },
        fieldEvidenceMap: { target_audiences: ["block-audience-1"] },
      },
    })
    const upgraded = makeReport({
      qualityScore: 88,
      documentIr: {
        docId: "doc-hero",
        sourceName: "主图设计.docx",
        sourcePath: "/tmp/主图设计.docx",
        createdAt: "2026-05-14T00:00:00.000Z",
        blocks: [
          { blockId: "block-audience-1", blockType: "paragraph", textContent: "儿童学习桌垫家长", parentBlockId: null, childBlockIds: [], sourceRefs: ["/tmp/主图设计.docx"], headingPath: ["人群"], lineStart: 1, lineEnd: 1, sourceAnchorId: "anchor-audience" },
          { blockId: "block-asset-1", blockType: "image", textContent: "主图细节图案例", parentBlockId: null, childBlockIds: [], sourceRefs: ["/tmp/主图设计.docx"], headingPath: ["素材与版式"], lineStart: 2, lineEnd: 2, assetPath: "media/hero/img-1.png", evidenceKind: "image", sourceAnchorId: "image-hero-1" },
          { blockId: "block-rule-1", blockType: "paragraph", textContent: "点击率低时优先检查主图素材表达", parentBlockId: null, childBlockIds: [], sourceRefs: ["/tmp/主图设计.docx"], headingPath: ["判断规则"], lineStart: 3, lineEnd: 3, sourceAnchorId: "anchor-rule" },
        ],
      },
      groundTruth: {
        ...makeReport().groundTruth,
        fields: [
          { key: "target_audiences", label: "目标人群", value: "儿童学习桌垫家长", semanticUnitIds: ["sem-audience"], evidenceBlockRefs: ["block-audience-1"], status: "confirmed", lastUpdatedAt: "2026-05-14T00:00:00.000Z", updatedFromCardId: null, acceptedPatchIds: [] },
          { key: "creative_assets", label: "素材与版式", value: "主图细节图案例", semanticUnitIds: ["sem-asset"], evidenceBlockRefs: ["block-asset-1"], status: "confirmed", lastUpdatedAt: "2026-05-14T00:00:00.000Z", updatedFromCardId: null, acceptedPatchIds: [] },
          { key: "decision_rules", label: "判断规则", value: "点击率低时优先检查主图素材表达", semanticUnitIds: ["sem-rule"], evidenceBlockRefs: ["block-rule-1"], status: "confirmed", lastUpdatedAt: "2026-05-14T00:00:00.000Z", updatedFromCardId: null, acceptedPatchIds: [] },
        ],
      },
      compileCoverage: {
        docId: "doc-hero",
        generatedAt: "2026-05-14T00:00:00.000Z",
        entries: [
          { fieldKey: "target_audiences", label: "目标人群", written: true, pageKey: "hero_audiences", pagePath: "wiki/business/主图设计/人群.md", sectionKey: "target_audiences", evidenceRefs: ["block-audience-1"], rootCause: "written" },
          { fieldKey: "creative_assets", label: "素材与版式", written: true, pageKey: "hero_creative_assets", pagePath: "wiki/business/主图设计/素材与版式.md", sectionKey: "creative_assets", evidenceRefs: ["block-asset-1"], rootCause: "written" },
          { fieldKey: "decision_rules", label: "判断规则", written: true, pageKey: "hero_metric_judgement", pagePath: "wiki/business/主图设计/指标判断.md", sectionKey: "decision_rules", evidenceRefs: ["block-rule-1"], rootCause: "written" },
        ],
      },
      compileIr: {
        ...makeReport().compileIr,
        consumedSemanticUnitIds: ["sem-audience", "sem-asset", "sem-rule"],
        unresolvedSemanticRelationIds: ["semrel_supports_a"],
        fieldValueMap: {
          target_audiences: "儿童学习桌垫家长",
          creative_assets: "主图细节图案例",
          decision_rules: "点击率低时优先检查主图素材表达",
        },
        fieldEvidenceMap: {
          target_audiences: ["block-audience-1"],
          creative_assets: ["block-asset-1"],
          decision_rules: ["block-rule-1"],
        },
        sourceRefsByField: {
          target_audiences: ["/tmp/主图设计.docx"],
          creative_assets: ["/tmp/主图设计.docx"],
          decision_rules: ["/tmp/主图设计.docx"],
        },
        imageEvidenceRefs: [{ imageId: "image-hero-1", url: "media/hero/img-1.png", caption: "主图细节图案例", sourceRef: "/tmp/主图设计.docx" }],
      },
      strategyBundle: {
        bundleId: "bundle-hero",
        docId: "doc-hero",
        sceneId: "ecom_growth_hero_image",
        title: "主图策略",
        summary: "ok",
        strategyMarkdown: "",
        strategyCards: [],
        actionCards: [
          { actionCardId: "action-1", fingerprint: "fp", sceneId: "ecom_growth_hero_image", docId: "doc-hero", category: "creative_asset_brief_generation", title: "素材表达", triggerCondition: "CTR低", requiredInputs: ["当前主图"], actionSteps: ["检查素材表达"], outputArtifact: "主图brief", validationMetrics: ["点击率"], evidenceRefs: ["block-rule-1"], semanticUnitIds: ["sem-rule"], wikiRefs: ["wiki/business/主图设计/素材与版式.md"], missingInputs: [], confidence: 0.88, skillFamily: "creative_asset_brief_generation", sourceFieldKeys: ["creative_assets", "decision_rules"], status: "draft", createdAt: "2026-05-14T00:00:00.000Z", updatedAt: "2026-05-14T00:00:00.000Z" },
        ],
        linkedResearchFindingIds: [],
        linkedRevisionCardIds: [],
        linkedWikiRefs: ["wiki/business/主图设计/素材与版式.md"],
        evidenceRefs: ["block-rule-1"],
        consumedSemanticUnitIds: ["sem-rule"],
        unresolvedSemanticRelationIds: [],
        generatedAt: "2026-05-14T00:00:00.000Z",
      },
    })

    const report = buildSemanticUpgradeEvaluationReport({
      runId: "eval-test",
      cases: [evaluationCase],
      baselineReports: [baseline],
      upgradedReports: [upgraded],
      baselineVersion: "baseline",
      upgradedVersion: "upgraded",
      generatedAt: "2026-05-14T00:00:00.000Z",
    })

    expect(report.aggregateMetrics.overallScore.delta).toBeGreaterThan(20)
    expect(report.aggregateMetrics.evidence.precision.upgraded).toBeGreaterThanOrEqual(0.8)
    expect(report.caseResults[0]?.recommendation).toContain("升级")
    expect(report.regressions).toEqual([])
  })

  it("writes metrics, scorecard and case diffs under .llm-wiki/evals only", async () => {
    const tmp = await createTempProject("semantic-eval")
    cleanup = tmp.cleanup
    const baseline = makeReport({ qualityScore: 60 })
    const upgraded = makeReport({ qualityScore: 80 })

    const result = await runSemanticUpgradeEval(tmp.path, {
      runId: "eval-001",
      mode: "compare",
      cases: [evaluationCase],
      baselineReports: [baseline],
      upgradedReports: [upgraded],
      baselineVersion: "baseline",
      upgradedVersion: "upgraded",
      generatedAt: "2026-05-14T00:00:00.000Z",
    })

    expect(result.outputDir).toBe(`${tmp.path}/.llm-wiki/evals/eval-001`)
    expect(await fileExists(`${result.outputDir}/metrics.json`)).toBe(true)
    expect(await fileExists(`${result.outputDir}/scorecard.md`)).toBe(true)
    expect(await fileExists(`${result.outputDir}/case-diffs/hero-image-details.md`)).toBe(true)
    expect(await fileExists(`${tmp.path}/wiki/scorecard.md`)).toBe(false)

    const metrics = JSON.parse(await readFileRaw(`${result.outputDir}/metrics.json`)) as { runId: string }
    const markdown = await readFileRaw(`${result.outputDir}/scorecard.md`)
    expect(metrics.runId).toBe("eval-001")
    expect(markdown).toContain("语义单元升级评估")
    expect(markdown).toContain("端到端总分")
  })

  it("loads cases and reports from a cases file for script-style execution", async () => {
    const tmp = await createTempProject("semantic-eval-files")
    cleanup = tmp.cleanup
    const baseline = makeReport({ qualityScore: 60 })
    const upgraded = makeReport({ qualityScore: 82 })
    await realFs.writeFile(`${tmp.path}/eval/baseline.json`, JSON.stringify([baseline], null, 2))
    await realFs.writeFile(`${tmp.path}/eval/upgraded.json`, JSON.stringify([upgraded], null, 2))
    await realFs.writeFile(`${tmp.path}/eval/cases.json`, JSON.stringify({
      runId: "eval-from-files",
      baselineVersion: "baseline-file",
      upgradedVersion: "upgraded-file",
      baselineReportPaths: ["eval/baseline.json"],
      upgradedReportPaths: ["eval/upgraded.json"],
      cases: [evaluationCase],
    }, null, 2))

    const result = await runSemanticUpgradeEvalFromFiles(tmp.path, `${tmp.path}/eval/cases.json`, "compare", {
      generatedAt: "2026-05-14T00:00:00.000Z",
    })

    expect(result.report.runId).toBe("eval-from-files")
    expect(result.report.baselineVersion).toBe("baseline-file")
    expect(result.report.upgradedVersion).toBe("upgraded-file")
    expect(await fileExists(`${tmp.path}/.llm-wiki/evals/eval-from-files/metrics.json`)).toBe(true)
  })
})
