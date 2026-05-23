import { afterEach, describe, expect, it, vi } from "vitest"
import { realFs, createTempProject } from "@/test-helpers/fs-temp"
import type { TaskIndex } from "./task-index"
import { formatTaskCardsForPrompt, groupTaskSearchResults, searchTaskCards } from "./task-search"

vi.mock("@/commands/fs", () => realFs)

let cleanup: (() => Promise<void>) | null = null

afterEach(async () => {
  if (cleanup) {
    await cleanup()
    cleanup = null
  }
})

function makeIndex(): TaskIndex {
  return {
    schemaVersion: "task_index_v1",
    generatedAt: "2026-05-20T00:00:00.000Z",
    entries: [
      {
        taskId: "task-ready",
        title: "优化主图点击率",
        taskModule: "visual_content",
        taskModuleLabel: "商品视觉与内容创作",
        productId: "741405253807",
        taskItem: "优化主图细节图",
        taskStatus: "in_progress",
        resultFeedback: [],
        ownerRole: "运营负责人",
        normalizedOwnerRole: "运营负责人",
        collaboratorRoles: ["美工"],
        timeRange: { label: "2026-05", start: "2026-05-01", end: "2026-05-31" },
        cadence: "weekly",
        priority: "high",
        importanceScore: 90,
        executableScore: 92,
        qualityScore: 94,
        qualityBand: "ready",
        status: "draft",
        targetObject: "主图",
        problemEvidence: ["点击率下滑"],
        actionSteps: ["优化主图细节图"],
        acceptanceMetrics: ["点击率提升10%"],
        reviewRequirement: "下周周会复盘",
        missingElements: [],
        sourceRefs: ["raw/week.xlsx#sheet=周会"],
        wikiRefs: ["wiki/tasks/week.md"],
        sourceDocId: "doc-week",
        sourceName: "运营周会.xlsx",
        sourceDocType: "meeting_task_source",
        generationSource: "meeting_action",
        completionSources: [],
        rulePackRefs: [],
        roleContextRefs: [],
      },
      {
        taskId: "task-review",
        title: "整理活动复盘",
        taskModule: "unknown",
        taskModuleLabel: "待分类",
        productId: "",
        taskItem: "整理活动复盘",
        taskStatus: "unknown",
        resultFeedback: [],
        ownerRole: "待确认",
        normalizedOwnerRole: "",
        collaboratorRoles: [],
        timeRange: { label: "2026-05" },
        cadence: "weekly",
        priority: "medium",
        importanceScore: 50,
        executableScore: 45,
        qualityScore: 58,
        qualityBand: "needs_review",
        status: "needs_review",
        targetObject: "活动",
        problemEvidence: ["复盘材料缺失"],
        actionSteps: ["整理活动复盘"],
        acceptanceMetrics: [],
        reviewRequirement: "周会复盘",
        missingElements: ["ownerRole", "acceptanceMetrics"],
        sourceRefs: ["raw/week.xlsx#sheet=周会"],
        wikiRefs: ["wiki/tasks/week.md"],
        sourceDocId: "doc-week",
        sourceName: "运营周会.xlsx",
        sourceDocType: "meeting_task_source",
        generationSource: "meeting_action",
        completionSources: [],
        rulePackRefs: [],
        roleContextRefs: [],
      },
      {
        taskId: "task-other-month",
        title: "优化客服响应",
        taskModule: "customer_conversion",
        taskModuleLabel: "客服与转化运营",
        productId: "",
        taskItem: "优化客服 SOP",
        taskStatus: "done",
        resultFeedback: ["响应时长下降"],
        ownerRole: "客服主管",
        normalizedOwnerRole: "客服主管",
        collaboratorRoles: [],
        timeRange: { label: "2026-04", start: "2026-04-01", end: "2026-04-30" },
        cadence: "monthly",
        priority: "high",
        importanceScore: 85,
        executableScore: 85,
        qualityScore: 88,
        qualityBand: "ready",
        status: "draft",
        targetObject: "客服",
        problemEvidence: ["响应慢"],
        actionSteps: ["优化客服 SOP"],
        acceptanceMetrics: ["响应时长下降"],
        reviewRequirement: "月会复盘",
        missingElements: [],
        sourceRefs: ["raw/month.xlsx#sheet=月会"],
        wikiRefs: ["wiki/tasks/month.md"],
        sourceDocId: "doc-month",
        sourceName: "运营月会.xlsx",
        sourceDocType: "meeting_task_source",
        generationSource: "meeting_action",
        completionSources: [],
        rulePackRefs: [],
        roleContextRefs: [],
      },
      {
        taskId: "task-mechanism-pollution",
        title: "目标、数据、SOP、复盘、组织角色共同生成",
        taskModule: "unknown",
        taskModuleLabel: "待分类",
        productId: "",
        taskItem: "目标、数据、SOP、复盘、组织角色共同生成",
        taskStatus: "unknown",
        resultFeedback: [],
        ownerRole: "待确认",
        normalizedOwnerRole: "",
        collaboratorRoles: [],
        timeRange: { label: "待确认" },
        cadence: "待确认",
        priority: "unknown",
        importanceScore: 50,
        executableScore: 1,
        qualityScore: 1,
        qualityBand: "needs_review",
        status: "needs_review",
        targetObject: "任务机制",
        problemEvidence: [],
        actionSteps: [],
        acceptanceMetrics: [],
        reviewRequirement: "机制文档只做规则",
        missingElements: ["ownerRole", "acceptanceMetrics"],
        sourceRefs: ["raw/经营任务生成机制与质量体系.md#block"],
        wikiRefs: ["wiki/tasks/经营任务生成机制与质量体系.md"],
        sourceDocId: "doc-mechanism",
        sourceName: "经营任务生成机制与质量体系.md",
        sourceDocType: "task_mechanism_source",
        generationSource: "meeting_action",
        completionSources: [],
        rulePackRefs: [],
        roleContextRefs: [],
      },
    ],
    summary: {
      total: 4,
      ready: 2,
      needsReview: 1,
      averageQualityScore: 80,
      averageExecutableScore: 74,
      byOwnerRole: { "运营负责人": 1, "客服主管": 1 },
      byCadence: { weekly: 2, monthly: 1 },
      byPriority: { high: 2, medium: 1 },
      byTaskModule: { visual_content: 1, customer_conversion: 1, unknown: 2 },
      byTaskStatus: { in_progress: 1, done: 1, unknown: 2 },
      topMissingElements: ["ownerRole", "acceptanceMetrics"],
    },
  }
}

describe("task search", () => {
  it("filters by role and time while ranking ready high-quality tasks first", async () => {
    const tmp = await createTempProject("task-search")
    cleanup = tmp.cleanup
    await realFs.writeFile(`${tmp.path}/.llm-wiki/task-index.json`, JSON.stringify(makeIndex(), null, 2))

    const hits = await searchTaskCards(tmp.path, "运营负责人 5月 任务列表", {
      role: "运营负责人",
      startDate: "2026-05-01",
      endDate: "2026-05-31",
      includeNeedsReview: true,
    })

    expect(hits.map((hit) => hit.entry.taskId)).toEqual(["task-ready"])
    expect(hits[0]?.qualityBand).toBe("ready")
    expect(hits[0]?.matchedReasons).toEqual(expect.arrayContaining(["角色匹配：运营负责人", "时间匹配：2026-05"]))
  })

  it("can include needs-review tasks when no owner is available", async () => {
    const tmp = await createTempProject("task-search-review")
    cleanup = tmp.cleanup
    await realFs.writeFile(`${tmp.path}/.llm-wiki/task-index.json`, JSON.stringify(makeIndex(), null, 2))

    const hits = await searchTaskCards(tmp.path, "5月 活动复盘 任务列表", {
      startDate: "2026-05-01",
      endDate: "2026-05-31",
      includeNeedsReview: true,
    })

    expect(hits.map((hit) => hit.entry.taskId)).toContain("task-review")
    expect(hits.find((hit) => hit.entry.taskId === "task-review")?.qualityBand).toBe("needs_review")
  })

  it("does not return task mechanism pollution even when old indexes still contain it", async () => {
    const tmp = await createTempProject("task-search-mechanism-filter")
    cleanup = tmp.cleanup
    await realFs.writeFile(`${tmp.path}/.llm-wiki/task-index.json`, JSON.stringify(makeIndex(), null, 2))

    const hits = await searchTaskCards(tmp.path, "经营任务生成机制 任务列表", {
      includeNeedsReview: true,
    })

    expect(hits.map((hit) => hit.entry.taskId)).not.toContain("task-mechanism-pollution")
  })

  it("filters by task module, product id, and business task status", async () => {
    const tmp = await createTempProject("task-search-module")
    cleanup = tmp.cleanup
    await realFs.writeFile(`${tmp.path}/.llm-wiki/task-index.json`, JSON.stringify(makeIndex(), null, 2))

    const productHits = await searchTaskCards(tmp.path, "741405253807 主图任务", {
      taskModule: "visual_content",
      productId: "741405253807",
      includeNeedsReview: true,
    })
    expect(productHits.map((hit) => hit.entry.taskId)).toEqual(["task-ready"])

    const doneHits = await searchTaskCards(tmp.path, "客服转化已完成任务", {
      taskModule: "customer_conversion",
      taskStatus: "done",
      includeNeedsReview: true,
    })
    expect(doneHits.map((hit) => hit.entry.taskId)).toEqual(["task-other-month"])
  })

  it("groups task hits into ready and needs_review sections with ready first", () => {
    const grouped = groupTaskSearchResults([
      {
        entry: makeIndex().entries[1] as any,
        matchScore: 31,
        rankScore: 55,
        matchedReasons: ["内容命中任务标题/动作/指标"],
        qualityBand: "needs_review",
      },
      {
        entry: makeIndex().entries[0] as any,
        matchScore: 72,
        rankScore: 94,
        matchedReasons: ["角色匹配：运营负责人"],
        qualityBand: "ready",
      },
    ])

    expect(grouped.ordered.map((hit) => hit.entry.taskId)).toEqual(["task-ready", "task-review"])
    expect(grouped.ready.count).toBe(1)
    expect(grouped.needsReview.count).toBe(1)
    expect(grouped.ready.tasks[0]?.entry.taskId).toBe("task-ready")
    expect(grouped.needsReview.tasks[0]?.entry.taskId).toBe("task-review")
  })

  it("renders grouped task cards in prompt order", () => {
    const prompt = formatTaskCardsForPrompt([
      {
        entry: makeIndex().entries[1] as any,
        matchScore: 31,
        rankScore: 55,
        matchedReasons: ["内容命中任务标题/动作/指标"],
        qualityBand: "needs_review",
      },
      {
        entry: makeIndex().entries[0] as any,
        matchScore: 72,
        rankScore: 94,
        matchedReasons: ["角色匹配：运营负责人"],
        qualityBand: "ready",
      },
    ])

    expect(prompt).toContain("### 可候选执行")
    expect(prompt).toContain("### 需补齐")
    expect(prompt).toContain("module: 商品视觉与内容创作")
    expect(prompt).toContain("productId: 741405253807")
    expect(prompt.indexOf("### 可候选执行")).toBeLessThan(prompt.indexOf("### 需补齐"))
    expect(prompt).toContain("共同缺失")
  })
})
