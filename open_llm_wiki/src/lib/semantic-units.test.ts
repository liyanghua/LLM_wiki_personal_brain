import { afterEach, describe, expect, it, vi } from "vitest"
import { realFs, createTempProject, readFileRaw } from "@/test-helpers/fs-temp"
import type { AgentModeReport } from "@/lib/agent-mode-types"
import {
  buildSemanticUnitIndex,
  buildSemanticConflictReviewItems,
  loadSemanticUnitIndex,
  saveSemanticUnitIndex,
  semanticContextForQuery,
} from "@/lib/semantic-units"

vi.mock("@/commands/fs", () => realFs)

let cleanup: (() => Promise<void>) | null = null

function makeReport(overrides: Partial<AgentModeReport> = {}): AgentModeReport {
  const now = "2026-05-10T00:00:00.000Z"
  const docId = overrides.docId ?? "doc-a"
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
    qualityScore: 80,
    qualitySummary: "ok",
    sourceHealth: {
      score: 80,
      status: "healthy",
      summary: "ok",
      dimensions: [],
      updatedAt: now,
    },
    publishGate: {
      gateKey: "revision_publish",
      mode: "soft",
      status: "pass",
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
      qualityScore: 80,
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

afterEach(async () => {
  if (cleanup) {
    await cleanup()
    cleanup = null
  }
})

describe("semantic unit index", () => {
  it("links equivalent rules as support without creating conflict reviews", async () => {
    const tmp = await createTempProject("semantic-support")
    cleanup = tmp.cleanup
    const reportA = makeReport({
      docId: "doc-a",
      groundTruth: {
        ...makeReport({ docId: "doc-a" }).groundTruth,
        fields: [{
          key: "decision_rules",
          label: "判断规则",
          value: "点击率低时优先检查主图素材表达。",
          evidenceBlockRefs: ["a-rule"],
          status: "confirmed",
          lastUpdatedAt: "2026-05-10T00:00:00.000Z",
          updatedFromCardId: null,
          acceptedPatchIds: [],
        }],
      },
    })
    const reportB = makeReport({
      docId: "doc-b",
      groundTruth: {
        ...makeReport({ docId: "doc-b" }).groundTruth,
        fields: [{
          key: "decision_rules",
          label: "判断规则",
          value: "点击率偏低，先排查主图素材表达是否弱。",
          evidenceBlockRefs: ["b-rule"],
          status: "confirmed",
          lastUpdatedAt: "2026-05-10T00:00:00.000Z",
          updatedFromCardId: null,
          acceptedPatchIds: [],
        }],
      },
    })

    const index = buildSemanticUnitIndex([reportA, reportB])
    await saveSemanticUnitIndex(tmp.path, index)
    const loaded = await loadSemanticUnitIndex(tmp.path)
    const reviews = buildSemanticConflictReviewItems(loaded)

    expect(loaded.units).toHaveLength(2)
    expect(loaded.relations.some((relation) => relation.relationType === "supports")).toBe(true)
    expect(loaded.relations.some((relation) => relation.relationType === "contradicts")).toBe(false)
    expect(reviews).toEqual([])
    expect(await readFileRaw(`${tmp.path}/.llm-wiki/semantic-units/index.json`)).toContain("semantic_units_v1")
  })

  it("does not crash on legacy reports missing compileIr field evidence maps", () => {
    const compileIr = {
      ...makeReport().compileIr,
      sourceRefsByField: {
        decision_rules: ["source-rule-ref"],
      },
    } as Partial<AgentModeReport["compileIr"]>
    delete compileIr.fieldEvidenceMap
    const report = makeReport({
      groundTruth: {
        ...makeReport().groundTruth,
        fields: [{
          key: "decision_rules",
          label: "判断规则",
          value: "点击率低时优先检查主图素材表达。",
          evidenceBlockRefs: ["field-rule-ref"],
          status: "confirmed",
          lastUpdatedAt: "2026-05-10T00:00:00.000Z",
          updatedFromCardId: null,
          acceptedPatchIds: [],
        }],
      },
      compileIr: compileIr as AgentModeReport["compileIr"],
    })

    const index = buildSemanticUnitIndex([report])

    expect(index.units).toHaveLength(1)
    expect(index.units[0]?.evidenceRefs).toContain("field-rule-ref")
    expect(index.units[0]?.evidenceRefs).toContain("source-rule-ref")
  })

  it("creates contradiction relation and review payload when metric thresholds disagree", () => {
    const reportA = makeReport({
      docId: "doc-a",
      groundTruth: {
        ...makeReport({ docId: "doc-a" }).groundTruth,
        fields: [{
          key: "metric_signals",
          label: "指标",
          value: "点击率低于 3% 时判定主图吸引力不足。",
          evidenceBlockRefs: ["a-metric"],
          status: "confirmed",
          lastUpdatedAt: "2026-05-10T00:00:00.000Z",
          updatedFromCardId: null,
          acceptedPatchIds: [],
        }],
      },
    })
    const reportB = makeReport({
      docId: "doc-b",
      groundTruth: {
        ...makeReport({ docId: "doc-b" }).groundTruth,
        fields: [{
          key: "metric_signals",
          label: "指标",
          value: "点击率低于 5% 时才需要判定主图吸引力不足。",
          evidenceBlockRefs: ["b-metric"],
          status: "confirmed",
          lastUpdatedAt: "2026-05-10T00:00:00.000Z",
          updatedFromCardId: null,
          acceptedPatchIds: [],
        }],
      },
    })

    const index = buildSemanticUnitIndex([reportA, reportB])
    const reviews = buildSemanticConflictReviewItems(index)

    expect(index.relations).toHaveLength(1)
    expect(index.relations[0]?.relationType).toBe("contradicts")
    expect(index.relations[0]?.status).toBe("pending_review")
    expect(reviews).toHaveLength(1)
    expect(reviews[0]?.type).toBe("contradiction")
    expect(reviews[0]?.semanticUnitIds).toHaveLength(2)
    expect(reviews[0]?.semanticRelationIds).toEqual([index.relations[0]?.relationId])
    expect(reviews[0]?.conflictType).toBe("contradicts")
  })

  it("marks scope differences separately from hard contradictions", () => {
    const reportA = makeReport({
      docId: "doc-a",
      groundTruth: {
        ...makeReport({ docId: "doc-a" }).groundTruth,
        fields: [{
          key: "decision_rules",
          label: "判断规则",
          value: "开学季点击率低于 3% 时优先检查主图素材。",
          evidenceBlockRefs: ["a-scope"],
          status: "confirmed",
          lastUpdatedAt: "2026-05-10T00:00:00.000Z",
          updatedFromCardId: null,
          acceptedPatchIds: [],
        }],
      },
    })
    const reportB = makeReport({
      docId: "doc-b",
      groundTruth: {
        ...makeReport({ docId: "doc-b" }).groundTruth,
        fields: [{
          key: "decision_rules",
          label: "判断规则",
          value: "大促场景点击率低于 5% 时优先检查主图素材。",
          evidenceBlockRefs: ["b-scope"],
          status: "confirmed",
          lastUpdatedAt: "2026-05-10T00:00:00.000Z",
          updatedFromCardId: null,
          acceptedPatchIds: [],
        }],
      },
    })

    const index = buildSemanticUnitIndex([reportA, reportB])

    expect(index.relations).toHaveLength(1)
    expect(index.relations[0]?.relationType).toBe("scope_differs")
    expect(index.relations[0]?.status).toBe("active")
  })

  it("formats semantic context for knowledge answers with support and conflict signals", () => {
    const reportA = makeReport({
      docId: "doc-a",
      sourceName: "主图A.docx",
      groundTruth: {
        ...makeReport({ docId: "doc-a" }).groundTruth,
        fields: [{
          key: "decision_rules",
          label: "判断规则",
          value: "点击率低时优先检查主图素材表达。",
          evidenceBlockRefs: ["a-rule"],
          status: "confirmed",
          lastUpdatedAt: "2026-05-10T00:00:00.000Z",
          updatedFromCardId: null,
          acceptedPatchIds: [],
        }],
      },
    })
    const reportB = makeReport({
      docId: "doc-b",
      sourceName: "主图B.docx",
      groundTruth: {
        ...makeReport({ docId: "doc-b" }).groundTruth,
        fields: [{
          key: "decision_rules",
          label: "判断规则",
          value: "点击率偏低，先排查主图素材表达是否弱。",
          evidenceBlockRefs: ["b-rule"],
          status: "confirmed",
          lastUpdatedAt: "2026-05-10T00:00:00.000Z",
          updatedFromCardId: null,
          acceptedPatchIds: [],
        }],
      },
    })
    const index = buildSemanticUnitIndex([reportA, reportB])

    const context = semanticContextForQuery(index, "点击率低如何提升主图细节")

    expect(context).toContain("## Semantic Unit Evidence")
    expect(context).toContain("主图A.docx")
    expect(context).toContain("主图B.docx")
    expect(context).toContain("supports")
  })
})
