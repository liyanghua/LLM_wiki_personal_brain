from __future__ import annotations

import argparse
import json
from pathlib import Path

from personal_brain.open_llm_wiki_bootstrap import seed_store_from_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Seed open_llm_wiki Tauri app-state.json from repo .env")
    parser.add_argument(
        "--env-file",
        default=".env",
        help="Path to the source .env file. Defaults to the repo root .env.",
    )
    parser.add_argument(
        "--store-path",
        default="~/Library/Application Support/com.llmwiki.app/app-state.json",
        help="Path to the target app-state.json file.",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    result = seed_store_from_env(
        env_file=Path(args.env_file).expanduser().resolve(),
        store_path=Path(args.store_path).expanduser().resolve(),
    )
    print(
        json.dumps(
            {
                "store_path": str(result.store_path),
                "backup_path": str(result.backup_path) if result.backup_path else None,
                "active_preset_id": result.active_preset_id,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
