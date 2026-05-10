from __future__ import annotations

from personal_brain.config import BrainConfig
from personal_brain.models import PageCandidate, WikiPage
from personal_brain.utils.frontmatter import parse_frontmatter


class WikiPageStore:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.paths = config.paths

    def load_candidates(self) -> list[PageCandidate]:
        candidates: list[PageCandidate] = []
        for relative in self._load_candidates_from_index():
            page = self.load_by_path(relative)
            if page is not None:
                candidates.append(page)
        return candidates

    def load_by_path(self, relative: str) -> PageCandidate | None:
        if relative.startswith("wiki/"):
            path = self.paths.wiki.parent / relative
        else:
            path = self.config.root / relative
        if not path.exists():
            return None
        metadata, body = parse_frontmatter(path.read_text(encoding="utf-8"))
        if not metadata:
            return None
        try:
            metadata["path"] = str(path.resolve().relative_to(self.config.root.resolve()))
        except ValueError:
            metadata["path"] = str(path.relative_to(self.paths.wiki.parent))
        page = WikiPage.model_validate(metadata)
        return PageCandidate(page=page, body=body)

    def load_by_identifier(self, page_id: str) -> PageCandidate | None:
        for candidate in self.load_candidates():
            if candidate.page.page_id == page_id or candidate.page.path == page_id:
                return candidate
        return None

    def by_path(self) -> dict[str, PageCandidate]:
        return {candidate.page.path: candidate for candidate in self.load_candidates()}

    def _load_candidates_from_index(self) -> list[str]:
        if not self.paths.wiki_index.exists():
            return []
        candidates: list[str] = []
        for line in self.paths.wiki_index.read_text(encoding="utf-8").splitlines():
            if "](" not in line:
                continue
            try:
                relative = line.split("](", 1)[1].split(")", 1)[0]
            except IndexError:
                continue
            if relative.endswith(".md"):
                candidates.append(f"wiki/{relative.removeprefix('./')}")
        return candidates
