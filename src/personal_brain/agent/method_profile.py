from __future__ import annotations

from personal_brain.config import BrainConfig
from personal_brain.models import MethodProfile
from personal_brain.utils.files import read_json


class MethodProfileLoader:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config

    def load(self) -> MethodProfile:
        payload = read_json(self.config.paths.persistent_profile, default=None)
        if payload is None:
            return self.config.default_method_profile()
        return self.from_dict(payload)

    @staticmethod
    def from_dict(payload: dict) -> MethodProfile:
        preferred_answer_structure = payload.get("preferred_answer_structure") or [
            "fact",
            "synthesis",
            "interpretation",
            "recommendation",
        ]
        actionability = payload.get("actionability_preference", "medium")
        operationalization = payload.get("operationalization_level", actionability)
        reusable_assets = payload.get("reusable_asset_preferences")
        if not reusable_assets:
            reusable_assets = ["mapping"] if actionability in {"medium", "high"} else ["schema"]

        return MethodProfile(
            method_profile_id=payload.get("method_profile_id") or payload.get("profile_id") or "default-grounded",
            preferred_answer_structure=preferred_answer_structure,
            abstraction_depth=payload.get("abstraction_depth") or payload.get("abstraction_level") or "balanced",
            operationalization_level=operationalization,
            explanation_pattern=payload.get("explanation_pattern", "hybrid"),
            reusable_asset_preferences=reusable_assets,
            citation_preference=payload.get("citation_preference", "high"),
            assetization_preference=payload.get("assetization_preference")
            or payload.get("reuse_preference")
            or "proposal-first",
            favored_output_forms=payload.get("favored_output_forms", ["markdown"]),
            preferred_tone=payload.get("preferred_tone", "grounded"),
            actionability_preference=actionability,
        )
