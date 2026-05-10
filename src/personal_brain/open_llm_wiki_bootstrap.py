from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_OLLAMA_URL = "http://localhost:11434"
DEFAULT_MAX_CONTEXT_SIZE = 128000
APP_STATE_KEYS = ("llmConfig", "providerConfigs", "activePresetId")


@dataclass(frozen=True)
class LlmSeed:
    llm_config: dict[str, object]
    provider_configs: dict[str, dict[str, object]]
    active_preset_id: str


@dataclass(frozen=True)
class SeedStoreResult:
    store_path: Path
    backup_path: Path | None
    active_preset_id: str


def _load_dotenv(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip().removeprefix("export ").strip()
        if not key:
            continue
        env[key] = _clean_env_value(value)
    return env


def _clean_env_value(value: str) -> str:
    stripped = value.strip()
    if not stripped:
        return ""
    if stripped[0] in {"'", '"'} and stripped[-1:] == stripped[0]:
        return stripped[1:-1]

    quote: str | None = None
    cleaned: list[str] = []
    for index, char in enumerate(stripped):
        if char in {"'", '"'}:
            if quote is None:
                quote = char
            elif quote == char:
                quote = None
            cleaned.append(char)
            continue
        if char == "#" and quote is None:
            previous = stripped[index - 1] if index > 0 else ""
            if index == 0 or previous.isspace():
                break
        cleaned.append(char)

    result = "".join(cleaned).strip()
    if result[:1] in {"'", '"'} and result[-1:] == result[:1]:
        return result[1:-1]
    return result


def _merge_env(dotenv: dict[str, str], environ: dict[str, str] | None = None) -> dict[str, str]:
    merged = dict(dotenv)
    merged.update(environ or os.environ)
    return merged


def _normalize_base_url(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().strip("\"'").rstrip("/")
    return normalized or None


def _non_empty(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().strip("\"'")
    return normalized or None


def _openai_is_official(base_url: str | None) -> bool:
    if not base_url:
        return True
    lowered = base_url.lower().rstrip("/")
    return lowered in {
        "https://api.openai.com",
        "https://api.openai.com/v1",
    }


def _custom_seed(api_key: str, model: str, base_url: str, *, api_mode: str = "chat_completions") -> LlmSeed:
    return LlmSeed(
        llm_config={
            "provider": "custom",
            "apiKey": api_key,
            "model": model,
            "ollamaUrl": DEFAULT_OLLAMA_URL,
            "customEndpoint": base_url,
            "maxContextSize": DEFAULT_MAX_CONTEXT_SIZE,
            "apiMode": api_mode,
        },
        provider_configs={
            "custom": {
                "apiKey": api_key,
                "model": model,
                "baseUrl": base_url,
                "apiMode": api_mode,
                "maxContextSize": DEFAULT_MAX_CONTEXT_SIZE,
            }
        },
        active_preset_id="custom",
    )


def _openai_seed(api_key: str, model: str) -> LlmSeed:
    return LlmSeed(
        llm_config={
            "provider": "openai",
            "apiKey": api_key,
            "model": model,
            "ollamaUrl": DEFAULT_OLLAMA_URL,
            "customEndpoint": "",
            "maxContextSize": DEFAULT_MAX_CONTEXT_SIZE,
        },
        provider_configs={
            "openai": {
                "apiKey": api_key,
                "model": model,
                "maxContextSize": DEFAULT_MAX_CONTEXT_SIZE,
            }
        },
        active_preset_id="openai",
    )


def build_llm_seed(env: dict[str, str]) -> LlmSeed:
    openai_key = _non_empty(env.get("OPENAI_API_KEY"))
    openai_model = _non_empty(env.get("OPENAI_MODEL")) or "gpt-4o"
    openai_base_url = _normalize_base_url(env.get("OPENAI_BASE_URL"))
    openrouter_key = _non_empty(env.get("OPENROUTER_API_KEY"))
    openrouter_model = _non_empty(env.get("OPENROUTER_MODEL")) or openai_model
    dashscope_key = _non_empty(env.get("DASHSCOPE_API_KEY"))
    dashscope_model = (
        _non_empty(env.get("DASHSCOPE_TEXT_MODEL"))
        or _non_empty(env.get("DASHSCOPE_VLM_MODEL"))
        or "qwen-max"
    )

    if openai_key:
        if _openai_is_official(openai_base_url):
            return _openai_seed(openai_key, openai_model)
        return _custom_seed(openai_key, openai_model, openai_base_url or DEFAULT_OPENROUTER_BASE_URL)

    if openrouter_key:
        return _custom_seed(openrouter_key, openrouter_model, DEFAULT_OPENROUTER_BASE_URL)

    if dashscope_key:
        return _custom_seed(dashscope_key, dashscope_model, DEFAULT_DASHSCOPE_BASE_URL)

    raise RuntimeError("No supported LLM credentials found in environment")


def _load_store(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}
    content = path.read_text(encoding="utf-8").strip()
    if not content:
        return {}
    return json.loads(content)


def _timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")


def seed_store_from_env(
    *,
    env_file: Path,
    store_path: Path,
    environ: dict[str, str] | None = None,
) -> SeedStoreResult:
    merged_env = _merge_env(_load_dotenv(env_file), environ)
    seed = build_llm_seed(merged_env)

    existing = _load_store(store_path)
    backup_path: Path | None = None
    if store_path.exists():
        backup_path = store_path.with_name(f"{store_path.name}.bak-{_timestamp()}")
        backup_path.write_text(
            json.dumps(existing, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    payload = dict(existing)
    payload["llmConfig"] = seed.llm_config
    payload["providerConfigs"] = seed.provider_configs
    payload["activePresetId"] = seed.active_preset_id

    store_path.parent.mkdir(parents=True, exist_ok=True)
    store_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return SeedStoreResult(
        store_path=store_path,
        backup_path=backup_path,
        active_preset_id=seed.active_preset_id,
    )
