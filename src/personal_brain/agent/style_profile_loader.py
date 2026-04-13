from __future__ import annotations

from personal_brain.config import BrainConfig
from personal_brain.models import PersonalStyleProfile
from personal_brain.utils.files import read_json


class StyleProfileLoader:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config

    def load(self) -> PersonalStyleProfile:
        payload = read_json(self.config.paths.persistent_profile, default=None)
        if payload is None:
            return self.config.default_style_profile()
        return PersonalStyleProfile.model_validate(payload)

    @staticmethod
    def from_dict(payload: dict) -> PersonalStyleProfile:
        return PersonalStyleProfile.model_validate(payload)
