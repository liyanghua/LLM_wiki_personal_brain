from __future__ import annotations

import re
from collections import Counter
from pathlib import Path


HEADING_PATTERN = re.compile(r"^#+\s*(.+?)\s*$")
SENTENCE_SPLIT_PATTERN = re.compile(r"[。！？\n]+")
MARKDOWN_LINK_PATTERN = re.compile(r"!?\[([^\]]+)\]\([^)]+\)")


def extract_title(text: str, path: Path) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        match = HEADING_PATTERN.match(stripped)
        if match:
            return match.group(1).strip()
        return stripped[:120]
    return path.stem


def normalize_title(value: str) -> str:
    lowered = value.lower()
    cleaned = re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", lowered)
    return cleaned


def slugify_title(value: str) -> str:
    lowered = value.lower().strip()
    lowered = re.sub(r"[\\/:*?\"<>|]+", "-", lowered)
    lowered = re.sub(r"[\s_]+", "", lowered)
    lowered = re.sub(r"[^0-9a-z\u4e00-\u9fff-]+", "", lowered)
    lowered = re.sub(r"-{2,}", "-", lowered).strip("-")
    return lowered or "untitled"


def summarize_text(text: str, limit: int = 2) -> str:
    parts = [_clean_summary_fragment(part) for part in SENTENCE_SPLIT_PATTERN.split(text) if part.strip()]
    picked: list[str] = []
    for part in parts:
        if len(part) < 8:
            continue
        if part in picked:
            continue
        picked.append(part)
        if len(picked) >= limit:
            break
    if not picked:
        return "No reliable summary extracted yet."
    return "；".join(picked)


def _clean_summary_fragment(value: str) -> str:
    cleaned = value.strip(" -*\t")
    cleaned = re.sub(r"^#+\s*", "", cleaned)
    cleaned = MARKDOWN_LINK_PATTERN.sub(r"\1", cleaned)
    cleaned = cleaned.replace("`", "")
    return cleaned.strip()


def keyword_tokens(text: str) -> list[str]:
    ascii_tokens = re.findall(r"[a-zA-Z0-9]+", text.lower())
    chinese_chunks = re.findall(r"[\u4e00-\u9fff]{1,}", text)
    tokens: list[str] = []
    for token in ascii_tokens:
        if len(token) > 1:
            tokens.append(token)
    for chunk in chinese_chunks:
        tokens.append(chunk)
        if len(chunk) > 2:
            tokens.extend(chunk[i : i + 2] for i in range(len(chunk) - 1))
    return tokens


def overlap_score(query: str, candidate: str) -> int:
    query_counter = Counter(keyword_tokens(query))
    candidate_counter = Counter(keyword_tokens(candidate))
    return sum(min(count, candidate_counter[token]) for token, count in query_counter.items())
