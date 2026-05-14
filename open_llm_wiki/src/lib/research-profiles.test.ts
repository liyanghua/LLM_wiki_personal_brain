import { describe, expect, it } from "vitest"
import {
  buildOpportunityCardsFromReport,
  getResearchProfile,
  marketOpportunityReportSections,
} from "./research-profiles"
import type { ResearchSession } from "./research-types"

function makeSession(overrides: Partial<ResearchSession> = {}): ResearchSession {
  return {
    sessionId: "research-session-1",
    topic: "AI 主图设计工具市场机会",
    projectPath: "/tmp/project",
    linkedDocId: null,
    targetFieldKey: null,
    triggerSource: "manual",
    breadth: 3,
    depth: 2,
    focus: null,
    status: "done",
    phase: "save_research_asset",
    createdAt: 1,
    updatedAt: 2,
    followUpQuestions: [],
    userAnswers: ["重点关注中小电商团队"],
    plannedQueries: [],
    sources: [
      {
        id: "source-1",
        query: "AI hero image ecommerce pain points",
        url: "https://example.com/source-a",
        title: "Ecommerce creative testing report",
        snippet: "Small merchants struggle to test hero image variants.",
        source: "firecrawl",
        rawContent: null,
        reliabilityNote: "行业报告",
        learnedFacts: ["中小商家缺少持续测试主图素材的能力。"],
        openFollowUps: [],
      },
      {
        id: "source-2",
        query: "creative automation competitor",
        url: "https://example.com/source-b",
        title: "Creative automation landscape",
        snippet: "Competitors focus on generation, less on validation workflow.",
        source: "firecrawl",
        rawContent: null,
        reliabilityNote: "竞品综述",
        learnedFacts: ["多数工具强调生成，较少覆盖验证闭环。"],
        openFollowUps: [],
      },
    ],
    learnings: [],
    pendingFollowUps: [],
    reportMarkdown: "",
    notesMarkdown: "",
    findings: [],
    opportunityCards: [],
    reportSections: null,
    thread: [],
    visitedQueries: [],
    currentRound: 2,
    providerStatus: null,
    runtime: {
      sessionId: "research-session-1",
      phase: "save_research_asset",
      status: "done",
      title: "研究已完成",
      detail: "done",
      currentRound: 2,
      maxDepth: 2,
      providerStatus: null,
      visitedUrls: [],
      learnings: [],
      followUpQuestions: [],
      pendingUserAnswers: [],
      currentQueries: [],
      acceptedSourcesCount: 2,
      completedArtifacts: [],
      errorMessage: null,
      canResume: true,
    },
    artifactDir: null,
    reportPath: null,
    sessionPath: null,
    sourcesPath: null,
    notesPath: null,
    opportunityCardsPath: null,
    errorMessage: null,
    ...overrides,
  }
}

describe("research profiles", () => {
  it("returns a market opportunity profile with opportunity-focused query dimensions", () => {
    const profile = getResearchProfile("market_opportunity_analysis")

    expect(profile.taskType).toBe("market_opportunity_analysis")
    expect(profile.reportSections).toEqual(marketOpportunityReportSections)
    expect(profile.buildFallbackQueries(makeSession())).toEqual(expect.arrayContaining([
      expect.stringContaining("目标客群"),
      expect.stringContaining("竞品"),
      expect.stringContaining("验证实验"),
    ]))
  })

  it("builds evidence-grounded opportunity cards from a report", () => {
    const session = makeSession()
    const report = [
      "## 机会卡片矩阵",
      "### 机会一：面向中小商家的主图测试助理",
      "- 目标客群：中小电商运营团队",
      "- 痛点：缺少持续测试主图细节的能力",
      "- 机会假设：把主图生成和点击率验证闭环结合",
      "- 竞品信号：现有工具偏生成，验证闭环不足",
      "- 风险：商家缺少足够流量验证",
      "- 验证实验：用 20 个 SKU 做 A/B 主图测试",
      "- 置信度：0.78",
      "",
      "### 机会二：主图素材 brief 协作模板",
      "- 目标客群：品牌设计与运营协作团队",
      "- 痛点：设计 brief 不稳定",
      "- 机会假设：把 SOP 转成可复用 brief",
      "- 风险：不同类目差异较大",
      "- 验证实验：选择 3 个类目做人工评审",
      "- 置信度：0.52",
    ].join("\n")

    const cards = buildOpportunityCardsFromReport(session, report)

    expect(cards).toHaveLength(2)
    expect(cards[0]).toMatchObject({
      title: "面向中小商家的主图测试助理",
      targetSegment: "中小电商运营团队",
      painPoint: "缺少持续测试主图细节的能力",
      opportunityHypothesis: "把主图生成和点击率验证闭环结合",
      status: "draft",
    })
    expect(cards[0].sourceUrls).toEqual(["https://example.com/source-a", "https://example.com/source-b"])
    expect(cards[0].validationExperiments).toEqual(["用 20 个 SKU 做 A/B 主图测试"])
    expect(cards[0].confidence).toBeCloseTo(0.78)
  })

  it("does not create opportunity cards when there are no sources", () => {
    const cards = buildOpportunityCardsFromReport(makeSession({ sources: [] }), "### 机会一：无证据机会")

    expect(cards).toEqual([])
  })
})
