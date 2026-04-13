from __future__ import annotations

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
            try:
                updated_at = datetime.fromisoformat(page.updated_at.replace("Z", "+00:00")).replace(tzinfo=None)
                if updated_at < stale_cutoff:
                    issues.append(LintIssue(code="stale-page", message="Page has not been refreshed recently.", path=page.path))
            except ValueError:
                issues.append(LintIssue(code="invalid-updated-at", message="updated_at is not ISO 8601.", path=page.path))
        self._append_log(len(issues))
        return LintResult(issues=issues)

    def _load_pages(self) -> list[WikiPage]:
        pages: list[WikiPage] = []
        for page_path in sorted(self.paths.wiki.rglob("*.md")):
            if page_path.name in {"index.md", "log.md"}:
                continue
            metadata, _ = parse_frontmatter(page_path.read_text(encoding="utf-8"))
            if not metadata:
                continue
            metadata["path"] = str(page_path.relative_to(self.config.root))
            pages.append(WikiPage.model_validate(metadata))
        return pages

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
