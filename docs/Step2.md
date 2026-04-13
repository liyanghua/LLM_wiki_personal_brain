Continue from the existing Batch 1 implementation of Personal Brain OS.

Current status:
- raw -> wiki -> query -> lint -> writeback proposal pipeline is working
- repo skeleton, CLI, pydantic models, tests, README, and Hermes Phase 2 TODO placeholders already exist
- real raw corpus has already produced meaningful wiki pages and writeback proposals

Now implement Batch 2 with the goal of upgrading the system from a basic LLM Wiki engine into a Hermes-ready personal brain query and memory layer.

## Batch 2 goals

### A. Query quality upgrade
Refactor query flow into:
- question classification
- candidate page retrieval
- page ranking
- evidence selection
- answer planning
- answer composition

Add modules:
- src/personal_brain/retrieval/question_classifier.py
- src/personal_brain/retrieval/page_ranker.py
- src/personal_brain/retrieval/evidence_selector.py
- src/personal_brain/retrieval/answer_planner.py
- src/personal_brain/retrieval/answer_composer.py

Requirements:
- answers should synthesize multiple wiki pages when needed
- answers should distinguish fact / synthesis / interpretation / recommendation
- answers should cite retrieved wiki pages and source refs when available
- preserve current CLI compatibility

### B. Session memory and persistent memory
Implement minimal memory layer:
- session memory: recent query summaries, retrieved pages, open follow-up questions
- persistent memory: stable interests, preferences, recurring topics, accepted principles

Suggested paths:
- memory/session/<date>/<query_id>.json
- memory/session/summaries/<date>.md
- memory/persistent/profile.json
- memory/persistent/interests.json
- memory/persistent/principles.json
- memory/persistent/open_loops.json

Add modules:
- src/personal_brain/agent/session_manager.py
- src/personal_brain/agent/memory_writer.py
- src/personal_brain/agent/memory_recall.py
- src/personal_brain/agent/memory_policy.py

Requirements:
- memory writes must be conservative
- do not store every answer
- separate short-lived session memory from durable memory

### C. Personal style profile
Implement a lightweight style/profile layer that influences answer presentation but does not distort grounding.

Add modules:
- src/personal_brain/agent/style_engine.py
- src/personal_brain/agent/style_reflector.py
- src/personal_brain/agent/style_profile_loader.py

Profile dimensions should include:
- preferred answer structure
- abstraction level
- actionability preference
- citation preference
- favored output forms
- reuse preference

Requirements:
- style should affect expression and structure
- style must not override evidence
- profile updates should be reviewable and conservative

### D. Hermes adapter skeleton
Do not fully integrate Hermes runtime yet.
Instead, create a compatibility layer with clear tool contracts.

Add modules:
- src/personal_brain/agent/hermes_adapter.py
- src/personal_brain/agent/tool_registry.py
- src/personal_brain/agent/tool_schemas.py
- src/personal_brain/agent/planner.py
- src/personal_brain/agent/responder.py

Expose tools such as:
- search_wiki(query)
- read_page(page_id)
- search_memory(query)
- propose_writeback(query_id)
- run_lint()

Requirements:
- keep adapter modular
- do not tightly couple Batch 2 to any single runtime
- add TODO(HERMES_PHASE_2_RUNTIME) markers where real runtime integration will happen later

## Testing requirements

Add new tests for:
- multi-page answer synthesis
- session memory write behavior
- persistent memory write policy
- style profile loading and application
- Hermes adapter tool schema validity

Create at least:
- unit tests
- integration tests
- golden tests using real or realistic wiki pages

## Constraints

- preserve raw/wiki/ontology/memory separation
- do not introduce online self-modifying code
- prefer markdown/json local files over databases
- keep CLI working
- keep code modular and typed
- favor stable, inspectable behavior over cleverness

## Deliverables

1. upgraded retrieval pipeline
2. minimal memory layer
3. style/profile layer
4. Hermes adapter skeleton
5. updated README
6. updated AGENTS.md if needed
7. new tests
8. sample memory/profile files