from __future__ import annotations

from personal_brain.models import OntologyCandidate


class OntologyPromotionPolicy:
    def allow(self, candidate: OntologyCandidate) -> bool:
        if candidate.candidate_type == "Concept":
            return len(candidate.wiki_refs) >= 2 and bool(candidate.source_refs)
        return len(candidate.wiki_refs) >= 1 and bool(candidate.source_refs)
