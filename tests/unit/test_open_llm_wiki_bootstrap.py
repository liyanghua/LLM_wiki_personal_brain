from __future__ import annotations

import json
from pathlib import Path

from personal_brain.open_llm_wiki_bootstrap import (
    APP_STATE_KEYS,
    DEFAULT_DASHSCOPE_BASE_URL,
    DEFAULT_MAX_CONTEXT_SIZE,
    DEFAULT_OLLAMA_URL,
    DEFAULT_OPENROUTER_BASE_URL,
    _load_dotenv,
    build_llm_seed,
    seed_store_from_env,
)


def test_build_llm_seed_uses_openai_preset_for_official_openai() -> None:
    seed = build_llm_seed(
        {
            "OPENAI_API_KEY": "sk-openai",
            "OPENAI_MODEL": "gpt-4.1",
        }
    )

    assert seed.active_preset_id == "openai"
    assert seed.llm_config == {
        "provider": "openai",
        "apiKey": "sk-openai",
        "model": "gpt-4.1",
        "ollamaUrl": DEFAULT_OLLAMA_URL,
        "customEndpoint": "",
        "maxContextSize": DEFAULT_MAX_CONTEXT_SIZE,
    }
    assert seed.provider_configs == {
        "openai": {
            "apiKey": "sk-openai",
            "model": "gpt-4.1",
            "maxContextSize": DEFAULT_MAX_CONTEXT_SIZE,
        }
    }


def test_build_llm_seed_prefers_custom_when_openai_base_url_is_non_official() -> None:
    seed = build_llm_seed(
        {
            "OPENAI_API_KEY": "sk-custom",
            "OPENAI_MODEL": "openai/gpt-4.1-mini",
            "OPENAI_BASE_URL": "https://openrouter.ai/api/v1",
        }
    )

    assert seed.active_preset_id == "custom"
    assert seed.llm_config == {
        "provider": "custom",
        "apiKey": "sk-custom",
        "model": "openai/gpt-4.1-mini",
        "ollamaUrl": DEFAULT_OLLAMA_URL,
        "customEndpoint": "https://openrouter.ai/api/v1",
        "maxContextSize": DEFAULT_MAX_CONTEXT_SIZE,
        "apiMode": "chat_completions",
    }
    assert seed.provider_configs == {
        "custom": {
            "apiKey": "sk-custom",
            "model": "openai/gpt-4.1-mini",
            "baseUrl": "https://openrouter.ai/api/v1",
            "apiMode": "chat_completions",
            "maxContextSize": DEFAULT_MAX_CONTEXT_SIZE,
        }
    }


def test_build_llm_seed_falls_back_to_openrouter_then_dashscope() -> None:
    openrouter_seed = build_llm_seed(
        {
            "OPENROUTER_API_KEY": "sk-openrouter",
            "OPENAI_MODEL": "google/gemini-2.5-flash",
        }
    )
    assert openrouter_seed.active_preset_id == "custom"
    assert openrouter_seed.llm_config["provider"] == "custom"
    assert openrouter_seed.llm_config["customEndpoint"] == DEFAULT_OPENROUTER_BASE_URL
    assert openrouter_seed.llm_config["model"] == "google/gemini-2.5-flash"

    dashscope_seed = build_llm_seed(
        {
            "DASHSCOPE_API_KEY": "sk-dashscope",
            "DASHSCOPE_TEXT_MODEL": "qwen-max",
        }
    )
    assert dashscope_seed.active_preset_id == "custom"
    assert dashscope_seed.llm_config["provider"] == "custom"
    assert dashscope_seed.llm_config["customEndpoint"] == DEFAULT_DASHSCOPE_BASE_URL
    assert dashscope_seed.llm_config["model"] == "qwen-max"


def test_seed_store_from_env_merges_existing_store_and_writes_backup(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "OPENAI_API_KEY=sk-openai",
                "OPENAI_MODEL=gpt-4o-mini",
            ]
        ),
        encoding="utf-8",
    )

    store_path = tmp_path / "app-state.json"
    store_path.write_text(
        json.dumps(
            {
                "recentProjects": [{"name": "existing", "path": "/tmp/wiki"}],
                "proxyConfig": {"enabled": False, "url": "", "bypassLocal": True},
                "unrelated": {"keep": True},
            }
        ),
        encoding="utf-8",
    )

    result = seed_store_from_env(env_file=env_file, store_path=store_path)

    payload = json.loads(store_path.read_text(encoding="utf-8"))
    assert payload["recentProjects"] == [{"name": "existing", "path": "/tmp/wiki"}]
    assert payload["unrelated"] == {"keep": True}
    for key in APP_STATE_KEYS:
        assert key in payload

    backups = sorted(tmp_path.glob("app-state.json.bak-*"))
    assert backups, "expected a backup file to be created"
    assert result.store_path == store_path
    assert result.backup_path == backups[-1]
    assert result.active_preset_id == "openai"


def test_load_dotenv_strips_inline_comments_for_unquoted_values(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "DASHSCOPE_TEXT_MODEL=qwen-max   # DashScope text-model",
                "OPENAI_MODEL=google/gemini-2.5-pro",
                "OPENAI_BASE_URL='http://42.121.162.143/v1'",
            ]
        ),
        encoding="utf-8",
    )

    env = _load_dotenv(env_file)

    assert env["DASHSCOPE_TEXT_MODEL"] == "qwen-max"
    assert env["OPENAI_MODEL"] == "google/gemini-2.5-pro"
    assert env["OPENAI_BASE_URL"] == "http://42.121.162.143/v1"
