import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { getFileStem, normalizePath } from "@/lib/path-utils"
import type {
  AgentModeReport,
  CompileCoverageEntry,
  CompileCoverageReport,
  CompileIR,
  GroundTruthFieldValue,
  SceneCompilePagePlan,
  SceneCompilePlan,
  ScenePack,
} from "@/lib/agent-mode-types"

export interface SceneCompileArtifacts {
  docSlug: string
  plan: SceneCompilePlan
  compileIr: CompileIR
  compileCoverage: CompileCoverageReport
  supportingWikiPages: string[]
  warnings: string[]
}

export interface SceneCompileWriteResult extends SceneCompileArtifacts {
  writtenPaths: string[]
}

interface SceneFieldDef {
  key: string
  label: string
  required: boolean
  pageKey?: string
  sectionKey?: string
}

interface RenderedPage {
  pageKey: SceneCompilePagePlan["pageKey"]
  path: string
  content: string
}

const PAGE_TITLE_BY_KEY = {
  business_index: "业务总览",
  mainline_steps: "主链路步骤",
  key_judgements: "关键判断",
  boundaries: "边界与例外",
  evidence_cases: "证据与案例",
  source_summary: "来源摘要",
  mindmap_structure: "脑图结构",
  hero_audiences: "人群与场景",
  hero_value_props: "卖点与表达",
  hero_creative_assets: "素材与版式",
  hero_metric_judgement: "指标与判断",
  hero_actions_experiments: "动作与实验",
} satisfies Record<SceneCompilePagePlan["pageKey"], string>

function todayString(): string {
  return new Date().toISOString().slice(0, 10)
}

function nowIso(): string {
  return new Date().toISOString()
}

function slugifySourceName(sourceName: string): string {
  return getFileStem(sourceName)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function asTrimmedString(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim()
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    for (const key of ["value", "text", "label", "title", "content", "name"]) {
      const candidate = record[key]
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim()
      }
    }
  }
  return ""
}

function uniq(items: readonly unknown[]): string[] {
  return Array.from(new Set(items.map((item) => asTrimmedString(item)).filter(Boolean)))
}

function trimLines(value: string): string[] {
  return value
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizePageKey(value: unknown): SceneCompilePagePlan["pageKey"] | null {
  const raw = String(value ?? "").trim().toLowerCase()
  if (!raw) return null
  if (raw === "index" || raw === "business_index" || raw === "overview") return "business_index"
  if (raw === "mainline_steps" || raw === "steps" || raw === "process" || raw === "process_steps") return "mainline_steps"
  if (raw === "key_judgements" || raw === "judgements" || raw === "judgment_criteria") return "key_judgements"
  if (raw === "boundaries" || raw === "boundary" || raw === "exceptions") return "boundaries"
  if (raw === "evidence_cases" || raw === "evidence" || raw === "cases" || raw === "validation") return "evidence_cases"
  if (raw === "mindmap_structure" || raw === "mindmap" || raw === "mindmap_summary") return "mindmap_structure"
  if (raw === "source_summary" || raw === "source") return "source_summary"
  return null
}

function inferPageKey(fieldKey: string): SceneCompilePagePlan["pageKey"] {
  if (["target_audiences", "audience_situations"].includes(fieldKey)) {
    return "hero_audiences"
  }
  if (["selling_points"].includes(fieldKey)) {
    return "hero_value_props"
  }
  if (["creative_assets"].includes(fieldKey)) {
    return "hero_creative_assets"
  }
  if (["metric_signals", "decision_rules"].includes(fieldKey)) {
    return "hero_metric_judgement"
  }
  if (["action_playbook"].includes(fieldKey)) {
    return "hero_actions_experiments"
  }
  if (["mainline_steps", "execution_steps", "process_flow_or_business_model", "process_model"].includes(fieldKey)) {
    return "mainline_steps"
  }
  if (["key_judgements", "judgment_criteria", "decision_rules", "prioritization_logic"].includes(fieldKey)) {
    return "key_judgements"
  }
  if (["boundaries", "boundary", "exceptions_and_non_applicable_scope", "risks", "termination_conditions"].includes(fieldKey)) {
    return "boundaries"
  }
  if (["evidence", "validation_methods", "metrics", "source_refs", "traceability", "cases"].includes(fieldKey)) {
    return "evidence_cases"
  }
  if (["mindmap_summary", "brain_map", "mindmap_structure"].includes(fieldKey)) {
    return "mindmap_structure"
  }
  return "business_index"
}

function inferSectionKey(pageKey: SceneCompilePagePlan["pageKey"], fieldKey: string): string {
  if (pageKey === "business_index") {
    if (["business_goal", "goal", "objective", "summary"].includes(fieldKey)) return "business_goal"
    return "core_summary"
  }
  if (pageKey === "hero_audiences") return "hero_audiences"
  if (pageKey === "hero_value_props") return "hero_value_props"
  if (pageKey === "hero_creative_assets") return "hero_creative_assets"
  if (pageKey === "hero_metric_judgement") return "hero_metric_judgement"
  if (pageKey === "hero_actions_experiments") return "hero_actions_experiments"
  if (pageKey === "mainline_steps") return "mainline_steps"
  if (pageKey === "key_judgements") return "key_judgements"
  if (pageKey === "boundaries") return "boundaries"
  if (pageKey === "evidence_cases") {
    if (fieldKey === "metrics") return "metrics"
    if (fieldKey === "validation_methods") return "validation_methods"
    return "evidence_cases"
  }
  if (pageKey === "mindmap_structure") return "mindmap_structure"
  return "source_summary"
}

function readSceneFields(scenePack: ScenePack): SceneFieldDef[] {
  const rawFields = Array.isArray(scenePack.schemaProfile.fields)
    ? scenePack.schemaProfile.fields
    : []
  const items = rawFields
    .map((field) => {
      if (!field || typeof field !== "object") return null
      const obj = field as Record<string, unknown>
      const key = String(obj.key ?? "").trim()
      if (!key) return null
      const explicitPageKey = normalizePageKey(obj.page_key ?? obj.page ?? obj.target_page)
      return {
        key,
        label: String(obj.label ?? key),
        required: Boolean(obj.required),
        pageKey: explicitPageKey ?? inferPageKey(key),
        sectionKey: String(obj.section_key ?? obj.section ?? inferSectionKey(explicitPageKey ?? inferPageKey(key), key)),
      }
    })
    .filter((field): field is NonNullable<typeof field> => Boolean(field))
  return items.map((field) => ({
    ...field,
    pageKey: field.pageKey,
    sectionKey: field.sectionKey,
  }))
}

function fieldMap(report: AgentModeReport): Map<string, GroundTruthFieldValue> {
  return new Map(report.groundTruth.fields.map((field) => [field.key, field]))
}

function sourceRefsByField(report: AgentModeReport): Record<string, string[]> {
  const blockMap = new Map(report.documentIr.blocks.map((block) => [block.blockId, block]))
  const refs: Record<string, string[]> = {}
  for (const field of report.groundTruth.fields) {
    const items = uniq(
      field.evidenceBlockRefs.flatMap((blockId) => {
        const block = blockMap.get(blockId)
        if (!block) return []
        return block.sourceRefs.length > 0
          ? block.sourceRefs.map((ref) => `${ref}#${block.blockId}`)
          : [`${report.sourcePath}#${block.blockId}`]
      }),
    )
    refs[field.key] = items.length > 0 ? items : field.value.trim() ? [report.sourcePath] : []
  }
  return refs
}

function isHeroImageScene(report: AgentModeReport): boolean {
  return report.sceneId === "ecom_growth_hero_image"
}

function buildFieldValueMap(report: AgentModeReport): Record<string, string> {
  return Object.fromEntries(report.groundTruth.fields.map((field) => [field.key, field.value.trim()]))
}

function buildFieldLabelMap(report: AgentModeReport): Record<string, string> {
  return Object.fromEntries(report.groundTruth.fields.map((field) => [field.key, field.label]))
}

function buildFieldEvidenceMap(report: AgentModeReport): Record<string, string[]> {
  const blockMap = new Map(report.documentIr.blocks.map((block) => [block.blockId, block]))
  return Object.fromEntries(
    report.groundTruth.fields.map((field) => [
      field.key,
      uniq(
        field.evidenceBlockRefs.flatMap((blockId) => {
          const block = blockMap.get(blockId)
          if (!block) return []
          return block.sourceRefs.length > 0
            ? block.sourceRefs.map((ref) => `${ref}#${block.blockId}`)
            : [`${report.sourcePath}#${block.blockId}`]
        }),
      ),
    ]),
  )
}

function truncateInline(value: string, max = 140): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(0, max - 1)).trim()}…`
}

function formatDecisionPoint(point: CompileIR["decisionPoints"][number], index: number): string {
  const title = point.title?.trim() || `决策点 ${index + 1}`
  const condition = point.condition?.trim() || "待补充判断条件"
  const action = point.action?.trim() || "待补充后续动作"
  return `${title}：当「${condition}」时，建议「${action}」`
}

function buildBusinessRelationMermaid(compileIr: CompileIR): string {
  const idToObject = new Map(compileIr.businessObjects.map((item) => [item.objectId, item]))
  const lines = ["```mermaid", "graph LR"]
  for (const object of compileIr.businessObjects.slice(0, 10)) {
    lines.push(`  ${object.objectId}["${object.label.replace(/"/g, '\\"')}"]`)
  }
  for (const relation of compileIr.businessRelations.slice(0, 10)) {
    const fromObject = idToObject.get(relation.fromObjectId)
    const toObject = idToObject.get(relation.toObjectId)
    if (!fromObject || !toObject) continue
    lines.push(`  ${relation.fromObjectId} -->|${relation.type}| ${relation.toObjectId}`)
  }
  lines.push("```", "")
  return lines.join("\n")
}

function renderFieldProjectionSection(
  compileIr: CompileIR,
  fieldKeys: string[],
): string[] {
  return fieldKeys.flatMap((fieldKey) => {
    const value = compileIr.fieldValueMap[fieldKey]
    if (!value) return []
    const label = compileIr.fieldLabelMap[fieldKey] || fieldKey
    const snippets = trimLines(value).slice(0, 5)
    const evidence = compileIr.fieldEvidenceMap[fieldKey] ?? []
    return [
      `### ${label}`,
      "",
      ...snippets.map((line) => `- ${line}`),
      ...(evidence.length > 0 ? ["", `来源锚点：${evidence.slice(0, 3).join("；")}`] : []),
      "",
    ]
  })
}

function buildCompileIr(report: AgentModeReport): CompileIR {
  const fields = fieldMap(report)
  const valueMap = buildFieldValueMap(report)
  const metrics = uniq(
    [
      ...trimLines(fields.get("metrics")?.value ?? ""),
      ...report.understanding.evidenceHighlights.filter((item) => /(gmv|roi|ctr|转化|客单|点击|曝光|留存|退款)/i.test(item)),
    ].slice(0, 10),
  )
  return {
    sourceSummary: report.understanding.summary,
    mainlineSteps: report.groundTruth.mainlineSteps.length > 0
      ? report.groundTruth.mainlineSteps
      : report.understanding.mainlineSteps,
    sopSteps: report.understanding.sopSteps.length > 0
      ? report.understanding.sopSteps
      : (report.groundTruth.mainlineSteps.length > 0
          ? report.groundTruth.mainlineSteps
          : report.understanding.mainlineSteps),
    keyJudgements: report.groundTruth.keyJudgements.length > 0
      ? report.groundTruth.keyJudgements
      : report.understanding.keyJudgements,
    businessRules: report.understanding.businessRules,
    decisionPoints: report.understanding.decisionPoints,
    boundaries: report.groundTruth.boundaries.length > 0
      ? report.groundTruth.boundaries
      : report.understanding.risks,
    evidenceCases: uniq(
      [
        ...report.groundTruth.evidenceNotes,
        ...trimLines(fields.get("evidence")?.value ?? ""),
        ...trimLines(fields.get("validation_methods")?.value ?? ""),
      ].slice(0, 12),
    ),
    imageEvidence: report.understanding.imageEvidenceHighlights,
    metrics,
    keyEntities: report.understanding.entityCandidates,
    businessObjects: report.understanding.businessObjects,
    businessRelations: report.understanding.businessRelations,
    fieldValueMap: valueMap,
    fieldLabelMap: buildFieldLabelMap(report),
    fieldEvidenceMap: buildFieldEvidenceMap(report),
    revisionSignals: report.understanding.evidenceHighlights.filter((item) => item.startsWith("修订痕迹：")).slice(0, 6),
    terminology: report.understanding.terminology,
    mindmapSummary: report.understanding.mindmapSummary,
    openQuestions: report.understanding.openQuestions,
    sourceRefsByField: sourceRefsByField(report),
  }
}

function buildPagePlan(docSlug: string): SceneCompilePagePlan[] {
  return [
    {
      pageKey: "business_index",
      title: PAGE_TITLE_BY_KEY.business_index,
      path: `wiki/business/${docSlug}/index.md`,
      pageType: "business_index",
      sectionKeys: ["business_goal", "core_summary", "mainline_overview", "judgement_overview", "boundary_overview", "open_questions"],
      requiredFieldKeys: [],
    },
    {
      pageKey: "mainline_steps",
      title: PAGE_TITLE_BY_KEY.mainline_steps,
      path: `wiki/business/${docSlug}/主链路步骤.md`,
      pageType: "mainline_steps",
      sectionKeys: ["mainline_steps"],
      requiredFieldKeys: [],
    },
    {
      pageKey: "key_judgements",
      title: PAGE_TITLE_BY_KEY.key_judgements,
      path: `wiki/business/${docSlug}/关键判断.md`,
      pageType: "key_judgements",
      sectionKeys: ["key_judgements"],
      requiredFieldKeys: [],
    },
    {
      pageKey: "boundaries",
      title: PAGE_TITLE_BY_KEY.boundaries,
      path: `wiki/business/${docSlug}/边界与例外.md`,
      pageType: "boundaries",
      sectionKeys: ["boundaries"],
      requiredFieldKeys: [],
    },
    {
      pageKey: "evidence_cases",
      title: PAGE_TITLE_BY_KEY.evidence_cases,
      path: `wiki/business/${docSlug}/证据与案例.md`,
      pageType: "evidence_cases",
      sectionKeys: ["evidence_cases", "validation_methods", "metrics"],
      requiredFieldKeys: [],
    },
    {
      pageKey: "mindmap_structure",
      title: PAGE_TITLE_BY_KEY.mindmap_structure,
      path: `wiki/business/${docSlug}/脑图结构.md`,
      pageType: "mindmap_structure",
      sectionKeys: ["mindmap_structure"],
      requiredFieldKeys: [],
    },
    {
      pageKey: "source_summary",
      title: PAGE_TITLE_BY_KEY.source_summary,
      path: `wiki/sources/${docSlug}.md`,
      pageType: "source_summary",
      sectionKeys: ["source_summary"],
      requiredFieldKeys: [],
    },
  ]
}

function buildHeroImagePagePlan(docSlug: string): SceneCompilePagePlan[] {
  return [
    {
      pageKey: "business_index",
      title: PAGE_TITLE_BY_KEY.business_index,
      path: `wiki/business/${docSlug}/index.md`,
      pageType: "business_index",
      sectionKeys: ["business_goal", "core_summary", "hero_relation_map", "open_questions"],
      requiredFieldKeys: ["business_goal"],
    },
    {
      pageKey: "hero_audiences",
      title: PAGE_TITLE_BY_KEY.hero_audiences,
      path: `wiki/business/${docSlug}/人群与场景.md`,
      pageType: "hero_audiences",
      sectionKeys: ["hero_audiences"],
      requiredFieldKeys: ["target_audiences", "audience_situations"],
    },
    {
      pageKey: "hero_value_props",
      title: PAGE_TITLE_BY_KEY.hero_value_props,
      path: `wiki/business/${docSlug}/卖点与表达.md`,
      pageType: "hero_value_props",
      sectionKeys: ["hero_value_props"],
      requiredFieldKeys: ["selling_points"],
    },
    {
      pageKey: "hero_creative_assets",
      title: PAGE_TITLE_BY_KEY.hero_creative_assets,
      path: `wiki/business/${docSlug}/素材与版式.md`,
      pageType: "hero_creative_assets",
      sectionKeys: ["hero_creative_assets"],
      requiredFieldKeys: ["creative_assets"],
    },
    {
      pageKey: "hero_metric_judgement",
      title: PAGE_TITLE_BY_KEY.hero_metric_judgement,
      path: `wiki/business/${docSlug}/指标与判断.md`,
      pageType: "hero_metric_judgement",
      sectionKeys: ["hero_metric_judgement"],
      requiredFieldKeys: ["metric_signals", "decision_rules"],
    },
    {
      pageKey: "hero_actions_experiments",
      title: PAGE_TITLE_BY_KEY.hero_actions_experiments,
      path: `wiki/business/${docSlug}/动作与实验.md`,
      pageType: "hero_actions_experiments",
      sectionKeys: ["hero_actions_experiments"],
      requiredFieldKeys: ["action_playbook"],
    },
    {
      pageKey: "evidence_cases",
      title: PAGE_TITLE_BY_KEY.evidence_cases,
      path: `wiki/business/${docSlug}/证据与案例.md`,
      pageType: "evidence_cases",
      sectionKeys: ["evidence_cases", "validation_methods", "metrics"],
      requiredFieldKeys: ["experiment_evidence"],
    },
    {
      pageKey: "source_summary",
      title: PAGE_TITLE_BY_KEY.source_summary,
      path: `wiki/sources/${docSlug}.md`,
      pageType: "source_summary",
      sectionKeys: ["source_summary"],
      requiredFieldKeys: [],
    },
  ]
}

export function buildSceneCompileArtifacts(
  report: AgentModeReport,
  scenePack: ScenePack,
): SceneCompileArtifacts {
  const docSlug = slugifySourceName(report.sourceName) || report.docId
  const fields = readSceneFields(scenePack)
  const pagePlans = isHeroImageScene(report) ? buildHeroImagePagePlan(docSlug) : buildPagePlan(docSlug)
  const pageLookup = new Map(pagePlans.map((page) => [page.pageKey, page]))
  const compileIr = buildCompileIr(report)
  const fieldLookup = fieldMap(report)
  const fieldToPageMap: Record<string, string> = {}
  const sectionMappings: Record<string, string> = {}
  const warnings: string[] = []

  for (const field of fields) {
    const pageKey = field.pageKey ?? inferPageKey(field.key)
    fieldToPageMap[field.key] = pageKey
    sectionMappings[field.key] = field.sectionKey ?? inferSectionKey(pageKey, field.key)
    const page = pageLookup.get(pageKey)
    if (!page) {
      warnings.push(`字段「${field.label}」映射到了未知页面 ${pageKey}。`)
    }
  }

  const plan: SceneCompilePlan = {
    docId: report.docId,
    sceneId: report.sceneId,
    compileMode: "scene_business_dominant",
    pagePlans,
    sectionMappings,
    fieldToPageMap,
    requiredFieldKeys: fields.filter((field) => field.required).map((field) => field.key),
  }

  const entries: CompileCoverageEntry[] = fields.map((field) => {
    const value = fieldLookup.get(field.key)?.value?.trim() ?? ""
    const pageKey = plan.fieldToPageMap[field.key] ?? null
    const page = pageKey ? pageLookup.get(pageKey as SceneCompilePagePlan["pageKey"]) ?? null : null
    const sectionKey = plan.sectionMappings[field.key] ?? null
    const refs = compileIr.sourceRefsByField[field.key] ?? []
    let rootCause: CompileCoverageEntry["rootCause"] = "written"
    if (!value) {
      rootCause = "missing_value"
    } else if (!pageKey || !page) {
      rootCause = "missing_page_plan"
    } else if (!sectionKey) {
      rootCause = "missing_section_mapping"
    } else if (refs.length === 0) {
      rootCause = "missing_source_ref"
    }
    return {
      fieldKey: field.key,
      label: field.label,
      written: Boolean(value && pageKey && page && sectionKey),
      pageKey,
      pagePath: page?.path ?? null,
      sectionKey,
      evidenceRefs: refs,
      rootCause,
    }
  })

  const compileCoverage: CompileCoverageReport = {
    docId: report.docId,
    generatedAt: nowIso(),
    entries,
  }

  return {
    docSlug,
    plan,
    compileIr,
    compileCoverage,
    supportingWikiPages: pagePlans
      .filter((page) => page.pageKey !== "source_summary")
      .map((page) => page.path),
    warnings,
  }
}

function yamlList(items: string[], indent = "  "): string[] {
  if (items.length === 0) return [`${indent}[]`]
  return items.map((item) => `${indent}- "${item.replace(/"/g, '\\"')}"`)
}

function docFrontmatter(
  pageType: string,
  title: string,
  summary: string,
  sourceRefs: string[],
  related: string[],
): string {
  const updated = todayString()
  return [
    "---",
    `page_type: ${pageType}`,
    `title: "${title.replace(/"/g, '\\"')}"`,
    `summary: "${summary.replace(/"/g, '\\"')}"`,
    `updated: ${updated}`,
    "source_refs:",
    ...yamlList(sourceRefs),
    "related_pages:",
    ...yamlList(related),
    "---",
    "",
  ].join("\n")
}

function joinSection(title: string, lines: string[]): string {
  return [`## ${title}`, "", ...(lines.length > 0 ? lines : ["- 暂无稳定内容"]), ""].join("\n")
}

function renderBusinessIndex(
  report: AgentModeReport,
  artifacts: SceneCompileArtifacts,
): string {
  const refs = uniq([
    ...artifacts.compileIr.sourceRefsByField.business_goal ?? [],
    ...artifacts.compileIr.sourceRefsByField.mainline_steps ?? [],
    ...artifacts.compileIr.sourceRefsByField.key_judgements ?? [],
  ])
  const related = [
    `[[business/${artifacts.docSlug}/主链路步骤|主链路步骤]]`,
    `[[business/${artifacts.docSlug}/关键判断|关键判断]]`,
    `[[business/${artifacts.docSlug}/边界与例外|边界与例外]]`,
    `[[business/${artifacts.docSlug}/证据与案例|证据与案例]]`,
    ...(report.sourceKind === "xmind" ? [`[[business/${artifacts.docSlug}/脑图结构|脑图结构]]`] : []),
    `[[sources/${artifacts.docSlug}|来源摘要]]`,
  ]
  const frontmatter = docFrontmatter(
    "business_index",
    `${report.sourceName.replace(/\.[^.]+$/, "")} · 业务总览`,
    report.understanding.summary,
    refs.length > 0 ? refs : [report.sourcePath],
    related,
  )
  return [
    frontmatter,
    `# ${report.sourceName.replace(/\.[^.]+$/, "")} · 业务总览`,
    "",
    report.understanding.summary,
    "",
    joinSection(
      "这份资料在解决什么问题",
      [
        report.groundTruth.fields.find((field) => ["business_goal", "goal", "objective", "summary"].includes(field.key))?.value.trim(),
      ].filter(Boolean) as string[],
    ),
    joinSection(
      "业务术语与对象",
      uniq([
        ...artifacts.compileIr.terminology.map((item) => `${item}`),
        ...artifacts.compileIr.keyEntities.slice(0, 8).map((entity) => `${entity.name}（${entity.entityType}）`),
      ]).map((item) => `- ${item}`),
    ),
    joinSection(
      "主链路概览",
      artifacts.compileIr.mainlineSteps.map((step, index) => `${index + 1}. ${step}`),
    ),
    joinSection(
      "关键判断概览",
      artifacts.compileIr.keyJudgements.map((item) => `- ${item}`),
    ),
    joinSection(
      "业务规则",
      artifacts.compileIr.businessRules.map((item) => `- ${item}`),
    ),
    joinSection(
      "关键实体",
      artifacts.compileIr.keyEntities.map((entity) => `- ${entity.name}（${entity.entityType}，置信度 ${Math.round(entity.confidence * 100)}）`),
    ),
    joinSection(
      "边界与例外",
      artifacts.compileIr.boundaries.map((item) => `- ${item}`),
    ),
    joinSection(
      "待继续确认",
      artifacts.compileIr.openQuestions.map((item) => `- ${item}`),
    ),
    ...(isHeroImageScene(report)
      ? [
          "## 主图设计关系图",
          "",
          buildBusinessRelationMermaid(artifacts.compileIr),
        ]
      : []),
    ...renderFieldProjectionSection(artifacts.compileIr, ["business_goal", "goal", "objective", "summary"]),
  ].join("\n")
}

function renderHeroAudiences(
  report: AgentModeReport,
  artifacts: SceneCompileArtifacts,
): string {
  const refs = uniq([
    ...artifacts.compileIr.sourceRefsByField.target_audiences ?? [],
    ...artifacts.compileIr.sourceRefsByField.audience_situations ?? [],
  ])
  return [
    docFrontmatter(
      "hero_audiences",
      `${report.sourceName.replace(/\.[^.]+$/, "")} · 人群与场景`,
      "说明这张主图主要服务谁，以及这些人群在什么购物任务中会被打动。",
      refs.length > 0 ? refs : [report.sourcePath],
      [`[[business/${artifacts.docSlug}/index|业务总览]]`, `[[business/${artifacts.docSlug}/卖点与表达|卖点与表达]]`],
    ),
    `# ${report.sourceName.replace(/\.[^.]+$/, "")} · 人群与场景`,
    "",
    joinSection(
      "目标人群",
      artifacts.compileIr.businessObjects
        .filter((item) => item.objectType === "audience_segment")
        .map((item) => `- ${item.label}`),
    ),
    joinSection(
      "购物任务与使用场景",
      trimLines(artifacts.compileIr.fieldValueMap.audience_situations ?? "").map((item) => `- ${item}`),
    ),
    joinSection(
      "这类人群最关心什么",
      artifacts.compileIr.businessRelations
        .filter((item) => item.type === "cares_about")
        .map((item) => `- ${item.rationale}`),
    ),
    ...renderFieldProjectionSection(artifacts.compileIr, ["target_audiences", "audience_situations"]),
  ].join("\n")
}

function renderHeroValueProps(
  report: AgentModeReport,
  artifacts: SceneCompileArtifacts,
): string {
  const refs = uniq([
    ...artifacts.compileIr.sourceRefsByField.selling_points ?? [],
    ...artifacts.compileIr.sourceRefsByField.business_goal ?? [],
  ])
  return [
    docFrontmatter(
      "hero_value_props",
      `${report.sourceName.replace(/\.[^.]+$/, "")} · 卖点与表达`,
      "沉淀主图需要打给用户的卖点、利益点和证明方式。",
      refs.length > 0 ? refs : [report.sourcePath],
      [`[[business/${artifacts.docSlug}/人群与场景|人群与场景]]`, `[[business/${artifacts.docSlug}/素材与版式|素材与版式]]`],
    ),
    `# ${report.sourceName.replace(/\.[^.]+$/, "")} · 卖点与表达`,
    "",
    joinSection(
      "核心卖点与利益点",
      artifacts.compileIr.businessObjects
        .filter((item) => item.objectType === "value_proposition")
        .map((item) => `- ${item.label}`),
    ),
    joinSection(
      "表达重点",
      artifacts.compileIr.keyJudgements.map((item) => `- ${item}`),
    ),
    joinSection(
      "对不同人群的价值指向",
      artifacts.compileIr.businessRelations
        .filter((item) => item.type === "cares_about")
        .map((item) => `- ${item.rationale}`),
    ),
    ...renderFieldProjectionSection(artifacts.compileIr, ["selling_points"]),
  ].join("\n")
}

function renderHeroCreativeAssets(
  report: AgentModeReport,
  artifacts: SceneCompileArtifacts,
): string {
  const refs = uniq([...artifacts.compileIr.sourceRefsByField.creative_assets ?? []])
  return [
    docFrontmatter(
      "hero_creative_assets",
      `${report.sourceName.replace(/\.[^.]+$/, "")} · 素材与版式`,
      "整理主图素材、构图、版式和视觉表达模式。",
      refs.length > 0 ? refs : [report.sourcePath],
      [`[[business/${artifacts.docSlug}/卖点与表达|卖点与表达]]`, `[[business/${artifacts.docSlug}/指标与判断|指标与判断]]`],
    ),
    `# ${report.sourceName.replace(/\.[^.]+$/, "")} · 素材与版式`,
    "",
    joinSection(
      "素材模式",
      artifacts.compileIr.businessObjects
        .filter((item) => item.objectType === "creative_asset_pattern")
        .map((item) => `- ${item.label}`),
    ),
    joinSection(
      "图片与视觉证据",
      artifacts.compileIr.imageEvidence.map((item) => `- ${item}`),
    ),
    joinSection(
      "卖点如何被表达出来",
      artifacts.compileIr.businessRelations
        .filter((item) => item.type === "expressed_by")
        .map((item) => `- ${item.rationale}`),
    ),
    ...renderFieldProjectionSection(artifacts.compileIr, ["creative_assets"]),
  ].join("\n")
}

function renderHeroMetricJudgement(
  report: AgentModeReport,
  artifacts: SceneCompileArtifacts,
): string {
  const refs = uniq([
    ...artifacts.compileIr.sourceRefsByField.metric_signals ?? [],
    ...artifacts.compileIr.sourceRefsByField.decision_rules ?? [],
  ])
  return [
    docFrontmatter(
      "hero_metric_judgement",
      `${report.sourceName.replace(/\.[^.]+$/, "")} · 指标与判断`,
      "沉淀主图问题该看哪些指标、怎么判断、先怀疑哪里。",
      refs.length > 0 ? refs : [report.sourcePath],
      [`[[business/${artifacts.docSlug}/素材与版式|素材与版式]]`, `[[business/${artifacts.docSlug}/动作与实验|动作与实验]]`],
    ),
    `# ${report.sourceName.replace(/\.[^.]+$/, "")} · 指标与判断`,
    "",
    joinSection(
      "指标信号",
      artifacts.compileIr.businessObjects
        .filter((item) => item.objectType === "metric_signal")
        .map((item) => `- ${item.label}`),
    ),
    joinSection(
      "判断规则",
      artifacts.compileIr.decisionPoints.map((item, index) => `- ${formatDecisionPoint(item, index)}`),
    ),
    joinSection(
      "素材如何影响指标",
      artifacts.compileIr.businessRelations
        .filter((item) => item.type === "influences")
        .map((item) => `- ${item.rationale}`),
    ),
    ...renderFieldProjectionSection(artifacts.compileIr, ["metric_signals", "decision_rules"]),
  ].join("\n")
}

function renderHeroActionsExperiments(
  report: AgentModeReport,
  artifacts: SceneCompileArtifacts,
): string {
  const refs = uniq([
    ...artifacts.compileIr.sourceRefsByField.action_playbook ?? [],
    ...artifacts.compileIr.sourceRefsByField.experiment_evidence ?? [],
  ])
  return [
    docFrontmatter(
      "hero_actions_experiments",
      `${report.sourceName.replace(/\.[^.]+$/, "")} · 动作与实验`,
      "沉淀指标异常后该先改什么、怎么验证、如何做实验闭环。",
      refs.length > 0 ? refs : [report.sourcePath],
      [`[[business/${artifacts.docSlug}/指标与判断|指标与判断]]`, `[[business/${artifacts.docSlug}/证据与案例|证据与案例]]`],
    ),
    `# ${report.sourceName.replace(/\.[^.]+$/, "")} · 动作与实验`,
    "",
    joinSection(
      "动作打法",
      artifacts.compileIr.businessObjects
        .filter((item) => item.objectType === "optimization_action")
        .map((item) => `- ${item.label}`),
    ),
    joinSection(
      "指标异常时先改什么",
      artifacts.compileIr.businessRelations
        .filter((item) => item.type === "triggers")
        .map((item) => `- ${item.rationale}`),
    ),
    joinSection(
      "建议的验证与实验",
      uniq([
        ...trimLines(artifacts.compileIr.fieldValueMap.experiment_evidence ?? ""),
        ...artifacts.compileIr.businessRelations
          .filter((item) => item.type === "tests")
          .map((item) => item.rationale),
      ]).map((item) => `- ${item}`),
    ),
    ...renderFieldProjectionSection(artifacts.compileIr, ["action_playbook", "experiment_evidence"]),
  ].join("\n")
}

function renderMainlineSteps(
  report: AgentModeReport,
  artifacts: SceneCompileArtifacts,
): string {
  const refs = uniq([
    ...artifacts.compileIr.sourceRefsByField.mainline_steps ?? [],
    ...artifacts.compileIr.sourceRefsByField.execution_steps ?? [],
    ...artifacts.compileIr.sourceRefsByField.process_flow_or_business_model ?? [],
  ])
  const frontmatter = docFrontmatter(
    "business_process",
    `${report.sourceName.replace(/\.[^.]+$/, "")} · 主链路步骤`,
    "按业务推进顺序整理主链路步骤、目标与执行重点。",
    refs.length > 0 ? refs : [report.sourcePath],
    [
      `[[business/${artifacts.docSlug}/index|业务总览]]`,
      `[[business/${artifacts.docSlug}/关键判断|关键判断]]`,
      `[[business/${artifacts.docSlug}/证据与案例|证据与案例]]`,
    ],
  )
  const extraStepText = report.groundTruth.fields.find((field) => field.key === "execution_steps")?.value ?? ""
  return [
    frontmatter,
    `# ${report.sourceName.replace(/\.[^.]+$/, "")} · 主链路步骤`,
    "",
    joinSection(
      "流程说明",
      [
        artifacts.compileIr.sourceSummary,
        artifacts.compileIr.mainlineSteps[0]
          ? `这份资料的主线首先关注：${truncateInline(artifacts.compileIr.mainlineSteps[0], 72)}`
          : "",
      ].filter(Boolean),
    ),
    joinSection(
      "步骤表",
      artifacts.compileIr.sopSteps.length > 0
        ? artifacts.compileIr.sopSteps.map((step, index) => `${index + 1}. ${step}`)
        : trimLines(extraStepText).map((step, index) => `${index + 1}. ${step}`),
    ),
    joinSection(
      "执行提示",
      trimLines(extraStepText)
        .filter((line) => !artifacts.compileIr.mainlineSteps.includes(line))
        .slice(0, 8)
        .map((line) => `- ${line}`),
    ),
    ...renderFieldProjectionSection(artifacts.compileIr, ["mainline_steps", "execution_steps", "process_flow_or_business_model"]),
  ].join("\n")
}

function renderKeyJudgements(
  report: AgentModeReport,
  artifacts: SceneCompileArtifacts,
): string {
  const judgementField = report.groundTruth.fields.find((field) => field.key === "judgment_criteria")
  const refs = uniq([
    ...artifacts.compileIr.sourceRefsByField.key_judgements ?? [],
    ...artifacts.compileIr.sourceRefsByField.judgment_criteria ?? [],
    ...artifacts.compileIr.sourceRefsByField.validation_methods ?? [],
  ])
  const frontmatter = docFrontmatter(
    "business_judgements",
    `${report.sourceName.replace(/\.[^.]+$/, "")} · 关键判断`,
    "沉淀业务判断标准、决策条件和需要验证的重点。",
    refs.length > 0 ? refs : [report.sourcePath],
    [
      `[[business/${artifacts.docSlug}/index|业务总览]]`,
      `[[business/${artifacts.docSlug}/主链路步骤|主链路步骤]]`,
      `[[business/${artifacts.docSlug}/证据与案例|证据与案例]]`,
    ],
  )
  return [
    frontmatter,
    `# ${report.sourceName.replace(/\.[^.]+$/, "")} · 关键判断`,
    "",
    joinSection(
      "阶段关键判断",
      artifacts.compileIr.keyJudgements.map((item) => `- ${item}`),
    ),
    joinSection(
      "决策点",
      artifacts.compileIr.decisionPoints.map((item, index) => `- ${formatDecisionPoint(item, index)}`),
    ),
    joinSection(
      "判断标准",
      trimLines(judgementField?.value ?? "").map((line) => `- ${line}`),
    ),
    joinSection(
      "验证方式",
      trimLines(report.groundTruth.fields.find((field) => field.key === "validation_methods")?.value ?? "")
        .map((line) => `- ${line}`),
    ),
    joinSection(
      "业务规则",
      artifacts.compileIr.businessRules.map((item) => `- ${item}`),
    ),
    ...renderFieldProjectionSection(artifacts.compileIr, ["key_judgements", "judgment_criteria", "validation_methods"]),
  ].join("\n")
}

function renderBoundaries(
  report: AgentModeReport,
  artifacts: SceneCompileArtifacts,
): string {
  const boundaryField = report.groundTruth.fields.find((field) =>
    ["boundaries", "exceptions_and_non_applicable_scope"].includes(field.key),
  )
  const refs = uniq([
    ...artifacts.compileIr.sourceRefsByField.boundaries ?? [],
    ...artifacts.compileIr.sourceRefsByField.exceptions_and_non_applicable_scope ?? [],
  ])
  const frontmatter = docFrontmatter(
    "business_boundaries",
    `${report.sourceName.replace(/\.[^.]+$/, "")} · 边界与例外`,
    "说明这套方法论的适用范围、边界条件和不适用场景。",
    refs.length > 0 ? refs : [report.sourcePath],
    [
      `[[business/${artifacts.docSlug}/index|业务总览]]`,
      `[[business/${artifacts.docSlug}/关键判断|关键判断]]`,
    ],
  )
  return [
    frontmatter,
    `# ${report.sourceName.replace(/\.[^.]+$/, "")} · 边界与例外`,
    "",
    joinSection(
      "边界条件",
      artifacts.compileIr.boundaries.map((item) => `- ${item}`),
    ),
    joinSection(
      "原文补充",
      trimLines(boundaryField?.value ?? "").map((line) => `- ${line}`),
    ),
    joinSection(
      "容易踩坑的地方",
      artifacts.compileIr.businessRules
        .filter((item) => /(风险|误区|不要|禁止|边界|例外|不适用)/.test(item))
        .map((item) => `- ${item}`),
    ),
    ...renderFieldProjectionSection(artifacts.compileIr, ["boundaries", "exceptions_and_non_applicable_scope", "termination_conditions"]),
  ].join("\n")
}

function renderEvidenceCases(
  report: AgentModeReport,
  artifacts: SceneCompileArtifacts,
): string {
  const evidenceField = report.groundTruth.fields.find((field) => field.key === "evidence")
  const validationField = report.groundTruth.fields.find((field) => field.key === "validation_methods")
  const refs = uniq([
    ...artifacts.compileIr.sourceRefsByField.evidence ?? [],
    ...artifacts.compileIr.sourceRefsByField.validation_methods ?? [],
    ...artifacts.compileIr.sourceRefsByField.metrics ?? [],
  ])
  const frontmatter = docFrontmatter(
    "business_evidence",
    `${report.sourceName.replace(/\.[^.]+$/, "")} · 证据与案例`,
    "沉淀数据口径、案例、验证方式和指标锚点。",
    refs.length > 0 ? refs : [report.sourcePath],
    [
      `[[business/${artifacts.docSlug}/index|业务总览]]`,
      `[[business/${artifacts.docSlug}/关键判断|关键判断]]`,
    ],
  )
  return [
    frontmatter,
    `# ${report.sourceName.replace(/\.[^.]+$/, "")} · 证据与案例`,
    "",
    joinSection(
      "证据与案例",
      uniq([
        ...artifacts.compileIr.evidenceCases.map((item) => `- ${item}`),
        ...trimLines(evidenceField?.value ?? "").map((line) => `- ${line}`),
      ]),
    ),
    joinSection(
      "图片与视觉证据",
      artifacts.compileIr.imageEvidence.map((item) => `- ${item}`),
    ),
    joinSection(
      "修订痕迹与补充线索",
      artifacts.compileIr.revisionSignals.map((item) => `- ${item}`),
    ),
    joinSection(
      "验证方式",
      trimLines(validationField?.value ?? "").map((line) => `- ${line}`),
    ),
    joinSection(
      "关键指标",
      artifacts.compileIr.metrics.map((metric) => `- ${metric}`),
    ),
    ...renderFieldProjectionSection(artifacts.compileIr, ["evidence", "validation_methods", "metrics", "traceability", "source_refs"]),
  ].join("\n")
}

function renderSourceSummary(
  report: AgentModeReport,
  artifacts: SceneCompileArtifacts,
): string {
  const frontmatter = docFrontmatter(
    "source",
    `Source: ${report.sourceName}`,
    "记录该业务资料的来源、摘要、主链路和引用入口。",
    [report.sourcePath],
    [
      `[[business/${artifacts.docSlug}/index|业务总览]]`,
      `[[business/${artifacts.docSlug}/主链路步骤|主链路步骤]]`,
      `[[business/${artifacts.docSlug}/关键判断|关键判断]]`,
    ],
  )
  return [
    frontmatter,
    `# Source: ${report.sourceName}`,
    "",
    joinSection("资料摘要", [artifacts.compileIr.sourceSummary]),
    joinSection(
      "主链路步骤",
      artifacts.compileIr.mainlineSteps.map((step, index) => `${index + 1}. ${step}`),
    ),
    joinSection(
      "关键判断",
      artifacts.compileIr.keyJudgements.map((item) => `- ${item}`),
    ),
    joinSection(
      "业务规则",
      artifacts.compileIr.businessRules.map((item) => `- ${item}`),
    ),
    joinSection(
      "关键实体",
      artifacts.compileIr.keyEntities.map((entity) => `- ${entity.name}（${entity.entityType}，证据强度 ${Math.round(entity.confidence * 100)}）`),
    ),
    joinSection(
      "证据线索",
      artifacts.compileIr.evidenceCases.slice(0, 10).map((item) => `- ${item}`),
    ),
    joinSection(
      "关联知识页",
      [
        `- [[business/${artifacts.docSlug}/index|业务总览]]`,
        `- [[business/${artifacts.docSlug}/主链路步骤|主链路步骤]]`,
        `- [[business/${artifacts.docSlug}/关键判断|关键判断]]`,
        `- [[business/${artifacts.docSlug}/边界与例外|边界与例外]]`,
        `- [[business/${artifacts.docSlug}/证据与案例|证据与案例]]`,
        ...(report.sourceKind === "xmind" ? [`- [[business/${artifacts.docSlug}/脑图结构|脑图结构]]`] : []),
      ],
    ),
    ...renderFieldProjectionSection(artifacts.compileIr, Object.keys(artifacts.compileIr.fieldValueMap).slice(0, 8)),
  ].join("\n")
}

function renderMindmapStructure(
  report: AgentModeReport,
  artifacts: SceneCompileArtifacts,
): string {
  const frontmatter = docFrontmatter(
    "mindmap_structure",
    `${report.sourceName.replace(/\.[^.]+$/, "")} · 脑图结构`,
    "按脑图分支整理业务主链、决策分叉和上下游结构。",
    [report.sourcePath],
    [
      `[[business/${artifacts.docSlug}/index|业务总览]]`,
      `[[business/${artifacts.docSlug}/主链路步骤|主链路步骤]]`,
      `[[business/${artifacts.docSlug}/关键判断|关键判断]]`,
    ],
  )
  return [
    frontmatter,
    `# ${report.sourceName.replace(/\.[^.]+$/, "")} · 脑图结构`,
    "",
    joinSection(
      "分支概览",
      (artifacts.compileIr.mindmapSummary ?? []).map((item) => `- ${item}`),
    ),
    joinSection(
      "主链路映射",
      artifacts.compileIr.sopSteps.map((item, index) => `${index + 1}. ${item}`),
    ),
    joinSection(
      "决策分叉",
      artifacts.compileIr.decisionPoints.map((item, index) => `- ${formatDecisionPoint(item, index)}`),
    ),
  ].join("\n")
}

function renderPages(
  report: AgentModeReport,
  artifacts: SceneCompileArtifacts,
): RenderedPage[] {
  const lookup: Record<SceneCompilePagePlan["pageKey"], (report: AgentModeReport, artifacts: SceneCompileArtifacts) => string> = {
    business_index: renderBusinessIndex,
    mainline_steps: renderMainlineSteps,
    key_judgements: renderKeyJudgements,
    boundaries: renderBoundaries,
    evidence_cases: renderEvidenceCases,
    mindmap_structure: renderMindmapStructure,
    source_summary: renderSourceSummary,
    hero_audiences: renderHeroAudiences,
    hero_value_props: renderHeroValueProps,
    hero_creative_assets: renderHeroCreativeAssets,
    hero_metric_judgement: renderHeroMetricJudgement,
    hero_actions_experiments: renderHeroActionsExperiments,
  }
  return artifacts.plan.pagePlans
    .map((page) => ({
      pageKey: page.pageKey,
      path: page.path,
      content:
        page.pageKey === "mindmap_structure" && report.sourceKind !== "xmind"
          ? ""
          : lookup[page.pageKey](report, artifacts),
    }))
    .filter((page) => page.content.trim().length > 0)
}

function managedSection(markerId: string, body: string): string {
  const start = `<!-- llm-wiki:${markerId}:start -->`
  const end = `<!-- llm-wiki:${markerId}:end -->`
  return `${start}\n${body.trim()}\n${end}`
}

function replaceManagedSection(existing: string, markerId: string, body: string): string {
  const wrapped = managedSection(markerId, body)
  const start = `<!-- llm-wiki:${markerId}:start -->`
  const end = `<!-- llm-wiki:${markerId}:end -->`
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`, "g")
  if (!existing.trim()) return wrapped
  if (pattern.test(existing)) return existing.replace(pattern, wrapped)
  return `${existing.trimEnd()}\n\n${wrapped}\n`
}

async function tryReadFile(path: string): Promise<string> {
  try {
    return await readFile(path)
  } catch {
    return ""
  }
}

async function updateWikiIndex(projectPath: string, report: AgentModeReport, artifacts: SceneCompileArtifacts): Promise<string> {
  const fullPath = `${projectPath}/wiki/index.md`
  const existing = await tryReadFile(fullPath)
  const title = report.sourceName.replace(/\.[^.]+$/, "")
  const body = [
    "## 业务知识页",
    `- [[business/${artifacts.docSlug}/index|${title} · 业务总览]]`,
    ...(isHeroImageScene(report)
      ? [
          `- [[business/${artifacts.docSlug}/人群与场景|${title} · 人群与场景]]`,
          `- [[business/${artifacts.docSlug}/卖点与表达|${title} · 卖点与表达]]`,
          `- [[business/${artifacts.docSlug}/素材与版式|${title} · 素材与版式]]`,
          `- [[business/${artifacts.docSlug}/指标与判断|${title} · 指标与判断]]`,
          `- [[business/${artifacts.docSlug}/动作与实验|${title} · 动作与实验]]`,
          `- [[business/${artifacts.docSlug}/证据与案例|${title} · 证据与案例]]`,
        ]
      : [
          `- [[business/${artifacts.docSlug}/主链路步骤|${title} · 主链路步骤]]`,
          `- [[business/${artifacts.docSlug}/关键判断|${title} · 关键判断]]`,
          `- [[business/${artifacts.docSlug}/边界与例外|${title} · 边界与例外]]`,
          `- [[business/${artifacts.docSlug}/证据与案例|${title} · 证据与案例]]`,
        ]),
    ...(report.sourceKind === "xmind" ? [`- [[business/${artifacts.docSlug}/脑图结构|${title} · 脑图结构]]`] : []),
    `- [[sources/${artifacts.docSlug}|Source: ${report.sourceName}]]`,
  ].join("\n")
  const next = replaceManagedSection(
    existing || "# Wiki Index\n",
    `business-${report.docId}`,
    body,
  )
  await writeFile(fullPath, next)
  return "wiki/index.md"
}

async function updateWikiOverview(projectPath: string, report: AgentModeReport, artifacts: SceneCompileArtifacts): Promise<string> {
  const fullPath = `${projectPath}/wiki/overview.md`
  const existing = await tryReadFile(fullPath)
  const title = report.sourceName.replace(/\.[^.]+$/, "")
  const body = [
    `## ${title}`,
    "",
    report.understanding.summary,
    "",
    ...(isHeroImageScene(report)
      ? [
          `- 人群入口：[[business/${artifacts.docSlug}/人群与场景|人群与场景]]`,
          `- 卖点入口：[[business/${artifacts.docSlug}/卖点与表达|卖点与表达]]`,
          `- 素材入口：[[business/${artifacts.docSlug}/素材与版式|素材与版式]]`,
          `- 指标入口：[[business/${artifacts.docSlug}/指标与判断|指标与判断]]`,
          `- 动作入口：[[business/${artifacts.docSlug}/动作与实验|动作与实验]]`,
          `- 证据入口：[[business/${artifacts.docSlug}/证据与案例|证据与案例]]`,
        ]
      : [
          `- 主链路入口：[[business/${artifacts.docSlug}/主链路步骤|主链路步骤]]`,
          `- 判断入口：[[business/${artifacts.docSlug}/关键判断|关键判断]]`,
          `- 证据入口：[[business/${artifacts.docSlug}/证据与案例|证据与案例]]`,
        ]),
    ...(report.sourceKind === "xmind" ? [`- 脑图入口：[[business/${artifacts.docSlug}/脑图结构|脑图结构]]`] : []),
  ].join("\n")
  const next = replaceManagedSection(
    existing || "# Wiki Overview\n",
    `overview-${report.docId}`,
    body,
  )
  await writeFile(fullPath, next)
  return "wiki/overview.md"
}

async function updateWikiLog(projectPath: string, report: AgentModeReport): Promise<string> {
  const fullPath = `${projectPath}/wiki/log.md`
  const existing = await tryReadFile(fullPath)
  const line = `- ${nowIso()}: 依据场景 schema 重新编译业务知识页，来源 \`${report.sourceName}\`。`
  const next = existing.trim()
    ? `${existing.trimEnd()}\n${line}\n`
    : `# Wiki Log\n\n${line}\n`
  await writeFile(fullPath, next)
  return "wiki/log.md"
}

export async function writeSceneCompile(
  projectPath: string,
  report: AgentModeReport,
  scenePack: ScenePack,
): Promise<SceneCompileWriteResult> {
  const pp = normalizePath(projectPath)
  const artifacts = buildSceneCompileArtifacts(report, scenePack)
  const pages = renderPages(report, artifacts)
  const writtenPaths: string[] = []

  await createDirectory(`${pp}/wiki`).catch(() => {})
  await createDirectory(`${pp}/wiki/business`).catch(() => {})
  await createDirectory(`${pp}/wiki/business/${artifacts.docSlug}`).catch(() => {})
  await createDirectory(`${pp}/wiki/sources`).catch(() => {})

  for (const page of pages) {
    await writeFile(`${pp}/${page.path}`, page.content)
    writtenPaths.push(page.path)
  }

  writtenPaths.push(await updateWikiIndex(pp, report, artifacts))
  writtenPaths.push(await updateWikiOverview(pp, report, artifacts))
  writtenPaths.push(await updateWikiLog(pp, report))

  return {
    ...artifacts,
    writtenPaths: uniq(writtenPaths),
  }
}
