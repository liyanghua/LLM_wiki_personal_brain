import { load as loadYaml } from "js-yaml"
import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { getFileName, normalizePath } from "@/lib/path-utils"
import type { OutputLanguage } from "@/stores/wiki-store"
import type { ScenePack, ScenePackManifest, ScenePackPaths } from "@/lib/agent-mode-types"
import { BUSINESS_TEMPLATE_PURPOSE, BUSINESS_TEMPLATE_SCHEMA } from "@/lib/templates"

interface EnsureScenePackOptions {
  persistDefaults?: boolean
  defaultLanguage?: OutputLanguage
}

function defaultManifest(projectPath: string, defaultLanguage: OutputLanguage): ScenePackManifest {
  const projectName = getFileName(projectPath)
  return {
    scene_id: "ecom_growth_hero_image",
    scene_name: `${projectName} · 主图设计`,
    doc_type: "hero_image_strategy",
    default_output_language: defaultLanguage === "auto" ? "Chinese" : defaultLanguage,
    profiles_version: "1.0.0",
    source_snapshot_origin: "project-local",
  }
}

function defaultSchemaProfile(): string {
  return [
    "scene_id: ecom_growth_hero_image",
    "fields:",
    "  - key: business_goal",
    "    label: 业务目标",
    "    required: true",
    "    cues: [目标, 目的, why, why now]",
    "    page_key: business_index",
    "  - key: target_audiences",
    "    label: 目标人群",
    "    required: true",
    "    cues: [人群, 用户, 消费者, 客户, 买家, 受众]",
    "    page_key: hero_audiences",
    "  - key: audience_situations",
    "    label: 人群场景",
    "    required: true",
    "    cues: [场景, 需求, 痛点, 任务, 使用场景, 购物场景]",
    "    page_key: hero_audiences",
    "  - key: selling_points",
    "    label: 卖点与利益点",
    "    required: true",
    "    cues: [卖点, 利益点, 核心点, 价值点, 购买理由, 证明点]",
    "    page_key: hero_value_props",
    "  - key: creative_assets",
    "    label: 素材与版式",
    "    required: true",
    "    cues: [主图, 素材, 版式, 构图, 文案, 视觉, 背景, 模特, 画面]",
    "    page_key: hero_creative_assets",
    "  - key: metric_signals",
    "    label: 指标信号",
    "    required: true",
    "    cues: [CTR, 点击率, 转化率, CVR, 曝光, 跳失, 加购, 退款, ROI]",
    "    page_key: hero_metric_judgement",
    "  - key: action_playbook",
    "    label: 动作打法",
    "    required: true",
    "    cues: [动作, 优化, 调整, 改法, 建议, 先改, 下一步, 方案]",
    "    page_key: hero_actions_experiments",
    "  - key: decision_rules",
    "    label: 判断规则",
    "    required: true",
    "    cues: [判断, 决策, 标准, 阈值, 优先, 先后, 判断逻辑]",
    "    page_key: hero_metric_judgement",
    "  - key: experiment_evidence",
    "    label: 实验与证据",
    "    required: true",
    "    cues: [实验, 测试, AB, A/B, 证据, 案例, 数据, 复盘]",
    "    page_key: evidence_cases",
    "  - key: boundaries",
    "    label: 边界与例外",
    "    required: true",
    "    cues: [边界, 例外, 不适用, 风险]",
    "    page_key: boundaries",
  ].join("\n")
}

function defaultExpertGuidanceProfile(): string {
  return [
    "scene_id: ecom_growth_hero_image",
    "guidance:",
    "  - 先识别人群是谁、在什么购物任务或转化场景中看这张主图。",
    "  - 再抽卖点、利益点、证明点，以及这些卖点适合对哪类人群表达。",
    "  - 再抽主图素材、版式、文案、视觉元素和禁忌项。",
    "  - 对每个指标信号都尽量补“异常意味着什么、先怀疑什么、下一步改什么”。",
    "  - 动作建议必须尽量带验证方式或实验建议，避免只有泛化口号。",
    "  - 最后补边界、反例、不适用人群和待专家确认的问题。",
  ].join("\n")
}

function defaultEvaluationProfile(): string {
  return [
    "scene_id: ecom_growth_hero_image",
    "dimensions:",
    "  - key: structure_coverage",
    "    label: 结构覆盖度",
    "    weight: 0.2",
    "  - key: audience_fit",
    "    label: 人群贴合度",
    "    weight: 0.2",
    "  - key: judgement_quality",
    "    label: 关键判断质量",
    "    weight: 0.2",
    "  - key: evidence_quality",
    "    label: 证据支撑度",
    "    weight: 0.25",
    "  - key: actionability",
    "    label: 可执行性",
    "    weight: 0.15",
  ].join("\n")
}

function defaultStrategyProfile(): string {
  return [
    "scene_id: ecom_growth_hero_image",
    "schema_version: 2",
    "action_card_contract:",
    "  fields:",
    "    - triggerCondition",
    "    - requiredInputs",
    "    - actionSteps",
    "    - outputArtifact",
    "    - validationMetrics",
    "    - evidenceRefs",
    "    - wikiRefs",
    "    - missingInputs",
    "    - skillFamily",
    "card_types:",
    "  - key: audience_segment_diagnosis",
    "    label: 人群诊断",
    "    source_field_keys: [target_audiences, audience_situations]",
    "    action_template:",
    "      trigger_cues: [人群不清, 场景不清, 目标用户缺失]",
    "      required_inputs: [目标人群, 人群场景, 购物任务, 关键痛点]",
    "      output_artifact: 人群-场景诊断表",
    "      validation_metrics: [CTR分人群表现, CVR分人群表现, 收藏加购率]",
    "  - key: value_prop_selection",
    "    label: 卖点选择",
    "    source_field_keys: [selling_points, decision_rules]",
    "    action_template:",
    "      trigger_cues: [卖点不聚焦, 利益点弱, 证明点不足]",
    "      required_inputs: [目标人群, 候选卖点, 证明点, 判断规则]",
    "      output_artifact: 卖点优先级选择表",
    "      validation_metrics: [CTR, CVR, 咨询转化, 加购率]",
    "  - key: creative_asset_brief_generation",
    "    label: 素材表达",
    "    source_field_keys: [creative_assets, selling_points]",
    "    action_template:",
    "      trigger_cues: [主图表达弱, 素材不匹配, 版式混乱]",
    "      required_inputs: [核心卖点, 素材元素, 版式要求, 禁忌项]",
    "      output_artifact: 主图素材 brief",
    "      validation_metrics: [CTR, 停留时长, 跳失率, 图点击热区]",
    "  - key: metric_signal_diagnosis",
    "    label: 指标诊断",
    "    source_field_keys: [metric_signals, decision_rules]",
    "    action_template:",
    "      trigger_cues: [CTR低, CVR低, 曝光异常, 加购异常]",
    "      required_inputs: [指标信号, 判断阈值, 对照样本, 归因规则]",
    "      output_artifact: 指标异常归因表",
    "      validation_metrics: [CTR, CVR, 加购率, ROI]",
    "  - key: optimization_action_planning",
    "    label: 优化动作",
    "    source_field_keys: [action_playbook, decision_rules]",
    "    action_template:",
    "      trigger_cues: [需要下一步动作, 需要优化方案, 当前方案未验证]",
    "      required_inputs: [问题归因, 优先级规则, 可调整素材, 约束边界]",
    "      output_artifact: 优化动作清单",
    "      validation_metrics: [动作完成率, CTR提升, CVR提升, 实验胜率]",
    "  - key: experiment_validation_plan",
    "    label: 实验验证",
    "    source_field_keys: [experiment_evidence, action_playbook, metric_signals]",
    "    action_template:",
    "      trigger_cues: [需要AB测试, 缺验证计划, 证据不足]",
    "      required_inputs: [待验证假设, 测试变量, 指标口径, 样本范围]",
    "      output_artifact: A/B实验验证计划",
    "      validation_metrics: [实验显著性, CTR变化, CVR变化, ROI变化]",
    "skill_family_mapping:",
    "  audience_segment_diagnosis: audience_segment_diagnosis",
    "  value_prop_selection: value_prop_selection",
    "  creative_asset_brief_generation: creative_asset_brief_generation",
    "  metric_signal_diagnosis: metric_signal_diagnosis",
    "  optimization_action_planning: optimization_action_planning",
    "  experiment_validation_plan: experiment_validation_plan",
  ].join("\n")
}

function defaultPurpose(projectName: string): string {
  return BUSINESS_TEMPLATE_PURPOSE.replace(/业务文档工作台/g, `${projectName} 工作台`)
}

function defaultSchema(projectName: string): string {
  return BUSINESS_TEMPLATE_SCHEMA.replace("业务文档知识沉淀", `${projectName} 知识沉淀`)
}

async function tryReadFile(path: string): Promise<string> {
  try {
    return await readFile(path)
  } catch {
    return ""
  }
}

function safeParseYaml(content: string): Record<string, unknown> {
  if (!content.trim()) return {}
  const parsed = loadYaml(content)
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>
  }
  return {}
}

async function ensureTextFile(path: string, content: string, persistDefaults: boolean): Promise<string> {
  const existing = await tryReadFile(path)
  if (existing.trim()) return existing
  if (persistDefaults) {
    await writeFile(path, content)
    return content
  }
  return content
}

export async function ensureScenePack(
  projectPath: string,
  options: EnsureScenePackOptions = {},
): Promise<ScenePack> {
  const pp = normalizePath(projectPath)
  const persistDefaults = options.persistDefaults ?? true
  const defaultLanguage = options.defaultLanguage ?? "Chinese"
  const projectName = getFileName(pp)

  const paths: ScenePackPaths = {
    manifestPath: `${pp}/.llm-wiki/scene/manifest.json`,
    purposePath: `${pp}/purpose.md`,
    schemaPath: `${pp}/schema.md`,
    schemaProfilePath: `${pp}/SchemaProfile.yaml`,
    expertGuidancePath: `${pp}/ExpertGuidanceProfile.yaml`,
    evaluationProfilePath: `${pp}/EvaluationProfile.yaml`,
    strategyProfilePath: `${pp}/StrategyProfile.yaml`,
    snapshotDir: `${pp}/.llm-wiki/scene/profiles`,
  }

  if (persistDefaults) {
    await createDirectory(`${pp}/.llm-wiki/scene`).catch(() => {})
    await createDirectory(paths.snapshotDir).catch(() => {})
  }

  const purposeMarkdown = await ensureTextFile(
    paths.purposePath,
    defaultPurpose(projectName),
    persistDefaults,
  )
  const schemaMarkdown = await ensureTextFile(
    paths.schemaPath,
    defaultSchema(projectName),
    persistDefaults,
  )
  const schemaProfileRaw = await ensureTextFile(
    paths.schemaProfilePath,
    defaultSchemaProfile(),
    persistDefaults,
  )
  const expertGuidanceRaw = await ensureTextFile(
    paths.expertGuidancePath,
    defaultExpertGuidanceProfile(),
    persistDefaults,
  )
  const evaluationRaw = await ensureTextFile(
    paths.evaluationProfilePath,
    defaultEvaluationProfile(),
    persistDefaults,
  )
  const strategyRaw = await ensureTextFile(
    paths.strategyProfilePath,
    defaultStrategyProfile(),
    persistDefaults,
  )

  let manifest: ScenePackManifest
  const rawManifest = await tryReadFile(paths.manifestPath)
  if (rawManifest.trim()) {
    try {
      manifest = JSON.parse(rawManifest) as ScenePackManifest
    } catch {
      manifest = defaultManifest(pp, defaultLanguage)
    }
  } else {
    manifest = defaultManifest(pp, defaultLanguage)
    if (persistDefaults) {
      await writeFile(paths.manifestPath, JSON.stringify(manifest, null, 2))
    }
  }

  if (persistDefaults) {
    await writeFile(`${paths.snapshotDir}/purpose.md`, purposeMarkdown)
    await writeFile(`${paths.snapshotDir}/schema.md`, schemaMarkdown)
    await writeFile(`${paths.snapshotDir}/SchemaProfile.yaml`, schemaProfileRaw)
    await writeFile(`${paths.snapshotDir}/ExpertGuidanceProfile.yaml`, expertGuidanceRaw)
    await writeFile(`${paths.snapshotDir}/EvaluationProfile.yaml`, evaluationRaw)
    await writeFile(`${paths.snapshotDir}/StrategyProfile.yaml`, strategyRaw)
  }

  return {
    manifest,
    paths,
    purposeMarkdown,
    schemaMarkdown,
    schemaProfile: safeParseYaml(schemaProfileRaw),
    expertGuidanceProfile: safeParseYaml(expertGuidanceRaw),
    evaluationProfile: safeParseYaml(evaluationRaw),
    strategyProfile: safeParseYaml(strategyRaw),
  }
}
