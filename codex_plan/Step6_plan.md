# Interactive Extraction Interview Upgrade Plan

## Summary
- Add a new `Extraction Interview` path beside the existing single-turn `Quick Answer` path. `Quick Answer` stays on `QueryEngine.ask()`; extraction becomes an explicit multi-turn state machine keyed by `interview_id`.
- Keep all extraction logic in the Personal Brain backend. Hermes stays a thin runtime/orchestrator surface over new tool contracts; no domain logic moves into Hermes internals.
- Reuse existing wiki-first retrieval, answer composition, session memory, writeback routing, and asset heuristics wherever possible. Reference posture: [gbrain](https://github.com/garrytan/gbrain) for brain-first compounding flow, [Hermes Agent](https://github.com/nousresearch/hermes-agent) as orchestration boundary only.

## Implementation Changes
- Add `src/personal_brain/extraction/` with the requested six modules plus a small orchestration service (`service.py` or `engine.py`) that runs one interview turn end-to-end.
- `problem_compiler.py`: compile each turn into `current_object`, `knowledge_goal`, `question_type`, `known_slots`, `missing_slots`, and `recommended_action`. Use question-type slot templates:
  - `definition`: `definition`, `scope`, `purpose`, `evidence`
  - `comparison`: `object_a`, `object_b`, `comparison_axes`, `relationship`, `implications`
  - `project-status`: `project`, `current_state`, `blockers`, `evidence`, `next_step`
  - `procedural`: `goal`, `constraints`, `steps`, `examples`, `success_criteria`
  - `open-ended-synthesis`: `object`, `knowledge_goal`, `key_claims`, `supporting_evidence`, `open_questions`
- `retrieval_planner.py`: build four explicit buckets per turn:
  - `object_pages`: wiki pages matching the current object and linked object pages
  - `evidence_pages`: pages/snippets ranked against the knowledge goal and highest-priority missing slots
  - `conversation_hits`: prior turns from the same `interview_id`, then related session summaries from `MemoryRecall`
  - `pattern_hits`: reusable patterns from `wiki/principles/`, `wiki/decisions/`, `skills/candidates/`, and current method/profile hints
- `question_plan_builder.py`: always build a `QuestionPlan` before asking a follow-up. Return `next_question_type`, `candidate_questions`, `target_missing_slots`, and `stop_if`. Candidate questions should be template-driven from the top 1-2 missing slots, not free-generated first.
- `stopping_criteria.py`: stop when any of these is true: user explicitly says enough/done, no high-priority missing slots remain, two consecutive turns add no new slots and no new evidence pages, or max turns (default `5`) is reached.
- `state_tracker.py`: persist inspectable state to `memory/session/extraction/<date>/<interview_id>.json` plus a daily summary file. Track root question, turn list, compiled problem snapshots, slot coverage, latest answer, next question plan, stop decision, and staged writeback.
- `writeback_stager.py`: produce three layered outputs from the interview state:
  - `session-level`: interview summary and slot state written each turn
  - `knowledge-level`: proposal-first wiki `WritebackBundle` preview once synthesis is stable
  - `asset-level`: preview-only ontology/skill candidate payloads when the interview shows durable reusable structure; do not write into `ontology/candidates/` or `skills/candidates/` directly in this phase
- Run existing `MemoryPolicy.propose()` only on terminal extraction turns and attach the proposals to interview state; do not auto-write persistent memory files.
- Extend `AnswerRecord` and `SessionRecord` with additive optional fields: `interaction_mode`, `interview_id`, `turn_index`, `is_terminal_turn`, and `projected_writeback_level`. Existing asset builders/eval flows must ignore non-terminal extraction turns.
- Keep `QueryEngine` as the quick-answer orchestrator. Only extract shared helpers if needed; do not turn it into the extraction engine.

## Public APIs, Tools, and UI Contract
- Keep `POST /api/ask` as the `Quick Answer` backend.
- Add extraction endpoints in `apps/api/server.py` and `WorkbenchApiService`:
  - `POST /api/extraction/interviews` to start an interview from the initial question
  - `GET /api/extraction/interviews/{interview_id}` to load current state
  - `POST /api/extraction/interviews/{interview_id}/turns` to submit the next user answer
  - `POST /api/extraction/interviews/{interview_id}/finish` to force stopping and stage final writeback
- Return an `ExtractionInterviewState` shaped for Ask Workspace:
  - `interview_id`, `status`, `turn_index`
  - `current_object`, `current_knowledge_goal`
  - `known_slots`, `missing_slots`
  - `current_answer_sections`, `current_answer_markdown`
  - `retrieval_buckets`
  - `next_question_plan`
  - `stopping_decision`
  - `projected_writeback_level`
  - `staged_writeback`
- Extend `src/personal_brain/agent/tool_schemas.py`, `tool_registry.py`, and `hermes_adapter.py` with thin wrappers only:
  - `start_extraction_interview`
  - `get_extraction_interview`
  - `continue_extraction_interview`
  - `finish_extraction_interview`
- Add a minimal CLI surface for local testing/debugging, ideally an `extract` command group with `start`, `reply`, `status`, and `finish`.
- Update Ask Workspace mock/API contract docs so the frontend can render two modes: `Quick Answer` and `Extraction Interview`. This phase is API-contract-first, not full Vue workbench implementation.

## Test Plan
- Unit tests for `problem_compiler` slot templates, action selection, and missing-slot prioritization.
- Unit tests for `retrieval_planner` confirming all four buckets are populated from the correct layers and that `conversation_hits` prefer the active interview over generic memory recall.
- Unit tests for `question_plan_builder` confirming candidate questions target missing slots instead of echoing the last user message.
- Unit tests for `stopping_criteria` covering explicit stop, slot coverage stop, stagnation stop, and max-turn stop.
- Unit tests for `writeback_stager` covering session-only, knowledge-level, and asset-level staging with proposal-first behavior preserved.
- API tests for the four new extraction endpoints and backward compatibility of `/api/ask`.
- Hermes adapter tests confirming the new tools are listed and invoke correctly without embedding extraction logic in Hermes.
- Integration test for a 3-5 turn extraction interview where state persists by `interview_id`, known slots accumulate, next-question candidates narrow missing slots, and the final turn stages layered writeback.
- Regression test confirming non-terminal extraction turns do not pollute existing asset builders, writeback apply flow, or current eval/report generation.
- Golden test for a representative domain interview showing progressive slot filling, better next-best questions, and a higher projected writeback level by the final turn.

## Assumptions and Defaults
- This phase is `API 合同优先`: backend, models, storage, Hermes tool contracts, and mock-schema/docs change now; a full Vue Ask Workspace implementation is out of scope.
- Multi-turn extraction uses an explicit server-generated `interview_id`; hidden implicit chaining is not the primary path.
- Session-level state is auto-written. Knowledge-level and asset-level remain preview/staging oriented and are not auto-applied to wiki, ontology, or production skills.
- `pattern_hits` stay on stable inspectable layers only; no raw transcript dumping and no Hermes-managed memory substituting for wiki-grounded retrieval.
- Existing quick-answer behavior, current writeback CLI/API, and current Step2/Step3 durable asset pipeline remain backward compatible.

# Step6 合并版升级计划

## Summary
- 以 `.cursor` 计划作为上位路线图，以当前 Step6 实施方案作为可落地执行切片。
- 先补“场景/slot 契约 + 只读加载”，再落 `Extraction Interview` 多轮状态机；`Quick Answer` 保持兼容。
- Hermes 只接 Personal Brain 暴露出的 extraction tools/contracts，不承载领域规则。

## Key Changes
- 新增 `src/personal_brain/extraction/`：
  - `problem_compiler.py`
  - `retrieval_planner.py`
  - `question_plan_builder.py`
  - `state_tracker.py`
  - `stopping_criteria.py`
  - `writeback_stager.py`
- `ProblemCompiler` 的槽位来源采用双层机制：
  - 优先读取 `ontology/scenes/<scene_id>/slots.json` 这类场景化 slot schema
  - 无场景命中时退回 question-type 通用 slot 模板
- 新增显式 `interview_id` 多轮会话，持久化到 `memory/session/extraction/<date>/<interview_id>.json`
- 新增 extraction API/contracts：
  - `POST /api/extraction/interviews`
  - `GET /api/extraction/interviews/{interview_id}`
  - `POST /api/extraction/interviews/{interview_id}/turns`
  - `POST /api/extraction/interviews/{interview_id}/finish`
- Ask Workspace 本阶段只锁定双模式 API 合同：
  - `Quick Answer`
  - `Extraction Interview`
- `Quick Answer` 继续走现有 `QueryEngine.ask()`；后续可选接入 SceneContext/Harness，但不是 Step6 v1 阻塞项。
- `WritebackStager` 产出三层暂存结果：
  - session-level
  - knowledge-level
  - asset-level
- Hermes adapter/tool registry 扩展 extraction tools，但不迁移任何 compiler/planner/writeback 规则进入 Hermes。

## Test Plan
- 单元测试覆盖：
  - scene slot schema 加载与 fallback
  - 四桶检索
  - `QuestionPlan` 先行约束
  - 停判逻辑
  - 三层 writeback staging
- API/集成测试覆盖：
  - 多轮 `interview_id` 会话
  - 状态累积与缺槽收敛
  - 结束时 staged writeback 生成
  - `/api/ask` 与现有 writeback/asset/eval 流程不回归
- Hermes adapter 测试覆盖：
  - 新 tools 可列出、可调用
  - 领域逻辑仍留在 Personal Brain backend

## Assumptions
- 场景三表与 slot schema 是长期正确方向，但 Extraction v1 不等待完整场景库齐备；允许单场景试点 + 通用 fallback。
- 本阶段以前后端契约为主，不把真实 Vue Workbench 实现纳入阻塞路径。
- asset-level 仍是 proposal/staging，不直接写生产 ontology 或正式 skills。
