/**
 * 示例插件 - 展示如何编写 OpenPaw Skill 插件
 *
 * 这个插件提供了一些实用的字符串处理和数据转换工具。
 */

import type { SkillPlugin, PluginResult } from '@/skills/plugin-loader';

const examplePlugin: SkillPlugin = {
  // -----------------------------------------------------------------------
  // 插件元数据
  // -----------------------------------------------------------------------
  metadata: {
    id: 'example_utils',
    name: 'Example Utilities',
    version: '1.0.0',
    description: 'Example plugin with string and data utilities',
    author: 'OpenPaw Team',
    category: 'utility',
    nameCn: '示例工具集',
    descriptionCn: '包含字符串和数据处理工具的示例插件',
  },

  // -----------------------------------------------------------------------
  // 工具定义
  // -----------------------------------------------------------------------
  tools: [
    // -------------------------------------------------------------------
    // 工具 1：字符串格式转换
    // -------------------------------------------------------------------
    {
      name: 'string_case_convert',
      description: 'Convert string between different cases (camelCase, snake_case, kebab-case, PascalCase)',
      nameCn: '字符串大小写转换',
      descriptionCn: '在不同命名格式之间转换字符串（camelCase、snake_case、kebab-case、PascalCase）',
      parameters: {
        type: 'object',
        properties: {
          input: {
            type: 'string',
            description: 'Input string to convert',
          },
          targetCase: {
            type: 'string',
            enum: ['camel', 'snake', 'kebab', 'pascal'],
            description: 'Target case format',
          },
        },
        required: ['input', 'targetCase'],
      },
      async execute(params): Promise<PluginResult> {
        const { input, targetCase } = params as {
          input: string;
          targetCase: 'camel' | 'snake' | 'kebab' | 'pascal';
        };

        // 分割字符串为单词
        const words = input
          .replace(/([a-z])([A-Z])/g, '$1 $2')  // camelCase -> camel Case
          .replace(/[-_]/g, ' ')                   // snake-kebab -> snake kebab
          .toLowerCase()
          .split(/\s+/)
          .filter(Boolean);

        let result: string;

        switch (targetCase) {
          case 'camel':
            result = words
              .map((w, i) => i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))
              .join('');
            break;

          case 'snake':
            result = words.join('_');
            break;

          case 'kebab':
            result = words.join('-');
            break;

          case 'pascal':
            result = words
              .map(w => w.charAt(0).toUpperCase() + w.slice(1))
              .join('');
            break;

          default:
            return {
              success: false,
              message: `Unknown target case: ${targetCase}`,
            };
        }

        return {
          success: true,
          message: `Converted to ${targetCase}: ${result}`,
          data: {
            input,
            output: result,
            targetCase,
            words,
          },
        };
      },
    },

    // -------------------------------------------------------------------
    // 工具 2：JSON 格式化与压缩
    // -------------------------------------------------------------------
    {
      name: 'json_format',
      description: 'Format, minify, or validate JSON string',
      nameCn: 'JSON 格式化',
      descriptionCn: '格式化、压缩或验证 JSON 字符串',
      parameters: {
        type: 'object',
        properties: {
          input: {
            type: 'string',
            description: 'JSON string to process',
          },
          action: {
            type: 'string',
            enum: ['prettify', 'minify', 'validate'],
            description: 'Action to perform',
          },
          indent: {
            type: 'number',
            description: 'Indentation spaces for prettify (default: 2)',
          },
        },
        required: ['input', 'action'],
      },
      async execute(params): Promise<PluginResult> {
        const { input, action, indent = 2 } = params as {
          input: string;
          action: 'prettify' | 'minify' | 'validate';
          indent?: number;
        };

        try {
          // 先解析验证
          const parsed = JSON.parse(input);

          switch (action) {
            case 'validate':
              return {
                success: true,
                message: 'JSON is valid',
                data: {
                  valid: true,
                  type: Array.isArray(parsed) ? 'array' : typeof parsed,
                  keys: typeof parsed === 'object' && parsed !== null
                    ? Object.keys(parsed).length
                    : undefined,
                },
              };

            case 'prettify':
              return {
                success: true,
                message: 'JSON formatted',
                data: {
                  output: JSON.stringify(parsed, null, indent),
                },
              };

            case 'minify':
              return {
                success: true,
                message: 'JSON minified',
                data: {
                  output: JSON.stringify(parsed),
                  originalSize: input.length,
                  minifiedSize: JSON.stringify(parsed).length,
                },
              };

            default:
              return {
                success: false,
                message: `Unknown action: ${action}`,
              };
          }
        } catch (err) {
          return {
            success: false,
            message: `Invalid JSON: ${err}`,
            data: {
              valid: false,
              error: String(err),
            },
          };
        }
      },
    },

    // -------------------------------------------------------------------
    // 工具 3：Markdown 转 HTML
    // -------------------------------------------------------------------
    {
      name: 'markdown_to_html',
      description: 'Convert simple Markdown to HTML (supports headings, bold, italic, links, lists, code blocks)',
      nameCn: 'Markdown 转 HTML',
      descriptionCn: '将简单 Markdown 转换为 HTML（支持标题、粗体、斜体、链接、列表、代码块）',
      parameters: {
        type: 'object',
        properties: {
          markdown: {
            type: 'string',
            description: 'Markdown text to convert',
          },
          wrapInDocument: {
            type: 'boolean',
            description: 'If true, wrap in complete HTML document with styles',
          },
        },
        required: ['markdown'],
      },
      async execute(params): Promise<PluginResult> {
        const { markdown, wrapInDocument = false } = params as {
          markdown: string;
          wrapInDocument?: boolean;
        };

        let html = markdown
          // 代码块
          .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
          // 行内代码
          .replace(/`([^`]+)`/g, '<code>$1</code>')
          // 标题
          .replace(/^### (.+)$/gm, '<h3>$1</h3>')
          .replace(/^## (.+)$/gm, '<h2>$1</h2>')
          .replace(/^# (.+)$/gm, '<h1>$1</h1>')
          // 粗体和斜体
          .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.+?)\*/g, '<em>$1</em>')
          // 链接
          .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
          // 无序列表
          .replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>')
          // 段落（简单处理）
          .replace(/\n\n/g, '</p><p>')
          // 换行
          .replace(/\n/g, '<br>');

        // 包装列表项
        html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');

        // 去除空段落
        html = html.replace(/<p><\/p>/g, '');

        if (wrapInDocument) {
          html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Converted Markdown</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
      line-height: 1.6;
      color: #333;
    }
    h1, h2, h3 { margin-top: 1.5em; margin-bottom: 0.5em; }
    code {
      background: #f4f4f4;
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-size: 0.9em;
    }
    pre {
      background: #f4f4f4;
      padding: 1em;
      border-radius: 5px;
      overflow-x: auto;
    }
    pre code {
      background: none;
      padding: 0;
    }
    a { color: #0066cc; }
    ul { padding-left: 2em; }
    li { margin: 0.3em 0; }
  </style>
</head>
<body>
<p>${html}</p>
</body>
</html>`;
        }

        return {
          success: true,
          message: 'Markdown converted to HTML',
          data: {
            html,
            originalLength: markdown.length,
            convertedLength: html.length,
          },
        };
      },
    },

    // -------------------------------------------------------------------
    // 工具 4：调用其他工具演示
    // -------------------------------------------------------------------
    {
      name: 'chain_tools_demo',
      description: 'Demo: chain multiple tools together (read file -> process -> write result)',
      nameCn: '工具链演示',
      descriptionCn: '演示：将多个工具链接在一起（读取文件 -> 处理 -> 写入结果）',
      parameters: {
        type: 'object',
        properties: {
          inputFile: {
            type: 'string',
            description: 'Input file path',
          },
          outputFile: {
            type: 'string',
            description: 'Output file path',
          },
          operation: {
            type: 'string',
            enum: ['uppercase', 'lowercase', 'reverse'],
            description: 'Operation to perform on file content',
          },
        },
        required: ['inputFile', 'outputFile', 'operation'],
      },
      async execute(params, context): Promise<PluginResult> {
        const { inputFile, outputFile, operation } = params as {
          inputFile: string;
          outputFile: string;
          operation: 'uppercase' | 'lowercase' | 'reverse';
        };

        context.log(`Processing ${inputFile} -> ${outputFile}`, 'info');

        // 1. 读取输入文件
        const readResult = await context.callTool('read_file', {
          file_path: inputFile,
        });

        if (!readResult.success) {
          return {
            success: false,
            message: `Failed to read input file: ${readResult.message}`,
          };
        }

        const content = readResult.data?.content as string || '';

        // 2. 处理内容
        let processed: string;
        switch (operation) {
          case 'uppercase':
            processed = content.toUpperCase();
            break;
          case 'lowercase':
            processed = content.toLowerCase();
            break;
          case 'reverse':
            processed = content.split('').reverse().join('');
            break;
          default:
            return {
              success: false,
              message: `Unknown operation: ${operation}`,
            };
        }

        context.log(`Applied ${operation} operation`, 'info');

        // 3. 写入输出文件
        const writeResult = await context.callTool('write_file', {
          file_path: outputFile,
          content: processed,
        });

        if (!writeResult.success) {
          return {
            success: false,
            message: `Failed to write output file: ${writeResult.message}`,
          };
        }

        return {
          success: true,
          message: `Processed ${inputFile} -> ${outputFile} using ${operation}`,
          data: {
            input: inputFile,
            output: outputFile,
            operation,
            inputSize: content.length,
            outputSize: processed.length,
          },
        };
      },
    },
  ],

  // -----------------------------------------------------------------------
  // 生命周期钩子
  // -----------------------------------------------------------------------

  async onInit(context) {
    context.log('Example Utils plugin initialized', 'info');
  },

  async onDispose() {
    console.log('[ExamplePlugin] Disposed');
  },
};

export default examplePlugin;
