from __future__ import annotations


class EvidenceLinker:
    def merge(self, values: list[str]) -> list[str]:
        merged: list[str] = []
        for value in values:
            if value and value not in merged:
                merged.append(value)
        return merged
