from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


def run_cli(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    repo_root = Path(__file__).resolve().parents[2]
    env = os.environ.copy()
    env["BRAIN_ROOT"] = str(root)
    env["BRAIN_SOURCE_ROOT"] = str(root / "raw_new")
    env["BRAIN_WORKSPACE_ROOT"] = str(root / "pilot_workspace")
    env["BRAIN_SCHEMA_ENABLED"] = "true"
    env["PYTHONPATH"] = str(repo_root / "src") + os.pathsep + str(repo_root) + os.pathsep + env.get("PYTHONPATH", "")
    return subprocess.run(
        [sys.executable, "-m", "apps.cli.main", *args],
        cwd=repo_root,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_schema_init_build_and_quality_report_flow(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)

    init = run_cli(workspace, "schema-init", "--root", "raw_new")
    assert init.returncode == 0
    init_payload = json.loads(init.stdout)
    assert init_payload["root"].endswith("raw_new")
    assert (workspace / "raw_new" / ".brain" / "_dir_schema.yaml").exists()

    doc = workspace / "raw_new" / "industry_docs" / "6大维度·42个细分变量选择逻辑01.md"
    doc.parent.mkdir(parents=True, exist_ok=True)
    doc.write_text(
        "# 6大维度·42个细分变量选择逻辑01\n\n## 维度1：视觉核心层（决定第一眼停留）\n\n视觉核心层优先。\n",
        encoding="utf-8",
    )

    ingest = run_cli(workspace, "ingest", str(doc))
    assert ingest.returncode == 0

    build = run_cli(workspace, "build-wiki")
    assert build.returncode == 0
    build_payload = json.loads(build.stdout)
    assert build_payload["derived_pages"] >= 1
    assert "compile_backend" in build_payload
    assert "compile_model" in build_payload
    assert "fallback_count" in build_payload
    assert (workspace / "pilot_workspace" / "wiki" / "index.md").exists()

    rebuild = run_cli(workspace, "search-rebuild")
    assert rebuild.returncode == 0
    rebuild_payload = json.loads(rebuild.stdout)
    assert "backend" in rebuild_payload

    quality = run_cli(workspace, "wiki-quality-report")
    assert quality.returncode == 0
    payload = json.loads(quality.stdout)
    assert payload["report_json"].endswith(".json")
    assert payload["report_markdown"].endswith(".md")
    assert payload["metrics"]["structural_quality"] >= 0.0
    assert "compile_backend_health" in payload["metrics"]
    assert "compile_contract_quality" in payload["metrics"]
    assert "compile_stability" in payload["metrics"]
