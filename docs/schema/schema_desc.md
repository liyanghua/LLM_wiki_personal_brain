

这版是按当前 `raw_new` 目录结构写的，核心思想是：
**raw sources 保持不可修改，wiki 是持续维护的中间层，而 schema 负责约束 ingest / query / maintain 的行为。** 这正是 `llm-wiki.md` 的三层模式。
同时，`index/log/schema` 这种“持续维护而不是临时检索”的方式，也适合你后面不断加入新文档的场景。

---

# 《raw_new 目录级 _dir_schema.yaml 全套样例 + 3 个电商 domain_profiles 样例》

## 一、推荐目录布局

```text
raw_new/
├── .brain/
│   ├── _dir_schema.yaml
│   ├── source_records.jsonl
│   ├── compiler_routes.yaml
│   └── domain_profiles/
│       ├── ecommerce_term_dictionary.yaml
│       ├── main_image_ctr_ontology.yaml
│       └── interview_question_taxonomy.yaml
├── industry_docs/
│   └── _dir_schema.yaml
├── conversations/
│   └── _dir_schema.yaml
├── attachments/
│   └── _dir_schema.yaml
├── data/
│   └── _dir_schema.yaml
├── notes/
│   └── _dir_schema.yaml
└── links/
    └── _dir_schema.yaml
```

---

## 二、目录级 `_dir_schema.yaml` 通用骨架

先给你一个通用模板，后面每个目录都按这个实例化。

```yaml
version: 1
directory: raw_new/<dir_name>
description: ""
default_source_family: ""
default_role_in_pipeline: ""
default_authority_level: medium
default_trust_level: draft
default_maturity_level: raw

inherit_to_files: true

default_preferred_outputs: []
default_not_for_direct_publish: []
default_risk_flags: []

default_ingest_mode_by_ext: {}
default_chunking_policy: {}
default_extraction_priority: {}

domain_injection_profile: []

routing_policy:
  compiler_pipeline: ""
  graphify_enabled: false
  graphify_mode: none
  wiki_write_mode: candidate_only
  conflict_policy: flag
  page_generation_policy: propose_only

retrieval_policy:
  searchable_in_qa: true
  searchable_in_interview: true
  searchable_in_wiki_query: true
  require_scope_check: true
  require_provenance: true

governance_policy:
  requires_human_review: true
  can_promote_to_final_wiki: false
  can_generate_claims_directly: false
```

---

# 三、`raw_new/industry_docs/_dir_schema.yaml`

这是主知识源目录。

```yaml
version: 1
directory: raw_new/industry_docs
description: 电商领域规则、方法、SOP、案例主文档目录；是 wiki compiler 的核心主输入层。

default_source_family: domain_knowledge
default_role_in_pipeline: rule_source
default_authority_level: medium_high
default_trust_level: working_doc
default_maturity_level: working

inherit_to_files: true

default_preferred_outputs:
  - concept_pages
  - rule_candidates
  - decision_dimension_nodes
  - workflow_pages
  - scenario_pages
  - heuristic_cards

default_not_for_direct_publish:
  - 未标注适用范围的绝对结论
  - 单案例直接泛化后的通用规则
  - 未经证据绑定的策略结论

default_risk_flags:
  - needs_scope_check
  - may_mix_general_and_category_specific_rules
  - strategy_bias_possible

default_ingest_mode_by_ext:
  md: direct_rule_compile
  xmind: graph_first_outline_compile
  xml: graph_first_outline_compile
  drawio: graph_first_outline_compile

default_chunking_policy:
  preserve_headings: true
  preserve_tables: true
  preserve_lists: true
  preserve_parent_context: true
  split_priority:
    - heading
    - variable_block
    - case_block
  max_section_length: 1800

default_extraction_priority:
  concepts: high
  heuristics: high
  cases: medium
  signals: medium
  boundaries: high
  workflows: high
  metrics: low
  claims: high

domain_injection_profile:
  - ecommerce_term_dictionary
  - main_image_ctr_ontology

routing_policy:
  compiler_pipeline: direct_or_graph_mixed
  graphify_enabled: true
  graphify_mode: structure_first_for_xmind_and_drawio
  wiki_write_mode: candidate_plus_wiki
  conflict_policy: flag
  page_generation_policy: propose_only

retrieval_policy:
  searchable_in_qa: true
  searchable_in_interview: true
  searchable_in_wiki_query: true
  require_scope_check: true
  require_provenance: true

governance_policy:
  requires_human_review: true
  can_promote_to_final_wiki: true
  can_generate_claims_directly: true
```

---

# 四、`raw_new/conversations/_dir_schema.yaml`

这是知识萃取过程层，不是最终规则层。

```yaml
version: 1
directory: raw_new/conversations
description: 专家访谈日志、递进式问答记录、问题设计中间稿；主要用于生成候选知识，不直接进入最终规则页。

default_source_family: elicitation_trace
default_role_in_pipeline: elicitation_trace
default_authority_level: medium
default_trust_level: draft
default_maturity_level: raw

inherit_to_files: true

default_preferred_outputs:
  - interview_summary
  - candidate_concepts
  - candidate_heuristics
  - candidate_boundaries
  - pending_questions
  - followup_topics

default_not_for_direct_publish:
  - 本轮问题文本
  - why_this_round
  - expected_gain
  - 假设式表述
  - 未确认结论
  - 追问策略本身

default_risk_flags:
  - question_answer_mixed
  - contains_hypotheses
  - contains_round_specific_context
  - should_not_be_promoted_directly

default_ingest_mode_by_ext:
  md: conversation_candidate_compile

default_chunking_policy:
  preserve_headings: true
  preserve_lists: true
  preserve_parent_context: true
  split_priority:
    - round_section
    - qa_block
    - confirmed_vs_questions
  preferred_section_markers:
    - 当前已确认内容
    - 本轮问题
    - why_this_round
    - expected_gain
  max_section_length: 1400

default_extraction_priority:
  concepts: medium
  heuristics: high
  cases: medium
  signals: low
  boundaries: high
  workflows: low
  metrics: low
  claims: medium

domain_injection_profile:
  - ecommerce_term_dictionary
  - interview_question_taxonomy
  - main_image_ctr_ontology

routing_policy:
  compiler_pipeline: conversation_first
  graphify_enabled: false
  graphify_mode: none
  wiki_write_mode: candidate_only
  conflict_policy: defer
  page_generation_policy: propose_only

retrieval_policy:
  searchable_in_qa: false
  searchable_in_interview: true
  searchable_in_wiki_query: false
  require_scope_check: true
  require_provenance: true

governance_policy:
  requires_human_review: true
  can_promote_to_final_wiki: false
  can_generate_claims_directly: false
```

---

# 五、`raw_new/attachments/_dir_schema.yaml`

这里是原始附件层，要先做结构化转换。

```yaml
version: 1
directory: raw_new/attachments
description: docx/xlsx/png 等原始附件目录；默认先转为标准化中间层，再进入 wiki/compiler。

default_source_family: supporting_evidence
default_role_in_pipeline: supporting_context
default_authority_level: medium_high
default_trust_level: depends_on_file_type
default_maturity_level: raw

inherit_to_files: true

default_preferred_outputs:
  - normalized_markdown
  - structured_tables
  - visual_summaries
  - supporting_evidence_blocks

default_not_for_direct_publish:
  - 未结构化处理的原始附件内容
  - OCR低置信文本
  - 丢失表格口径后的文字总结
  - 仅凭图片版式产生的推测性结论

default_risk_flags:
  - requires_normalization
  - provenance_must_be_preserved
  - attachment_semantics_may_be_lost

default_ingest_mode_by_ext:
  docx: docx_to_md_then_compile
  xlsx: table_first_metric_compile
  png: vision_first_visual_compile
  jpg: vision_first_visual_compile
  jpeg: vision_first_visual_compile

default_chunking_policy:
  preserve_tables: true
  preserve_parent_context: true
  require_source_offsets: true
  max_section_length: 1200

default_extraction_priority:
  concepts: medium
  heuristics: low
  cases: medium
  signals: medium
  boundaries: low
  workflows: low
  metrics: high
  claims: medium

domain_injection_profile:
  - ecommerce_term_dictionary
  - main_image_ctr_ontology

routing_policy:
  compiler_pipeline: normalize_then_compile
  graphify_enabled: true
  graphify_mode: image_or_doc_support_only
  wiki_write_mode: candidate_only
  conflict_policy: defer
  page_generation_policy: propose_only

retrieval_policy:
  searchable_in_qa: false
  searchable_in_interview: true
  searchable_in_wiki_query: false
  require_scope_check: true
  require_provenance: true

governance_policy:
  requires_human_review: true
  can_promote_to_final_wiki: false
  can_generate_claims_directly: false
```

---

# 六、`raw_new/data/_dir_schema.yaml`

定量数据目录。

```yaml
version: 1
directory: raw_new/data
description: 电商定量数据、指标表、统计表目录；主要用于指标、口径、证据绑定，不宜直接写成长段 wiki prose。

default_source_family: quantitative_data
default_role_in_pipeline: quantitative_source
default_authority_level: high
default_trust_level: high_if_schema_clear
default_maturity_level: reviewed

inherit_to_files: true

default_preferred_outputs:
  - metric_nodes
  - structured_tables
  - dataset_profiles
  - evidence_blocks
  - metric_pages

default_not_for_direct_publish:
  - 无单位无口径的数值结论
  - 未保留时间范围的数据解释
  - 脱离统计结构的散文化总结

default_risk_flags:
  - headers_need_normalization
  - units_and_time_scope_must_be_preserved
  - schema_sensitive

default_ingest_mode_by_ext:
  csv: table_first_metric_compile
  xlsx: table_first_metric_compile
  json: direct_data_compile

default_chunking_policy:
  preserve_tables: true
  preserve_units: true
  preserve_time_scope: true
  preserve_schema_headers: true
  max_section_length: 1000

default_extraction_priority:
  concepts: low
  heuristics: low
  cases: low
  signals: medium
  boundaries: low
  workflows: low
  metrics: high
  claims: high

domain_injection_profile:
  - ecommerce_term_dictionary

routing_policy:
  compiler_pipeline: data_first
  graphify_enabled: false
  graphify_mode: none
  wiki_write_mode: candidate_plus_wiki
  conflict_policy: flag
  page_generation_policy: append

retrieval_policy:
  searchable_in_qa: true
  searchable_in_interview: false
  searchable_in_wiki_query: true
  require_scope_check: true
  require_provenance: true

governance_policy:
  requires_human_review: true
  can_promote_to_final_wiki: true
  can_generate_claims_directly: true
```

---

# 七、`raw_new/notes/_dir_schema.yaml`

工作笔记层。

```yaml
version: 1
directory: raw_new/notes
description: 临时笔记、研究备忘、观察记录目录；默认作为辅助上下文和 backlog 来源，不直接作为正式知识页来源。

default_source_family: working_notes
default_role_in_pipeline: supporting_context
default_authority_level: low
default_trust_level: draft
default_maturity_level: raw

inherit_to_files: true

default_preferred_outputs:
  - note_summaries
  - candidate_questions
  - backlog_items
  - hypothesis_flags

default_not_for_direct_publish:
  - 临时想法
  - 无来源判断
  - 未验证洞察

default_risk_flags:
  - low_authority
  - high_hypothesis_density
  - needs_verification

default_ingest_mode_by_ext:
  md: note_summarize_only

default_chunking_policy:
  preserve_headings: true
  preserve_lists: true
  preserve_parent_context: true
  max_section_length: 1200

default_extraction_priority:
  concepts: low
  heuristics: low
  cases: low
  signals: low
  boundaries: medium
  workflows: low
  metrics: low
  claims: low

domain_injection_profile:
  - ecommerce_term_dictionary

routing_policy:
  compiler_pipeline: notes_to_backlog
  graphify_enabled: false
  graphify_mode: none
  wiki_write_mode: candidate_only
  conflict_policy: defer
  page_generation_policy: propose_only

retrieval_policy:
  searchable_in_qa: false
  searchable_in_interview: true
  searchable_in_wiki_query: false
  require_scope_check: true
  require_provenance: true

governance_policy:
  requires_human_review: true
  can_promote_to_final_wiki: false
  can_generate_claims_directly: false
```

---

# 八、`raw_new/links/_dir_schema.yaml`

外部链接登记层。

```yaml
version: 1
directory: raw_new/links
description: 外部链接、待抓取来源、来源登记目录；不直接进入 wiki，优先进入 source queue / fetch backlog。

default_source_family: source_registry
default_role_in_pipeline: supporting_context
default_authority_level: medium
default_trust_level: external_reference
default_maturity_level: raw

inherit_to_files: true

default_preferred_outputs:
  - source_queue
  - source_registry
  - fetch_tasks

default_not_for_direct_publish:
  - 链接本身
  - 未抓取页面的推断结论

default_risk_flags:
  - content_not_fetched
  - authority_unknown_until_fetch

default_ingest_mode_by_ext:
  md: link_registry_compile
  txt: link_registry_compile
  json: link_registry_compile

default_chunking_policy:
  preserve_lists: true
  max_section_length: 1000

default_extraction_priority:
  concepts: low
  heuristics: low
  cases: low
  signals: low
  boundaries: low
  workflows: low
  metrics: low
  claims: low

domain_injection_profile:
  - ecommerce_term_dictionary

routing_policy:
  compiler_pipeline: source_queue_only
  graphify_enabled: false
  graphify_mode: none
  wiki_write_mode: candidate_only
  conflict_policy: defer
  page_generation_policy: propose_only

retrieval_policy:
  searchable_in_qa: false
  searchable_in_interview: false
  searchable_in_wiki_query: false
  require_scope_check: false
  require_provenance: true

governance_policy:
  requires_human_review: false
  can_promote_to_final_wiki: false
  can_generate_claims_directly: false
```

---

# 九、`raw_new/.brain/_dir_schema.yaml`

治理与元数据目录。

```yaml
version: 1
directory: raw_new/.brain
description: source_records、title registry、compiler route、domain profiles 等治理配置层；不是业务知识正文。

default_source_family: metadata_registry
default_role_in_pipeline: governance_support
default_authority_level: high
default_trust_level: system_record
default_maturity_level: final

inherit_to_files: true

default_preferred_outputs:
  - source_registry
  - title_registry
  - ingest_logs
  - mapping_tables
  - routing_tables

default_not_for_direct_publish:
  - 系统记录
  - 编译中间状态
  - 路由配置
  - metadata registry

default_risk_flags:
  - not_business_content
  - should_be_excluded_from_qa

default_ingest_mode_by_ext:
  json: registry_only
  jsonl: registry_only
  yaml: registry_only
  yml: registry_only

default_chunking_policy:
  preserve_exact_content: true

default_extraction_priority:
  concepts: low
  heuristics: low
  cases: low
  signals: low
  boundaries: low
  workflows: low
  metrics: low
  claims: low

domain_injection_profile: []

routing_policy:
  compiler_pipeline: governance_only
  graphify_enabled: false
  graphify_mode: none
  wiki_write_mode: none
  conflict_policy: none
  page_generation_policy: none

retrieval_policy:
  searchable_in_qa: false
  searchable_in_interview: false
  searchable_in_wiki_query: false
  require_scope_check: false
  require_provenance: true

governance_policy:
  requires_human_review: false
  can_promote_to_final_wiki: false
  can_generate_claims_directly: false
```

---

# 十、3 个电商 `domain_profiles` 样例

这 3 个是最值得先做的。
它们不是原始文档，而是 compiler 的“领域先验”。

---

## 1）`raw_new/.brain/domain_profiles/ecommerce_term_dictionary.yaml`

```yaml
version: 1
profile_name: ecommerce_term_dictionary
description: 电商视觉策划与增长相关术语归一字典，用于 ingest、问答检索、wiki page 归档和 claim 标准化。

canonical_terms:
  - canonical: 主图
    aliases: [首图, 封面图, 商品首图]
    type: visual_asset

  - canonical: 点击率
    aliases: [CTR, 点击效率, 主图CTR]
    type: metric

  - canonical: 测图
    aliases: [测素材, 素材测试, 主图测试]
    type: experiment_action

  - canonical: 单因子测试
    aliases: [单变量测试, 单因子测图]
    type: experiment_method

  - canonical: 背景选择
    aliases: [背景策略, 背景搭配, 背景设计]
    type: decision_dimension

  - canonical: 产品视角
    aliases: [视角, 拍摄视角, 展示视角]
    type: decision_dimension

  - canonical: 构图方式
    aliases: [构图, 排布方式, 画面构图]
    type: decision_dimension

  - canonical: 卖点表达
    aliases: [卖点呈现, 卖点展示, 核心卖点表达]
    type: decision_dimension

  - canonical: 护眼卖点
    aliases: [护眼, 护眼属性, 护眼优势]
    type: product_selling_point

  - canonical: 人群
    aliases: [消费人群, 用户人群, 客群]
    type: audience

normalization_rules:
  - when_term_matches_alias: map_to_canonical
  - preserve_original_phrase_in_provenance: true
  - do_not_merge_without_scope_check:
      - 高级感
      - 干净感
      - 场景感

disambiguation_rules:
  - term: 背景
    possible_meanings:
      - 主图背景
      - 场景背景
      - 行业背景
    require_context_window: true

  - term: 测图
    possible_meanings:
      - 创意素材测试
      - 单因子视觉测试
      - 多变量 AB 测试
    require_method_binding: true

retrieval_boost_terms:
  - 主图
  - 点击率
  - 测图
  - 背景选择
  - 构图方式
  - 卖点表达
```

---

## 2）`raw_new/.brain/domain_profiles/main_image_ctr_ontology.yaml`

```yaml
version: 1
profile_name: main_image_ctr_ontology
description: 面向电商主图点击率策划场景的轻量本体先验，用于 wiki compiler 和 interview console 的对象识别与结构化抽取。

entities:
  - name: 商品
    type: business_object
  - name: 主图
    type: visual_asset
  - name: 类目
    type: category
  - name: 人群
    type: audience
  - name: 卖点
    type: selling_point
  - name: 场景
    type: scenario
  - name: 背景
    type: visual_background
  - name: 构图
    type: composition
  - name: 光影
    type: visual_style
  - name: 画质质感
    type: visual_quality
  - name: CTR
    type: metric

decision_dimensions:
  - 背景选择
  - 产品视角
  - 构图方式
  - 卖点表达
  - 光影色调
  - 画质质感

relation_types:
  - influences
  - supports
  - conflicts_with
  - applies_to
  - not_applicable_to
  - evidenced_by
  - exception_of
  - part_of

claim_templates:
  - name: rule_template
    pattern: "<decision_dimension> 在 <scope> 下优先采用 <strategy>，因为 <rationale>"

  - name: boundary_template
    pattern: "<rule_or_strategy> 在 <condition> 下失效或收益下降"

  - name: signal_template
    pattern: "当出现 <signal> 时，说明 <interpretation>"

  - name: case_template
    pattern: "在 <scenario> 中，采取 <action> 后得到 <result>"

scope_axes:
  - 类目
  - 人群
  - 平台
  - 商品阶段
  - 价格带
  - 卖点类型

compiler_constraints:
  - every_rule_should_have_scope_if_possible: true
  - every_case_should_link_to_scenario: true
  - every_signal_should_link_to_metric_or_observation: true
  - avoid_promoting_unspecified_generalizations: true
```

---

## 3）`raw_new/.brain/domain_profiles/interview_question_taxonomy.yaml`

```yaml
version: 1
profile_name: interview_question_taxonomy
description: 交互式问答台的递进式问题类型先验，用于识别问题、区分问题与结论，并驱动 follow-up 生成。

question_types:
  - name: 定义类
    purpose: 澄清概念边界
    examples:
      - 你说的高级感具体指什么？
      - 它和干净感有什么不同？

  - name: 判断类
    purpose: 抽取规则与 heuristics
    examples:
      - 你通常先看哪几个信号？
      - 你如何判断一张图值不值得测？

  - name: 条件类
    purpose: 抽取适用范围
    examples:
      - 这种方法在什么情况下成立？
      - 如果是新品期还适用吗？

  - name: 反例类
    purpose: 抽取失败经验和坑
    examples:
      - 有没有看起来符合但效果不好的情况？
      - 最容易误判的场景是什么？

  - name: 例外类
    purpose: 抽取边界外情形
    examples:
      - 有没有需要反着做的情况？
      - 哪些类目里这个经验会失效？

  - name: 证据类
    purpose: 抽取数据或信号依据
    examples:
      - 你这样判断时会看哪些数据？
      - 什么信号会推翻你的结论？

classification_rules:
  - if_sentence_is_question_and_contains_why_this_round: classify_as_meta_question_context
  - if_sentence_is_question_and_contains_expected_gain: classify_as_meta_goal_context
  - if_sentence_is_answer_like_and_contains_condition_words:
      add_candidate_type: boundary_or_scope
  - if_sentence_is_answer_like_and_contains_failure_or_exception:
      add_candidate_type: exception_or_counterexample

followup_priorities:
  - definition_before_generalization
  - scope_before_promotion
  - counterexample_before_finalization
  - evidence_before_high_confidence_claim

do_not_promote_directly:
  - meta_question_context
  - question_design_reasoning
  - unanswered_questions
```

---

# 十一、推荐再补一个总路由文件

这个文件把“目录级 schema + 扩展名 + pipeline”连起来。

## `raw_new/.brain/compiler_routes.yaml`

```yaml
version: 1

routes:
  - match:
      directory: raw_new/industry_docs
      ext: md
    pipeline: direct_rule_compile

  - match:
      directory: raw_new/industry_docs
      ext: xmind
    pipeline: graph_first_outline_compile

  - match:
      directory: raw_new/industry_docs
      ext: xml
    pipeline: graph_first_outline_compile

  - match:
      directory: raw_new/conversations
      ext: md
    pipeline: conversation_candidate_compile

  - match:
      directory: raw_new/attachments
      ext: docx
    pipeline: docx_to_md_then_compile

  - match:
      directory: raw_new/attachments
      ext: xlsx
    pipeline: table_first_metric_compile

  - match:
      directory: raw_new/attachments
      ext: png
    pipeline: vision_first_visual_compile

  - match:
      directory: raw_new/data
      ext: csv
    pipeline: table_first_metric_compile

  - match:
      directory: raw_new/data
      ext: xlsx
    pipeline: table_first_metric_compile

  - match:
      directory: raw_new/notes
      ext: md
    pipeline: note_summarize_only

  - match:
      directory: raw_new/links
      ext: md
    pipeline: link_registry_compile
```

---

# 十二、怎么把“电商领域知识”真正融进去

最有效的方式不是把长 prompt 塞给 compiler，而是让它在运行时显式加载对应 profile。

例如：

### 处理 `industry_docs/*.md`

先加载：

* `ecommerce_term_dictionary`
* `main_image_ctr_ontology`

### 处理 `conversations/*.md`

先加载：

* `ecommerce_term_dictionary`
* `interview_question_taxonomy`
* `main_image_ctr_ontology`

### 处理 `data/*.xlsx`

先加载：

* `ecommerce_term_dictionary`

这样 compiler 处理文档时，不是“临时理解”，而是先有：

* 术语归一框架
* 轻量本体对象框架
* 问题类型框架

这会明显减少：

* 同义词分裂
* 问题与知识混淆
* 规则与边界混淆
* 类目泛化过度

---

# 十三、最短落地顺序

先做这 5 件事就够启动：

1. 给 7 个目录落 `_dir_schema.yaml`
2. 在 `.brain/domain_profiles/` 放这 3 个 profile
3. 新建 `compiler_routes.yaml`
4. 让 `source_records.jsonl` 支持读取目录 schema 继承
5. 让 wiki compiler 运行前先加载：目录 schema → 文件 descriptor → domain profiles

---

# 十四、一句话总结

**目录本身不只是存放位置，而应该成为 wiki compiler 的“默认语义入口”。**
这样以后新文档一进目录，就天然继承：

* 默认抽取策略
* 默认风险控制
* 默认电商领域先验
* 默认 wiki / graph 编译路径

