**Vue3 + TS Brain Workbench** 前端实现规范，分三部分：

1. 前端目录结构
2. 页面文件命名规范
3. mock schema 设计 Prompt

当前阶段来设计：
**前端是薄工作台，不是通用 chat app，不是重 CMS，不是纯笔记浏览器。**

---

# 一、前端目录结构

我建议用一种偏“工作台 + 对象层 + features 分层”的结构。
目标是后面接真实接口、加 Hermes runtime、加更多对象页时，不用推倒重来。

```text id="fw0i4k"
brain-workbench/
├── README.md
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── index.html
├── .env.example
├── public/
│   ├── favicon.ico
│   └── mock/
│       ├── query/
│       ├── writeback/
│       ├── assets/
│       ├── profile/
│       ├── eval/
│       └── wiki/
│
├── src/
│   ├── main.ts
│   ├── App.vue
│   │
│   ├── app/
│   │   ├── router/
│   │   │   ├── index.ts
│   │   │   ├── routes.ts
│   │   │   └── guards.ts
│   │   ├── providers/
│   │   │   ├── theme-provider.ts
│   │   │   ├── app-provider.ts
│   │   │   └── mock-provider.ts
│   │   ├── stores/
│   │   │   ├── ui.store.ts
│   │   │   ├── query.store.ts
│   │   │   ├── writeback.store.ts
│   │   │   ├── assets.store.ts
│   │   │   ├── profile.store.ts
│   │   │   ├── eval.store.ts
│   │   │   └── wiki.store.ts
│   │   └── layouts/
│   │       ├── WorkbenchLayout.vue
│   │       ├── SplitPanelLayout.vue
│   │       └── DetailDrawerLayout.vue
│   │
│   ├── pages/
│   │   ├── ask/
│   │   │   ├── AskWorkspacePage.vue
│   │   │   ├── AskWorkspaceHeader.vue
│   │   │   ├── AskWorkspaceSidebar.vue
│   │   │   └── AskWorkspaceTray.vue
│   │   ├── writeback/
│   │   │   ├── WritebackReviewPage.vue
│   │   │   ├── WritebackProposalListPane.vue
│   │   │   └── WritebackProposalDetailPane.vue
│   │   ├── assets/
│   │   │   ├── AssetCandidatesPage.vue
│   │   │   ├── OntologyCandidatesTab.vue
│   │   │   ├── SkillCandidatesTab.vue
│   │   │   └── CandidateDetailDrawer.vue
│   │   ├── profile/
│   │   │   ├── ProfileWorkspacePage.vue
│   │   │   ├── MethodProfilePanel.vue
│   │   │   ├── StyleProposalPanel.vue
│   │   │   └── MemoryProposalPanel.vue
│   │   ├── eval/
│   │   │   ├── EvalReportsPage.vue
│   │   │   ├── EvalReportListPane.vue
│   │   │   ├── EvalReportDetailPane.vue
│   │   │   └── EvalMetricsChartPanel.vue
│   │   └── wiki/
│   │       ├── WikiExplorerPage.vue
│   │       ├── WikiTypeTreePane.vue
│   │       ├── WikiPageListPane.vue
│   │       └── WikiPageDetailPane.vue
│   │
│   ├── widgets/
│   │   ├── answer/
│   │   │   ├── AnswerCard.vue
│   │   │   ├── AnswerSections.vue
│   │   │   ├── CitationList.vue
│   │   │   └── QueryTracePanel.vue
│   │   ├── evidence/
│   │   │   ├── EvidenceList.vue
│   │   │   ├── EvidenceSnippetCard.vue
│   │   │   └── RetrievedPagesList.vue
│   │   ├── proposal/
│   │   │   ├── ProposalCard.vue
│   │   │   ├── ProposalStatusTag.vue
│   │   │   ├── ProposalTargetTag.vue
│   │   │   └── MergePreviewPanel.vue
│   │   ├── candidate/
│   │   │   ├── CandidateCard.vue
│   │   │   ├── CandidateTypeTag.vue
│   │   │   ├── CandidateEvidencePanel.vue
│   │   │   └── CandidateActionBar.vue
│   │   ├── profile/
│   │   │   ├── MethodProfileCard.vue
│   │   │   ├── ProfileDimensionList.vue
│   │   │   └── ProfileProposalCard.vue
│   │   ├── eval/
│   │   │   ├── EvalSummaryCard.vue
│   │   │   ├── EvalMetricBadge.vue
│   │   │   └── EvalTrendChart.vue
│   │   └── wiki/
│   │       ├── WikiPageCard.vue
│   │       ├── WikiLinkList.vue
│   │       └── WikiMarkdownViewer.vue
│   │
│   ├── features/
│   │   ├── query/
│   │   │   ├── api.ts
│   │   │   ├── model.ts
│   │   │   ├── useAskWorkspace.ts
│   │   │   └── mapper.ts
│   │   ├── writeback/
│   │   │   ├── api.ts
│   │   │   ├── model.ts
│   │   │   ├── useWritebackReview.ts
│   │   │   └── mapper.ts
│   │   ├── ontology/
│   │   │   ├── api.ts
│   │   │   ├── model.ts
│   │   │   ├── useOntologyCandidates.ts
│   │   │   └── mapper.ts
│   │   ├── skills/
│   │   │   ├── api.ts
│   │   │   ├── model.ts
│   │   │   ├── useSkillCandidates.ts
│   │   │   └── mapper.ts
│   │   ├── profile/
│   │   │   ├── api.ts
│   │   │   ├── model.ts
│   │   │   ├── useProfileWorkspace.ts
│   │   │   └── mapper.ts
│   │   ├── eval/
│   │   │   ├── api.ts
│   │   │   ├── model.ts
│   │   │   ├── useEvalReports.ts
│   │   │   └── mapper.ts
│   │   ├── wiki/
│   │   │   ├── api.ts
│   │   │   ├── model.ts
│   │   │   ├── useWikiExplorer.ts
│   │   │   └── mapper.ts
│   │   └── memory/
│   │       ├── api.ts
│   │       ├── model.ts
│   │       └── mapper.ts
│   │
│   ├── entities/
│   │   ├── answer-record/
│   │   │   ├── types.ts
│   │   │   ├── schema.ts
│   │   │   └── adapters.ts
│   │   ├── wiki-page/
│   │   │   ├── types.ts
│   │   │   ├── schema.ts
│   │   │   └── adapters.ts
│   │   ├── writeback-proposal/
│   │   │   ├── types.ts
│   │   │   ├── schema.ts
│   │   │   └── adapters.ts
│   │   ├── ontology-candidate/
│   │   │   ├── types.ts
│   │   │   ├── schema.ts
│   │   │   └── adapters.ts
│   │   ├── skill-candidate/
│   │   │   ├── types.ts
│   │   │   ├── schema.ts
│   │   │   └── adapters.ts
│   │   ├── method-profile/
│   │   │   ├── types.ts
│   │   │   ├── schema.ts
│   │   │   └── adapters.ts
│   │   ├── eval-report/
│   │   │   ├── types.ts
│   │   │   ├── schema.ts
│   │   │   └── adapters.ts
│   │   └── memory-item/
│   │       ├── types.ts
│   │       ├── schema.ts
│   │       └── adapters.ts
│   │
│   ├── shared/
│   │   ├── api/
│   │   │   ├── client.ts
│   │   │   ├── endpoints.ts
│   │   │   ├── mockClient.ts
│   │   │   └── response.ts
│   │   ├── ui/
│   │   │   ├── AppPageHeader.vue
│   │   │   ├── EmptyState.vue
│   │   │   ├── LoadingPanel.vue
│   │   │   ├── KeyValueList.vue
│   │   │   ├── SplitPane.vue
│   │   │   ├── StatusBadge.vue
│   │   │   └── MarkdownRenderer.vue
│   │   ├── lib/
│   │   │   ├── format.ts
│   │   │   ├── tree.ts
│   │   │   ├── chart.ts
│   │   │   └── guards.ts
│   │   ├── types/
│   │   │   ├── common.ts
│   │   │   ├── api.ts
│   │   │   └── ui.ts
│   │   ├── constants/
│   │   │   ├── routes.ts
│   │   │   ├── pageTypes.ts
│   │   │   ├── candidateTypes.ts
│   │   │   └── proposalTargets.ts
│   │   └── styles/
│   │       ├── tokens.css
│   │       ├── theme.css
│   │       └── workbench.css
│   │
│   └── mocks/
│       ├── query.mock.ts
│       ├── writeback.mock.ts
│       ├── assets.mock.ts
│       ├── profile.mock.ts
│       ├── eval.mock.ts
│       └── wiki.mock.ts
│
└── mock-schemas/
    ├── query-response.schema.json
    ├── writeback-proposal.schema.json
    ├── ontology-candidate.schema.json
    ├── skill-candidate.schema.json
    ├── method-profile.schema.json
    ├── eval-report.schema.json
    └── wiki-page.schema.json
```

---

# 二、这样分层的原因

这套结构的核心思想是：

## 1. `pages/`

只放页面级容器，不堆太多业务逻辑。
每个页面负责组装 pane、drawer、widgets。

## 2. `widgets/`

放跨页面复用的展示组件。
例如：

* AnswerCard
* ProposalCard
* CandidateCard
* EvalSummaryCard

## 3. `features/`

放每条业务链路自己的：

* api
* model
* composable
* mapper

这是最容易被 AI-coding 正确扩展的层。

## 4. `entities/`

放稳定对象定义。
这些对象跟你后端的核心对象是一一映射的：

* AnswerRecord
* WikiPage
* WritebackProposal
* OntologyCandidate
* SkillCandidate
* MethodProfile
* EvalReport

## 5. `shared/`

放公共组件、API client、工具函数、常量。

---

# 三、页面文件命名规范

我建议统一采用下面这套规则。

---

## 1. 页面级文件

### 规则

* 页面文件用 `Page.vue` 结尾
* 一眼看出这是路由级页面
* 页面名用业务对象，不用泛泛的 `Index.vue`

### 例子

```text id="9mngii"
AskWorkspacePage.vue
WritebackReviewPage.vue
AssetCandidatesPage.vue
ProfileWorkspacePage.vue
EvalReportsPage.vue
WikiExplorerPage.vue
```

---

## 2. 页面内主面板

### 规则

* 用 `Pane.vue` 表示主区域分栏面板
* 用 `Panel.vue` 表示独立逻辑面板
* 用 `Drawer.vue` 表示右侧抽屉/详情抽屉

### 例子

```text id="5q3gk7"
WritebackProposalListPane.vue
WritebackProposalDetailPane.vue
WikiPageListPane.vue
WikiPageDetailPane.vue
CandidateDetailDrawer.vue
EvalMetricsChartPanel.vue
MethodProfilePanel.vue
```

---

## 3. Widget 命名

### 规则

* 用业务对象 + 展示形态
* 不要写成过度抽象的 `InfoCard.vue`
* 保持对象语义清楚

### 例子

```text id="7maujh"
AnswerCard.vue
EvidenceSnippetCard.vue
ProposalCard.vue
CandidateActionBar.vue
MethodProfileCard.vue
EvalSummaryCard.vue
WikiPageCard.vue
```

---

## 4. composable 命名

### 规则

* 一律用 `useXxx.ts`
* 一个 composable 尽量只服务一个页面或一个 feature

### 例子

```text id="g8pehf"
useAskWorkspace.ts
useWritebackReview.ts
useOntologyCandidates.ts
useSkillCandidates.ts
useProfileWorkspace.ts
useEvalReports.ts
useWikiExplorer.ts
```

---

## 5. store 命名

### 规则

* 用 `xxx.store.ts`
* 避免写成泛泛的 `index.ts`

### 例子

```text id="o6p3w2"
query.store.ts
writeback.store.ts
assets.store.ts
profile.store.ts
eval.store.ts
wiki.store.ts
ui.store.ts
```

---

## 6. 类型与 schema 文件

### 规则

* `types.ts`：TS 类型
* `schema.ts`：Zod 或运行时 schema
* `adapters.ts`：后端对象到前端视图对象的映射

### 例子

```text id="tiqffq"
entities/writeback-proposal/types.ts
entities/writeback-proposal/schema.ts
entities/writeback-proposal/adapters.ts
```

---

# 四、推荐路由文件命名

`src/app/router/routes.ts`

建议这样定义：

```ts id="l0n1eu"
export const routes = [
  {
    path: '/',
    redirect: '/workspace/ask',
  },
  {
    path: '/workspace/ask',
    name: 'AskWorkspace',
    component: () => import('@/pages/ask/AskWorkspacePage.vue'),
  },
  {
    path: '/workspace/writeback',
    name: 'WritebackReview',
    component: () => import('@/pages/writeback/WritebackReviewPage.vue'),
  },
  {
    path: '/workspace/assets',
    name: 'AssetCandidates',
    component: () => import('@/pages/assets/AssetCandidatesPage.vue'),
  },
  {
    path: '/workspace/profile',
    name: 'ProfileWorkspace',
    component: () => import('@/pages/profile/ProfileWorkspacePage.vue'),
  },
  {
    path: '/workspace/eval',
    name: 'EvalReports',
    component: () => import('@/pages/eval/EvalReportsPage.vue'),
  },
  {
    path: '/workspace/wiki',
    name: 'WikiExplorer',
    component: () => import('@/pages/wiki/WikiExplorerPage.vue'),
  },
]
```

---

# 五、mock schema 设计原则

你现在前端应该先用 **mock-first + endpoint-ready** 的方式做。
也就是：

* 先有前端页面和交互
* mock 数据结构尽量贴近未来后端 API
* 后面替换真实接口时，尽量少改页面层

所以 mock schema 要满足 4 个原则：

## 1. 对齐后端对象

不能只做 UI 假数据，必须和后端的真实对象语义一致。

## 2. 区分“存储对象”和“视图对象”

后端返回的数据不一定最适合前端渲染，所以要有 mapper。

## 3. 支持列表 + 详情 + 操作

每类 mock 不只是 detail，还要有：

* list
* detail
* action result

## 4. 支持“状态变化”

例如：

* proposal: pending → approved
* candidate: candidate → promoted
* eval report: latest / historical

---

# 六、建议的 mock schema 清单

至少做这 7 类。

---

## 1. Query Response Mock Schema

```json id="q4f3r6"
{
  "queryId": "20260414-ask-001",
  "question": "品牌经营OS和SUPER指标之间是什么关系？",
  "methodMode": {
    "template": "decision-first",
    "abstractionLevel": "high",
    "assetizationPreference": "high"
  },
  "answer": {
    "fact": "......",
    "synthesis": "......",
    "interpretation": "......",
    "recommendation": "......",
    "citations": [
      "wiki/topics/品牌经营os.md",
      "wiki/topics/super指标.md"
    ]
  },
  "retrievedPages": [
    {
      "pageId": "topic_brand_operating_os",
      "title": "品牌经营OS",
      "pageType": "topic",
      "score": 0.94,
      "summary": "......"
    }
  ],
  "evidenceSnippets": [
    {
      "pageId": "topic_brand_operating_os",
      "sourceRef": "raw/industry_docs/xxx.md",
      "snippet": "......"
    }
  ],
  "sessionMemorySummary": {
    "summary": "最近几轮围绕品牌经营OS、指标体系、决策编译展开",
    "openQuestions": [
      "SUPER指标是否适合作为长期经营总指标？"
    ]
  },
  "writebackProposalPreview": {
    "proposalId": "wb-001",
    "target": "decision",
    "confidence": 0.87,
    "title": "品牌经营OS与SUPER指标关系的QA沉淀"
  }
}
```

---

## 2. Writeback Proposal Mock Schema

```json id="w8njs8"
{
  "proposalId": "wb-001",
  "title": "品牌经营OS与SUPER指标关系的QA沉淀",
  "status": "pending",
  "target": "decision",
  "rationale": "该回答形成了稳定解释，未来可能被反复引用",
  "confidence": 0.87,
  "expectedLongTermValue": "可作为经营指标体系设计时的参考结论",
  "supportingPages": [
    "wiki/topics/品牌经营os.md",
    "wiki/topics/super指标.md"
  ],
  "supportingSources": [
    "raw/industry_docs/metrics.md"
  ],
  "mergePreview": {
    "destinationPath": "wiki/decisions/品牌经营os和super指标关系.md",
    "mode": "create_or_merge",
    "summary": "将生成一条 decision 页面，并链接到已有 topic 页面"
  },
  "createdAt": "2026-04-14T10:00:00Z"
}
```

---

## 3. Ontology Candidate Mock Schema

```json id="crnl3v"
{
  "candidateId": "oc-001",
  "type": "Concept",
  "canonicalName": "品牌经营OS",
  "aliases": [
    "经营OS",
    "Brand Operating OS"
  ],
  "confidence": 0.9,
  "attributes": {
    "domain": "brand-operations",
    "stability": "high"
  },
  "wikiRefs": [
    "wiki/topics/品牌经营os.md"
  ],
  "evidenceRefs": [
    "raw/industry_docs/brand_os_notes.md"
  ],
  "status": "candidate",
  "promotionSuggestion": "promote_as_ontology_object"
}
```

---

## 4. Skill Candidate Mock Schema

```json id="4h6hxg"
{
  "candidateId": "sc-001",
  "name": "topic_synthesis",
  "summary": "围绕某一主题聚合多个 wiki 页面，形成结构化综述",
  "confidence": 0.83,
  "inputSchemaPath": "skills/candidates/topic_synthesis/input_schema.json",
  "outputSchemaPath": "skills/candidates/topic_synthesis/output_schema.json",
  "examples": [
    "品牌经营OS主题综述",
    "SUPER指标主题综述"
  ],
  "wikiRefs": [
    "wiki/topics/品牌经营os.md",
    "wiki/topics/super指标.md"
  ],
  "status": "candidate"
}
```

---

## 5. Method Profile Mock Schema

```json id="z1e00a"
{
  "profileId": "default",
  "preferredAnswerStructure": [
    "judgment-first",
    "structure-breakdown",
    "main-chain",
    "implementation-path"
  ],
  "abstractionPreference": "high",
  "actionabilityPreference": "high",
  "citationPreference": "medium",
  "favoredOutputForms": [
    "mapping-table",
    "architecture-diagram",
    "object-model",
    "roadmap"
  ],
  "assetizationPreference": "high",
  "updatedAt": "2026-04-14T10:00:00Z"
}
```

---

## 6. Eval Report Mock Schema

```json id="jbdf34"
{
  "reportId": "eval-20260414-001",
  "createdAt": "2026-04-14T10:30:00Z",
  "summary": {
    "writebackPrecision": 0.92,
    "memoryPrecision": 0.88,
    "methodConsistency": 0.9,
    "ontologyQuality": 0.86,
    "skillCandidateQuality": 0.84
  },
  "details": [
    {
      "metric": "writebackPrecision",
      "score": 0.92,
      "note": "高价值问答写回较为克制"
    }
  ],
  "trend": [
    {
      "date": "2026-04-12",
      "writebackPrecision": 0.8,
      "methodConsistency": 0.76
    },
    {
      "date": "2026-04-13",
      "writebackPrecision": 0.89,
      "methodConsistency": 0.87
    },
    {
      "date": "2026-04-14",
      "writebackPrecision": 0.92,
      "methodConsistency": 0.9
    }
  ]
}
```

---

## 7. Wiki Page Mock Schema

```json id="edgngn"
{
  "pageId": "topic_brand_operating_os",
  "title": "品牌经营OS",
  "pageType": "topic",
  "path": "wiki/topics/品牌经营os.md",
  "summary": "围绕品牌经营增长构建的数据、知识、决策与执行系统。",
  "sourceRefs": [
    "raw/industry_docs/brand_os_notes.md"
  ],
  "linksTo": [
    "topic_super_metrics",
    "decision_brand_os_and_super"
  ],
  "backlinks": [
    "project_personal_brain_os"
  ],
  "updatedAt": "2026-04-14T09:50:00Z",
  "markdown": "# 品牌经营OS\n\n......"
}






