from __future__ import annotations

import json
import os
import time
from typing import Any

import sys
from pathlib import Path

from personal_brain.config import BrainConfig


class LiteLLMClient:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config

    def completion_json(self, *, messages: list[dict[str, str]]) -> dict[str, Any]:
        try:
            completion = self._load_completion()
        except Exception as exc:  # pragma: no cover - import failure depends on local install
            raise RuntimeError(f"litellm import failed: {exc}") from exc

        warnings: list[str] = []
        last_error: Exception | None = None
        for model in self._candidate_models():
            if not self._provider_configured(model):
                warnings.append(f"litellm_provider_not_configured:{model}:{self._required_key_for_model(model)}")
                continue
            try:
                return self._completion_json_for_model(
                    completion=completion,
                    messages=messages,
                    model=model,
                    warnings=warnings,
                )
            except Exception as exc:
                last_error = exc
                warnings.append(f"litellm_provider_failed:{model}:{exc}")
        if last_error is not None:
            raise RuntimeError("; ".join(warnings)) from last_error
        raise RuntimeError("; ".join(warnings) or "no configured LiteLLM provider")

    def _completion_json_for_model(
        self,
        *,
        completion,
        messages: list[dict[str, str]],
        model: str,
        warnings: list[str],
    ) -> dict[str, Any]:
        started = time.perf_counter()
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": self.config.litellm_temperature,
            "max_tokens": self.config.litellm_max_tokens,
            "timeout": self.config.litellm_timeout_seconds,
            "response_format": {"type": "json_object"},
        }
        api_base = self._api_base_for_model(model)
        if api_base:
            kwargs["api_base"] = api_base

        response = completion(**kwargs)
        latency_ms = int((time.perf_counter() - started) * 1000)
        message = response["choices"][0]["message"]["content"]
        payload = json.loads(message)
        usage = response.get("usage", {}) or {}
        payload["_meta"] = {
            "provider": self._provider_for_model(model),
            "model": model,
            "latency_ms": latency_ms,
            "token_usage": {
                "prompt_tokens": int(usage.get("prompt_tokens", 0) or 0),
                "completion_tokens": int(usage.get("completion_tokens", 0) or 0),
                "total_tokens": int(usage.get("total_tokens", 0) or 0),
            },
            "warnings": list(warnings),
        }
        return payload

    def _candidate_models(self) -> list[str]:
        models = [self.config.litellm_model, *self.config.litellm_fallback_models]
        return list(dict.fromkeys(model for model in models if model))

    def _provider_configured(self, model: str | None = None) -> bool:
        key_name = self._required_key_for_model(model or self.config.litellm_model)
        return bool(os.environ.get(key_name))

    def _required_key_for_model(self, model: str) -> str:
        provider = self._provider_for_model(model)
        if provider == "dashscope":
            return "DASHSCOPE_API_KEY"
        if provider == "openrouter":
            return "OPENROUTER_API_KEY"
        return "OPENAI_API_KEY"

    def _provider_for_model(self, model: str) -> str:
        if "/" not in model:
            return "openai"
        provider = model.split("/", 1)[0].strip().lower()
        if provider in {"dashscope", "openrouter", "openai"}:
            return provider
        return provider or "openai"

    def _api_base_for_model(self, model: str) -> str | None:
        if self.config.litellm_api_base:
            return self.config.litellm_api_base
        provider = self._provider_for_model(model)
        if provider == "dashscope":
            return os.environ.get("DASHSCOPE_API_BASE")
        if provider == "openrouter":
            return os.environ.get("OPENROUTER_API_BASE")
        return os.environ.get("OPENAI_BASE_URL")

    def _vendor_src_path(self) -> Path | None:
        root = self.config.root.resolve()
        candidate = root / "external" / "litellm"
        if (candidate / "litellm").exists():
            return candidate
        if (candidate / "src" / "litellm").exists():
            return candidate / "src"
        return None

    def _load_completion(self):
        vendor_src = self._vendor_src_path()
        if vendor_src is not None:
            vendor_path = str(vendor_src)
            if vendor_path not in sys.path:
                sys.path.insert(0, vendor_path)
            try:
                from litellm import completion  # type: ignore[import-not-found]

                return completion
            except ModuleNotFoundError:
                self._clear_litellm_import_state()
                try:
                    sys.path.remove(vendor_path)
                except ValueError:
                    pass
            except Exception:
                self._clear_litellm_import_state()
                raise

        from litellm import completion  # type: ignore[import-not-found]

        return completion

    def _clear_litellm_import_state(self) -> None:
        for module_name in list(sys.modules):
            if module_name == "litellm" or module_name.startswith("litellm."):
                sys.modules.pop(module_name, None)
