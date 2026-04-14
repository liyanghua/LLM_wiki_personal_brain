Build an Interactive Extraction Agent mode on top of the existing Personal Brain OS and Hermes-ready backend.

Goal:
Turn the system from a passive QA engine into a progressive extraction agent that can ask the next best question, accumulate context over several turns, and write back knowledge at multiple levels.

## 参考项目
### https://github.com/garrytan/gbrain
### https://github.com/nousresearch/hermes-agent, 本地代码：./hermes-agent-main

## Core flow
user question
→ problem compiler
→ retrieval planner
→ answer planner
→ answer + next-question candidates
→ user answer
→ state tracker update
→ repeat
→ stopping criteria met
→ layered writeback

## Add new modules
- src/personal_brain/extraction/problem_compiler.py
- src/personal_brain/extraction/question_plan_builder.py
- src/personal_brain/extraction/state_tracker.py
- src/personal_brain/extraction/stopping_criteria.py
- src/personal_brain/extraction/retrieval_planner.py
- src/personal_brain/extraction/writeback_stager.py

## Problem compiler responsibilities
It should determine:
- current object
- current knowledge goal
- current question type
- known slots
- missing slots
- whether to answer, ask follow-up, retrieve more, or write back

## Retrieval planner responsibilities
It should retrieve four buckets:
- object pages
- evidence pages
- conversation hits
- pattern hits

## Next-question planning
Do not directly free-generate a question first.
First generate a QuestionPlan with:
- next_question_type
- candidate_questions
- target_missing_slots
- stop_if conditions

## Layered writeback
Implement three writeback levels:
1. session-level
2. knowledge-level
3. asset-level

## Frontend
Add a new mode in Ask Workspace:
- Quick Answer
- Extraction Interview

In Extraction Interview mode, show:
- current object
- current knowledge goal
- known vs missing slots
- current answer
- next question candidates
- projected writeback level

## Hermes integration
Use Hermes as runtime/orchestrator only.
Do not move domain logic into Hermes internals.
Keep extraction logic in the Personal Brain backend, expose it as tools/contracts.

## Success criteria
- the agent can ask progressive next-best questions
- problem analysis is more explicit and inspectable
- retrieval is split into multiple retrieval buckets
- after multiple turns, the system can produce layered writeback
- the system becomes better at extracting reusable knowledge, not just answering once