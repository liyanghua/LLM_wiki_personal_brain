你要为我构建一个本地优先（local-first）的 Personal Brain OS 第一阶段版本。

## 一、项目目标

这个系统不是普通的聊天机器人，也不是简单的 RAG Demo，而是一个“个人大脑”系统，核心思想如下：

1. 我会准备一个目录，里面有我的行业知识文档、个人笔记、markdown/doc/docx/txt 等资料
2. 系统需要把这些原始资料 ingest 到 raw 层
3. 然后基于“LLM Wiki”的思路，把知识持续编译成 wiki 页面，而不是只做临时问答
4. 这个 wiki 是人可读、可维护、可链接、可持续演进的知识中间层
5. 后续会接入 Hermes Agent 作为交互层、记忆层、自进化层
6. 第一阶段先不要实现复杂自进化，只要为后续 Hermes 集成预留好模块边界
7. 高价值问答结果可以提议写回 wiki，形成 decisions / principles / topic updates

## 二、第一阶段范围（Batch 1 Scope）

第一阶段只做以下核心能力：

### 1. Source ingestion
支持 ingest 以下文件类型：
- .md
- .txt
- .doc
- .docx

要求：
- 统一读入
- 分类存放到 raw/
- 记录 metadata（source path, source type, ingest time, checksum）
- 保留原始内容，不允许直接覆盖原文语义

### 2. Wiki compilation
从 raw 中提取内容，自动生成和维护 wiki 页面：
- wiki/topics/
- wiki/entities/
- wiki/projects/
- wiki/decisions/
- wiki/principles/
- wiki/sources/

并自动维护：
- wiki/index.md
- wiki/log.md

要求：
- 页面要尽量复用，不要频繁创建重复页
- 每个 wiki 页面尽量带 source_refs
- 生成 human-readable markdown
- 页面之间可以建立 links_to/backlinks
- 不要求做复杂前端，只要文件系统可用

### 3. Wiki query
实现一个最小问答接口：
- 输入用户问题
- 先看 wiki/index.md
- 找到相关 wiki 页面
- 必要时回溯 source_refs
- 输出 grounded answer
- 同时记录一次 AnswerRecord

要求：
- 不要只做向量库检索；优先体现“wiki 作为中间层”的思路
- 允许后续接入 embedding / ranker，但 Batch 1 先以简单可靠为主

### 4. Write-back proposal
对每次问答，系统判断是否值得写回 wiki：
- 如果答案具有长期价值，则提议写回
- 写回目标包括：
  - wiki/decisions/
  - wiki/principles/
  - wiki/topics/ 下的增量更新
- 先实现“proposal”，不必默认自动落盘；可以提供 flag 控制

### 5. Wiki lint
实现一个最小 lint 系统，检查：
- orphan pages
- stale pages
- pages missing source_refs
- duplicate/similar pages
- missing cross-links
- index.md 未覆盖的重要页面

### 6. CLI
实现一个最小 CLI，例如：
- brain ingest <path>
- brain build-wiki
- brain ask "<question>"
- brain lint
- brain writeback <query_id>

## 三、仓库结构要求

请严格按下面结构创建代码骨架：

personal-brain/
├── README.md
├── AGENTS.md
├── pyproject.toml
├── .env.example
├── .gitignore
├── raw/
│   ├── industry_docs/
│   ├── notes/
│   ├── conversations/
│   ├── links/
│   └── attachments/
├── wiki/
│   ├── entities/
│   ├── topics/
│   ├── projects/
│   ├── decisions/
│   ├── principles/
│   ├── timelines/
│   ├── sources/
│   ├── index.md
│   └── log.md
├── ontology/
│   ├── objects/
│   ├── relations/
│   ├── rules/
│   ├── profiles/
│   ├── schemas/
│   └── evidence_index/
├── memory/
│   ├── session/
│   ├── persistent/
│   ├── skills/
│   └── summaries/
├── skills/
│   ├── wiki_ingest/
│   ├── wiki_query/
│   ├── wiki_lint/
│   ├── answer_writeback/
│   ├── style_reflection/
│   └── ontology_extract/
├── apps/
│   ├── cli/
│   │   └── main.py
│   ├── api/
│   │   └── server.py
│   └── worker/
│       └── jobs.py
├── src/
│   └── personal_brain/
│       ├── config.py
│       ├── logging.py
│       ├── models/
│       ├── ingestion/
│       ├── wiki/
│       ├── ontology/
│       ├── retrieval/
│       ├── agent/
│       ├── eval/
│       └── utils/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── golden/
│   └── fixtures/
├── scripts/
│   ├── ingest.py
│   ├── build_wiki.py
│   ├── lint_wiki.py
│   ├── extract_ontology.py
│   ├── run_agent.py
│   └── export_profile.py
├── datasets/
│   ├── eval_queries/
│   ├── gold_answers/
│   └── style_examples/
└── evolution/
    ├── datasets/
    ├── evals/
    ├── prompts/
    ├── reports/
    ├── gates/
    └── optimize_skill.py

## 四、模块职责

### raw/
只放原始资料。append-only。不要把总结结果写进 raw。

### wiki/
这是核心层。必须可读、可维护、可链接。所有查询优先通过 wiki，而不是直接绕到 raw。

### ontology/
第一阶段只建骨架和最小 schema，不要求做复杂图谱，但要预留：
- objects
- relations
- rules
- profile
- evidence_index

### memory/
第一阶段只做结构，不要求复杂实现。保留：
- session memory
- persistent memory
- skills memory

### agent/
第一阶段不要深耦合 Hermes，但要预留 adapter：
- hermes_adapter.py
- planner.py
- responder.py
- memory_writer.py
- style_engine.py

### skills/
每个 skill 独立目录，后续用于自进化优化。
Batch 1 至少放占位文档。

## 五、数据模型要求

请至少实现以下 Pydantic 模型：

### SourceRecord
- source_id
- path
- source_type
- title
- created_at
- ingested_at
- tags
- checksum

### WikiPage
- page_id
- page_type
- title
- path
- summary
- source_refs
- links_to
- updated_at

### OntologyObject
- object_id
- object_type
- canonical_name
- aliases
- attributes
- evidence_refs
- wiki_refs

### PersonalStyleProfile
- profile_id
- preferred_tone
- preferred_structure
- favored_domains
- citation_preference
- abstraction_level
- update_policy

### AnswerRecord
- query_id
- user_query
- retrieved_pages
- retrieved_sources
- answer_path
- writeback_proposed
- writeback_targets
- created_at

## 六、实现要求

### 1. 代码要求
- Python 3.11+
- 尽量模块化
- 类型标注尽量完整
- 合理注释
- 不要把所有逻辑塞进单文件
- 文件 I/O 要有错误处理
- 先实现稳定可运行版本，不要过度设计

### 2. 可测试性
请为以下部分补基础测试：
- ingest
- wiki build
- query
- lint
- writeback proposal

至少提供：
- unit tests
- integration tests
- fixtures

### 3. CLI 可用性
我希望可以直接在本地跑：
- python -m apps.cli.main ingest ./raw/industry_docs
- python -m apps.cli.main build-wiki
- python -m apps.cli.main ask "什么是品牌经营OS？"
- python -m apps.cli.main lint

### 4. 文档
请生成：
- README.md：告诉我如何安装和运行
- AGENTS.md：定义 code-agent 和 knowledge-agent 的规范
- 每个核心模块加简短说明
- 用 TODO 明确标出 Hermes Phase 2 接入点

## 七、架构原则

请严格遵守以下原则：

1. raw 与 wiki 分层
2. wiki 与 memory 分层
3. ontology 来源于 wiki，不要只从 raw 直接抽
4. 不要实现在线自修改代码
5. 自进化只作为未来 Phase 2/3 的离线能力预留
6. 个人风格不应该破坏 groundedness
7. 回答必须区分：
   - fact
   - summary
   - interpretation
   - recommendation

## 八、Batch 1 输出预期

我希望你输出的是：
1. 一个可运行的 repo skeleton
2. 基础代码实现
3. 最小 CLI
4. 最小测试
5. 示例 wiki 页面
6. 示例 raw 输入
7. 清晰的 TODO 注释，标明 Hermes 接入点

## 九、开发策略

请采用“先能跑，再扩展”的方式：
- 先做文件系统版本
- 先做 markdown wiki
- 先做简单检索和问答
- 先做 lint 和 writeback proposal
- 不要一开始引入复杂数据库、前端、分布式系统

## 十、重要注意事项

- 不要把这个系统做成“聊天记录堆积器”
- 要体现“LLM Wiki 是知识编译层”的核心思想
- 高价值问答结果必须能沉淀
- 代码目录必须清晰，职责必须分离
- 保持后续与 Hermes Agent 的兼容性


补充要求：

1. 请先生成最小可运行版本，不要先做复杂 UI
2. 请优先保证文件系统结构和 CLI 可用
3. 请在 README 里提供一个 end-to-end demo
4. 请提供 3~5 个 sample raw 文件和对应 wiki 输出示例
5. 请在代码里用 TODO(HERMES_PHASE_2) 标出未来 Hermes 接入点
6. 请保证 writeback proposal 默认不自动覆盖已有 wiki 页面
7. 请尽量使用 markdown 作为 wiki 主体存储格式