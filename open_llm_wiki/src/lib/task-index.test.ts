import { afterEach, describe, expect, it, vi } from "vitest"
import { realFs, createTempProject, readFileRaw } from "@/test-helpers/fs-temp"
import type { TaskContextPack } from "@/lib/agent-mode-types"
import { buildOrRefreshTaskIndex, buildTaskIndexFromPacks } from "./task-index"

vi.mock("@/commands/fs", () => realFs)

let cleanup: (() => Promise<void>) | null = null

afterEach(async () => {
  if (cleanup) {
    await cleanup()
    cleanup = null
  }
})

function makePack(overrides: Partial<TaskContextPack> = {}): TaskContextPack {
  return {
    schemaVersion: "task_context_pack_v1",
    packId: "tcp-week",
    sourceDocId: "doc-week",
    sourceName: "运营周会.xlsx",
    sourcePath: "/tmp/运营周会.xlsx",
    sourceKind: "generic",
    docRole: "meeting_task_source",
    operatingGoals: [{ text: "提升周度经营效率", evidenceRefs: ["goal-ref"] }],
    roleProfiles: [],
    taskTriggers: [],
    taskCandidates: [
      {
        taskId: "task-ready",
        title: "优化主图点击率",
        taskModule: "visual_content",
        productId: "741405253807",
        taskItem: "优化主图细节图",
        taskStatus: "in_progress",
        resultFeedback: [],
        trigger: "点击率低于目标",
        targetObject: "主图",
        problemEvidence: ["点击率下滑"],
        ownerRole: "运营负责人",
        normalizedOwnerRole: "运营负责人",
        collaboratorRoles: ["美工"],
        actionSteps: ["优化主图细节图"],
        acceptanceMetrics: ["点击率提升10%"],
        cadence: "weekly",
        reviewRequirement: "下周周会复盘",
        sourceRefs: ["/tmp/运营周会.xlsx#sheet=周会&range=A1:H2"],
        status: "draft",
        timeRange: {
          label: "2026-05",
          start: "2026-05-01",
          end: "2026-05-31",
        },
        priority: "high",
        importanceScore: 88,
        executableScore: 92,
        qualityScore: 94,
        sourceDocType: "meeting_task_source",
        extractionWarnings: [],
        quality: {
          score: 94,
          completenessScore: 92,
          executableScore: 92,
          evidenceScore: 100,
          level: "ready",
          missingElements: [],
          strengths: ["已明确 Owner"],
          reviewNotes: [],
        },
      },
      {
        taskId: "task-review",
        title: "补齐活动复盘",
        trigger: "复盘材料缺失",
        targetObject: "活动",
        problemEvidence: ["缺少复盘数据"],
        ownerRole: "待确认",
        collaboratorRoles: [],
        actionSteps: ["整理活动复盘"],
        acceptanceMetrics: [],
        cadence: "weekly",
        reviewRequirement: "周会复盘",
        sourceRefs: ["/tmp/运营周会.xlsx#sheet=周会&range=A3:H3"],
        status: "needs_review",
        timeRange: { label: "2026-05" },
        priority: "medium",
        importanceScore: 55,
        executableScore: 45,
        qualityScore: 58,
        sourceDocType: "meeting_task_source",
        extractionWarnings: ["missing_owner_role", "missing_acceptance_metrics"],
        quality: {
          score: 58,
          completenessScore: 58,
          executableScore: 45,
          evidenceScore: 100,
          level: "needs_review",
          missingElements: ["ownerRole", "acceptanceMetrics"],
          strengths: ["已有动作"],
          reviewNotes: ["补齐任务 Owner。"],
        },
      },
    ],
    metricRules: [],
    collaborationRules: [],
    reviewRules: [],
    evidenceAnchors: ["/tmp/运营周会.xlsx#sheet=周会&range=A1:H3"],
    qualityWarnings: [],
    taskQualitySummary: {
      total: 2,
      ready: 1,
      needsReview: 1,
      averageScore: 76,
      topMissingElements: ["ownerRole", "acceptanceMetrics"],
    },
    ...overrides,
  }
}

describe("task index", () => {
  it("builds a structured task index from task context packs", async () => {
    const tmp = await createTempProject("task-index")
    cleanup = tmp.cleanup
    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/task-context-packs/tcp-week.json`,
      JSON.stringify(makePack(), null, 2),
    )

    const index = await buildOrRefreshTaskIndex(tmp.path)

    expect(index.schemaVersion).toBe("task_index_v1")
    expect(index.entries).toHaveLength(2)
    expect(index.entries[0]).toMatchObject({
      taskId: "task-ready",
      taskModule: "visual_content",
      taskModuleLabel: "商品视觉与内容创作",
      productId: "741405253807",
      taskItem: "优化主图细节图",
      taskStatus: "in_progress",
      ownerRole: "运营负责人",
      normalizedOwnerRole: "运营负责人",
      priority: "high",
      qualityBand: "ready",
      wikiRefs: ["wiki/tasks/运营周会.md"],
    })
    expect(index.summary).toMatchObject({
      total: 2,
      ready: 1,
      needsReview: 1,
      byTaskModule: {
        visual_content: 1,
        unknown: 1,
      },
      byTaskStatus: {
        in_progress: 1,
        unknown: 1,
      },
    })
    expect(await readFileRaw(`${tmp.path}/.llm-wiki/task-index.json`)).toContain("task-ready")
  })

  it("excludes mechanism and role/KPI packs from the real task index", async () => {
    const taskPack = makePack()
    const mechanismPack = makePack({
      packId: "tcp-mechanism",
      sourceDocId: "doc-mechanism",
      sourceName: "经营任务生成机制与质量体系.md",
      docRole: "task_mechanism_source",
      sourcePolicy: {
        sourceDocRole: "task_mechanism_source",
        canGenerateTaskCards: false,
        canProvideRules: true,
        canProvideRoleContext: false,
        canProvideMetrics: true,
        defaultIndexVisibility: "context_only",
      },
      taskCandidates: [
        {
          ...taskPack.taskCandidates[0],
          taskId: "polluted-mechanism-task",
          title: "目标、数据、SOP、复盘、组织角色共同生成",
          sourceDocType: "task_mechanism_source",
        },
      ],
    })
    const rolePack = makePack({
      packId: "tcp-role",
      sourceDocId: "doc-role",
      sourceName: "岗位KPI.xlsx",
      docRole: "role_kpi_source",
      sourcePolicy: {
        sourceDocRole: "role_kpi_source",
        canGenerateTaskCards: false,
        canProvideRules: false,
        canProvideRoleContext: true,
        canProvideMetrics: true,
        defaultIndexVisibility: "context_only",
      },
      taskCandidates: [
        {
          ...taskPack.taskCandidates[0],
          taskId: "polluted-role-task",
          title: "岗位职责长期任务",
          sourceDocType: "role_kpi_source",
        },
      ],
    })

    const index = buildTaskIndexFromPacks([taskPack, mechanismPack, rolePack])

    expect(index.entries.map((entry) => entry.taskId)).toEqual(["task-ready", "task-review"])
    expect(index.entries.some((entry) => entry.sourceName.includes("经营任务生成机制"))).toBe(false)
    expect(index.entries.some((entry) => entry.sourceDocType === "role_kpi_source")).toBe(false)
  })

  it("dedupes legacy duplicate tasks and infers missing quality gaps", async () => {
    const goodPack = makePack({
      taskCandidates: [
        {
          ...makePack().taskCandidates[0],
          taskId: "task-good",
          title: "月会重点任务",
          sourceRefs: ["/tmp/运营月会.xlsx#sheet=1月&range=A1:F2"],
          qualityScore: 58,
          executableScore: 63,
          quality: {
            score: 58,
            completenessScore: 58,
            executableScore: 63,
            evidenceScore: 50,
            level: "needs_review",
            missingElements: ["problemEvidence", "strategyPath", "actionSteps", "ownerRole", "collaboratorRoles"],
            strengths: ["已有验收指标"],
            reviewNotes: ["补齐 Owner。"],
          },
        },
      ],
    })
    const legacyPack = makePack({
      packId: "tcp-legacy",
      sourceDocId: "doc-week-legacy",
      taskCandidates: [
        {
          ...makePack().taskCandidates[0],
          taskId: "task-legacy",
          title: "月会重点任务",
          ownerRole: "待确认",
          collaboratorRoles: [],
          actionSteps: [],
          sourceRefs: ["/tmp/运营月会.xlsx#sheet=1月&range=A1:F2"],
          status: "needs_review",
          sourceDocType: "meeting_task_source",
          quality: undefined,
          qualityScore: undefined,
          executableScore: undefined,
        },
      ],
    })

    const index = buildTaskIndexFromPacks([legacyPack, goodPack])

    expect(index.entries).toHaveLength(1)
    expect(index.entries[0]).toMatchObject({
      taskId: "task-good",
      qualityScore: 58,
      missingElements: ["problemEvidence", "strategyPath", "actionSteps", "ownerRole", "collaboratorRoles"],
    })
  })
})
