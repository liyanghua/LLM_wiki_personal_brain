import { describe, expect, it } from "vitest"
import {
  formatBusinessText,
  strategyActionStatusLabel,
  strategyCardTypeLabel,
  skillTierLabel,
  skillTierDescription,
  skillCandidateDisplayName,
  agentRunStatusLabel,
  buildAgentRunBusinessSections,
  buildExecutionTimelineItems,
  buildSkillStepExecutionItems,
  executionTimelineStatusLabel,
  formatDegradationReason,
  formatExecutionDuration,
  skillStepStatusLabel,
  skillStepTaskTypeLabel,
  strategyInputFieldExample,
  strategyInputFieldHelp,
  strategyInputFieldLabel,
} from "@/lib/strategy-display"
import type { StrategySkillCandidateManifest } from "@/lib/agent-mode-types"

describe("strategy display formatters", () => {
  it("translates strategy enums and skill tiers into business-facing Chinese", () => {
    expect(strategyCardTypeLabel("creative_asset_brief_generation")).toBe("素材表达")
    expect(strategyCardTypeLabel("metric_signal_diagnosis")).toBe("指标判断")
    expect(strategyActionStatusLabel("draft")).toBe("待确认")
    expect(strategyActionStatusLabel("confirmed")).toBe("已确认")
    expect(strategyActionStatusLabel("rejected")).toBe("暂不采用")
    expect(strategyActionStatusLabel("promoted_to_skill")).toBe("可生成能力")
    expect(skillTierLabel("pilot")).toBe("试运行")
    expect(skillTierLabel("stable")).toBe("正式启用")
    expect(skillTierDescription("pilot")).toContain("人工触发验证")
    expect(skillTierDescription("stable")).toContain("常用业务能力")
  })

  it("normalizes English technical terms in visible strategy text", () => {
    expect(formatBusinessText("CTR 低且 CVR 弱，ROI 需要 A/B test 验证")).toBe(
      "点击率低且转化率弱，投入产出比需要 A/B 测试验证",
    )
    expect(formatBusinessText("generate asset brief with generic strategy-action")).toBe(
      "生成素材说明与通用业务策略动作卡",
    )
    expect(formatBusinessText("运行模式：generate_asset_brief")).toBe("运行模式：生成素材说明")
  })

  it("uses manifest title as the candidate display name instead of raw skillId", () => {
    const manifest: StrategySkillCandidateManifest = {
      skillId: "default-business-scene-主图设计-1qibu6-generic-strategy-action-1778466979125-omhtw4",
      family: "creative_asset_brief_generation",
      title: "素材表达：生成主图素材 brief",
      summary: "当点击率偏低时，生成可交付设计的主图素材 brief。",
      sceneId: "ecom_growth_hero_image",
      linkedDocIds: ["doc-1"],
      originStrategyCardIds: [],
      originActionCardIds: ["action-1"],
      wikiRefs: [],
      sourceRefs: [],
      validationCriteria: ["点击率"],
      requiredInputs: ["目标人群"],
      outputArtifact: "主图素材 brief",
      actionSteps: ["确认目标人群。"],
      schemaVersion: 2,
      promotionState: "candidate",
      generatedAt: "2026-05-11T00:00:00.000Z",
    }

    expect(skillCandidateDisplayName(manifest)).toBe("素材表达：生成主图素材说明")
  })

  it("provides business-facing labels and reusable examples for agent input fields", () => {
    expect(strategyInputFieldLabel("objective")).toBe("本次要产出的业务结果")
    expect(strategyInputFieldLabel("decision_rules")).toBe("业务判断规则")
    expect(strategyInputFieldLabel("current_ctr_data")).toBe("当前点击率数据")
    expect(strategyInputFieldLabel("current_hero_image_urls")).toBe("当前主图链接或截图路径")
    expect(strategyInputFieldExample("decision_rules")).toContain("点击率低于类目均值")
    expect(strategyInputFieldExample("current_ctr_data")).toContain("近 7 天曝光")
    expect(strategyInputFieldHelp("current_hero_image_urls")[0]).toContain("图片 URL")
  })

  it("formats agent run structured output as business-facing sections", () => {
    expect(agentRunStatusLabel("degraded")).toBe("已降级生成")

    const sections = buildAgentRunBusinessSections({
      output_artifact: "主图素材 brief",
      diagnosis: "CTR 偏低，CVR 正常",
      recommended_changes: ["强化首屏卖点"],
      action_steps: ["确认目标人群", "输出素材 brief"],
      validation_plan: "观察 CTR 与 CVR",
      evidence_refs: ["block-1"],
      wiki_refs: ["wiki/business/demo.md"],
      review_notes: ["确认当前主图截图"],
    })

    expect(sections.map((item) => item.title)).toEqual([
      "交付产物",
      "诊断结论",
      "建议动作",
      "执行步骤",
      "验证计划",
      "依据来源",
      "待专家确认",
    ])
    expect(sections[0].body).toBe("主图素材说明")
    expect(sections[1].body).toBe("点击率偏低，转化率正常")
    expect(sections[2].items).toEqual(["强化首屏卖点"])
  })

  it("formats agent execution observability details for display", () => {
    expect(executionTimelineStatusLabel("degraded")).toBe("已降级")
    expect(formatExecutionDuration(0)).toBe("瞬时")
    expect(formatExecutionDuration(1250)).toBe("1.3s")
    expect(formatDegradationReason({
      code: "llm_provider_unavailable",
      title: "模型服务不可用，已降级生成",
      detail: "缺少 OPENAI_API_KEY。",
      recoverable: true,
      recommendedAction: "请配置模型 Key 后重试。",
    })).toContain("请配置模型 Key")
    expect(buildExecutionTimelineItems([
      {
        phase: "call_model",
        status: "failed",
        title: "调用模型",
        detail: "模型不可用",
        startedAt: "2026-05-11T00:00:00.000Z",
        endedAt: "2026-05-11T00:00:01.000Z",
        durationMs: 1000,
        severity: "warning",
        data: {},
      },
      {
        phase: "",
        status: "completed",
        title: "",
        detail: "",
        startedAt: "",
        endedAt: "",
        durationMs: 0,
        severity: "info",
      },
    ])).toHaveLength(1)
  })

  it("formats skill step executions as visible business progress", () => {
    expect(skillStepStatusLabel("completed")).toBe("已完成")
    expect(skillStepStatusLabel("degraded")).toBe("模板兜底")
    expect(skillStepTaskTypeLabel("read_file")).toBe("读取文件")
    expect(skillStepTaskTypeLabel("data_transform")).toBe("数据整理")

    const steps = buildSkillStepExecutionItems([
      {
        stepIndex: 2,
        stepTitle: "输出素材说明。",
        taskType: "data_transform",
        inputRefs: ["核心卖点"],
        contextRefs: ["wiki/business/demo.md"],
        status: "degraded",
        reasoningSummary: "围绕素材说明生成保守草案。",
        stepOutput: "生成一版主图素材说明草案。",
        evidenceRefs: ["block-1"],
        validationNotes: ["模板兜底：请专家确认该步骤产出。"],
        nextConstraints: [],
        startedAt: "2026-05-11T00:00:00.000Z",
        endedAt: "2026-05-11T00:00:01.000Z",
        durationMs: 1000,
      },
      {
        stepIndex: 1,
        stepTitle: "确认目标人群。",
        taskType: "data_extract",
        inputRefs: ["儿童学习桌垫购买决策者"],
        contextRefs: [],
        status: "completed",
        stepOutput: "目标人群是家长。",
        evidenceRefs: [],
        validationNotes: [],
        startedAt: "2026-05-11T00:00:00.000Z",
        endedAt: "2026-05-11T00:00:00.500Z",
        durationMs: 500,
      },
    ])

    expect(steps.map((item) => item.stepIndex)).toEqual([1, 2])
    expect(steps[0].stepOutput).toBe("目标人群是家长。")
  })
})
