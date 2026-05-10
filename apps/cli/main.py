from __future__ import annotations

import argparse
import json
from pathlib import Path

from personal_brain.assets.service import AssetBuildService
from personal_brain.config import BrainConfig
from personal_brain.eval.runner import EvaluationRunner
from personal_brain.ingestion.service import IngestionService
from personal_brain.lint.service import WikiLintService
from personal_brain.retrieval.query_engine import QueryEngine
from personal_brain.retrieval.search_provider import SearchIndexManager
from personal_brain.wiki.compiler import WikiCompiler
from personal_brain.writeback.service import WritebackService


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Personal Brain Batch 1 CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    ingest = subparsers.add_parser("ingest", help="Ingest source files into raw metadata manifest.")
    ingest.add_argument("paths", nargs="+")
    ingest.add_argument("--bucket", default=None)

    schema_init = subparsers.add_parser("schema-init", help="Create raw_new schema control-plane files.")
    schema_init.add_argument("--root", default="raw_new")

    subparsers.add_parser("build-wiki", help="Compile wiki pages from ingested sources.")
    subparsers.add_parser("build-assets", help="Build ontology and skill candidate assets.")
    subparsers.add_parser("search-rebuild", help="Rebuild the backend-managed wiki search index.")

    ask = subparsers.add_parser("ask", help="Answer a question from the wiki.")
    ask.add_argument("question")

    subparsers.add_parser("lint", help="Run wiki lint checks.")
    wiki_quality = subparsers.add_parser("wiki-quality-report", help="Run schema-aware wiki quality audit.")
    wiki_quality.add_argument("--gold-question", action="append", dest="gold_questions", default=[])
    subparsers.add_parser("eval", help="Evaluate current personal-brain asset quality.")

    writeback = subparsers.add_parser("writeback", help="Create or apply a writeback proposal.")
    writeback.add_argument("query_id")
    writeback.add_argument("--apply", action="store_true")

    return parser


def main() -> None:
    args = build_parser().parse_args()
    config = BrainConfig.from_env()

    if args.command == "schema-init":
        target_root = (config.root / args.root).resolve()
        service = IngestionService(
            config.model_copy(update={"source_root": target_root, "schema_enabled": True})
        )
        result = service.initialize_schema_from_doc(target_root)
        print(json.dumps(result, ensure_ascii=False))
        return

    if args.command == "ingest":
        service = IngestionService(config)
        records = service.ingest_paths([Path(item) for item in args.paths], bucket=args.bucket)
        print(json.dumps({"ingested": len(records), "manifest": str(config.paths.source_manifest)}, ensure_ascii=False))
        return

    if args.command == "build-wiki":
        result = WikiCompiler(config).build()
        print(
            json.dumps(
                {
                    "source_pages": len(result.source_pages),
                    "derived_pages": len(result.derived_pages),
                    "compile_backend": result.compile_backend,
                    "compile_model": result.compile_model,
                    "fallback_count": result.fallback_count,
                },
                ensure_ascii=False,
            )
        )
        return

    if args.command == "ask":
        result = QueryEngine(config).ask(args.question)
        print(result.answer_markdown, end="")
        return

    if args.command == "build-assets":
        result = AssetBuildService(config).build()
        print(json.dumps(result.model_dump(mode="json"), ensure_ascii=False))
        return

    if args.command == "search-rebuild":
        result = SearchIndexManager(config).rebuild()
        print(json.dumps(result, ensure_ascii=False))
        return

    if args.command == "lint":
        result = WikiLintService(config).run()
        print(json.dumps(result.model_dump(mode="json"), ensure_ascii=False))
        return

    if args.command == "wiki-quality-report":
        result = WikiLintService(config).run_quality_audit(gold_questions=args.gold_questions)
        print(
            json.dumps(
                {
                    "metrics": result.metrics,
                    "issues": [issue.model_dump(mode="json") for issue in result.issues],
                    "report_json": result.report_path_json,
                    "report_markdown": result.report_path_markdown,
                },
                ensure_ascii=False,
            )
        )
        return

    if args.command == "eval":
        report = EvaluationRunner(config).run()
        print(json.dumps(report.model_dump(mode="json"), ensure_ascii=False))
        return

    if args.command == "writeback":
        proposal = WritebackService(config).create_proposal(args.query_id, apply=args.apply)
        print(json.dumps(proposal.model_dump(mode="json"), ensure_ascii=False))
        return


if __name__ == "__main__":
    main()
