from __future__ import annotations

import json
from pathlib import Path

from personal_brain.config import BrainConfig
from personal_brain.ingestion.parsers import parse_path
from personal_brain.ingestion.service import IngestionService
from personal_brain.models import BuildResult, SourceRecord, WikiPage
from personal_brain.retrieval.search_provider import SearchIndexManager
from personal_brain.utils.files import utc_now
from personal_brain.utils.frontmatter import render_frontmatter
from personal_brain.utils.text import normalize_title, slugify_title, summarize_text
from personal_brain.wiki.normalize_service import NormalizeService
import re


class WikiCompiler:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.paths = config.paths
        self.ingestion_service = IngestionService(config)
        self.normalize_service = NormalizeService(config)

    def build(self) -> BuildResult:
        records = [record for record in self.ingestion_service.load_records() if record.is_primary_variant]
        source_pages = [self._write_source_page(record) for record in records]
        if self.config.schema_enabled:
            derived_pages, candidate_artifacts = self._write_schema_driven_pages(records)
        else:
            derived_pages = self._write_derived_pages(records)
            candidate_artifacts = []
        all_pages = source_pages + derived_pages
        self._write_index(all_pages)
        SearchIndexManager(self.config).refresh()
        self._append_log(
            "build-wiki",
            f"generated {len(source_pages)} source pages and {len(derived_pages)} derived pages"
            + (f" and {len(candidate_artifacts)} candidate artifacts" if candidate_artifacts else ""),
        )
        compile_backend = self._resolve_compile_backend(records)
        compile_model = self._resolve_compile_model(records)
        fallback_count = sum(1 for record in records if record.compile_mode != "litellm")
        return BuildResult(
            source_pages=source_pages,
            derived_pages=derived_pages,
            candidate_artifacts=candidate_artifacts,
            compile_backend=compile_backend,
            compile_model=compile_model,
            fallback_count=fallback_count,
        )

    def _resolve_compile_backend(self, records: list[SourceRecord]) -> str:
        backends = [record.compile_backend for record in records if record.compile_backend]
        if not backends:
            return self.config.compile_backend
        if "litellm" in backends:
            return "litellm"
        return backends[0]

    def _resolve_compile_model(self, records: list[SourceRecord]) -> str:
        models = [record.compile_model for record in records if record.compile_model]
        if models:
            return models[0]
        if self.config.compile_backend == "litellm":
            return self.config.litellm_model
        return ""

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
            schema_route=record.schema_route or ("process_attachment_compile" if (record.process_stage_id or record.process_step_id) else None),
            source_family=record.source_family,
            confidence=0.95 if not record.parse_error else 0.4,
            governance_status="draft",
            retrieval_tags=self._retrieval_tags(record),
        )
        body = [
            f"# {record.title}",
            "",
            f"- Source path: `{record.path}`",
            f"- Source type: `{record.source_type}`",
            f"- Logical source id: `{record.logical_source_id}`",
            f"- Schema route: `{record.schema_route}`",
            f"- Source family: `{record.source_family}`",
            f"- Checksum: `{record.checksum}`",
            "",
            "## Summary",
            summary,
        ]
        if record.parse_error:
            body.extend(["", "## Parse Status", f"Parser error: {record.parse_error}"])
        self._write_page(page, "\n".join(body) + "\n")
        return page

    def _write_schema_driven_pages(self, records: list[SourceRecord]) -> tuple[list[WikiPage], list[str]]:
        derived: list[WikiPage] = []
        candidate_artifacts: list[str] = []
        process_records = [record for record in records if record.canonical_asset_type == "ProcessFlow"]
        if process_records:
            derived.extend(self._materialize_process_spine(process_records[0], records))
        for record in records:
            route = record.schema_route or ""
            family = record.source_family
            if record.canonical_asset_type == "ProcessFlow":
                continue
            if family == "domain_knowledge" and route in {"direct_rule_compile", "direct_or_graph_mixed"}:
                derived.append(self._materialize_industry_page(record))
                continue
            if family == "quantitative_data":
                derived.append(self._materialize_data_page(record))
                continue
            if family == "elicitation_trace":
                candidate_artifacts.append(self._materialize_conversation_candidate(record))
                continue
            if family in {"supporting_evidence", "working_notes", "source_registry"}:
                candidate_artifacts.append(self._materialize_candidate_stub(record))
        return derived, candidate_artifacts

    def _write_derived_pages(self, records: list[SourceRecord]) -> list[WikiPage]:
        pilot_titles = {normalize_title(title) for title in self.config.load_pilot_titles()}
        by_id = {record.logical_source_id: record for record in records}
        derived: list[WikiPage] = []
        process_records = [record for record in records if record.canonical_asset_type == "ProcessFlow"]
        if process_records:
            derived.extend(self._materialize_process_spine(process_records[0], records))

        for record in records:
            if record.canonical_asset_type == "ProcessFlow":
                continue
            if record.process_stage_id or record.process_step_id:
                derived.append(self._materialize_industry_page(record))

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
            schema_route=None,
            source_family="legacy",
            confidence=0.7,
            governance_status="draft",
            retrieval_tags=[],
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
        full_path = self.paths.wiki.parent / page.path
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text(f"{metadata}\n\n{body}", encoding="utf-8")

    def _safe_text(self, record: SourceRecord) -> str:
        if record.parse_error:
            return ""
        try:
            return parse_path(self.config.root / record.path)
        except Exception:
            return ""

    def _materialize_industry_page(self, record: SourceRecord) -> WikiPage:
        text = self._safe_text(record)
        summary = self._compile_summary(record, text)
        title = record.title
        slug = slugify_title(title)
        page = WikiPage(
            page_id=f"topic-{normalize_title(title)}",
            page_type="topic",
            title=title,
            path=f"wiki/topics/{slug}.md",
            summary=summary,
            source_refs=[record.path],
            links_to=[f"wiki/sources/{slug}.md"],
            updated_at=utc_now(),
            schema_route=record.schema_route or ("process_attachment_compile" if (record.process_stage_id or record.process_step_id) else None),
            source_family=record.source_family,
            confidence=0.72,
            governance_status="draft",
            retrieval_tags=self._retrieval_tags(record),
            linked_stage=record.process_stage_id or None,
            linked_step=record.process_step_id or None,
        )
        body_lines = [
            f"# {title}",
            "",
            "## Compiled Summary",
            summary,
        ]
        if record.process_stage_id:
            body_lines.extend(["", f"linked_stage: {record.process_stage_id}"])
        if record.process_step_id:
            body_lines.extend(["", f"linked_step: {record.process_step_id}"])
        dimension_line = self._extract_dimension_line(text)
        if dimension_line:
            body_lines.extend(["", "## Key Evidence", f"- {dimension_line}"])
        process_outline = self._extract_process_outline(text)
        if process_outline:
            body_lines.extend(["", "## 主链路步骤", *[f"{index}. {item}" for index, item in enumerate(process_outline, start=1)]])
        body_lines.extend(["", "## Source Refs", f"- `{record.path}`"])
        self._write_page(page, "\n".join(body_lines) + "\n")
        return page

    def _materialize_process_spine(self, record: SourceRecord, records: list[SourceRecord]) -> list[WikiPage]:
        text = self._safe_text(record)
        graph = self._load_process_graph(record)
        stage_labels, overall_steps, stage_steps = self._extract_process_markdown_outline(text)
        graph_stage_labels = [item["label"] for item in graph.get("stages", []) if item.get("label")]
        graph_stage_steps = self._graph_stage_steps(graph)
        if not stage_labels:
            stage_labels = graph_stage_labels
        for label in graph_stage_labels:
            if label not in stage_labels:
                stage_labels.append(label)
        if not stage_steps:
            stage_steps = graph_stage_steps
        else:
            for label, steps in graph_stage_steps.items():
                stage_steps.setdefault(label, list(steps))
        if not overall_steps:
            overall_steps = [step for label in stage_labels for step in stage_steps.get(label, [])]
        pages: list[WikiPage] = []

        overview = WikiPage(
            page_id="process-mainline-sop",
            page_type="process",
            title="主干链路SOP",
            path="wiki/主干链路SOP.md",
            summary="开品主干链路的 canonical process spine，总领阶段、步骤与挂载知识。",
            source_refs=[record.path],
            links_to=[f"wiki/stages/{label}.md" for label in stage_labels],
            updated_at=utc_now(),
            schema_route="process_spine_compile",
            source_family=record.source_family,
            confidence=0.96,
            governance_status="draft",
            retrieval_tags=["process-nav"],
            stage_id="主干链路SOP",
            stage_order=stage_labels,
        )
        overview_lines = [
            "# 主干链路SOP",
            "",
            "## Stage Order",
            "stage_order:",
            *[f"- {label}" for label in stage_labels],
            "",
            "## 主链路步骤",
            *[f"{index}. {item}" for index, item in enumerate(overall_steps, start=1)],
        ]
        if stage_steps:
            overview_lines.extend(
                [
                    "",
                    "## 阶段拆解",
                    *self._render_stage_outline_from_steps(stage_labels, stage_steps),
                ]
            )
        overview_lines.extend(
            [
                "",
            "## Source Refs",
            f"- `{record.path}`",
            ]
        )
        self._write_page(overview, "\n".join(overview_lines) + "\n")
        pages.append(overview)

        for label in stage_labels:
            step_titles = stage_steps.get(label, [])
            stage_page = WikiPage(
                page_id=f"stage-{normalize_title(label)}",
                page_type="stage",
                title=label,
                path=f"wiki/stages/{label}.md",
                summary=f"{label} 的主干步骤与相关挂载知识。",
                source_refs=[record.path],
                links_to=["wiki/主干链路SOP.md", *[f"wiki/steps/{title}.md" for title in step_titles[:8]]],
                updated_at=utc_now(),
                schema_route="process_spine_compile",
                source_family=record.source_family,
                confidence=0.92,
                governance_status="draft",
                retrieval_tags=["process-stage"],
                stage_id=label,
                linked_steps=step_titles,
            )
            stage_lines = [
                f"# {label}",
                "",
                f"stage_id: {label}",
                "",
                "linked_steps:",
                *[f"- {title}" for title in step_titles],
            ]
            if step_titles:
                stage_lines.extend(
                    [
                        "",
                        "## 主链路步骤",
                        *[f"{index}. {title}" for index, title in enumerate(step_titles, start=1)],
                    ]
                )
            stage_lines.extend(
                [
                "",
                "## Source Refs",
                f"- `{record.path}`",
                ]
            )
            self._write_page(stage_page, "\n".join(stage_lines) + "\n")
            pages.append(stage_page)

            for title in step_titles:
                step_page = WikiPage(
                    page_id=f"step-{normalize_title(title)}",
                    page_type="step",
                    title=title,
                    path=f"wiki/steps/{title}.md",
                    summary=f"{label} 下的关键步骤：{title}",
                    source_refs=[record.path],
                    links_to=[f"wiki/stages/{label}.md", "wiki/主干链路SOP.md"],
                    updated_at=utc_now(),
                    schema_route="process_spine_compile",
                    source_family=record.source_family,
                    confidence=0.88,
                    governance_status="draft",
                    retrieval_tags=["process-step"],
                    stage_id=label,
                    step_id=title,
                    linked_stage=label,
                )
                step_lines = [
                    f"# {title}",
                    "",
                    f"linked_stage: {label}",
                    "",
                    "## 支撑证据",
                    f"- `{record.path}`",
                    "",
                    "## Source Refs",
                    f"- `{record.path}`",
                ]
                self._write_page(step_page, "\n".join(step_lines) + "\n")
                pages.append(step_page)

        process_index = WikiPage(
            page_id="index-process-sop",
            page_type="index",
            title="process_sop_index",
            path="wiki/index/process_sop_index.md",
            summary="主干链路 SOP 的 process 导航索引。",
            source_refs=[record.path],
            links_to=["wiki/主干链路SOP.md", *[f"wiki/stages/{label}.md" for label in stage_labels]],
            updated_at=utc_now(),
            schema_route="process_spine_compile",
            source_family=record.source_family,
            confidence=0.9,
            governance_status="draft",
            retrieval_tags=["process-index"],
        )
        process_index_lines = [
            "# process_sop_index",
            "",
            "- [主干链路SOP](../主干链路SOP.md)",
            *[f"- [{label}](../stages/{label}.md)" for label in stage_labels],
        ]
        step_titles = [step for label in stage_labels for step in stage_steps.get(label, [])]
        if step_titles:
            process_index_lines.extend(["", "## Steps", *[f"- [{title}](../steps/{title}.md)" for title in step_titles]])
        relevant_titles = [
            item.title
            for item in records
            if item.path != record.path and (item.process_stage_id or item.process_step_id)
        ]
        if relevant_titles:
            process_index_lines.extend(["", "## Attached Knowledge", *[f"- {title}" for title in relevant_titles]])
        self._write_page(process_index, "\n".join(process_index_lines) + "\n")
        pages.append(process_index)
        return pages

    def _materialize_data_page(self, record: SourceRecord) -> WikiPage:
        text = self._safe_text(record)
        summary = summarize_text(text, limit=2) if text else record.title
        title = record.title
        slug = slugify_title(title)
        page = WikiPage(
            page_id=f"metric-{normalize_title(title)}",
            page_type="topic",
            title=title,
            path=f"wiki/topics/{slug}.md",
            summary=summary,
            source_refs=[record.path],
            links_to=[f"wiki/sources/{slug}.md"],
            updated_at=utc_now(),
            schema_route=record.schema_route,
            source_family=record.source_family,
            confidence=0.7,
            governance_status="draft",
            retrieval_tags=self._retrieval_tags(record),
        )
        self._write_page(page, f"# {title}\n\n{summary}\n\n## Source Refs\n- `{record.path}`\n")
        return page

    def _materialize_conversation_candidate(self, record: SourceRecord) -> str:
        candidate_path = self.paths.memory / "candidates" / f"{slugify_title(record.title)}.md"
        candidate_path.parent.mkdir(parents=True, exist_ok=True)
        summary = summarize_text(self._safe_text(record), limit=2)
        candidate_path.write_text(
            "\n".join(
                [
                    f"# {record.title}",
                    "",
                    f"- source_family: {record.source_family}",
                    f"- schema_route: {record.schema_route}",
                    "",
                    "## Interview Summary",
                    summary,
                ]
            )
            + "\n",
            encoding="utf-8",
        )
        return str(candidate_path.relative_to(self.config.root))

    def _materialize_candidate_stub(self, record: SourceRecord) -> str:
        candidate_path = self.paths.memory / "candidates" / f"{slugify_title(record.title)}.json"
        candidate_path.parent.mkdir(parents=True, exist_ok=True)
        candidate_path.write_text(
            render_frontmatter(
                {
                    "title": record.title,
                    "source_path": record.path,
                    "source_family": record.source_family,
                    "schema_route": record.schema_route,
                }
            ),
            encoding="utf-8",
        )
        return str(candidate_path.relative_to(self.config.root))

    def _extract_dimension_line(self, text: str) -> str | None:
        for line in text.splitlines():
            cleaned = line.strip()
            if cleaned.startswith("## "):
                cleaned = cleaned[3:].strip()
            if "维度1：" in cleaned:
                return cleaned
        return None

    def _extract_process_outline(self, text: str) -> list[str]:
        outline: list[str] = []
        for raw in text.splitlines():
            line = raw.strip()
            if not line:
                continue
            if line[:2].isdigit() and "." in line[:4]:
                outline.append(line.split(".", 1)[1].strip())
                continue
            if line.startswith(("1.", "2.", "3.", "4.", "5.", "6.", "7.", "8.", "9.")):
                outline.append(line.split(".", 1)[1].strip())
        return outline[:8]

    def _render_stage_outline_from_steps(self, stage_labels: list[str], stage_steps: dict[str, list[str]]) -> list[str]:
        lines: list[str] = []
        for stage in stage_labels:
            steps = stage_steps.get(stage, [])
            if not steps:
                continue
            lines.append(f"### {stage}")
            lines.extend([f"{index}. {label}" for index, label in enumerate(steps, start=1)])
            lines.append("")
        return lines[:-1] if lines else []

    def _extract_process_markdown_outline(self, text: str) -> tuple[list[str], list[str], dict[str, list[str]]]:
        body = self._strip_frontmatter(text)
        if not body.strip():
            return [], [], {}

        stage_labels: list[str] = []
        overall_steps: list[str] = []
        stage_steps: dict[str, list[str]] = {}
        current_stage = ""
        current_section = ""
        in_stage_mainline = False

        for raw in body.splitlines():
            stripped = raw.strip()
            if not stripped:
                continue
            if stripped.startswith("## "):
                heading = stripped[3:].strip()
                in_stage_mainline = False
                if heading == "总体主链路":
                    current_section = "overall"
                    current_stage = ""
                    continue
                if self._is_process_stage_heading(heading):
                    current_section = "stage"
                    current_stage = heading
                    if heading not in stage_labels:
                        stage_labels.append(heading)
                    stage_steps.setdefault(heading, [])
                    continue
                current_section = ""
                current_stage = ""
                continue
            if stripped.startswith("### "):
                subheading = stripped[4:].strip()
                in_stage_mainline = bool(current_stage) and subheading == "主链路步骤"
                continue

            step = self._parse_process_step_line(stripped)
            if not step:
                continue
            if current_section == "overall":
                overall_steps.append(step)
            elif current_stage and in_stage_mainline:
                stage_steps.setdefault(current_stage, []).append(step)

        deduped_stage_steps = {label: self._dedupe_steps(stage_steps.get(label, [])) for label in stage_labels}
        return stage_labels, self._dedupe_steps(overall_steps), deduped_stage_steps

    def _graph_stage_steps(self, graph: dict) -> dict[str, list[str]]:
        grouped: dict[str, list[str]] = {}
        for node in graph.get("nodes", []):
            if node.get("kind") == "container":
                continue
            stage = str(node.get("stage", "")).strip()
            label = self._clean_process_step(str(node.get("label", "")))
            if stage and label:
                grouped.setdefault(stage, []).append(label)
        return {stage: self._dedupe_steps(steps) for stage, steps in grouped.items()}

    def _strip_frontmatter(self, text: str) -> str:
        lines = text.splitlines()
        if lines and lines[0].strip() == "---":
            for index in range(1, len(lines)):
                if lines[index].strip() == "---":
                    return "\n".join(lines[index + 1 :])
        return text

    def _is_process_stage_heading(self, heading: str) -> bool:
        return bool(heading) and heading not in {"文档说明", "总体主链路", "关键中间产物 / 表单", "备注"} and (
            "环节" in heading or "阶段" in heading or "复盘" in heading
        )

    def _parse_process_step_line(self, line: str) -> str | None:
        match = re.match(r"^\d+\.\s*(.+)$", line)
        if not match:
            return None
        cleaned = self._clean_process_step(match.group(1))
        return cleaned or None

    def _clean_process_step(self, value: str) -> str:
        cleaned = value.replace("\n", " ").replace("；", "")
        cleaned = re.sub(r"\s+", " ", cleaned).strip(" -")
        cleaned = re.sub(r"\s+([（(])", r"\1", cleaned)
        cleaned = re.sub(r"([）)])\s+", r"\1", cleaned)
        return cleaned.strip()

    def _dedupe_steps(self, steps: list[str]) -> list[str]:
        deduped: list[str] = []
        seen: set[str] = set()
        for step in steps:
            if not step or step in seen:
                continue
            seen.add(step)
            deduped.append(step)
        return deduped

    def _compile_summary(self, record: SourceRecord, text: str) -> str:
        if record.compile_mode == "llm_object_compile":
            dimension = self._extract_dimension_line(text)
            if dimension:
                return f"{record.title} 的首要结论是：{dimension}。"
            outline = self._extract_process_outline(text)
            if outline:
                return f"{record.title} 以流程主链路为主，优先包括：{'；'.join(outline[:3])}。"
        return summarize_text(text, limit=2) if text else record.title

    def _retrieval_tags(self, record: SourceRecord) -> list[str]:
        tags: list[str] = []
        if not record.retrieval_policy.get("searchable_in_qa", True):
            tags.append("interview-only")
        if record.routing_policy.get("wiki_write_mode") == "candidate_only":
            tags.append("candidate-only")
        if record.retrieval_policy.get("require_scope_check"):
            tags.append("scope-check")
        return tags

    def _load_process_graph(self, record: SourceRecord) -> dict:
        source_path = self.config.root / record.path
        graph_path = source_path.with_suffix(".graph.json")
        if graph_path.exists():
            return json.loads(graph_path.read_text(encoding="utf-8"))
        return {"stages": [], "nodes": []}
