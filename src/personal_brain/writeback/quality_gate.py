from __future__ import annotations

from personal_brain.models import WritebackTargetDecision


class WritebackQualityGate:
    def review(self, targets: list[WritebackTargetDecision]) -> list[WritebackTargetDecision]:
        reviewed: list[WritebackTargetDecision] = []
        for target in targets:
            decision = target.model_copy(deep=True)
            if not decision.evidence_refs:
                decision.approval_status = "rejected"
                decision.rejection_reason = "No grounded evidence references available."
            elif decision.target.startswith("wiki/") and decision.confidence >= 0.7:
                decision.approval_status = "approved-for-apply"
            elif decision.target.startswith("wiki/") and decision.confidence >= 0.5:
                decision.approval_status = "pending"
                decision.rejection_reason = "Confidence below auto-apply threshold."
            elif decision.target.startswith(("ontology/", "skills/")):
                decision.approval_status = "pending"
                decision.rejection_reason = "Candidate-only target reserved for later asset build flow."
            else:
                decision.approval_status = "rejected"
                decision.rejection_reason = "Target did not pass writeback routing policy."
            reviewed.append(decision)
        return reviewed
