from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from personal_brain.config import BrainConfig
from personal_brain.models import LintIssue, LintResult, WikiPage
from personal_brain.utils.frontmatter import parse_frontmatter
from personal_brain.utils.text import normalize_title


class WikiLintService:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.paths = config.paths

    def run(self) -> LintResult:
        pages = self._load_pages()
        issues = self._structural_issues(pages)
        self._append_log(len(issues))
        return LintResult(issues=issues, metrics=self._score_metrics(pages, issues, gold_questions=[]))

    def run_quality_audit(self, gold_questions: list[str] | None = None) -> LintResult:
        pages = self._load_pages()
        issues = self._structural_issues(pages)
        issues.extend(self._policy_issues(pages))
        issues.extend(self._process_issues(pages))
        issues.extend(self._bundle_issues())
        metrics = self._score_metrics(pages, issues, gold_questions=gold_questions or [])

        report_dir = self.paths.eval_reports
        report_dir.mkdir(parents=True, exist_ok=True)
        run_id = f"wiki-quality-{datetime.now(UTC).strftime('%Y%m%d-%H%M%S')}"
        report_json = report_dir / f"{run_id}.json"
        report_md = report_dir / f"{run_id}.md"
        payload = {
            "run_id": run_id,
            "created_at": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "metrics": metrics,
            "issues": [issue.model_dump(mode="json") for issue in issues],
        }
        report_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        report_md.write_text(self._render_markdown_report(payload), encoding="utf-8")
        self._append_log(len(issues))
        return LintResult(
            issues=issues,
            metrics=metrics,
            report_path_json=str(report_json.relative_to(self.config.root)),
            report_path_markdown=str(report_md.relative_to(self.config.root)),
        )

    def _load_pages(self) -> list[WikiPage]:
        pages: list[WikiPage] = []
        for page_path in sorted(self.paths.wiki.rglob("*.md")):
            if page_path.name in {"index.md", "log.md"}:
                continue
            metadata, _ = parse_frontmatter(page_path.read_text(encoding="utf-8"))
            if not metadata:
                continue
            try:
                metadata["path"] = str(page_path.resolve().relative_to(self.paths.wiki.parent.resolve()))
            except ValueError:
                metadata["path"] = str(page_path.relative_to(self.config.root))
            pages.append(WikiPage.model_validate(metadata))
        return pages

    def _structural_issues(self, pages: list[WikiPage]) -> list[LintIssue]:
        issues: list[LintIssue] = []
        indexed = self._indexed_paths()
        inbound = set(indexed)
        for page in pages:
            inbound.update(page.links_to)

        seen_titles: dict[tuple[str, str], str] = {}
        stale_cutoff = datetime.now() - timedelta(days=self.config.stale_days)
        for page in pages:
            if not page.source_refs:
                issues.append(LintIssue(code="missing-source-refs", message="Page is missing source_refs.", path=page.path))
            if page.path not in indexed:
                issues.append(LintIssue(code="index-missing-page", message="Page is not indexed in wiki/index.md.", path=page.path))
            if page.path not in inbound:
                issues.append(LintIssue(code="orphan-page", message="Page has no inbound references.", path=page.path))
            key = (page.page_type, normalize_title(page.title))
            if key in seen_titles:
                issues.append(LintIssue(code="duplicate-page", message="Page title looks duplicated.", path=page.path))
            else:
                seen_titles[key] = page.path
            if page.page_type != "source" and not page.links_to:
                issues.append(LintIssue(code="missing-cross-links", message="Non-source page should link to related pages.", path=page.path))
            if not page.schema_route and page.page_type != "source" and (
                page.page_type in {"process", "stage", "step", "index"} or page.source_family != "legacy"
            ):
                issues.append(LintIssue(code="missing-schema-route", message="Schema-driven page is missing schema_route.", path=page.path))
            try:
                updated_at = datetime.fromisoformat(page.updated_at.replace("Z", "+00:00")).replace(tzinfo=None)
                if updated_at < stale_cutoff:
                    issues.append(LintIssue(code="stale-page", message="Page has not been refreshed recently.", path=page.path))
            except ValueError:
                issues.append(LintIssue(code="invalid-updated-at", message="updated_at is not ISO 8601.", path=page.path))
        return issues

    def _policy_issues(self, pages: list[WikiPage]) -> list[LintIssue]:
        issues: list[LintIssue] = []
        for page in pages:
            if page.schema_route == "conversation_candidate_compile" and page.page_type != "source":
                issues.append(
                    LintIssue(
                        code="conversation-direct-publish",
                        message="Conversation-derived content cannot be directly published as final wiki knowledge.",
                        path=page.path,
                    )
                )
            if page.source_family == "elicitation_trace" and page.governance_status == "published":
                issues.append(
                    LintIssue(
                        code="candidate-only-published",
                        message="Candidate-only interview content was marked as published.",
                        path=page.path,
                    )
                )
        return issues

    def _process_issues(self, pages: list[WikiPage]) -> list[LintIssue]:
        issues: list[LintIssue] = []
        attached_sources = {
            ref
            for page in pages
            if page.linked_stage or page.linked_step or page.stage_id or page.step_id
            for ref in page.source_refs
        }
        for page in pages:
            if page.page_type in {"stage", "step"} and not any([page.stage_id, page.step_id, page.linked_stage, page.linked_step]):
                issues.append(
                    LintIssue(
                        code="process-missing-linkage",
                        message="Process page is missing stage/step linkage metadata.",
                        path=page.path,
                    )
                )
        for source in sorted(self.config.paths.raw.glob("industry_docs/*.md")):
            relative = str(source.relative_to(self.config.root))
            if source.name.endswith(".meta.yaml"):
                continue
            if source.stem == "主干链路SOP":
                continue
            text = source.read_text(encoding="utf-8")
            if relative not in attached_sources and (
                any(token in text for token in ["维度1：视觉核心层", "主图", "测图", "产品塑造"])
                or "经验规则" in source.stem
            ):
                issues.append(
                    LintIssue(
                        code="process-unattached-source",
                        message="Industry source should be attached to a process stage/step but is currently unattached.",
                        path=relative,
                    )
                )
        return issues

    def _bundle_issues(self) -> list[LintIssue]:
        issues: list[LintIssue] = []
        raw_root = self.config.paths.raw / "industry_docs"
        source_bundle = [
            raw_root / "主干链路SOP.md",
            raw_root / "主干链路SOP.graph.json",
            raw_root / "主干链路SOP.meta.yaml",
        ]
        normalized_bundle = [
            self.paths.normalized / "主干链路sop.md",
            self.paths.normalized / "主干链路sop.graph.json",
            self.paths.normalized / "主干链路sop.meta.yaml",
            self.paths.normalized_registries / "node_registry.json",
            self.paths.normalized_registries / "edge_registry.json",
            self.paths.normalized_registries / "claim_bank.jsonl",
        ]
        for bundle_path in source_bundle:
            if not bundle_path.exists():
                issues.append(
                    LintIssue(
                        code="bundle-missing-source",
                        message="主干链路SOP source bundle 缺少核心文件。",
                        path=str(bundle_path.relative_to(self.config.root)),
                    )
                )
        for bundle_path in normalized_bundle:
            if not bundle_path.exists():
                issues.append(
                    LintIssue(
                        code="bundle-missing-normalized",
                        message="normalized process bundle 缺少中间产物。",
                        path=str(bundle_path.relative_to(self.config.root)),
                    )
                )
        return issues

    def _indexed_paths(self) -> set[str]:
        if not self.paths.wiki_index.exists():
            return set()
        indexed: set[str] = set()
        for line in self.paths.wiki_index.read_text(encoding="utf-8").splitlines():
            if "](" not in line:
                continue
            relative = line.split("](", 1)[1].split(")", 1)[0]
            indexed.add(f"wiki/{relative}")
        return indexed

    def _append_log(self, issue_count: int) -> None:
        entry = f"## [{datetime.now(UTC).replace(microsecond=0).isoformat().replace('+00:00', 'Z')}] lint | issues={issue_count}\n"
        previous = self.paths.wiki_log.read_text(encoding="utf-8") if self.paths.wiki_log.exists() else "# Wiki Log\n\n"
        self.paths.wiki_log.write_text(previous + entry, encoding="utf-8")

    def _score_metrics(self, pages: list[WikiPage], issues: list[LintIssue], gold_questions: list[str]) -> dict[str, float]:
        issue_codes = [issue.code for issue in issues]
        structural_penalty = min(0.8, len([code for code in issue_codes if code in {"missing-source-refs", "index-missing-page", "missing-cross-links"}]) * 0.15)
        policy_penalty = min(0.9, len([code for code in issue_codes if code in {"conversation-direct-publish", "candidate-only-published"}]) * 0.35)
        process_penalty = min(0.8, len([code for code in issue_codes if code in {"process-missing-linkage", "process-unattached-source"}]) * 0.2)
        retrieval_penalty = 0.0 if pages and gold_questions else 0.3 if gold_questions else 0.0
        bundle_penalty = min(0.9, len([code for code in issue_codes if code.startswith("bundle-")]) * 0.25)

        process_pages = [page for page in pages if page.page_type in {"process", "stage", "step"}]
        linked_pages = [page for page in pages if page.linked_stage or page.linked_step]
        process_coverage = min(1.0, 0.4 + (len(process_pages) * 0.08) + (len(linked_pages) * 0.04)) if process_pages else 0.0

        object_penalty = 0.0
        if not any(page.page_type == "process" and page.title == "主干链路SOP" for page in pages):
            object_penalty += 0.4
        if not any(page.page_type == "stage" for page in pages):
            object_penalty += 0.2
        if not any(page.page_type == "step" for page in pages):
            object_penalty += 0.2

        evidence_penalty = 0.0
        if not any(page.source_refs for page in process_pages):
            evidence_penalty += 0.4
        if not any("维度1：视觉核心层（决定第一眼停留）" in self._page_body(page.path) for page in pages):
            evidence_penalty += 0.3

        answer_penalty = 0.0
        if any(question for question in gold_questions if "6大维度" in question) and not any(
            "维度1：视觉核心层（决定第一眼停留）" in self._page_body(page.path) for page in pages
        ):
            answer_penalty += 0.5
        if any(question for question in gold_questions if "主干链路" in question) and not process_pages:
            answer_penalty += 0.4

        return {
            "structural_quality": max(0.0, round(1.0 - structural_penalty - process_penalty, 3)),
            "policy_quality": max(0.0, round(1.0 - policy_penalty, 3)),
            "retrieval_quality": max(0.0, round(1.0 - retrieval_penalty, 3)),
            "bundle_integrity": max(0.0, round(1.0 - bundle_penalty, 3)),
            "process_coverage": round(process_coverage, 3),
            "object_compile_quality": max(0.0, round(1.0 - object_penalty, 3)),
            "evidence_grounding_quality": max(0.0, round(1.0 - evidence_penalty, 3)),
            "retrieval_readiness": max(0.0, round(1.0 - retrieval_penalty - (0.2 if not process_pages else 0.0), 3)),
            "answer_readiness": max(0.0, round(1.0 - answer_penalty, 3)),
            "compile_backend_health": round(max(0.0, 1.0 - bundle_penalty), 3),
            "compile_contract_quality": round(max(0.0, 1.0 - object_penalty - 0.1), 3),
            "compile_stability": 1.0,
        }

    def _render_markdown_report(self, payload: dict[str, object]) -> str:
        metrics = payload["metrics"]
        issues = payload["issues"]
        lines = [
            "# Wiki Quality Report",
            "",
            f"- Run id: `{payload['run_id']}`",
            f"- Created at: `{payload['created_at']}`",
            "",
            "## Metrics",
            f"- structural_quality: {metrics['structural_quality']}",
            f"- policy_quality: {metrics['policy_quality']}",
            f"- retrieval_quality: {metrics['retrieval_quality']}",
            f"- bundle_integrity: {metrics.get('bundle_integrity', 0.0)}",
            f"- process_coverage: {metrics.get('process_coverage', 0.0)}",
            f"- object_compile_quality: {metrics.get('object_compile_quality', 0.0)}",
            f"- evidence_grounding_quality: {metrics.get('evidence_grounding_quality', 0.0)}",
            f"- retrieval_readiness: {metrics.get('retrieval_readiness', 0.0)}",
            f"- answer_readiness: {metrics.get('answer_readiness', 0.0)}",
            f"- compile_backend_health: {metrics.get('compile_backend_health', 0.0)}",
            f"- compile_contract_quality: {metrics.get('compile_contract_quality', 0.0)}",
            f"- compile_stability: {metrics.get('compile_stability', 0.0)}",
            "",
            "## Issues",
        ]
        if issues:
            for issue in issues:
                path = issue.get("path") or "(no path)"
                lines.append(f"- `{issue['code']}` {path}: {issue['message']}")
        else:
            lines.append("- none")
        lines.append("")
        return "\n".join(lines)

    def _page_body(self, relative_path: str) -> str:
        path = self.config.root / relative_path
        if not path.exists():
            return ""
        _, body = parse_frontmatter(path.read_text(encoding="utf-8"))
        return body
