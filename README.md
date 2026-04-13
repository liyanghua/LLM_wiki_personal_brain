# Personal Brain OS

Local-first Personal Brain OS with a durable wiki layer, Step1 ingest/build/query pipeline, and Step2 retrieval, memory, style, and Hermes-ready agent surfaces.

## Layer Model

The repository keeps four strict layers:

1. `raw/` preserves source truth and provenance.
2. `wiki/` is the primary human-readable compiled knowledge layer.
3. `ontology/` and `memory/` hold structured assets derived from the wiki.
4. `src/personal_brain/agent/` and `skills/` prepare the runtime layer for future Hermes integration.

The wiki remains the main answer-composition layer. Step2 improves retrieval quality and continuity without bypassing it.

## What Batch 2 Adds

Step2 upgrades the Batch 1 system in four ways:

- modular retrieval pipeline for `ask`
- automatic session memory plus proposal-first persistent memory
- style/profile layer that changes expression but not evidence
- Hermes adapter skeleton with typed tool contracts

### Retrieval Pipeline

`python -m apps.cli.main ask "<question>"` now runs these stages:

1. `QuestionClassifier`
2. candidate wiki page retrieval from `wiki/index.md`
3. `PageRanker`
4. `EvidenceSelector`
5. `AnswerPlanner`
6. `AnswerComposer`
7. `StyleEngine`

The answer format is now:

- `Fact`
- `Synthesis`
- `Interpretation`
- `Recommendation`
- `Citations`

Answers synthesize multiple wiki pages when relevant and preserve `source_refs` in the rendered citations.

### Memory Layer

Session memory is written automatically for every `ask`:

- `memory/session/<YYYY-MM-DD>/<query_id>.json`
- `memory/session/summaries/<YYYY-MM-DD>.md`
- `memory/session/answers/<query_id>.md`

Persistent memory is conservative and proposal-first:

- `memory/persistent/profile.json`
- `memory/persistent/interests.json`
- `memory/persistent/principles.json`
- `memory/persistent/open_loops.json`

Normal `ask` does not mutate these persistent files. Instead it stores memory proposals inside the session record.

### Style/Profile Layer

The active style profile is loaded from `memory/persistent/profile.json`.

Supported profile dimensions:

- preferred answer structure
- abstraction level
- actionability preference
- citation preference
- favored output forms
- reuse preference

Style only affects phrasing, ordering, and citation density. It does not alter selected evidence or introduce unsupported claims.

### Hermes Adapter Skeleton

The runtime-agnostic Hermes compatibility layer lives under `src/personal_brain/agent/`.

Current tool contracts:

- `search_wiki(query)`
- `read_page(page_id)`
- `search_memory(query)`
- `propose_writeback(query_id)`
- `run_lint()`

These are exposed through `HermesAdapter.list_tools()` and `HermesAdapter.invoke(...)`.

`TODO(HERMES_PHASE_2_RUNTIME)` marks the boundaries where a real Hermes runtime can attach later.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

If you want a lightweight local run without editable install:

```bash
PYTHONPATH=src .venv/bin/python -m apps.cli.main --help
```

## CLI

Public commands remain unchanged:

```bash
python -m apps.cli.main ingest ./raw/industry_docs ./raw/conversations
python -m apps.cli.main build-wiki
python -m apps.cli.main ask "什么是品牌经营OS？"
python -m apps.cli.main lint
python -m apps.cli.main writeback <query_id>
```

## End-to-End Demo

```bash
python -m apps.cli.main ingest ./raw/industry_docs ./raw/conversations
python -m apps.cli.main build-wiki
python -m apps.cli.main ask "品牌经营OS和SUPER指标之间是什么关系？"
python -m apps.cli.main lint
```

Expected generated outputs include:

- `wiki/index.md`
- `wiki/log.md`
- `wiki/topics/品牌经营os.md`
- `wiki/projects/儿童学习桌垫单因子测图.md`
- `wiki/principles/商品全生命周期运营原则.md`
- `memory/session/<date>/<query_id>.json`
- `memory/session/summaries/<date>.md`
- `memory/session/writeback/<query_id>.json`

## Sample Inputs and Outputs

Representative raw inputs already in the repo:

- `raw/industry_docs/电商运营本体核心文档.md`
- `raw/industry_docs/淘天商品全生命周期智能运营AI体.md`
- `raw/industry_docs/货品全生命周期管理-SUPER指标模型.md`
- `raw/industry_docs/桌垫类目-儿童学习桌垫单因子测图示例.md`
- `raw/conversations/背景选择_访谈日志.md`

Representative generated outputs:

- `wiki/sources/电商运营本体核心文档.md`
- `wiki/topics/品牌经营os.md`
- `wiki/principles/商品全生命周期运营原则.md`
- `memory/persistent/profile.json`
- `memory/session/summaries/`

## Testing

Run the full suite with:

```bash
PYTHONPATH=src .venv/bin/pytest -q
```

Coverage now includes:

- ingestion and dedup behavior
- wiki compilation
- multi-page retrieval and evidence selection
- session memory writes
- persistent memory proposal policy
- style profile loading and rendering
- Hermes tool schema and adapter dispatch
- CLI compatibility

## Notes

- Step2 stays filesystem-first. There is no database or vector store.
- Optional model enhancement is only a provider hook inside the retrieval layer; no external model dependency is required.
- `hermes-agent-main/` remains a reference directory, not a runtime dependency.
