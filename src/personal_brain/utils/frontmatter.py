from __future__ import annotations

from typing import Any


def render_frontmatter(metadata: dict[str, Any]) -> str:
    lines = ["---"]
    for key, value in metadata.items():
        if isinstance(value, list):
            lines.append(f"{key}:")
            for item in value:
                lines.append(f"  - {item}")
        else:
            lines.append(f"{key}: {value}")
    lines.append("---")
    return "\n".join(lines)


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    if not text.startswith("---\n"):
        return {}, text
    lines = text.splitlines()
    metadata: dict[str, Any] = {}
    current_list_key: str | None = None
    end_index = 0
    for index, line in enumerate(lines[1:], start=1):
        if line == "---":
            end_index = index
            break
        if line.startswith("  - ") and current_list_key:
            metadata.setdefault(current_list_key, []).append(line[4:])
            continue
        current_list_key = None
        if ":" not in line:
            continue
        key, raw_value = line.split(":", 1)
        key = key.strip()
        value = raw_value.strip()
        if value:
            metadata[key] = [] if value == "[]" else value
        else:
            metadata[key] = []
            current_list_key = key
    body = "\n".join(lines[end_index + 1 :]).lstrip("\n")
    return metadata, body
