from __future__ import annotations

from personal_brain.models import MemoryProposal, MemoryRecallBundle
from personal_brain.utils.text import keyword_tokens


class MemoryPolicy:
    def propose(
        self,
        user_query: str,
        answer_summary: str,
        retrieved_pages: list[str],
        recalled_memory: MemoryRecallBundle,
        open_follow_ups: list[str],
    ) -> list[MemoryProposal]:
        proposals: list[MemoryProposal] = []
        persistent_interests = set(recalled_memory.persistent_interests)
        persistent_principles = set(recalled_memory.persistent_principles)

        candidate_interest = self._extract_interest(user_query)
        repeated = any(candidate_interest and candidate_interest in summary for summary in recalled_memory.recent_session_summaries)
        if candidate_interest and repeated and candidate_interest not in persistent_interests:
            proposals.append(
                MemoryProposal(
                    proposal_type="interest",
                    target_file="memory/persistent/interests.json",
                    key=candidate_interest,
                    value=candidate_interest,
                    rationale="Topic repeated across recent sessions and is not yet persistent.",
                )
            )

        principle_value = self._extract_principle(answer_summary, retrieved_pages)
        if principle_value and principle_value not in persistent_principles:
            proposals.append(
                MemoryProposal(
                    proposal_type="principle",
                    target_file="memory/persistent/principles.json",
                    key=principle_value[:30],
                    value=principle_value,
                    rationale="Answer summary maps to a durable principle-oriented pattern.",
                )
            )

        for index, follow_up in enumerate(open_follow_ups):
            proposals.append(
                MemoryProposal(
                    proposal_type="open_loop",
                    target_file="memory/persistent/open_loops.json",
                    key=f"follow_up_{index}",
                    value={"question": follow_up, "status": "open"},
                    rationale="Follow-up question remains unresolved and may matter across sessions.",
                )
            )
        return proposals

    def _extract_interest(self, text: str) -> str | None:
        if "品牌经营OS" in text:
            return "品牌经营OS"
        tokens = [token for token in keyword_tokens(text) if len(token) >= 4]
        return tokens[0] if tokens else None

    def _extract_principle(self, answer_summary: str, retrieved_pages: list[str]) -> str | None:
        if any("/principles/" in page for page in retrieved_pages):
            return answer_summary
        if "原则" in answer_summary or "长期" in answer_summary:
            return answer_summary
        return None
