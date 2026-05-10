use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::panic_guard::run_guarded;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBrainBindingResult {
    pub project_path: String,
    pub brain_root: String,
    pub source_root: String,
    pub workspace_root: String,
    pub schema_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrategySkillCandidateManifestResult {
    pub skill_id: String,
    pub family: String,
    pub title: String,
    pub summary: String,
    pub scene_id: String,
    pub linked_doc_ids: Vec<String>,
    pub origin_strategy_card_ids: Vec<String>,
    pub wiki_refs: Vec<String>,
    pub source_refs: Vec<String>,
    pub validation_criteria: Vec<String>,
    pub promotion_state: String,
    pub generated_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovedSkillSpecResult {
    pub skill_id: String,
    pub title: String,
    pub scene_id: String,
    pub tier: String,
    pub family: String,
    pub path: String,
    pub wiki_refs: Vec<String>,
    pub source_refs: Vec<String>,
    pub input_schema: serde_json::Value,
    pub output_schema: serde_json::Value,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunResultPayload {
    pub run_id: String,
    pub project_path: String,
    pub doc_id: String,
    pub scene_id: String,
    pub run_mode: String,
    pub selected_skill_ids: Vec<String>,
    pub grounding_sources: Vec<String>,
    pub result_summary: String,
    pub trace: Vec<String>,
    pub output_artifacts: Vec<String>,
    pub created_at: String,
}

fn repo_root_from_cwd() -> Result<PathBuf, String> {
    let mut cursor = env::current_dir().map_err(|e| format!("failed to resolve current_dir: {e}"))?;
    loop {
        let script = cursor.join("scripts").join("run_strategy_runtime.py");
        let package = cursor.join("src").join("personal_brain");
        if script.exists() && package.exists() {
            return Ok(cursor);
        }
        if !cursor.pop() {
            break;
        }
    }
    Err("failed to locate repository root for strategy runtime".to_string())
}

fn resolve_python_binary(repo_root: &Path) -> String {
    if let Ok(custom) = env::var("OPEN_LLM_WIKI_PYTHON") {
        if !custom.trim().is_empty() {
            return custom;
        }
    }
    let venv_python = repo_root.join(".venv").join("bin").join("python3");
    if venv_python.exists() {
        return venv_python.to_string_lossy().into_owned();
    }
    "python3".into()
}

fn run_strategy_runtime(
    project_path: &str,
    args: &[&str],
    payload_json: Option<&str>,
) -> Result<Vec<u8>, String> {
    let repo_root = repo_root_from_cwd()?;
    let script_path = repo_root.join("scripts").join("run_strategy_runtime.py");
    if !script_path.exists() {
        return Err(format!("strategy runtime script not found: {}", script_path.display()));
    }

    let python = resolve_python_binary(&repo_root);
    let mut command = Command::new(python);
    command.arg(script_path);
    for arg in args {
        command.arg(arg);
    }
    if let Some(payload) = payload_json {
        command.arg(payload);
    }
    command.env("BRAIN_ROOT", project_path);
    command.env("BRAIN_SOURCE_ROOT", format!("{project_path}/raw"));
    command.env("BRAIN_WORKSPACE_ROOT", project_path);
    command.env("BRAIN_SCHEMA_ENABLED", "false");
    command.current_dir(repo_root);

    let output = command
        .output()
        .map_err(|e| format!("failed to launch strategy runtime: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("strategy runtime failed with exit {:?}", output.status.code())
        } else {
            stderr
        });
    }
    Ok(output.stdout)
}

#[tauri::command]
pub async fn ensure_project_brain_binding(
    project_path: String,
) -> Result<ProjectBrainBindingResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_guarded("ensure_project_brain_binding", || {
            let output = run_strategy_runtime(&project_path, &["ensure-binding"], None)?;
            serde_json::from_slice::<ProjectBrainBindingResult>(&output)
                .map_err(|e| format!("failed to parse project brain binding JSON: {e}"))
        })
    })
    .await
    .map_err(|e| format!("ensure_project_brain_binding blocking task join error: {e}"))?
}

#[tauri::command]
pub async fn generate_strategy_skill_candidates(
    project_path: String,
    doc_id: String,
    scene_id: String,
) -> Result<Vec<StrategySkillCandidateManifestResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_guarded("generate_strategy_skill_candidates", || {
            let output = run_strategy_runtime(
                &project_path,
                &[
                    "generate-skill-candidates",
                    "--doc-id",
                    &doc_id,
                    "--scene-id",
                    &scene_id,
                ],
                None,
            )?;
            serde_json::from_slice::<Vec<StrategySkillCandidateManifestResult>>(&output)
                .map_err(|e| format!("failed to parse strategy skill candidates JSON: {e}"))
        })
    })
    .await
    .map_err(|e| format!("generate_strategy_skill_candidates blocking task join error: {e}"))?
}

#[tauri::command]
pub async fn approve_strategy_skill(
    project_path: String,
    skill_id: String,
    tier: String,
) -> Result<ApprovedSkillSpecResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_guarded("approve_strategy_skill", || {
            let output = run_strategy_runtime(
                &project_path,
                &["approve-skill", "--skill-id", &skill_id, "--tier", &tier],
                None,
            )?;
            serde_json::from_slice::<ApprovedSkillSpecResult>(&output)
                .map_err(|e| format!("failed to parse approved skill JSON: {e}"))
        })
    })
    .await
    .map_err(|e| format!("approve_strategy_skill blocking task join error: {e}"))?
}

#[tauri::command]
pub async fn run_project_agent(
    project_path: String,
    payload_json: String,
) -> Result<AgentRunResultPayload, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_guarded("run_project_agent", || {
            let output = run_strategy_runtime(
                &project_path,
                &["run-agent", "--payload-json"],
                Some(&payload_json),
            )?;
            serde_json::from_slice::<AgentRunResultPayload>(&output)
                .map_err(|e| format!("failed to parse project agent run JSON: {e}"))
        })
    })
    .await
    .map_err(|e| format!("run_project_agent blocking task join error: {e}"))?
}
