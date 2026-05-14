export interface WikiTemplate {
  id: string
  name: string
  description: string
  icon: string
  schema: string
  purpose: string
  extraDirs: string[]
}

const BASE_SCHEMA_TYPES = `| entity | wiki/entities/ | Named things (people, tools, organizations, datasets) |
| concept | wiki/concepts/ | Ideas, techniques, phenomena, frameworks |
| source | wiki/sources/ | Papers, articles, talks, books, blog posts |
| query | wiki/queries/ | Open questions under active investigation |
| comparison | wiki/comparisons/ | Side-by-side analysis of related entities |
| synthesis | wiki/synthesis/ | Cross-cutting summaries and conclusions |
| overview | wiki/ | High-level project summary (one per project) |`

const BASE_NAMING = `- Files: \`kebab-case.md\`
- Entities: match official name where possible (e.g., \`openai.md\`, \`gpt-4.md\`)
- Concepts: descriptive noun phrases (e.g., \`chain-of-thought.md\`)
- Sources: \`author-year-slug.md\` (e.g., \`wei-2022-cot.md\`)
- Queries: question as slug (e.g., \`does-scale-improve-reasoning.md\`)`

const BASE_FRONTMATTER = `All pages must include YAML frontmatter:

\`\`\`yaml
---
type: entity | concept | source | query | comparison | synthesis | overview
title: Human-readable title
tags: []
related: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
\`\`\`

Source pages also include:
\`\`\`yaml
authors: []
year: YYYY
url: ""
venue: ""
\`\`\``

const BASE_INDEX_FORMAT = `\`wiki/index.md\` lists all pages grouped by type. Each entry:
\`\`\`
- [[page-slug]] — one-line description
\`\`\``

const BASE_LOG_FORMAT = `\`wiki/log.md\` records activity in reverse chronological order:
\`\`\`
## YYYY-MM-DD

- Action taken / finding noted
\`\`\``

const BASE_CROSSREF = `- Use \`[[page-slug]]\` syntax to link between wiki pages
- Every entity and concept should appear in \`wiki/index.md\`
- Queries link to the sources and concepts they draw on
- Synthesis pages cite all contributing sources via \`related:\``

const BASE_CONTRADICTION = `When sources contradict each other:
1. Note the contradiction in the relevant concept or entity page
2. Create or update a query page to track the open question
3. Link both sources from the query page
4. Resolve in a synthesis page once sufficient evidence exists`

const researchTemplate: WikiTemplate = {
  id: "research",
  name: "专题研究",
  description: "适合做深度课题研究、假设跟踪与方法论整理",
  icon: "🔬",
  extraDirs: ["wiki/methodology", "wiki/findings", "wiki/thesis"],
  schema: `# Wiki Schema — Research Deep-Dive

## Page Types

| Type | Directory | Purpose |
|------|-----------|---------|
${BASE_SCHEMA_TYPES}
| thesis | wiki/thesis/ | Working hypothesis and its evolution over time |
| methodology | wiki/methodology/ | Research methods, protocols, and study designs |
| finding | wiki/findings/ | Individual empirical results or observations |

## Naming Conventions

${BASE_NAMING}
- Theses: hypothesis as slug (e.g., \`scaling-improves-reasoning.md\`)
- Methodologies: method name (e.g., \`systematic-review.md\`, \`ablation-study.md\`)
- Findings: descriptive slug (e.g., \`larger-models-better-few-shot.md\`)

## Frontmatter

${BASE_FRONTMATTER}

Thesis pages also include:
\`\`\`yaml
confidence: low | medium | high
status: speculative | supported | refuted | settled
\`\`\`

Finding pages also include:
\`\`\`yaml
source: "[[source-slug]]"
confidence: low | medium | high
replicated: true | false | null
\`\`\`

## Index Format

${BASE_INDEX_FORMAT}

## Log Format

${BASE_LOG_FORMAT}

## Cross-referencing Rules

${BASE_CROSSREF}
- Findings link back to their source via the \`source:\` frontmatter field
- Thesis pages reference supporting and refuting findings via \`related:\`
- Methodology pages are cited by the findings that used them

## Contradiction Handling

${BASE_CONTRADICTION}

## Research-Specific Conventions

- Keep the thesis pages updated as evidence accumulates — they are living documents
- Every finding should assess replication status when known
- Methodology pages explain the *why* (rationale) not just the *how*
- Distinguish between direct evidence and inference in finding pages
`,
  purpose: `# Project Purpose — Research Deep-Dive

## Research Question

<!-- State the central question this research aims to answer. Be specific and falsifiable. -->

>

## Hypothesis / Working Thesis

<!-- Your current best guess. This will evolve — update it as evidence accumulates. -->

>

## Background

<!-- What prior work or context motivates this research? What gap does it fill? -->

## Sub-questions

<!-- Break down the main question into tractable sub-questions. -->

1.
2.
3.
4.

## Scope

**In scope:**
-

**Out of scope:**
-

## Methodology

<!-- How will you investigate this? What types of sources or experiments are relevant? -->

-

## Success Criteria

<!-- How will you know when you have a satisfying answer? -->

-

## Current Status

> Not started — update this section as research progresses.
`,
}

const readingTemplate: WikiTemplate = {
  id: "reading",
  name: "阅读拆解",
  description: "适合跟踪书籍、文章或长文档的章节、主题与线索",
  icon: "📚",
  extraDirs: ["wiki/characters", "wiki/themes", "wiki/plot-threads", "wiki/chapters"],
  schema: `# Wiki Schema — Reading a Book

## Page Types

| Type | Directory | Purpose |
|------|-----------|---------|
${BASE_SCHEMA_TYPES}
| character | wiki/characters/ | People and figures in the book |
| theme | wiki/themes/ | Recurring ideas, motifs, and symbolic threads |
| plot-thread | wiki/plot-threads/ | Storylines or narrative arcs being tracked |
| chapter | wiki/chapters/ | Per-chapter notes and summaries |

## Naming Conventions

${BASE_NAMING}
- Characters: character name in kebab-case (e.g., \`elizabeth-bennet.md\`)
- Themes: thematic noun phrase (e.g., \`social-class-mobility.md\`, \`deception-vs-honesty.md\`)
- Plot threads: arc description (e.g., \`darcys-redemption-arc.md\`)
- Chapters: \`ch-NN-slug.md\` (e.g., \`ch-01-opening-scene.md\`)

## Frontmatter

${BASE_FRONTMATTER}

Character pages also include:
\`\`\`yaml
first_appearance: "Ch. N"
role: protagonist | antagonist | supporting | minor
\`\`\`

Chapter pages also include:
\`\`\`yaml
chapter: N
pages: "1-24"
\`\`\`

## Index Format

${BASE_INDEX_FORMAT}

## Log Format

${BASE_LOG_FORMAT}

## Cross-referencing Rules

${BASE_CROSSREF}
- Chapter notes reference characters appearing in that chapter via \`related:\`
- Theme pages link to the chapters where the theme is most prominent
- Plot thread pages list chapters that advance the arc

## Contradiction Handling

${BASE_CONTRADICTION}

## Reading-Specific Conventions

- Chapter pages are written during or immediately after reading — capture fresh reactions
- Distinguish between plot summary and personal interpretation in chapter notes
- Theme pages should track *development* across the book, not just state that a theme exists
- Flag unresolved plot threads with status: \`open\` until resolved
- Note page numbers for important quotes to enable re-finding later
`,
  purpose: `# Project Purpose — Reading

## Book Details

**Title:**
**Author:**
**Year:**
**Genre:**

## Why I'm Reading This

<!-- What drew you to this book? What do you hope to get from it? -->

## Key Themes to Track

<!-- What thematic threads do you expect or want to follow? -->

1.
2.
3.

## Questions Going In

<!-- What do you want answered or explored by the end? -->

1.
2.

## Reading Pace

**Started:**
**Target finish:**
**Current chapter:**

## First Impressions

<!-- Update after first chapter or first sitting. -->

>

## Final Takeaways

<!-- Fill in when finished. What did this book teach you? -->

>
`,
}

const personalTemplate: WikiTemplate = {
  id: "personal",
  name: "个人成长",
  description: "适合记录目标、习惯、复盘与阶段性反思",
  icon: "🌱",
  extraDirs: ["wiki/goals", "wiki/habits", "wiki/reflections", "wiki/journal"],
  schema: `# Wiki Schema — Personal Growth

## Page Types

| Type | Directory | Purpose |
|------|-----------|---------|
${BASE_SCHEMA_TYPES}
| goal | wiki/goals/ | Specific outcomes you are working toward |
| habit | wiki/habits/ | Recurring behaviours and their tracking |
| reflection | wiki/reflections/ | Periodic reviews and lessons learned |
| journal | wiki/journal/ | Freeform daily or session entries |

## Naming Conventions

${BASE_NAMING}
- Goals: outcome as slug (e.g., \`run-a-marathon.md\`, \`learn-spanish.md\`)
- Habits: behaviour name (e.g., \`daily-meditation.md\`, \`morning-pages.md\`)
- Reflections: type + date (e.g., \`weekly-2024-03.md\`, \`quarterly-2024-q1.md\`)
- Journal: date slug (e.g., \`2024-03-15.md\`)

## Frontmatter

${BASE_FRONTMATTER}

Goal pages also include:
\`\`\`yaml
target_date: YYYY-MM-DD
status: active | paused | achieved | abandoned
progress: 0-100
\`\`\`

Habit pages also include:
\`\`\`yaml
frequency: daily | weekly | monthly
streak: N
status: active | paused | dropped
\`\`\`

Reflection pages also include:
\`\`\`yaml
period: weekly | monthly | quarterly | annual
\`\`\`

## Index Format

${BASE_INDEX_FORMAT}

## Log Format

${BASE_LOG_FORMAT}

## Cross-referencing Rules

${BASE_CROSSREF}
- Reflection pages reference the goals and habits reviewed during that period
- Goals link to the habits that support them via \`related:\`
- Journal entries can reference goals and reflections inline with \`[[slug]]\`

## Contradiction Handling

${BASE_CONTRADICTION}

## Personal Growth Conventions

- Be honest in journal and reflection entries — this wiki is for you, not an audience
- Update goal progress fields regularly; stale data is worse than no data
- Distinguish between outcome goals (what you want) and process goals (what you will do)
- Reflect on *why* habits succeed or fail, not just whether they did
- Use the synthesis directory for cross-cutting insights that span multiple goals or periods
`,
  purpose: `# Project Purpose — Personal Growth

## Focus Areas

<!-- What areas of your life or self are you actively working on? -->

1.
2.
3.

## Motivation

<!-- Why now? What prompted you to start this wiki? -->

## Current Goals (Summary)

<!-- High-level list — create detailed goal pages in wiki/goals/ -->

- [ ]
- [ ]
- [ ]

## Active Habits

<!-- High-level list — create detailed habit pages in wiki/habits/ -->

-
-

## Review Cadence

**Daily journal:** Yes / No
**Weekly reflection:**
**Monthly reflection:**
**Quarterly reflection:**

## Guiding Principles

<!-- What values or principles guide your growth work? -->

1.
2.
3.

## This Year's Theme

<!-- One phrase or sentence that captures your intention for the year. -->

>
`,
}

export const LEGACY_BUSINESS_TEMPLATE_SCHEMA = `# Wiki Schema — Business / Team

## Page Types

| Type | Directory | Purpose |
|------|-----------|---------|
${BASE_SCHEMA_TYPES}
| meeting | wiki/meetings/ | Meeting notes, agendas, and action items |
| decision | wiki/decisions/ | Architectural or strategic decisions (ADR-style) |
| project | wiki/projects/ | Project briefs, status, and retrospectives |
| stakeholder | wiki/stakeholders/ | People, teams, and organisations involved |

## Naming Conventions

${BASE_NAMING}
- Meetings: \`YYYY-MM-DD-slug.md\` (e.g., \`2024-03-15-sprint-planning.md\`)
- Decisions: \`NNN-slug.md\` (e.g., \`001-adopt-typescript.md\`)
- Projects: descriptive slug (e.g., \`payments-redesign.md\`)
- Stakeholders: name or team in kebab-case (e.g., \`alice-chen.md\`, \`platform-team.md\`)

## Frontmatter

${BASE_FRONTMATTER}

Meeting pages also include:
\`\`\`yaml
date: YYYY-MM-DD
attendees: []
action_items: []
\`\`\`

Decision pages also include:
\`\`\`yaml
status: proposed | accepted | deprecated | superseded
deciders: []
date: YYYY-MM-DD
supersedes: ""   # slug of ADR this replaces, if any
\`\`\`

Project pages also include:
\`\`\`yaml
status: planned | active | on-hold | complete | cancelled
owner: ""
start_date: YYYY-MM-DD
target_date: YYYY-MM-DD
\`\`\`

## Index Format

${BASE_INDEX_FORMAT}

## Log Format

${BASE_LOG_FORMAT}

## Cross-referencing Rules

${BASE_CROSSREF}
- Meeting notes reference attendees via \`attendees:\` frontmatter and \`[[stakeholder-slug]]\` links
- Decision pages link to the meetings where the decision was discussed
- Project pages link to their key decisions via \`related:\`
- Stakeholder pages list projects and decisions they are involved in

## Contradiction Handling

${BASE_CONTRADICTION}

## Business-Specific Conventions

- Write meeting notes during or within 24 hours — memory fades fast
- Action items must have a named owner and due date to be actionable
- Decision pages capture *context and consequences*, not just the decision itself
- Deprecated decisions should link to the decision that superseded them
- Projects should have a retrospective section added on completion
`

export const LEGACY_BUSINESS_TEMPLATE_PURPOSE = `# Project Purpose — Business / Team

## Business Context

**Organisation / Team:**
**Domain:**
**Time period covered:**

## Objectives

<!-- What are the top-level business objectives this wiki supports? -->

1.
2.
3.

## Key Projects

<!-- High-level list — create detailed pages in wiki/projects/ -->

-
-

## Key Stakeholders

<!-- Who are the primary people or teams involved? -->

-
-

## Open Decisions

<!-- Decisions currently in flight — create ADR pages in wiki/decisions/ -->

-
-

## Metrics / Success Criteria

<!-- How does the team measure progress toward its objectives? -->

-

## Constraints and Risks

<!-- Known constraints (budget, time, org) and risks to track -->

-

## Review Cadence

**Weekly sync notes:**
**Monthly status update:**
**Quarterly retrospective:**
`

export const LEGACY_GENERIC_PROJECT_SCHEMA = `# Wiki Schema

## Page Types

| Type | Directory | Purpose |
|------|-----------|---------|
| entity | wiki/entities/ | Named things (models, companies, people, datasets) |
| concept | wiki/concepts/ | Ideas, techniques, phenomena |
| source | wiki/sources/ | Papers, articles, talks, blog posts |
| query | wiki/queries/ | Open questions under investigation |
| comparison | wiki/comparisons/ | Side-by-side analysis of related entities |
| synthesis | wiki/synthesis/ | Cross-cutting summaries and conclusions |

## Naming Conventions

- Files: \`kebab-case.md\`
- Entities: match official name where possible (e.g., \`gpt-4.md\`, \`openai.md\`)
- Concepts: descriptive noun phrases (e.g., \`chain-of-thought.md\`)
- Sources: \`author-year-slug.md\` (e.g., \`wei-2022-chain-of-thought.md\`)
- Queries: question as slug (e.g., \`does-scale-improve-reasoning.md\`)

## Frontmatter

All pages must include YAML frontmatter:

\`\`\`yaml
---
type: entity | concept | source | query | comparison | synthesis | overview
title: Human-readable title
tags: []
related: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
\`\`\`

Source pages also include:
\`\`\`yaml
authors: []
year: YYYY
url: ""
venue: ""
\`\`\`

## Index Format

\`wiki/index.md\` lists all pages grouped by type. Each entry:
\`\`\`
- [[page-slug]] — one-line description
\`\`\`

## Log Format

\`wiki/log.md\` records research activity in reverse chronological order:
\`\`\`
## YYYY-MM-DD

- Action taken / finding noted
\`\`\`

## Cross-referencing Rules

- Use \`[[page-slug]]\` syntax to link between wiki pages
- Every entity and concept should appear in \`wiki/index.md\`
- Queries link to the sources and concepts they draw on
- Synthesis pages cite all contributing sources via \`related:\`

## Contradiction Handling

When sources contradict each other:
1. Note the contradiction in the relevant concept or entity page
2. Create or update a query page to track the open question
3. Link both sources from the query page
4. Resolve in a synthesis page once sufficient evidence exists
`

export const LEGACY_GENERIC_PROJECT_PURPOSE = `# Project Purpose

## Goal

<!-- What are you trying to understand or build? -->

## Key Questions

<!-- List the primary questions driving this research -->

1.
2.
3.

## Scope

<!-- What is in scope? What is explicitly out of scope? -->

**In scope:**
-

**Out of scope:**
-

## Thesis

<!-- Your current working hypothesis or conclusion (update as research progresses) -->

> TBD
`

export const BUSINESS_TEMPLATE_SCHEMA = `# Wiki Schema — 业务文档知识沉淀

## 核心目标

这套 wiki 不是普通会议纪要库，而是用于把业务 SOP、诊断文档、方法论和经验总结编译成可检索、可修订、可持续沉淀的知识底座。

## 优先生成的知识页

| Type | Directory | Purpose |
|------|-----------|---------|
| topic | wiki/topics/ | 某个业务主题、场景或问题域的总览页 |
| process | wiki/process/ | 主链路、阶段、步骤、流程骨架 |
| rule | wiki/rules/ | 关键判断、方法规则、选择逻辑 |
| case | wiki/cases/ | 典型案例、证据、正反例 |
| source | wiki/sources/ | 原始业务资料的可追溯摘要页 |
| project | wiki/projects/ | 某个业务项目或场景的上下文页 |
| entity | wiki/entities/ | 品牌、类目、平台、产品、人群等业务对象 |

## 编译优先级

1. 先生成 source 页，保留原文的可追溯摘要。
2. 如果文档存在清晰的主流程或阶段结构，优先生成 process 页。
3. 把关键判断、判断标准、选择逻辑沉淀为 rule 页。
4. 把案例、数据、截图说明、实验结果沉淀为 case 页。
5. 如已有同主题页面，优先更新已有页面，而不是新建近似重复页。

## 页面最低要求

所有重要页面都应尽量具备：

- 明确标题与 summary
- frontmatter 中保留 \`type / title / created / updated / tags / related / sources\`
- 能追溯到原始资料
- 用业务语言表达，而不是空泛学术套话
- 显式区分：步骤、判断、证据、边界

## 命名建议

- 主题页：使用稳定业务主题名，如 \`商品诊断总览.md\`
- 流程页：使用流程或阶段名，如 \`商品诊断主链路.md\`
- 规则页：使用判断主题名，如 \`主图点击率优先判断规则.md\`
- 案例页：使用场景 + 结论，如 \`低点击主图反例-食品类目.md\`
- 来源页：使用原文件主标题或文件名

## 页面写作要求

- process 页优先回答：先做什么、再做什么、每一步为什么重要
- rule 页优先回答：什么情况下这样判断、依据是什么、边界是什么
- case 页优先回答：发生了什么、为什么成立、能支持什么结论
- source 页优先回答：这份原文主要讲什么、和现有知识页有什么关系

## 交叉链接规则

- 页面正文使用 \`[[page-slug]]\` 建立关联
- process 页链接到对应 rule / case / source
- rule 页链接到支撑它的 case / source / process
- case 页链接到它验证或反驳的 rule
- topic 页作为汇总入口，串起 process / rule / case / source

## 质量约束

- 不生成 \`untitled\` 页面
- 不把整段原文原样堆进 wiki 正文
- 不把聊天语气或草稿口语直接写成正式知识
- 如果证据不足，要明确写出“不确定”或“待补证据”
`

export const BUSINESS_TEMPLATE_PURPOSE = `# 业务文档工作台目的

## 这套工作区要解决什么

- 把业务专家的 SOP、诊断文档和经验总结编译成高质量 wiki
- 提炼文档里的主链路步骤、关键判断、证据和边界
- 支持后续的 Agent Mode 诊断、交互式修订和版本发布

## 当前主要资料类型

- 业务 SOP / 操作手册
- 商品诊断 / 链接诊断 / 场景复盘
- 经验方法论 / 规则总结 / 训练材料
- 数据截图说明 / 案例拆解 / 测试结论

## 我希望 AI 优先理解的内容

1. 这份文档的主链路步骤是什么
2. 每个步骤里有哪些关键判断
3. 哪些结论有证据，哪些只是经验推断
4. 哪些地方还缺失、模糊或需要专家确认

## 我希望 AI 产出的内容

- 可检索的 wiki 页面
- 结构化 Ground Truth 草稿
- 字段覆盖与缺口诊断
- 优先修订任务清单
- 可写回业务主稿的修订建议

## 输出风格要求

- 优先使用业务语言，而不是泛化空话
- 先给直接答案，再补结构化解释
- 对步骤、判断、证据、边界分别展开
- 尽量保留原文里真正有价值的业务表达

## 成功标准

- 新导入的业务文档可以稳定生成可读 wiki
- 专家能快速看出文档哪里弱、先改哪里最值
- 修订后的版本可以继续反哺 wiki 与知识沉淀
`

const businessTemplate: WikiTemplate = {
  id: "business",
  name: "业务工作台",
  description: "适合沉淀业务资料、关键判断、项目进展与协同结论",
  icon: "💼",
  extraDirs: ["wiki/meetings", "wiki/decisions", "wiki/projects", "wiki/stakeholders"],
  schema: BUSINESS_TEMPLATE_SCHEMA,
  purpose: BUSINESS_TEMPLATE_PURPOSE,
}

const generalTemplate: WikiTemplate = {
  id: "general",
  name: "通用模板",
  description: "保留最少结构，适合从空白开始自由搭建",
  icon: "📄",
  extraDirs: [],
  schema: `# Wiki Schema

## Page Types

| Type | Directory | Purpose |
|------|-----------|---------|
${BASE_SCHEMA_TYPES}

## Naming Conventions

${BASE_NAMING}

## Frontmatter

${BASE_FRONTMATTER}

## Index Format

${BASE_INDEX_FORMAT}

## Log Format

${BASE_LOG_FORMAT}

## Cross-referencing Rules

${BASE_CROSSREF}

## Contradiction Handling

${BASE_CONTRADICTION}
`,
  purpose: `# Project Purpose

## Goal

<!-- What are you trying to understand or build? -->

## Key Questions

<!-- List the primary questions driving this project -->

1.
2.
3.

## Scope

**In scope:**
-

**Out of scope:**
-

## Thesis

<!-- Your current working hypothesis or conclusion (update as the project progresses) -->

> TBD
`,
}

export const templates: WikiTemplate[] = [
  businessTemplate,
  researchTemplate,
  readingTemplate,
  personalTemplate,
  generalTemplate,
]

export function getTemplate(id: string): WikiTemplate {
  const found = templates.find((t) => t.id === id)
  if (!found) {
    throw new Error(`Unknown template id: "${id}"`)
  }
  return found
}
