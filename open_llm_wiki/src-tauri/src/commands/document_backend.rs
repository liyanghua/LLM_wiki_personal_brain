use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

use crate::panic_guard::run_guarded;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentBackendArtifactResult {
    pub source_kind: String,
    pub backend: String,
    pub status: String,
    pub detail: String,
    pub degraded: bool,
    pub analysis_path: Option<String>,
    pub markdown_path: Option<String>,
    pub json_path: Option<String>,
    pub html_path: Option<String>,
    pub normalized_path: Option<String>,
    pub document_ir_path: Option<String>,
    pub converted_source_path: Option<String>,
    pub asset_dir_path: Option<String>,
    pub page_count: Option<i32>,
    pub ocr_used: bool,
    pub available_enhancers: Vec<String>,
    pub missing_enhancers: Vec<String>,
    pub warnings: Vec<String>,
}

fn path_if_exists(path: &Path) -> Option<String> {
    if path.exists() {
        Some(path.to_string_lossy().into_owned())
    } else {
        None
    }
}

fn resolve_python_binary() -> String {
    if let Ok(custom) = env::var("OPEN_LLM_WIKI_PYTHON") {
        if !custom.trim().is_empty() {
            return custom;
        }
    }
    "python3".into()
}

fn find_document_backend_script_from(cwd: &Path) -> Option<PathBuf> {
    for ancestor in cwd.ancestors() {
        let candidate = ancestor
            .join("scripts")
            .join("document_backend")
            .join("prepare_document.py");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

fn resolve_document_backend_script() -> Result<PathBuf, String> {
    let cwd = env::current_dir().map_err(|e| format!("failed to resolve current_dir: {e}"))?;
    find_document_backend_script_from(&cwd).ok_or_else(|| {
        let expected = cwd
            .join("scripts")
            .join("document_backend")
            .join("prepare_document.py");
        format!("document backend script not found: {}", expected.display())
    })
}

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create dir {}: {e}", parent.display()))?;
    }
    Ok(())
}

fn parse_result_json(output: &[u8]) -> Result<serde_json::Value, String> {
    serde_json::from_slice(output).map_err(|e| format!("failed to parse document backend JSON: {e}"))
}

fn json_string(value: &serde_json::Value, key: &str) -> Option<String> {
    value.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

fn json_bool_vec(value: &serde_json::Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub async fn analyze_document_with_backend(
    project_path: String,
    source_path: String,
    output_dir: String,
    source_kind: String,
    multimodal_enabled: bool,
    multimodal_available: bool,
) -> Result<DocumentBackendArtifactResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_guarded("analyze_document_with_backend", || {
            let output_dir_path = Path::new(&output_dir);
            fs::create_dir_all(output_dir_path)
                .map_err(|e| format!("failed to create document artifact dir: {e}"))?;

            let script_path = resolve_document_backend_script()?;

            let python = resolve_python_binary();
            let mut command = Command::new(python);
            command
                .arg(script_path)
                .arg("--project-path")
                .arg(&project_path)
                .arg("--source-path")
                .arg(&source_path)
                .arg("--output-dir")
                .arg(&output_dir)
                .arg("--source-kind")
                .arg(&source_kind);

            if multimodal_enabled {
                command.arg("--multimodal-enabled");
            }
            if multimodal_available {
                command.arg("--multimodal-available");
            }

            let output = command
                .output()
                .map_err(|e| format!("failed to launch document backend: {e}"))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                return Err(if stderr.is_empty() {
                    format!("document backend failed with exit {:?}", output.status.code())
                } else {
                    stderr
                });
            }

            let parsed = parse_result_json(&output.stdout)?;
            let analysis_path = json_string(&parsed, "analysis_path");
            let markdown_path = json_string(&parsed, "markdown_path");
            let json_path = json_string(&parsed, "json_path");
            let html_path = json_string(&parsed, "html_path");
            let normalized_path = json_string(&parsed, "normalized_path");
            let document_ir_path = json_string(&parsed, "document_ir_path");
            let converted_source_path = json_string(&parsed, "converted_source_path");
            let asset_dir_path = json_string(&parsed, "asset_dir_path");
            let page_count = parsed.get("page_count").and_then(|v| v.as_i64()).map(|n| n as i32);
            let ocr_used = parsed.get("ocr_used").and_then(|v| v.as_bool()).unwrap_or(false);

            if let Some(path) = analysis_path.as_ref() {
                ensure_parent(Path::new(path))?;
            }

            Ok(DocumentBackendArtifactResult {
                source_kind: json_string(&parsed, "source_kind").unwrap_or_else(|| source_kind.clone()),
                backend: json_string(&parsed, "backend").unwrap_or_else(|| "generic".into()),
                status: json_string(&parsed, "status").unwrap_or_else(|| "fallback".into()),
                detail: json_string(&parsed, "detail").unwrap_or_else(|| "document backend completed".into()),
                degraded: parsed.get("degraded").and_then(|v| v.as_bool()).unwrap_or(true),
                analysis_path: analysis_path.and_then(|path| path_if_exists(Path::new(&path)).or(Some(path))),
                markdown_path: markdown_path.and_then(|path| path_if_exists(Path::new(&path)).or(Some(path))),
                json_path: json_path.and_then(|path| path_if_exists(Path::new(&path)).or(Some(path))),
                html_path: html_path.and_then(|path| path_if_exists(Path::new(&path)).or(Some(path))),
                normalized_path: normalized_path.and_then(|path| path_if_exists(Path::new(&path)).or(Some(path))),
                document_ir_path: document_ir_path.and_then(|path| path_if_exists(Path::new(&path)).or(Some(path))),
                converted_source_path: converted_source_path.and_then(|path| path_if_exists(Path::new(&path)).or(Some(path))),
                asset_dir_path: asset_dir_path.and_then(|path| path_if_exists(Path::new(&path)).or(Some(path))),
                page_count,
                ocr_used,
                available_enhancers: json_bool_vec(&parsed, "available_enhancers"),
                missing_enhancers: json_bool_vec(&parsed, "missing_enhancers"),
                warnings: json_bool_vec(&parsed, "warnings"),
            })
        })
    })
    .await
    .map_err(|e| format!("analyze_document_with_backend blocking task join error: {e}"))?
}

#[tauri::command]
pub async fn convert_doc_to_docx(
    source_path: String,
    output_dir: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_guarded("convert_doc_to_docx", || {
            let source = PathBuf::from(&source_path);
            let out_dir = PathBuf::from(&output_dir);
            fs::create_dir_all(&out_dir)
                .map_err(|e| format!("failed to create conversion dir: {e}"))?;

            let binary = which::which("soffice")
                .or_else(|_| which::which("libreoffice"))
                .map_err(|_| {
                    "未检测到 soffice / libreoffice。请先安装 LibreOffice，再重新导入 DOC 文档。".to_string()
                })?;

            let status = Command::new(binary)
                .arg("--headless")
                .arg("--convert-to")
                .arg("docx")
                .arg("--outdir")
                .arg(&out_dir)
                .arg(&source)
                .status()
                .map_err(|e| format!("failed to run soffice conversion: {e}"))?;

            if !status.success() {
                return Err(format!(
                    "DOC 转 DOCX 失败，exit={}",
                    status
                        .code()
                        .map(|n| n.to_string())
                        .unwrap_or_else(|| "unknown".into())
                ));
            }

            let stem = source
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("converted");
            let candidate = out_dir.join(format!("{stem}.docx"));
            if candidate.exists() {
                return Ok(candidate.to_string_lossy().into_owned());
            }

            let fallback = fs::read_dir(&out_dir)
                .map_err(|e| format!("failed to inspect conversion dir: {e}"))?
                .flatten()
                .map(|entry| entry.path())
                .find(|path| {
                    path.extension()
                        .and_then(|ext| ext.to_str())
                        .map(|ext| ext.eq_ignore_ascii_case("docx"))
                        .unwrap_or(false)
                })
                .ok_or_else(|| "DOC 转换完成，但没有找到产出的 DOCX 文件。".to_string())?;

            Ok(fallback.to_string_lossy().into_owned())
        })
    })
    .await
    .map_err(|e| format!("convert_doc_to_docx blocking task join error: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::find_document_backend_script_from;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn finds_document_backend_script_from_src_tauri_descendant() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("llmwiki-doc-backend-{unique}"));
        let script = root
            .join("scripts")
            .join("document_backend")
            .join("prepare_document.py");
        fs::create_dir_all(script.parent().expect("script parent")).expect("create script dir");
        fs::write(&script, "# test").expect("write script");
        let nested = root.join("src-tauri").join("target").join("debug");
        fs::create_dir_all(&nested).expect("create nested cwd");

        let resolved = find_document_backend_script_from(&nested);

        assert_eq!(resolved, Some(script));
        let _ = fs::remove_dir_all(root);
    }
}
