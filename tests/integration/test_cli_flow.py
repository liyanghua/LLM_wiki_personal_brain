from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


def run_cli(brain_workspace, *args: str) -> subprocess.CompletedProcess[str]:
    repo_root = Path(__file__).resolve().parents[2]
    env = os.environ.copy()
    env["BRAIN_ROOT"] = str(brain_workspace)
    env["PYTHONPATH"] = str(repo_root / "src") + os.pathsep + str(repo_root) + os.pathsep + env.get("PYTHONPATH", "")
    return subprocess.run(
        [sys.executable, "-m", "apps.cli.main", *args],
        cwd=repo_root,
        env=env,
        text=True,
        capture_output=True,
        check=True,
    )


def test_cli_end_to_end(brain_workspace) -> None:
    run_cli(brain_workspace, "ingest", str(brain_workspace / "raw" / "industry_docs"), str(brain_workspace / "raw" / "conversations"))
    run_cli(brain_workspace, "build-wiki")
    ask = run_cli(brain_workspace, "ask", "什么是品牌经营OS？")
    lint = run_cli(brain_workspace, "lint")

    assert "Fact" in ask.stdout
    payload = json.loads(lint.stdout)
    assert payload["issues"] == []
