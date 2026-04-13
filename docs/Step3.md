Continue from the existing Batch 2 implementation of Personal Brain OS.

Current status:
- multi-stage wiki-aware query pipeline is implemented
- answers are structured as Fact / Synthesis / Interpretation / Recommendation / Citations
- session memory writes are working
- persistent memory only creates proposals, not direct commits
- style/profile and Hermes adapter skeleton are in place
- tests currently pass and real raw/wiki corpus is already being used

Now implement Step 3 with the goal of turning the system from a Hermes-ready query engine into a true personal brain asset production system.

## Step 3 goals

### A. Upgrade writeback into a durable knowledge pipeline
Current writeback is proposal-oriented.
Now implement a structured writeback router and merge flow.

The system should classify high-value answers into one or more targets:
- wiki/decisions/
- wiki/principles/
- wiki/topics/ incremental updates
- ontology/candidates/
- skills/candidates/

Add modules such as:
- src/personal_brain/writeback/router.py
- src/personal_brain/writeback/merger.py
- src/personal_brain/writeback/quality_gate.py
- src/personal_brain/writeback/target_selector.py

Requirements:
- not every good answer should be written back
- writeback must explain target, rationale, confidence, and expected long-term value
- existing wiki pages must be updated via merge logic, not naive overwrite
- add TODO markers for future human approval workflow

### B. Upgrade style profile into method profile
Current style profile is mainly presentation-oriented.
Now extend it into a personal method profile.

The system should model:
- preferred answer structure
- preferred abstraction depth
- preferred operationalization level
- tendency to produce mappings, object models, roadmaps, and schemas
- preferred decision-first vs concept-first explanation pattern
- preference for turning answers into reusable assets

Add modules such as:
- src/personal_brain/agent/method_profile.py
- src/personal_brain/agent/method_reflector.py
- src/personal_brain/agent/template_selector.py

Requirements:
- the system should adapt structure more than tone
- method profile updates should remain conservative and reviewable
- answers should become more aligned with the user's thinking grammar, not just tone

### C. Build minimal ontology extraction chain from wiki
Do not build a full knowledge graph.
Instead implement a minimal ontology candidate extraction flow for:
- Topic
- Concept
- Project
- Decision
- Principle
- Evidence

Add modules such as:
- src/personal_brain/ontology/candidate_extractor.py
- src/personal_brain/ontology/canonicalizer.py
- src/personal_brain/ontology/evidence_linker.py
- src/personal_brain/ontology/promotion_policy.py

Requirements:
- ontology objects should come from wiki, not raw-only
- only stable concepts should be promoted
- every ontology candidate must link back to wiki pages and source refs
- keep output inspectable as local json/yaml files

### D. Skill candidate generation
Turn repeated high-value answer/work patterns into candidate skills.

Examples:
- topic synthesis
- decision extraction
- principle distillation
- project context refresh
- concept comparison table generation

Add modules such as:
- src/personal_brain/skills/candidate_generator.py
- src/personal_brain/skills/skill_packager.py
- src/personal_brain/skills/promotion_policy.py

Requirements:
- generate candidate skill folders, not final auto-approved skills
- every candidate skill should include SKILL.md, input schema, output schema, and examples
- use repeated successful answer patterns as the source

### E. Evaluation harness for personal brain quality
Add evaluation beyond unit tests.

Implement evaluation categories:
- answer asset value
- writeback precision
- memory precision
- method/style consistency
- ontology candidate quality
- skill candidate usefulness

Add modules such as:
- src/personal_brain/eval/asset_value.py
- src/personal_brain/eval/writeback_precision.py
- src/personal_brain/eval/method_consistency.py
- src/personal_brain/eval/ontology_quality.py
- src/personal_brain/eval/skill_candidate_quality.py

Requirements:
- use golden cases from real questions
- keep reports human-readable
- avoid overfitting to one or two examples

## Constraints

- preserve raw / wiki / ontology / memory / skills separation
- do not introduce online self-modifying code
- prefer markdown/json/yaml local files
- keep CLI usable
- keep Hermes adapter as a boundary layer, not the new core
- optimize for durable asset production, not just more fluent answers

## Deliverables

1. writeback router and merge flow
2. method profile layer
3. ontology candidate extraction chain
4. skill candidate generation
5. evaluation harness for personal brain quality
6. updated README
7. updated AGENTS.md if needed
8. sample ontology/skill candidates generated from the real corpus

## 硬性要求：

1. Step 3 的核心不是“回答更长”，而是“资产沉淀更稳定”
2. 所有 ontology candidate 和 skill candidate 都必须可追溯回 wiki 页面
3. method profile 要优先刻画“结构与方法”，而不是模仿语气
4. writeback 必须有 merge/update 逻辑，不能简单新增文件
5. 评测要覆盖“值不值得沉淀”，而不只是“代码能不能运行”