# Step2 Batch 2 Implementation Plan

## Summary
- Upgrade the current Batch 1 `ask` path from a single `QueryEngine` flow into a modular retrieval pipeline with explicit stages: question classification, candidate retrieval, ranking, evidence selection, answer planning, and answer composition.
- Keep the existing CLI contract unchanged: `ingest`, `build-wiki`, `ask`, `lint`, `writeback` remain the public commands. `ask` becomes the orchestration entrypoint for retrieval, memory recall, style application, and conservative memory proposal generation.
- Implement Step2 as a local-file-first system: filesystem wiki stays the primary knowledge layer, session memory is written automatically, persistent memory is `proposal-first`, style updates are suggestion-only, and Hermes readiness is delivered through a runtime-agnostic tool registry plus typed tool schemas.
- Preserve all layer boundaries from `AGENTS.md`: no raw/wiki mixing, no raw-only ontology promotion, no automatic persistent writes from every answer, and no style-driven evidence distortion.

## Key Changes

### 1. Retrieval Pipeline Refactor
- Keep `src/personal_brain/retrieval/query_engine.py` as the top-level orchestrator, but move stage logic into:
  - `question_classifier.py`
  - `page_ranker.py`
  - `evidence_selector.py`
  - `answer_planner.py`
  - `answer_composer.py`
- Retrieval flow:
  - `QuestionClassifier` assigns a lightweight query type such as `definition`, `comparison`, `project-status`, `procedural`, or `open-ended synthesis`.
  - Candidate retrieval still starts from `wiki/index.md`, then expands into linked pages referenced by top index matches.
  - `PageRanker` ranks pages using deterministic local signals: title overlap, summary overlap, body overlap, link connectivity, page type bonus, and optional recency bonus from `updated_at`.
  - `EvidenceSelector` extracts page-scoped evidence blocks from top-ranked pages and carries forward page title, page path, source refs, and short quoted/paraphrased evidence snippets.
  - `AnswerPlanner` produces a section plan for `fact / synthesis / interpretation / recommendation`, plus optional `open_follow_ups`.
  - `AnswerComposer` renders the final answer from the fixed evidence plan.
- Optional model enhancement:
  - Add a provider protocol inside the retrieval layer, but keep deterministic composition as the default.
  - If a provider is configured later, it may only help rewrite or structure selected evidence; it must not introduce unsupported facts or bypass the ranking/evidence-selection steps.
- Decision defaults:
  - Top 5 ranked wiki pages are eligible for synthesis.
  - Final answer should cite up to 3 pages prominently and preserve all underlying `source_refs`.
  - Multi-page synthesis is required when at least 2 pages score above the minimum relevance threshold.

### 2. Models, Config, and Public Interfaces
- Extend `src/personal_brain/models/core.py` with retrieval and memory-facing models:
  - `QuestionClassification`
  - `RankedPage`
  - `EvidenceItem`
  - `AnswerPlan`
  - `SessionRecord`
  - `MemoryProposal`
  - `MemoryRecallBundle`
  - `ToolSpec`
- Expand `AskResult` and `AnswerRecord` to include:
  - question classification
  - ranked/retrieved page ids
  - selected evidence refs
  - session record path
  - persistent memory proposal summaries
  - style profile id used for rendering
- Extend `src/personal_brain/config.py` / `BrainPaths` with explicit paths for:
  - `memory/session/<YYYY-MM-DD>/<query_id>.json`
  - `memory/session/summaries/<YYYY-MM-DD>.md`
  - `memory/persistent/profile.json`
  - `memory/persistent/interests.json`
  - `memory/persistent/principles.json`
  - `memory/persistent/open_loops.json`
- Keep `apps/cli/main.py` command names unchanged.
- Do not add new required CLI commands in Step2.
- Internal acceptance/apply functions for persistent memory may exist in Python services, but acceptance is not exposed as a required CLI workflow in this batch.

### 3. Session Memory and Persistent Memory
- Add:
  - `src/personal_brain/agent/session_manager.py`
  - `src/personal_brain/agent/memory_recall.py`
  - `src/personal_brain/agent/memory_policy.py`
  - replace the placeholder `memory_writer.py` with a real conservative writer
- Session memory behavior:
  - Every `ask` writes one dated session JSON file.
  - Each session record stores query, classification, recalled memory hits, ranked pages, selected evidence, answer summary, proposed follow-up questions, writeback proposal info, and any persistent-memory candidates.
  - `SessionManager` also maintains a daily markdown summary in `memory/session/summaries/<YYYY-MM-DD>.md`.
- Persistent memory behavior:
  - `profile.json` stores the active style profile.
  - `interests.json` stores stable recurring topics only.
  - `principles.json` stores accepted durable principles only.
  - `open_loops.json` stores unresolved follow-up questions with status and originating query ids.
- Policy decision:
  - Session memory writes are automatic.
  - Persistent memory is `proposal-first`.
  - Proposed persistent changes are stored inside the session record under `persistent_memory_proposals`; they do not mutate the persistent JSON files by default.
  - `MemoryPolicy` decides proposal eligibility using conservative rules: repeated topic recurrence, accepted wiki principles, explicit user preference signals, or durable unresolved loops.
  - `MemoryWriter` only applies proposals when called explicitly by internal code or future tooling; Step2 default flow does not auto-apply.
- Follow-up support:
  - `MemoryRecall` loads recent session records plus persistent files and returns a compact recall bundle to the retrieval planner.
  - `ask` should use this recall bundle to keep continuity across consecutive queries without polluting persistent memory.

### 4. Style/Profile Layer
- Add:
  - `style_profile_loader.py`
  - `style_reflector.py`
  - replace the placeholder `style_engine.py` with a formatter that operates after evidence planning
- Profile dimensions to support now:
  - preferred answer structure
  - abstraction level
  - actionability preference
  - citation preference
  - favored output forms
  - reuse preference
- Decision defaults:
  - `memory/persistent/profile.json` is the source of truth.
  - `StyleProfileLoader` loads this file or falls back to a default grounded profile.
  - `StyleEngine` may reorder sections, tighten or expand explanations, and adjust citation density, but cannot alter selected evidence or factual claims.
  - `StyleReflector` only produces reviewable suggestions; it does not update the profile automatically.
  - Style suggestions are stored inside the session record under a dedicated field such as `style_update_suggestions`.

### 5. Hermes Adapter Skeleton
- Replace current stubs with a runtime-agnostic compatibility layer:
  - `hermes_adapter.py`
  - `tool_registry.py`
  - `tool_schemas.py`
  - richer `planner.py`
  - richer `responder.py`
- Tool contracts to expose:
  - `search_wiki(query)`
  - `read_page(page_id)`
  - `search_memory(query)`
  - `propose_writeback(query_id)`
  - `run_lint()`
- Tool design decisions:
  - Define typed input/output schemas using Pydantic in `tool_schemas.py`.
  - Register callable implementations in `tool_registry.py`.
  - `HermesAdapter` should expose `list_tools()` and `invoke(tool_name, payload)` APIs.
  - `planner.py` should translate query classification into tool-oriented action plans.
  - `responder.py` should wrap the answer composer output plus citations and any memory/writeback hints.
- Add `TODO(HERMES_PHASE_2_RUNTIME)` only at boundaries where a real Hermes runtime will later attach; do not hardwire any direct dependency on `hermes-agent-main/`.

### 6. Documentation and Repo Rules
- Update `README.md` to document:
  - the Step2 retrieval pipeline
  - session memory and persistent memory files
  - style profile file usage
  - Hermes adapter tool surface
  - optional model-enhancement hook as an internal extension point
- Update `AGENTS.md` only where Step2 changes durable repo behavior:
  - clarify `session memory` vs `persistent memory` write policy
  - state that style updates are suggestion-only and evidence-subordinate
  - add a short rule that tool contracts in the agent layer must remain modular and inspectable
- Add sample memory/profile files:
  - `memory/persistent/profile.json`
  - `memory/persistent/interests.json`
  - `memory/persistent/principles.json`
  - `memory/persistent/open_loops.json`

## Test Plan
- Unit tests:
  - question classification for at least 4 query styles
  - page ranking prefers multiple relevant pages over a single weak match
  - evidence selector preserves page refs and source refs
  - answer planner produces all four required sections
  - memory policy only proposes durable persistent writes
  - style profile loader fallback behavior
  - style engine changes structure without changing evidence payload
  - Hermes tool schema validation and registry dispatch
- Integration tests:
  - `ask` on a query that requires 2+ wiki pages produces multi-page synthesis
  - consecutive related asks reuse session memory and generate follow-up continuity
  - persistent memory files remain unchanged during normal `ask`
  - session JSON and daily summary files are written in the dated layout
  - CLI `ask`, `lint`, and existing Step1 commands remain compatible
  - Hermes adapter tool calls are backed by the same local services used by the CLI
- Golden tests:
  - realistic wiki pages produce answers with `fact / synthesis / interpretation / recommendation`
  - citations include retrieved wiki pages and source refs when present
  - style variants change presentation, not factual content
  - a repeated-topic conversation yields a persistent-memory proposal but no auto-write

## Assumptions and Defaults
- Step2 remains filesystem-first and does not introduce a database, vector store, or external search engine.
- Optional model enhancement is implemented as a provider interface only; no hard dependency on an LLM SDK is required for Step2 completion.
- No new mandatory CLI commands are introduced in this batch.
- Persistent memory acceptance is intentionally deferred from the default user flow; proposals are created automatically but must be explicitly applied later.
- The current real wiki corpus and existing tests are the basis for Step2 golden and integration scenarios, extended with realistic synthetic cases where needed.
