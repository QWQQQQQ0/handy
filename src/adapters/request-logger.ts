// LLM 请求日志工具 — 在 fetch 之前把完整请求体写入日志文件

// 日志目录：应用数据目录下的 logs/llm
const LOG_DIR = 'logs/llm';

// 检测是否在 Tauri 环境中（浏览器 + window.__TAURI__ 存在）
function isTauriEnv(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

/**
 * 记录 LLM 请求到日志文件
 * @param provider - 提供商名称（anthropic/openai/google）
 * @param model - 模型名称
 * @param url - 请求 URL
 * @param bodyJson - 完整的请求体 JSON 字符串
 */
export async function logLLMRequest(
  provider: string,
  model: string,
  url: string,
  bodyJson: string,
): Promise<void> {
  // 非 Tauri 环境（如 Node.js SSR）跳过日志写入
  if (!isTauriEnv()) {
    return;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');

    // 生成日志文件名：{provider}_{timestamp}.json
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${provider}_${timestamp}.json`;

    // 构建日志内容
    const logContent = JSON.stringify({
      timestamp: new Date().toISOString(),
      provider,
      model,
      url,
      bodySize: bodyJson.length,
      bodySizeKB: Math.round(bodyJson.length / 1024),
      request: JSON.parse(bodyJson),
    }, null, 2);

    // 写入文件（通过 Tauri 后端）
    await invoke('write_log_file', {
      dir: LOG_DIR,
      filename,
      content: logContent,
    });

    console.log(`[request-logger] ✅ Log saved: ${LOG_DIR}/${filename}`);
  } catch (e) {
    // 日志写入失败不影响正常请求
    console.warn('[request-logger] Failed to write log:', e);
  }
}
