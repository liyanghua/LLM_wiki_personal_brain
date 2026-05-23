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

function defaultSchemaProfile(sceneId: string): string {
  if (sceneId === "ecom_growth_task_generation") {
    return [
      "scene_id: ecom_growth_task_generation",
      "fields:",
      "  - key: operating_goal",
      "    label: 经营目标",
      "    required: true",
      "    cues: [目标, 经营目标, 阶段目标, why, why now]",
      "    page_key: task_goal",
      "  - key: operating_context",
      "    label: 经营上下文",
      "    required: true",
      "    cues: [经营背景, 现状, 数据, 周会, 月会, 复盘, 经营上下文]",
      "    page_key: task_context",
      "  - key: role_system",
      "    label: 角色系统",
      "    required: true",
      "    cues: [角色, 岗位, 职责, owner, 协同, 审批, 复盘人]",
      "    page_key: task_roles",
      "  - key: task_trigger",
      "    label: 任务触发",
      "    required: true",
      "    cues: [触发, 问题, 差距, 卡点, 异常, 机会, 会议结论]",
      "    page_key: task_triggers",
      "  - key: task_template",
      "    label: 任务模板",
      "    required: true",
      "    cues: [任务, 模板, schema, 结构, 任务卡, 任务单]",
      "    page_key: task_templates",
      "  - key: action_breakdown",
      "    label: 动作拆解",
      "    required: true",
      "    cues: [动作, 步骤, 执行, 拆解, 方案, 路径]",
      "    page_key: task_actions",
      "  - key: metrics_acceptance",
      "    label: 指标与验收",
      "    required: true",
      "    cues: [指标, 验收, 结果, 目标值, 观察期, 复盘标准]",
      "    page_key: task_metrics",
      "  - key: collaboration_network",
      "    label: 协同关系",
      "    required: true",
      "    cues: [协同, 配合, 上下游, 审批, 支持, 联动]",
      "    page_key: task_collaboration",
      "  - key: review_requirements",
      "    label: 复盘要求",
      "    required: true",
      "    cues: [复盘, 复核, 结论, 沉淀, 复用, 反馈]",
      "    page_key: task_review",
      "  - key: boundaries_and_exceptions",
      "    label: 边界与例外",
      "    required: true",
      "    cues: [边界, 例外, 不适用, 风险, 不做, 禁止, 待确认]",
      "    page_key: task_boundaries",
    ].join("\n")
  }
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

function defaultExpertGuidanceProfile(sceneId: string): string {
  if (sceneId === "ecom_growth_task_generation") {
    return [
      "scene_id: ecom_growth_task_generation",
      "guidance:",
      "  - 先识别经营目标、经营对象、经营阶段和文档类型，避免把任何会议记录或岗位表直接当任务结论。",
      "  - 再抽角色系统：谁负责、谁协同、谁审批、谁复盘，以及各角色的边界和权限。",
      "  - 再抽任务触发：目标差距、数据异常、周会/月会结论、绩效问题、组织卡点分别触发什么任务。",
      "  - 再抽任务模板：任务对象、问题证据、策略路径、动作步骤、指标、周期、验收要求。",
      "  - 任务动作必须具体到可执行层，避免“优化、加强、关注、跟进”这类空泛表达。",
      "  - 每条任务都要补 owner、协同角色、复盘要求和证据锚点，确保可追踪、可复盘、可沉淀。",
      "  - 同一角色、同一任务在不同文档中出现差异时，保留 comparison / contradiction 关系，不要直接覆盖。",
      "  - 输出时优先形成角色页、任务机制页、会议页、质量页、协同页、复盘页，并保留待专家确认项。",
    ].join("\n")
  }
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

function defaultEvaluationProfile(sceneId: string): string {
  if (sceneId === "ecom_growth_task_generation") {
    return [
      "scene_id: ecom_growth_task_generation",
      "dimensions:",
      "  - key: structure_coverage",
      "    label: 结构覆盖度",
      "    weight: 0.15",
      "  - key: role_coverage",
      "    label: 角色覆盖度",
      "    weight: 0.15",
      "  - key: task_completeness",
      "    label: 任务完整度",
      "    weight: 0.2",
      "  - key: evidence_quality",
      "    label: 证据支撑度",
      "    weight: 0.2",
      "  - key: executability",
      "    label: 可执行性",
      "    weight: 0.15",
      "  - key: collaboration_coverage",
      "    label: 协同完整度",
      "    weight: 0.1",
      "  - key: review_loop",
      "    label: 复盘闭环",
      "    weight: 0.05",
      "  - key: contradiction_handling",
      "    label: 冲突处理",
      "    weight: 0.05",
      "thresholds:",
      "  auto_publish: 85",
      "  human_review: 70",
      "  below_review: 70",
    ].join("\n")
  }
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

function defaultStrategyProfile(sceneId: string): string {
  if (sceneId === "ecom_growth_task_generation") {
    return [
      "scene_id: ecom_growth_task_generation",
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
      "  - key: goal_alignment",
      "    label: 目标对齐",
      "    source_field_keys: [operating_goal, operating_context]",
      "    action_template:",
      "      trigger_cues: [目标不清, 阶段不清, 经营目标缺失, 目标差距]",
      "      required_inputs: [经营目标, 当前经营上下文, 阶段重点, 目标口径]",
      "      output_artifact: 经营目标对齐表",
      "      validation_metrics: [目标覆盖率, 目标一致性, 任务采纳率]",
      "  - key: role_task_decomposition",
      "    label: 角色拆解",
      "    source_field_keys: [role_system, task_trigger]",
      "    action_template:",
      "      trigger_cues: [角色不清, owner不清, 协同边界不清]",
      "      required_inputs: [岗位职责, owner, 协同角色, 审批角色, 复盘角色]",
      "      output_artifact: 角色任务拆解表",
      "      validation_metrics: [角色匹配度, 责任唯一性, 协同完整度]",
      "  - key: meeting_to_task_compilation",
      "    label: 会议转任务",
      "    source_field_keys: [operating_context, task_trigger, task_template]",
      "    action_template:",
      "      trigger_cues: [周会/月会需要下发任务, 会议结论待落地, 行动项需要编译]",
      "      required_inputs: [会议纪要, 目标, 问题证据, 任务模板, 约束条件]",
      "      output_artifact: 会议任务编译表",
      "      validation_metrics: [会议行动项转化率, 任务完整度, 会议到执行闭环率]",
      "  - key: quality_scoring",
      "    label: 质量评分",
      "    source_field_keys: [task_template, metrics_acceptance, review_requirements]",
      "    action_template:",
      "      trigger_cues: [任务质量待评估, 任务是否可下发, 需人工确认]",
      "      required_inputs: [任务结构, 证据支撑, 指标, 复盘要求, 边界条件]",
      "      output_artifact: 任务质量评分表",
      "      validation_metrics: [评分稳定性, 自动下发率, 人工修改率]",
      "  - key: collaboration_orchestration",
      "    label: 协同编排",
      "    source_field_keys: [role_system, collaboration_network, action_breakdown]",
      "    action_template:",
      "      trigger_cues: [多角色协同卡点, 任务跨角色交接, 上下游不清]",
      "      required_inputs: [主责, 协同角色, 交付物, 依赖关系, 节奏]",
      "      output_artifact: 协同编排表",
      "      validation_metrics: [协同完整度, 依赖清晰度, 任务推进效率]",
      "  - key: review_sinking",
      "    label: 复盘沉淀",
      "    source_field_keys: [metrics_acceptance, review_requirements, boundaries_and_exceptions]",
      "    action_template:",
      "      trigger_cues: [任务已完成, 需要复盘, 需要沉淀为策略资产]",
      "      required_inputs: [动作前后数据, 复盘结论, 下一步动作, 边界例外]",
      "      output_artifact: 复盘沉淀表",
      "      validation_metrics: [复盘完成率, 策略沉淀率, 复用率]",
      "skill_family_mapping:",
      "  goal_alignment: goal_alignment",
      "  role_task_decomposition: role_task_decomposition",
      "  meeting_to_task_compilation: meeting_to_task_compilation",
      "  quality_scoring: quality_scoring",
      "  collaboration_orchestration: collaboration_orchestration",
      "  review_sinking: review_sinking",
    ].join("\n")
  }
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

  const sceneId = manifest.scene_id || "ecom_growth_hero_image"
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
    defaultSchemaProfile(sceneId),
    persistDefaults,
  )
  const expertGuidanceRaw = await ensureTextFile(
    paths.expertGuidancePath,
    defaultExpertGuidanceProfile(sceneId),
    persistDefaults,
  )
  const evaluationRaw = await ensureTextFile(
    paths.evaluationProfilePath,
    defaultEvaluationProfile(sceneId),
    persistDefaults,
  )
  const strategyRaw = await ensureTextFile(
    paths.strategyProfilePath,
    defaultStrategyProfile(sceneId),
    persistDefaults,
  )

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
