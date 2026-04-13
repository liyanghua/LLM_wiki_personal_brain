# AGENTS.md

This repository is a Personal Brain OS.
It is not a generic chatbot project, and it is not a plain document store.

The system is designed to compound knowledge over time through four layers:

1. raw sources
2. curated wiki
3. structured ontology and memory assets
4. agent runtime and reusable skills

All coding agents and knowledge agents working in this repository must preserve these layer boundaries.

---

## 1. Repository Mission

The repository exists to help the user build a personal brain that can:

- ingest personal and domain knowledge sources
- compile them into a living wiki
- answer questions using the wiki as the primary knowledge layer
- propose durable write-backs from high-value answers
- gradually form ontology, memory, style, and skills assets
- remain compatible with future Hermes Agent integration

This repository must optimize for:
- continuity
- traceability
- human readability
- groundedness
- reusability
- evolvability

---

## 2. Layer Model

### Layer A: Raw Sources
Location:
- `raw/`

Purpose:
- store original source materials
- preserve provenance and original meaning
- act as the factual base layer

Rules:
- raw is append-only
- never overwrite raw content with summaries
- preserve source path, file type, ingest time, and checksum
- parsing failures must be logged, not silently discarded
- raw content may be normalized for encoding issues, but not semantically rewritten

Examples:
- markdown notes
- txt notes
- doc/docx files
- meeting notes
- industry writeups
- source excerpts

---

### Layer B: Curated Wiki
Location:
- `wiki/`

Purpose:
- serve as the primary human-readable knowledge layer
- organize knowledge into stable pages
- connect ideas across documents, projects, topics, decisions, and principles

Rules:
- prefer updating existing pages over creating duplicates
- every durable factual claim should include `source_refs` when possible
- maintain `wiki/index.md`
- append all major changes to `wiki/log.md`
- wiki pages should be readable by humans first
- wiki pages should preserve uncertainty explicitly
- wiki pages should not become raw dumps

The wiki is the main retrieval and answer composition layer.

---

### Layer C: Ontology / Memory Assets
Locations:
- `ontology/`
- `memory/`

Purpose:
- hold normalized, machine-usable assets derived from the wiki
- support future structured retrieval, profile personalization, and agent memory

Rules:
- ontology is derived primarily from wiki, not raw-only
- only stable concepts should be promoted into ontology
- session memory must be separated from persistent memory
- style profile changes must be conservative and reviewable
- do not objectify one-off thoughts too early

Examples:
- ontology objects
- relations
- rules
- style profile
- evidence indexes
- persistent user facts
- reusable skills memory

---

### Layer D: Agent Runtime / Skills
Locations:
- `src/personal_brain/agent/`
- `skills/`

Purpose:
- provide the runtime layer for query, recall, response composition, and write-back proposal
- prepare for Hermes-compatible integration later

Rules:
- keep agent runtime modular
- do not hardcode all logic into prompts
- reusable procedures should be skillized
- every skill must live in its own folder
- every skill should be understandable by humans and usable by agents
- tool contracts should stay typed, inspectable, and runtime-agnostic

---

## 3. Core Operating Principles

### 3.1 Preserve separation of concerns
Do not mix:
- raw with wiki
- wiki with transient chat outputs
- ontology with speculative ideas
- session memory with persistent memory

### 3.2 Prefer durable structure over ad hoc shortcuts
If a logic pattern repeats, promote it into:
- a wiki convention
- a skill
- a schema
- or a reusable utility module

### 3.3 Human-readable first
This repository is meant to be inspectable and maintainable by a human.
Do not optimize exclusively for machine convenience.

### 3.4 Groundedness over style
The system may gradually reflect the user’s personal style, but style must never distort evidence.
Answers must remain grounded in wiki pages and sources.

---

## 4. File Creation and Update Rules

Before creating any new page or file:
1. search for an existing relevant file
2. update it if scope matches
3. create a new file only if the concept is truly distinct
4. add links from index or parent pages

Avoid:
- duplicate pages with slightly different names
- dumping large source excerpts into wiki without synthesis
- promoting every answer into durable memory
- one-off speculative ontology objects

---

## 5. Ingestion Rules

Agents responsible for ingestion must:

- classify input file type
- store or copy source into an appropriate `raw/` subdirectory
- compute checksum
- record metadata
- parse content into normalized text
- identify candidate wiki pages to update
- update `wiki/log.md` with an append-only entry

If parsing fails:
- preserve the original file
- create an error record
- do not silently skip the file

---

## 6. Wiki Rules

Wiki pages should be organized under:

- `wiki/entities/`
- `wiki/topics/`
- `wiki/projects/`
- `wiki/decisions/`
- `wiki/principles/`
- `wiki/timelines/`
- `wiki/sources/`

Every important wiki page should ideally include:
- page id
- page type
- title
- summary
- source refs
- links to related pages
- updated timestamp

Preferred behavior:
- consolidate first
- keep pages scoped
- use source references
- preserve open questions
- mark uncertainty when evidence is incomplete

---

## 7. Query and Answer Rules

When answering a question:

1. start from `wiki/index.md`
2. identify candidate wiki pages
3. read the most relevant wiki pages
4. trace back to raw sources when needed
5. produce a grounded answer
6. store an `AnswerRecord`
7. decide whether write-back should be proposed

Answers should distinguish:
- fact
- summary
- interpretation
- recommendation

Do not present interpretation as confirmed fact.

---

## 8. Write-back Rules

Write-back is selective, not default.

Only propose write-back if the answer has durable value, such as:
- a stable explanation
- a reusable principle
- a meaningful project conclusion
- a repeated pattern worth keeping
- a decision with future relevance

Write-back targets may include:
- `wiki/decisions/`
- `wiki/principles/`
- `wiki/topics/`

Do not write back:
- trivial answers
- low-confidence speculation
- transient small talk
- repeated content with no new value

---

## 9. Lint Rules

Lint should inspect for:
- orphan wiki pages
- stale wiki pages
- missing source refs
- duplicate or near-duplicate pages
- missing cross-links
- important pages not represented in index
- ontology objects with weak or missing wiki linkage

Lint output should be actionable and explainable.

---

## 10. Ontology Promotion Rules

Only promote wiki content into ontology when:

- the concept is stable
- the naming is reasonably canonical
- core attributes are identifiable
- evidence exists
- future reuse is likely

Separate:
- object
- relation
- rule
- profile
- evidence mapping

Do not create ontology objects for:
- fleeting thoughts
- vague brainstorm fragments
- unstable page titles
- weakly supported interpretations

---

## 11. Memory Rules

Memory must be treated carefully.

### Session memory
Use for:
- recent context
- active conversation continuity
- near-term temporary information

Rules:
- may be written automatically for grounded query continuity
- should store concise summaries, retrieved pages, and open follow-up questions
- should remain easy for a human to inspect and reset

### Persistent memory
Use for:
- durable user preferences
- long-term interests
- stable facts explicitly supported

Rules:
- persistent writes must be conservative and reviewable
- do not persist every answer or every repeated topic
- prefer proposal-first promotion over silent automatic writes

### Skills memory
Use for:
- repeatable ways of solving tasks
- response patterns worth reusing
- learned workflows

Style profile updates:
- must be conservative
- should be reviewable
- must not infer sensitive attributes unnecessarily
- should default to suggestion/proposal mode unless explicitly accepted

---

## 12. Skill Rules

Every skill should live in its own folder under `skills/`.

Each skill should ideally include:
- `SKILL.md`
- `input_schema.json`
- `output_schema.json`
- examples

Skills should be:
- reusable
- explicit
- inspectable
- decoupled from core runtime logic

Prefer optimizing skills before optimizing core architecture.

---

## 13. Evolution Rules

Online self-modification of core code is forbidden.

Future evolution is allowed only as an offline, reviewable workflow.

Evolution may propose changes to:
- skill files
- tool descriptions
- answer templates
- memory write heuristics

Evolution must not auto-merge changes into the main branch.

Any evolved proposal should pass:
- automated tests
- semantic-preservation checks where applicable
- human review

---

## 14. Code Quality Rules

All coding agents should aim for:

- Python 3.11+
- type annotations where practical
- modular design
- readable naming
- explicit error handling
- minimal hidden side effects
- clear TODO markers for future Hermes integration

Avoid:
- giant god files
- silent exception swallowing
- unclear filesystem mutations
- tightly coupling ingestion, retrieval, answering, and memory writing

---

## 15. Testing Expectations

Batch 1 should include tests for:
- source ingestion
- wiki compilation
- query routing
- answer record creation
- lint checks
- write-back proposal behavior

Use:
- unit tests
- integration tests
- stable fixtures where possible

Prefer deterministic behavior where reasonable.

---

## 16. Preferred Implementation Strategy

Implement in phases:

### Batch 1
- raw ingestion
- wiki build/update
- index/log maintenance
- query over wiki
- write-back proposal
- lint

### Batch 2
- Hermes adapter
- memory integration
- better retrieval
- style profile usage

### Batch 3
- ontology enrichment
- skillization
- offline evolution
- evaluation harness

Do not prematurely optimize for Batch 3 in Batch 1.

---

## 17. Final Principle

This repository is not meant to accumulate documents.
It is meant to compile knowledge into a usable personal brain.

The correct direction is:

raw sources
→ curated wiki
→ structured ontology and memory
→ agent runtime
→ durable write-back
→ gradual skill and style evolution


---

## 18. Batch 2 Addendum: Query Quality, Memory, Style, and Hermes Readiness

Batch 2 extends the Personal Brain OS from a working LLM Wiki baseline into a higher-quality query and memory system.

The main goal of Batch 2 is not to add more surface area.
The main goal is to improve the quality of reasoning, continuity, and personalization while preserving grounding and architectural boundaries.

Batch 2 adds four major concerns:

1. query quality upgrade
2. session and persistent memory
3. personal style/profile layer
4. Hermes adapter skeleton

All agents working on Batch 2 must follow the rules below.

---

### 18.1 Query Quality Upgrade Rules

The query system must no longer behave like a single-page summarizer.
It should behave like a wiki-aware synthesis engine.

Required internal stages:

1. question classification
2. candidate page retrieval
3. page ranking
4. evidence selection
5. answer planning
6. answer composition

Rules:

- answers must synthesize across multiple relevant wiki pages when needed
- answers must not simply concatenate page summaries
- page retrieval should prefer the wiki layer before falling back to raw materials
- raw materials may be consulted for factual clarification, not as the default answer layer
- every answer should distinguish among:
  - fact
  - synthesis
  - interpretation
  - recommendation
- uncertainty should be made explicit when evidence is incomplete or conflicting
- conflicting evidence should not be flattened prematurely
- answer planning should be inspectable and testable
- evidence spans should be selected intentionally, not by naive truncation

Preferred behavior:

- start from `wiki/index.md`
- identify likely relevant pages
- rank pages by relevance to the question and answer intent
- extract supporting evidence from those pages
- compose a structured answer
- record what was used in an `AnswerRecord`

Forbidden behavior:

- bypassing wiki entirely for normal questions
- answering from memory only when the wiki has better grounding
- presenting low-confidence synthesis as confirmed fact
- silently ignoring contradictions

---

### 18.2 Session Memory Rules

Session memory is for short-horizon continuity within or near the current interaction context.

Session memory may store:

- recent query summaries
- retrieved page ids
- recent answer summaries
- open follow-up questions
- active themes in the current session

Session memory must not be treated as durable knowledge.

Rules:

- session memory must be short-lived and scoped
- it should help follow-up questions, not replace retrieval
- it must be possible to inspect what was written and why
- every session memory write should include timestamp and source query id
- session memory should prefer summaries over raw transcript duplication
- session memory should not become an unbounded dump of conversation fragments

Preferred storage examples:

- `memory/session/<date>/<query_id>.json`
- `memory/session/summaries/<date>.md`

Forbidden behavior:

- storing every answer in full by default
- writing speculative long-term claims into session memory
- using session memory as a substitute for wiki updates

---

### 18.3 Persistent Memory Rules

Persistent memory is for durable user-relevant facts, stable interests, accepted principles, and recurring preferences.

Persistent memory may store:

- stable interests
- recurring topics
- preferred answer structure
- accepted long-term principles
- persistent open loops worth tracking
- durable user preferences explicitly supported by repeated evidence

Persistent memory must be conservative.

Rules:

- do not write to persistent memory unless durability is likely
- repeated evidence is preferred over one-off evidence
- persistent memory writes must be reviewable
- every persistent memory update should record rationale
- memory entries should be concise, canonical, and easy to inspect
- persistent memory should help answer routing and style selection, not invent user identity

Preferred files:

- `memory/persistent/profile.json`
- `memory/persistent/interests.json`
- `memory/persistent/principles.json`
- `memory/persistent/open_loops.json`

Forbidden behavior:

- storing trivial one-off preferences
- inferring sensitive personal attributes without explicit user grounding
- writing speculative claims as long-term facts
- duplicating large wiki content into persistent memory

---

### 18.4 Memory Write Policy Rules

Memory writes must follow explicit policy.

Every candidate memory write should answer:

1. is this stable?
2. is this likely to be useful later?
3. is this supported by sufficient evidence?
4. should this go to session memory, persistent memory, wiki, or nowhere?

Priority order:

- if knowledge is durable and broadly useful, prefer wiki
- if it is user-specific and stable, prefer persistent memory
- if it is only relevant to recent context, prefer session memory
- if it lacks long-term value, do not store it

Memory policies should be implemented as explicit code, not hidden in prompts.

---

### 18.5 Personal Style Profile Rules

The style/profile layer exists to shape expression and structure, not to weaken grounding.

Style profile may influence:

- preferred answer shape
- abstraction level
- actionability level
- citation preference
- favored output forms
- reuse preference
- explanation granularity

Style profile must not influence:

- factual correctness
- source integrity
- confidence calibration
- whether evidence is required

Rules:

- style should be applied after grounding, not before
- style should refine presentation, not rewrite meaning
- style updates must be conservative and reviewable
- repeated behavioral signals should matter more than isolated examples
- style extraction should focus on answer structure and reasoning preferences, not superficial mimicry

Preferred examples of style features:

- concise vs layered
- abstract vs operational
- mapping-table preference
- architecture-first preference
- decision-first preference
- preference for reusable outputs

Forbidden behavior:

- imitating tone at the expense of accuracy
- using style as a reason to omit evidence
- making unsupported claims feel more “personal”
- overfitting the system to a few samples

---

### 18.6 Style Reflection Rules

Style reflection is an observational subsystem, not an uncontrolled self-rewrite subsystem.

Style reflection may:

- analyze answer patterns
- summarize recurring structural preferences
- propose profile updates
- suggest new answer templates

Style reflection must not:

- auto-rewrite the main code path
- silently overwrite profile.json
- degrade grounded answer behavior

Every style update proposal should include:

- what changed
- why it changed
- what evidence supports it
- whether review is required

---

### 18.7 Hermes Adapter Rules

Batch 2 should prepare for Hermes compatibility without tightly coupling the repository to any one runtime.

The Hermes adapter layer should expose stable internal tools such as:

- `search_wiki(query)`
- `read_page(page_id)`
- `search_memory(query)`
- `propose_writeback(query_id)`
- `run_lint()`

Rules:

- the adapter should wrap internal functionality, not duplicate it
- tool schemas should be explicit and testable
- planner and responder logic should remain modular
- real runtime integration should be marked clearly with TODOs
- the adapter layer must not hardwire the rest of the repository to Hermes internals yet

Preferred design:

- repository core remains runtime-agnostic
- Hermes adapter is a compatibility boundary
- future runtime integration happens through that boundary

Forbidden behavior:

- putting core retrieval logic inside the Hermes adapter
- mixing runtime-specific assumptions into wiki/memory modules
- introducing hidden dependencies that make local CLI behavior diverge from adapter behavior

---

### 18.8 Write-back Rules for Batch 2

Batch 2 write-back should become more selective and more explainable.

Every write-back proposal should include:

- why write-back is proposed
- target destination
- expected long-term value
- confidence level
- supporting page ids
- supporting source refs if available

Write-back may target:

- `wiki/decisions/`
- `wiki/principles/`
- `wiki/topics/`
- future ontology candidates

Rules:

- answers with durable value should be proposed for write-back
- write-back should be based on synthesis quality, not just answer length
- repeated insights are stronger write-back candidates than one-off observations
- write-back proposals should remain inspectable and reversible

Forbidden behavior:

- promoting every “good sounding” answer
- conflating session continuity with durable knowledge
- auto-overwriting existing wiki pages without clear merge logic

---

### 18.9 Testing Rules for Batch 2

Batch 2 requires stronger tests than Batch 1 because the system is now synthesizing, remembering, and shaping style.

At minimum, tests should cover:

- multi-page answer synthesis
- evidence selection behavior
- session memory write behavior
- persistent memory write policy
- style profile loading and application
- style update proposal behavior
- Hermes adapter tool schema validity
- write-back proposal quality and destination selection

Golden tests are strongly encouraged for:

- representative real questions
- representative wiki pages
- representative follow-up sessions
- representative write-back proposals

Rules:

- answer tests should check structure, not only string equality
- memory tests should check both what is stored and what is intentionally not stored
- style tests should check controlled influence, not full output mimicry
- adapter tests should verify contract stability

---

### 18.10 Preferred Batch 2 Development Order

Batch 2 should be implemented in this order unless there is a strong reason not to:

1. query quality upgrade
2. session memory
3. persistent memory policy
4. style profile application
5. Hermes adapter skeleton
6. additional tests and goldens

Reason:
- low-quality answers should not feed memory
- weak memory policy should not feed style
- unstable query and memory modules should not be hidden behind runtime adapters too early

---

### 18.11 Final Batch 2 Principle

Batch 2 is successful when the system feels more like a personal brain without becoming less grounded.

The correct direction is:

better wiki-aware synthesis
→ careful short-term continuity
→ conservative long-term memory
→ style-aware presentation
→ runtime-ready tool boundaries

Not:

more complexity
→ more automation
→ more memory writes
→ more personality
