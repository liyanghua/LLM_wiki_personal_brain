from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from personal_brain.config import BrainConfig
from personal_brain.models import AgentRunRequest
from personal_brain.skills.strategy_runtime import StrategyRuntimeService


def to_camel_case(value):
    if isinstance(value, list):
        return [to_camel_case(item) for item in value]
    if isinstance(value, dict):
        converted = {}
        for key, item in value.items():
            parts = key.split("_")
            camel_key = parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])
            converted[camel_key] = to_camel_case(item)
        return converted
    return value


def to_snake_case(value):
    if isinstance(value, list):
        return [to_snake_case(item) for item in value]
    if isinstance(value, dict):
        converted = {}
        for key, item in value.items():
            snake_key = ""
            for index, ch in enumerate(key):
                if ch.isupper() and index > 0:
                    snake_key += "_"
                snake_key += ch.lower()
            converted[snake_key] = to_snake_case(item)
        return converted
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run open_llm_wiki strategy/skills/agent bridge actions.")
    subparsers = parser.add_subparsers(dest="action", required=True)

    subparsers.add_parser("ensure-binding")

    gen = subparsers.add_parser("generate-skill-candidates")
    gen.add_argument("--doc-id", required=True)
    gen.add_argument("--scene-id", required=True)

    approve = subparsers.add_parser("approve-skill")
    approve.add_argument("--skill-id", required=True)
    approve.add_argument("--tier", choices=["pilot", "stable"], required=True)

    run = subparsers.add_parser("run-agent")
    run.add_argument("--payload-json", required=True)

    return parser


def main() -> None:
    args = build_parser().parse_args()
    config = BrainConfig.from_env()
    service = StrategyRuntimeService(config)

    if args.action == "ensure-binding":
        print(json.dumps(to_camel_case(service.ensure_project_binding()), ensure_ascii=False))
        return
    if args.action == "generate-skill-candidates":
        manifests = service.generate_strategy_skill_candidates(args.doc_id, args.scene_id)
        print(json.dumps(to_camel_case([item.model_dump(mode="json") for item in manifests]), ensure_ascii=False))
        return
    if args.action == "approve-skill":
        approved = service.approve_strategy_skill(args.skill_id, args.tier)
        print(json.dumps(to_camel_case(approved.model_dump(mode="json")), ensure_ascii=False))
        return
    if args.action == "run-agent":
        payload = to_snake_case(json.loads(args.payload_json))
        result = service.run_agent(AgentRunRequest.model_validate(payload))
        print(json.dumps(to_camel_case(result.model_dump(mode="json")), ensure_ascii=False))
        return
    raise SystemExit(f"unknown action: {args.action}")


if __name__ == "__main__":
    main()
