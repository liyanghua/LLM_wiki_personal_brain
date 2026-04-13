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
        "memory/session",
        "memory/session/summaries",
        "memory/persistent",
        "memory/skills",
        "memory/summaries",
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
