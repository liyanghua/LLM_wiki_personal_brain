# Expert Brain Studio 路线校准与升级决策

**Summary**
- 现有实现已经不是“从零的聊天页”，而是一个以 `Personal Brain OS` 为底座的知识工作台：有 Ask / Writeback / Assets / Profile / Eval / Wiki 六类页面，有 extraction 多轮状态机、检索增强、trace、writeback、候选资产和评测基础。
- 结合 [docs/prd_all_v1.md](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/docs/prd_all_v1.md) 和 [docs/prd_interaction_QA.md](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/docs/prd_interaction_QA.md)，最优路线不是从 0 重写，而是继续基于当前版本演进，但要把“产品层”和“领域对象层”从“QA/诊断工作台”升级成“专家知识生产线”的表达与合同。
- 核心判断：当前最大缺口不在底层检索、会话状态、可观测性这些基础设施，而在“交互式问答产物”还没有成为 PRD 所要求的 `InterviewSession / CandidateAsset / FollowupQuestion / SessionSummary` 这一套一等公民对象。

**现状梳理**
- 产品现状：仓库与 README 仍以 `Personal Brain OS` 为主定位，前端标题也是“专家知识工作台 / Personal Brain OS · 知识分析与资产管理”；Ask 页虽然已支持 `Quick Answer` 和 `Extraction Interview`，但整体更像“可诊断的问答控制台”，还不是 PRD 中的“交互式问答台”知识榨取产品。
- 前端现状：`brain-workbench` 已有 Ask、Writeback、AssetCandidates、Profile、Eval、WikiExplorer 六类工作台页面；Ask 页已有单窗口 Agent 主线程、右侧 `Agent Trace`、多轮 extraction 恢复、staged writeback 展示，但还没有 PRD 要求的“右侧候选资产实时编辑 + 底部待追问问题池 + 专家确认工作流”。
- 后端现状：`src/personal_brain/api/workbench_service.py` 已暴露 `/api/ask` 与 extraction interview start/get/continue/finish 等接口；`src/personal_brain/extraction/service.py` 已串起 `ProblemCompiler / RetrievalPlanner / QuestionPlanBuilder / StoppingCriteria / WritebackStager / StateTracker`。
- 检索与可观测性现状：已有 wiki-first 检索、qmd 风格 search provider 抽象、raw evidence-only 增强、Agent Trace、retrieval trace、decision trace、LLM-log。这部分已经超出 PRD 的 MVP 基础要求。
- 数据模型现状：当前核心对象是 `ExtractionInterviewState`、`ExtractionTurn`、`QuestionPlan`、`StagedWriteback`，偏“执行态/运行态”；缺少 PRD 中以产物为中心的 `InterviewSession / CandidateAsset / FollowupQuestion / SessionSummary` 明确合同。

**差距分析**
- 相对 `prd_interaction_QA`，已基本具备：F2 递进式问答引擎、部分 F4 待追问能力、部分 F5 收束、部分 F7 输出能力，而且在 trace/检索诊断上比 PRD 更强。
- 相对 `prd_interaction_QA`，关键缺口有四个：
- `F1 Session 创建` 还不完整。当前 start 主要只有 `question`，缺少 `title / topic_type / target_object / goal / created_by` 这类 session 元数据。
- `F3 候选知识实时抽取` 还没成为主对象。现在更多是 answer、slots、writeback preview，不是 PRD 要的 `Concept / Heuristic / Case / Signal / Boundary` 五类候选资产及其 `status/confidence/source_turn_ids`。
- `F4 待追问问题池` 还只是下一问候选，不是带 `reason / priority / status` 的显式问题池，也还没有“高信息增益优先”的稳定调度合同。
- `F6 专家修正与确认` 基本缺位。当前专家可以继续回答，但不能直接对候选资产执行“确认 / 修改 / 删除 / 标记待澄清”。
- 相对 `prd_all_v1` 蓝图，现有系统只覆盖了第一模块的基础骨架，以及少量资产/评测前置能力；共编 Copilot、标注 Agent、冲突裁决 Council、Governance Center、发布/审核状态机都还没有形成产品模块。
- 更本质的差距是：现有系统已经有“知识生产线的基础设施”，但还没有“知识生产线的显式产品流”。也就是能力在，产品对象和流程还没站起来。

**路线选择**
- 选择：继续基于当前版本升级，不建议从 0 开始。
- 原因一：当前版本已经实现了最贵、最难替换的底座，包括多轮状态机、检索层、raw/wiki 分层、traceability、writeback、候选资产和 Hermes 边界。重写会把这些验证过的积累全部打散。
- 原因二：`prd_interaction_QA` 的当前阶段目标，与现有架构方向是相容的。你要补的是“产品对象与工作流”，不是推翻技术路线。
- 原因三：从 AGENTS.md 的层边界看，现仓库的 raw → wiki → ontology/memory → runtime/skills 架构是对的；PRD 蓝图是在这个底座上长出更完整的知识生产工作台，而不是换掉底座。
- 唯一应当“重构”的，不是代码库重写，而是产品层语义重构：把 `ExtractionInterviewState` 从“内部执行态”降为内核状态，把 `InterviewSession + CandidateAsset + FollowupQuestion + SessionSummary` 提升为对前端和后续模块的主合同。

**升级方案**
- 第一阶段：以当前版本为底座，完成 `prd_interaction_QA` 的对象化收口。
- 新增或升级四个公开合同：`InterviewSession`、`CandidateAssetList`、`FollowupQuestionList`、`SessionSummary`。
- 保留现有 `/api/extraction/interviews/*` 作为执行内核接口，但返回体要升级为“执行态 + 产物态”双层结构，或者提供 adapter，把现有 state 映射成 PRD 对象。
- Ask Workspace 升级为真正的交互式问答台：顶部 session 元信息，中间对话线程，右侧候选资产，底部待追问池；`Agent Trace` 保留，但降级为诊断辅栏，而不是主产品心智。
- 在后端 extraction 流中补一个 `Candidate Extractor` 子能力，把每轮回答抽取成 5 类候选资产，并支持专家确认动作回写到 session 状态。
- 将 `QuestionPlan` 升级为 `FollowupQuestion` 池，显式带上 `reason / priority / status / source_asset_ids`，使“为什么问下一问”可见、可管理、可冻结。
- 将 finish 结果从“staged writeback 为主”升级为“双产物出口”：一份 `SessionSummary` 给交互式问答台收束，一份 downstream export bundle 给共编/标注/治理模块消费。
- 第二阶段：沿 `prd_all_v1` 的 Phase 1 继续长出最小闭环，而不是并行新造一套系统。
- 先做最小共编 Copilot：以确认后的 candidate assets 为输入，生成 draft brain pages / draft cards，而不是直接从聊天记录整理。
- 先做最小治理流：给 candidate assets、draft pages、writeback targets 增加 `draft / reviewed / approved / published` 状态，形成最基本的治理闭环。
- 第三阶段：再接标注、Skill Creator、冲突裁决与治理中心。
- 标注 Agent 以后应消费的是“确认后的候选资产”，不是原始聊天。
- 冲突裁决和 Skill Creator 应建立在共享的 session/asset/evidence 合同上，而不是另起一套 pipeline。
- Hermes 继续只做 runtime/orchestrator，不吸收领域规则；Personal Brain backend 继续承载 extraction、candidate、governance 逻辑。

**验证标准**
- 现阶段升级完成后，一次 session 必须能稳定产出：带元数据的 `InterviewSession`、可编辑的 `CandidateAssetList`、可管理的 `FollowupQuestionList`、可确认的 `SessionSummary`。
- 专家在会话中必须能直接看到“系统理解成了什么资产”，并对资产本身进行确认或纠偏，而不是只能继续聊天。
- 后续模块接入时，应该消费这些标准对象，而不是继续直接耦合 `ExtractionInterviewState` 的内部字段。
- `/api/ask`、现有 trace、现有 wiki/raw/ontology/skills 分层不回退，Hermes 契约保持稳定。

**Assumptions**
- `prd_interaction_QA` 是现在 1-2 个迭代内的主目标，`prd_all_v1` 是上位蓝图，不要求当前阶段一次到位。
- 当前 repo 继续作为唯一主线代码库，不新开一套 greenfield 重做。
- 只有当你决定放弃现有 wiki-first、layered、backend-owned extraction 架构时，才值得讨论从 0 开始；按这两份 PRD 的方向看，目前没有这个必要。
