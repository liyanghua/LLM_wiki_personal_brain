# Step1 初步执行计划

## 摘要
- 以 [docs/Step1.md](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/docs/Step1.md)、[docs/architecture.md](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/docs/architecture.md) 和 [AGENTS.md](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/AGENTS.md) 为准，在当前根目录直接落地 Personal Brain Batch 1；不新建嵌套 `personal-brain/`，保留现有 `raw/`。
- 当前仓库已有 35 个 raw 文件，20 个 `.md`、13 个 `.docx`，其中 13 组是同题材 `md/docx` 双格式文件；首轮按“5 个逻辑来源试点 + 逻辑去重 + Hermes 只做参考”推进。
- 目标是先跑通四层边界最小闭环：`ingest -> build-wiki -> ask -> lint -> writeback proposal`，同时补齐 `wiki/`、`ontology/`、`memory/`、`apps/`、`src/`、`tests/`、`skills/` 骨架。

## Public Interfaces
- CLI 定为：`python -m apps.cli.main ingest <path> [--bucket ...]`、`build-wiki`、`ask "<question>"`、`lint`、`writeback <query_id> [--apply]`。
- `ingest` 同时支持“外部路径复制进 `raw/`”和“对已在 `raw/` 中的目录/文件做原地登记”；默认优先沿用现有 bucket，外部路径未指定时默认 `industry_docs`。
- 核心类型至少实现 `SourceRecord`、`WikiPage`、`OntologyObject`、`PersonalStyleProfile`、`AnswerRecord`；其中 `SourceRecord` 增加逻辑去重字段，`AnswerRecord` 落在 `memory/session`。
- Wiki 页统一为“YAML frontmatter + human-readable 正文”模板，强制包含 `page_id`、`page_type`、`title`、`summary`、`source_refs`、`links_to`、`updated_at`；`wiki/index.md` 按 page type 汇总，`wiki/log.md` 用 append-only 时间戳标题格式。

## 执行计划
- 搭工程骨架：在根目录补齐 `pyproject.toml`、`.env.example`、`.gitignore`、`apps/cli`、`apps/api`、`apps/worker`、`src/personal_brain/*`、`tests/*`、`wiki/*`、`ontology/*`、`memory/*`、`skills/*`。`apps/api/server.py` 只做最小 `/health` 与可选 `/ask` 薄封装，`apps/worker/jobs.py` 先做同步任务壳。
- 做 ingestion 子系统：实现文件扫描、bucket 识别、checksum、mtime/title 提取、文本解析、错误记录；原文不改写，元数据以 append-only 隐藏清单保存在 `raw/` 内，人类可读 provenance 进入 `wiki/sources/`。解析策略定为：`.md/.txt` 直接读，`.docx` 用 Python 解析，`.doc` 在 macOS 上优先走 `textutil`，失败时写错误记录而不是静默跳过。
- 做逻辑去重：物理文件全部保留，但编译层按“规范化标题/同目录同 stem/内容相似度”聚成 logical source；同题材双格式优先用文本更稳定的 `.md`，其余变体挂到同一个 logical source 下，避免重复生成 wiki 页。
- 做 wiki 编译：先生成 `wiki/sources/` 页面，再从 pilot 逻辑来源归纳 `topics/entities/projects/principles` 页面，维护 backlinks、`wiki/index.md` 和 `wiki/log.md`；如果页面已存在则增量更新而不是新建近重复页。
- 做 query/answer：`ask` 必须先读 `wiki/index.md`，再按标题命中、关键词覆盖、`source_refs`、backlinks 做简单排序；答案输出为 `fact / summary / interpretation / recommendation` 四段，并把正文存到 `memory/session/answers/<query_id>.md`，同时写 `AnswerRecord`。
- 做 writeback 与 lint：`lint` 检查 orphan、stale、missing source refs、duplicate/similar pages、missing cross-links、index coverage；`writeback` 默认只在 `memory/session/writeback/` 生成 proposal，`--apply` 只允许新建 `decisions/principles` 页面或向 topic 页面追加明确标记的 proposed update，默认不覆盖既有 wiki 主内容。
- 预留 Hermes：在 `src/personal_brain/agent/` 放 `hermes_adapter.py`、`planner.py`、`responder.py`、`memory_writer.py`、`style_engine.py` 的最小壳层，并用 `TODO(HERMES_PHASE_2)` 标出后续接点；`hermes-agent-main/` 保持只读参考，不作为 Batch 1 运行时依赖。

## 首轮试点与测试
- 试点语料固定为 5 个逻辑来源：`电商运营本体核心文档`、`淘天商品全生命周期智能运营AI体`、`货品全生命周期管理-SUPER指标模型`、`桌垫类目-儿童学习桌垫单因子测图示例`、`背景选择_访谈日志(.md/.docx 逻辑去重样例)`。
- 预期首轮产物至少包括：5 个 `wiki/sources` 页面、1 个电商运营主题页、1 个单因子测图/项目页、1 个方法论/原则页、可工作的 `index.md` 与 `log.md`、README 中的 end-to-end demo。
- 单元测试覆盖：解析器、`.doc` 失败记录、checksum/metadata、逻辑去重、wiki page 模板、检索排序、writeback 守门逻辑、lint 规则。
- 集成测试覆盖：`ingest -> build-wiki -> ask -> lint -> writeback` 全链路；验证 `ask` 先读 index、`log.md` 有新增记录、paired `md/docx` 不会产出重复 wiki 页面、writeback 默认不落正式 wiki。
- Golden fixtures 使用当前试点语料裁切版，命令验收以 `python -m apps.cli.main ingest raw/industry_docs raw/conversations`、`build-wiki`、`ask "什么是品牌经营OS？"`、`lint` 为主。

## 假设与默认
- 当前根目录还不是 git repo，计划不会依赖 git 流程，但会补 `.gitignore` 供后续初始化使用。
- 首版采用“可选 LLM + 可运行 fallback”设计：服务层先做 provider 抽象；无模型配置时仍能基于标题/摘要模板跑通 pipeline，有模型时再增强摘要与页面编译质量。
- `ontology/`、`memory/persistent`、`skills/*` 在 Batch 1 只落骨架和最小 schema/占位文档，不提前做复杂记忆或自进化。
