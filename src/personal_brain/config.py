from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Iterable

from pydantic import BaseModel, ConfigDict, Field

from personal_brain.models import MethodProfile, PersonalStyleProfile


DEFAULT_PILOT_TITLES = [
    "电商运营本体核心文档",
    "淘天商品全生命周期智能运营AI体",
    "货品全生命周期管理-SUPER指标模型",
    "桌垫类目-儿童学习桌垫单因子测图示例",
    "背景选择_访谈日志",
]

# The current qmd CLI release still embeds/queries with its default model path.
# Keep backend defaults aligned with that runtime, and only switch to the
# multilingual Qwen embedding once we own a wrapper or pin a qmd release that
# honors custom embed-model overrides end-to-end.
DEFAULT_QMD_EMBED_MODEL = "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf"
DEFAULT_QMD_MULTILINGUAL_EMBED_MODEL = "hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf"
DEFAULT_LITELLM_PROVIDER_ORDER = ["dashscope", "openrouter", "openai"]


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_list(name: str, default: Iterable[str] = ()) -> list[str]:
    value = os.environ.get(name)
    if value is None:
        return [item for item in default if item]
    return [item.strip() for item in value.split(",") if item.strip()]


def _load_dotenv_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip().removeprefix("export ").strip()
        if not key or key in os.environ:
            continue
        cleaned = value.strip().strip("\"'")
        os.environ[key] = cleaned


def _load_dotenv_for_root(root: Path) -> None:
    _load_dotenv_file(root.resolve() / ".env")


def _default_litellm_model() -> str:
    explicit = os.environ.get("BRAIN_LITELLM_MODEL")
    if explicit:
        return explicit
    if os.environ.get("DASHSCOPE_API_KEY"):
        return "dashscope/qwen-max"
    if os.environ.get("OPENROUTER_API_KEY"):
        openrouter_model = os.environ.get("BRAIN_LITELLM_OPENROUTER_MODEL") or os.environ.get("OPENROUTER_MODEL")
        if openrouter_model:
            return openrouter_model if openrouter_model.startswith("openrouter/") else f"openrouter/{openrouter_model}"
    openai_model = os.environ.get("OPENAI_MODEL") or "gpt-4o-mini"
    return openai_model


def _slugify_search_name(value: str) -> str:
    normalized = re.sub(r"[^0-9a-zA-Z\u4e00-\u9fff-]+", "-", value).strip("-").lower()
    return normalized or "personal-brain"


class BrainPaths(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    root: Path
    source_root: Path | None = None
    workspace_root: Path | None = None

    @property
    def raw(self) -> Path:
        return (self.source_root or (self.root / "raw")).resolve()

    @property
    def raw_brain(self) -> Path:
        return self.raw / ".brain"

    @property
    def wiki(self) -> Path:
        return ((self.workspace_root or self.root) / "wiki").resolve()

    @property
    def ontology(self) -> Path:
        return ((self.workspace_root or self.root) / "ontology").resolve()

    @property
    def ontology_scenes(self) -> Path:
        return self.ontology / "scenes"

    @property
    def memory(self) -> Path:
        return ((self.workspace_root or self.root) / "memory").resolve()

    @property
    def source_manifest(self) -> Path:
        return self.raw_brain / "source_records.jsonl"

    @property
    def ingest_errors(self) -> Path:
        return self.raw_brain / "ingest_errors.jsonl"

    @property
    def pilot_titles(self) -> Path:
        return self.raw_brain / "pilot_titles.json"

    @property
    def wiki_index(self) -> Path:
        return self.wiki / "index.md"

    @property
    def wiki_log(self) -> Path:
        return self.wiki / "log.md"

    @property
    def answer_records(self) -> Path:
        return self.memory / "session" / "answer_records.jsonl"

    @property
    def answers_dir(self) -> Path:
        return self.memory / "session" / "answers"

    @property
    def session_summaries_dir(self) -> Path:
        return self.memory / "session" / "summaries"

    @property
    def writeback_dir(self) -> Path:
        return self.memory / "session" / "writeback"

    @property
    def extraction_dir(self) -> Path:
        return self.memory / "session" / "extraction"

    @property
    def extraction_summaries_dir(self) -> Path:
        return self.extraction_dir / "summaries"

    @property
    def persistent_profile(self) -> Path:
        return self.memory / "persistent" / "profile.json"

    @property
    def persistent_interests(self) -> Path:
        return self.memory / "persistent" / "interests.json"

    @property
    def persistent_principles(self) -> Path:
        return self.memory / "persistent" / "principles.json"

    @property
    def persistent_open_loops(self) -> Path:
        return self.memory / "persistent" / "open_loops.json"

    @property
    def ontology_candidates(self) -> Path:
        return self.ontology / "candidates"

    @property
    def skills_candidates(self) -> Path:
        return ((self.workspace_root or self.root) / "skills" / "candidates").resolve()

    @property
    def skills_approved(self) -> Path:
        return ((self.workspace_root or self.root) / "skills" / "approved").resolve()

    @property
    def brain_binding_dir(self) -> Path:
        return self.memory / "brain-binding"

    @property
    def skill_runs_dir(self) -> Path:
        return self.memory / "skills" / "runs"

    @property
    def eval_cases(self) -> Path:
        return ((self.workspace_root or self.root) / "eval" / "cases").resolve()

    @property
    def eval_reports(self) -> Path:
        return ((self.workspace_root or self.root) / "eval" / "reports").resolve()

    def session_day_dir(self, day: str) -> Path:
        return self.memory / "session" / day

    def session_record_path(self, day: str, query_id: str) -> Path:
        return self.session_day_dir(day) / f"{query_id}.json"

    def session_summary_path(self, day: str) -> Path:
        return self.session_summaries_dir / f"{day}.md"

    def extraction_day_dir(self, day: str) -> Path:
        return self.extraction_dir / day

    def extraction_state_path(self, day: str, interview_id: str) -> Path:
        return self.extraction_day_dir(day) / f"{interview_id}.json"

    def extraction_summary_path(self, day: str) -> Path:
        return self.extraction_summaries_dir / f"{day}.md"

    @property
    def search_dir(self) -> Path:
        return self.memory / "search"

    @property
    def normalized(self) -> Path:
        return ((self.workspace_root or self.root) / "normalized").resolve()

    @property
    def normalized_registries(self) -> Path:
        return self.normalized / "registries"

    @property
    def search_cache_home(self) -> Path:
        return self.search_dir / "cache"

    @property
    def qmd_state(self) -> Path:
        return self.search_dir / "qmd_state.json"

    def ensure(self) -> None:
        for path in [
            self.raw_brain,
            self.wiki / "entities",
            self.wiki / "topics",
            self.wiki / "projects",
            self.wiki / "decisions",
            self.wiki / "principles",
            self.wiki / "timelines",
            self.wiki / "sources",
            self.ontology / "objects",
            self.ontology / "relations",
            self.ontology / "rules",
            self.ontology / "profiles",
            self.ontology / "schemas",
            self.ontology / "evidence_index",
            self.ontology_scenes,
            self.ontology_candidates,
            self.memory / "session",
            self.session_summaries_dir,
            self.extraction_dir,
            self.extraction_summaries_dir,
            self.memory / "persistent",
            self.search_dir,
            self.search_cache_home,
            self.normalized,
            self.normalized_registries,
            self.memory / "skills",
            self.skill_runs_dir,
            self.memory / "summaries",
            self.answers_dir,
            self.writeback_dir,
            self.brain_binding_dir,
            self.skills_candidates,
            self.skills_approved,
            self.eval_cases,
            self.eval_reports,
        ]:
            path.mkdir(parents=True, exist_ok=True)


class BrainConfig(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    root: Path = Field(default_factory=lambda: Path.cwd())
    source_root: Path | None = None
    workspace_root: Path | None = None
    stale_days: int = Field(default_factory=lambda: int(os.environ.get("BRAIN_STALE_DAYS", "45")))
    default_bucket: str = Field(default_factory=lambda: os.environ.get("BRAIN_DEFAULT_BUCKET", "industry_docs"))
    schema_enabled: bool = Field(default_factory=lambda: _env_bool("BRAIN_SCHEMA_ENABLED", False))
    schema_profile_root: Path | None = Field(
        default_factory=lambda: Path(os.environ["BRAIN_SCHEMA_PROFILE_ROOT"])
        if os.environ.get("BRAIN_SCHEMA_PROFILE_ROOT")
        else None
    )
    search_collection_policy: str = Field(
        default_factory=lambda: os.environ.get("BRAIN_SEARCH_COLLECTION_POLICY", "schema-aware-dual-index")
    )
    compile_backend: str = Field(default_factory=lambda: os.environ.get("BRAIN_COMPILE_BACKEND", "deterministic"))
    litellm_model: str = Field(default_factory=_default_litellm_model)
    litellm_fallback_models: list[str] = Field(
        default_factory=lambda: _env_list("BRAIN_LITELLM_FALLBACK_MODELS")
    )
    litellm_provider_order: list[str] = Field(
        default_factory=lambda: _env_list("BRAIN_LITELLM_PROVIDER_ORDER", DEFAULT_LITELLM_PROVIDER_ORDER)
    )
    litellm_openrouter_model: str | None = Field(
        default_factory=lambda: os.environ.get("BRAIN_LITELLM_OPENROUTER_MODEL") or os.environ.get("OPENROUTER_MODEL")
    )
    litellm_api_base: str | None = Field(default_factory=lambda: os.environ.get("BRAIN_LITELLM_API_BASE"))
    litellm_temperature: float = Field(
        default_factory=lambda: float(os.environ.get("BRAIN_LITELLM_TEMPERATURE", "0.2"))
    )
    litellm_max_tokens: int = Field(default_factory=lambda: int(os.environ.get("BRAIN_LITELLM_MAX_TOKENS", "1200")))
    litellm_timeout_seconds: int = Field(
        default_factory=lambda: int(os.environ.get("BRAIN_LITELLM_TIMEOUT_SECONDS", "45"))
    )
    litellm_enable_answer_rewrite: bool = Field(
        default_factory=lambda: _env_bool("BRAIN_LITELLM_ENABLE_ANSWER_REWRITE", False)
    )
    search_backend: str = Field(default_factory=lambda: os.environ.get("BRAIN_SEARCH_BACKEND", "legacy"))
    qmd_bin: str = Field(default_factory=lambda: os.environ.get("BRAIN_QMD_BIN", "qmd"))
    qmd_index_name: str | None = Field(default_factory=lambda: os.environ.get("BRAIN_QMD_INDEX_NAME"))
    qmd_collection_name: str = Field(default_factory=lambda: os.environ.get("BRAIN_QMD_COLLECTION_NAME", "wiki"))
    qmd_raw_collection_name: str = Field(default_factory=lambda: os.environ.get("BRAIN_QMD_RAW_COLLECTION_NAME", "raw"))
    qmd_embed_model: str = Field(
        default_factory=lambda: os.environ.get("BRAIN_QMD_EMBED_MODEL", DEFAULT_QMD_EMBED_MODEL)
    )
    qmd_llama_gpu: str = Field(default_factory=lambda: os.environ.get("BRAIN_QMD_LLAMA_GPU", "off"))
    qmd_enable_raw_evidence: bool = Field(default_factory=lambda: _env_bool("BRAIN_QMD_ENABLE_RAW_EVIDENCE", True))
    qmd_raw_evidence_limit: int = Field(
        default_factory=lambda: int(os.environ.get("BRAIN_QMD_RAW_EVIDENCE_LIMIT", "2"))
    )
    qmd_enable_rerank: bool = Field(default_factory=lambda: _env_bool("BRAIN_QMD_ENABLE_RERANK", True))
    qmd_enable_explain: bool = Field(default_factory=lambda: _env_bool("BRAIN_QMD_ENABLE_EXPLAIN", False))

    @property
    def paths(self) -> BrainPaths:
        paths = BrainPaths(
            root=self.root.resolve(),
            source_root=self.source_root.resolve() if self.source_root is not None else None,
            workspace_root=self.workspace_root.resolve() if self.workspace_root is not None else None,
        )
        paths.ensure()
        return paths

    def load_pilot_titles(self) -> list[str]:
        pilot_file = self.paths.pilot_titles
        if pilot_file.exists():
            return json.loads(pilot_file.read_text(encoding="utf-8"))
        return DEFAULT_PILOT_TITLES.copy()

    def default_style_profile(self) -> PersonalStyleProfile:
        return PersonalStyleProfile()

    def default_method_profile(self) -> MethodProfile:
        return MethodProfile()

    @property
    def resolved_qmd_index_name(self) -> str:
        if self.qmd_index_name:
            return self.qmd_index_name
        return f"{_slugify_search_name(self.root.resolve().name)}-wiki"

    @property
    def source_prefix(self) -> str:
        try:
            return self.paths.raw.relative_to(self.root.resolve()).as_posix()
        except ValueError:
            return self.paths.raw.name

    @classmethod
    def from_env(cls) -> "BrainConfig":
        root = Path(os.environ.get("BRAIN_ROOT", Path.cwd())).resolve()
        _load_dotenv_for_root(root)
        root = Path(os.environ.get("BRAIN_ROOT", root)).resolve()
        source_root_raw = os.environ.get("BRAIN_SOURCE_ROOT")
        workspace_root_raw = os.environ.get("BRAIN_WORKSPACE_ROOT")
        schema_profile_root_raw = os.environ.get("BRAIN_SCHEMA_PROFILE_ROOT")
        return cls(
            root=root,
            source_root=Path(source_root_raw).resolve() if source_root_raw else None,
            workspace_root=Path(workspace_root_raw).resolve() if workspace_root_raw else None,
            schema_profile_root=Path(schema_profile_root_raw).resolve() if schema_profile_root_raw else None,
        )
