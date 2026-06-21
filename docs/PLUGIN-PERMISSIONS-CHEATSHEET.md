# 插件权限速查表

## ✅ 允许

| 类别 | 代码 | 说明 |
|------|------|------|
| **数据处理** | `JSON.parse()`, `JSON.stringify()` | JSON 操作 |
| | `Array.map()`, `Array.filter()`, `Array.sort()` | 数组操作 |
| | `String.match()`, `String.replace()` | 字符串操作 |
| | `new Set()`, `new Map()` | 集合操作 |
| | `new Date()` | 日期处理 |
| | `RegExp` | 正则表达式 |
| | `Math.*` | 数学计算 |
| | `parseInt()`, `parseFloat()` | 类型转换 |
| **工具调用** | `context.callTool(name, params)` | 调用已注册工具 |
| **日志** | `context.log(msg, level)` | 输出日志 |
| **文件操作** | `context.readFile?.(path)` | 读取文件（可选） |
| | `context.writeFile?.(path, content)` | 写入文件（可选） |
| **命令执行** | `context.execCommand?.(cmd)` | 执行命令（可选） |
| **设置** | `context.getSetting?.(key)` | 获取设置（可选） |

## ❌ 禁止

| 类别 | 代码 | 原因 |
|------|------|------|
| **Node.js** | `import fs from 'fs'` | 不可用 |
| | `import path from 'path'` | 不可用 |
| | `process.env` | 不可用 |
| | `__dirname`, `__filename` | 不可用 |
| **浏览器** | `document.*` | 不可用 |
| | `window.*` | 不可用 |
| | `localStorage.*` | 不可用 |
| | `fetch()` | 用 `web_fetch` 工具替代 |
| **动态执行** | `eval()` | 安全风险 |
| | `new Function()` | 安全风险 |
| | `import()` | 安全风险 |
| **全局对象** | `globalThis.*` | 不可用 |
| | `global.*` | 不可用 |
| **原型** | `Object.prototype.* = ` | 禁止修改 |

## 🔧 可调用的工具

通过 `context.callTool()` 调用：

```
文件操作:  read_file, write_file, glob, search_files
代码执行:  execute_code, generate_code, iterate_code
网络请求:  web_search, web_fetch
应用管理:  save_app, list_apps, get_app
桌面操作:  desktop_screenshot, desktop_click, desktop_type
命令执行:  run_command
```

## 📝 模板

```typescript
const myPlugin: SkillPlugin = {
  metadata: {
    id: 'my_plugin',
    name: 'My Plugin',
    version: '1.0.0',
    description: 'Description',
  },
  tools: [{
    name: 'my_tool',
    description: 'Tool description for AI',
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Input description' },
      },
      required: ['input'],
    },
    async execute(params, context) {
      const { input } = params;
      
      // 1. 记录日志
      context.log('Processing...', 'info');
      
      // 2. 调用工具（可选）
      const result = await context.callTool('some_tool', { /* params */ });
      
      // 3. 处理数据
      const output = transformData(input);
      
      // 4. 返回结果
      return {
        success: true,
        message: 'Done',
        data: { output },
      };
    },
  }],
};

export default myPlugin;
```
