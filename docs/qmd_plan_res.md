QMD 检索层的 Step A 已经接进后端了，主改动落在 [search_provider.py](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/src/personal_brain/retrieval/search_provider.py), [query_engine.py](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/src/personal_brain/retrieval/query_engine.py), 和 [config.py](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/src/personal_brain/config.py)。现在 backend 有了 `SearchProvider` 抽象、`LegacyWikiSearchProvider` 回退、`QmdSearchProvider` 封装、repo-isolated qmd cache/state、以及 `search-rebuild` CLI。`QueryEngine` 和 extraction `RetrievalPlanner` 都改成先走搜索层，再保留现有 `PageRanker` 作为领域重排，所以 Hermes 侧契约没变，但 `search_wiki` 的返回多了 `backend/mode/collection/explain` 元数据。

索引生命周期也接上了：`build-wiki` 和 writeback apply 后会触发 search refresh；`BRAIN_SEARCH_BACKEND=qmd` 时优先走 qmd，不可用或报错会自动退回 legacy，不会把问答链路打挂。为了匹配你这次中文主语料方案，我把期望 embedding 配置收进了 backend 配置，并在 qmd 子进程环境里传出 `QMD_EMBED_MODEL=Qwen3-Embedding`；不过这里要坦诚说一句，当前仓库里没有本地 qmd 二进制，所以我没法对“真实 upstream qmd 是否原生读取这个 env”做 live 验证，这部分现在是 backend 侧的 best-effort 配置传递。

验证我已经跑过了：
- `.venv/bin/pytest tests/unit/test_search_backend.py -q`
- `.venv/bin/pytest tests/unit/test_retrieval_pipeline.py tests/unit/test_extraction.py tests/unit/test_api_server.py tests/unit/test_hermes_adapter.py tests/integration/test_step2_ask_flow.py tests/golden/test_step2_golden_answers.py -q`
- `.venv/bin/pytest -q`
- `python3 -m compileall src apps tests`

结果是 `34 passed`。如果你下一步要继续，我建议就沿这个基础做两件事中的一个：先把本机 qmd 真正装起来并跑一遍 `BRAIN_SEARCH_BACKEND=qmd .venv/bin/python -m apps.cli.main search-rebuild`，或者进入 Step B，把 `raw` 作为 evidence-only collection 接上。