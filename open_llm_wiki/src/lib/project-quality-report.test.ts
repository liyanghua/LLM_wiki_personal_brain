import { afterEach, describe, expect, it, vi } from "vitest"
import { createTempProject, readFileRaw, realFs } from "@/test-helpers/fs-temp"
import {
  buildProjectQualityReport,
  formatProjectQualityTaskSummary,
  loadProjectQualityReport,
  renderProjectQualityReportMarkdown,
  writeProjectQualityReport,
} from "./project-quality-report"

vi.mock("@/commands/fs", () => realFs)

let cleanup: (() => Promise<void>) | null = null

afterEach(async () => {
  if (cleanup) {
    await cleanup()
    cleanup = null
  }
})

describe("project quality report", () => {
  it("aggregates document quality, task card quality, missing elements, and semantic conflicts", async () => {
    const tmp = await createTempProject("project-quality")
    cleanup = tmp.cleanup

    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/agent-mode/index.json`,
      JSON.stringify(["doc-week", "doc-role"], null, 2),
    )
    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/agent-mode/doc-week.json`,
      JSON.stringify({
        docId: "doc-week",
        sourceName: "运营周会.xlsx",
        sourcePath: "raw/sources/周会/运营周会.xlsx",
        qualityScore: 82,
        qualitySummary: "周会结构较完整",
      }, null, 2),
    )
    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/agent-mode/doc-role.json`,
      JSON.stringify({
        docId: "doc-role",
        sourceName: "岗位职责.xlsx",
        sourcePath: "raw/sources/岗位/岗位职责.xlsx",
        qualityScore: 64,
        qualitySummary: "岗位指标缺少证据锚点",
      }, null, 2),
    )
    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/task-index.json`,
      JSON.stringify({
        schemaVersion: "task_index_v1",
        generatedAt: "2026-05-21T00:00:00.000Z",
        entries: [
          {
            taskId: "t1",
            title: "复盘12月运营任务",
            sourceDocId: "doc-week",
            sourceName: "运营周会.xlsx",
            sourcePath: "raw/sources/周会/运营周会.xlsx",
            qualityBand: "ready",
            qualityScore: 90,
            executableScore: 88,
            missingElements: [],
            normalizedOwnerRole: "运营负责人",
            ownerRole: "运营负责人",
            timeRange: { label: "2026-12" },
          },
          {
            taskId: "t2",
            title: "补齐岗位KPI验收",
            sourceDocId: "doc-role",
            sourceName: "岗位职责.xlsx",
            sourcePath: "raw/sources/岗位/岗位职责.xlsx",
            qualityBand: "needs_review",
            qualityScore: 56,
            executableScore: 40,
            missingElements: ["ownerRole", "acceptanceMetrics"],
            normalizedOwnerRole: "",
            ownerRole: "待确认",
            timeRange: { label: "待确认" },
          },
          {
            taskId: "t3",
            title: "补齐协同角色",
            sourceDocId: "doc-role",
            sourceName: "岗位职责.xlsx",
            sourcePath: "raw/sources/岗位/岗位职责.xlsx",
            qualityBand: "needs_review",
            qualityScore: 60,
            executableScore: 52,
            missingElements: ["collaboratorRoles", "acceptanceMetrics"],
            normalizedOwnerRole: "店长",
            ownerRole: "店长",
            timeRange: { label: "monthly" },
          },
        ],
        summary: {
          total: 3,
          ready: 1,
          needsReview: 2,
          averageQualityScore: 69,
          averageExecutableScore: 60,
          byOwnerRole: {},
          byCadence: {},
          byPriority: {},
          topMissingElements: ["acceptanceMetrics", "ownerRole", "collaboratorRoles"],
        },
      }, null, 2),
    )
    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/semantic-units/index.json`,
      JSON.stringify({
        schemaVersion: "semantic_units_v1",
        units: [{ unitId: "u1" }, { unitId: "u2" }],
        relations: [{ relationId: "r1" }],
        conflicts: [{ conflictId: "c1" }],
      }, null, 2),
    )
    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/ingest-cache.json`,
      JSON.stringify({
        entries: {
          "raw/sources/周会/运营周会.xlsx": {
            hash: "a",
            timestamp: 1,
            filesWritten: ["wiki/tasks/运营周会.md"],
            completedStages: ["core", "postProcessing"],
          },
          "raw/sources/岗位/岗位职责.xlsx": {
            hash: "b",
            timestamp: 2,
            filesWritten: ["wiki/tasks/岗位职责.md"],
            completedStages: ["core"],
          },
        },
      }, null, 2),
    )
    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/ingest-queue.json`,
      JSON.stringify([
        {
          id: "pending-1",
          sourcePath: "raw/sources/待处理/下周计划.xlsx",
          status: "pending",
          folderContext: "",
          addedAt: 1,
          error: null,
          retryCount: 0,
        },
        {
          id: "failed-1",
          sourcePath: "raw/sources/异常/损坏文件.xlsx",
          status: "failed",
          folderContext: "",
          addedAt: 2,
          error: "parse failed",
          retryCount: 3,
        },
      ], null, 2),
    )

    const report = await buildProjectQualityReport(tmp.path)

    expect(report.sourceCount).toBe(4)
    expect(report.compiledSourceCount).toBe(2)
    expect(report.pendingSourceCount).toBe(1)
    expect(report.failedSourceCount).toBe(1)
    expect(report.averageDocumentQualityScore).toBe(73)
    expect(report.taskSummary).toMatchObject({
      total: 3,
      ready: 1,
      needsReview: 2,
      averageQualityScore: 69,
      averageExecutableScore: 60,
      topMissingElements: ["acceptanceMetrics", "ownerRole", "collaboratorRoles"],
    })
    expect(report.semanticSummary).toEqual({ units: 2, relations: 1, conflicts: 1 })
    expect(report.documents.find((doc) => doc.sourceName === "岗位职责.xlsx")).toMatchObject({
      taskCount: 2,
      needsReviewTaskCount: 2,
      averageTaskQualityScore: 58,
      topMissingElements: ["acceptanceMetrics", "ownerRole", "collaboratorRoles"],
    })
  })

  it("scores document-role contribution from task context packs instead of raw source health", async () => {
    const tmp = await createTempProject("project-quality-doc-role")
    cleanup = tmp.cleanup

    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/agent-mode/index.json`,
      JSON.stringify(["doc-mechanism", "doc-role", "doc-meeting"], null, 2),
    )
    for (const [docId, sourceName] of [
      ["doc-mechanism", "经营任务生成机制与质量体系.md"],
      ["doc-role", "运营团队岗位职责和岗位能力.xlsx"],
      ["doc-meeting", "朗格运营月会-12月.xlsx"],
    ]) {
      await realFs.writeFile(
        `${tmp.path}/.llm-wiki/agent-mode/${docId}.json`,
        JSON.stringify({
          docId,
          sourceName,
          sourcePath: `raw/sources/${sourceName}`,
          qualityScore: 56,
          qualitySummary: "通用源文档健康分偏低，但经营任务作用识别应由 TaskContextPack 判断。",
        }, null, 2),
      )
    }

    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/task-context-packs/doc-mechanism.json`,
      JSON.stringify({
        schemaVersion: "task_context_pack_v1",
        packId: "tcp-mechanism",
        sourceDocId: "doc-mechanism",
        sourceName: "经营任务生成机制与质量体系.md",
        sourcePath: "raw/sources/经营任务生成机制与质量体系.md",
        sourceKind: "generic",
        docRole: "task_mechanism_source",
        sourcePolicy: {
          sourceDocRole: "task_mechanism_source",
          canGenerateTaskCards: false,
          canProvideRules: true,
          canProvideRoleContext: false,
          canProvideMetrics: true,
          defaultIndexVisibility: "context_only",
        },
        taskCandidates: [],
        taskRulePack: {
          requiredElements: ["经营目标", "任务对象", "Owner", "验收指标", "证据锚点"],
          scoringWeights: {},
          qualityLevels: ["ready"],
          reviewReasons: [],
          taskTemplates: ["经营任务模板"],
          fixSuggestions: [],
          evidenceRefs: ["mechanism-ref"],
        },
        evidenceAnchors: ["mechanism-ref"],
        qualityWarnings: [],
      }, null, 2),
    )
    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/task-context-packs/doc-role.json`,
      JSON.stringify({
        schemaVersion: "task_context_pack_v1",
        packId: "tcp-role",
        sourceDocId: "doc-role",
        sourceName: "运营团队岗位职责和岗位能力.xlsx",
        sourcePath: "raw/sources/运营团队岗位职责和岗位能力.xlsx",
        sourceKind: "xlsx",
        docRole: "role_kpi_source",
        sourcePolicy: {
          sourceDocRole: "role_kpi_source",
          canGenerateTaskCards: false,
          canProvideRules: false,
          canProvideRoleContext: true,
          canProvideMetrics: true,
          defaultIndexVisibility: "context_only",
        },
        taskCandidates: [],
        roleContextIndex: {
          roles: [{ roleName: "运营负责人", responsibilities: ["拆解经营目标"], kpis: ["销售额达成率"], collaboratorRoles: ["推广"] }],
          responsibilities: ["拆解经营目标"],
          kpis: ["销售额达成率"],
          collaboratorRoles: ["推广"],
          ownerInferenceHints: ["运营负责人: 拆解经营目标"],
          evidenceRefs: ["role-ref"],
        },
        evidenceAnchors: ["role-ref"],
        qualityWarnings: [],
      }, null, 2),
    )
    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/task-context-packs/doc-meeting.json`,
      JSON.stringify({
        schemaVersion: "task_context_pack_v1",
        packId: "tcp-meeting",
        sourceDocId: "doc-meeting",
        sourceName: "朗格运营月会-12月.xlsx",
        sourcePath: "raw/sources/朗格运营月会-12月.xlsx",
        sourceKind: "xlsx",
        docRole: "meeting_task_source",
        sourcePolicy: {
          sourceDocRole: "meeting_task_source",
          canGenerateTaskCards: true,
          canProvideRules: false,
          canProvideRoleContext: false,
          canProvideMetrics: true,
          defaultIndexVisibility: "task_index",
        },
        taskCandidates: [{ taskId: "task-meeting", title: "复盘12月运营任务", sourceRefs: ["meeting-ref"] }],
        evidenceAnchors: ["meeting-ref"],
        qualityWarnings: [],
      }, null, 2),
    )
    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/task-index.json`,
      JSON.stringify({
        schemaVersion: "task_index_v1",
        generatedAt: "2026-05-23T00:00:00.000Z",
        entries: [
          {
            taskId: "task-meeting",
            title: "复盘12月运营任务",
            sourceDocId: "doc-meeting",
            sourceName: "朗格运营月会-12月.xlsx",
            sourcePath: "raw/sources/朗格运营月会-12月.xlsx",
            qualityBand: "needs_review",
            qualityScore: 62,
            executableScore: 65,
            missingElements: ["acceptanceMetrics"],
            normalizedOwnerRole: "运营负责人",
            ownerRole: "运营负责人",
            timeRange: { label: "2026-12" },
          },
        ],
        summary: {
          total: 1,
          ready: 0,
          needsReview: 1,
          averageQualityScore: 62,
          averageExecutableScore: 65,
          byOwnerRole: {},
          byCadence: {},
          byPriority: {},
          topMissingElements: ["acceptanceMetrics"],
        },
      }, null, 2),
    )

    const report = await buildProjectQualityReport(tmp.path)

    expect(report.averageDocumentQualityScore).toBeGreaterThanOrEqual(80)
    expect(report.documents.find((doc) => doc.sourceName === "经营任务生成机制与质量体系.md")?.qualityScore).toBeGreaterThanOrEqual(85)
    expect(report.documents.find((doc) => doc.sourceName === "运营团队岗位职责和岗位能力.xlsx")?.qualityScore).toBeGreaterThanOrEqual(85)
    expect(report.documents.find((doc) => doc.sourceName === "朗格运营月会-12月.xlsx")?.qualityScore).toBeGreaterThanOrEqual(80)
  })

  it("collapses duplicate task-context packs for the same source and keeps the strongest contribution signal", async () => {
    const tmp = await createTempProject("project-quality-dedupe-source")
    cleanup = tmp.cleanup

    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/agent-mode/index.json`,
      JSON.stringify(["doc-template-old", "doc-template-artifact"], null, 2),
    )
    for (const docId of ["doc-template-old", "doc-template-artifact"]) {
      await realFs.writeFile(
        `${tmp.path}/.llm-wiki/agent-mode/${docId}.json`,
        JSON.stringify({
          docId,
          sourceName: "周会表格模版-运营部主管周会.xlsx",
          sourcePath: "raw/sources/周会表格模版-运营部主管周会.xlsx",
          qualityScore: 56,
        }, null, 2),
      )
    }
    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/task-context-packs/old.json`,
      JSON.stringify({
        schemaVersion: "task_context_pack_v1",
        packId: "tcp-template-old",
        sourceDocId: "doc-template-old",
        sourceName: "周会表格模版-运营部主管周会.xlsx",
        sourcePath: "raw/sources/周会表格模版-运营部主管周会.xlsx",
        sourceKind: "xlsx",
        docRole: "meeting_task_source",
        taskCandidates: [],
        evidenceAnchors: ["template-old-ref"],
        qualityWarnings: [],
      }, null, 2),
    )
    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/task-context-packs/artifact.json`,
      JSON.stringify({
        schemaVersion: "task_context_pack_v1",
        packId: "tcp-template-artifact",
        sourceDocId: "doc-template-artifact",
        sourceName: "周会表格模版-运营部主管周会.xlsx",
        sourcePath: "raw/sources/周会表格模版-运营部主管周会.xlsx",
        sourceKind: "xlsx",
        docRole: "mixed_task_source",
        sourcePolicy: {
          sourceDocRole: "mixed_task_source",
          canGenerateTaskCards: true,
          canProvideRules: true,
          canProvideRoleContext: true,
          canProvideMetrics: true,
          defaultIndexVisibility: "task_index",
        },
        taskCandidates: [],
        taskRulePack: {
          requiredElements: ["经营目标", "Owner", "验收指标"],
          scoringWeights: {},
          qualityLevels: ["ready"],
          reviewReasons: [],
          taskTemplates: ["周会表格字段模板"],
          fixSuggestions: [],
          evidenceRefs: ["template-rule-ref"],
        },
        roleContextIndex: {
          roles: [],
          responsibilities: [],
          kpis: ["销售额达成率"],
          collaboratorRoles: [],
          ownerInferenceHints: [],
          evidenceRefs: ["template-rule-ref"],
        },
        evidenceAnchors: ["template-rule-ref"],
        qualityWarnings: [],
      }, null, 2),
    )

    const report = await buildProjectQualityReport(tmp.path)

    expect(report.documents.filter((doc) => doc.sourceName === "周会表格模版-运营部主管周会.xlsx")).toHaveLength(1)
    expect(report.documents[0]?.qualityScore).toBeGreaterThanOrEqual(80)
    expect(report.averageDocumentQualityScore).toBeGreaterThanOrEqual(80)
  })

  it("writes JSON and human-readable wiki quality report", async () => {
    const tmp = await createTempProject("project-quality-write")
    cleanup = tmp.cleanup
    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/task-index.json`,
      JSON.stringify({
        schemaVersion: "task_index_v1",
        generatedAt: "2026-05-21T00:00:00.000Z",
        entries: [],
        summary: {
          total: 0,
          ready: 0,
          needsReview: 0,
          averageQualityScore: 0,
          averageExecutableScore: 0,
          byOwnerRole: {},
          byCadence: {},
          byPriority: {},
          topMissingElements: [],
        },
      }, null, 2),
    )

    const written = await writeProjectQualityReport(tmp.path)
    const json = await readFileRaw(`${tmp.path}/.llm-wiki/quality-report.json`)
    const markdown = await readFileRaw(`${tmp.path}/wiki/quality/index.md`)

    expect(written.taskSummary.total).toBe(0)
    expect(JSON.parse(json).taskSummary.total).toBe(0)
    expect(markdown).toContain("# 项目质量罗盘")
    expect(markdown).toContain("任务卡总数")
  })

  it("loads a stored quality report and formats the task-group summary", async () => {
    const tmp = await createTempProject("project-quality-load")
    cleanup = tmp.cleanup
    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/quality-report.json`,
      JSON.stringify({
        generatedAt: "2026-05-21T00:00:00.000Z",
        sourceCount: 5,
        compiledSourceCount: 4,
        pendingSourceCount: 1,
        failedSourceCount: 0,
        averageDocumentQualityScore: 77,
        taskSummary: {
          total: 8,
          ready: 3,
          needsReview: 5,
          averageQualityScore: 81,
          averageExecutableScore: 74,
          topMissingElements: ["ownerRole", "acceptanceMetrics"],
        },
        documents: [],
        semanticSummary: {
          units: 10,
          relations: 2,
          conflicts: 1,
        },
      }, null, 2),
    )

    const report = await loadProjectQualityReport(tmp.path)
    const summary = formatProjectQualityTaskSummary(report)

    expect(report?.taskSummary).toMatchObject({
      total: 8,
      ready: 3,
      needsReview: 5,
    })
    expect(summary).toContain("ready 3")
    expect(summary).toContain("needs_review 5")
    expect(summary).toContain("平均质量 81/100")
  })

  it("degrades safely when task index or semantic index is missing", async () => {
    const tmp = await createTempProject("project-quality-empty")
    cleanup = tmp.cleanup

    const report = await buildProjectQualityReport(tmp.path)
    const markdown = renderProjectQualityReportMarkdown(report)

    expect(report.taskSummary.total).toBe(0)
    expect(report.semanticSummary).toBeUndefined()
    expect(markdown).toContain("暂无任务卡")
  })
})
