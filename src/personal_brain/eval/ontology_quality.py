from __future__ import annotations

from personal_brain.models import EvaluationCase, OntologyCandidate


def evaluate_ontology_quality(case: EvaluationCase, candidates: list[OntologyCandidate]) -> tuple[float, str]:
    if not candidates:
        return 0.0, "No ontology candidates generated."
    actual_types = {candidate.candidate_type for candidate in candidates}
    matched = [expected for expected in case.expected_candidate_types if expected in actual_types]
    traceable = all(candidate.wiki_refs and candidate.source_refs for candidate in candidates)
    score = len(matched) / len(case.expected_candidate_types) if case.expected_candidate_types else 1.0
    if traceable:
        score = min(1.0, score + 0.2)
    return score, "Ontology quality checks candidate type coverage plus wiki/source traceability."
