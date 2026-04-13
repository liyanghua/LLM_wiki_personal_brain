from __future__ import annotations

from personal_brain.agent.tool_registry import ToolRegistry
from personal_brain.config import BrainConfig
from personal_brain.models import ToolSpec


class HermesAdapter:
    """TODO(HERMES_PHASE_2_RUNTIME): Bridge the local tool registry into a Hermes runtime."""

    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.registry = ToolRegistry(config)

    def is_enabled(self) -> bool:
        return True

    def list_tools(self) -> list[ToolSpec]:
        return self.registry.list_specs()

    def invoke(self, tool_name: str, payload: dict) -> dict:
        return self.registry.invoke(tool_name, payload)
