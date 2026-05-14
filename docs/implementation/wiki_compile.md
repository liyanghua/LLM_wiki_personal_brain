# raw_new Schema-Driven Wiki Production 升级计划

## Summary
- 这次把 `wiki 质量` 提升为第一优先级，不再把它视为检索前的附属步骤。`docs/schema/schema_desc.md` 提供的 `_dir_schema / compiler_routes / domain_profiles` 将成为 `raw_new -> wiki -> index -> ask` 的控制平面。
- 实施方式不是继续沿用当前 `raw/` 的启发式编译逻辑，而是为 `raw_new` 建一条独立 pilot pipeline：独立 source root、独立 wiki 输出、独立 search index、独立质量报告；不污染当前主库。
- `conversations/` 在 pilot 中固定为 `evidence-only / candidate-only`，不能直接生成最终规则 wiki；`industry_docs/` 是主知识输入层；`attachments/data/notes/links` 主要承担证据、补充上下文和结构映射角色。

## Key Changes

### 1. 先按 `docs/schema/schema_desc.md` 原封不动落 schema 文件
- 直接以 `docs/schema/schema_desc.md` 为唯一内容来源，在 `raw_new/` 下生成以下文件，内容不改写、不重命名、不换目录：
  - `raw_new/.brain/_dir_schema.yaml`
  - `raw_new/.brain/source_records.jsonl`
  - `raw_new/.brain/compiler_routes.yaml`
  - `raw_new/.brain/domain_profiles/ecommerce_term_dictionary.yaml`
  - `raw_new/.brain/domain_profiles/main_image_ctr_ontology.yaml`
  - `raw_new/.brain/domain_profiles/interview_question_taxonomy.yaml`
  - `raw_new/industry_docs/_dir_schema.yaml`
  - `raw_new/conversations/_dir_schema.yaml`
  - `raw_new/attachments/_dir_schema.yaml`
  - `raw_new/data/_dir_schema.yaml`
  - `raw_new/notes/_dir_schema.yaml`
  - `raw_new/links/_dir_schema.yaml`
- `source_records.jsonl` 不手写业务内容，只保留 schema doc 规定的文件与后续 ingest 使用的字段契约；真正记录内容由 schema-aware ingestion 生成和维护。
- 这些 schema 文件本期只服务 `raw_new` pilot，不 retro-fit 到旧 `raw/`。

### 2. 把 `raw_new` 升级成独立 pilot workspace
- 配置层新增 `source_root` 和 `workspace_root` 概念，不再把 `BrainPaths.raw` 硬编码为唯一源根目录。
- 为 `raw_new` pilot 提供独立运行目标，推荐目录语义：
  - source root: `raw_new/`
  - pilot output root: 独立 `wiki/ memory/ ontology/ eval/ search` 产物目录
- Ask / interview / search rebuild / lint / eval 都允许绑定到 pilot workspace，保证：
  - 不写入现有主 `wiki/`
  - 不复用主 `memory/search/qmd_state`
  - 不把旧 `raw/` 噪音混入这次试点
- 默认策略：`raw_new` pilot 是 schema-first 试验田，验证通过后再考虑把抽象回灌到主工作区。

### 3. Ingestion 升级为 schema-aware metadata compiler
- 新增 schema loader，按优先级读取：
  - `raw_new/.brain/_dir_schema.yaml`
  - 各子目录 `_dir_schema.yaml`
  - `raw_new/.brain/compiler_routes.yaml`
  - `raw_new/.brain/domain_profiles/*.yaml`
- `IngestionService` 不再只写浅层 `SourceRecord`；它要为每个 source record 注入 schema 派生元数据，至少包括：
  - `source_family`
  - `role_in_pipeline`
  - `authority_level`
  - `trust_level`
  - `maturity_level`
  - `preferred_outputs`
  - `not_for_direct_publish`
  - `risk_flags`
  - `routing_policy`
  - `retrieval_policy`
  - `governance_policy`
  - `domain_profiles`
- `source_records.jsonl` 升级为“原始文件记录 + schema 继承结果 + ingest trace”的统一账本，后续 wiki 编译、检索和质量检查全部以它为准。
- 目录 schema 继承是强约束：
  - 文件级未覆盖时，继承目录默认值
  - 不允许 wiki compiler 自己猜 source family
  - `conversations` 的 `candidate_only / not_for_direct_publish` 必须在元数据层显式可见

### 4. Wiki 生产阶段改成 schema-driven compiler pipeline
- 用 schema routes 替换当前 [`src/personal_brain/wiki/compiler.py`](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/src/personal_brain/wiki/compiler.py) 里的硬编码标题/关键词启发式。
- 编译器拆成四个明确阶段：
  1. source normalization：读取 source record + schema inheritance + parse result
  2. route resolution：依据 `compiler_routes.yaml` 决定走哪条 compile pipeline
  3. candidate extraction：按 source family 和 domain profile 提取 concept / heuristic / boundary / workflow / evidence candidate
  4. wiki materialization：只把允许进入 wiki 的候选物化成 pilot wiki 页面，其余进入 candidate/proposal 区
- 各目录的最小策略固定如下：
  - `industry_docs`：可生成 topic / principle / workflow / scenario / heuristic 类 wiki 候选，是主发布源
  - `conversations`：只生成 interview summary、candidate assets、pending questions、follow-up topics，不能直接落 final wiki
  - `attachments`：优先做结构提取、证据锚点、附件与主文档映射，不直接长成规则页
  - `data`：优先做指标/变量/表格证据索引，不直接长成结论页
  - `notes`：低置信补充材料，只能做 candidate augmentation
  - `links`：做 external reference registry 和 provenance 补全
- pilot wiki 页必须统一 frontmatter，并至少包含：
  - `page_id`
  - `page_type`
  - `title`
  - `summary`
  - `source_refs`
  - `schema_route`
  - `source_family`
  - `confidence`
  - `updated_at`
  - `links_to`
  - `governance_status`
- wiki 页面生成策略固定：
  - 优先 merge 到已有 page，不制造同义重复页
  - `candidate_only` 内容不得混入正式 principle/topic 页面正文
  - conversation-derived 内容进入明确的 managed candidate sections 或独立 candidate artifacts
  - 所有 durable claim 都必须携带来源证据

### 5. 索引阶段升级成“schema-aware dual index”
- 索引不再只是对 `wiki/**/*.md` 全量无差别建库；要按 schema 的 source role 和 retrieval policy 分层。
- pilot 检索建议固定为三层：
  - `pilot wiki` collection：主回答层，供 Ask/Interview 默认检索
  - `raw_new/industry_docs` evidence collection：主证据补充层
  - `raw_new/conversations` evidence-only collection：只给 interview 和 trace 使用，不作默认回答层
- `QmdSearchProvider` / search provider 抽象继续保留，但 collection 注册和 context 注入改由 schema 驱动，而不是硬编码：
  - collection context 从 `_dir_schema.yaml` 和 `compiler_routes.yaml` 生成
  - retrieval flags 由 schema 控制，例如 `searchable_in_qa`, `searchable_in_interview`, `require_provenance`
- Query / interview 的检索策略固定：
  - 先查 pilot wiki collection
  - wiki 命中不足或命中页过薄时，再补 `industry_docs` evidence
  - `conversations` 只在 interview、candidate extraction、trace diagnosis 中参与
- 索引元数据要能回传到 trace/UI：
  - hit 来自哪个 collection
  - 属于哪个 source family
  - 是否 candidate-only
  - 是否需要 scope check
  - 是否触发 thin-wiki / evidence-gap warning

### 6. 新增专门的 wiki 质量检查链路
- 现有 lint 只覆盖 orphan/index/source_refs/stale，远远不够；本期要新增 schema-aware wiki quality audit。
- 质量检查分四组：
  - 结构质量：
    - frontmatter 完整
    - page_type 合法
    - index 收录
    - cross-links 存在
    - 无重复/近重复页
  - 来源质量：
    - durable claim 必须有 `source_refs`
    - `conversations` 不能直接成为 final rule page 唯一来源
    - `candidate_only` 内容不能被误发布
    - 页面 provenance coverage 达标
  - 编译策略质量：
    - 每个 page 都能回溯到 `schema_route`
    - page 是否违背目录 schema 的 governance/retrieval policy
    - `industry_docs` 是否被过度摘要为过薄 wiki
  - 检索质量：
    - gold questions top-k 命中是否落在正确 wiki 页面
    - raw evidence 是否只在需要时补充
    - follow-up 问题是否建立在正确 page/evidence 上
- 新增独立质量报告接口，至少支持：
  - CLI：`wiki-quality-report`
  - 输出：JSON + Markdown
  - 内容：质量分、问题列表、问题页面、对应 source record、违反的 schema rule、建议修复动作
- Ask 诊断栏后续直接消费这些质量元数据，帮助区分：
  - 是 wiki 产物太薄
  - 还是索引策略不对
  - 还是 source 本身不适合直接产出规则

### 7. 把“人工检查 wiki 质量”变成固定工作流
- 你检查这批新生产 wiki 时，固定看三层：
  - 页面层：抽查 page frontmatter、summary、source refs、managed sections、是否混入 conversation 话术
  - 编译层：看 source record、schema route、生成 trace，确认每页来自哪类源、为什么允许发布
  - 检索层：用黄金问题回放，看 top hits、evidence 和 answer 是否落在对的 wiki 页面
- 推荐先建立一组 pilot 黄金问题，至少包含：
  - `6大维度首先看哪个维度`
  - `品牌经营OS和SUPER指标之间是什么关系`
  - `某类目主图优化先看什么变量`
- 每个问题验收四件事：
  - 是否命中正确 pilot wiki 页
  - 是否需要 raw evidence 补充
  - 补充后答案是否更精确
  - 是否没有把 conversation 草稿当成最终知识

## Important Interfaces
- 配置新增：
  - `BRAIN_SOURCE_ROOT`
  - `BRAIN_WORKSPACE_ROOT`
  - `BRAIN_SCHEMA_ENABLED`
  - `BRAIN_SCHEMA_PROFILE_ROOT`
  - `BRAIN_SEARCH_COLLECTION_POLICY`
- `SourceRecord` 扩展 schema-derived 字段；旧字段保留以兼容现有 ingestion/query 逻辑。
- wiki page frontmatter 扩展：
  - `schema_route`
  - `source_family`
  - `confidence`
  - `governance_status`
  - `retrieval_tags`
- 新增内部模块建议：
  - `schema_loader`
  - `schema_registry`
  - `schema_aware_ingest`
  - `route_resolver`
  - `candidate_materializer`
  - `wiki_quality_audit`
- CLI / service 建议新增：
  - `schema-init --root raw_new`
  - `build-wiki --workspace pilot_raw_new`
  - `search-rebuild --workspace pilot_raw_new`
  - `wiki-quality-report --workspace pilot_raw_new`

## Test Plan
- 单元测试：
  - schema loader 能正确读取 root + 子目录 `_dir_schema`
  - `source_records.jsonl` 能记录 schema inheritance 结果
  - `compiler_routes.yaml` 能把不同目录/文档类型路由到正确 pipeline
  - `conversations` 内容不会被物化成 final wiki rule page
  - page frontmatter 带上 schema/governance/retrieval 元数据
- 集成测试：
  - 以 `raw_new` 为 source root 完成一次独立 ingest -> build wiki -> search rebuild
  - pilot wiki 与主 wiki 完全隔离
  - qmd/legacy 检索都能识别 pilot collections
  - Ask/interview 在 pilot 模式下优先命中 pilot wiki，再补 raw evidence
- 质量验收：
  - 对黄金问题集比较旧 `raw` 流程与 `raw_new schema-first` 流程
  - 关注 top-5 命中质量、evidence 相关性、answer precision、follow-up quality
  - 至少拿 `6大维度·42个细分变量选择逻辑01` 做首个标杆案例，确认 `维度1：视觉核心层（决定第一眼停留）` 能从 pilot wiki 或 evidence gap trace 中被稳定捕获

## Assumptions
- `docs/schema/schema_desc.md` 是这次 schema 文件的唯一权威来源；“原封不动”按该文档的示例内容和路径执行，不做产品化改写。
- `raw_new` 是独立 pilot，不与旧 `raw/`、旧主 wiki、旧 search 状态混跑。
- 这期先把 schema-driven wiki production、indexing 和质量审计做对，再考虑把这套机制回灌到主库。
- `conversations/` 在当前阶段保持 evidence-only / candidate-only，不升级为主回答层。
