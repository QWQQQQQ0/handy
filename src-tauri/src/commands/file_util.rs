use base64::{Engine as _, engine::general_purpose::STANDARD};
use tauri::Manager;

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
#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory {:?}: {}", parent, e))?;
    }
    std::fs::write(p, &content)
        .map_err(|e| format!("Failed to write file {}: {}", path, e))?;
    Ok(())
}

/// Read a text file and return its content.
/// Used by the multi-agent code generation pipeline (AgentRunner.read_file).
#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file {}: {}", path, e))
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
