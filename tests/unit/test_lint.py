from __future__ import annotations

from personal_brain.config import BrainConfig
from personal_brain.lint.service import WikiLintService


def test_lint_reports_orphans_and_missing_source_refs(brain_workspace) -> None:
    page = brain_workspace / "wiki" / "topics" / "孤立页面.md"
    page.write_text(
        "---\npage_id: lonely-page\npage_type: topic\ntitle: 孤立页面\nsummary: 一个孤立页面\nsource_refs: []\nlinks_to: []\nupdated_at: 2026-04-13T00:00:00Z\n---\n\n# 孤立页面\n",
        encoding="utf-8",
    )
    (brain_workspace / "wiki" / "index.md").write_text("# Wiki Index\n", encoding="utf-8")
    (brain_workspace / "wiki" / "log.md").write_text("# Wiki Log\n", encoding="utf-8")

    result = WikiLintService(BrainConfig(root=brain_workspace)).run()

    codes = {issue.code for issue in result.issues}
    assert "orphan-page" in codes
    assert "missing-source-refs" in codes
    assert "index-missing-page" in codes
