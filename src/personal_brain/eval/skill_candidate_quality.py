from __future__ import annotations

from personal_brain.models import EvaluationCase, SkillCandidateManifest


def evaluate_skill_candidate_quality(case: EvaluationCase, manifests: list[SkillCandidateManifest]) -> tuple[float, str]:
    if not manifests:
        return 0.0, "No skill candidates generated."
    actual_families = {manifest.family for manifest in manifests}
    matched = [expected for expected in case.expected_skill_families if expected in actual_families]
    complete = all(manifest.origin_query_ids and manifest.origin_wiki_pages and manifest.source_refs for manifest in manifests)
    score = len(matched) / len(case.expected_skill_families) if case.expected_skill_families else 1.0
    if complete:
        score = min(1.0, score + 0.2)
    return score, "Skill candidate quality checks family coverage plus origin traceability."
