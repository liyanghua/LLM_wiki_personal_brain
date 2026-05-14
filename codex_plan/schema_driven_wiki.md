# Phase 1 升级计划：Process Spine 驱动的交互式问答 Agent

## Summary
- 路线选择：继续基于当前版本升级，不从 0 重写；以 `raw_new + pilot workspace` 作为 Phase 1 默认试验场，主工作区保留现有链路可回退。
- 第一阶段目标：先把“交互式问答 Agent”做成一个真正以 `主干链路SOP` 为骨架的知识访谈工作台，而不是继续堆一个更强的 QA 控制台。
- 核心策略：围绕 [docs/architechture_v2.md](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/docs/architechture_v2.md) 的新主线，建立 `Schema + Domain Injection -> Normalize/Graphify -> Process Spine -> Wiki Compile -> Retrieval/Interview` 的 Phase 1 闭环。
- 实现深度：Phase 1 只做到“检索就绪层”。
  - 产出 `主干链路SOP + stage/step pages + attachment graph + retrieval metadata`
  - ontology 先只产出轻量候选，不做完整 projection
  - Hermes 继续只做 runtime/orchestrator，不承载领域规则
- graphify 接入策略：只对 `主干链路SOP / drawio / xmind` 强接入；普通 markdown 继续走 schema + LLM compile。参考 [graphify README](https://github.com/safishamsi/graphify)，它适合做 `graph.json / report / extracted/inferred/ambiguous` 的中间结构层，而不是直接替代你的 wiki/compiler。

## Key Changes
### 1. 把 `主干链路SOP` 升级为 Process Spine canonical asset
- `raw_new/industry_docs/主干链路SOP.md` 不再被当普通 topic 文档，而是固定识别为 `ProcessFlow` 主干资产。
- 新增 `process-aware descriptor` 规则：
  - 优先读文件级 `*.meta.yaml`
  - 明确 `doc_type=process_sop`
  - 解析 `stage / step / artifact / decision / metric` 挂载信息
- compiler 不再只产出 topic wiki，而是同时产出：
  - `wiki/主干链路SOP.md`
  - `wiki/stages/*.md`
  - `wiki/steps/*.md`
  - `wiki/index/process_sop_index.md`
- 所有新 source 在进入 wiki 之前，先尝试回答：
  - 属于哪个 stage
  - 属于哪个 step
  - 支撑哪个 artifact / decision / metric
  - 若无法可靠挂载，显式标记 `unattached`，而不是静默写成普通摘要页

### 2. Schema 升级为“电商知识 + process-aware”控制平面
- 保留现有目录级 schema，但扩成双层控制：
  - 目录级 `_dir_schema.yaml` 负责默认 ingest / retrieval / governance 策略
  - 文件级 descriptor 负责单文档特例，优先用于 `主干链路SOP`、xmind、drawio、关键方法文档
- `SourceRecord` 增加 process 相关派生字段：
  - `descriptor_path`
  - `canonical_asset_type`
  - `process_stage_id`
  - `process_step_id`
  - `attachment_refs`
  - `graph_node_refs`
  - `compile_confidence`
- domain profiles 升级重点不是再加泛字段，而是补电商过程知识：
  - stage/step 词典
  - 主图 CTR 与产品塑造相关 decision ontology
  - artifact/metric 词典
  - `主干链路SOP` 的 stage/step alias 归一
- `主干链路SOP`、`6大维度`、视觉/测图文档要有明确的 stage/step 挂载规则，避免再出现只生成 `untitled` 或“知道这篇文档重要但不知道挂到哪”的情况。

### 3. 新建 Normalize + Graphify 中间层，但只对主干型文档强接入
- 在 pilot workspace 下新增稳定中间层：
  - `normalized/*.md`
  - `normalized/*.graph.json`
  - `normalized/*.meta.yaml`
  - `normalized/registries/node_registry.json`
  - `normalized/registries/edge_registry.json`
  - `normalized/registries/claim_bank.jsonl`
- `graphify` 只接入两类输入：
  - `主干链路SOP.drawio/xml/xmind`
  - 其他明确是流程图/脑图的结构型文档
- 普通行业 markdown 不强制 graphify；Phase 1 仍由 LLM compiler 结合 schema/domain profile 做对象级抽取。
- backend 封装 `graphify adapter/importer`：
  - 不让前端、Hermes、runtime 直接依赖 graphify 输出格式
  - backend 只消费归一后的 `graph nodes / edges / claim bank / ambiguity flags`
- 关键约束：
  - graphify 是中间结构增强层，不直接当 wiki，不直接当 ontology 正式对象
  - `EXTRACTED / INFERRED / AMBIGUOUS` 必须保留下来，供后续质量检查和问答 trace 使用

### 4. Wiki 生产从“单页摘要”升级为“Process-aware + LLM compile”
- `wiki/compiler` 从“按标题启发式生成 topic/principle/project”升级为两类编译模式：
  - `process spine compile`
  - `object-level wiki compile`
- `process spine compile` 负责维护：
  - 主干总览页
  - stage 页
  - step 页
  - process index 页
- `object-level wiki compile` 负责维护：
  - concept/rule/case/signal/boundary 页
  - 并带上 `stage/step linkage`
- LLM 在 compiler 中的职责固定为：
  - 从 normalized text + graph + schema + domain profile 中抽取对象、关系、边界、信号
  - 判断“该挂到哪个 stage/step”
  - 生成页内结构化区块
- 不允许继续只靠纯规则摘要。
- 新 wiki 质量门槛：
  - 禁止 `untitled`
  - 每页必须可回溯到 `schema_route + source_refs + process attachment`
  - process 相关页必须含 `stage_id/step_id` 或 `linked_stage/linked_step`
  - conversation 内容不得直接进入主干流程页正文

### 5. 检索与索引改成“先流程定位，再对象召回”
- 在 pilot workspace 里重新跑一遍 wiki 生成与索引生成，作为 Phase 1 前置。
- 检索主策略改为：
  - query -> classify stage/step intent
  - retrieve stage/step page
  - retrieve linked rules/cases/sources
  - 必要时 drill-down raw evidence
- qmd collection 分层建议固定为：
  - `wiki`：主回答层
  - `process`：stage/step/process index 主导航层
  - `raw_industry_docs`：evidence augmentation
  - `raw_conversations`：interview-only / trace-only
- `search-rebuild` 增加 process-aware context，不再只给 `topics/principles/projects/sources`。
- `/api/ask` 与 extraction retrieval buckets 统一增加 `process_context`：
  - `current_stage`
  - `current_step`
  - `linked_rules`
  - `linked_cases`
  - `linked_sources`
- 问答优先命中 `stage/step` 页面和其挂载规则，不再直接对全 wiki 做“无脑 top-k”。

### 6. 交互式问答 Agent 按 PRD 收拢成真正的知识访谈台
- 继续复用当前 `Extraction Interview` 内核，但产品心智切到 [docs/prd_interaction_QA_IA_AND_PAGES.md](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/docs/prd_interaction_QA_IA_AND_PAGES.md)：
  - 顶部 Session 信息
  - 左侧当前目标/阶段/进度
  - 中间对话主区
  - 右侧候选知识区
  - 底部待追问问题池
- `Agent Trace` 保留，但降级为诊断辅栏，不再做主产品视图。
- extraction state / product 对象补 process 语义：
  - `InterviewSession` 新增 `current_stage/current_step`
  - `CandidateAsset` 新增 `stage_refs/step_refs/decision_refs`
  - `FollowupQuestion` 新增 `linked_stage/linked_step`
  - `SessionSummary` 要按 `概念 / 规则 / 案例 / 边界 / 仍未解决问题` 收束
- follow-up 逻辑从“缺槽追问”升级为“缺槽 + 流程挂载 + 边界补证据”：
  - 优先问能补全 stage/step 决策的问题
  - 再问边界、反例、证据
- Quick Answer 保留兼容，但默认模式仍建议是 `Extraction Interview`。

## Important Interfaces
- CLI 新增或升级：
  - `schema-init --root raw_new`
  - `build-wiki --workspace pilot_workspace_main`
  - `search-rebuild --workspace pilot_workspace_main`
  - `wiki-quality-report --workspace pilot_workspace_main`
- 中间层产物合同：
  - `normalized/*.graph.json`
  - `node_registry.json`
  - `edge_registry.json`
  - `claim_bank.jsonl`
- SourceRecord 扩展字段：
  - `descriptor_path`
  - `canonical_asset_type`
  - `process_stage_id`
  - `process_step_id`
  - `attachment_refs`
  - `graph_node_refs`
  - `compile_confidence`
- Ask / Extraction API 返回体新增：
  - `process_context`
  - `current_stage`
  - `current_step`
  - `linked_rules`
  - `linked_cases`
- 前端实体新增或升级：
  - `ProcessContext`
  - `CandidateAsset.stage_refs/step_refs`
  - `FollowupQuestion.linked_stage/linked_step`

## Test Plan
- 编译链路
  - `主干链路SOP.md + .meta.yaml + .graph.json` 能稳定生成主干总页、stage 页、step 页
  - `6大维度·42个细分变量选择逻辑01.md` 能挂到正确 stage/step，并在 wiki 页保留 `维度1：视觉核心层（决定第一眼停留）`
  - 不再生成 `untitled.md`
- graphify 接入
  - `主干链路SOP` 家族文档能产出并导入 `graph.json/node/edge/claim` 中间产物
  - graphify 失败时，LLM compiler 可降级但会显式告警，不静默跳过
- 质量检查
  - `wiki-quality-report` 新增 process-aware 审计：
    - 页面是否挂到 stage/step
    - 是否存在 unattached source
    - conversation 是否误发布到 process spine
    - process 页是否缺 source refs / linked assets
- 检索与问答
  - 黄金问题先验证：
    - `6大维度首先看哪个维度`
    - `品牌经营OS和SUPER指标之间是什么关系`
    - `主干链路SOP里产品塑造阶段要看哪些关键判断`
  - 要求能看到：
    - 命中的 stage/step
    - 命中的 linked rule/case/source
    - raw 补证据是否发生
- 前端交互
  - Ask Workspace 能显示 `Session/阶段/候选资产/问题池`
  - 专家编辑候选资产后，后续问题优先级会重算
  - `Agent Trace` 仍可查看，但不阻塞主问答流

## Assumptions
- Phase 1 固定采用 `Pilot 优先`，不直接替换主工作区默认知识底座。
- graphify 只对 `主干链路SOP / drawio / xmind` 强接入；普通 markdown 不做全量 graphify。
- Phase 1 只做到“检索就绪层”，不完成完整 ontology projection、Governance Center、Skill Factory。
- 继续基于现有 extraction / qmd / trace / candidate asset 基础设施演进，不另开 greenfield 系统。
- 实现前先重跑一次 `raw_new -> wiki -> search index`，新的 Phase 1 交互式问答 Agent 只消费这套重建后的 pilot 资产。
