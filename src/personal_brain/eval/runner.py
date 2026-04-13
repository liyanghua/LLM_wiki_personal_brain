from __future__ import annotations

import json

from personal_brain.agent.method_profile import MethodProfileLoader
from personal_brain.config import BrainConfig
from personal_brain.eval.asset_value import evaluate_asset_value
from personal_brain.eval.memory_precision import evaluate_memory_precision
from personal_brain.eval.method_consistency import evaluate_method_consistency
from personal_brain.eval.ontology_quality import evaluate_ontology_quality
from personal_brain.eval.skill_candidate_quality import evaluate_skill_candidate_quality
from personal_brain.eval.writeback_precision import evaluate_writeback_precision
from personal_brain.models import EvaluationCase, EvaluationCaseResult, EvaluationReport, OntologyCandidate, SessionRecord, SkillCandidateManifest
from personal_brain.utils.files import utc_now
from personal_brain.utils.text import overlap_score


class EvaluationRunner:
    def __init__(self, config: BrainConfig) -> None:
        self.config = config
        self.paths = config.paths

    def run(self) -> EvaluationReport:
        cases = self._load_cases()
        sessions = self._load_session_records()
        candidates = self._load_ontology_candidates()
        manifests = self._load_skill_candidates()
        profile = MethodProfileLoader(self.config).load()

        case_results: list[EvaluationCaseResult] = []
        metric_buckets: dict[str, list[float]] = {
            "answer_asset_value": [],
            "writeback_precision": [],
            "memory_precision": [],
            "method_consistency": [],
            "ontology_quality": [],
            "skill_candidate_quality": [],
        }

        for case in cases:
            record = self._match_session(case.question, sessions)
            asset_score, asset_explanation = evaluate_asset_value(record)
            writeback_score, matched_targets, missing_targets, writeback_explanation = evaluate_writeback_precision(case, record)
            memory_score, memory_explanation = evaluate_memory_precision(record)
            method_score, method_explanation = evaluate_method_consistency(record, profile, self.config.root)
            ontology_score, ontology_explanation = evaluate_ontology_quality(case, candidates)
            skill_score, skill_explanation = evaluate_skill_candidate_quality(case, manifests)

            scores = {
                "answer_asset_value": asset_score,
                "writeback_precision": writeback_score,
                "memory_precision": memory_score,
                "method_consistency": method_score,
                "ontology_quality": ontology_score,
                "skill_candidate_quality": skill_score,
            }
            for key, value in scores.items():
                metric_buckets[key].append(value)

            average_score = sum(scores.values()) / len(scores)
            worth = "值得沉淀" if average_score >= 0.65 else "暂不值得优先沉淀"
            explanation = "；".join(
                [
                    worth,
                    asset_explanation,
                    writeback_explanation,
                    memory_explanation,
                    method_explanation,
                    ontology_explanation,
                    skill_explanation,
                ]
            )
            case_results.append(
                EvaluationCaseResult(
                    case_id=case.case_id,
                    question=case.question,
                    scores=scores,
                    matched_targets=matched_targets,
                    missing_targets=missing_targets,
                    explanation=explanation,
                )
            )

        created_at = utc_now()
        run_id = created_at.replace("-", "").replace(":", "").replace("T", "-").replace("Z", "")
        metrics = {
            key: (sum(values) / len(values) if values else 0.0)
            for key, values in metric_buckets.items()
        }
        report = EvaluationReport(
            run_id=run_id,
            created_at=created_at,
            metrics=metrics,
            case_results=case_results,
        )
        json_path = self.paths.eval_reports / f"{run_id}.json"
        markdown_path = self.paths.eval_reports / f"{run_id}.md"
        json_path.write_text(json.dumps(report.model_dump(mode="json"), ensure_ascii=False, indent=2), encoding="utf-8")
        markdown_path.write_text(self._render_markdown(report), encoding="utf-8")
        report.report_path_json = str(json_path.relative_to(self.config.root))
        report.report_path_markdown = str(markdown_path.relative_to(self.config.root))
        json_path.write_text(json.dumps(report.model_dump(mode="json"), ensure_ascii=False, indent=2), encoding="utf-8")
        return report

    def _load_cases(self) -> list[EvaluationCase]:
        return [
            EvaluationCase.model_validate_json(path.read_text(encoding="utf-8"))
            for path in sorted(self.paths.eval_cases.glob("*.json"))
        ]

    def _load_session_records(self) -> list[SessionRecord]:
        return [
            SessionRecord.model_validate_json(path.read_text(encoding="utf-8"))
            for path in sorted((self.paths.memory / "session").glob("20??-??-??/*.json"))
        ]

    def _load_ontology_candidates(self) -> list[OntologyCandidate]:
        index_path = self.paths.ontology_candidates / "index.json"
        if not index_path.exists():
            return []
        payload = json.loads(index_path.read_text(encoding="utf-8"))
        return [OntologyCandidate.model_validate(item) for item in payload]

    def _load_skill_candidates(self) -> list[SkillCandidateManifest]:
        index_path = self.paths.skills_candidates / "index.json"
        if not index_path.exists():
            return []
        payload = json.loads(index_path.read_text(encoding="utf-8"))
        return [SkillCandidateManifest.model_validate(item) for item in payload]

    def _match_session(self, question: str, sessions: list[SessionRecord]) -> SessionRecord | None:
        best: tuple[int, float, str, SessionRecord] | None = None
        for record in sessions:
            score = overlap_score(question, record.user_query)
            if record.user_query == question:
                score += 10_000
            candidate = (score, record.asset_value_signals.overall_score, record.created_at, record)
            if best is None or candidate[:3] > best[:3]:
                best = candidate
        return best[3] if best is not None and best[0] > 0 else None

    def _render_markdown(self, report: EvaluationReport) -> str:
        lines = [
            f"# Step3 Evaluation Report {report.run_id}",
            "",
            "## Metrics",
        ]
        for key, value in report.metrics.items():
            lines.append(f"- {key}: {value:.2f}")
        lines.extend(["", "## Cases"])
        for case in report.case_results:
            lines.extend(
                [
                    f"### {case.case_id}",
                    f"- Question: {case.question}",
                    f"- Scores: {json.dumps(case.scores, ensure_ascii=False)}",
                    f"- Matched Targets: {', '.join(case.matched_targets) if case.matched_targets else 'none'}",
                    f"- Missing Targets: {', '.join(case.missing_targets) if case.missing_targets else 'none'}",
                    f"- Explanation: {case.explanation}",
                    "",
                ]
            )
        return "\n".join(lines).strip() + "\n"
