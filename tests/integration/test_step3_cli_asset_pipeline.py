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


def test_cli_step3_asset_pipeline(brain_workspace) -> None:
    run_cli(
        brain_workspace,
        "ingest",
        str(brain_workspace / "raw" / "industry_docs"),
        str(brain_workspace / "raw" / "conversations"),
    )
    run_cli(brain_workspace, "build-wiki")
    run_cli(brain_workspace, "ask", "品牌经营OS和SUPER指标之间是什么关系？")
    run_cli(brain_workspace, "ask", "如何把品牌经营OS整理成可复用的方法框架？")

    answer_records = (brain_workspace / "memory" / "session" / "answer_records.jsonl").read_text(encoding="utf-8").splitlines()
    query_id = json.loads(answer_records[-1])["query_id"]

    writeback = run_cli(brain_workspace, "writeback", query_id, "--apply")
    build_assets = run_cli(brain_workspace, "build-assets")
    report = run_cli(brain_workspace, "eval")

    writeback_payload = json.loads(writeback.stdout)
    build_assets_payload = json.loads(build_assets.stdout)
    report_payload = json.loads(report.stdout)

    assert writeback_payload["targets"]
    assert build_assets_payload["ontology_candidates"] >= 1
    assert build_assets_payload["skill_candidates"] >= 1
    assert report_payload["metrics"]["answer_asset_value"] >= 0.0
    assert (brain_workspace / "ontology" / "candidates" / "index.json").exists()
    assert (brain_workspace / "skills" / "candidates" / "index.json").exists()
