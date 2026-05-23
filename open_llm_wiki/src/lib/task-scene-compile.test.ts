import { afterEach, describe, expect, it, vi } from "vitest"
import { realFs, createTempProject, fileExists, readFileRaw } from "@/test-helpers/fs-temp"
import { buildTaskContextPack, extractWorkbookIRFromMarkdown } from "./task-context-pack"
import { writeSceneCompile } from "./scene-compile"
import type { AgentModeReport, ScenePack } from "./agent-mode-types"

vi.mock("@/commands/fs", () => realFs)
vi.mock("@/lib/knowledge-image-index", () => ({
  searchKnowledgeImages: vi.fn(async () => []),
}))

let cleanup: (() => Promise<void>) | null = null

afterEach(async () => {
  if (cleanup) {
    await cleanup()
    cleanup = null
  }
})

function makeScenePack(): ScenePack {
  return {
    manifest: {
      scene_id: "ecom_growth_task_generation",
      scene_name: "经营任务生成",
      doc_type: "task_generation",
      default_output_language: "zh",
      profiles_version: "v1",
      source_snapshot_origin: "test",
    },
    paths: {
      manifestPath: "",
      purposePath: "",
      schemaPath: "",
      schemaProfilePath: "",
      expertGuidancePath: "",
      evaluationProfilePath: "",
      strategyProfilePath: "",
      snapshotDir: "",
    },
    purposeMarkdown: "",
    schemaMarkdown: "",
    schemaProfile: {
      fields: [
        { key: "operating_goal", label: "经营目标", required: true },
        { key: "role_system", label: "角色系统", required: true },
      ],
    },
    expertGuidanceProfile: {},
    evaluationProfile: {},
    strategyProfile: {},
  }
}

function makeReport(taskContextPack: AgentModeReport["taskContextPack"]): AgentModeReport {
  const now = "2026-05-20T00:00:00.000Z"
  return {
    docId: "doc-task",
    sourceKind: "generic",
    sourceName: "经营周会.xlsx",
    sourcePath: "/tmp/经营周会.xlsx",
    sourceContent: "source",
    sceneId: "ecom_growth_task_generation",
    generatedAt: now,
    analysis: "analysis",
    documentIr: {
      docId: "doc-task",
      sourceName: "经营周会.xlsx",
      sourcePath: "/tmp/经营周会.xlsx",
      createdAt: now,
      blocks: [],
    },
    understanding: {
      title: "经营周会",
      summary: "经营周会任务生成",
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
      docId: "doc-task",
      sceneId: "ecom_growth_task_generation",
      title: "经营周会",
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
      docId: "doc-task",
      compileMode: "two-stage+structuring",
      sourcePath: "/tmp/经营周会.xlsx",
      sourceName: "经营周会.xlsx",
      structuredContext: "",
      generatedAt: now,
      qualityScore: 80,
      warnings: [],
    },
    compilePlan: {
      docId: "doc-task",
      sceneId: "ecom_growth_task_generation",
      compileMode: "scene_business_dominant",
      pagePlans: [],
      sectionMappings: {},
      fieldToPageMap: {},
      requiredFieldKeys: [],
    },
    compileCoverage: {
      docId: "doc-task",
      generatedAt: now,
      entries: [],
    },
    compileIr: {
      sourceSummary: "经营周会任务生成",
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
      openQuestions: [],
      sourceRefsByField: {},
    },
    strategyBundle: null,
    strategyCoverage: null,
    confirmedStrategyCardIds: [],
    documentBackend: "generic",
    documentBackendStatus: {
      mode: "generic",
      status: "ready",
      detail: "ready",
      degraded: false,
    },
    documentArtifacts: null,
    pdfArtifacts: null,
    taskContextPack,
  }
}

describe("task generation scene compile", () => {
  it("persists task context pack and renders stable task wiki pages", async () => {
    const tmp = await createTempProject("task-scene-compile")
    cleanup = tmp.cleanup
    const workbook = extractWorkbookIRFromMarkdown({
      docId: "doc-task",
      sourcePath: "/tmp/经营周会.xlsx",
      sourceName: "经营周会.xlsx",
      markdown: [
        "## 周会复盘",
        "",
        "| 目标 | 问题 | 负责人 | 协同角色 | 动作 | 指标 |",
        "| --- | --- | --- | --- | --- | --- |",
        "| 提升转化率 | 点击率下滑 | 运营 | 美工 | 优化主图细节 | 点击率提升10% |",
      ].join("\n"),
    })
    const pack = buildTaskContextPack({
      docId: "doc-task",
      sourcePath: "/tmp/经营周会.xlsx",
      sourceName: "经营周会.xlsx",
      sourceKind: "generic",
      workbook,
      documentBlocks: [],
    })

    const result = await writeSceneCompile(tmp.path, makeReport(pack), makeScenePack())

    expect(result.writtenPaths).toContain("wiki/tasks/经营周会.md")
    expect(result.writtenPaths).toContain("wiki/tasks/index.md")
    expect(result.writtenPaths).toContain(".llm-wiki/task-index.json")
    expect(result.writtenPaths).toContain("wiki/roles/经营周会.md")
    expect(result.writtenPaths).not.toContain("wiki/business/经营周会/index.md")
    expect(await fileExists(`${tmp.path}/wiki/business/经营周会/index.md`)).toBe(false)
    expect(await readFileRaw(`${tmp.path}/wiki/index.md`)).toContain("[[tasks/经营周会|经营周会 · 可执行任务卡]]")
    expect(await readFileRaw(`${tmp.path}/wiki/index.md`)).not.toContain("business/经营周会")
    expect(await readFileRaw(`${tmp.path}/wiki/tasks/经营周会.md`)).toContain("优化主图细节")
    expect(await readFileRaw(`${tmp.path}/wiki/tasks/index.md`)).toContain("经营任务卡索引")
    expect(await readFileRaw(`${tmp.path}/.llm-wiki/task-index.json`)).toContain("优化主图细节")
    expect(await readFileRaw(`${tmp.path}/wiki/quality/经营周会.md`)).toContain("点击率提升10%")
    expect(await readFileRaw(`${tmp.path}/.llm-wiki/task-context-packs/${pack.packId}.json`)).toContain("task_context_pack_v1")
  })
})
