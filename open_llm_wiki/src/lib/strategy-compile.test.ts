import { afterEach, describe, expect, it, vi } from "vitest"
import { realFs, createTempProject, readFileRaw, writeFileRaw } from "@/test-helpers/fs-temp"
import { ensureScenePack } from "@/lib/scene-pack"
import { writeStrategyBundle } from "@/lib/strategy-compile"
import { buildSceneCompileArtifacts, writeSceneCompile } from "@/lib/scene-compile"
import { buildOrRefreshImageIndex } from "@/lib/knowledge-image-index"
import { buildSemanticUnitIndex, saveSemanticUnitIndex } from "@/lib/semantic-units"
import type { AgentModeReport } from "@/lib/agent-mode-types"
import type { LlmConfig } from "@/stores/wiki-store"

vi.mock("@/commands/fs", () => realFs)

let currentLlmResponse = ""
vi.mock("@/lib/llm-client", () => ({
  streamChat: vi.fn(async (_cfg, msgs, cb) => {
    if (currentLlmResponse === "__AUTO_ASSET_PATCH__") {
      const content = String(msgs[1]?.content ?? "")
      const marker = "## Rule Candidate Action Cards\n"
      const cards = JSON.parse(content.slice(content.indexOf(marker) + marker.length)) as Array<{ actionCardId: string; category: string }>
      const assetCard = cards.find((card) => card.category === "creative_asset_brief_generation")
      cb.onToken(JSON.stringify({
        actionCards: [
          {
            actionCardId: assetCard?.actionCardId,
            triggerCondition: "当家长人群点击率低且护眼卖点没有被第一眼识别时",
            requiredInputs: ["目标人群", "护眼证明点", "当前主图截图"],
            actionSteps: [
              "确认目标人群是否为儿童学习桌垫家长。",
              "把护眼证明点压缩成首屏主文案。",
              "输出包含画面、文案、版式和验证指标的主图素材说明。",
            ],
            outputArtifact: "可交付设计的主图素材说明",
            validationMetrics: ["点击率", "转化率"],
            missingInputs: ["当前主图截图"],
            confidence: 0.88,
          },
        ],
      }))
    } else {
      cb.onToken(currentLlmResponse)
    }
    cb.onDone()
  }),
}))

let cleanup: (() => Promise<void>) | null = null

const fakeLlmConfig: LlmConfig = {
  provider: "openai",
  apiKey: "test-key",
  model: "gpt-4.1-mini",
  ollamaUrl: "http://localhost:11434",
  customEndpoint: "",
  maxContextSize: 128000,
}

function baseReport(): AgentModeReport {
  const now = "2026-05-10T00:00:00.000Z"
  return {
    docId: "doc-hero-sop",
    sourceKind: "docx",
    sourceName: "主图设计SOP.docx",
    sourcePath: "/tmp/主图设计SOP.docx",
    sourceContent: "主图设计 SOP",
    sceneId: "ecom_growth_hero_image",
    generatedAt: now,
    analysis: "analysis",
    documentIr: {
      docId: "doc-hero-sop",
      sourceName: "主图设计SOP.docx",
      sourcePath: "/tmp/主图设计SOP.docx",
      createdAt: now,
      blocks: [],
    },
    understanding: {
      title: "主图设计 SOP",
      summary: "围绕人群、卖点、素材和指标生成主图优化动作。",
      mainlineSteps: [],
      sopSteps: [],
      keyJudgements: [],
      businessRules: [],
      decisionPoints: [
        {
          title: "CTR 低优先排查素材表达",
          condition: "CTR 低于对照图",
          action: "先改主图视觉核心层和卖点表达",
          evidenceBlockRefs: ["block-metric-1"],
        },
      ],
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
      docId: "doc-hero-sop",
      sceneId: "ecom_growth_hero_image",
      title: "主图设计 SOP",
      fields: [
        {
          key: "target_audiences",
          label: "目标人群",
          value: "儿童学习桌垫的家长，关注护眼、防滑和学习效率。",
          evidenceBlockRefs: ["block-audience-1"],
          status: "confirmed",
          lastUpdatedAt: now,
          updatedFromCardId: null,
          acceptedPatchIds: [],
        },
        {
          key: "audience_situations",
          label: "人群场景",
          value: "开学季、家庭学习桌布置、家长替孩子选择学习用品。",
          evidenceBlockRefs: ["block-scene-1"],
          status: "confirmed",
          lastUpdatedAt: now,
          updatedFromCardId: null,
          acceptedPatchIds: [],
        },
        {
          key: "selling_points",
          label: "卖点",
          value: "护眼材质、防滑边缘、可擦写表面。",
          evidenceBlockRefs: ["block-value-1"],
          status: "confirmed",
          lastUpdatedAt: now,
          updatedFromCardId: null,
          acceptedPatchIds: [],
        },
        {
          key: "creative_assets",
          label: "素材",
          value: "纯色背景突出产品质感，三分构图承接护眼卖点，主图文案强调开学学习场景。",
          evidenceBlockRefs: ["block-asset-1"],
          status: "confirmed",
          lastUpdatedAt: now,
          updatedFromCardId: null,
          acceptedPatchIds: [],
        },
        {
          key: "metric_signals",
          label: "指标",
          value: "CTR 低说明第一眼停留不足，CVR 低说明卖点证明或价格带不匹配。",
          evidenceBlockRefs: ["block-metric-1"],
          status: "confirmed",
          lastUpdatedAt: now,
          updatedFromCardId: null,
          acceptedPatchIds: [],
        },
        {
          key: "action_playbook",
          label: "动作",
          value: "先改背景和主视觉，再调整卖点文案，最后用 A/B 测试验证 CTR 和 CVR。",
          evidenceBlockRefs: ["block-action-1"],
          status: "confirmed",
          lastUpdatedAt: now,
          updatedFromCardId: null,
          acceptedPatchIds: [],
        },
        {
          key: "decision_rules",
          label: "判断规则",
          value: "CTR 低先看素材，CVR 低再看卖点证明和价格带。",
          evidenceBlockRefs: ["block-rule-1"],
          status: "confirmed",
          lastUpdatedAt: now,
          updatedFromCardId: null,
          acceptedPatchIds: [],
        },
        {
          key: "experiment_evidence",
          label: "实验与证据",
          value: "每轮只测一个变量，保留对照组和样本周期。",
          evidenceBlockRefs: ["block-exp-1"],
          status: "confirmed",
          lastUpdatedAt: now,
          updatedFromCardId: null,
          acceptedPatchIds: [],
        },
      ],
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
      nextBestAction: "确认动作卡",
    },
    activeCriticalCardIds: [],
    improvementTasks: [],
    qualityScore: 80,
    qualitySummary: "可生成策略动作卡",
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
      docId: "doc-hero-sop",
      compileMode: "two-stage+structuring",
      sourcePath: "/tmp/主图设计SOP.docx",
      sourceName: "主图设计SOP.docx",
      structuredContext: "",
      generatedAt: now,
      qualityScore: 80,
      warnings: [],
    },
    compilePlan: {
      docId: "doc-hero-sop",
      sceneId: "ecom_growth_hero_image",
      compileMode: "scene_business_dominant",
      pagePlans: [],
      sectionMappings: {},
      fieldToPageMap: {},
      requiredFieldKeys: [],
    },
    compileCoverage: {
      docId: "doc-hero-sop",
      generatedAt: now,
      entries: [],
    },
    compileIr: {
      sourceSummary: "主图优化 SOP",
      mainlineSteps: [],
      sopSteps: [],
      keyJudgements: [],
      businessRules: [],
      decisionPoints: [],
      boundaries: [],
      evidenceCases: [],
      imageEvidence: [],
      metrics: ["CTR", "CVR"],
      keyEntities: [],
      businessObjects: [],
      businessRelations: [],
      fieldValueMap: {},
      fieldLabelMap: {},
      fieldEvidenceMap: {
        target_audiences: ["ir-audience-1"],
        creative_assets: ["ir-asset-1"],
        metric_signals: ["ir-metric-1"],
        action_playbook: ["ir-action-1"],
      },
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
  }
}

afterEach(async () => {
  currentLlmResponse = ""
  if (cleanup) {
    await cleanup()
    cleanup = null
  }
})

describe("writeStrategyBundle", () => {
  it("projects source image assets into hero-image business pages as markdown evidence", async () => {
    const tmp = await createTempProject("scene-image-evidence")
    cleanup = tmp.cleanup
    const report = baseReport()
    report.documentIr.blocks = [
      {
        blockId: "img-block-1",
        blockType: "image",
        textContent: "主图细节案例：材质纹理与卖点文案靠近展示",
        parentBlockId: null,
        childBlockIds: [],
        sourceRefs: [report.sourcePath],
        headingPath: ["素材案例"],
        lineStart: 1,
        lineEnd: 1,
        page: 3,
        bbox: null,
        readingOrder: 1,
        blockRole: "figure",
        ocrUsed: false,
        assetPath: `${tmp.path}/wiki/media/主图设计sop/img-1.png`,
        evidenceKind: "image",
        sourceAnchorId: "page-3-figure-1",
      },
    ]
    const scenePack = await ensureScenePack(tmp.path, { persistDefaults: true, defaultLanguage: "Chinese" })

    const artifacts = buildSceneCompileArtifacts(report, scenePack)
    await writeSceneCompile(tmp.path, report, scenePack)
    const creativeAssetsPage = await readFileRaw(`${tmp.path}/wiki/business/主图设计sop/素材与版式.md`)

    expect(artifacts.compileIr.imageEvidenceRefs?.[0]?.url).toBe("media/主图设计sop/img-1.png")
    expect(artifacts.compileIr.imageEvidenceRefs?.[0]?.caption).toContain("主图细节案例")
    expect(creativeAssetsPage).toContain("![主图细节案例：材质纹理与卖点文案靠近展示](media/主图设计sop/img-1.png)")
  })

  it("projects markdown image references when DocumentIR has no image block", async () => {
    const tmp = await createTempProject("scene-markdown-image-evidence")
    cleanup = tmp.cleanup
    const report = baseReport()
    report.sourceContent = [
      "# 主图设计 SOP",
      "",
      "![细节案例：主图展示材质纹理和第一眼卖点](media/主图设计sop/img-2.png)",
    ].join("\n")
    const scenePack = await ensureScenePack(tmp.path, { persistDefaults: true, defaultLanguage: "Chinese" })

    await writeSceneCompile(tmp.path, report, scenePack)
    const creativeAssetsPage = await readFileRaw(`${tmp.path}/wiki/business/主图设计sop/素材与版式.md`)

    expect(creativeAssetsPage).toContain("![细节案例：主图展示材质纹理和第一眼卖点](media/主图设计sop/img-2.png)")
  })

  it("projects top indexed images into hero-image pages when source image refs had empty alt text", async () => {
    const tmp = await createTempProject("scene-image-index-evidence")
    cleanup = tmp.cleanup
    const report = baseReport()
    report.sourceContent = "主图设计 SOP"
    await writeFileRaw(`${tmp.path}/wiki/sources/主图设计sop.md`, [
      "# Source: 主图设计SOP.docx",
      "",
      "本文档讲解主图点击率、卖点图、细节图和信任营销图。",
      "",
      "## Embedded Images",
      "",
      "### Page 1",
      "",
      "![](media/主图设计sop/img-1.png)",
    ].join("\n"))
    await writeFileRaw(`${tmp.path}/wiki/media/主图设计sop/img-1.png`, "fake image bytes")
    await buildOrRefreshImageIndex(tmp.path)
    const scenePack = await ensureScenePack(tmp.path, { persistDefaults: true, defaultLanguage: "Chinese" })

    await writeSceneCompile(tmp.path, report, scenePack)
    const creativeAssetsPage = await readFileRaw(`${tmp.path}/wiki/business/主图设计sop/素材与版式.md`)

    expect(creativeAssetsPage).toContain("![主图设计sop 第 1 页图片 1")
    expect(creativeAssetsPage).toContain("](media/主图设计sop/img-1.png)")
  })

  it("compiles schema and business wiki into executable action cards instead of raw field-copy cards", async () => {
    const tmp = await createTempProject("strategy-compile")
    cleanup = tmp.cleanup
    const report = baseReport()
    const scenePack = await ensureScenePack(tmp.path, { persistDefaults: true, defaultLanguage: "Chinese" })
    const docSlug = "主图设计sop"
    await writeFileRaw(
      `${tmp.path}/wiki/business/${docSlug}/人群与场景.md`,
      "# 人群与场景\n\n- 目标人群：儿童学习桌垫家长\n- 购物任务：开学季快速判断护眼和耐用性\n",
    )
    await writeFileRaw(
      `${tmp.path}/wiki/business/${docSlug}/卖点与表达.md`,
      "# 卖点与表达\n\n- 护眼材质需要用近景纹理和权威证明表达\n",
    )
    await writeFileRaw(
      `${tmp.path}/wiki/business/${docSlug}/素材与版式.md`,
      "# 素材与版式\n\n- 纯色背景突出产品质感\n- 三分构图搭配护眼卖点文案\n",
    )
    await writeFileRaw(
      `${tmp.path}/wiki/business/${docSlug}/指标与判断.md`,
      "# 指标与判断\n\n- CTR 低先检查第一眼视觉核心层\n- CVR 低再检查证明点和价格带\n",
    )
    await writeFileRaw(
      `${tmp.path}/wiki/business/${docSlug}/动作与实验.md`,
      "# 动作与实验\n\n- 第一轮只替换背景变量\n- 第二轮再测试卖点文案\n",
    )
    await writeFileRaw(
      `${tmp.path}/wiki/business/${docSlug}/证据与案例.md`,
      "# 证据与案例\n\n- 单因子测图需要保留对照组和样本周期\n",
    )

    const { bundle, coverage, writtenPaths } = await writeStrategyBundle(tmp.path, report, scenePack)

    expect(bundle.schemaVersion).toBe(2)
    expect(bundle.actionCards?.length).toBeGreaterThanOrEqual(6)
    const assetCard = bundle.actionCards?.find((card) => card.category === "creative_asset_brief_generation")
    expect(assetCard).toBeDefined()
    expect(assetCard?.triggerCondition).toContain("主图表达弱")
    expect(assetCard?.requiredInputs).toContain("核心卖点")
    expect(assetCard?.actionSteps.length).toBeGreaterThan(0)
    expect(assetCard?.title).toContain("素材表达：")
    expect(assetCard?.title).not.toContain("动作：")
    expect(assetCard?.outputArtifact).toBe("主图素材说明")
    expect(assetCard?.validationMetrics).toContain("点击率")
    expect(assetCard?.wikiRefs).toContain("wiki/business/主图设计sop/素材与版式.md")
    expect(assetCard?.evidenceRefs).toContain("block-asset-1")
    expect(assetCard?.evidenceRefs).toContain("ir-asset-1")
    expect(assetCard?.missingInputs).toContain("禁忌项")
    expect(bundle.strategyCards[0]?.recommendation).not.toBe(report.groundTruth.fields[0]?.value)
    expect(bundle.strategyMarkdown).toContain("## 可执行动作卡矩阵")
    expect(coverage.entries.some((entry) => entry.rootCause === "not_skill_ready")).toBe(true)
    const summaryMarkdown = await readFileRaw(`${tmp.path}/wiki/business/${docSlug}/策略总览.md`)
    expect(summaryMarkdown).toContain("产出物：主图素材说明")
    expect(summaryMarkdown).not.toMatch(/\bCTR\b|\bCVR\b|\bROI\b|generic|strategy-action/)
    expect(writtenPaths).toContain(`${tmp.path}/.llm-wiki/strategy-cards/doc-hero-sop.json`)
  })

  it("falls back to source refs when legacy reports do not include field evidence maps", async () => {
    const tmp = await createTempProject("strategy-legacy-evidence")
    cleanup = tmp.cleanup
    const report = baseReport()
    const compileIr = {
      ...report.compileIr,
      sourceRefsByField: {
        creative_assets: ["legacy-source-asset-ref"],
      },
    } as Partial<AgentModeReport["compileIr"]>
    delete compileIr.fieldEvidenceMap
    report.compileIr = compileIr as AgentModeReport["compileIr"]
    const scenePack = await ensureScenePack(tmp.path, { persistDefaults: true, defaultLanguage: "Chinese" })
    await writeFileRaw(
      `${tmp.path}/wiki/business/主图设计sop/素材与版式.md`,
      "# 素材与版式\n\n- 纯色背景突出产品质感。\n",
    )

    const { bundle } = await writeStrategyBundle(tmp.path, report, scenePack)
    const assetCard = bundle.actionCards?.find((card) => card.category === "creative_asset_brief_generation")

    expect(assetCard?.evidenceRefs).toContain("block-asset-1")
    expect(assetCard?.evidenceRefs).toContain("legacy-source-asset-ref")
  })

  it("preserves confirmed action card status by stable fingerprint after regeneration", async () => {
    const tmp = await createTempProject("strategy-status")
    cleanup = tmp.cleanup
    const report = baseReport()
    const scenePack = await ensureScenePack(tmp.path, { persistDefaults: true, defaultLanguage: "Chinese" })
    const docSlug = "主图设计sop"
    await writeFileRaw(`${tmp.path}/wiki/business/${docSlug}/素材与版式.md`, "# 素材与版式\n\n- 纯色背景突出产品质感\n")
    const first = await writeStrategyBundle(tmp.path, report, scenePack)
    const firstCard = first.bundle.actionCards?.find((card) => card.category === "creative_asset_brief_generation")
    expect(firstCard).toBeDefined()
    const confirmedBundle = {
      ...first.bundle,
      actionCards: first.bundle.actionCards?.map((card) =>
        card.actionCardId === firstCard?.actionCardId ? { ...card, status: "confirmed" as const } : card
      ),
    }
    await writeFileRaw(`${tmp.path}/.llm-wiki/strategy-cards/doc-hero-sop.json`, JSON.stringify(confirmedBundle, null, 2))

    const second = await writeStrategyBundle(tmp.path, report, scenePack)
    const regenerated = second.bundle.actionCards?.find((card) => card.fingerprint === firstCard?.fingerprint)

    expect(regenerated?.actionCardId).toBe(firstCard?.actionCardId)
    expect(regenerated?.status).toBe("confirmed")
  })

  it("downgrades previously confirmed action cards when semantic conflicts are unresolved", async () => {
    const tmp = await createTempProject("strategy-semantic-conflict")
    cleanup = tmp.cleanup
    const report = baseReport()
    report.groundTruth = {
      ...report.groundTruth,
      fields: report.groundTruth.fields.map((field) =>
        field.key === "metric_signals"
          ? {
              ...field,
              value: "CTR 低于 3% 时判定第一眼停留不足，CVR 低说明卖点证明或价格带不匹配。",
              evidenceBlockRefs: ["block-metric-1"],
            }
          : field
      ),
    }
    const conflictingReport = baseReport()
    conflictingReport.docId = "doc-conflicting-sop"
    conflictingReport.sourceName = "主图设计冲突SOP.docx"
    conflictingReport.groundTruth = {
      ...conflictingReport.groundTruth,
      docId: "doc-conflicting-sop",
      fields: conflictingReport.groundTruth.fields.map((field) =>
        field.key === "metric_signals"
          ? {
              ...field,
              value: "CTR 低于 5% 时才需要判定第一眼停留不足。",
              evidenceBlockRefs: ["conflict-metric-1"],
            }
          : field
      ),
    }
    await saveSemanticUnitIndex(tmp.path, buildSemanticUnitIndex([report, conflictingReport]))
    const scenePack = await ensureScenePack(tmp.path, { persistDefaults: true, defaultLanguage: "Chinese" })
    await writeFileRaw(`${tmp.path}/wiki/business/主图设计sop/指标与判断.md`, "# 指标与判断\n\n- CTR 低先检查第一眼视觉核心层。\n")

    const first = await writeStrategyBundle(tmp.path, report, scenePack)
    const metricCard = first.bundle.actionCards?.find((card) => card.category === "metric_signal_diagnosis")
    expect(metricCard?.blockedBySemanticRelationIds?.length).toBeGreaterThan(0)
    const confirmedBundle = {
      ...first.bundle,
      actionCards: first.bundle.actionCards?.map((card) =>
        card.actionCardId === metricCard?.actionCardId ? { ...card, status: "confirmed" as const } : card
      ),
    }
    await writeFileRaw(`${tmp.path}/.llm-wiki/strategy-cards/doc-hero-sop.json`, JSON.stringify(confirmedBundle, null, 2))

    const second = await writeStrategyBundle(tmp.path, report, scenePack)
    const regenerated = second.bundle.actionCards?.find((card) => card.actionCardId === metricCard?.actionCardId)

    expect(regenerated?.status).toBe("draft")
    expect(second.bundle.unresolvedSemanticRelationIds?.length).toBeGreaterThan(0)
    expect(second.bundle.strategyMarkdown).toContain("语义冲突提示")
    expect(second.bundle.strategyMarkdown).toContain("## 多来源证据与分歧")
  })

  it("uses LLM structured patches when available and keeps action card contract intact", async () => {
    const tmp = await createTempProject("strategy-llm")
    cleanup = tmp.cleanup
    const report = baseReport()
    const scenePack = await ensureScenePack(tmp.path, { persistDefaults: true, defaultLanguage: "Chinese" })
    await writeFileRaw(
      `${tmp.path}/wiki/business/主图设计sop/素材与版式.md`,
      "# 素材与版式\n\n- 主图需要将护眼卖点转成可执行素材说明。\n",
    )
    currentLlmResponse = "__AUTO_ASSET_PATCH__"

    const enhanced = await writeStrategyBundle(tmp.path, report, scenePack, { llmConfig: fakeLlmConfig })
    const assetCard = enhanced.bundle.actionCards?.find((card) => card.category === "creative_asset_brief_generation")

    expect(enhanced.bundle.llmEnhanced).toBe(true)
    expect(enhanced.bundle.warnings).toEqual([])
    expect(assetCard?.triggerCondition).toBe("当家长人群点击率低且护眼卖点没有被第一眼识别时")
    expect(assetCard?.outputArtifact).toBe("可交付设计的主图素材说明")
    expect(assetCard?.actionSteps).toContain("输出包含画面、文案、版式和验证指标的主图素材说明。")
    expect(assetCard?.missingInputs).toContain("当前主图截图")
  })
})
