from __future__ import annotations

from personal_brain.config import BrainConfig
from personal_brain.models import AnswerRecord, SessionRecord, WritebackBundle
from personal_brain.utils.files import utc_now, write_json
from personal_brain.writeback.merger import WritebackMerger
from personal_brain.writeback.router import WritebackRouter, context_from_session_record


class WritebackService:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.paths = config.paths
        self.router = WritebackRouter()
        self.merger = WritebackMerger(config)

    def create_proposal(self, query_id: str, apply: bool = False) -> WritebackBundle:
        answer_record = self._load_answer_record(query_id)
        session_record = self._load_session_record(answer_record)
        bundle = self.router.route(context_from_session_record(session_record))
        if apply:
            bundle.applied_targets = self.merger.apply(bundle, session_record)
        proposal_path = self.paths.writeback_dir / f"{query_id}.json"
        write_json(proposal_path, bundle.model_dump(mode="json"))
        self._append_log(query_id, apply, bundle)
        return bundle

    def _load_answer_record(self, query_id: str) -> AnswerRecord:
        if not self.paths.answer_records.exists():
            raise FileNotFoundError(f"Answer record not found: {query_id}")
        for line in self.paths.answer_records.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            record = AnswerRecord.model_validate_json(line)
            if record.query_id == query_id:
                return record
        raise FileNotFoundError(f"Answer record not found: {query_id}")

    def _load_session_record(self, answer_record: AnswerRecord) -> SessionRecord:
        if answer_record.session_record_path:
            path = self.config.root / answer_record.session_record_path
            if path.exists():
                return SessionRecord.model_validate_json(path.read_text(encoding="utf-8"))
        session_root = self.paths.memory / "session"
        for path in sorted(session_root.glob("20??-??-??/*.json")):
            record = SessionRecord.model_validate_json(path.read_text(encoding="utf-8"))
            if record.query_id == answer_record.query_id:
                return record
        raise FileNotFoundError(f"Session record not found: {answer_record.query_id}")

    def _append_log(self, query_id: str, apply: bool, bundle: WritebackBundle) -> None:
        action = "writeback-apply" if apply else "writeback-proposal"
        previous = self.paths.wiki_log.read_text(encoding="utf-8") if self.paths.wiki_log.exists() else "# Wiki Log\n\n"
        previous += f"## [{utc_now()}] {action} | query_id={query_id} | targets={len(bundle.targets)}\n"
        self.paths.wiki_log.write_text(previous, encoding="utf-8")
