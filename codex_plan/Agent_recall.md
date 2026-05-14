# Agent 回答可观测性与推理链路可视化升级计划（诊断优先）

## Summary
- 目标不是先“把能力都补齐”，而是先把 Agent 回答为什么对、为什么错、错在链路哪一层可视化出来，优先服务你现在这类问题：问 `6大维度首先看哪个维度` 时，能一眼看出是 `wiki 太薄`、`raw 没补上`、`关联上下文没扩展`，还是 `状态判断/动作选择` 出了问题。
- 交互形态保持当前 `/workspace/ask` 单窗口 Agent 主线程不变，在右侧新增一个固定的 `Agent Trace / LLM-log` 诊断栏。
- 本期只做诊断优先：
  - 暴露现有检索、扩展、状态判断、模板/skill 复用链路
  - 明确标出 `pass / partial / fail / inactive`
  - 不把隐藏 CoT 暴露给前端，只展示结构化推理日志和可验证依据

## Key Changes
### 1. 后端新增统一 `agent_trace` 合同
- 给 `/api/ask` 返回体新增 `agent_trace`，并把它接到前端实体层；当前后端已有的 `retrieval_backend / retrieval_mode / retrieval_collection / retrieval_explain` 不再在前端丢失。
- 给 extraction interview 状态新增：
  - `current_trace`
  - `turns[].agent_trace`
- `agent_trace` 固定包含四块：
  - `stage_checks`
  - `retrieval_trace`
  - `decision_trace`
  - `llm_log`
- 新增统一类型：
  - `TraceStageStatus = "pass" | "partial" | "fail" | "inactive"`
  - `TraceStage`：`stage_id / label / status / reason / pass_criteria / evidence_refs / warnings`
  - `TraceLogEntry`：`component / step / input_summary / output_summary / refs / warnings`
  - `AgentTraceBundle`：聚合本轮全部诊断信息
- `LLM-log` 只记录结构化链路，不展示原始隐藏推理：
  - 展示 classifier / search / page rank / evidence select / answer planner / problem compiler / stopping decision 的输入摘要、输出摘要、引用依据、告警
  - 不展示原始 chain-of-thought，不展示完整 prompt 文本

### 2. 四段阶段判断固定为可观测表
- 右侧顶部固定显示这四个判断题，对应你给的验收标准：
  - `wiki_recall`：Agent 是否能从原始 wiki 中获得有用知识
  - `context_expand`：Agent 是否能扩展相关对象与证据链
  - `ontology_decision`：Agent 是否能从“知道”走到“判断/动作选择”
  - `skill_reuse`：Agent 是否能稳定复用经验
- 每一项都显示：
  - 当前状态：`pass / partial / fail / inactive`
  - 通过标准
  - 本轮依据
  - 失败原因
- 当前 repo 的判定口径固定如下：
  - `wiki_recall`
    - `pass`：召回到正确 wiki 页面，且证据片段足以支撑回答
    - `partial`：召回到 wiki，但页面内容太薄，只是 summary / metadata
    - `fail`：没召回相关 wiki，或乱引
  - `context_expand`
    - 使用现有 `links_to`、ranked linked pages、extraction buckets 的 `object_pages/pattern_hits`
    - 当前不是完整图谱时仍可判 `partial/pass`，但 UI 文案明确是“关联上下文扩展”，不是完整 KG
  - `ontology_decision`
    - 以 `ProblemCompiler / QuestionPlan / StopDecision / recommended_action` 为准
    - Quick Answer 若没有显式状态机则标 `inactive` 或 `partial`
  - `skill_reuse`
    - 只有真正命中 runtime skill / method template /可复用 procedure 才能 `pass/partial`
    - 当前仅有离线 skill candidates、无 runtime skill 参与时，明确标 `inactive`

### 3. 为“wiki 太薄但 raw 更丰富”加专门告警
- 增加 `source_gap` / `wiki_thin_source` 诊断规则，专门覆盖你这类源文档问题：
  - 当召回到 `wiki/sources/...` 页面，但页面正文只有 metadata + summary，而对应 `raw/...` 存在更丰富标题/表格/层级内容时
  - `wiki_recall` 自动降为 `partial`
  - `llm_log` 增加 warning：`wiki source page is too thin for direct answering`
  - `retrieval_trace` 显示对应 raw 来源和命中的结构化片段
- `6大维度·42个细分变量选择逻辑01` 作为首个黄金案例：
  - 右栏必须能看见：wiki 命中页、raw 原文命中、`维度1：视觉核心层（决定第一眼停留）` 证据片段、以及为何当前回答没正确落到这一层

### 4. Ask Workspace 右侧新增 `Agent Trace` 诊断栏
- 保持当前单窗口 Agent 主线程不变，只恢复一个窄右栏给诊断信息。
- 右栏固定四个分区：
  - `阶段判断`
  - `检索链路`
  - `决策链路`
  - `LLM-log`
- `检索链路` 展示：
  - backend / mode / collection
  - top hits
  - retrieval explain
  - wiki hits / raw hits / thin wiki warnings
- `决策链路` 展示：
  - question_type
  - current_object / knowledge_goal
  - recommended_action
  - target_missing_slots
  - stop_reason
- `LLM-log` 展示最新 6-10 条结构化日志，按时间或步骤排序。
- Quick Answer 和 Extraction Interview 都接同一套右栏；Extraction 额外支持按 turn 切换查看历史 trace。

### 5. 补一组可执行的诊断验收样例
- 新增一组 `Agent Observability` 黄金问题，不先评“答得像不像”，先评“链路是否可解释”：
  - `6大维度首先看哪个维度`
  - `品牌经营OS和SUPER指标之间是什么关系`
  - `桌垫测图项目下一步该盯哪些变量`
- 每个 case 至少校验：
  - 是否召回正确 wiki
  - 是否能指出 raw 补证据是否发生
  - 是否能展示当前上下文扩展结果
  - 是否能显示状态判断/动作选择
  - 是否诚实标出 skill stage 还未接入 runtime

## Important Interfaces
- `/api/ask` 新增字段：
  - `agent_trace`
- extraction interview 返回体新增字段：
  - `current_trace`
  - `turns[].agent_trace`
- 前端实体新增：
  - `AgentTraceBundle`
  - `TraceStage`
  - `TraceLogEntry`
- 前端不再丢弃这些现有字段：
  - `retrieval_backend`
  - `retrieval_mode`
  - `retrieval_collection`
  - `retrieval_explain`

## Test Plan
- 后端单元测试：
  - `AskResult.agent_trace` 能稳定生成四段阶段判断
  - `wiki_thin_source` 对 `6大维度42个细分变量选择逻辑01` 触发 `partial + warning`
  - extraction 每轮 trace 能随 state 持久化和恢复
- 前端单元/组件测试：
  - Quick Answer 和 Extraction 都能渲染右侧 `Agent Trace`
  - `LLM-log` 能显示结构化日志，不显示空白或 schema 丢字段
  - turn 切换后 trace 跟随更新
- 集成验收：
  - 问 `6大维度首先看哪个维度` 时，右栏能明确显示：
    - wiki 命中页
    - raw 补证据
    - 当前回答为什么没有直接命中“维度1”
  - 图谱/本体/skill 未接通时，状态明确显示 `inactive/partial`，不伪装成已具备能力

## Assumptions
- 本期是 `诊断优先`，不以“把图谱、本体、skill 真正接入回答链路”为交付目标。
- `graph/context_expand` 本期使用现有 `links_to + ranked linked pages + retrieval buckets` 作为可观测代理，不宣称已经有完整知识图谱。
- `skill_reuse` 本期允许大部分场景显示 `inactive`；这是预期行为，不算失败。
- 当前主问题之一是 `wiki/sources` 页过薄；本期会把这种缺口显式暴露，但不把“自动重编 wiki source 页”作为本计划前置条件。
