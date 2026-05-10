import { createDirectory, listDirectory, readFile, writeFile } from "@/commands/fs"
import { runSemanticLint, runStructuralLint, type LintResult } from "@/lib/lint"
import { loadAgentModeReports } from "@/lib/agent-mode-persist"
import {
  clampScore,
  deriveGateStatus,
  deriveHealthStatus,
  type HealthDimensionScore,
  type HealthScorecard,
  type PublishGateDecision,
  type PublishGateRuleResult,
} from "@/lib/quality-contracts"
import { normalizePath } from "@/lib/path-utils"
import { searchWiki } from "@/lib/search"
import type { LlmConfig } from "@/stores/wiki-store"
import type { FileNode } from "@/types/wiki"

export interface WikiHealthReport {
  generatedAt: string
  structuralResults: LintResult[]
  semanticResults: LintResult[]
  compileResults: LintResult[]
  retrievalResults: LintResult[]
  wikiHealth: HealthScorecard
  publishGate: PublishGateDecision
}

function flattenMdFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenMdFiles(node.children))
    } else if (!node.is_dir && node.name.endsWith(".md")) {
      files.push(node)
    }
  }
  return files
}

async function readWikiPages(projectPath: string): Promise<Array<{ path: string; relativePath: string; content: string }>> {
  try {
    const wikiRoot = `${normalizePath(projectPath)}/wiki`
    const tree = await listDirectory(wikiRoot)
    const files = flattenMdFiles(tree)
    const pages = await Promise.all(
      files.map(async (file) => {
        try {
          const content = await readFile(file.path)
          return {
            path: file.path,
            relativePath: file.path.replace(`${wikiRoot}/`, ""),
            content,
          }
        } catch {
          return null
        }
      }),
    )
    return pages.filter((page): page is { path: string; relativePath: string; content: string } => Boolean(page))
  } catch {
    return []
  }
}

function textHasAny(haystack: string, candidates: string[]): boolean {
  const lower = haystack.toLowerCase()
  return candidates.some((candidate) => candidate.trim() && lower.includes(candidate.trim().toLowerCase()))
}

async function buildCompileResults(projectPath: string): Promise<LintResult[]> {
  const reports = await loadAgentModeReports(projectPath)
  const pages = await readWikiPages(projectPath)
  const wikiText = pages.map((page) => page.content).join("\n\n")
  const results: LintResult[] = []

  for (const report of reports) {
    const isHeroImageScene = report.sceneId === "ecom_growth_hero_image"
    for (const field of report.groundTruth.fields) {
      const tokens = [
        field.label,
        field.key,
        ...field.value.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 3),
      ].filter(Boolean)
      const found = textHasAny(wikiText, tokens)
      if (!found) {
        results.push({
          issueId: `compile-field-drop-${report.docId}-${field.key}`,
          type: "semantic",
          severity: "warning",
          page: report.sourceName,
          detail: `编译后的 wiki 中没有稳定投影字段「${field.label}」。`,
          issueScope: "wiki_compile",
          rootCause: "compile_field_drop",
          blocking: true,
          linkedDocId: report.docId,
          linkedIssueIds: report.revisionIssueCards
            .filter((card) => card.targetFieldKey === field.key)
            .map((card) => card.issueId),
        })
      }
    }

    const hasSourceRefs = pages.some(
      (page) =>
        page.content.includes("source_refs") ||
        page.content.includes("sources:") ||
        page.content.includes(report.sourceName),
    )
    if (!hasSourceRefs) {
      results.push({
        issueId: `compile-source-ref-${report.docId}`,
        type: "semantic",
        severity: "warning",
        page: report.sourceName,
        detail: "编译后的 wiki 没有稳定映射回原文来源或 source refs。",
        issueScope: "wiki_compile",
        rootCause: "compile_missing_source_ref_projection",
        blocking: true,
        linkedDocId: report.docId,
        linkedIssueIds: [],
      })
    }

    if (report.groundTruth.mainlineSteps.length > 0) {
      const stepAnchors = report.groundTruth.mainlineSteps.slice(0, 4)
      const hasStepProjection = pages.some((page) => textHasAny(page.content, stepAnchors))
      if (!hasStepProjection) {
        results.push({
          issueId: `compile-stage-map-${report.docId}`,
          type: "semantic",
          severity: "warning",
          page: report.sourceName,
          detail: "主链路步骤没有稳定投射到 wiki 的过程页或步骤页。",
          issueScope: "wiki_compile",
          rootCause: "compile_missing_stage_mapping",
          blocking: true,
          linkedDocId: report.docId,
          linkedIssueIds: report.revisionIssueCards
            .filter((card) => card.impactsDimensions.includes("actionability"))
            .map((card) => card.issueId),
        })
      }
    }

    if (isHeroImageScene) {
      const objectTypeLabels: Array<{
        objectType: string
        label: string
        rootCause:
          | "compile_missing_audience_projection"
          | "compile_missing_selling_point_projection"
          | "compile_missing_creative_asset_projection"
          | "compile_missing_metric_projection"
          | "compile_missing_action_projection"
      }> = [
        {
          objectType: "audience_segment",
          label: "人群",
          rootCause: "compile_missing_audience_projection",
        },
        {
          objectType: "value_proposition",
          label: "卖点",
          rootCause: "compile_missing_selling_point_projection",
        },
        {
          objectType: "creative_asset_pattern",
          label: "素材",
          rootCause: "compile_missing_creative_asset_projection",
        },
        {
          objectType: "metric_signal",
          label: "指标",
          rootCause: "compile_missing_metric_projection",
        },
        {
          objectType: "optimization_action",
          label: "动作",
          rootCause: "compile_missing_action_projection",
        },
      ]

      for (const spec of objectTypeLabels) {
        const objects = report.understanding.businessObjects.filter((item) => item.objectType === spec.objectType)
        if (objects.length === 0) {
          results.push({
            issueId: `compile-hero-${spec.objectType}-${report.docId}`,
            type: "semantic",
            severity: "warning",
            page: report.sourceName,
            detail: `主图设计场景缺少稳定的${spec.label}投影。`,
            issueScope: "wiki_compile",
            rootCause: spec.rootCause,
            blocking: true,
            linkedDocId: report.docId,
            linkedIssueIds: [],
          })
          continue
        }
        const hasProjection = pages.some((page) => objects.some((item) => page.content.includes(item.label)))
        if (!hasProjection) {
          results.push({
            issueId: `compile-hero-projection-${spec.objectType}-${report.docId}`,
            type: "semantic",
            severity: "warning",
            page: report.sourceName,
            detail: `${spec.label}对象已抽出，但没有稳定投影到主图设计业务页。`,
            issueScope: "wiki_compile",
            rootCause: spec.rootCause,
            blocking: true,
            linkedDocId: report.docId,
            linkedIssueIds: [],
          })
        }
      }

      if (report.understanding.businessRelations.length === 0) {
        results.push({
          issueId: `compile-hero-relations-${report.docId}`,
          type: "semantic",
          severity: "warning",
          page: report.sourceName,
          detail: "主图设计场景没有形成稳定的人群-卖点-素材-指标-动作关系闭环。",
          issueScope: "wiki_compile",
          rootCause: "compile_missing_relation_projection",
          blocking: true,
          linkedDocId: report.docId,
          linkedIssueIds: [],
        })
      }

      const actionsPage = pages.find((page) => page.relativePath === `business/${report.sourceName.replace(/\.[^.]+$/, "").toLowerCase()}/动作与实验.md`)
      const metricsPage = pages.find((page) => page.relativePath === `business/${report.sourceName.replace(/\.[^.]+$/, "").toLowerCase()}/指标与判断.md`)
      if (actionsPage && !/(验证|实验|AB|A\/B|测试|复盘)/i.test(actionsPage.content)) {
        results.push({
          issueId: `compile-hero-action-validation-${report.docId}`,
          type: "semantic",
          severity: "warning",
          page: report.sourceName,
          detail: "动作与实验页缺少验证方式或实验闭环描述。",
          issueScope: "wiki_compile",
          rootCause: "compile_missing_action_projection",
          blocking: true,
          linkedDocId: report.docId,
          linkedIssueIds: [],
        })
      }
      if (metricsPage && !/(证据|数据|来源|source_refs|sources:)/i.test(metricsPage.content)) {
        results.push({
          issueId: `compile-hero-metric-evidence-${report.docId}`,
          type: "semantic",
          severity: "warning",
          page: report.sourceName,
          detail: "指标与判断页缺少证据或来源锚点。",
          issueScope: "wiki_compile",
          rootCause: "compile_missing_metric_projection",
          blocking: true,
          linkedDocId: report.docId,
          linkedIssueIds: [],
        })
      }
    }

    const strongEntities = report.understanding.entityCandidates.filter(
      (entity) => entity.confidence >= 0.65,
    )
    if (strongEntities.length > 0) {
      const hasProjection = pages.some((page) =>
        strongEntities.some((entity) => page.content.includes(entity.name)),
      )
      if (!hasProjection) {
        results.push({
          issueId: `compile-entity-projection-${report.docId}`,
          type: "semantic",
          severity: "info",
          page: report.sourceName,
          detail: "高置信业务实体没有稳定投影到业务知识页或来源摘要中。",
          issueScope: "wiki_compile",
          rootCause: "compile_field_drop",
          blocking: false,
          linkedDocId: report.docId,
          linkedIssueIds: [],
        })
      }
    }

    if (report.understanding.imageEvidenceHighlights.length > 0) {
      const hasImageProjection = pages.some((page) =>
        report.understanding.imageEvidenceHighlights.some((item) => item && page.content.includes(item)),
      )
      if (!hasImageProjection) {
        results.push({
          issueId: `compile-image-evidence-${report.docId}`,
          type: "semantic",
          severity: "info",
          page: report.sourceName,
          detail: "图片或视觉证据没有稳定投影到证据页中。",
          issueScope: "wiki_compile",
          rootCause: "compile_wrong_attachment",
          blocking: false,
          linkedDocId: report.docId,
          linkedIssueIds: [],
        })
      }
    }

    if (report.sourceKind === "xmind" && report.understanding.mindmapSummary.length > 0) {
      const hasMindmapPage = pages.some((page) =>
        page.relativePath === `business/${report.sourceName.replace(/\.[^.]+$/, "").toLowerCase()}/脑图结构.md`
        || page.content.includes("脑图结构"),
      )
      if (!hasMindmapPage) {
        results.push({
          issueId: `compile-mindmap-branch-${report.docId}`,
          type: "semantic",
          severity: "warning",
          page: report.sourceName,
          detail: "脑图分支没有稳定投影到独立的脑图结构页。",
          issueScope: "wiki_compile",
          rootCause: "compile_missing_stage_mapping",
          blocking: false,
          linkedDocId: report.docId,
          linkedIssueIds: [],
        })
      }
    }
  }

  return results
}

async function buildRetrievalResults(projectPath: string): Promise<LintResult[]> {
  const reports = await loadAgentModeReports(projectPath)
  const results: LintResult[] = []

  for (const report of reports) {
    const probes = report.sceneId === "ecom_growth_hero_image"
      ? [
          "这个主图要打给谁？",
          "当前主打卖点是什么？",
          "CTR 低时先改什么素材动作？",
          "这份资料建议看哪些指标判断主图问题？",
        ]
      : report.groundTruth.mainlineSteps.slice(0, 2)
    const fieldProbe = report.groundTruth.fields.find((field) => field.value.trim())
    if (fieldProbe) {
      probes.push(`${fieldProbe.label} 怎么判断`)
    }
    for (const query of probes.filter(Boolean)) {
      const hits = await searchWiki(projectPath, query)
      if (hits.length === 0) {
        results.push({
          issueId: `retrieval-not-indexed-${report.docId}-${query.slice(0, 24)}`,
          type: "semantic",
          severity: "warning",
          page: report.sourceName,
          detail: `黄金问句「${query}」没有命中任何 wiki 结果。`,
          issueScope: "retrieval_runtime",
          rootCause: "retrieval_not_indexed",
          blocking: false,
          linkedDocId: report.docId,
          linkedIssueIds: [],
        })
        continue
      }
      const meaningfulHit = hits.find(
        (hit) => !hit.path.endsWith("/wiki/index.md") && !hit.path.endsWith("/wiki/overview.md"),
      )
      if (!meaningfulHit) {
        results.push({
          issueId: `retrieval-priority-${report.docId}-${query.slice(0, 24)}`,
          type: "semantic",
          severity: "info",
          page: report.sourceName,
          detail: `黄金问句「${query}」只命中了 index/overview，未命中更具体的内容页。`,
          issueScope: "retrieval_runtime",
          rootCause: "retrieval_priority_miss",
          blocking: false,
          linkedDocId: report.docId,
          linkedIssueIds: [],
        })
        continue
      }
      const content = await readFile(meaningfulHit.path).catch(() => "")
      if (content && !content.includes("source_refs") && !content.includes("sources:")) {
        results.push({
          issueId: `retrieval-grounding-${report.docId}-${query.slice(0, 24)}`,
          type: "semantic",
          severity: "info",
          page: meaningfulHit.title,
          detail: `黄金问句「${query}」命中了页面，但页面缺少清晰的来源锚点。`,
          issueScope: "retrieval_runtime",
          rootCause: "retrieval_grounding_gap",
          blocking: false,
          linkedDocId: report.docId,
          linkedIssueIds: [],
        })
      }
    }
  }

  return results
}

function buildWikiHealthScorecard(report: {
  structuralResults: LintResult[]
  semanticResults: LintResult[]
  compileResults: LintResult[]
  retrievalResults: LintResult[]
  pages: number
}): HealthScorecard {
  const makeDimension = (
    key: string,
    label: string,
    weight: number,
    score: number,
    rationale: string,
    linkedIssueIds: string[],
    blockingBelow?: number,
  ): HealthDimensionScore => ({
    key,
    label,
    score: clampScore(score),
    weight,
    status: deriveHealthStatus(score, blockingBelow ? blockingBelow + 20 : 80, blockingBelow ?? 60),
    blockingBelow,
    rationale,
    linkedIssueIds,
  })

  const brokenLinks = report.structuralResults.filter((item) => item.rootCause === "wiki_broken_link")
  const sourceRefIssues = report.compileResults.filter((item) => item.rootCause === "compile_missing_source_ref_projection")
  const metadataIssues = report.structuralResults.filter((item) => item.rootCause === "wiki_no_outlinks")
  const orphanIssues = report.structuralResults.filter((item) => item.rootCause === "wiki_orphan_page")
  const compileIssues = report.compileResults
  const retrievalIssues = report.retrievalResults

  const dimensions: HealthDimensionScore[] = [
    makeDimension(
      "structure_integrity",
      "结构完整性",
      0.2,
      100 - brokenLinks.length * 25,
      "关注 broken links、结构断裂和明显的页面完整性问题。",
      brokenLinks.map((item) => item.issueId),
      60,
    ),
    makeDimension(
      "source_grounding",
      "来源落地",
      0.2,
      100 - sourceRefIssues.length * 30 - report.semanticResults.filter((item) => item.rootCause === "wiki_stale_claim").length * 15,
      "关注 wiki 是否把关键结论稳定投影回来源与证据。",
      [
        ...sourceRefIssues.map((item) => item.issueId),
        ...report.semanticResults
          .filter((item) => item.rootCause === "wiki_stale_claim")
          .map((item) => item.issueId),
      ],
      60,
    ),
    makeDimension(
      "metadata_completeness",
      "元数据完整度",
      0.15,
      Math.max(45, 100 - metadataIssues.length * 12),
      "关注页面是否具备可检索、可维护的基本元信息和链接出口。",
      metadataIssues.map((item) => item.issueId),
      55,
    ),
    makeDimension(
      "link_graph_health",
      "链接图健康",
      0.15,
      Math.max(40, 100 - orphanIssues.length * 18 - brokenLinks.length * 20),
      "关注孤儿页、坏链和链接网络是否形成基本互联。",
      [...orphanIssues.map((item) => item.issueId), ...brokenLinks.map((item) => item.issueId)],
      55,
    ),
    makeDimension(
      "compile_coverage",
      "编译覆盖",
      0.15,
      Math.max(35, 100 - compileIssues.length * 20),
      "关注 scene-aware compile 之后是否出现字段丢失、挂载缺失或来源映射缺失。",
      compileIssues.map((item) => item.issueId),
      60,
    ),
    makeDimension(
      "retrieval_readiness",
      "检索就绪度",
      0.15,
      Math.max(35, 100 - retrievalIssues.length * 18),
      "关注黄金问句是否能命中正确页面与来源层。",
      retrievalIssues.map((item) => item.issueId),
      55,
    ),
  ]

  const total = clampScore(dimensions.reduce((sum, item) => sum + item.score * item.weight, 0))
  return {
    score: total,
    status: deriveHealthStatus(total, 82, 62),
    summary:
      total >= 85
        ? "当前 wiki 健康度较好，已经具备稳定的中间层和检索层基础。"
        : total >= 75
          ? "当前 wiki 基本可用，但还有一些编译或检索层缺口值得继续修补。"
          : total >= 55
            ? "当前 wiki 有明显健康问题，建议先修复关键链接、来源映射和检索命中。"
            : "当前 wiki 还不适合作为稳定知识层，建议先修复高风险健康问题。",
    dimensions,
    updatedAt: new Date().toISOString(),
  }
}

function buildWikiPublishGate(report: WikiHealthReport): PublishGateDecision {
  const pick = (rootCause: LintResult["rootCause"]) =>
    [
      ...report.structuralResults,
      ...report.semanticResults,
      ...report.compileResults,
      ...report.retrievalResults,
    ].filter((item) => item.rootCause === rootCause)
  const rules: PublishGateRuleResult[] = [
    {
      ruleKey: "broken_links",
      label: "存在坏链",
      status: pick("wiki_broken_link").length > 0 ? "fail" : "pass",
      blocking: pick("wiki_broken_link").length > 0,
      message: pick("wiki_broken_link").length > 0 ? "存在 broken link，发布后会直接影响知识导航。" : "未发现坏链。",
      linkedIssueIds: pick("wiki_broken_link").map((item) => item.issueId),
    },
    {
      ruleKey: "missing_source_refs",
      label: "来源映射缺失",
      status:
        pick("wiki_missing_source_refs").length > 0 || pick("compile_missing_source_ref_projection").length > 0
          ? "fail"
          : "pass",
      blocking:
        pick("wiki_missing_source_refs").length > 0 || pick("compile_missing_source_ref_projection").length > 0,
      message:
        pick("wiki_missing_source_refs").length > 0 || pick("compile_missing_source_ref_projection").length > 0
          ? "关键页面或编译产物缺少来源映射。"
          : "来源映射没有发现阻塞问题。",
      linkedIssueIds: [
        ...pick("wiki_missing_source_refs").map((item) => item.issueId),
        ...pick("compile_missing_source_ref_projection").map((item) => item.issueId),
      ],
    },
    {
      ruleKey: "compile_mapping",
      label: "编译挂载缺口",
      status:
        pick("compile_field_drop").length > 0 ||
        pick("compile_wrong_attachment").length > 0 ||
        pick("compile_missing_stage_mapping").length > 0
          ? "fail"
          : "pass",
      blocking:
        pick("compile_field_drop").length > 0 ||
        pick("compile_wrong_attachment").length > 0 ||
        pick("compile_missing_stage_mapping").length > 0,
      message:
        pick("compile_field_drop").length > 0 ||
        pick("compile_wrong_attachment").length > 0 ||
        pick("compile_missing_stage_mapping").length > 0
          ? "编译后 wiki 丢失了关键字段或阶段挂载。"
          : "编译挂载没有发现阻塞项。",
      linkedIssueIds: [
        ...pick("compile_field_drop").map((item) => item.issueId),
        ...pick("compile_wrong_attachment").map((item) => item.issueId),
        ...pick("compile_missing_stage_mapping").map((item) => item.issueId),
      ],
    },
    {
      ruleKey: "retrieval_readiness",
      label: "检索优先级与索引命中",
      status:
        pick("retrieval_not_indexed").length > 0 || pick("retrieval_priority_miss").length > 0
          ? "warn"
          : "pass",
      blocking: false,
      message:
        pick("retrieval_not_indexed").length > 0 || pick("retrieval_priority_miss").length > 0
          ? "部分黄金问句的命中质量仍偏弱。"
          : "黄金问句检索命中基本正常。",
      linkedIssueIds: [
        ...pick("retrieval_not_indexed").map((item) => item.issueId),
        ...pick("retrieval_priority_miss").map((item) => item.issueId),
      ],
    },
    {
      ruleKey: "overall_wiki_health",
      label: "Wiki 总健康分",
      status: report.wikiHealth.score < 75 ? "warn" : "pass",
      blocking: false,
      message: report.wikiHealth.score < 75 ? "当前 wiki 总健康分偏低，建议继续修补后再正式发布。" : "当前 wiki 总健康分达到建议发布区间。",
      linkedIssueIds: report.wikiHealth.dimensions.flatMap((dimension) => dimension.linkedIssueIds),
    },
  ]

  const status = deriveGateStatus(rules)
  return {
    gateKey: "wiki_publish",
    mode: "soft",
    status,
    canPublish: true,
    overrideRequired: status === "fail",
    summary:
      status === "fail"
        ? "当前 wiki 存在高风险健康问题，仍可 override 发布，但建议先修复。"
        : status === "warn"
          ? "当前 wiki 可以发布，但建议继续修补健康问题。"
          : "当前 wiki 健康度达到正常发布区间。",
    rules,
    generatedAt: new Date().toISOString(),
  }
}

export async function runWikiHealthAudit(
  projectPath: string,
  llmConfig: LlmConfig | null,
  options?: { runSemantic?: boolean },
): Promise<WikiHealthReport> {
  const pp = normalizePath(projectPath)
  const structuralResults = await runStructuralLint(pp)
  const semanticResults = options?.runSemantic && llmConfig ? await runSemanticLint(pp, llmConfig) : []
  const compileResults = await buildCompileResults(pp)
  const retrievalResults = await buildRetrievalResults(pp)
  const pages = await readWikiPages(pp)

  const report: WikiHealthReport = {
    generatedAt: new Date().toISOString(),
    structuralResults,
    semanticResults,
    compileResults,
    retrievalResults,
    wikiHealth: buildWikiHealthScorecard({
      structuralResults,
      semanticResults,
      compileResults,
      retrievalResults,
      pages: pages.length,
    }),
    publishGate: {
      gateKey: "wiki_publish",
      mode: "soft",
      status: "warn",
      canPublish: true,
      overrideRequired: false,
      summary: "",
      rules: [],
      generatedAt: new Date().toISOString(),
    },
  }
  report.publishGate = buildWikiPublishGate(report)
  return report
}

export async function saveWikiHealthReport(projectPath: string, report: WikiHealthReport): Promise<string> {
  const pp = normalizePath(projectPath)
  await createDirectory(`${pp}/.llm-wiki/wiki-health`).catch(() => {})
  const path = `${pp}/.llm-wiki/wiki-health/latest.json`
  await writeFile(path, JSON.stringify(report, null, 2))
  return path
}
