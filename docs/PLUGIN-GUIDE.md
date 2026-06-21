# OpenPaw Skill Plugin 开发指南

## 概述

OpenPaw 支持通过插件机制扩展 Skill 系统。外部开发者可以按照本指南的接口规范编写自定义工具，并接入项目。

## 插件结构

一个完整的 Skill 插件包含以下部分：

```
my-plugin/
├── index.ts          # 插件入口
├── package.json      # 插件元数据（可选）
└── README.md         # 插件说明（可选）
```

## 接口规范

### 1. 插件元数据 (PluginMetadata)

```typescript
interface PluginMetadata {
  id: string;           // 唯一标识，如 "my_custom_tool"
  name: string;         // 插件名称
  version: string;      // 版本号，如 "1.0.0"
  description: string;  // 插件描述
  author?: string;      // 作者
  category?: string;    // 分类，如 "automation", "data", "utility"
  nameCn?: string;      // 中文名称
  descriptionCn?: string; // 中文描述
  minHostVersion?: string; // 最低宿主版本要求
  dependencies?: string[]; // 依赖的其他插件
}
```

### 2. 工具定义 (PluginToolDefinition)

```typescript
interface PluginToolDefinition {
  name: string;         // 工具名称，必须唯一
  description: string;  // 工具描述（AI 会看到这个）
  parameters: Record<string, unknown>;  // JSON Schema 格式的参数定义
  nameCn?: string;      // 中文名称
  descriptionCn?: string; // 中文描述
  execute: (params: Record<string, unknown>, context: PluginContext) => Promise<PluginResult>;
}
```

### 3. 执行上下文 (PluginContext)

```typescript
interface PluginContext {
  callTool: (toolName: string, params: Record<string, unknown>) => Promise<SkillResult>;
  readFile?: (path: string) => Promise<string>;
  writeFile?: (path: string, content: string) => Promise<void>;
  execCommand?: (command: string) => Promise<string>;
  getSetting?: (key: string) => unknown;
  log: (message: string, level?: 'info' | 'warn' | 'error') => void;
}
```

### 4. 执行结果 (PluginResult)

```typescript
interface PluginResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}
```

### 5. 完整插件接口 (SkillPlugin)

```typescript
interface SkillPlugin {
  metadata: PluginMetadata;
  tools: PluginToolDefinition[];
  onInit?: (context: PluginContext) => Promise<void>;
  onDispose?: () => Promise<void>;
}
```

## 开发示例

### 示例 1：简单的数据处理工具

```typescript
// my-data-plugin.ts
import type { SkillPlugin, PluginResult } from '@/skills/plugin-loader';

const myDataPlugin: SkillPlugin = {
  metadata: {
    id: 'data_processor',
    name: 'Data Processor',
    version: '1.0.0',
    description: 'Data processing utilities',
    category: 'data',
    nameCn: '数据处理器',
    descriptionCn: '数据处理工具集',
  },

  tools: [
    {
      name: 'json_transform',
      description: 'Transform JSON data using a mapping configuration',
      nameCn: 'JSON 转换',
      descriptionCn: '使用映射配置转换 JSON 数据',
      parameters: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            description: 'Input JSON data',
          },
          mapping: {
            type: 'object',
            description: 'Field mapping configuration',
          },
        },
        required: ['data', 'mapping'],
      },
      async execute(params, context): Promise<PluginResult> {
        const { data, mapping } = params as {
          data: Record<string, unknown>;
          mapping: Record<string, string>;
        };

        context.log('Transforming JSON data...', 'info');

        const result: Record<string, unknown> = {};
        for (const [sourceKey, targetKey] of Object.entries(mapping)) {
          if (sourceKey in data) {
            result[targetKey] = data[sourceKey];
          }
        }

        return {
          success: true,
          message: `Transformed ${Object.keys(result).length} fields`,
          data: result,
        };
      },
    },

    {
      name: 'csv_to_json',
      description: 'Convert CSV text to JSON array',
      nameCn: 'CSV 转 JSON',
      descriptionCn: '将 CSV 文本转换为 JSON 数组',
      parameters: {
        type: 'object',
        properties: {
          csv: {
            type: 'string',
            description: 'CSV text content',
          },
          delimiter: {
            type: 'string',
            description: 'Column delimiter (default: ",")',
          },
        },
        required: ['csv'],
      },
      async execute(params): Promise<PluginResult> {
        const { csv, delimiter = ',' } = params as {
          csv: string;
          delimiter?: string;
        };

        const lines = csv.trim().split('\n');
        if (lines.length < 2) {
          return {
            success: false,
            message: 'CSV must have at least a header and one data row',
          };
        }

        const headers = lines[0].split(delimiter).map(h => h.trim());
        const data = lines.slice(1).map(line => {
          const values = line.split(delimiter).map(v => v.trim());
          const row: Record<string, string> = {};
          headers.forEach((header, i) => {
            row[header] = values[i] || '';
          });
          return row;
        });

        return {
          success: true,
          message: `Parsed ${data.length} rows`,
          data: { rows: data, headers },
        };
      },
    },
  ],
};

export default myDataPlugin;
```

### 示例 2：调用外部 API

```typescript
// weather-plugin.ts
import type { SkillPlugin, PluginResult } from '@/skills/plugin-loader';

const weatherPlugin: SkillPlugin = {
  metadata: {
    id: 'weather',
    name: 'Weather Service',
    version: '1.0.0',
    description: 'Get weather information',
    category: 'api',
    nameCn: '天气服务',
    descriptionCn: '获取天气信息',
  },

  tools: [
    {
      name: 'get_weather',
      description: 'Get current weather for a location',
      nameCn: '获取天气',
      descriptionCn: '获取指定位置的当前天气',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: 'City name (e.g., "Beijing", "New York")',
          },
          units: {
            type: 'string',
            enum: ['metric', 'imperial'],
            description: 'Temperature units',
          },
        },
        required: ['city'],
      },
      async execute(params, context): Promise<PluginResult> {
        const { city, units = 'metric' } = params as {
          city: string;
          units?: string;
        };

        context.log(`Fetching weather for ${city}...`, 'info');

        try {
          // 示例：使用 context.callTool 调用已有的 web_fetch 工具
          const result = await context.callTool('web_fetch', {
            url: `https://api.weather.example/v1/current?city=${encodeURIComponent(city)}&units=${units}`,
          });

          if (!result.success) {
            return {
              success: false,
              message: `Failed to fetch weather: ${result.message}`,
            };
          }

          // 解析响应
          const weather = result.data as Record<string, unknown>;

          return {
            success: true,
            message: `Weather in ${city}: ${weather.temperature}°${units === 'metric' ? 'C' : 'F'}, ${weather.description}`,
            data: weather,
          };
        } catch (err) {
          return {
            success: false,
            message: `Weather request failed: ${err}`,
          };
        }
      },
    },
  ],

  async onInit(context) {
    context.log('Weather plugin initialized', 'info');
  },
};

export default weatherPlugin;
```

### 示例 3：文件处理工具

```typescript
// file-processor-plugin.ts
import type { SkillPlugin, PluginResult } from '@/skills/plugin-loader';

const fileProcessorPlugin: SkillPlugin = {
  metadata: {
    id: 'file_processor',
    name: 'File Processor',
    version: '1.0.0',
    description: 'Advanced file processing utilities',
    category: 'utility',
    nameCn: '文件处理器',
    descriptionCn: '高级文件处理工具集',
  },

  tools: [
    {
      name: 'batch_rename',
      description: 'Batch rename files using pattern matching',
      nameCn: '批量重命名',
      descriptionCn: '使用模式匹配批量重命名文件',
      parameters: {
        type: 'object',
        properties: {
          directory: {
            type: 'string',
            description: 'Directory path',
          },
          pattern: {
            type: 'string',
            description: 'Regex pattern to match files',
          },
          replacement: {
            type: 'string',
            description: 'Replacement string (supports $1, $2, etc.)',
          },
          dryRun: {
            type: 'boolean',
            description: 'If true, only show what would be renamed',
          },
        },
        required: ['directory', 'pattern', 'replacement'],
      },
      async execute(params, context): Promise<PluginResult> {
        const { directory, pattern, replacement, dryRun = false } = params as {
          directory: string;
          pattern: string;
          replacement: string;
          dryRun?: boolean;
        };

        context.log(`Processing files in ${directory}...`, 'info');

        // 使用 context 调用文件操作工具
        const listResult = await context.callTool('glob', {
          pattern: `${directory}/*`,
        });

        if (!listResult.success) {
          return {
            success: false,
            message: `Failed to list files: ${listResult.message}`,
          };
        }

        const files = listResult.data?.files as string[] || [];
        const regex = new RegExp(pattern);
        const renames: Array<{ from: string; to: string }> = [];

        for (const file of files) {
          const basename = file.split('/').pop() || '';
          if (regex.test(basename)) {
            const newName = basename.replace(regex, replacement);
            if (newName !== basename) {
              renames.push({
                from: file,
                to: `${directory}/${newName}`,
              });
            }
          }
        }

        if (dryRun) {
          return {
            success: true,
            message: `Would rename ${renames.length} files (dry run)`,
            data: { renames, dryRun: true },
          };
        }

        // 执行重命名
        let successCount = 0;
        for (const { from, to } of renames) {
          try {
            await context.callTool('move_file', { from, to });
            successCount++;
          } catch (err) {
            context.log(`Failed to rename ${from}: ${err}`, 'error');
          }
        }

        return {
          success: true,
          message: `Renamed ${successCount}/${renames.length} files`,
          data: { total: renames.length, success: successCount },
        };
      },
    },
  ],
};

export default fileProcessorPlugin;
```

## 接入方式

### 方式 1：静态导入（推荐用于内置插件）

1. 将插件文件放入 `src/skills/plugins/` 目录
2. 在 `builtin-executor.ts` 中导入并注册：

```typescript
import myDataPlugin from './plugins/my-data-plugin';

// 在 initBuiltinExecutor 中
const pluginLoader = new PluginLoader(context);
await pluginLoader.loadFromObject(myDataPlugin);
```

### 方式 2：动态加载（推荐用于第三方插件）

```typescript
// 从文件路径加载
const pluginLoader = new PluginLoader(context);
const adapter = await pluginLoader.loadFromPath('/path/to/plugin.js');
executor.register(adapter);
```

### 方式 3：用户自定义（通过 UI）

用户可以通过 Skills 页面创建自定义工具，系统会自动将其转换为插件格式：

```typescript
const pluginLoader = new PluginLoader(context);
const adapter = await pluginLoader.loadFromConfig({
  id: 'user_custom',
  name: 'My Custom Tools',
  description: 'User defined tools',
  tools: [
    {
      name: 'my_tool',
      description: 'Does something useful',
      parameters: { /* JSON Schema */ },
      implementation: `
        // JavaScript 代码
        const result = await context.callTool('some_tool', { /* params */ });
        return skill.ok('Done', { result });
      `,
    },
  ],
});
executor.register(adapter);
```

## 最佳实践

1. **工具命名**：使用小写字母和下划线，如 `my_tool_name`
2. **描述清晰**：AI 会根据描述决定何时使用你的工具
3. **参数验证**：在 `execute` 函数开头验证必需参数
4. **错误处理**：返回有意义的错误消息
5. **日志输出**：使用 `context.log()` 输出调试信息
6. **资源清理**：在 `onDispose` 中释放资源

## 注意事项

1. 插件代码运行在沙箱环境中，某些 Node.js API 可能不可用
2. 避免在插件中使用 `eval()` 或 `new Function()` 执行不可信代码
3. 文件操作需要通过 `context.readFile`/`context.writeFile` 进行
4. 网络请求建议通过已有的 `web_fetch` 工具进行
