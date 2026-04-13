from __future__ import annotations

from personal_brain.models import SessionRecord


def evaluate_memory_precision(record: SessionRecord | None) -> tuple[float, str]:
    if record is None:
        return 0.0, "No matching session record found."
    allowed = {"interest", "principle", "open_loop"}
    proposal_types = {proposal.proposal_type for proposal in record.persistent_memory_proposals}
    if proposal_types.issubset(allowed):
        return 1.0, "Persistent memory remained proposal-first and within conservative policy."
    return 0.0, "Unexpected persistent memory proposal type detected."
