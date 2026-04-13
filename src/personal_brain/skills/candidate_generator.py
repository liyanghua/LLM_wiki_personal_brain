from __future__ import annotations

import json

from personal_brain.config import BrainConfig
from personal_brain.models import SessionRecord, SkillCandidateManifest
from personal_brain.skills.promotion_policy import SkillPromotionPolicy
from personal_brain.skills.skill_packager import SkillPackager


class SkillCandidateGenerator:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.paths = config.paths
        self.policy = SkillPromotionPolicy()
        self.packager = SkillPackager()

    def build(self) -> list[SkillCandidateManifest]:
        records = self._load_session_records()
        grouped: dict[str, list[SessionRecord]] = {}
        for record in records:
            for family in self._families_for_record(record):
                grouped.setdefault(family, []).append(record)

        manifests: list[SkillCandidateManifest] = []
        for family, family_records in grouped.items():
            if not self.policy.allow(family_records):
                continue
            manifest = self._manifest_for_family(family, family_records)
            self.packager.write(self.paths.skills_candidates, manifest, family_records)
            manifests.append(manifest)

        (self.paths.skills_candidates / "index.json").write_text(
            json.dumps([manifest.model_dump(mode="json") for manifest in manifests], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return manifests

    def _load_session_records(self) -> list[SessionRecord]:
        records: list[SessionRecord] = []
        for path in sorted((self.paths.memory / "session").glob("20??-??-??/*.json")):
            records.append(SessionRecord.model_validate_json(path.read_text(encoding="utf-8")))
        return records

    def _families_for_record(self, record: SessionRecord) -> list[str]:
        pages = record.ranked_pages + [item.page_path for item in record.selected_evidence]
        families: list[str] = []
        if any("/topics/" in page for page in pages):
            families.append("topic_synthesis")
        if any("/principles/" in page for page in pages) or "原则" in record.answer_summary:
            families.append("principle_distillation")
        if any("/projects/" in page for page in pages) or record.question_classification.question_type == "project-status":
            families.append("project_context_refresh")
        if record.question_classification.question_type == "comparison":
            families.extend(["concept_comparison_table", "decision_extraction"])
        elif any(target.startswith("wiki/decisions/") for target in record.writeback_targets):
            families.append("decision_extraction")
        return list(dict.fromkeys(families))

    def _manifest_for_family(self, family: str, records: list[SessionRecord]) -> SkillCandidateManifest:
        avg_score = sum(record.asset_value_signals.overall_score for record in records) / len(records)
        origin_wiki_pages = list(dict.fromkeys(page for record in records for page in record.ranked_pages))
        source_refs = list(
            dict.fromkeys(source for record in records for item in record.selected_evidence for source in item.source_refs)
        )
        titles = {
            "topic_synthesis": "Topic Synthesis Candidate",
            "decision_extraction": "Decision Extraction Candidate",
            "principle_distillation": "Principle Distillation Candidate",
            "project_context_refresh": "Project Context Refresh Candidate",
            "concept_comparison_table": "Concept Comparison Table Candidate",
        }
        return SkillCandidateManifest(
            skill_id=family,
            family=family,
            title=titles.get(family, family),
            summary=f"Candidate skill package derived from {len(records)} high-value session records.",
            origin_query_ids=[record.query_id for record in records],
            origin_wiki_pages=origin_wiki_pages,
            source_refs=source_refs,
            asset_value_score=avg_score,
        )
