

# 《Expert Brain Studio：产品方案 + 系统方案 + 分模块评估体系》

## 一、产品定位

### 1. 产品定义

**Expert Brain Studio** 的定位不是通用知识库，也不是通用聊天助手，而是：

**行业专家知识萃取前端 / 专家脑工作台**

它的核心目标是把行业专家的隐性知识，经过递进式提问、共编、标注、冲突裁决与 skill 化，沉淀为：

* 可理解的知识页
* 可治理的知识节点
* 可编译的本体资产
* 可调用的 Skill
* 可持续优化的 Agent 能力

### 2. 一句话价值

**把专家知识从“访谈纪要”升级为“可交互采集、可多人共编、可冲突收敛、可 Skill 化发布”的生产资料系统。**

### 3. 产品边界

这个产品先不承担：

* 最终业务执行
* 完整本体大脑全部能力
* 通用企业知识管理
* 多模态复杂自动化生产

它只聚焦一件事：

**把专家知识高质量地“采进来、整理好、裁决清、发布出去”。**

---

## 二、产品总框架

我建议把产品定义为 **五个 Agent + 一个治理中枢** 的组合系统。

### 五个核心 Agent

1. **交互式问答 Agent**
2. **共编 Copilot Agent**
3. **标注 Agent**
4. **冲突裁决 Agent Council**
5. **Skill Creator + 自进化 Agent**

### 一个治理中枢

6. **Governance Center**
   用于版本、审核、证据、评测、发布、回流。

---

# 三、产品方案

---

## 模块 1：交互式问答 Agent

### 1. 模块定位

这是专家知识萃取的第一入口。
目标不是“回答专家问题”，而是**把专家脑里的 tacit knowledge 榨出来**。

### 2. 核心价值

把原来低效的：

* 访谈
* 问卷
* 微信来回追问
* 会议纪要

升级成：

* 递进式追问
* 反例挖掘
* 例外情况补充
* 条件边界显式化
* 案例化表达

### 3. 核心能力

交互式问答 Agent 的问题生成不应是随便追问，而应围绕五类目标：

#### A. 定义类

* 这个概念你怎么定义？
* 和相近概念差别是什么？
* 典型边界在哪里？

#### B. 条件类

* 在什么条件下这个判断成立？
* 哪些前提缺失时不能这么做？

#### C. 反例类

* 有没有看起来像，但其实不适用的情况？
* 你踩过的典型坑是什么？

#### D. 决策类

* 你是如何做取舍的？
* 哪几个变量最关键？

#### E. 证据类

* 你这样判断时会看哪些信号？
* 什么数据能支持或推翻你的结论？

### 4. 输出产物

不是一段聊天记录，而是：

* Interview Session
* Candidate Concepts
* Candidate Heuristics
* Candidate Cases
* Clarification Tasks
* Unresolved Questions

### 5. 页面形态

* 左侧：对话流
* 右侧：实时抽取出的候选知识节点
* 底部：待追问问题池
* 顶部：当前主题 / 当前对象 / 当前轮次状态

---

## 模块 2：共编 Copilot Agent

### 1. 模块定位

这是从“原始表达”到“可阅读知识页 / 节点”的整理层。

### 2. 核心价值

让专家和内部团队一起，把 AI 抽取出的内容整理成：

* wiki 页
* 结构化节点
* 关系图
* 可阅读 / 可校正的知识资产

### 3. 为什么要单独做这个模块

因为交互式问答得到的是“粗粒度原始知识”，而不是正式资产。
共编模块负责把它变成：

* 更清楚
* 更标准
* 更可编辑
* 更可校验

### 4. 核心能力

#### A. Wiki Copilot

自动生成和维护：

* 概念页
* 案例页
* 对象页
* 规则页
* 决策页

#### B. Graph Copilot

自动识别与展示：

* 对象关系
* 因果关系
* 适用条件关系
* 冲突关系
* 上下位关系

#### C. Edit Copilot

支持交互式改写：

* 合并节点
* 拆分节点
* 修改定义
* 调整证据
* 补充边界条件

### 5. 输出产物

* Brain Pages
* Knowledge Nodes
* Knowledge Edges
* Draft Decision Cards
* Draft Case Cards

### 6. 页面形态

* 中间：wiki / node 编辑区
* 右侧：copilot 建议区
* 左侧：知识树 / 图谱导航
* 下方：变更记录 / diff

---

## 模块 3：标注 Agent

### 1. 模块定位

这是把知识从“可看”推进到“可用”的关键模块。

### 2. 核心价值

没有标注，知识只是文档。
有了标注，知识才会变成：

* 训练数据
* 评测样本
* 高质量本体候选
* Skill 生成素材

### 3. 标注对象

标注 Agent 不是只做 NLP 标签，而是做“专家知识工程标注”。

重点标注五类信息：

#### A. 对象标注

* 概念
* 实体
* 指标
* 场景
* 角色
* 工具

#### B. 关系标注

* 因果
* 条件
* 依赖
* 冲突
* 上下位
* 证据支持

#### C. 决策标注

* 决策点
* 分支条件
* 判断依据
* 风险点
* 动作建议

#### D. 质量标注

* 是否清晰
* 是否专业
* 是否一致
* 是否可执行
* 是否证据充分

#### E. 治理标注

* owner
* 适用范围
* 置信度
* 发布时间
* 版本状态

### 4. 协同方式

这里建议采取 **人机协同标注**：

* Agent 先打初标
* 专家 / 产品 / 内部运营复核
* 低置信度内容进入二次标注池

### 5. 输出产物

* Labeled Nodes
* Labeled Edges
* Labeled Cases
* Quality Labels
* Review Tasks

### 6. 页面形态

* 左侧原文 / 原脑页
* 中间候选标签
* 右侧审核与修正
* 顶部过滤器：低置信度 / 高冲突 / 待复核

---

## 模块 4：冲突裁决 Agent Council

### 1. 模块定位

这是多专家协作时最关键的差异化模块。

### 2. 核心价值

现实里，专家知识一定会冲突。
真正有价值的不是消灭冲突，而是形成：

* 冲突显式化
* 条件化解释
* 适用范围划分
* 版本化共识

### 3. 为什么不是简单投票

专家知识的冲突，不是“谁票多谁对”，而是：

* 谁更适用于当前类目
* 谁适用于不同阶段
* 谁是老经验，谁是新经验
* 谁是原则，谁是例外

所以需要“咨询委员会式”的讨论机制。

### 4. 核心机制

#### A. 冲突检测

自动发现：

* 定义冲突
* 规则冲突
* 案例解释冲突
* 同义异义冲突
* 范围冲突

#### B. 多 Agent 讨论

可以模拟多个专家视角：

* Expert A Agent
* Expert B Agent
* Moderator Agent
* Evidence Agent
* Decision Secretary Agent

#### C. 共识输出

输出不是“唯一真理”，而是：

* 共识结论
* 分歧点
* 适用边界
* 建议保留版本
* 待进一步验证问题

### 5. 输出产物

* Conflict Report
* Consensus Draft
* Minority Opinion
* Scope Split Suggestion
* Escalation Task

### 6. 页面形态

* 左侧：冲突内容对比
* 中间：多方观点讨论流
* 右侧：共识结果 / 分歧结果
* 底部：保留、拆分、驳回、升级决策按钮

---

## 模块 5：Skill Creator + 自进化 Agent

### 1. 模块定位

这是把知识真正交付给后续 Agent 使用的出口。

### 2. 核心价值

前面四个模块解决的是“知识怎么形成”。
这个模块解决的是“知识怎么被用起来”。

### 3. Skill Creator 的作用

把已审核、已治理的知识资产编译成：

* Prompt templates
* Decision templates
* Tool invocation patterns
* Structured reasoning templates
* Validation checklists
* Scenario skills

### 4. 自进化能力

这个模块不只是发布 skill，还负责持续优化 skill。

优化来源包括：

* 专家纠错
* 标注反馈
* 冲突裁决结果
* Agent 使用日志
* Eval 失分项
* 客户实际采纳结果

### 5. 输出产物

* SkillSpec
* PromptPack
* ReasoningTemplate
* ValidationPolicy
* SkillVersion
* Skill Improvement Tasks

### 6. 页面形态

* Skill 列表
* Skill 详情
* 版本对比
* 依赖知识卡
* 适用场景
* 质量得分
* 最近回归表现

---

## 模块 6：Governance Center

### 1. 模块定位

这是系统可信化和商业化的中枢。

### 2. 核心职责

* 版本管理
* 状态流转
* 审核发布
* 术语治理
* 证据追踪
* 审计记录
* 评测看板
* 回流管理

### 3. 必须具备的状态

对任何知识卡 / 节点 / skill，至少要有：

* Draft
* Candidate
* Under Review
* Conflict Pending
* Approved
* Published
* Deprecated
* Archived

---

# 四、系统方案

---

## 1. 总体系统分层

我建议系统分成六层。

### 第一层：交互层

面向用户的前端：

* 问答台
* 共编台
* 标注台
* 冲突裁决台
* Skill 工作台
* 管理后台

### 第二层：Agent Orchestration 层

负责多个 Agent 的编排：

* Session Router
* Task Planner
* Agent State Manager
* HITL Controller
* Workflow Engine

### 第三层：Knowledge Production 层

负责生成知识资产：

* Interview Extractor
* Wiki Compiler
* Annotation Engine
* Conflict Resolver
* Skill Compiler

### 第四层：Governance 层

负责治理：

* Semantic Dictionary
* Version Control
* Approval Workflow
* Provenance Store
* Eval & Audit

### 第五层：Ontology Translation 层

负责转译到正式资产：

* Concept Mapper
* Entity Mapper
* Decision Mapper
* Case Mapper
* Skill Contract Mapper

### 第六层：Storage 层

负责数据存储：

* Brain Page Store
* Graph Store
* Relational DB
* Embedding / Search Index
* Artifact Store
* Eval Store

---

## 2. 核心对象模型

### Session 类

* session_id
* expert_id
* topic
* round_index
* current_goal
* unresolved_questions

### BrainPage 类

* page_id
* page_type
* title
* summary
* compiled_truth
* timeline
* source_refs
* linked_nodes

### KnowledgeNode 类

* node_id
* node_type
* label
* definition
* aliases
* scope
* confidence
* provenance

### KnowledgeEdge 类

* edge_id
* source_node_id
* target_node_id
* relation_type
* evidence_refs
* confidence

### Card 类

* card_id
* card_type
* title
* content_structured
* evidence_pack
* owner
* review_status

### ConflictCase 类

* conflict_id
* related_nodes
* conflict_type
* positions
* evidence_pack
* consensus_result
* escalation_status

### SkillSpec 类

* skill_id
* name
* scenario
* input_schema
* output_schema
* reasoning_template
* validation_policy
* version

---

## 3. 五个 Agent 的协同链路

建议按下面链路协作：

### Step 1：交互式问答 Agent

输入专家内容
输出 Candidate Knowledge

### Step 2：共编 Copilot Agent

把 Candidate Knowledge 整理成 Brain Pages 与 Nodes

### Step 3：标注 Agent

对 Nodes / Cases / Rules 做结构化标签

### Step 4：冲突裁决 Agent Council

解决高冲突、高不一致、高影响内容

### Step 5：Skill Creator

把通过治理的知识转成 SkillSpec

### Step 6：Governance / Eval

对所有输出做质量放行与回流

---

## 4. 推荐的数据流

### 输入流

专家输入 / 文档上传 / 案例回放
→ Session
→ Candidate Extraction

### 整理流

Candidate Extraction
→ Brain Pages
→ Knowledge Nodes / Edges

### 治理流

Nodes / Cards
→ Annotation
→ Conflict Review
→ Approval

### 发布流

Approved Assets
→ Ontology Mapping
→ Skill Compiler
→ Published Skills

### 回流流

Usage Logs / Expert Feedback / Eval Results
→ Improvement Tasks
→ Re-annotation / Re-compile / Re-skill

---

# 五、分模块评估体系

重点来了。
这个系统不能只看“用户觉得好不好用”，必须按模块评估。

---

## 模块 1：交互式问答 Agent 评估

### 目标

判断它是否真的能高质量萃取专家知识。

### 指标

* 问题递进合理率
* 关键变量覆盖率
* 反例触发率
* 例外情况补充率
* 无效追问率
* 专家回答深度提升率
* 单次 session 有效知识产出数

### 质量判断

好的问答 Agent，不是问得多，而是：

* 问得深
* 问得准
* 能逼近边界
* 能挖出 tacit knowledge

---

## 模块 2：共编 Copilot Agent 评估

### 目标

判断是否真的把粗糙输入整理成高质量知识页与节点。

### 指标

* 自动生成页可接受率
* 专家编辑量占比
* 节点拆分 / 合并合理率
* 关系抽取准确率
* wiki 可读性评分
* 知识页结构完整率

### 质量判断

好的共编，不是写得像文章，而是：

* 可读
* 可改
* 可连
* 可追溯

---

## 模块 3：标注 Agent 评估

### 目标

判断知识是否真的被转成结构化可用资产。

### 指标

* 初标准确率
* 复标一致率
* 低置信度命中率
* 关键字段完整率
* 决策标签准确率
* evidence 绑定率
* 标注吞吐效率

### 质量判断

好的标注，不是标签多，而是：

* 关键结构清楚
* 对后续训练 / 评测 / skill 真有用

---

## 模块 4：冲突裁决 Agent Council 评估

### 目标

判断系统是否能把冲突转成可治理共识。

### 指标

* 冲突发现率
* 真冲突命中率
* 共识可接受率
* 分歧显式化率
* 适用范围拆分合理率
* 升级人工仲裁占比
* 冲突关闭时长

### 质量判断

好的裁决，不是强行统一，而是：

* 把冲突解释清楚
* 把边界划清楚
* 把决策记录下来

---

## 模块 5：Skill Creator + 自进化 评估

### 目标

判断知识资产是否真的被成功转成 Agent 可用技能。

### 指标

* Skill 编译成功率
* Skill 被调用率
* Skill 输出质量评分
* Skill 回归通过率
* Skill 演进增益
* Skill 版本稳定性
* 低质量 Skill 淘汰率

### 质量判断

好的 Skill Creator，不是多，而是：

* 可用
* 稳定
* 有增益
* 能演进

---

## 模块 6：治理中枢评估

### 目标

判断整套系统是否可商业化、可复制。

### 指标

* 审核通过率
* 审核时长
* 版本回滚率
* 术语冲突率
* 发布后废弃率
* 证据覆盖率
* 审计可追踪率

### 质量判断

好的治理，不是流程多，而是：

* 可信
* 可回溯
* 可发布
* 可复制

---

# 六、产品成功的核心判断标准

我建议你最终用三层指标来看这套产品是否成立。

## 第一层：采集效率

* 专家是否愿意用
* 是否比访谈 / 问卷更高效
* 是否能持续输入

## 第二层：资产质量

* 是否形成高质量节点 / 卡片 / skill
* 是否可审核、可治理、可复用

## 第三层：消费价值

* 后续 Agent 是否因为这些资产变得更强
* 建议是否更专业、更稳定、更可解释

---

# 七、MVP 实施建议

如果你要快速做 MVP，我建议不要五个 Agent 全部同时拉满。
建议按顺序：

## Phase 1

先做：

1. 交互式问答 Agent
2. 共编 Copilot Agent
3. 最小治理流

因为这是“采进来”的闭环。

## Phase 2

再做：
4. 标注 Agent
5. 最小 Skill Creator

因为这是“整理成资产并输出”的闭环。

## Phase 3

最后做：
6. 冲突裁决 Agent Council
7. 自进化

因为这是“规模化和复利”的闭环。

---

# 八、一句话架构总结

**Expert Brain Studio 的本质，不是一个知识库，而是一条“专家知识生产线”：交互式榨取 → 共编整理 → 标注结构化 → 冲突收敛 → Skill 编译 → 治理发布 → 回流进化。**

---
