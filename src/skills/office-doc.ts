// Office document skill — generate, detect, read, and edit Word/Excel/PPT.
// Consolidated into 4 tools: generate_doc, office_detect, com_read, com_edit.

import type { Skill, SkillTool } from './skill';
import { SkillOk, SkillFail } from './skill';
import type { SkillResult, ToolDefinition } from '@/types/skill';

type OfficeApp = 'word' | 'excel' | 'ppt';

export class OfficeDocSkill implements Skill {
  id: string;
  name: string;
  category: string;
  description: string;
  tools: SkillTool[];
  nameCn?: string;
  descriptionCn?: string;
  categoryCn?: string;
  usage?: string;
  usageCn?: string;

  constructor(config?: { id?: string; name?: string; category?: string; description?: string; tools?: ToolDefinition[]; nameCn?: string; descriptionCn?: string; categoryCn?: string; usage?: string; usageCn?: string }) {
    this.id = config?.id ?? 'office_doc';
    this.name = config?.name ?? 'Office Document';
    this.category = config?.category ?? 'Document';
    this.description = config?.description ?? 'Generate, read, and edit Word, Excel, and PowerPoint documents.';
    this.tools = config?.tools?.map(t => ({ name: t.name, description: t.description, parameters: t.parameters, nameCn: t.nameCn, descriptionCn: t.descriptionCn })) ?? [];
    if (config?.nameCn) this.nameCn = config.nameCn;
    if (config?.descriptionCn) this.descriptionCn = config.descriptionCn;
    if (config?.categoryCn) this.categoryCn = config.categoryCn;
    if (config?.usage) this.usage = config.usage;
    if (config?.usageCn) this.usageCn = config.usageCn;
  }

  async execute(toolName: string, params: Record<string, unknown>): Promise<SkillResult> {
    try {
      switch (toolName) {
        // Unified tools
        case 'generate_doc':
          return await this.generateDoc(params);
        case 'office_detect':
          return await this.officeDetect();
        case 'com_read':
          return await this.comRead(params);
        case 'com_edit':
          return await this.comEdit(params);
        case 'code_exec':
          return await this.codeExec(params);
        // Legacy names (backward compat)
        case 'generate_word':
          return await this.generateDoc({ ...params, type: 'word' });
        case 'generate_excel':
          return await this.generateDoc({ ...params, type: 'excel' });
        case 'generate_ppt':
          return await this.generateDoc({ ...params, type: 'ppt' });
        case 'word_com_read':
          return await this.comRead({ ...params, app: 'word' });
        case 'word_com_edit':
          return await this.comEdit({ ...params, app: 'word' });
        case 'excel_com_read':
          return await this.comRead({ ...params, app: 'excel' });
        case 'excel_com_edit':
          return await this.comEdit({ ...params, app: 'excel' });
        case 'ppt_com_read':
          return await this.comRead({ ...params, app: 'ppt' });
        case 'ppt_com_edit':
          return await this.comEdit({ ...params, app: 'ppt' });
        case 'doc_code_exec':
          return await this.codeExec(params);
        default:
          return SkillFail(`Unknown tool: ${toolName}`);
      }
    } catch (e) {
      return SkillFail(`Tool execution failed: ${e}`);
    }
  }

  // ════════════════════════════════════════════════════════════
  // generate_doc — unified document generation
  // ════════════════════════════════════════════════════════════

  private async generateDoc(params: Record<string, unknown>): Promise<SkillResult> {
    const type = params['type'] as OfficeApp;
    if (!type || !['word', 'excel', 'ppt'].includes(type)) {
      return SkillFail('type is required: "word", "excel", or "ppt"');
    }

    const { invoke } = await import('@tauri-apps/api/core');
    const title = params['title'] as string;
    if (!title) return SkillFail('title is required');

    const ext = type === 'word' ? 'docx' : type === 'excel' ? 'xlsx' : 'pptx';
    const filename = `${title}.${ext}`;
    const mimeType = type === 'word'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : type === 'excel'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

    let invokeName: string;
    let invokeParams: Record<string, unknown>;

    if (type === 'word') {
      const content = params['content'] as string;
      if (!content) return SkillFail('content is required for Word');
      invokeName = 'word_generate';
      invokeParams = {
        title, content,
        subtitle: params['subtitle'] as string | undefined,
        author: params['author'] as string | undefined,
      };
    } else if (type === 'excel') {
      const sheets = params['sheets'] as Array<Record<string, unknown>>;
      if (!sheets?.length) return SkillFail('sheets is required for Excel');
      invokeName = 'excel_generate';
      invokeParams = {
        title, sheets,
        author: params['author'] as string | undefined,
      };
    } else {
      const slides = params['slides'] as Array<Record<string, unknown>> | undefined;
      const markdown = params['markdown'] as string | undefined;
      if (!slides && !markdown) return SkillFail('slides or markdown is required for PPT');
      invokeName = 'ppt_generate';
      invokeParams = {
        title,
        slides: slides ?? null,
        markdown: markdown ?? null,
        author: params['author'] as string | undefined,
      };
    }

    const result = await invoke<{
      saved: boolean; path?: string; data?: string; size: number;
    }>(invokeName, invokeParams);

    if (result.saved && result.path) {
      return SkillOk(`${type.toUpperCase()} generated: ${result.path}`, {
        path: result.path, size: result.size, format: ext,
      });
    }
    if (result.data) {
      await this.downloadFile(result.data, filename, mimeType);
      return SkillOk(`${type.toUpperCase()} downloaded: ${filename}`, {
        filename, size: result.size, format: ext,
      });
    }
    return SkillOk(`${type.toUpperCase()} generated`, { size: result.size });
  }

  // ════════════════════════════════════════════════════════════
  // office_detect — detect active Office documents
  // ════════════════════════════════════════════════════════════

  private async officeDetect(): Promise<SkillResult> {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<Record<string, unknown>>('office_detect');

    const available: string[] = [];
    const userDocDescs: string[] = [];
    // Collect only the essential info to avoid bloating the LLM context
    const summary: Record<string, unknown> = {};
    for (const app of ['word', 'excel', 'ppt'] as const) {
      const info = result[app] as Record<string, unknown> | undefined;
      if (info?.['available'] === true) {
        available.push(app.toUpperCase());
        const appSummary: Record<string, unknown> = { available: true };
        // User documents (from WPS/Office window titles) — primary source
        const ud = info['user_documents'] as Array<Record<string, unknown>> | undefined;
        if (ud && ud.length > 0) {
          const docs: Record<string, unknown>[] = [];
          for (const doc of ud) {
            const path = doc['path'] as string | undefined;
            const fn = doc['filename'] as string;
            const ambiguous = doc['ambiguous'] as boolean | undefined;
            const candidates = doc['candidates'] as Array<{ path: string; source: string }> | undefined;

            if (path) {
              userDocDescs.push(`${app.toUpperCase()}: ${fn} → ${path}`);
            } else if (ambiguous && candidates && candidates.length > 0) {
              const pathList = candidates.map(c => c.path).join(', ');
              userDocDescs.push(`${app.toUpperCase()}: ${fn} ⚠️ 同名文件${candidates.length}个：${pathList}`);
            } else {
              userDocDescs.push(`${app.toUpperCase()}: ${fn} (路径未解析)`);
            }

            const docEntry: Record<string, unknown> = { filename: fn, path: path ?? null };
            if (ambiguous) {
              docEntry['ambiguous'] = true;
              docEntry['candidates'] = candidates ?? [];
            }
            docs.push(docEntry);
          }
          appSummary['documents'] = docs;
        } else if (info['com_title']) {
          userDocDescs.push(`${app.toUpperCase()}: ${info['com_title']}`);
          appSummary['com_title'] = info['com_title'];
          appSummary['com_path'] = info['com_path'];
        }
        summary[app] = appSummary;
      }
    }

    let msg: string;
    if (userDocDescs.length > 0) {
      msg = `检测到文档: ${userDocDescs.join('; ')}。`;
      const hasUnresolved = userDocDescs.some(d => d.includes('路径未解析'));
      const hasAmbiguous = userDocDescs.some(d => d.includes('同名文件'));
      if (hasAmbiguous && hasUnresolved) {
        msg += '部分文档有多个同名文件（⚠️ 标记），部分路径未解析。对同名文件用 request_user_input 列出候选项让用户选择；未解析的询问用户文件路径。';
      } else if (hasAmbiguous) {
        msg += '部分文档有多个同名文件（⚠️ 标记），请用 request_user_input 列出所有候选路径，让用户选择使用哪个文件。';
      } else if (hasUnresolved) {
        msg += '部分文档路径未解析，请用 request_user_input 询问用户文件完整路径，不要猜测。';
      } else {
        msg += '可使用 com_edit(operation="sync") 连接文档，然后进行读写操作。';
      }
    } else if (available.length > 0) {
      msg = `COM 可用: ${available.join(', ')} (未检测到打开的文档)。使用 glob 搜索文件或直接让用户提供路径，然后用 com_edit(operation="open", file_path="...") 打开。`;
    } else {
      msg = '未找到 Office/WPS COM 注册。请安装 WPS Office 或 Microsoft Office。';
    }

    return SkillOk(msg, { available_apps: available, ...summary });
  }

  // ════════════════════════════════════════════════════════════
  // com_read — unified read for Word/Excel/PPT
  // ════════════════════════════════════════════════════════════

  private async comRead(params: Record<string, unknown>): Promise<SkillResult> {
    const app = params['app'] as OfficeApp;
    if (!app || !['word', 'excel', 'ppt'].includes(app)) {
      return SkillFail('app is required: "word", "excel", or "ppt"');
    }

    const { invoke } = await import('@tauri-apps/api/core');

    if (app === 'word') {
      const result = await invoke<{
        title: string;
        paragraphs: Array<{ index: number; text: string; style: string }>;
        total_paragraphs: number;
      }>('word_com_read', {
        paragraphStart: params['paragraph_start'] as number | undefined,
        paragraphEnd: params['paragraph_end'] as number | undefined,
      });
      return SkillOk(
        `Read ${result.paragraphs.length}/${result.total_paragraphs} paragraphs from "${result.title}"`,
        result as unknown as Record<string, unknown>,
      );
    }

    if (app === 'excel') {
      const toBool = (v: unknown): boolean | undefined => {
        if (v === true || v === 'true') return true;
        if (v === false || v === 'false') return false;
        return undefined;
      };
      const result = await invoke<Record<string, unknown>>('excel_com_read', {
        range: params['range'] as string | undefined,
        sheet: params['sheet'] as string | undefined,
        getSelection: toBool(params['get_selection']),
        sheetInfo: toBool(params['sheet_info']),
      });
      const dims = result['dimensions'] as { rows: number; cols: number } | undefined;
      const isSelection = toBool(params['get_selection']) === true;
      let excelMsg: string;
      if (dims) {
        excelMsg = `Read ${dims.rows}×${dims.cols} cells from "${result['workbook']}"`;
      } else if (isSelection) {
        excelMsg = `Excel COM selection at ${result['address']}. ⚠️ WPS: COM runs in a separate process — this is the COM server's internal selection, NOT the user's actual screen selection. Use desktop_screenshot to see what the user actually selected.`;
      } else {
        excelMsg = 'Excel read completed';
      }
      return SkillOk(excelMsg, result);
    }

    // ppt
    const result = await invoke<Record<string, unknown>>('ppt_com_read', {
      slideStart: params['slide_start'] as number | undefined,
      slideEnd: params['slide_end'] as number | undefined,
      slideIndex: params['slide_index'] as number | undefined,
      slideInfo: params['slide_info'] as boolean | undefined,
      findText: params['find_text'] as boolean | undefined,
    });
    const slides = result['slides'] as unknown[] | undefined;
    return SkillOk(
      slides ? `Read ${slides.length}/${result['total_slides']} slides from "${result['title']}"` : 'PPT read completed',
      result,
    );
  }

  // ════════════════════════════════════════════════════════════
  // com_edit — unified edit for Word/Excel/PPT
  // ════════════════════════════════════════════════════════════

  private async comEdit(params: Record<string, unknown>): Promise<SkillResult> {
    const app = params['app'] as OfficeApp;
    if (!app || !['word', 'excel', 'ppt'].includes(app)) {
      return SkillFail('app is required: "word", "excel", or "ppt"');
    }

    const operation = params['operation'] as string;
    if (!operation) return SkillFail('operation is required');

    const { invoke } = await import('@tauri-apps/api/core');
    const { app: _, operation: __, ...rest } = params as Record<string, unknown> & { app: string; operation: string };

    const invokeName = `${app}_com_edit`;
    const result = await invoke<{ success: boolean; affected?: number; message: string }>(
      invokeName,
      { operation, params: rest },
    );
    return SkillOk(result.message, result as unknown as Record<string, unknown>);
  }

  // ════════════════════════════════════════════════════════════
  // code_exec — document code execution sandbox
  // ════════════════════════════════════════════════════════════

  private async codeExec(params: Record<string, unknown>): Promise<SkillResult> {
    const code = params['code'] as string;
    if (!code) return SkillFail('code is required');

    const timeoutSec = params['timeout_sec'] as number | undefined;

    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<{
      success: boolean;
      output: string;
      error: string;
      result: unknown;
      duration_ms: number;
      truncated: boolean;
    }>('doc_code_exec', {
      code,
      timeout_sec: timeoutSec ?? 60,
    });

    let msg: string;
    if (result.success) {
      msg = `Code executed successfully (${result.duration_ms}ms)`;
      if (result.output) msg += `\nOutput:\n${result.output}`;
    } else {
      msg = `Code execution failed (${result.duration_ms}ms): ${result.error}`;
      if (result.output) msg += `\nOutput:\n${result.output}`;
    }

    return SkillOk(msg, {
      success: result.success,
      output: result.output,
      error: result.error || undefined,
      result: result.result,
      duration_ms: result.duration_ms,
      truncated: result.truncated,
    });
  }

  // ════════════════════════════════════════════════════════════
  // Helpers
  // ════════════════════════════════════════════════════════════

  private async getSavePath(_filename: string): Promise<string | undefined> {
    // TODO: Implement Tauri dialog for native save
    return undefined;
  }

  private async downloadFile(base64Data: string, filename: string, mimeType: string): Promise<void> {
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
