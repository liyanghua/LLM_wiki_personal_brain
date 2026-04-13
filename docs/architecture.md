┌──────────────────────────────────────────────────────────────────────┐
│                      Personal Brain OS                              │
│            LLM Wiki + Hermes Agent + Evolution Loop                │
└──────────────────────────────────────────────────────────────────────┘

            [A] Source Layer / 原始资料层
┌──────────────────────────────────────────────────────────────────────┐
│ personal_brain/raw/                                                 │
│  ├── industry_docs/        # 行业知识 doc/md/pdf                    │
│  ├── notes/                # 个人笔记                               │
│  ├── conversations/        # 重要对话/会议纪要                      │
│  ├── links/                # 网页摘录                               │
│  └── attachments/          # 附件                                   │
│                                                                      │
│ 原则：append-only, preserve source, preserve timestamps             │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                │ ingest / compile
                                ▼

            [B] LLM Wiki Compiler / 知识编译层
┌──────────────────────────────────────────────────────────────────────┐
│ personal_brain/wiki/                                                │
│  ├── entities/             # 人/公司/产品/平台/概念                 │
│  ├── topics/               # 行业主题                               │
│  ├── projects/             # 个人项目                               │
│  ├── decisions/            # 高价值问答沉淀                         │
│  ├── principles/           # 个人风格/方法论                        │
│  ├── timelines/            # 认知演化                               │
│  ├── index.md              # 内容索引                               │
│  └── log.md                # append-only 变更日志                    │
│                                                                      │
│ 产物：                                                              │
│  1. human-readable wiki                                             │
│  2. backlinks / summaries / source_refs                             │
│  3. lint suggestions / stale checks / missing pages                 │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                │ extract / normalize
                                ▼

            [C] Ontology / Memory Assets / 结构化资产层
┌──────────────────────────────────────────────────────────────────────┐
│ personal_brain/ontology/                                            │
│  ├── objects/              # Topic / Concept / Person / Source      │
│  ├── relations/            # related_to / supports / contradicts    │
│  ├── rules/                # 回答风格、引用规则、更新规则            │
│  ├── profiles/             # user style / interests / thinking prefs│
│  └── evidence_index/       # page -> source mapping                 │
│                                                                      │
│ personal_brain/memory/                                              │
│  ├── session/              # 当次会话摘要                           │
│  ├── persistent/           # 跨会话长期偏好/事实                    │
│  └── skills/               # 学到的解决模式                         │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                │ retrieve / plan / answer / write-back
                                ▼

            [D] Hermes Brain Agent / 交互代理层
┌──────────────────────────────────────────────────────────────────────┐
│ Hermes Runtime                                                       │
│  ├── Query Router                                                    │
│  ├── Memory Recall                                                   │
│  ├── Wiki Search / Page Read                                         │
│  ├── Ontology-aware Answer Composer                                  │
│  ├── Write-back Proposer                                             │
│  └── Skill Runner                                                    │
│                                                                      │
│ 能力：                                                               │
│  - 检索 wiki                                                         │
│  - 搜索 past sessions                                                │
│  - 用个人风格回答                                                    │
│  - 把高价值回答变成 decisions/principles/wiki updates               │
│  - 复杂任务沉淀成 skill                                              │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                │ traces / evals / accepted edits
                                ▼

            [E] Self-Evolution / 离线进化层
┌──────────────────────────────────────────────────────────────────────┐
│ evolution/                                                           │
│  ├── datasets/              # 你的真实问答样本                       │
│  ├── evals/                 # style, grounding, usefulness, recall   │
│  ├── candidate_skills/      # 被优化的 skill prompt                 │
│  ├── reports/               # 优化报告                               │
│  └── gates/                 # tests, semantic-preservation, review   │
│                                                                      │
│ 只优化：                                                             │
│  - skill docs                                                        │
│  - answer templates                                                  │
│  - tool routing descriptions                                         │
│  - memory write heuristics                                           │
│                                                                      │
│ 不直接在线改主逻辑，必须过 tests + review                           │
└──────────────────────────────────────────────────────────────────────┘