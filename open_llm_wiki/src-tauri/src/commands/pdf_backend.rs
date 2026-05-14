use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::{env, ffi::OsString};

use serde::Serialize;

use crate::panic_guard::run_guarded;

#[derive(Serialize)]
pub struct PdfBackendArtifactResult {
    pub backend: String,
    pub status: String,
    pub detail: String,
    pub degraded: bool,
    pub markdown_path: Option<String>,
    pub json_path: Option<String>,
    pub html_path: Option<String>,
    pub page_count: Option<i32>,
    pub ocr_used: bool,
}

fn path_if_exists(path: &Path) -> Option<String> {
    if path.exists() {
        Some(path.to_string_lossy().into_owned())
    } else {
        None
    }
}

fn find_first_with_ext(output_dir: &Path, ext: &str) -> Option<String> {
    let entries = fs::read_dir(output_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file()
            && path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case(ext))
                .unwrap_or(false)
        {
            return Some(path.to_string_lossy().into_owned());
        }
    }
    None
}

fn resolve_opendataloader_binary() -> String {
    if let Ok(home) = env::var("HOME") {
        let candidate = Path::new(&home)
            .join(".local")
            .join("opendataloader-pdf")
            .join("venv")
            .join("bin")
            .join("opendataloader-pdf");
        if candidate.exists() {
            return candidate.to_string_lossy().into_owned();
        }
    }
    "opendataloader-pdf".into()
}

fn build_env_path() -> Option<OsString> {
    let mut paths: Vec<PathBuf> = env::var_os("PATH")
        .as_deref()
        .map(env::split_paths)
        .map(|iter| iter.collect())
        .unwrap_or_default();
    let openjdk_bin = PathBuf::from("/opt/homebrew/opt/openjdk/bin");
    if openjdk_bin.exists() && !paths.iter().any(|path| path == &openjdk_bin) {
        paths.insert(0, openjdk_bin);
    }
    env::join_paths(paths).ok()
}

fn parse_page_count(json_path: &Option<String>) -> Option<i32> {
    let path = PathBuf::from(json_path.as_ref()?);
    let raw = fs::read_to_string(path).ok()?;
    let parsed = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
    if let Some(kids) = parsed
        .get("document")
        .and_then(|value| value.get("kids"))
        .and_then(|value| value.as_array())
    {
        let count = kids
            .iter()
            .filter(|item| item.get("type").and_then(|v| v.as_str()) == Some("page"))
            .count();
        if count > 0 {
            return Some(count as i32);
        }
    }
    parsed
        .get("pages")
        .and_then(|value| value.as_array())
        .map(|items| items.len() as i32)
}

fn write_pdfium_stub(output_dir: &Path, source_path: &str) -> Result<PdfBackendArtifactResult, String> {
    fs::create_dir_all(output_dir).map_err(|e| format!("failed to create output dir: {e}"))?;
    let markdown_path = output_dir.join("document.md");
    let json_path = output_dir.join("document.json");
    let html_path = output_dir.join("document.html");
    fs::write(
        &markdown_path,
        format!(
            "# PDF 文档回退说明\n\n当前文档 `{}` 使用内置 pdfium 文本链路继续处理，未拿到增强版面结构 sidecar。\n",
            source_path
        ),
    )
    .map_err(|e| format!("failed to write markdown stub: {e}"))?;
    fs::write(
        &json_path,
        r#"{"pages":[],"detail":"fallback to pdfium"}"#,
    )
    .map_err(|e| format!("failed to write json stub: {e}"))?;
    fs::write(
        &html_path,
        "<html><body><p>fallback to pdfium</p></body></html>",
    )
    .map_err(|e| format!("failed to write html stub: {e}"))?;

    Ok(PdfBackendArtifactResult {
        backend: "pdfium".into(),
        status: "fallback".into(),
        detail: "增强 PDF 后端不可用，已回退到内置 pdfium 文本链路。".into(),
        degraded: true,
        markdown_path: Some(markdown_path.to_string_lossy().into_owned()),
        json_path: Some(json_path.to_string_lossy().into_owned()),
        html_path: Some(html_path.to_string_lossy().into_owned()),
        page_count: None,
        ocr_used: false,
    })
}

#[tauri::command]
pub async fn analyze_pdf_with_backend(
    source_path: String,
    output_dir: String,
    backend_mode: String,
) -> Result<PdfBackendArtifactResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_guarded("analyze_pdf_with_backend", || {
            let output_dir_path = Path::new(&output_dir);
            if backend_mode == "pdfium" {
                return write_pdfium_stub(output_dir_path, &source_path);
            }

            fs::create_dir_all(output_dir_path)
                .map_err(|e| format!("failed to create pdf artifact dir: {e}"))?;

            let binary = resolve_opendataloader_binary();
            let mut command = Command::new(binary);
            if let Some(path) = build_env_path() {
                command.env("PATH", path);
            }
            let status = command
                .arg(&source_path)
                .arg("--output-dir")
                .arg(&output_dir)
                .arg("--format")
                .arg("json,markdown,html")
                .arg("--image-output")
                .arg("external")
                .arg("--use-struct-tree")
                .arg("--quiet")
                .status();

            match status {
                Ok(exit) if exit.success() => {
                    let markdown_path = path_if_exists(&output_dir_path.join("document.md"))
                        .or_else(|| find_first_with_ext(output_dir_path, "md"));
                    let json_path = path_if_exists(&output_dir_path.join("document.json"))
                        .or_else(|| find_first_with_ext(output_dir_path, "json"));
                    let html_path = path_if_exists(&output_dir_path.join("document.html"))
                        .or_else(|| find_first_with_ext(output_dir_path, "html"));
                    let page_count = parse_page_count(&json_path);
                    Ok(PdfBackendArtifactResult {
                        backend: "opendataloader".into(),
                        status: "ready".into(),
                        detail: "已使用增强 PDF 后端生成结构化 sidecar。".into(),
                        degraded: false,
                        markdown_path,
                        json_path,
                        html_path,
                        page_count,
                        ocr_used: true,
                    })
                }
                Ok(exit) => {
                    let code = exit.code().map(|n| n.to_string()).unwrap_or_else(|| "unknown".into());
                    let mut fallback = write_pdfium_stub(output_dir_path, &source_path)?;
                    fallback.detail = format!("增强 PDF 后端执行失败（exit={code}），已回退到内置 pdfium。");
                    Ok(fallback)
                }
                Err(err) => {
                    let mut fallback = write_pdfium_stub(output_dir_path, &source_path)?;
                    fallback.detail = format!("当前机器未检测到增强 PDF 后端（{err}），已回退到内置 pdfium。");
                    Ok(fallback)
                }
            }
        })
    })
    .await
    .map_err(|e| format!("analyze_pdf_with_backend blocking task join error: {e}"))?
}
