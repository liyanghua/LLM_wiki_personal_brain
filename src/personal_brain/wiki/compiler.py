from __future__ import annotations

from pathlib import Path

from personal_brain.config import BrainConfig
from personal_brain.ingestion.parsers import parse_path
from personal_brain.ingestion.service import IngestionService
from personal_brain.models import BuildResult, SourceRecord, WikiPage
from personal_brain.utils.files import utc_now
from personal_brain.utils.frontmatter import render_frontmatter
from personal_brain.utils.text import normalize_title, slugify_title, summarize_text


class WikiCompiler:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.paths = config.paths
        self.ingestion_service = IngestionService(config)

    def build(self) -> BuildResult:
        records = [record for record in self.ingestion_service.load_records() if record.is_primary_variant]
        source_pages = [self._write_source_page(record) for record in records]
        derived_pages = self._write_derived_pages(records)
        all_pages = source_pages + derived_pages
        self._write_index(all_pages)
        self._append_log("build-wiki", f"generated {len(source_pages)} source pages and {len(derived_pages)} derived pages")
        return BuildResult(source_pages=source_pages, derived_pages=derived_pages)

    def _write_source_page(self, record: SourceRecord) -> WikiPage:
        path = self.config.root / record.path
        text = ""
        if not record.parse_error:
            text = parse_path(path)
        summary = summarize_text(text, limit=2) if text else "Source preserved; parser could not extract reliable text yet."
        page = WikiPage(
            page_id=f"source-{record.logical_source_id}",
            page_type="source",
            title=record.title,
            path=f"wiki/sources/{slugify_title(record.title)}.md",
            summary=summary,
            source_refs=[record.path],
            links_to=[],
            updated_at=utc_now(),
        )
        body = [
            f"# {record.title}",
            "",
            f"- Source path: `{record.path}`",
            f"- Source type: `{record.source_type}`",
            f"- Logical source id: `{record.logical_source_id}`",
            f"- Checksum: `{record.checksum}`",
            "",
            "## Summary",
            summary,
        ]
        if record.parse_error:
            body.extend(["", "## Parse Status", f"Parser error: {record.parse_error}"])
        self._write_page(page, "\n".join(body) + "\n")
        return page

    def _write_derived_pages(self, records: list[SourceRecord]) -> list[WikiPage]:
        pilot_titles = {normalize_title(title) for title in self.config.load_pilot_titles()}
        by_id = {record.logical_source_id: record for record in records}
        derived: list[WikiPage] = []

        topic_sources = [
            record
            for record in records
            if record.logical_source_id in pilot_titles
            and any(keyword in (record.title + self._safe_text(record)) for keyword in ["品牌经营OS", "运营AI体", "电商运营"])
        ]
        if topic_sources:
            derived.append(
                self._write_compiled_page(
                    page_type="topic",
                    title="品牌经营OS",
                    relative_path="wiki/topics/品牌经营os.md",
                    summary="围绕人货场协同、生命周期运营和数据驱动的品牌经营方法框架。",
                    records=topic_sources,
                    body_lines=[
                        "# 品牌经营OS",
                        "",
                        "品牌经营OS在当前资料中被描述为一个以人货场协同、全生命周期运营和数据驱动决策为核心的经营框架。",
                        "",
                        "## Key Points",
                        "- 以新品孵化、成长期、成熟期、衰退期构成运营闭环。",
                        "- 用团队协作、品牌定位和货品经营指标支撑长期增长。",
                        "- 强调从洞察、策略、执行到追踪的持续迭代。",
                    ],
                )
            )

        project_sources = [
            record
            for record in records
            if any(keyword in record.title for keyword in ["单因子测图", "背景选择"])
            and record.logical_source_id in pilot_titles
        ]
        if project_sources:
            derived.append(
                self._write_compiled_page(
                    page_type="project",
                    title="儿童学习桌垫单因子测图",
                    relative_path="wiki/projects/儿童学习桌垫单因子测图.md",
                    summary="围绕桌垫类目主图变量拆解的测试项目，重点关注视角、构图和背景。",
                    records=project_sources,
                    body_lines=[
                        "# 儿童学习桌垫单因子测图",
                        "",
                        "该项目聚焦儿童学习桌垫首图点击测试，把产品视角、构图方式、背景选择等因素拆解为独立变量。",
                        "",
                        "## Current Focus",
                        "- 主体清晰度与平台点击效率之间的平衡。",
                        "- 背景选择与使用场景代入感的关系。",
                        "- 在单因子前提下逐步确认高影响状态。",
                    ],
                )
            )

        principle_sources = [
            record
            for record in records
            if any(keyword in (record.title + self._safe_text(record)) for keyword in ["SUPER", "全生命周期", "运营AI体"])
            and record.logical_source_id in pilot_titles
        ]
        if principle_sources:
            derived.append(
                self._write_compiled_page(
                    page_type="principle",
                    title="商品全生命周期运营原则",
                    relative_path="wiki/principles/商品全生命周期运营原则.md",
                    summary="用生命周期视角统筹新品、成熟品和尾货，并以 SUPER 等指标持续诊断货品经营健康度。",
                    records=principle_sources,
                    body_lines=[
                        "# 商品全生命周期运营原则",
                        "",
                        "当前资料共同强调，商品经营不能只盯某个单点阶段，而要把生命周期、数据指标和竞品对标放到一个统一闭环里。",
                        "",
                        "## Principle Statements",
                        "- 新品、成熟品和衰退品需要不同的目标与动作。",
                        "- 货品运营要结合优S、高U、新P、准E、快R等指标持续诊断。",
                        "- 大盘和竞品数据要参与策略生成，而不是只看自身表现。",
                    ],
                )
            )

        if "broken" in by_id:
            pass

        return derived

    def _write_compiled_page(
        self,
        page_type: str,
        title: str,
        relative_path: str,
        summary: str,
        records: list[SourceRecord],
        body_lines: list[str],
    ) -> WikiPage:
        links = [f"wiki/sources/{slugify_title(record.title)}.md" for record in records]
        page = WikiPage(
            page_id=f"{page_type}-{normalize_title(title)}",
            page_type=page_type,
            title=title,
            path=relative_path,
            summary=summary,
            source_refs=[record.path for record in records],
            links_to=links,
            updated_at=utc_now(),
        )
        body_lines.extend(["", "## Source Refs"])
        body_lines.extend([f"- `{record.path}`" for record in records])
        self._write_page(page, "\n".join(body_lines) + "\n")
        return page

    def _write_index(self, pages: list[WikiPage]) -> None:
        grouped: dict[str, list[WikiPage]] = {}
        for page in sorted(pages, key=lambda item: (item.page_type, item.title)):
            grouped.setdefault(page.page_type, []).append(page)
        lines = ["# Wiki Index", "", "This index is the primary routing layer for query-time page selection.", ""]
        for page_type, typed_pages in grouped.items():
            lines.append(f"## {page_type.capitalize()} Pages")
            for page in typed_pages:
                relative = page.path.removeprefix("wiki/")
                lines.append(f"- [{page.title}]({relative}) - {page.summary}")
            lines.append("")
        self.paths.wiki_index.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")

    def _append_log(self, operation: str, detail: str) -> None:
        entry = f"## [{utc_now()}] {operation} | {detail}\n"
        if self.paths.wiki_log.exists():
            previous = self.paths.wiki_log.read_text(encoding="utf-8")
        else:
            previous = "# Wiki Log\n\n"
        self.paths.wiki_log.write_text(previous + entry, encoding="utf-8")

    def _write_page(self, page: WikiPage, body: str) -> None:
        metadata = render_frontmatter(page.model_dump(mode="json"))
        full_path = self.config.root / page.path
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text(f"{metadata}\n\n{body}", encoding="utf-8")

    def _safe_text(self, record: SourceRecord) -> str:
        if record.parse_error:
            return ""
        try:
            return parse_path(self.config.root / record.path)
        except Exception:
            return ""
