import { describe, expect, it } from "vitest"
import { buildDocumentIR } from "./document-ir"
import {
  buildTaskContextPack,
  buildTaskWikiPages,
  extractTaskDocumentBlocks,
  extractWorkbookIRFromMarkdown,
} from "./task-context-pack"

describe("task context pack", () => {
  it("builds workbook IR and sheet blocks from spreadsheet markdown", () => {
    const markdown = [
      "## 周会复盘",
      "",
      "| 目标 | 问题 | 负责人 | 下周计划 | 验收指标 |",
      "| --- | --- | --- | --- | --- |",
      "| 提升转化率 | 新品点击差 | 运营主管 | 优化主图和直通车词包 | 转化率提升到 5% |",
      "",
      "## 岗位KPI",
      "",
      "| 岗位 | 职责 | KPI权重 | 协作对象 |",
      "| --- | --- | --- | --- |",
      "| 运营 | 制定经营计划 | 销售额40% | 推广/美工 |",
    ].join("\n")

    const workbook = extractWorkbookIRFromMarkdown({
      docId: "doc-1",
      sourcePath: "/project/raw/week.xlsx",
      sourceName: "week.xlsx",
      markdown,
    })

    expect(workbook.sheets.map((sheet) => sheet.sheetName)).toEqual(["周会复盘", "岗位KPI"])
    expect(workbook.sheets[0]?.inferredSheetType).toBe("weekly_review")
    expect(workbook.sheets[1]?.inferredSheetType).toBe("role_kpi")
    expect(workbook.sheets[0]?.blocks.some((block) => block.blockType === "action_plan")).toBe(true)
    expect(workbook.sheets[1]?.blocks.some((block) => block.blockType === "role_table")).toBe(true)
    expect(workbook.sheets[0]?.blocks[0]?.evidenceAnchors[0]).toContain("sheet=周会复盘")
  })

  it("builds task context pack from workbook and document blocks", () => {
    const sourceContent = [
      "# 月会复盘",
      "",
      "本月目标是提升贴饰平销，新品成功率低于预期。",
      "",
      "## 复盘要求",
      "",
      "- 运营负责人需要下周完成老链接排查。",
      "- 美工协同补齐主图细节图。",
    ].join("\n")
    const documentIr = buildDocumentIR("/project", "/project/raw/month.docx", sourceContent)
    const documentBlocks = extractTaskDocumentBlocks(documentIr)
    const workbook = extractWorkbookIRFromMarkdown({
      docId: "doc-1",
      sourcePath: "/project/raw/month.xlsx",
      sourceName: "month.xlsx",
      markdown: [
        "## 月会计划",
        "",
        "| 目标 | 问题 | 负责人 | 协同角色 | 动作 | 指标 |",
        "| --- | --- | --- | --- | --- | --- |",
        "| 提升平销 | 老链接下滑 | 运营 | 推广 | 排查关键词和素材 | 平销提升10% |",
      ].join("\n"),
    })

    const pack = buildTaskContextPack({
      docId: "doc-1",
      sourcePath: "/project/raw/month.xlsx",
      sourceName: "month.xlsx",
      sourceKind: "generic",
      workbook,
      documentBlocks,
    })

    expect(pack.docRole).toBe("meeting_task_source")
    expect(pack.operatingGoals.some((item) => item.text.includes("提升平销"))).toBe(true)
    expect(pack.roleProfiles.some((role) => role.roleName.includes("运营"))).toBe(true)
    expect(pack.taskCandidates).toHaveLength(1)
    expect(pack.taskCandidates[0]).toMatchObject({
      ownerRole: "运营",
      normalizedOwnerRole: "运营",
      collaboratorRoles: ["推广"],
      timeRange: { label: "monthly" },
      priority: "medium",
      status: "draft",
    })
    const task = pack.taskCandidates[0]
    expect(task).toBeDefined()
    expect(task?.quality).toMatchObject({
      level: "ready",
      missingElements: [],
    })
    expect(task?.quality?.completenessScore).toBeGreaterThanOrEqual(85)
    expect(task?.quality?.executableScore).toBeGreaterThanOrEqual(85)
    expect(task?.quality?.evidenceScore).toBe(100)
    expect(task?.qualityScore).toBe(task?.quality?.score)
    expect(task?.executableScore).toBe(task?.quality?.executableScore)
    expect(task?.importanceScore).toBeGreaterThan(0)
    expect(task?.sourceDocType).toBe("meeting_task_source")
    expect(task?.quality?.score).toBeGreaterThanOrEqual(85)
    expect(pack.taskQualitySummary).toMatchObject({
      total: 1,
      ready: 1,
      needsReview: 0,
    })
    expect(task?.acceptanceMetrics.join("\n")).toContain("平销提升10%")
  })

  it("marks task cards as needs_review when owner or acceptance metrics are missing", () => {
    const workbook = extractWorkbookIRFromMarkdown({
      docId: "doc-missing",
      sourcePath: "/project/raw/week.xlsx",
      sourceName: "week.xlsx",
      markdown: [
        "## 周会计划",
        "",
        "| 目标 | 问题 | 动作 |",
        "| --- | --- | --- |",
        "| 提升搜索访客 | 搜索下滑 | 重建关键词计划 |",
      ].join("\n"),
    })

    const pack = buildTaskContextPack({
      docId: "doc-missing",
      sourcePath: "/project/raw/week.xlsx",
      sourceName: "week.xlsx",
      sourceKind: "generic",
      workbook,
      documentBlocks: [],
    })

    expect(pack.taskCandidates).toHaveLength(1)
    const task = pack.taskCandidates[0]
    expect(task?.status).toBe("needs_review")
    expect(task?.quality?.missingElements).toEqual(
      expect.arrayContaining(["ownerRole", "acceptanceMetrics"]),
    )
    expect(task?.extractionWarnings).toEqual(
      expect.arrayContaining([
        "missing_owner_role",
        "missing_acceptance_metrics",
      ]),
    )
    expect(task?.quality?.level).toBe("needs_review")
    expect(pack.taskQualitySummary?.ready).toBe(0)
    expect(pack.taskQualitySummary?.needsReview).toBe(1)
    expect(pack.taskQualitySummary?.topMissingElements).toEqual(
      expect.arrayContaining(["ownerRole", "acceptanceMetrics"]),
    )
  })

  it("treats task mechanism documents as rules only and does not generate task cards", () => {
    const sourceContent = [
      "# 经营任务生成机制与质量体系",
      "",
      "经营任务必须包含经营目标、任务对象、经营问题、问题证据、策略路径、具体动作、Owner、协同角色、周期、验收指标、复盘要求、证据锚点。",
      "",
      "## 质量评分",
      "",
      "- 缺 owner 需要人工确认。",
      "- 缺验收指标不能进入可执行任务。",
      "",
      "## 生成过程",
      "",
      "- 目标、数据、SOP、复盘、组织角色共同生成。",
    ].join("\n")
    const documentIr = buildDocumentIR("/project", "/project/raw/经营任务生成机制与质量体系.md", sourceContent)
    const pack = buildTaskContextPack({
      docId: "doc-mechanism",
      sourcePath: "/project/raw/经营任务生成机制与质量体系.md",
      sourceName: "经营任务生成机制与质量体系.md",
      sourceKind: "generic",
      workbook: null,
      documentBlocks: extractTaskDocumentBlocks(documentIr),
    })

    expect(pack.docRole).toBe("task_mechanism_source")
    expect(pack.sourcePolicy).toMatchObject({
      canGenerateTaskCards: false,
      canProvideRules: true,
      defaultIndexVisibility: "context_only",
    })
    expect(pack.taskCandidates).toHaveLength(0)
    expect(pack.taskRulePack?.requiredElements).toEqual(
      expect.arrayContaining(["经营目标", "任务对象", "Owner", "验收指标", "证据锚点"]),
    )
    expect(pack.taskQualitySummary).toMatchObject({
      total: 0,
      ready: 0,
      needsReview: 0,
    })
  })

  it("compiles task meta strategy documents into taxonomy and rule packs only", () => {
    const sourceContent = [
      "# 任务生成元策略",
      "",
      "任务的维度拆解：任务模块、商品编号/ID、任务事项、任务目标、任务优先级、任务周期、任务验收标准、任务执行人、任务执行状态、任务结果反馈。",
      "",
      "## 电商运营周计划任务种类总结",
      "",
      "### 新品 / 新链接规划与上线类",
      "中价透明链接精细化上线 * 5",
      "",
      "### 老链接 / 存量商品增长优化类",
      "页面抓紧制作替换老页面",
      "",
      "### 客服与转化运营类",
      "9 月客服转化 46.94%，10 月目标 48%，询单定时检查",
    ].join("\n")
    const documentIr = buildDocumentIR("/project", "/project/raw/任务生成元策略.md", sourceContent)
    const pack = buildTaskContextPack({
      docId: "doc-meta",
      sourcePath: "/project/raw/任务生成元策略.md",
      sourceName: "任务生成元策略.md",
      sourceKind: "generic",
      workbook: null,
      documentBlocks: extractTaskDocumentBlocks(documentIr),
    })

    expect(pack.docRole).toBe("task_mechanism_source")
    expect(pack.taskCandidates).toHaveLength(0)
    expect(pack.taskTaxonomy?.modules.map((item) => item.moduleId)).toEqual(
      expect.arrayContaining(["new_product_launch", "existing_product_growth", "customer_conversion"]),
    )
    expect(pack.taskTaxonomy?.taskElements.map((item) => item.fieldKey)).toEqual(
      expect.arrayContaining(["taskModule", "productId", "taskItem", "taskStatus", "resultFeedback"]),
    )
    expect(pack.taskRulePack).toMatchObject({
      taxonomyRef: pack.taskTaxonomy?.taxonomyId,
    })
    expect(pack.taskRulePack?.moduleClassificationRules?.length).toBeGreaterThanOrEqual(7)
  })

  it("extracts ecommerce task fields from weekly plan rows", () => {
    const workbook = extractWorkbookIRFromMarkdown({
      docId: "doc-weekly-plan",
      sourcePath: "/project/raw/周计划.xlsx",
      sourceName: "运营周计划.xlsx",
      markdown: [
        "## 10月周计划",
        "",
        "| 商品ID | 负责人 | 协同角色 | 任务事项 | 任务目标 | 优先级 | 验收标准 | 状态 | 结果反馈 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 741405253807 | 运营负责人 | 推广/美工 | 直通车计划调优，优质计划做增长规划 | 老链接增长 | A1 | ROI提升10% | 已完成 | 调优后ROI提升10% |",
      ].join("\n"),
    })
    const pack = buildTaskContextPack({
      docId: "doc-weekly-plan",
      sourcePath: "/project/raw/周计划.xlsx",
      sourceName: "运营周计划.xlsx",
      sourceKind: "generic",
      workbook,
      documentBlocks: [],
    })

    const task = pack.taskCandidates[0]
    expect(task).toMatchObject({
      taskModule: "traffic_promotion",
      productId: "741405253807",
      taskItem: "直通车计划调优，优质计划做增长规划",
      taskStatus: "done",
      resultFeedback: expect.arrayContaining(["调优后ROI提升10%"]),
      priority: "critical",
    })
    expect(task?.quality?.missingElements).not.toContain("taskItem")
    expect(task?.quality?.missingElements).not.toContain("resultFeedback")
  })

  it("extracts multiple task cards from real weekly-plan style spreadsheet columns", () => {
    const workbook = extractWorkbookIRFromMarkdown({
      docId: "doc-weekly-plan-real-shape",
      sourcePath: "/project/raw/周计划zz.xlsx",
      sourceName: "周计划zz.xlsx",
      markdown: [
        "# 周计划zz",
        "",
        "## Sheet1",
        "",
        "| 时间<br>（执行周） | 计划模块 | 主图 | 商品/ID | 日期 | 计划节点/具体事项 | 优先级<br>（A1A2BC） | 执行人 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 第一周 | 新链接规划 |  |  | 10.14 | 中价透明链接精细化上线*5 | A1 | 曾钊 |",
        "| 第一周 | 老连接增长 |  | 实厚TPU<br>676674203821 | 10.12 | 直通车计划调优，优质计划做增长规划 | A1 | 曾钊 |",
        "| 第一周 | 老连接增长 |  | 实木圆桌741405253807 | 10.15 | 客服话术模仿TPU样式重新策划+催付话术 | A2 | 曾钊 |",
      ].join("\n"),
    })

    const pack = buildTaskContextPack({
      docId: "doc-weekly-plan-real-shape",
      sourcePath: "/project/raw/周计划zz.xlsx",
      sourceName: "周计划zz.xlsx",
      sourceKind: "xlsx",
      workbook,
      documentBlocks: [],
    })

    expect(pack.docRole).toBe("meeting_task_source")
    expect(pack.taskCandidates).toHaveLength(3)
    expect(pack.taskCandidates.map((task) => task.ownerRole)).toEqual(["曾钊", "曾钊", "曾钊"])
    expect(pack.taskCandidates.map((task) => task.taskModule)).toEqual([
      "new_product_launch",
      "traffic_promotion",
      "customer_conversion",
    ])
    expect(pack.taskCandidates[1]?.productId).toBe("676674203821")
    expect(pack.taskQualitySummary?.total).toBe(3)
  })

  it("extracts task cards from spreadsheet markdown with wrapped header and cell lines", () => {
    const workbook = extractWorkbookIRFromMarkdown({
      docId: "doc-weekly-plan-wrapped-cells",
      sourcePath: "/project/raw/周计划zz.xlsx",
      sourceName: "周计划zz.xlsx",
      markdown: [
        "| 时间",
        "（执行周） | 计划模块 | 主图 | 商品/ID | 日期 | 计划节点/具体事项 | 优先级",
        "（A1A2BC） | 执行人 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 第一周 | 新链接规划 |  |  | 10.14 | 中价透明链接精细化上线*5 | A1 | 曾钊 |",
        "| 第一周 | 老连接增长 |  | 实厚TPU",
        "676674203821 | 10.12 | 2.直通车计划调优，优质计划做增长规划 | A1 | 曾钊 |",
        "| 第一周 | 老连接增长 |  | 实木圆桌741405253807 | 10.15 | 2.客服话术模仿TPU样式重新策划+催付话术 | A2 | 曾钊 |",
      ].join("\n"),
    })

    const pack = buildTaskContextPack({
      docId: "doc-weekly-plan-wrapped-cells",
      sourcePath: "/project/raw/周计划zz.xlsx",
      sourceName: "周计划zz.xlsx",
      sourceKind: "xlsx",
      workbook,
      documentBlocks: [],
    })

    expect(workbook.sheets[0]?.headers).toEqual([
      "时间（执行周）",
      "计划模块",
      "主图",
      "商品/ID",
      "日期",
      "计划节点/具体事项",
      "优先级（A1A2BC）",
      "执行人",
    ])
    expect(pack.docRole).toBe("meeting_task_source")
    expect(pack.taskCandidates).toHaveLength(3)
    expect(pack.taskCandidates.map((task) => task.taskItem)).toEqual([
      "中价透明链接精细化上线*5",
      "2.直通车计划调优，优质计划做增长规划",
      "2.客服话术模仿TPU样式重新策划+催付话术",
    ])
    expect(pack.taskCandidates[1]?.productId).toBe("676674203821")
    expect(pack.taskCandidates.map((task) => task.ownerRole)).toEqual(["曾钊", "曾钊", "曾钊"])
  })

  it("treats role/KPI documents as role context only and does not generate task cards", () => {
    const workbook = extractWorkbookIRFromMarkdown({
      docId: "doc-role",
      sourcePath: "/project/raw/role.xlsx",
      sourceName: "role.xlsx",
      markdown: [
        "## 岗位KPI",
        "",
        "| 岗位 | 职责 | KPI | 权重 | 协作对象 |",
        "| --- | --- | --- | --- | --- |",
        "| 运营负责人 | 负责销售目标拆解 | 销售额达成率 | 40% | 推广/美工 |",
      ].join("\n"),
    })
    const pack = buildTaskContextPack({
      docId: "doc-role",
      sourcePath: "/project/raw/role.xlsx",
      sourceName: "role.xlsx",
      sourceKind: "generic",
      workbook,
      documentBlocks: [],
    })

    expect(pack.docRole).toBe("role_kpi_source")
    expect(pack.sourcePolicy).toMatchObject({
      canGenerateTaskCards: false,
      canProvideRoleContext: true,
      canProvideMetrics: true,
      defaultIndexVisibility: "context_only",
    })
    expect(pack.taskCandidates).toHaveLength(0)
    expect(pack.roleContextIndex?.roles[0]).toMatchObject({
      roleName: "运营负责人",
      responsibilities: ["负责销售目标拆解"],
      kpis: expect.arrayContaining(["销售额达成率", "40%"]),
      collaboratorRoles: ["推广", "美工"],
    })
  })

  it("renders stable task wiki pages from task context pack", () => {
    const workbook = extractWorkbookIRFromMarkdown({
      docId: "doc-2",
      sourcePath: "/project/raw/kpi.xlsx",
      sourceName: "kpi.xlsx",
      markdown: [
        "## 岗位KPI",
        "",
        "| 岗位 | 职责 | KPI | 权重 | 协作对象 |",
        "| --- | --- | --- | --- | --- |",
        "| 运营 | 负责销售目标拆解 | 销售额 | 40% | 推广/美工 |",
      ].join("\n"),
    })
    const pack = buildTaskContextPack({
      docId: "doc-2",
      sourcePath: "/project/raw/kpi.xlsx",
      sourceName: "kpi.xlsx",
      sourceKind: "generic",
      workbook,
      documentBlocks: [],
    })

    const pages = buildTaskWikiPages(pack, "kpi")

    expect(pages.map((page) => page.path)).toEqual([
      "wiki/roles/kpi.md",
      "wiki/quality/kpi.md",
      "wiki/collaboration/kpi.md",
      "wiki/reviews/kpi.md",
    ])
    expect(pages.find((page) => page.path.includes("/roles/"))?.content).toContain("运营")
    expect(pages.find((page) => page.path.includes("/quality/"))?.content).toContain("销售额")
    expect(pages.find((page) => page.path.includes("/quality/"))?.content).toContain("任务卡质量汇总")
  })
})
