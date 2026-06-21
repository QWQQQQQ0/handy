# OpenPaw 插件权限说明

## 概述

本文档详细说明外部插件可以编写哪些代码、可以访问哪些能力、以及有哪些限制。

---

## ✅ 允许的代码类型

### 1. 纯数据处理（完全安全）

```typescript
// ✅ 允许：纯函数，无副作用
async execute(params, context) {
  const { data } = params;
  
  // 数据转换
  const result = data.map(item => ({
    ...item,
    processed: true,
  }));
  
  // 字符串处理
  const formatted = JSON.stringify(result, null, 2);
  
  return {
    success: true,
    message: 'Processed',
    data: { result: formatted },
  };
}
```

### 2. 调用已有工具（通过 context）

```typescript
// ✅ 允许：通过 context.callTool() 调用已注册的工具
async execute(params, context) {
  // 调用文件读取
  const fileResult = await context.callTool('read_file', {
    file_path: '/path/to/file.txt',
  });
  
  // 调用网页获取
  const webResult = await context.callTool('web_fetch', {
    url: 'https://api.example.com/data',
  });
  
  // 调用代码执行
  const execResult = await context.callTool('execute_code', {
    language: 'javascript',
    code: '1 + 1',
  });
  
  return {
    success: true,
    message: 'Done',
    data: { file: fileResult, web: webResult },
  };
}
```

### 3. 日志输出

```typescript
// ✅ 允许：使用 context.log() 输出日志
async execute(params, context) {
  context.log('开始处理...', 'info');
  context.log('警告：数据量较大', 'warn');
  context.log('错误：格式不正确', 'error');
  
  return { success: true, message: 'Done' };
}
```

### 4. 使用 JavaScript 内置 API

```typescript
// ✅ 允许：使用标准 JavaScript API
async execute(params, context) {
  // 数组操作
  const sorted = params.data.sort((a, b) => a - b);
  
  // JSON 操作
  const parsed = JSON.parse(params.json);
  
  // 正则表达式
  const matches = params.text.match(/\d+/g);
  
  // 日期处理
  const now = new Date().toISOString();
  
  // Map/Set
  const unique = [...new Set(params.items)];
  
  return {
    success: true,
    message: 'Done',
    data: { sorted, parsed, matches, now, unique },
  };
}
```

### 5. 使用 context 可选方法（如果可用）

```typescript
// ✅ 允许：使用 context 提供的可选方法
async execute(params, context) {
  // 读取文件（如果权限允许）
  const content = await context.readFile?.('/path/to/file');
  
  // 写入文件（如果权限允许）
  await context.writeFile?.('/path/to/output.txt', 'content');
  
  // 执行命令（如果权限允许）
  const output = await context.execCommand?.('ls -la');
  
  // 获取设置
  const theme = context.getSetting?.('theme');
  
  return { success: true, message: 'Done' };
}
```

---

## 🔒 可调用的内置工具列表

通过 `context.callTool()` 可以调用以下已注册的工具：

### 文件操作

| 工具 | 说明 | 参数 |
|------|------|------|
| `read_file` | 读取文件 | `{ file_path: string }` |
| `write_file` | 写入文件 | `{ file_path: string, content: string }` |
| `glob` | 文件匹配 | `{ pattern: string }` |
| `search_files` | 搜索文件 | `{ directory: string, pattern: string }` |

### 代码执行

| 工具 | 说明 | 参数 |
|------|------|------|
| `execute_code` | 执行代码 | `{ language: string, code: string }` |
| `generate_code` | 生成代码 | `{ task: string, language: string }` |
| `iterate_code` | 迭代修复 | `{ task: string, code: string, language: string }` |

### 网络请求

| 工具 | 说明 | 参数 |
|------|------|------|
| `web_search` | 网页搜索 | `{ query: string }` |
| `web_fetch` | 获取网页 | `{ url: string }` |

### 应用管理

| 工具 | 说明 | 参数 |
|------|------|------|
| `save_app` | 保存应用 | `{ name: string, code: string }` |
| `list_apps` | 列出应用 | `{}` |
| `get_app` | 获取应用 | `{ id: string }` |

### 桌面操作

| 工具 | 说明 | 参数 |
|------|------|------|
| `desktop_screenshot` | 截图 | `{}` |
| `desktop_click` | 点击 | `{ x: number, y: number }` |
| `desktop_type` | 输入 | `{ text: string }` |

### 命令执行

| 工具 | 说明 | 参数 |
|------|------|------|
| `run_command` | 执行命令 | `{ command: string }` |

---

## ❌ 禁止的代码类型

### 1. 直接访问 Node.js API

```typescript
// ❌ 禁止：直接导入 Node.js 模块
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import os from 'os';

// ❌ 禁止：使用 process
process.env.SECRET_KEY;
process.exit(0);
```

### 2. 直接访问浏览器 API（受限）

```typescript
// ❌ 禁止：直接操作 DOM
document.getElementById('root');
document.querySelector('.app');

// ❌ 禁止：直接访问 localStorage
localStorage.getItem('token');
localStorage.setItem('key', 'value');

// ❌ 禁止：直接使用 fetch（通过 web_fetch 工具）
fetch('https://api.example.com');
```

### 3. 动态代码执行

```typescript
// ❌ 禁止：eval
eval('alert("xss")');

// ❌ 禁止：new Function（在插件内）
new Function('return this')();

// ❌ 禁止：动态 import
import('malicious-module');
```

### 4. 访问全局对象

```typescript
// ❌ 禁止：访问 window/globalThis
window.location;
globalThis.someVar;

// ❌ 禁止：访问全局变量
__dirname;
__filename;
```

### 5. 修改原型链

```typescript
// ❌ 禁止：原型污染
Object.prototype.polluted = true;
Array.prototype.custom = function() {};
```

---

## 🛡️ 安全模型

### 执行环境

插件代码在以下环境中执行：

1. **沙箱隔离**：使用 `new Function()` 创建独立作用域
2. **无全局访问**：无法直接访问 `window`、`global`、`process`
3. **工具代理**：所有外部操作通过 `context.callTool()` 进行
4. **权限控制**：`context` 的可选方法（readFile、writeFile 等）由宿主控制

### 权限层级

```
┌─────────────────────────────────────────────────────────┐
│                    插件代码                              │
├─────────────────────────────────────────────────────────┤
│  ✅ 允许                          ❌ 禁止               │
│  - 纯数据处理                     - Node.js API         │
│  - JavaScript 内置 API            - DOM 操作            │
│  - context.callTool()             - eval / new Function │
│  - context.log()                  - 全局对象访问         │
│  - context 可选方法               - 原型修改            │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                  PluginContext                           │
├─────────────────────────────────────────────────────────┤
│  callTool()    → 调用已注册的工具                        │
│  log()         → 输出日志                                │
│  readFile()    → 读取文件（可选，宿主控制）               │
│  writeFile()   → 写入文件（可选，宿主控制）               │
│  execCommand() → 执行命令（可选，宿主控制）               │
│  getSetting()  → 获取设置（可选）                        │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                  SkillExecutor                           │
├─────────────────────────────────────────────────────────┤
│  已注册的工具（受控访问）                                │
│  - 文件操作工具                                          │
│  - 代码执行工具                                          │
│  - 网络请求工具                                          │
│  - 桌面操作工具                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 📝 代码示例

### 示例 1：数据处理插件

```typescript
// ✅ 完全安全：纯数据处理
const dataPlugin: SkillPlugin = {
  metadata: {
    id: 'data_utils',
    name: 'Data Utils',
    version: '1.0.0',
    description: 'Data processing utilities',
  },
  tools: [
    {
      name: 'json_transform',
      description: 'Transform JSON data',
      parameters: {
        type: 'object',
        properties: {
          data: { type: 'object' },
          mapping: { type: 'object' },
        },
        required: ['data', 'mapping'],
      },
      async execute(params) {
        const { data, mapping } = params;
        const result = {};
        
        for (const [key, value] of Object.entries(mapping)) {
          if (key in data) {
            result[value as string] = data[key];
          }
        }
        
        return {
          success: true,
          message: 'Transformed',
          data: result,
        };
      },
    },
  ],
};
```

### 示例 2：调用已有工具

```typescript
// ✅ 允许：通过 context 调用工具
const fileProcessorPlugin: SkillPlugin = {
  metadata: {
    id: 'file_processor',
    name: 'File Processor',
    version: '1.0.0',
    description: 'Process files using existing tools',
  },
  tools: [
    {
      name: 'count_lines',
      description: 'Count lines in a file',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
        },
        required: ['file_path'],
      },
      async execute(params, context) {
        const { file_path } = params;
        
        // 调用已有的 read_file 工具
        const result = await context.callTool('read_file', {
          file_path,
        });
        
        if (!result.success) {
          return {
            success: false,
            message: `Failed to read file: ${result.message}`,
          };
        }
        
        const content = result.data?.content as string || '';
        const lines = content.split('\n').length;
        
        return {
          success: true,
          message: `File has ${lines} lines`,
          data: { lines, file_path },
        };
      },
    },
  ],
};
```

### 示例 3：组合多个工具

```typescript
// ✅ 允许：组合调用多个工具
const webScraperPlugin: SkillPlugin = {
  metadata: {
    id: 'web_scraper',
    name: 'Web Scraper',
    version: '1.0.0',
    description: 'Scrape and process web content',
  },
  tools: [
    {
      name: 'scrape_and_save',
      description: 'Scrape a webpage and save to file',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          output_path: { type: 'string' },
        },
        required: ['url', 'output_path'],
      },
      async execute(params, context) {
        const { url, output_path } = params;
        
        // 1. 获取网页
        context.log(`Fetching ${url}...`, 'info');
        const webResult = await context.callTool('web_fetch', { url });
        
        if (!webResult.success) {
          return {
            success: false,
            message: `Failed to fetch: ${webResult.message}`,
          };
        }
        
        // 2. 提取内容
        const html = webResult.data?.content as string || '';
        const text = html.replace(/<[^>]*>/g, ' ').trim();
        
        // 3. 保存文件
        context.log(`Saving to ${output_path}...`, 'info');
        const saveResult = await context.callTool('write_file', {
          file_path: output_path,
          content: text,
        });
        
        if (!saveResult.success) {
          return {
            success: false,
            message: `Failed to save: ${saveResult.message}`,
          };
        }
        
        return {
          success: true,
          message: `Scraped and saved to ${output_path}`,
          data: {
            url,
            output_path,
            size: text.length,
          },
        };
      },
    },
  ],
};
```

---

## ⚠️ 注意事项

1. **不要信任用户输入**：始终验证和清理参数
2. **处理错误**：使用 try-catch 包裹可能失败的操作
3. **限制数据大小**：避免处理过大的数据导致内存溢出
4. **避免无限循环**：确保循环有退出条件
5. **使用日志**：通过 `context.log()` 输出调试信息
6. **返回有意义的错误**：帮助用户理解问题所在

---

## 🔧 调试技巧

```typescript
async execute(params, context) {
  // 1. 记录输入
  context.log(`Input: ${JSON.stringify(params)}`, 'info');
  
  try {
    // 2. 执行逻辑
    const result = await doSomething(params);
    
    // 3. 记录输出
    context.log(`Output: ${JSON.stringify(result)}`, 'info');
    
    return {
      success: true,
      message: 'Done',
      data: result,
    };
  } catch (err) {
    // 4. 记录错误
    context.log(`Error: ${err}`, 'error');
    
    return {
      success: false,
      message: `Failed: ${err}`,
    };
  }
}
```
