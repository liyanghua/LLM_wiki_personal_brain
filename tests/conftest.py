from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest

from personal_brain.config import BrainConfig
from personal_brain.ingestion.service import IngestionService
from personal_brain.wiki.compiler import WikiCompiler


PILOT_TITLES = [
    "电商运营本体核心文档",
    "淘天商品全生命周期智能运营AI体",
    "货品全生命周期管理-SUPER指标模型",
    "桌垫类目-儿童学习桌垫单因子测图示例",
    "主干链路SOP",
    "背景选择_访谈日志",
]


def write_docx(path: Path, paragraphs: list[str]) -> None:
    document_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    {paragraphs}
  </w:body>
</w:document>
""".format(
        paragraphs="".join(
            f"<w:p><w:r><w:t>{paragraph}</w:t></w:r></w:p>" for paragraph in paragraphs
        )
    )
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
"""
    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", rels)
        archive.writestr("word/document.xml", document_xml)


def create_workspace(root: Path) -> None:
    for relative in [
        "raw/industry_docs",
        "raw/conversations",
        "raw/links",
        "raw/notes",
        "raw/attachments",
        "raw/.brain",
        "wiki/entities",
        "wiki/topics",
        "wiki/projects",
        "wiki/decisions",
        "wiki/principles",
        "wiki/timelines",
        "wiki/sources",
        "ontology/objects",
        "ontology/relations",
        "ontology/rules",
        "ontology/profiles",
        "ontology/schemas",
        "ontology/evidence_index",
        "ontology/candidates",
        "memory/session",
        "memory/session/summaries",
        "memory/persistent",
        "memory/skills",
        "memory/summaries",
        "skills/candidates",
        "eval/cases",
        "eval/reports",
    ]:
        (root / relative).mkdir(parents=True, exist_ok=True)


@pytest.fixture()
def brain_workspace(tmp_path: Path) -> Path:
    create_workspace(tmp_path)

    industry = tmp_path / "raw" / "industry_docs"
    conversations = tmp_path / "raw" / "conversations"

    (industry / "电商运营本体核心文档.md").write_text(
        "# 电商运营本体核心文档\n\n品牌经营OS强调以人货场协同为核心，重视团队协作、品牌定位和长期运营方法。\n",
        encoding="utf-8",
    )
    (industry / "淘天商品全生命周期智能运营AI体.md").write_text(
        "# 淘天商品全生命周期智能运营AI体\n\n品牌经营OS可以被理解为围绕新品孵化、成长期、成熟期、衰退期的运营闭环。\n",
        encoding="utf-8",
    )
    (industry / "货品全生命周期管理-SUPER指标模型.md").write_text(
        "# 货品全生命周期管理-SUPER指标模型\n\nSUPER指标覆盖优S、高U、新P、准E、快R五个维度，是货品经营诊断框架。\n",
        encoding="utf-8",
    )
    (industry / "桌垫类目-儿童学习桌垫单因子测图示例.md").write_text(
        "# 桌垫类目-儿童学习桌垫单因子测图示例\n\n单因子测图强调产品视角、构图方式、背景选择等变量拆解。\n",
        encoding="utf-8",
    )
    (industry / "6大维度·42个细分变量选择逻辑01.md").write_text(
        (
            "# 6大维度·42个细分变量选择逻辑01\n\n"
            "# 类目专属·穷尽测图变量清单（6大维度·42个细分变量）\n\n"
            "## 维度1：视觉核心层（决定第一眼停留）\n\n"
            "**选择逻辑**：先匹配店铺视觉体系，再匹配目标人群。\n\n"
            "| 变量类别 | 细分变量 | 适配场景 |\n"
            "| --- | --- | --- |\n"
            "| 背景选择 | 纯色背景 | 突出产品质感 |\n"
            "| 产品视角 | 整体全景 | 展示产品完整形态 |\n"
            "| 构图方式 | 三分构图 | 搭配卖点文案 |\n"
            "| 光影色调 | 明亮通透光 | 适配护眼卖点 |\n"
        ),
        encoding="utf-8",
    )
    (industry / "主干链路SOP.md").write_text(
        (
            "---\n"
            "doc_id: sop_mainline_001\n"
            "title: 主干链路SOP\n"
            "doc_type: process_sop\n"
            "source_type: drawio_xml\n"
            "source_file: 主干链路SOP.drawio.xml\n"
            "domain: ecommerce_growth\n"
            "scene: 开品-产品塑造-爆款打造-复盘主干链路\n"
            "language: zh-CN\n"
            "version: v1\n"
            "---\n\n"
            "# 主干链路SOP\n\n"
            "## 文档说明\n\n"
            "- 本文由 draw.io XML 自动归一化生成，面向后续的 LLM + wiki + 图谱/本体生产通道。\n"
            "- 组织原则：优先保留主干业务链路；对表单、分析框、说明框、视觉加工框等辅助节点单独归档。\n\n"
            "## 总体主链路\n\n"
            "1. 类目可行性分析，；确定最优叶子类目\n"
            "2. 确定叶子类目后价格带地图；（店铺+人群）\n"
            "3. 确定叶子类目后的精准需求词分析\n"
            "4. 第一环节结束后，；产品基本定型：；产品满足的人群及人群需求+产品定价的价格带\n"
            "5. 竞品初选表\n"
            "6. 竞品分析表\n"
            "7. 隐性需求调研\n"
            "8. 搭建爆款基因库+爆款因子库\n"
            "9. 产品开发提案\n"
            "10. 产品设计打样（提出差异化开品提案、开发需求）\n"
            "11. 产品营销能力塑造\n"
            "12. 产品上架\n"
            "13. 产品孵化（养款，5条链接起步）\n"
            "14. 产品选款（1-2个好的、确定后重点打爆）\n"
            "15. 打爆过程（打爆策略不一样）\n"
            "16. 复盘\n"
            "17. 爆款放大（单品打爆+关键词打透）\n"
            "18. 全年产品甘特图\n\n"
            "## 第一环节-洞察分析\n\n"
            "### 主链路步骤\n"
            "1. 类目可行性分析，；确定最优叶子类目\n"
            "2. 确定叶子类目后价格带地图；（店铺+人群）\n"
            "3. 确定叶子类目后的精准需求词分析\n"
            "4. 第一环节结束后，；产品基本定型：；产品满足的人群及人群需求+产品定价的价格带\n\n"
            "### 分析分支\n"
            "#### 叶子类目分析\n"
            "- 同叶子类目内的所有店铺分析\n"
            "- 同叶子类目内的所有品牌分析\n"
            "- 地域产业带+供应链分析（某地域可能不能在其他地域做，只能在产业带做大做强。例如鲜花智能在云南、广州）\n\n"
            "#### 价格带分析\n"
            "- 1：分析体量；2：分析利润；   3：分析客单价；      4：分析流量占比；      5：分析成交占比\n"
            "- 市场产品属性分析\n\n"
            "#### 精准需求词分析\n"
            "- 确定核心关键词\n"
            "- 关键词人群分析\n"
            "- 判断和自己的店铺和产品人群是否符合。\n"
            "- 是否有关联人群\n\n"
            "## 第二阶段-产品塑造\n\n"
            "### 主链路步骤\n"
            "1. 竞品初选表\n"
            "2. 竞品分析表\n"
            "3. 隐性需求调研\n"
            "4. 搭建爆款基因库+爆款因子库\n"
            "5. 产品开发提案\n"
            "6. 产品设计打样（提出差异化开品提案、开发需求）\n"
            "7. 产品营销能力塑造\n\n"
            "### 辅助分支\n"
            "#### 竞品初选与立项\n"
            "- 初选：生意参谋找竞品，形成提案\n"
            "- 根据自己产品优势判断要不要对标这个竞品\n"
            "- 确定要做\n"
            "- 头部商家有实力可以直接立项\n"
            "- 立项申请、成本预估\n"
            "- 单关键词多产品\n"
            "- 一套关键词布局多个产品链接\n"
            "- 一个品多关键词\n"
            "- 一个产品通过多套关键词打爆\n\n"
            "## 第三阶段-爆款打造\n\n"
            "### 主链路步骤\n"
            "1. 产品上架\n"
            "2. 产品孵化（养款，5条链接起步）\n"
            "3. 产品选款（1-2个好的、确定后重点打爆）\n"
            "4. 打爆过程（打爆策略不一样）\n\n"
            "## 第四阶段-复盘\n\n"
            "### 主链路步骤\n"
            "1. 复盘\n"
            "2. 爆款放大（单品打爆+关键词打透）\n"
            "3. 全年产品甘特图\n\n"
            "## 备注\n\n"
            "- draw.io 中部分无文字的泳道/容器，已在本文件中按语义重命名。\n"
        ),
        encoding="utf-8",
    )
    (industry / "主干链路SOP.meta.yaml").write_text(
        (
            "doc_id: sop_mainline_001\n"
            "title: 主干链路SOP\n"
            "source_file: 主干链路SOP.drawio.xml\n"
            "normalized_outputs:\n"
            "- 主干链路SOP.md\n"
            "- 主干链路SOP.graph.json\n"
            "- 主干链路SOP.meta.yaml\n"
            "source_type: drawio_xml\n"
            "doc_type: process_sop\n"
            "domain: ecommerce_growth\n"
            "scene: 开品主干链路\n"
            "language: zh-CN\n"
            "production_ready: true\n"
            "mainline_stage_order:\n"
            "- 第一环节-洞察分析\n"
            "- 第二阶段-产品塑造\n"
            "- 第三阶段-爆款打造\n"
            "- 第四阶段-复盘\n"
            "version: v1\n"
        ),
        encoding="utf-8",
    )
    (industry / "主干链路SOP.graph.json").write_text(
        json.dumps(
            {
                "doc_id": "sop_mainline_001",
                "title": "主干链路SOP",
                "stages": [
                    {"id": "stage-1", "label": "第一环节-洞察分析"},
                    {"id": "stage-2", "label": "第二阶段-产品塑造"},
                    {"id": "stage-3", "label": "第三阶段-爆款打造"},
                    {"id": "stage-4", "label": "第四阶段-复盘"},
                ],
                "nodes": [
                    {"id": "step-1", "label": "类目可行性分析，确定最优叶子类目", "stage": "第一环节-洞察分析"},
                    {"id": "step-1-2", "label": "确定叶子类目后价格带地图\n（店铺+人群）", "stage": "第一环节-洞察分析"},
                    {"id": "step-1-3", "label": "确定叶子类目后的精准需求词分析", "stage": "第一环节-洞察分析"},
                    {
                        "id": "step-1-4",
                        "label": "第一环节结束后，\n产品基本定型：\n产品满足的人群及人群需求+产品定价的价格带",
                        "stage": "第一环节-洞察分析",
                    },
                    {"id": "step-2", "label": "产品营销能力塑造", "stage": "第二阶段-产品塑造"},
                    {"id": "step-3", "label": "产品上架", "stage": "第三阶段-爆款打造"},
                    {"id": "step-4", "label": "复盘", "stage": "第四阶段-复盘"},
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (conversations / "背景选择_访谈日志.md").write_text(
        "# 背景选择_访谈日志\n\n背景选择需要兼顾平台点击效率、主体清晰度和场景代入感。\n",
        encoding="utf-8",
    )
    write_docx(
        conversations / "背景选择_访谈日志.docx",
        ["背景选择_访谈日志", "背景选择需要兼顾主体清晰度和点击效率。"],
    )
    (industry / "broken.doc").write_bytes(b"not-a-real-doc")

    pilot = tmp_path / "raw" / ".brain" / "pilot_titles.json"
    pilot.write_text(json.dumps(PILOT_TITLES, ensure_ascii=False, indent=2), encoding="utf-8")

    (tmp_path / "memory" / "persistent" / "profile.json").write_text(
        json.dumps(
            {
                "profile_id": "default-grounded",
                "preferred_answer_structure": [
                    "fact",
                    "synthesis",
                    "interpretation",
                    "recommendation",
                ],
                "abstraction_level": "balanced",
                "actionability_preference": "medium",
                "citation_preference": "high",
                "favored_output_forms": ["markdown"],
                "reuse_preference": "proposal-first",
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    for name, payload in {
        "interests.json": [],
        "principles.json": [],
        "open_loops.json": [],
    }.items():
        (tmp_path / "memory" / "persistent" / name).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    (tmp_path / "eval" / "cases" / "step3_asset_value.json").write_text(
        json.dumps(
            {
                "case_id": "step3-asset-value",
                "question": "品牌经营OS和SUPER指标之间是什么关系？",
                "expected_writeback_targets": ["wiki/decisions/", "wiki/topics/"],
                "expected_candidate_types": ["Topic", "Concept", "Evidence"],
                "expected_skill_families": ["topic_synthesis"],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    return tmp_path


@pytest.fixture()
def built_brain_workspace(brain_workspace: Path) -> Path:
    config = BrainConfig(root=brain_workspace)
    IngestionService(config).ingest_paths(
        [
            brain_workspace / "raw" / "industry_docs",
            brain_workspace / "raw" / "conversations",
        ]
    )
    WikiCompiler(config).build()
    return brain_workspace
