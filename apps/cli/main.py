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
from personal_brain.wiki.compiler import WikiCompiler
from personal_brain.writeback.service import WritebackService


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Personal Brain Batch 1 CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    ingest = subparsers.add_parser("ingest", help="Ingest source files into raw metadata manifest.")
    ingest.add_argument("paths", nargs="+")
    ingest.add_argument("--bucket", default=None)

    subparsers.add_parser("build-wiki", help="Compile wiki pages from ingested sources.")
    subparsers.add_parser("build-assets", help="Build ontology and skill candidate assets.")

    ask = subparsers.add_parser("ask", help="Answer a question from the wiki.")
    ask.add_argument("question")

    subparsers.add_parser("lint", help="Run wiki lint checks.")
    subparsers.add_parser("eval", help="Evaluate current personal-brain asset quality.")

    writeback = subparsers.add_parser("writeback", help="Create or apply a writeback proposal.")
    writeback.add_argument("query_id")
    writeback.add_argument("--apply", action="store_true")

    return parser


def main() -> None:
    args = build_parser().parse_args()
    config = BrainConfig.from_env()

    if args.command == "ingest":
        service = IngestionService(config)
        records = service.ingest_paths([Path(item) for item in args.paths], bucket=args.bucket)
        print(json.dumps({"ingested": len(records), "manifest": str(config.paths.source_manifest)}, ensure_ascii=False))
        return

    if args.command == "build-wiki":
        result = WikiCompiler(config).build()
        print(
            json.dumps(
                {"source_pages": len(result.source_pages), "derived_pages": len(result.derived_pages)},
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

    if args.command == "lint":
        result = WikiLintService(config).run()
        print(json.dumps(result.model_dump(mode="json"), ensure_ascii=False))
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
