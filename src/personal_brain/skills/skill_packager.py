from __future__ import annotations

import json
from pathlib import Path

from personal_brain.models import SessionRecord, SkillCandidateManifest


class SkillPackager:
    def write(self, root: Path, manifest: SkillCandidateManifest, records: list[SessionRecord]) -> None:
        skill_root = root / manifest.skill_id
        examples_root = skill_root / "examples"
        examples_root.mkdir(parents=True, exist_ok=True)

        (skill_root / "SKILL.md").write_text(self._skill_doc(manifest), encoding="utf-8")
        (skill_root / "input_schema.json").write_text(
            json.dumps(
                {
                    "type": "object",
                    "properties": {
                        "question": {"type": "string"},
                        "candidate_pages": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["question"],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        (skill_root / "output_schema.json").write_text(
            json.dumps(
                {
                    "type": "object",
                    "properties": {
                        "fact": {"type": "array", "items": {"type": "string"}},
                        "synthesis": {"type": "array", "items": {"type": "string"}},
                        "recommendation": {"type": "array", "items": {"type": "string"}},
                    },
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        (examples_root / "example_01.md").write_text(self._example(records[0]), encoding="utf-8")
        (skill_root / "metadata.json").write_text(
            json.dumps(manifest.model_dump(mode="json"), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _skill_doc(self, manifest: SkillCandidateManifest) -> str:
        return "\n".join(
            [
                f"# {manifest.title}",
                "",
                manifest.summary,
                "",
                "TODO(HUMAN_APPROVAL_WORKFLOW)",
                "",
                f"- Family: `{manifest.family}`",
                f"- Status: `{manifest.status}`",
            ]
        ).strip() + "\n"

    def _example(self, record: SessionRecord) -> str:
        return "\n".join(
            [
                f"# Example: {record.user_query}",
                "",
                f"- Query ID: `{record.query_id}`",
                f"- Summary: {record.answer_summary}",
                f"- Pages: {', '.join(record.ranked_pages[:3])}",
            ]
        ).strip() + "\n"
