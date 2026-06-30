use base64::{Engine as _, engine::general_purpose::STANDARD};
use tauri::Manager;
use std::process::Command;

/// Resolve the Python executable path (same logic as bridge.rs).
fn python_exe() -> String {
    std::env::var("HANDY_PYTHON").unwrap_or_else(|_| "python".to_string())
}

/// Walk up from the given directory until we find a directory containing
/// `src-tauri/Cargo.toml` — the canonical marker of a Tauri project root.
fn find_project_root(start: &std::path::Path) -> Option<std::path::PathBuf> {
    let mut current = Some(start.to_path_buf());
    while let Some(dir) = current {
        if dir.join("src-tauri").join("Cargo.toml").exists() {
            return Some(dir);
        }
        current = dir.parent().map(|p| p.to_path_buf());
    }
    None
}

/// Resolve the base directory for workspace file operations.
/// Returns the project root so that workspace/ paths resolve to
/// <project>/workspace/....  The workspace directory is created on first write
/// if it doesn't exist.
fn resolve_workspace_base(app: &tauri::AppHandle) -> std::path::PathBuf {
    // Try finding project root from resource_dir
    if let Ok(resource_dir) = app.path().resource_dir() {
        if let Some(root) = find_project_root(&resource_dir) {
            log::info!("[workspace] Using project root: {}", root.display());
            return root;
        }
    }
    // Fallback: try from current_exe
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            if let Some(root) = find_project_root(exe_dir) {
                log::info!("[workspace] Using project root (from exe): {}", root.display());
                return root;
            }
        }
    }
    // Hard fallback: app_data_dir
    let app_data = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    log::info!("[workspace] Fallback to app data dir: {}", app_data.display());
    app_data
}

/// Strip Windows UNC extended-length prefix (\\?\) if present, so the path
/// is usable by cmd.exe / Node.js child_process.
fn strip_unc_prefix(path: &str) -> String {
    if path.starts_with("\\\\?\\") {
        path[4..].to_string()
    } else {
        path.to_string()
    }
}

/// Return the project root directory path (for frontend workspace resolution).
#[tauri::command]
pub async fn get_project_dir(app: tauri::AppHandle) -> Result<String, String> {
    let base = resolve_workspace_base(&app);
    Ok(strip_unc_prefix(&base.to_string_lossy()))
}

/// Try to extract text from a .docx file using python-docx.
fn extract_docx(path: &str) -> Result<String, String> {
    let python = python_exe();
    let script = r#"
import sys, os
os.environ['PYTHONUTF8'] = '1'
os.environ['PYTHONIOENCODING'] = 'utf-8'
path = sys.argv[1]
try:
    from docx import Document
    doc = Document(path)
    parts = []
    for para in doc.paragraphs:
        if para.text.strip():
            parts.append(para.text)
    for table in doc.tables:
        parts.append('')
        for row in table.rows:
            parts.append(' | '.join(cell.text for cell in row.cells))
    print('\n'.join(parts))
except ImportError:
    import subprocess, sys as _sys
    subprocess.check_call([_sys.executable, '-m', 'pip', 'install', 'python-docx', '-q'])
    from docx import Document
    doc = Document(path)
    parts = []
    for para in doc.paragraphs:
        if para.text.strip():
            parts.append(para.text)
    for table in doc.tables:
        parts.append('')
        for row in table.rows:
            parts.append(' | '.join(cell.text for cell in row.cells))
    print('\n'.join(parts))
"#;

    let output = Command::new(&python)
        .args(["-c", script, path])
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .output()
        .map_err(|e| format!("Failed to run Python for docx extraction: {}. Is Python installed?", e))?;

    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout).to_string();
        if text.trim().is_empty() {
            return Err(format!("Document is empty or contains no extractable text: {}", path));
        }
        Ok(text)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("Failed to extract text from docx: {}", stderr.trim()))
    }
}

/// Try to extract text from a .xlsx file using openpyxl.
fn extract_xlsx(path: &str) -> Result<String, String> {
    let python = python_exe();
    let script = r#"
import sys, os
os.environ['PYTHONUTF8'] = '1'
os.environ['PYTHONIOENCODING'] = 'utf-8'
path = sys.argv[1]
try:
    from openpyxl import load_workbook
except ImportError:
    import subprocess, sys as _sys
    subprocess.check_call([_sys.executable, '-m', 'pip', 'install', 'openpyxl', '-q'])
    from openpyxl import load_workbook
wb = load_workbook(path, data_only=True)
for sheet_name in wb.sheetnames:
    ws = wb[sheet_name]
    print(f'=== Sheet: {sheet_name} ===')
    for row in ws.iter_rows(values_only=True):
        print('\t'.join(str(c) if c is not None else '' for c in row))
"#;

    let output = Command::new(&python)
        .args(["-c", script, path])
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .output()
        .map_err(|e| format!("Failed to run Python for xlsx extraction: {}. Is Python installed?", e))?;

    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout).to_string();
        Ok(text)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("Failed to extract text from xlsx: {}", stderr.trim()))
    }
}

/// Read a text file and return its content.
/// Used by the multi-agent code generation pipeline (AgentRunner.read_file).
/// For Office documents (.docx/.xlsx/.pptx), automatically extracts text via Python.
/// Relative paths are resolved relative to the workspace base directory (same as write_file).
#[tauri::command]
pub async fn read_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let resolved = if path.contains(':') || path.starts_with('/') || path.starts_with('\\') {
        path.clone()
    } else {
        let base = resolve_workspace_base(&app);
        base.join(&path).to_string_lossy().to_string()
    };
    match std::fs::read_to_string(&resolved) {
        Ok(content) => Ok(content),
        Err(_e) => {
            // 检查文件是否存在
            if std::fs::metadata(&resolved).is_err() {
                return Err(format!("File not found: {}", resolved));
            }

            let ext = std::path::Path::new(&resolved)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();

            // Office 文档 → 自动用 Python 提取文本（传 resolved 路径给 Python）
            match ext.as_str() {
                "docx" => extract_docx(&resolved),
                "xlsx" => extract_xlsx(&resolved),
                "pptx" => {
                    Err(format!("PPTX reading is not yet supported. Please use the doc agent or doc_code_exec. {}", resolved))
                }
                "doc" | "xls" | "ppt" => {
                    Err(format!("Legacy Office format ({}). Please convert to .docx/.xlsx/.pptx or use the doc agent with COM automation. {}", ext.to_uppercase(), resolved))
                }
                "pdf" => {
                    Err(format!("PDF reading is not yet supported. {}", resolved))
                }
                "png" | "jpg" | "jpeg" | "gif" | "bmp" | "webp" => {
                    Err(format!("This is an image file, not a text file. {}", resolved))
                }
                _ => {
                    Err(format!("Cannot read file as text (it may be binary). 此文件无法当作文本读取（可能是二进制文件）。{}", resolved))
                }
            }
        }
    }
}

/// Save base64-encoded images to disk under the app's data directory.
/// Each item should be { data: "data:image/jpeg;base64,/9j/...", filename: "llm_img_0_1716384000000.jpg" }.
/// Returns the list of saved file paths.
#[tauri::command]
pub async fn save_llm_images(
    app: tauri::AppHandle,
    images: Vec<serde_json::Value>,
) -> Result<Vec<String>, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
        .join("public")
        .join("llm_images");

    std::fs::create_dir_all(&base_dir)
        .map_err(|e| format!("Failed to create directory {:?}: {}", base_dir, e))?;

    let mut saved = Vec::new();

    for img in images {
        let data_url = img["data"]
            .as_str()
            .ok_or_else(|| "Missing 'data' field".to_string())?;
        let filename = img["filename"]
            .as_str()
            .ok_or_else(|| "Missing 'filename' field".to_string())?;

        // Strip data URL prefix: "data:image/jpeg;base64,<actual>"
        let base64_part = data_url
            .find(',')
            .map(|i| &data_url[i + 1..])
            .unwrap_or(data_url);

        let bytes = STANDARD
            .decode(base64_part)
            .map_err(|e| format!("Base64 decode failed for {}: {}", filename, e))?;

        let path = base_dir.join(filename);
        std::fs::write(&path, &bytes)
            .map_err(|e| format!("Failed to write {:?}: {}", path, e))?;

        saved.push(path.to_string_lossy().to_string());
    }

    Ok(saved)
}

/// Get the app data directory path (for storing generated projects outside the project root).
#[tauri::command]
pub async fn get_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(dir.to_string_lossy().to_string())
}

/// Write text content to a file. Creates parent directories automatically.
/// Used by the multi-agent code generation pipeline (AgentRunner.write_file).
/// Relative paths are resolved relative to the workspace base directory (not CWD) to avoid triggering Tauri's file watcher in dev mode.
/// NOTE: frontend already ensures paths start with "workspace/", so we join directly without extra prefix.
#[tauri::command]
pub async fn write_file(app: tauri::AppHandle, path: String, content: String) -> Result<(), String> {
    let p = if path.contains(':') || path.starts_with('/') || path.starts_with('\\') {
        // Absolute path → use as-is
        std::path::PathBuf::from(&path)
    } else {
        // Relative path → resolve relative to workspace base (frontend already added workspace/ prefix)
        let base = resolve_workspace_base(&app);
        base.join(&path)
    };
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory {:?}: {}", parent, e))?;
    }
    std::fs::write(&p, &content)
        .map_err(|e| format!("Failed to write file {}: {}", p.display(), e))?;
    Ok(())
}

/// Read a file and return its content as a base64-encoded data URL.
/// This is used to load images when asset protocol is not available.
#[tauri::command]
pub async fn read_file_as_data_url(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path)
        .map_err(|e| format!("Failed to read file {}: {}", path, e))?;

    // Detect MIME type from extension
    let mime = if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".webp") {
        "image/webp"
    } else if path.ends_with(".gif") {
        "image/gif"
    } else {
        "image/jpeg"
    };

    let base64 = STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, base64))
}

/// Write content to a log file in the app data directory.
/// Used by the frontend to save LLM request logs for debugging.
#[tauri::command]
pub async fn write_log_file(app: tauri::AppHandle, dir: String, filename: String, content: String) -> Result<(), String> {
    // Use app_data_dir as the base for log files
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let log_path = app_data.join(dir).join(&filename);

    // Create parent directory if it doesn't exist
    if let Some(parent) = log_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create log directory {:?}: {}", parent, e))?;
    }

    std::fs::write(&log_path, &content)
        .map_err(|e| format!("Failed to write log file {}: {}", log_path.display(), e))?;

    log::info!("[log] Saved: {}", log_path.display());
    Ok(())
}
