from __future__ import annotations

from pathlib import Path

from personal_brain.config import BrainConfig
from personal_brain.models import SessionRecord, WritebackBundle, WritebackTargetDecision
from personal_brain.utils.files import utc_now
from personal_brain.utils.frontmatter import parse_frontmatter, render_frontmatter
from personal_brain.utils.text import slugify_title


PAGE_TYPES = {
    "topics": "topic",
    "principles": "principle",
    "projects": "project",
    "decisions": "decision",
}


class WritebackMerger:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config

    def apply(self, bundle: WritebackBundle, session_record: SessionRecord) -> list[str]:
        applied: list[str] = []
        for target in bundle.targets:
            if target.approval_status != "approved-for-apply":
                continue
            if not target.target.startswith("wiki/"):
                continue
            self._apply_wiki_target(target, session_record)
            applied.append(target.target)
        return applied

    def _apply_wiki_target(self, target: WritebackTargetDecision, session_record: SessionRecord) -> None:
        path = self.config.root / target.target
        path.parent.mkdir(parents=True, exist_ok=True)
        source_refs = list(dict.fromkeys(source for item in session_record.selected_evidence for source in item.source_refs))
        links_to = list(dict.fromkeys(session_record.ranked_pages[:5] or [item.page_path for item in session_record.selected_evidence]))
        managed_block = self._render_managed_block(session_record, target)

        if path.exists():
            metadata, body = parse_frontmatter(path.read_text(encoding="utf-8"))
            metadata["source_refs"] = self._merge_list(metadata.get("source_refs", []), source_refs)
            metadata["links_to"] = self._merge_list(metadata.get("links_to", []), links_to)
            metadata["updated_at"] = utc_now()
            metadata["approval_status"] = metadata.get("approval_status", "pending")
            metadata["review_todo"] = "TODO(HUMAN_APPROVAL_WORKFLOW)"
            updated_body = self._upsert_managed_section(body, session_record.query_id, managed_block)
        else:
            folder = path.parent.name
            page_type = PAGE_TYPES.get(folder, "decision")
            title = self._title_for_target(path, session_record)
            metadata = {
                "page_id": f"{page_type}-{slugify_title(title)}",
                "page_type": page_type,
                "title": title,
                "path": target.target,
                "summary": session_record.answer_summary,
                "source_refs": source_refs,
                "links_to": links_to,
                "updated_at": utc_now(),
                "approval_status": "pending",
                "review_todo": "TODO(HUMAN_APPROVAL_WORKFLOW)",
            }
            updated_body = "\n".join(
                [
                    f"# {title}",
                    "",
                    session_record.answer_summary,
                    "",
                    "## Managed Writeback Updates",
                    "",
                    managed_block,
                ]
            ).strip() + "\n"

        content = render_frontmatter(metadata) + "\n\n" + updated_body.strip() + "\n"
        path.write_text(content, encoding="utf-8")

    def _render_managed_block(self, session_record: SessionRecord, target: WritebackTargetDecision) -> str:
        lines = [
            f"### {session_record.query_id}",
            "",
            "TODO(HUMAN_APPROVAL_WORKFLOW)",
            "",
            f"- target: `{target.target}`",
            f"- rationale: {target.rationale}",
            f"- confidence: {target.confidence:.2f}",
            f"- long_term_value: {target.long_term_value}",
            "- evidence_refs:",
        ]
        for ref in target.evidence_refs:
            lines.append(f"  - `{ref}`")
        lines.extend(
            [
                "",
                target.content_preview,
            ]
        )
        return "\n".join(lines).strip()

    def _upsert_managed_section(self, body: str, query_id: str, managed_block: str) -> str:
        marker = "## Managed Writeback Updates"
        if marker not in body:
            suffix = "\n\n" if body.strip() else ""
            return body.rstrip() + suffix + marker + "\n\n" + managed_block + "\n"

        before, after = body.split(marker, 1)
        section = after.strip("\n")
        block_marker = f"### {query_id}"
        if block_marker in section:
            prefix, remainder = section.split(block_marker, 1)
            remainder_lines = remainder.splitlines()
            trailing_start = None
            for index, line in enumerate(remainder_lines[1:], start=1):
                if line.startswith("### "):
                    trailing_start = index
                    break
            trailing = "\n".join(remainder_lines[trailing_start:]).strip() if trailing_start is not None else ""
            rebuilt = prefix.rstrip()
            if rebuilt:
                rebuilt += "\n\n"
            rebuilt += managed_block
            if trailing:
                rebuilt += "\n\n" + trailing
        else:
            rebuilt = section.rstrip()
            if rebuilt:
                rebuilt += "\n\n"
            rebuilt += managed_block
        return before.rstrip() + "\n\n" + marker + "\n\n" + rebuilt.strip() + "\n"

    def _merge_list(self, existing: list[str], incoming: list[str]) -> list[str]:
        merged = list(existing)
        for item in incoming:
            if item not in merged:
                merged.append(item)
        return merged

    def _title_for_target(self, path: Path, session_record: SessionRecord) -> str:
        if path.parent.name == "decisions":
            return f"{session_record.user_query} 问答沉淀"
        if path.parent.name == "principles":
            return session_record.user_query
        return path.stem
