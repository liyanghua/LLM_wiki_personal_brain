from __future__ import annotations

import json
import os
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from personal_brain.models import MethodProfile, PersonalStyleProfile


DEFAULT_PILOT_TITLES = [
    "电商运营本体核心文档",
    "淘天商品全生命周期智能运营AI体",
    "货品全生命周期管理-SUPER指标模型",
    "桌垫类目-儿童学习桌垫单因子测图示例",
    "背景选择_访谈日志",
]


class BrainPaths(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    root: Path

    @property
    def raw(self) -> Path:
        return self.root / "raw"

    @property
    def raw_brain(self) -> Path:
        return self.raw / ".brain"

    @property
    def wiki(self) -> Path:
        return self.root / "wiki"

    @property
    def ontology(self) -> Path:
        return self.root / "ontology"

    @property
    def memory(self) -> Path:
        return self.root / "memory"

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
        return self.root / "skills" / "candidates"

    @property
    def eval_cases(self) -> Path:
        return self.root / "eval" / "cases"

    @property
    def eval_reports(self) -> Path:
        return self.root / "eval" / "reports"

    def session_day_dir(self, day: str) -> Path:
        return self.memory / "session" / day

    def session_record_path(self, day: str, query_id: str) -> Path:
        return self.session_day_dir(day) / f"{query_id}.json"

    def session_summary_path(self, day: str) -> Path:
        return self.session_summaries_dir / f"{day}.md"

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
            self.ontology_candidates,
            self.memory / "session",
            self.session_summaries_dir,
            self.memory / "persistent",
            self.memory / "skills",
            self.memory / "summaries",
            self.answers_dir,
            self.writeback_dir,
            self.skills_candidates,
            self.eval_cases,
            self.eval_reports,
        ]:
            path.mkdir(parents=True, exist_ok=True)


class BrainConfig(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    root: Path = Field(default_factory=lambda: Path.cwd())
    stale_days: int = Field(default_factory=lambda: int(os.environ.get("BRAIN_STALE_DAYS", "45")))
    default_bucket: str = Field(default_factory=lambda: os.environ.get("BRAIN_DEFAULT_BUCKET", "industry_docs"))

    @property
    def paths(self) -> BrainPaths:
        paths = BrainPaths(root=self.root.resolve())
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

    @classmethod
    def from_env(cls) -> "BrainConfig":
        root = Path(os.environ.get("BRAIN_ROOT", Path.cwd()))
        return cls(root=root)
