````md
# Expert Brain Studio × Ontology Brain × Industrial Skills
## 总体架构说明（AI-coding 参考标的）

---

## 1. 文档目标

本文档将前面讨论的总体架构收敛为一份 **可供 AI-coding / 工程实现 / 产品设计 / 系统拆分** 参考的 Markdown 标的。

目标是定义一条完整链路：

**业务专家初步整理的 raw sources**
→ **Schema 定义（融入电商行业知识）**
→ **Normalize / Graphify**
→ **Wiki Compile**
→ **Process Spine（主干链路SOP）**
→ **Ontology Brain（核心电商决策本体）**
→ **Skill Factory**
→ **下游 Agent Runtime / 业务工作台**
→ **Feedback 回流自进化**

---

## 2. 总体一句话

**把业务专家初步整理的 raw，通过“目录级 schema + 文件级 descriptor + 电商领域知识注入”进行结构化编译，沉淀为 persistent wiki、process spine、核心电商决策本体与工业级 skills，最终由多个 Agent 持续消费、纠错、回流和进化。**

---

## 3. 总体架构分层

---

### Layer 1. Raw Sources
业务专家初步整理的原始资料层。

#### 典型来源
- `industry_docs/`
  - 行业规则文档
  - SOP
  - 方法论文档
  - 类目案例
  - xmind / drawio
- `conversations/`
  - 访谈日志
  - 递进式问答中间稿
- `attachments/`
  - docx
  - xlsx
  - png
- `data/`
  - 指标表
  - 统计表
  - 实验表
- `notes/`
  - 工作笔记
  - 临时洞察
- `links/`
  - 外部来源登记

#### 原则
- Raw 永远只读
- 不直接把 raw 当最终知识
- 所有知识都要可追溯回 raw

---

### Layer 2. Schema & Domain Injection
这是 compiler 的前置理解层，不是普通 metadata。

由三部分组成：

#### 2.1 目录级 Schema
定义某个目录下文档的默认策略：
- 默认 source_type
- 默认 role_in_pipeline
- 默认 ingest_mode
- 默认 preferred_outputs
- 默认 risk_flags
- 默认 retrieval_policy

#### 2.2 文件级 Descriptor
定义单文件特例：
- 它是什么
- 该抽什么
- 不该抽什么
- 可信度如何
- 优先更新哪些 wiki / ontology / process node

#### 2.3 Domain Profiles
注入电商领域先验：
- 电商术语归一
- 主图 CTR 领域本体
- 访谈问题分类体系
- 指标字典
- 类目特定规则

#### 作用
这一层决定：
- 该抽什么
- 不该抽什么
- 该走哪条 ingest 路由
- 该优先挂到哪个 stage / step / wiki page / ontology object

---

### Layer 3. Normalize & Graphify
结构化预编译层。

### 3.1 目标
不要把 raw 直接写成 wiki，而是先转成稳定中间表示。

### 3.2 典型转换
- `docx -> markdown`
- `xlsx -> table schema / metric blocks`
- `xmind / drawio -> graph_json / outline`
- `png -> OCR / vision summary / visual groups`

### 3.3 Graphify 的作用
Graphify 更适合放在 raw 与 wiki 之间，做结构增强层。

#### 输出对象
- `graph.json`
- `node registry`
- `edge registry`
- `community / cluster`
- `claim bank`
- `retrieval metadata`

#### 关系类型建议
- extracted
- inferred
- ambiguous

### 3.4 中间产物建议
- `normalized/*.md`
- `normalized/*.graph.json`
- `normalized/*.meta.yaml`
- `registries/node_registry.json`
- `registries/edge_registry.json`
- `registries/claim_bank.jsonl`

---

### Layer 4. Wiki Compile
Persistent Wiki 知识沉淀层。

### 4.1 目标
wiki 不是临时检索结果，而是持续维护的知识工件。

### 4.2 wiki compiler 的新职责
不再只是：
- 对单文档做摘要

而是：
- 从 graph + evidence + schema + domain profiles 编译 persistent wiki

### 4.3 推荐沉淀的页面类型
- Concept Pages
- Rule / Heuristic Pages
- Case Pages
- Topic / Cluster Pages
- Stage Pages
- Step Pages
- Process Index Pages
- Comparison Pages
- Summary / Synthesis Pages

### 4.4 wiki 维护文件
- `index.md`
- `log.md`
- `process_sop_index.md`
- `lint_report.md`
- retrieval metadata

### 4.5 核心原则
**从“全文摘要”升级为“对象级编译”。**

优先抽：
- concept
- rule
- case
- signal
- boundary
- artifact
- decision
- metric

---

### Layer 5. Process Spine（主干链路SOP）
`主干链路SOP` 不只是一个普通文档，而是系统的 **主干导航骨架**。

---

## 4. Process Spine 设计

### 4.1 定位
主干链路SOP = `ProcessFlow` 类型 canonical asset

### 4.2 作用
#### A. 导航骨架
明确电商经营主干链路：

- 洞察分析
- 立项与竞品
- 产品开发
- 产品营销能力塑造
- 上架与孵化
- 打爆与放大
- 复盘沉淀

#### B. 挂载骨架
任何新 source 进入后，都优先回答：
- 属于哪个 stage
- 属于哪个 step
- 支撑哪个 artifact / decision / metric

#### C. 召回骨架
后续检索不再全库盲搜，而是：
- query
- classify relevant stage / step
- retrieve linked assets
- optional raw drill-down

#### D. 本体投影骨架
Process Spine 会投影到 ontology：
- stage
- step
- decision
- artifact
- metric
- dependency

---

## 5. Process-Aware Compile Strategy

### 5.1 旧策略
```text
source -> summarize -> write wiki page
````

### 5.2 新策略

```text
source
-> normalize
-> classify domain / scene
-> map to SOP stage / step
-> attach to process graph
-> update canonical graph
-> regenerate affected wiki pages
-> update retrieval metadata
-> update ontology projection
```

### 5.3 新文档处理流程

#### Step 1. Process Node Mapping

判断新 source 属于：

* 哪个 stage
* 哪个 step
* 哪些 artifact / decision / metric

#### Step 2. Attachment Generation

生成挂载记录：

* source_id
* asset_id
* matched_stage
* matched_step
* confidence
* evidence_spans
* attachment_type

#### Step 3. Canonical Graph Update

先更新 canonical graph：

* node assets
* node evidence
* linked rules
* linked cases

#### Step 4. Affected Page Regeneration

只更新受影响页面，例如：

* 主干链路总页
* 对应 stage 页
* 对应 step 页
* process index 页

#### Step 5. Retrieval Metadata Update

更新：

* tags
* aliases
* linked_sources
* linked_rules
* linked_cases
* retrieval keywords

#### Step 6. Ontology Projection Update

同步生成：

* stage 节点
* step 节点
* decision 节点
* artifact 节点
* metric 节点
* dependency edges

---

## 6. Wiki 页面结构建议

### 6.1 总览页

`wiki/主干链路SOP.md`

#### 推荐区块

* 全局目标
* Stage 总览
* 各阶段输入输出
* 关键决策点总览
* 关键资产总览
* 相关案例
* 最近更新

---

### 6.2 Stage 页

例如：

* `wiki/stages/洞察分析.md`
* `wiki/stages/立项与竞品.md`

#### 推荐区块

* 阶段目标
* 进入条件
* 输出物
* 关键步骤
* 决策点
* 常见风险
* 关联文档
* 关联案例
* 关联规则
* 关联指标

---

### 6.3 Step 页

例如：

* `wiki/steps/竞品拆解.md`
* `wiki/steps/立项评估.md`

#### 推荐区块

* 所属阶段
* 步骤目标
* 输入
* 输出
* 方法
* 判断标准
* 相关 artifact
* 相关案例
* 常见例外
* 已知冲突

---

### 6.4 Process Index 页

`wiki/index/process_sop_index.md`

#### 作用

* stage → step 导航
* step → 规则 / 案例 / source 导航
* 展示哪些 step 缺证据
* 展示哪些 step 最近有更新

---

## 7. 检索策略

### 7.1 旧检索

```text
query -> semantic search over all wiki pages
```

### 7.2 新检索

```text
query
-> classify relevant stage / step
-> retrieve stage page / step page
-> retrieve linked rules / cases / sources
-> optional raw evidence drill-down
```

### 7.3 多表示协同召回

不同任务读不同表示：

#### 导航

* xmind
* overview page

#### 挂载

* graph_json
* meta_yaml

#### 问答

* stage / step pages
* linked rules / cases
* evidence blocks

#### 本体投影

* graph_json
* claim bank
* node / edge registry

#### 人类阅读

* markdown wiki pages

---

## 8. Ontology Brain（核心电商决策本体）

这是“资产沉淀层”。

### 8.1 目标

把 wiki / graph / expert feedback 编译成正式的领域对象、状态对象与决策对象。

---

### 8.2 核心电商决策本体建议

#### A. 概念本体

围绕：

* 人
* 货
* 场
* 图
* 卖点
* 人群
* 平台
* 指标

典型对象：

* 主图
* 背景选择
* 构图方式
* 卖点表达
* 人群
* CTR
* 平台
* 类目

---

#### B. 决策本体

围绕电商经营主干链路：

* stage
* step
* decision
* rule
* boundary
* exception

---

#### C. 证据本体

用于知识与证据的显式分离：

* claim
* evidence
* provenance
* confidence
* source span

---

#### D. 执行本体

用于后续 skill 与 Agent：

* artifact
* metric
* action
* validation window
* output contract

---

### 8.3 本体层产物

* StrategySpec
* DecisionCard
* CaseCard
* EvidencePack
* SkillContract 候选

---

## 9. Expert Brain Studio：行业专家 × Agent 交互

前台不是普通聊天，而是围绕主干链路与 wiki / ontology 持续生产工业级 skills 的协作界面。

---

### 9.1 行业专家的职责

行业专家负责：

* 提供原始规则 / SOP / 脑图
* 提供访谈回答
* 提供案例 / 反例
* 提供边界 / 例外 / 失败教训
* 审核关键知识资产

---

### 9.2 五个核心 Agent

#### A1. 交互式问答 Agent

作用：

* 递进式榨取 tacit knowledge

围绕六类问题：

* 定义
* 判断
* 条件
* 反例
* 例外
* 证据

输出：

* candidate concepts
* candidate heuristics
* candidate boundaries
* pending questions

---

#### A2. 共编 Copilot Agent

作用：

* 把候选知识整理成 pages / nodes / edges / draft cards

输出：

* Brain Pages
* Knowledge Nodes
* Draft Cards
* Graph updates

---

#### A3. 标注 Agent

作用：

* 把知识从“可看”变成“可训练 / 可评测 / 可投影”

标注内容：

* 对象
* 关系
* 决策
* 证据
* 质量
* 范围

输出：

* Labeled Assets
* Review Tasks

---

#### A4. 冲突裁决 Agent Council

作用：

* 多专家 / 多规则 / 多范围冲突的治理

处理：

* 定义冲突
* 规则冲突
* 范围冲突
* 少数意见保留

输出：

* Consensus
* Minority Opinion
* Escalation Tasks

---

#### A5. Skill Creator + 自进化 Agent

作用：

* 把通过治理的知识编译成工业级 skills
* 基于反馈持续优化

输出：

* Published Skills
* Improvement Tasks

---

## 10. Governance Center（横向治理中枢）

所有 Agent 都受一个治理中枢约束。

### 核心职责

* 术语治理
* 版本管理
* 审核发布
* 证据追踪
* 评测回流
* 审计记录
* source-to-claim 可追溯

### 没有治理时

系统只是：

* AI 知识库
* AI 文档系统

### 有治理时

系统才是：

* 企业可放行的知识生产系统
* 可持续演进的生产资料系统

---

## 11. Industrial Skill Factory

最终要沉淀的不是一堆页面，而是工业级 skills。

### 11.1 一个工业级 skill 的定义

不只是 prompt，而应包含：

* 知识依赖
* 输入 schema
* 输出 schema
* 推理模板
* 校验策略
* 版本
* 回归评测

### 11.2 典型产物

* `SkillSpec`
* `PromptPack`
* `ReasoningTemplate`
* `ValidationPolicy`
* `EvalCases`

### 11.3 核心意义

**同一份知识资产可以被编译成多个场景 skill，而不是困在 wiki 页里。**

---

## 12. Agent Runtime / Consumer

最终下游消费的是场景 Agent 与业务工作台。

### 典型场景 Agent

* 商品诊断 Agent
* 内容策划 Agent
* 广告优化 Agent
* 研究 / 洞察 Agent

### 消费方式

```text
任务输入
-> 定位相关 stage / step
-> 调用相关 skill
-> 输出建议 + 证据 + 风险
```

---

## 13. Feedback Flywheel（回流与自进化）

这套系统的闭环来自回流。

### 反馈来源

* 专家纠错 / 共编修订
* Agent 输出评分
* 采纳率
* 失败案例
* Eval 失分项
* 冲突裁决结果
* 新文档增量

### 回流去向

* schema
* wiki pages
* ontology objects
* skills
* 主干链路证据块

---

## 14. 三类沉淀的边界

### 14.1 知识沉淀 = Wiki

形态：

* markdown pages
* overview
* summary
* comparisons
* process pages

作用：

* 可读
* 可查
* 可共编
* 可引用

---

### 14.2 资产沉淀 = Ontology

形态：

* concept
* rule
* decision
* stage
* step
* claim
* evidence
* artifact

作用：

* 可治理
* 可编译
* 可评测
* 可被程序消费

---

### 14.3 执行沉淀 = Skills

形态：

* SkillSpec
* PromptPack
* ValidationPolicy
* EvalCases

作用：

* 可调用
* 可版本化
* 可回归测试
* 可运行

---

## 15. 推荐工程目录结构

```text
project/
├── raw_new/
│   ├── industry_docs/
│   ├── conversations/
│   ├── attachments/
│   ├── data/
│   ├── notes/
│   ├── links/
│   └── .brain/
│       ├── source_records.jsonl
│       ├── compiler_routes.yaml
│       ├── dir_schema_registry.json
│       └── domain_profiles/
├── normalized/
│   ├── *.md
│   ├── *.graph.json
│   ├── *.meta.yaml
│   └── registries/
│       ├── node_registry.json
│       ├── edge_registry.json
│       └── claim_bank.jsonl
├── wiki/
│   ├── index.md
│   ├── log.md
│   ├── 主干链路SOP.md
│   ├── stages/
│   ├── steps/
│   ├── concepts/
│   ├── rules/
│   ├── cases/
│   └── index/
├── ontology/
│   ├── concepts/
│   ├── decisions/
│   ├── evidence/
│   ├── process/
│   └── contracts/
├── skills/
│   ├── specs/
│   ├── prompt_packs/
│   ├── validation/
│   └── eval_cases/
└── apps/
    ├── expert_brain_studio/
    ├── ontology_workbench/
    └── agent_runtime/
```

---

## 16. 总体工程流程（伪流程）

```text
1. 新 raw source 进入系统
2. 读取目录级 schema
3. 读取文件级 descriptor
4. 加载 domain profiles
5. 选择 compiler route
6. 执行 normalize / graphify / structure compile
7. 尝试映射到主干链路 stage / step
8. 更新 process spine canonical graph
9. 更新 wiki pages / process index / retrieval metadata
10. 投影到 ontology objects
11. 进入 Expert Brain Studio 的共编 / 标注 / 裁决流程
12. 编译为 skill candidates
13. 经过治理与评测后发布为 industrial skills
14. 下游 Agent 消费
15. 用户反馈 / 评测结果回流，触发下一轮更新
```

---

## 17. 一句话总结

**行业专家负责“把真实经验带进来”，Expert Brain Studio 负责“把知识采进来并整理好”，Ontology Brain 负责“把知识编译成决策资产”，Skill Factory 负责“把资产工业化为可执行能力”。**

---

## 18. 作为 AI-coding 的直接指令标的

如果把这份文档交给 AI-coding，建议它先完成以下顺序：

### Phase 1

* 建立 `raw_new` 目录级 schema 读取机制
* 建立 `source_records.jsonl` 扩展字段解析
* 建立 domain profiles 加载机制
* 建立 compiler routes 路由机制

### Phase 2

* 实现 normalize pipelines
* 接入 graphify / graph_json 中间层
* 生成 node / edge / claim registries

### Phase 3

* 实现 wiki compile
* 生成 concept / rule / case / stage / step pages
* 维护 index.md / log.md / process index

### Phase 4

* 实现 `主干链路SOP` 作为 process spine
* 支持 source → stage/step 挂载
* 更新 canonical graph 与 stage/step 页

### Phase 5

* 实现 ontology projection
* 输出 concept / decision / evidence / process / contract objects

### Phase 6

* 实现 Expert Brain Studio 前台
* 实现五个 Agent 的协作链路
* 实现 Governance Center

### Phase 7

* 实现 industrial skill factory
* skill spec / validation / eval / versioning
* 下游 Agent runtime 接入
