import { afterEach, describe, expect, it, vi } from "vitest"
import { createTempProject, fileExists, readFileRaw, realFs } from "@/test-helpers/fs-temp"
import type { TaskContextPack } from "@/lib/agent-mode-types"
import type { TaskIndex } from "@/lib/task-index"
import {
  loadTaskQualityJudgeCases,
  runTaskQualityLlmJudge,
  runTaskQualityLlmJudgeFromFile,
} from "./task-quality-llm-judge"

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
    sourcePath: "raw/sources/周会/运营周会.xlsx",
    sourceKind: "generic",
    docRole: "meeting_task_source",
    operatingGoals: [{ text: "提升12月经营效率", evidenceRefs: ["goal-ref"] }],
    roleProfiles: [],
    taskTriggers: [{ text: "12月重点链接增长", evidenceRefs: ["trigger-ref"] }],
    taskCandidates: [],
    metricRules: [{ text: "搜索访客提升", evidenceRefs: ["metric-ref"] }],
    collaborationRules: [],
    reviewRules: [],
    evidenceAnchors: ["raw/sources/周会/运营周会.xlsx#sheet=12月&range=A1:H6"],
    qualityWarnings: [],
    taskQualitySummary: {
      total: 0,
      ready: 0,
      needsReview: 0,
      averageScore: 0,
      topMissingElements: [],
    },
    ...overrides,
  }
}

function makeTaskIndex(): TaskIndex {
  return {
    schemaVersion: "task_index_v1",
    generatedAt: "2026-05-22T00:00:00.000Z",
    entries: [
      {
        taskId: "task-ready",
        title: "运营负责人复盘12月老链接增长",
        taskModule: "existing_product_growth",
        taskModuleLabel: "老链接/存量商品增长优化",
        productId: "741405253807",
        taskItem: "复盘12月老链接增长",
        taskStatus: "in_progress",
        resultFeedback: [],
        ownerRole: "运营负责人",
        normalizedOwnerRole: "运营负责人",
        collaboratorRoles: ["推广运营"],
        timeRange: { label: "2026-12", start: "2026-12-01", end: "2026-12-31" },
        cadence: "monthly",
        priority: "high",
        importanceScore: 88,
        executableScore: 90,
        qualityScore: 92,
        qualityBand: "ready",
        status: "draft",
        targetObject: "老链接",
        problemEvidence: ["12月搜索访客低于目标"],
        actionSteps: ["复盘老链接增长动作"],
        acceptanceMetrics: ["搜索访客提升10%"],
        reviewRequirement: "月会复盘",
        missingElements: [],
        sourceRefs: ["raw/sources/周会/运营周会.xlsx#sheet=12月&range=A1:H2"],
        wikiRefs: ["wiki/tasks/运营周会.md"],
        sourceDocId: "doc-week",
        sourceName: "运营周会.xlsx",
        sourceDocType: "meeting_task_source",
        generationSource: "meeting_action",
        completionSources: [],
        rulePackRefs: [],
        roleContextRefs: [],
      },
      {
        taskId: "task-needs-review",
        title: "推广运营本周优化直通车",
        taskModule: "traffic_promotion",
        taskModuleLabel: "推广与流量运营",
        productId: "",
        taskItem: "优化直通车计划",
        taskStatus: "done",
        resultFeedback: [],
        ownerRole: "推广运营",
        normalizedOwnerRole: "推广运营",
        collaboratorRoles: [],
        timeRange: { label: "2026-12", start: "2026-12-01", end: "2026-12-07" },
        cadence: "weekly",
        priority: "medium",
        importanceScore: 65,
        executableScore: 58,
        qualityScore: 61,
        qualityBand: "needs_review",
        status: "needs_review",
        targetObject: "直通车",
        problemEvidence: [],
        actionSteps: ["优化直通车计划"],
        acceptanceMetrics: [],
        reviewRequirement: "周会复盘",
        missingElements: ["problemEvidence", "acceptanceMetrics", "collaboratorRoles", "resultFeedback"],
        sourceRefs: ["raw/sources/周会/运营周会.xlsx#sheet=本周计划&range=A4:H5"],
        wikiRefs: ["wiki/tasks/运营周会.md"],
        sourceDocId: "doc-week",
        sourceName: "运营周会.xlsx",
        sourceDocType: "meeting_task_source",
        generationSource: "meeting_action",
        completionSources: [],
        rulePackRefs: [],
        roleContextRefs: [],
      },
    ],
    summary: {
      total: 2,
      ready: 1,
      needsReview: 1,
      averageQualityScore: 77,
      averageExecutableScore: 74,
      byOwnerRole: { "运营负责人": 1, "推广运营": 1 },
      byCadence: { monthly: 1, weekly: 1 },
      byPriority: { high: 1, medium: 1 },
      byTaskModule: { existing_product_growth: 1, traffic_promotion: 1 },
      byTaskStatus: { in_progress: 1, done: 1 },
      topMissingElements: ["problemEvidence", "acceptanceMetrics", "collaboratorRoles", "resultFeedback"],
    },
  }
}

async function writeFixtures(projectPath: string): Promise<void> {
  await realFs.writeFile(
    `${projectPath}/.llm-wiki/task-context-packs/tcp-week.json`,
    JSON.stringify(makePack({
      taskQualitySummary: {
        total: 2,
        ready: 1,
        needsReview: 1,
        averageScore: 77,
        topMissingElements: ["problemEvidence", "acceptanceMetrics"],
      },
    }), null, 2),
  )
  await realFs.writeFile(
    `${projectPath}/.llm-wiki/task-index.json`,
    JSON.stringify(makeTaskIndex(), null, 2),
  )
  await realFs.writeFile(
    `${projectPath}/.llm-wiki/quality-report.json`,
    JSON.stringify({
      generatedAt: "2026-05-22T00:00:00.000Z",
      sourceCount: 1,
      compiledSourceCount: 1,
      pendingSourceCount: 0,
      failedSourceCount: 0,
      averageDocumentQualityScore: 78,
      taskSummary: {
        total: 2,
        ready: 1,
        needsReview: 1,
        averageQualityScore: 77,
        averageExecutableScore: 74,
        topMissingElements: ["problemEvidence", "acceptanceMetrics"],
      },
      documents: [],
    }, null, 2),
  )
}

describe("task quality LLM judge", () => {
  it("fails clearly when the single eval cases file is missing", async () => {
    const tmp = await createTempProject("task-quality-judge-missing")
    cleanup = tmp.cleanup

    await expect(
      runTaskQualityLlmJudgeFromFile(tmp.path, `${tmp.path}/eval-cases/missing.yaml`),
    ).rejects.toThrow("Task quality judge cases file not found")
  })

  it("generates a rule-only report when no LLM config is provided", async () => {
    const tmp = await createTempProject("task-quality-judge")
    cleanup = tmp.cleanup
    await writeFixtures(tmp.path)

    const result = await runTaskQualityLlmJudge({
      projectPath: tmp.path,
      cases: {
        runId: "task-quality-test",
        queryCases: [
          { caseId: "ops-december", query: "运营负责人 12 月任务列表", filters: { role: "运营负责人" } },
          { caseId: "promotion-weekly", query: "推广运营 本周需要做什么", filters: { role: "推广运营" } },
        ],
      },
      llmConfig: null,
      generatedAt: "2026-05-22T00:00:00.000Z",
    })

    expect(result.report.llmJudgeSkipped).toBe(true)
    expect(result.report.layerSummary.taskExtraction.score).toBeLessThan(90)
    expect(result.report.queryResults).toHaveLength(2)
    expect(result.report.queryResults[0]?.grouped.ready.count).toBe(1)
    expect(result.report.queryResults[1]?.grouped.needsReview.count).toBe(1)
    expect(await fileExists(`${result.outputDir}/results.json`)).toBe(true)
    expect(await fileExists(`${result.outputDir}/scorecard.md`)).toBe(true)
    expect(await fileExists(`${result.outputDir}/query-answers.md`)).toBe(true)
    expect(await fileExists(`${tmp.path}/wiki/quality/task-quality-test.md`)).toBe(false)

    const scorecard = await readFileRaw(`${result.outputDir}/scorecard.md`)
    expect(scorecard).toContain("| Task Extraction |")
    expect(scorecard).toContain("problemEvidence")
    expect(scorecard).toContain("LLM Judge skipped")

    const queryAnswers = await readFileRaw(`${result.outputDir}/query-answers.md`)
    expect(queryAnswers).toContain("运营负责人 12 月任务列表")
    expect(queryAnswers).toContain("## Ready")
    expect(queryAnswers).toContain("## Needs Review")
  })

  it("loads YAML cases from a single file and writes the same eval artifacts", async () => {
    const tmp = await createTempProject("task-quality-judge-yaml")
    cleanup = tmp.cleanup
    await writeFixtures(tmp.path)
    await realFs.writeFile(
      `${tmp.path}/eval-cases/task-quality-llm-judge.yaml`,
      [
        "runId: yaml-run",
        "ingestCases:",
        "  - caseId: yaml-weekly-doc",
        "    sourceName: 运营周会.xlsx",
        "    expectedContribution: task_cards",
        "    acceptedDocRoles:",
        "      - meeting_task_source",
        "    minTaskCards: 1",
        "    mustEnterTaskIndex: true",
        "queryCases:",
        "  - caseId: ops-december",
        "    query: 运营负责人 12 月任务列表",
        "    filters:",
        "      role: 运营负责人",
        "  - caseId: promotion-weekly",
        "    query: 推广运营 本周需要做什么",
        "    filters:",
        "      role: 推广运营",
      ].join("\n"),
    )

    const loaded = await loadTaskQualityJudgeCases(`${tmp.path}/eval-cases/task-quality-llm-judge.yaml`)
    expect(loaded.ingestCases?.[0]).toMatchObject({
      caseId: "yaml-weekly-doc",
      sourceName: "运营周会.xlsx",
      expectedContribution: "task_cards",
      acceptedDocRoles: ["meeting_task_source"],
      minTaskCards: 1,
      mustEnterTaskIndex: true,
    })

    const result = await runTaskQualityLlmJudgeFromFile(
      tmp.path,
      `${tmp.path}/eval-cases/task-quality-llm-judge.yaml`,
      { llmConfig: null, generatedAt: "2026-05-22T00:00:00.000Z" },
    )

    expect(result.report.runId).toBe("yaml-run")
    expect(result.report.queryResults.map((item) => item.caseId)).toEqual(["ops-december", "promotion-weekly"])
    expect(await fileExists(`${tmp.path}/.llm-wiki/evals/yaml-run/results.json`)).toBe(true)
  })

  it("evaluates whether weekly/monthly docs and templates played the expected contribution role", async () => {
    const tmp = await createTempProject("task-quality-judge-contribution")
    cleanup = tmp.cleanup

    const needsReviewMonthly = {
      ...makeTaskIndex().entries[1],
      taskId: "monthly-review-only",
      sourceName: "朗格运营月会-12月.xlsx",
      sourceDocId: "doc-monthly",
      sourceRefs: ["raw/sources/周会/月会.xlsx#sheet=12月"],
      qualityBand: "needs_review" as const,
      status: "needs_review" as const,
      qualityScore: 61,
    }
    const templatePollution = {
      ...makeTaskIndex().entries[0],
      taskId: "template-pollution",
      sourceName: "周会表格模版-运营部主管周会.xlsx",
      sourceDocId: "doc-table-template",
      sourceRefs: ["raw/sources/周会/周会表格模版.xlsx#sheet=模板"],
      qualityBand: "needs_review" as const,
      status: "needs_review" as const,
      qualityScore: 40,
    }

    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/task-context-packs/weekly.json`,
      JSON.stringify(makePack({
        packId: "tcp-weekly",
        sourceDocId: "doc-weekly",
        sourceName: "周计划zz.xlsx",
        docRole: "meeting_task_source",
        sourcePolicy: {
          sourceDocRole: "meeting_task_source",
          canGenerateTaskCards: true,
          canProvideRules: false,
          canProvideRoleContext: false,
          canProvideMetrics: true,
          defaultIndexVisibility: "task_index",
        },
        taskCandidates: [],
      }), null, 2),
    )
    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/task-context-packs/monthly.json`,
      JSON.stringify(makePack({
        packId: "tcp-monthly",
        sourceDocId: "doc-monthly",
        sourceName: "朗格运营月会-12月.xlsx",
        docRole: "meeting_task_source",
        sourcePolicy: {
          sourceDocRole: "meeting_task_source",
          canGenerateTaskCards: true,
          canProvideRules: false,
          canProvideRoleContext: false,
          canProvideMetrics: true,
          defaultIndexVisibility: "task_index",
        },
        taskCandidates: [{ ...needsReviewMonthly, status: "needs_review" } as any],
        taskQualitySummary: {
          total: 1,
          ready: 0,
          needsReview: 1,
          averageScore: 61,
          topMissingElements: ["acceptanceMetrics"],
        },
      }), null, 2),
    )
    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/task-context-packs/case-template.json`,
      JSON.stringify(makePack({
        packId: "tcp-case-template",
        sourceDocId: "doc-case-template",
        sourceName: "周会模板案例-孙芷倩.docx",
        docRole: "mixed_task_source",
        sourcePolicy: {
          sourceDocRole: "mixed_task_source",
          canGenerateTaskCards: false,
          canProvideRules: true,
          canProvideRoleContext: true,
          canProvideMetrics: true,
          defaultIndexVisibility: "context_only",
        },
        taskCandidates: [],
        taskRulePack: null,
      }), null, 2),
    )
    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/task-context-packs/table-template.json`,
      JSON.stringify(makePack({
        packId: "tcp-table-template",
        sourceDocId: "doc-table-template",
        sourceName: "周会表格模版-运营部主管周会.xlsx",
        docRole: "mixed_task_source",
        sourcePolicy: {
          sourceDocRole: "mixed_task_source",
          canGenerateTaskCards: false,
          canProvideRules: true,
          canProvideRoleContext: true,
          canProvideMetrics: true,
          defaultIndexVisibility: "context_only",
        },
        taskCandidates: [],
        taskRulePack: {
          requiredElements: ["任务事项", "Owner"],
          scoringWeights: { completenessScore: 45, executableScore: 35, evidenceScore: 20 },
          qualityLevels: ["ready", "needs_review"],
          reviewReasons: ["missing_owner"],
          taskTemplates: ["周会任务表格字段模板"],
          fixSuggestions: ["补齐负责人列"],
          evidenceRefs: ["raw/sources/周会/周会表格模版.xlsx#sheet=模板"],
        },
      }), null, 2),
    )
    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/task-index.json`,
      JSON.stringify({
        ...makeTaskIndex(),
        entries: [needsReviewMonthly, templatePollution],
      }, null, 2),
    )
    await realFs.writeFile(`${tmp.path}/.llm-wiki/quality-report.json`, JSON.stringify({}, null, 2))

    const result = await runTaskQualityLlmJudge({
      projectPath: tmp.path,
      cases: {
        runId: "contribution-run",
        ingestCases: [
          {
            caseId: "weekly-plan",
            sourceName: "周计划zz.xlsx",
            expectedContribution: "task_cards",
            acceptedDocRoles: ["meeting_task_source"],
            minTaskCards: 1,
            mustEnterTaskIndex: true,
          },
          {
            caseId: "monthly-meeting",
            sourceName: "朗格运营月会-12月.xlsx",
            expectedContribution: "task_cards",
            acceptedDocRoles: ["meeting_task_source"],
            minTaskCards: 1,
            mustEnterTaskIndex: true,
          },
          {
            caseId: "case-template",
            sourceName: "周会模板案例-孙芷倩.docx",
            expectedContribution: "template_rules",
            requireTaskRulePack: true,
            mustNotEnterTaskIndex: true,
          },
          {
            caseId: "table-template",
            sourceName: "周会表格模版-运营部主管周会.xlsx",
            expectedContribution: "template_rules",
            requireTaskRulePack: true,
            mustNotEnterTaskIndex: true,
          },
        ],
      },
      llmConfig: null,
      generatedAt: "2026-05-22T00:00:00.000Z",
    })

    const weekly = result.report.ingestResults.find((item) => item.caseId === "weekly-plan")
    const monthly = result.report.ingestResults.find((item) => item.caseId === "monthly-meeting")
    const caseTemplate = result.report.ingestResults.find((item) => item.caseId === "case-template")
    const tableTemplate = result.report.ingestResults.find((item) => item.caseId === "table-template")

    expect(weekly).toMatchObject({
      expectedContribution: "task_cards",
      actualContribution: "context_only",
      contributionStatus: "fail",
      status: "fail",
    })
    expect(weekly?.failureReason).toContain("期望生成任务卡")
    expect(monthly).toMatchObject({
      expectedContribution: "task_cards",
      actualContribution: "task_cards",
      contributionStatus: "warn",
      status: "warn",
    })
    expect(monthly?.failureReason).toContain("只生成 needs_review")
    expect(caseTemplate).toMatchObject({
      expectedContribution: "template_rules",
      actualContribution: "context_only",
      contributionStatus: "fail",
      status: "fail",
    })
    expect(caseTemplate?.failureReason).toContain("模板未沉淀规则")
    expect(tableTemplate).toMatchObject({
      expectedContribution: "template_rules",
      actualContribution: "mixed",
      contributionStatus: "fail",
      status: "fail",
    })
    expect(tableTemplate?.failureReason).toContain("模板污染任务索引")

    const scorecard = await readFileRaw(`${result.outputDir}/scorecard.md`)
    expect(scorecard).toContain("Expected Contribution")
    expect(scorecard).toContain("Actual Contribution")
    expect(scorecard).toContain("Contribution Status")
  })

  it("reports 100 percent task extraction completion when every task-card source enters the task index", async () => {
    const tmp = await createTempProject("task-quality-judge-completion")
    cleanup = tmp.cleanup

    const weeklyTask = {
      ...makeTaskIndex().entries[0],
      taskId: "weekly-real-task",
      sourceName: "周计划zz.xlsx",
      sourceDocId: "doc-weekly",
      qualityBand: "needs_review" as const,
      status: "needs_review" as const,
      qualityScore: 68,
      missingElements: ["acceptanceMetrics"],
      sourceRefs: ["raw/sources/周计划zz.xlsx#sheet=Sheet1&range=A1:H2"],
    }
    const monthlyTask = {
      ...makeTaskIndex().entries[1],
      taskId: "monthly-real-task",
      sourceName: "朗格运营月会-12月.xlsx",
      sourceDocId: "doc-monthly",
      qualityBand: "needs_review" as const,
      status: "needs_review" as const,
      qualityScore: 61,
      sourceRefs: ["raw/sources/朗格运营月会-12月.xlsx#sheet=12月&range=A1:H2"],
    }
    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/task-context-packs/weekly.json`,
      JSON.stringify(makePack({
        packId: "tcp-weekly",
        sourceDocId: "doc-weekly",
        sourceName: "周计划zz.xlsx",
        docRole: "meeting_task_source",
        sourcePolicy: {
          sourceDocRole: "meeting_task_source",
          canGenerateTaskCards: true,
          canProvideRules: false,
          canProvideRoleContext: false,
          canProvideMetrics: true,
          defaultIndexVisibility: "task_index",
        },
        taskCandidates: [{ ...weeklyTask, sourceDocType: "meeting_task_source" } as any],
        taskQualitySummary: {
          total: 1,
          ready: 0,
          needsReview: 1,
          averageScore: 68,
          topMissingElements: ["acceptanceMetrics"],
        },
      }), null, 2),
    )
    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/task-context-packs/monthly.json`,
      JSON.stringify(makePack({
        packId: "tcp-monthly",
        sourceDocId: "doc-monthly",
        sourceName: "朗格运营月会-12月.xlsx",
        docRole: "meeting_task_source",
        sourcePolicy: {
          sourceDocRole: "meeting_task_source",
          canGenerateTaskCards: true,
          canProvideRules: false,
          canProvideRoleContext: false,
          canProvideMetrics: true,
          defaultIndexVisibility: "task_index",
        },
        taskCandidates: [{ ...monthlyTask, sourceDocType: "meeting_task_source" } as any],
        taskQualitySummary: {
          total: 1,
          ready: 0,
          needsReview: 1,
          averageScore: 61,
          topMissingElements: ["acceptanceMetrics"],
        },
      }), null, 2),
    )
    await realFs.writeFile(
      `${tmp.path}/.llm-wiki/task-index.json`,
      JSON.stringify({
        ...makeTaskIndex(),
        entries: [weeklyTask, monthlyTask],
      }, null, 2),
    )
    await realFs.writeFile(`${tmp.path}/.llm-wiki/quality-report.json`, JSON.stringify({}, null, 2))

    const result = await runTaskQualityLlmJudge({
      projectPath: tmp.path,
      cases: {
        runId: "completion-run",
        ingestCases: [
          {
            caseId: "weekly-plan",
            sourceName: "周计划zz.xlsx",
            expectedContribution: "task_cards",
            minTaskCards: 1,
            mustEnterTaskIndex: true,
          },
          {
            caseId: "monthly-meeting",
            sourceName: "朗格运营月会-12月.xlsx",
            expectedContribution: "task_cards",
            minTaskCards: 1,
            mustEnterTaskIndex: true,
          },
        ],
      },
      llmConfig: null,
      generatedAt: "2026-05-22T00:00:00.000Z",
    })

    expect(result.report.layerSummary.taskExtraction.mainProblem).toContain("任务源抽取完成率：100%")
    expect(result.report.ingestResults.map((item) => item.taskExtractionComplete)).toEqual([true, true])
    expect(result.report.ingestResults.map((item) => item.status)).toEqual(["warn", "warn"])
    const scorecard = await readFileRaw(`${result.outputDir}/scorecard.md`)
    expect(scorecard).toContain("Task Candidates")
    expect(scorecard).toContain("Indexed Tasks")
  })
})
