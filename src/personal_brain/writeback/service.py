from __future__ import annotations

import json
from pathlib import Path

from personal_brain.config import BrainConfig
from personal_brain.models import AnswerRecord, WritebackProposal
from personal_brain.utils.files import utc_now
from personal_brain.utils.frontmatter import parse_frontmatter, render_frontmatter
from personal_brain.utils.text import slugify_title


class WritebackService:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.paths = config.paths

    def create_proposal(self, query_id: str, apply: bool = False) -> WritebackProposal:
        record = self._load_answer_record(query_id)
        target = self.config.root / "wiki" / "decisions" / f"{slugify_title(record.user_query)}-qa-note.md"
        content = "\n".join(
            [
                f"# Writeback Proposal: {record.user_query}",
                "",
                "This proposal captures a reusable answer from the current wiki query flow.",
                "",
                "## Retrieved Pages",
                *[f"- `{page}`" for page in record.retrieved_pages],
                "",
                "## Retrieved Sources",
                *[f"- `{source}`" for source in record.retrieved_sources],
            ]
        ).strip() + "\n"
        proposal = WritebackProposal(
            query_id=query_id,
            reason="Answer spans durable concepts and is a candidate for long-term wiki reuse.",
            content=content,
            target_paths=[target],
            created_at=utc_now(),
        )
        proposal_path = self.paths.writeback_dir / f"{query_id}.json"
        proposal_path.write_text(json.dumps(proposal.model_dump(mode="json"), ensure_ascii=False, indent=2), encoding="utf-8")
        if apply:
            self._apply(record, proposal)
        self._append_log(query_id, apply)
        return proposal

    def _apply(self, record: AnswerRecord, proposal: WritebackProposal) -> None:
        target_path = proposal.target_paths[0]
        if target_path.exists():
            return
        title = f"{record.user_query} 问答沉淀"
        metadata = render_frontmatter(
            {
                "page_id": f"decision-{slugify_title(record.user_query)}",
                "page_type": "decision",
                "title": title,
                "summary": "来自 ask 流程的耐用答案沉淀。",
                "source_refs": record.retrieved_sources,
                "links_to": record.retrieved_pages,
                "updated_at": utc_now(),
            }
        )
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_text(f"{metadata}\n\n{proposal.content}", encoding="utf-8")

    def _load_answer_record(self, query_id: str) -> AnswerRecord:
        if not self.paths.answer_records.exists():
            raise FileNotFoundError(f"Answer record not found: {query_id}")
        for line in self.paths.answer_records.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            record = AnswerRecord.model_validate_json(line)
            if record.query_id == query_id:
                return record
        raise FileNotFoundError(f"Answer record not found: {query_id}")

    def _append_log(self, query_id: str, apply: bool) -> None:
        action = "writeback-apply" if apply else "writeback-proposal"
        previous = self.paths.wiki_log.read_text(encoding="utf-8") if self.paths.wiki_log.exists() else "# Wiki Log\n\n"
        previous += f"## [{utc_now()}] {action} | query_id={query_id}\n"
        self.paths.wiki_log.write_text(previous, encoding="utf-8")
