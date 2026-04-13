from __future__ import annotations

from personal_brain.utils.text import slugify_title


class Canonicalizer:
    def canonical_name(self, value: str) -> str:
        normalized = value.strip()
        replacements = {
            "品牌经营os": "品牌经营OS",
            "super指标": "SUPER指标",
        }
        lowered = normalized.lower()
        if lowered in replacements:
            return replacements[lowered]
        return normalized

    def candidate_id(self, candidate_type: str, value: str) -> str:
        return f"{candidate_type.lower()}-{slugify_title(self.canonical_name(value))}"
