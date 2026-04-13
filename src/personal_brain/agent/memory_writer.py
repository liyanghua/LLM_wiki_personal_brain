from __future__ import annotations

from personal_brain.config import BrainConfig
from personal_brain.models import MemoryProposal
from personal_brain.utils.files import read_json, write_json


class MemoryWriter:
    """TODO(HERMES_PHASE_2_RUNTIME): Accept reviewed memory proposals into persistent storage."""

    def __init__(self, config: BrainConfig) -> None:
        self.config = config

    def apply(self, proposals: list[MemoryProposal]) -> list[str]:
        applied: list[str] = []
        for proposal in proposals:
            if proposal.proposal_type == "interest":
                interests = read_json(self.config.paths.persistent_interests, default=[])
                if proposal.value not in interests:
                    interests.append(proposal.value)
                    write_json(self.config.paths.persistent_interests, interests)
                    applied.append(f"interest:{proposal.value}")
            elif proposal.proposal_type == "principle":
                principles = read_json(self.config.paths.persistent_principles, default=[])
                if proposal.value not in principles:
                    principles.append(proposal.value)
                    write_json(self.config.paths.persistent_principles, principles)
                    applied.append(f"principle:{proposal.value}")
            elif proposal.proposal_type == "open_loop":
                loops = read_json(self.config.paths.persistent_open_loops, default=[])
                loops.append(proposal.value)
                write_json(self.config.paths.persistent_open_loops, loops)
                applied.append(f"open_loop:{proposal.key}")
        return applied
