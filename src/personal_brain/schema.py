from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SCHEMA_BLUEPRINTS: dict[str, str] = {
    "raw_new/industry_docs/_dir_schema.yaml": """version: 1
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
""",
    "raw_new/conversations/_dir_schema.yaml": """version: 1
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
  compiler_pipeline: conversation_candidate_compile
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
""",
    "raw_new/attachments/_dir_schema.yaml": """version: 1
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
""",
    "raw_new/data/_dir_schema.yaml": """version: 1
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
""",
    "raw_new/notes/_dir_schema.yaml": """version: 1
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
""",
    "raw_new/links/_dir_schema.yaml": """version: 1
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
""",
    "raw_new/.brain/_dir_schema.yaml": """version: 1
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
""",
    "raw_new/.brain/domain_profiles/ecommerce_term_dictionary.yaml": """version: 1
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
""",
    "raw_new/.brain/domain_profiles/main_image_ctr_ontology.yaml": """version: 1
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
""",
    "raw_new/.brain/domain_profiles/interview_question_taxonomy.yaml": """version: 1
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
""",
    "raw_new/.brain/compiler_routes.yaml": """version: 1

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
""",
}


def _parse_scalar(value: str) -> Any:
    cleaned = value.strip()
    if cleaned in {"true", "false"}:
        return cleaned == "true"
    if cleaned in {"none", "null"}:
        return None
    if cleaned.startswith("[") and cleaned.endswith("]"):
        inner = cleaned[1:-1].strip()
        if not inner:
            return []
        return [part.strip().strip("'\"") for part in inner.split(",")]
    try:
        if "." in cleaned:
            return float(cleaned)
        return int(cleaned)
    except ValueError:
        return cleaned


def _parse_indented_block(lines: list[str], start: int, indent: int) -> tuple[Any, int]:
    result_dict: dict[str, Any] = {}
    result_list: list[Any] = []
    index = start
    mode: str | None = None
    while index < len(lines):
        raw = lines[index]
        if not raw.strip():
            index += 1
            continue
        current_indent = len(raw) - len(raw.lstrip(" "))
        if current_indent < indent:
            break
        stripped = raw.strip()
        if stripped.startswith("- "):
            mode = mode or "list"
            if ":" in stripped[2:]:
                item_key, item_value = stripped[2:].split(":", 1)
                item: dict[str, Any] = {item_key.strip(): _parse_scalar(item_value.strip()) if item_value.strip() else None}
                nested, next_index = _parse_indented_block(lines, index + 1, current_indent + 2)
                if nested not in ({}, []):
                    if isinstance(nested, dict):
                        item.update(nested)
                    else:
                        item["items"] = nested
                    index = next_index
                else:
                    index += 1
                result_list.append(item)
                continue
            result_list.append(_parse_scalar(stripped[2:]))
            index += 1
            continue

        mode = mode or "dict"
        if ":" not in stripped:
            index += 1
            continue
        key, value = stripped.split(":", 1)
        key = key.strip()
        value = value.strip()
        if value:
            result_dict[key] = _parse_scalar(value)
            index += 1
            continue
        nested, next_index = _parse_indented_block(lines, index + 1, current_indent + 2)
        result_dict[key] = nested
        index = next_index

    if mode == "list":
        return result_list, index
    return result_dict, index


def parse_schema_text(text: str) -> dict[str, Any]:
    lines = text.splitlines()
    parsed, _ = _parse_indented_block(lines, 0, 0)
    return parsed if isinstance(parsed, dict) else {}


@dataclass
class DirectorySchema:
    path: Path
    payload: dict[str, Any]

    def get(self, key: str, default: Any = None) -> Any:
        return self.payload.get(key, default)


class SchemaRegistry:
    def __init__(self, source_root: Path) -> None:
        self.source_root = source_root.resolve()
        self.root_schema_path = self.source_root / ".brain" / "_dir_schema.yaml"
        self.compiler_routes_path = self.source_root / ".brain" / "compiler_routes.yaml"
        self.profile_root = self.source_root / ".brain" / "domain_profiles"
        self._dir_cache: dict[Path, DirectorySchema] = {}
        self._route_cache: list[dict[str, Any]] | None = None

    def initialize_blueprints(self) -> dict[str, Any]:
        created = 0
        for relative, content in SCHEMA_BLUEPRINTS.items():
            if not relative.startswith("raw_new/"):
                continue
            target = self.source_root.parent / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                target.write_text(content, encoding="utf-8")
                created += 1
        manifest = self.source_root / ".brain" / "source_records.jsonl"
        manifest.parent.mkdir(parents=True, exist_ok=True)
        if not manifest.exists():
            manifest.write_text("", encoding="utf-8")
            created += 1
        return {"root": str(self.source_root), "created": created}

    def load_directory_schema(self, directory: Path) -> DirectorySchema:
        resolved = directory.resolve()
        if resolved in self._dir_cache:
            return self._dir_cache[resolved]
        schema_path = resolved / "_dir_schema.yaml"
        if not schema_path.exists():
            schema_path = self.root_schema_path
        payload = parse_schema_text(schema_path.read_text(encoding="utf-8")) if schema_path.exists() else {}
        schema = DirectorySchema(path=schema_path, payload=payload)
        self._dir_cache[resolved] = schema
        return schema

    def load_profile(self, profile_name: str) -> dict[str, Any]:
        path = self.profile_root / f"{profile_name}.yaml"
        if not path.exists():
            return {}
        return parse_schema_text(path.read_text(encoding="utf-8"))

    def resolve_route(self, relative_path: str) -> str | None:
        if self._route_cache is None:
            payload = parse_schema_text(self.compiler_routes_path.read_text(encoding="utf-8")) if self.compiler_routes_path.exists() else {}
            self._route_cache = payload.get("routes", [])
        normalized = relative_path.replace("\\", "/")
        for route in self._route_cache or []:
            match = route.get("match")
            if not isinstance(match, dict):
                match = {
                    "directory": route.get("directory"),
                    "ext": route.get("ext"),
                }
            directory = match.get("directory")
            ext = match.get("ext")
            if directory and not normalized.startswith(directory):
                continue
            if ext and not normalized.endswith(f".{ext}"):
                continue
            pipeline = route.get("pipeline")
            if pipeline:
                return str(pipeline)
        return None

    def schema_metadata_for(self, relative_path: str) -> dict[str, Any]:
        target_path = self.source_root.parent / relative_path
        schema = self.load_directory_schema(target_path.parent)
        payload = schema.payload
        route = self.resolve_route(relative_path) or payload.get("routing_policy", {}).get("compiler_pipeline")
        return {
            "schema_path": str(schema.path.relative_to(self.source_root.parent)),
            "schema_route": route,
            "source_family": payload.get("default_source_family", "unclassified"),
            "role_in_pipeline": payload.get("default_role_in_pipeline", "unknown"),
            "authority_level": payload.get("default_authority_level", "medium"),
            "trust_level": payload.get("default_trust_level", "draft"),
            "maturity_level": payload.get("default_maturity_level", "raw"),
            "preferred_outputs": list(payload.get("default_preferred_outputs", [])),
            "not_for_direct_publish": list(payload.get("default_not_for_direct_publish", [])),
            "risk_flags": list(payload.get("default_risk_flags", [])),
            "routing_policy": dict(payload.get("routing_policy", {})),
            "retrieval_policy": dict(payload.get("retrieval_policy", {})),
            "governance_policy": dict(payload.get("governance_policy", {})),
            "domain_profiles": list(payload.get("domain_injection_profile", [])),
            "chunking_policy": dict(payload.get("default_chunking_policy", {})),
            "extraction_priority": dict(payload.get("default_extraction_priority", {})),
        }


def render_search_manifest(paths: list[dict[str, Any]]) -> str:
    return json.dumps({"collections": paths}, ensure_ascii=False, indent=2)
