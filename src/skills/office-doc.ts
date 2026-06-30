// Office document skill — generate, detect, read, and edit Word/Excel/PPT.
// Built-in tools are self-defined (not from DB config), same as other built-in skills.

import type { Skill, SkillTool } from './skill';
import { SkillOk, SkillFail } from './skill';
import type { SkillResult } from '@/types/skill';

type OfficeApp = 'word' | 'excel' | 'ppt';

export class OfficeDocSkill implements Skill {
  id = 'office_doc';
  name = 'Office Document';
  category = 'Document';
  description = 'Generate, read, and edit Word, Excel, and PowerPoint documents.';
  nameCn = '办公文档';
  categoryCn = '文档';
  descriptionCn = '生成、读取和编辑 Word、Excel、PowerPoint 文档';

  tools: SkillTool[] = [
    {
      name: 'generate_doc',
      description: 'Generate a new Word (.docx), Excel (.xlsx), or PPT (.pptx) document and save to the workspace directory.',
      nameCn: '生成文档',
      descriptionCn: '生成新的 Word (.docx)、Excel (.xlsx) 或 PPT (.pptx) 文档并保存到工作区目录。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Document type', enum: ['word', 'excel', 'ppt'] },
          title: { type: 'string', description: 'Document title (used as filename)' },
          content: { type: 'string', description: 'Markdown content for Word body (type=word only)' },
          subtitle: { type: 'string', description: 'Optional subtitle (type=word only)' },
          sheets: {
            type: 'array',
            description: 'Sheet definitions (type=excel only). Each: {name, headers: [str], rows: [[values]]}',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                headers: { type: 'array', items: { type: 'string' } },
                rows: { type: 'array', items: { type: 'array', items: {} } },
              },
              required: ['name', 'headers', 'rows'],
            },
          },
          slides: {
            type: 'array',
            description: 'Slide definitions (type=ppt only, use this OR markdown)',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                content: { type: 'string' },
                layout: { type: 'string', enum: ['title', 'content', 'two_column'] },
              },
              required: ['title'],
            },
          },
          markdown: { type: 'string', description: 'Markdown for PPT (type=ppt only). ## headings become slides.' },
          author: { type: 'string', description: 'Optional author name' },
        },
        required: ['type', 'title'],
      },
      returns: '{"path":"saved file path","size":number,"format":"docx/xlsx/pptx"}',
    },
    {
      name: 'office_detect',
      description: 'Detect Office/WPS COM availability and currently open documents. Call this before com_read/com_edit to see what documents are available.',
      nameCn: '检测Office文档',
      descriptionCn: '检测当前打开的 Word、Excel 和 PowerPoint 文档及 COM 可用性。在 com_read/com_edit 前先调用此工具。',
      parameters: { type: 'object', properties: {}, required: [] },
      returns: '{"available_apps":["WORD","EXCEL","PPT"],"word":{...},"excel":{...},"ppt":{...}}',
    },
    {
      name: 'com_read',
      description: 'Read content from an active Word, Excel, or PowerPoint document via COM automation. Word: paragraphs. Excel: cell ranges. PPT: slide texts.',
      nameCn: '读取文档内容',
      descriptionCn: '通过 COM 自动化读取活动的 Word/Excel/PPT 文档内容。Word 返回段落，Excel 返回单元格值，PPT 返回幻灯片文本。',
      parameters: {
        type: 'object',
        properties: {
          app: { type: 'string', description: 'Application: word, excel, or ppt', enum: ['word', 'excel', 'ppt'] },
          paragraph_start: { type: 'number', description: '[Word] 0-based start paragraph index' },
          paragraph_end: { type: 'number', description: '[Word] 0-based end paragraph index (exclusive)' },
          range: { type: 'string', description: '[Excel] Range, e.g. "A1:G10"' },
          sheet: { type: 'string', description: '[Excel] Sheet name. Default: active sheet' },
          get_selection: { type: 'boolean', description: '[Excel] Read current selection' },
          sheet_info: { type: 'boolean', description: '[Excel] Get sheet dimensions' },
          slide_start: { type: 'number', description: '[PPT] 0-based start slide index' },
          slide_end: { type: 'number', description: '[PPT] 0-based end slide index (exclusive)' },
          slide_index: { type: 'number', description: '[PPT] Read single slide with shape details' },
          slide_info: { type: 'boolean', description: '[PPT] Read shape info for slide_index' },
          find_text: { type: 'boolean', description: '[PPT] Find all text-containing shapes' },
        },
        required: ['app'],
      },
    },
    {
      name: 'com_edit',
      description: 'Edit an active Word, Excel, or PowerPoint document via COM automation. Changes are visible immediately. Use operation="open" to open a file, operation="save" to save.',
      nameCn: '编辑文档',
      descriptionCn: '通过 COM 自动化编辑活动的 Word/Excel/PPT 文档。修改立即可见。',
      parameters: {
        type: 'object',
        properties: {
          app: { type: 'string', description: 'Application: word, excel, or ppt', enum: ['word', 'excel', 'ppt'] },
          operation: { type: 'string', description: 'Operation: open, save, sync, replace, set_paragraph, insert, insert_heading, delete, format, write, formula, auto_fill, set_value, set_text, add_slide, delete_slide, reorder, insert_rows, insert_columns' },
          file_path: { type: 'string', description: 'Absolute path for open operation' },
          find: { type: 'string', description: '[Word:replace] Text to find' },
          replace: { type: 'string', description: '[Word:replace] Replacement text' },
          text: { type: 'string', description: '[Word/PPT] New text content' },
          paragraph_index: { type: 'number', description: '[Word] 0-based paragraph index' },
          after_paragraph: { type: 'number', description: '[Word:insert] Insert after paragraph index' },
          level: { type: 'number', description: '[Word:insert_heading] Heading level 1-9' },
          bold: { type: 'boolean', description: '[Word:format]' },
          italic: { type: 'boolean', description: '[Word:format]' },
          font_size: { type: 'number', description: '[Word:format]' },
          range: { type: 'string', description: '[Excel:write] Target range, e.g. "G2:G10"' },
          values: { type: 'array', description: '[Excel:write] 2D array', items: { type: 'array', items: {} } },
          cell: { type: 'string', description: '[Excel:formula/set_value] Cell address, e.g. "G2"' },
          formula: { type: 'string', description: '[Excel:formula] e.g. "=SUM(B2:F2)"' },
          formula_template: { type: 'string', description: '[Excel:auto_fill] With {row} placeholder' },
          column: { type: 'string', description: '[Excel:auto_fill/format] Column letter, e.g. "G"' },
          start_row: { type: 'number', description: '[Excel:auto_fill] First data row (1-based)' },
          end_row: { type: 'number', description: '[Excel:auto_fill] Last row (1-based, inclusive)' },
          value: { description: '[Excel:set_value] Value to set' },
          number_format: { type: 'string', description: '[Excel:format] e.g. "#,##0.00"' },
          bold_header: { type: 'boolean', description: '[Excel:format] Bold header row' },
          sheet: { type: 'string', description: '[Excel] Sheet name. Default: active sheet' },
          after_row: { type: 'number', description: '[Excel:insert_rows] 1-based' },
          after_col: { type: 'number', description: '[Excel:insert_columns] 1=A' },
          count: { type: 'number', description: '[Excel] Rows/columns to insert' },
          slide_index: { type: 'number', description: '[PPT] 0-based slide index' },
          shape_name: { type: 'string', description: '[PPT:set_text] Shape name' },
          layout_index: { type: 'number', description: '[PPT:add_slide] Layout index' },
          title: { type: 'string', description: '[PPT:add_slide] Title text' },
          content: { type: 'string', description: '[PPT:add_slide] Body text' },
          after_slide: { type: 'number', description: '[PPT:add_slide] Insert after index' },
          new_order: { type: 'array', description: '[PPT:reorder] New order as 0-based indices', items: { type: 'number' } },
        },
        required: ['app', 'operation'],
      },
    },
    {
      name: 'doc_code_exec',
      description: 'Execute Python 3.14 code for complex document operations (loops, conditionals, calculations). For simple read/write, use com_read/com_edit directly. Pre-injected: get_excel_app(), get_word_app(), get_ppt_app(), read_range(), save_workbook(), openpyxl, python-docx, python-pptx.',
      nameCn: '执行文档代码',
      descriptionCn: '执行 Python 3.14 代码处理复杂文档操作（循环、条件、计算）。简单读写直接用 com_read/com_edit。预注入：get_excel_app()、get_word_app()、get_ppt_app()、read_range()、save_workbook()、openpyxl、python-docx、python-pptx。',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Python 3.14 code. Set "result" variable to return data. Use print() for debug.' },
          timeout_sec: { type: 'number', description: 'Timeout in seconds. Default: 60.' },
        },
        required: ['code'],
      },
    },
  ];

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

  /**
   * 设置工作区根目录路径，更新工具描述（与 CodeToolsSkill 行为一致）。
   * 在 initBuiltinExecutor 中调用，传入运行时解析的实际路径。
   */
  setWorkspacePath(workspacePath: string): void {
    const wsNote = "\n工作区绝对路径：" + workspacePath;
    for (const tool of this.tools) {
      const strip = (s: string) => s.split("\n工作区绝对路径：")[0];
      if (tool.name === "generate_doc" || tool.name === "com_edit" || tool.name === "doc_code_exec") {
        tool.description = strip(tool.description) + wsNote;
        if (tool.descriptionCn) tool.descriptionCn = strip(tool.descriptionCn) + wsNote;
      }
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

    // 解析保存路径到 workspace 目录
    let savePath: string | undefined;
    try {
      const { getWorkspaceDir } = await import('./code-tools/shell-utils');
      const ws = await getWorkspaceDir();
      savePath = ws.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + filename;
    } catch { /* 如果获取 workspace 失败，让 Python 端返回 base64 */ }

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
        savePath,
      };
    } else if (type === 'excel') {
      const sheets = params['sheets'] as Array<Record<string, unknown>>;
      if (!sheets?.length) return SkillFail('sheets is required for Excel');
      invokeName = 'excel_generate';
      invokeParams = {
        title, sheets,
        author: params['author'] as string | undefined,
        savePath,
      };
    } else {
      const slides = params['slides'] as Array<Record<string, unknown>> | undefined;
      const markdown = params['markdown'] as string | undefined;
      if (!slides && !markdown) return SkillFail('slides or markdown is required for PPT');
      invokeName = 'ppt_generate';
      invokeParams = { title, savePath };
      if (slides) (invokeParams as any).slides = slides;
      if (markdown) (invokeParams as any).markdown = markdown;
      if (params['author']) (invokeParams as any).author = params['author'];
    }

    const result = await invoke<{
      saved: boolean; path?: string; data?: string; size: number;
    }>(invokeName, invokeParams);

    if (result.saved && result.path) {
      return SkillOk(`${type.toUpperCase()} 已保存: ${result.path}`, {
        path: result.path, size: result.size, format: ext,
      });
    }
    // 回退：Python 端未保存到磁盘时触发下载
    if (result.data) {
      const mimeType = type === 'word'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : type === 'excel'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
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

    // Resolve workspace-relative file_path to absolute path
    if (params['file_path'] && typeof params['file_path'] === 'string') {
      try {
        const { resolveSearchPath } = await import('./code-tools/shell-utils');
        params['file_path'] = await resolveSearchPath(params['file_path'] as string);
      } catch { /* keep original path if resolution fails */ }
    }

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
