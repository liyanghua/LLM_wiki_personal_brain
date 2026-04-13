# Personal Brain OS

Local-first Personal Brain OS with a durable wiki middle layer and a Step3 asset-production pipeline.

## Layer Model

The repository keeps four strict layers:

1. `raw/` preserves source truth and provenance.
2. `wiki/` is the primary human-readable compiled knowledge layer.
3. `ontology/` and `memory/` store structured assets derived from wiki-backed evidence.
4. `src/personal_brain/agent/` and `skills/` provide the runtime and candidate skill surfaces.

The system now optimizes for durable asset production, not just grounded answers.

## What Step3 Adds

Step3 upgrades the existing Step2 query engine into a true asset-production system:

- structured writeback routing plus merge-safe wiki updates
- method profile and template selection that shape structure more than tone
- ontology candidate extraction from wiki pages
- skill candidate generation from repeated high-value sessions
- evaluation harness for “worth sinking” quality, not just code correctness

### Writeback Pipeline

`writeback` is now a routed flow:

1. target selection
2. quality gate
3. merge-safe apply
4. proposal bundle persistence

Every target includes:

- target path
- action
- rationale
- confidence
- long-term value
- evidence refs
- content preview
- approval status

Existing wiki pages are updated through `## Managed Writeback Updates`, not naive overwrite.

### Method Profile

The active method profile still lives in `memory/persistent/profile.json`, but it now models:

- preferred answer structure
- abstraction depth
- operationalization level
- explanation pattern
- reusable asset preferences
- citation preference
- assetization preference

Answers keep the core four sections:

- `Fact`
- `Synthesis`
- `Interpretation`
- `Recommendation`

Step3 may add one method section such as `Mapping`, `Roadmap`, `Schema`, or `Object Model`.

### Asset Build

`python -m apps.cli.main build-assets` scans:

- `wiki/`
- `memory/session/`
- `memory/session/writeback/`

and produces:

- `ontology/candidates/<type>/<candidate_id>.json`
- `ontology/candidates/index.json`
- `skills/candidates/<skill_id>/`
- `skills/candidates/index.json`

Ontology candidates are traceable back to wiki pages and source refs.
Skill candidates are proposal-only and include `SKILL.md`, schemas, example, and metadata.

### Evaluation Harness

`python -m apps.cli.main eval` reads `eval/cases/*.json` and writes:

- `eval/reports/<run_id>.json`
- `eval/reports/<run_id>.md`

Evaluation categories:

- `answer_asset_value`
- `writeback_precision`
- `memory_precision`
- `method_consistency`
- `ontology_quality`
- `skill_candidate_quality`

Reports are human-readable and explain whether a case is worth sinking into durable assets.

## CLI

Public commands:

```bash
python -m apps.cli.main ingest ./raw/industry_docs ./raw/conversations
python -m apps.cli.main build-wiki
python -m apps.cli.main ask "品牌经营OS和SUPER指标之间是什么关系？"
python -m apps.cli.main writeback <query_id>
python -m apps.cli.main writeback <query_id> --apply
python -m apps.cli.main build-assets
python -m apps.cli.main eval
python -m apps.cli.main lint
```

## End-to-End Demo

```bash
python -m apps.cli.main ingest ./raw/industry_docs ./raw/conversations
python -m apps.cli.main build-wiki
python -m apps.cli.main ask "品牌经营OS和SUPER指标之间是什么关系？"
python -m apps.cli.main ask "如何把品牌经营OS整理成可复用的方法框架？"
python -m apps.cli.main writeback <query_id> --apply
python -m apps.cli.main build-assets
python -m apps.cli.main eval
```

Expected durable outputs include:

- `wiki/decisions/`
- `ontology/candidates/`
- `skills/candidates/`
- `eval/reports/`
- `memory/session/<date>/<query_id>.json`
- `memory/session/writeback/<query_id>.json`

## Sample Real-Corpus Outputs

Representative inputs already in the repo:

- `raw/industry_docs/电商运营本体核心文档.md`
- `raw/industry_docs/淘天商品全生命周期智能运营AI体.md`
- `raw/industry_docs/货品全生命周期管理-SUPER指标模型.md`
- `raw/industry_docs/桌垫类目-儿童学习桌垫单因子测图示例.md`
- `raw/conversations/背景选择_访谈日志.md`

Representative generated assets:

- `wiki/topics/品牌经营os.md`
- `wiki/principles/商品全生命周期运营原则.md`
- `ontology/candidates/topic/`
- `ontology/candidates/concept/`
- `skills/candidates/topic_synthesis/`
- `skills/candidates/project_context_refresh/`
- `eval/reports/`

## Testing

Run the full suite with:

```bash
PYTHONPATH=src .venv/bin/pytest -q
```

Coverage now includes:

- ingestion and dedup behavior
- wiki compilation
- structured writeback routing and merge behavior
- method profile loading and template selection
- ontology candidate traceability
- skill candidate packaging
- build-assets and eval CLI flow
- Hermes adapter compatibility

## Notes

- The system remains filesystem-first. There is no database or vector store.
- `ask` computes asset and writeback previews, but does not directly mutate wiki, ontology, or skills.
- `writeback --apply` only applies approved wiki targets. Ontology and skill targets remain candidate-only.
- `hermes-agent-main/` remains a reference directory, not a runtime dependency.
