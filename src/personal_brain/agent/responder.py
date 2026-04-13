from __future__ import annotations

from personal_brain.models import AskResult


class BrainResponder:
    """TODO(HERMES_PHASE_2_RUNTIME): Wrap query results for a future Hermes runtime surface."""

    def respond(self, result: AskResult) -> dict:
        return {
            "answer_markdown": result.answer_markdown,
            "retrieved_pages": result.retrieved_pages,
            "retrieved_sources": result.retrieved_sources,
            "open_follow_ups": result.open_follow_ups,
            "writeback_targets": result.writeback_targets,
            "persistent_memory_proposals": [item.model_dump(mode="json") for item in result.persistent_memory_proposals],
        }
