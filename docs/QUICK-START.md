# OpenPaw JS 快速开始

## 一分钟了解项目

OpenPaw JS 是一个 AI 桌面助手，支持：
- 🖥️ 桌面自动化（截图、点击、输入）
- 🌐 浏览器控制
- 📱 手机操控
- 💻 代码生成与执行
- 🔌 插件扩展

---

## 快速上手

### 1. 启动开发环境

```bash
# 克隆项目
git clone <repo-url>
cd openpaw-js

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

### 2. 生成你的第一个应用

在聊天中输入：
```
帮我创建一个计算器应用
```

AI 会自动：
1. 生成 HTML/CSS/JS 代码
2. 保存到 Apps 数据库
3. 在 Apps 页面实时预览

### 3. 查看预览

点击左侧导航栏的 "Apps" 查看生成的应用。

---

## 开发者指南

### 创建你的第一个插件

1. **创建插件文件**

```typescript
// src/skills/plugins/my-first-plugin.ts
import type { SkillPlugin } from '@/skills/plugin-loader';

const myPlugin: SkillPlugin = {
  metadata: {
    id: 'my_first_plugin',
    name: 'My First Plugin',
    version: '1.0.0',
    description: 'A simple greeting plugin',
    category: 'example',
  },

  tools: [
    {
      name: 'greet',
      description: 'Say hello to someone',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name to greet',
          },
        },
        required: ['name'],
      },
      async execute(params, context) {
        const { name } = params as { name: string };
        
        context.log(`Greeting ${name}...`, 'info');
        
        return {
          success: true,
          message: `Hello, ${name}! Welcome to OpenPaw!`,
          data: { greeting: `Hello, ${name}!` },
        };
      },
    },
  ],
};

export default myPlugin;
```

2. **注册插件**

在 `src/skills/builtin-executor.ts` 中添加：

```typescript
// 在 loadBuiltinPlugins() 函数中
try {
  const { default: myPlugin } = await import('./plugins/my-first-plugin');
  const adapter = await _pluginLoader.loadFromObject(myPlugin);
  _executor.register(adapter);
} catch (err) {
  console.warn('Failed to load my plugin:', err);
}
```

3. **测试插件**

重启应用，在聊天中输入：
```
使用 greet 工具向 Alice 问好
```

---

## 常用操作

### 生成 HTML 应用

```
创建一个待办事项应用，支持添加、删除、标记完成功能
```

### 生成多文件项目

```
创建一个博客网站，包含首页、文章列表、文章详情页
```

### 使用自定义工具

```
使用 string_case_convert 将 "helloWorld" 转换为 snake_case
```

---

## 核心概念

### Skill（技能）

Skill 是工具的集合，每个 Skill 包含：
- `id`：唯一标识
- `name`：名称
- `tools`：工具列表
- `execute()`：执行函数

### Tool（工具）

Tool 是可执行的操作，每个 Tool 包含：
- `name`：工具名（AI 会看到）
- `description`：描述（AI 根据描述决定何时使用）
- `parameters`：参数定义（JSON Schema 格式）
- `execute()`：执行函数

### Plugin（插件）

Plugin 是 Skill 的扩展形式，支持：
- 外部加载
- 生命周期管理
- 上下文注入

---

## 文件结构

```
src/
├── skills/
│   ├── skill.ts              # Skill 接口定义
│   ├── executor.ts           # Skill 执行器
│   ├── builtin-executor.ts   # 内置执行器工厂
│   ├── plugin-loader.ts      # 插件加载器
│   ├── plugins/              # 插件目录
│   │   └── example-plugin.ts # 示例插件
│   ├── desktop.ts            # 桌面自动化 Skill
│   ├── web.ts                # 浏览器 Skill
│   ├── code-tools.ts         # 代码工具 Skill
│   └── app-builder.ts        # 应用管理 Skill
├── services/
│   ├── code-sandbox/         # 代码沙箱
│   ├── code-gateway.ts       # 代码生成网关
│   ├── multi-agent/          # 多 Agent 编排
│   └── app-events.ts         # 事件总线
└── pages/
    ├── apps.tsx              # Apps 页面（预览）
    ├── chat.tsx              # 聊天页面
    └── skills.tsx            # Skills 管理页面
```

---

## API 速查

### 插件上下文 (PluginContext)

```typescript
// 调用其他工具
const result = await context.callTool('tool_name', { /* params */ });

// 日志输出
context.log('Processing...', 'info');
context.log('Warning!', 'warn');
context.log('Error!', 'error');

// 文件操作（如果可用）
const content = await context.readFile?.('/path/to/file');
await context.writeFile?.('/path/to/file', 'content');

// 命令执行（如果可用）
const output = await context.execCommand?.('ls -la');
```

### 插件结果 (PluginResult)

```typescript
// 成功
return {
  success: true,
  message: 'Operation completed',
  data: { key: 'value' },
};

// 失败
return {
  success: false,
  message: 'Operation failed',
  data: { error: 'reason' },
};
```

---

## 常见问题

### Q: 插件不生效？

A: 检查以下几点：
1. 插件是否正确注册
2. `metadata.id` 是否唯一
3. 工具名是否与现有工具冲突
4. 查看控制台是否有错误

### Q: 如何调试插件？

A: 使用 `context.log()` 输出日志，查看浏览器控制台。

### Q: 插件可以调用其他工具吗？

A: 可以，使用 `context.callTool()` 调用已注册的任何工具。

### Q: 插件可以访问网络吗？

A: 可以通过调用 `web_fetch` 工具实现网络请求。

---

## 更多资源

- [完整开发文档](DEVELOPMENT.md)
- [插件开发指南](PLUGIN-GUIDE.md)
- [项目架构](PROJECT.md)

---

## 获取帮助

- 查看 `docs/` 目录下的文档
- 阅读 `src/skills/plugins/example-plugin.ts` 示例
- 检查控制台错误日志
