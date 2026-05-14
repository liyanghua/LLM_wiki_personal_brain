# QMD 驱动的检索层加厚升级计划

## Summary
- 建议采纳 `qmd`，但放在 Personal Brain backend 的检索基础设施层，而不是直接暴露给 Hermes。这样符合你现在的边界约束：Hermes 只用 Personal Brain tools/contracts，领域检索逻辑仍留在后端。
- 当前仓库的主检索还比较轻：[`query_engine.py`](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/src/personal_brain/retrieval/query_engine.py) 主要靠 `wiki/index.md` + `overlap_score` 选候选，[`retrieval_planner.py`](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/src/personal_brain/extraction/retrieval_planner.py) 也是在这个基础上做四桶分发。它适合中小规模 wiki，但已经到了该加“独立搜索引擎层”的阶段。
- Step 1 采用你刚确认的路线：`Wiki 优先` + `Backend 封装`。先只索引 `wiki/`，把 Ask / Extraction Interview 的主检索精度和可解释性提升起来；`raw/` 作为下一阶段的 evidence collection，再接进来。
- 推荐不是直接用一次一调的 `qmd` CLI，而是让 backend 管理一个长生命周期的 qmd runtime。原因是 `qmd` 的 hybrid query 依赖本地 embedding / rerank / query expansion 模型，交互式 extraction 多轮调用时，长驻进程的收益会明显高于反复冷启动。
- 依据参考：
  - [llm-wiki.md](https://github.com/tobi/qmd) 里的定位本来就是“wiki 规模变大后加入本地搜索引擎”
  - [qmd README](https://github.com/tobi/qmd) 支持 BM25 / vector / rerank / query expansion、collection/context、CLI 与 MCP/HTTP
  - 对中文语料，qmd 官方明确建议把默认 embedding 切到 `Qwen3-Embedding`，因为默认 `embeddinggemma` 偏英文

## Key Changes
- 新增一个 backend-owned 检索抽象层，替换“QueryEngine 直接自己检索”的结构：
  - `SearchBackend` 或 `SearchProvider` 抽象，统一返回归一化结果：`title/path/snippet/score/source_refs/collection/retrieval_mode/explain`
  - 两个实现：
    - `LegacyWikiSearchProvider`：保留当前 `index + PageRanker` 作为 fallback
    - `QmdSearchProvider`：负责调用 qmd，并把结果映射成现有 `PageCandidate / RankedPage / EvidenceItem / RetrievalHit`
- `QmdSearchProvider` 的接入方式固定为 backend 封装：
  - backend 启动时检测 qmd 可用性
  - 通过 backend 管理的 qmd 长驻服务或 sidecar 与其通信
  - Hermes 继续只调用 [`tool_registry.py`](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/src/personal_brain/agent/tool_registry.py) 里的 `search_wiki` / extraction tools，不直接感知 qmd
- Step 1 只建 `wiki` collection，不把 `raw/`、`memory/session/answers`、聊天记录一开始塞进 qmd：
  - 避免把 transient answer/session 内容混进主知识检索
  - 保持 AGENTS.md 的层边界：wiki 是主回答层，memory 仍由专门的 memory recall 逻辑负责
- 为 qmd 增加 collection/path context：
  - `wiki/topics`、`wiki/principles`、`wiki/projects`、`wiki/sources` 分别添加 context，帮助 query intent 和 rerank 更稳定
  - 这些 context 由 backend 统一生成，不靠 Hermes 提示词临时拼
- QueryEngine 升级为“双阶段检索”：
  - 阶段 1：qmd hybrid 召回 top-N wiki 页面
  - 阶段 2：现有 `PageRanker` 保留为 repo-specific rerank / policy layer，用来加 page_type bonus、question_type bonus、业务权重，而不是完全被 qmd 替掉
  - 这样既吃到 qmd 的 BM25/vector/rerank，又保留你的领域偏置
- Extraction RetrievalPlanner 升级为“检索引擎 + 桶路由”：
  - `object_pages` 主要取 qmd 在 `topic/principle/project` 的高分命中
  - `evidence_pages` 来自 qmd top chunks / top docs 的归一化 evidence
  - `conversation_hits` 继续走本地 session memory，不进 qmd
  - `pattern_hits` 继续走 persistent principles + domain heuristics，不进 qmd
- Index lifecycle 固定为 backend 管理：
  - ingest / wiki writeback apply / page merge 后触发 qmd collection update
  - 增加显式的 `rebuild search index` 管理命令，避免索引状态隐式漂移
  - qmd 的命名 index 不用默认全局库，按当前 repo 隔离，避免多个知识库相互污染
- 配置与接口建议：
  - 新增配置开关：`BRAIN_SEARCH_BACKEND=legacy|qmd`
  - 新增 qmd 相关配置：index 名称、wiki collection 名称、embed model、是否启用 rerank、是否启用 explain
  - `search_wiki` 工具和 `/api/ask` 内部 trace 可增加可选字段：`backend`, `mode`, `explain`, `collection`
  - 先不改 Hermes 工具表面语义，只增强返回元数据
- Phase 2 再接 `raw/`：
  - 作为单独的 `raw` collection，只用于 evidence augmentation，不作为 primary answer layer
  - query/extraction 先从 wiki collection 检索，不足时再补 raw evidence
  - raw 命中在 UI 和 tool output 中要显式标为 raw/evidence fallback，不能和 wiki 命中混淆

## Test Plan
- 单元测试：
  - `QmdSearchProvider` 能把 qmd 结果归一化到现有 retrieval types
  - qmd 不可用时自动回退到 `LegacyWikiSearchProvider`
  - 中文语料配置下，provider 会使用 `Qwen3-Embedding` 配置而不是默认 embedding
  - QueryEngine 的 repo-specific rerank 仍然生效，不会被 qmd 分数直接短路
- 集成测试：
  - `ask("什么是品牌经营OS？")` 在 qmd 模式下仍返回结构化答案和 citations
  - extraction interview 的四桶检索仍成立，且 `object_pages/evidence_pages` 明显来自 qmd-backed wiki retrieval
  - wiki 页面更新后，索引能增量刷新；新页面能在后续 ask/extraction 中被命中
  - qmd down / index missing / model unavailable 时，系统不白屏、不 500，而是降级到 legacy search
- 质量验收：
  - 选 10 个代表性中文问题，对比 `legacy` 与 `qmd` 两个 backend
  - 关注指标：top-5 命中质量、evidence 相关性、follow-up 问题质量、writeback precision
  - 至少做一组黄金案例对比：品牌经营OS / SUPER 指标 / 项目状态 / principle 类问题
- Hermes 验收：
  - Hermes 侧无需新领域逻辑
  - 现有 `search_wiki` / extraction tools 在 qmd 模式下返回更强结果，但调用方式不变
  - 保证“换检索层不换 Hermes 契约”

## Assumptions
- Step 1 默认只索引 `wiki/`，不把 `memory/session` 和聊天产物接进 qmd，避免反馈回路和层污染。
- Step 1 默认由 Personal Brain backend 封装 qmd；Hermes 不直接连 qmd MCP。
- 中文是主语料，所以默认不使用 qmd 的英文 embedding 配置，直接按 qmd 官方建议切到 `Qwen3-Embedding` 并接受首次建索引/下载模型成本。
- qmd 的 hybrid retrieval 是底层召回能力，不替代现有 page-type / question-type / writeback-aware 的领域排序策略。
- 如果要快速落地，推荐分两步实施：
  - Step A：先完成 `SearchProvider + qmd wiki-only` 替换 QueryEngine / Extraction RetrievalPlanner 的候选召回
  - Step B：再把 `raw` 作为 evidence-only collection 接入，并补评测与前端 explain 展示
