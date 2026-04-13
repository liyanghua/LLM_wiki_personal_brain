已按 Step1 落地了一个可运行的 Batch 1 版本。核心实现集中在 [apps/cli/main.py](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/apps/cli/main.py), [src/personal_brain/ingestion/service.py](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/src/personal_brain/ingestion/service.py), [src/personal_brain/wiki/compiler.py](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/src/personal_brain/wiki/compiler.py), [src/personal_brain/retrieval/query_engine.py](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/src/personal_brain/retrieval/query_engine.py), [src/personal_brain/lint/service.py](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/src/personal_brain/lint/service.py) 和 [src/personal_brain/writeback/service.py](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/src/personal_brain/writeback/service.py)。仓库骨架、Pydantic 模型、CLI、API/worker 占位、skills 占位、README 和 Hermes Phase 2 TODO 也都补齐了。

我还用真实 `raw/` 语料跑通了整条链路，已经生成了样例产物，比如 [wiki/topics/品牌经营os.md](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/wiki/topics/品牌经营os.md), [wiki/projects/儿童学习桌垫单因子测图.md](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/wiki/projects/儿童学习桌垫单因子测图.md), [wiki/principles/商品全生命周期运营原则.md](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/wiki/principles/商品全生命周期运营原则.md), [wiki/index.md](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/wiki/index.md), [wiki/log.md](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/wiki/log.md) 和一个 writeback proposal [memory/session/writeback/20260413-071606.json](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/memory/session/writeback/20260413-071606.json)。README 也改成了可直接上手的版本：[README.md](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/README.md)。

验证结果是：
- `PYTHONPATH=src ./.venv/bin/pytest -q` -> `5 passed`
- `python -m apps.cli.main build-wiki` -> `{"source_pages": 20, "derived_pages": 3}`
- `python -m apps.cli.main ask "什么是品牌经营OS？"` -> 返回了基于 wiki 的四段式答案
- `python -m apps.cli.main lint` -> `{"issues":[]}`
- `python -m apps.cli.main writeback 20260413-071606` -> 成功生成 proposal

有一个边界我没有单独做端到端验证：`apps/api/server.py` 目前是最小可运行壳，没有再单开 HTTP 流程测试。若你愿意，我下一步可以继续做两件事里的任意一个：一是把 `ask/build-wiki` 的摘要质量再提升一档，二是补 API 与更多真实语料的 golden tests。