/**
 * 通用执行引擎
 *
 * 功能：
 * 1. 执行自动化模板
 * 2. 语义匹配定位元素
 * 3. 循环/条件流程控制
 * 4. 参数替换
 * 5. 执行日志
 */

import type { PlatformAdapter, ElementQuery } from '@/adapters/platform-adapter';
import { adapterRegistry } from '@/adapters/platform-adapter';
import type {
  AutomationTemplate,
  TemplateStep,
  TemplateParameter,
  TemplateExecutionContext,
  LoopContext,
  ExecutionLog,
  TemplateStatus,
} from '@/types/automation-template';
import type { UnifiedElement } from '@/types/unified-element';
import type { ActionTarget, TemplateExpression } from '@/types/unified-action';
import { desktopService } from '@/services/desktop-service';

/**
 * 执行选项
 */
export interface ExecutionOptions {
  dryRun?: boolean;                    // 试运行模式
  verbose?: boolean;                   // 详细日志
  pauseOnError?: boolean;              // 出错时暂停
  stepTimeout?: number;                // 单步超时 (ms)
  onStepStart?: (step: TemplateStep, index: number) => void;
  onStepEnd?: (step: TemplateStep, index: number, success: boolean) => void;
  onError?: (step: TemplateStep, error: Error) => void;
  onStatusChange?: (status: TemplateStatus) => void;
}

/**
 * 通用执行引擎
 */
class UnifiedExecutor {
  private adapters: Map<string, PlatformAdapter> = new Map();
  private currentContext: TemplateExecutionContext | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    // 初始化时获取所有可用的适配器
    this.initializeAdapters();
  }

  private async initializeAdapters(): Promise<void> {
    const adapters = await adapterRegistry.getAvailableAdapters();
    for (const adapter of adapters) {
      this.adapters.set(adapter.platform, adapter);
    }
  }

  // ── 执行控制 ──

  /**
   * 执行模板
   */
  async execute(
    template: AutomationTemplate,
    params: Record<string, unknown> = {},
    options: ExecutionOptions = {},
  ): Promise<TemplateExecutionContext> {
    // 创建执行上下文
    const context: TemplateExecutionContext = {
      template,
      params,
      variables: {},
      currentStepIndex: 0,
      loopStack: [],
      status: 'running',
      startTime: Date.now(),
      logs: [],
    };

    this.currentContext = context;
    this.abortController = new AbortController();

    options.onStatusChange?.('running');

    try {
      // 初始化适配器
      await this.initializeAdapters();

      // 执行步骤
      await this.executeSteps(template.steps, context, options);

      // 完成
      context.status = 'completed';
      context.endTime = Date.now();
      options.onStatusChange?.('completed');

    } catch (error) {
      context.status = 'failed';
      context.endTime = Date.now();
      context.error = error as Error;
      options.onStatusChange?.('failed');

      if (options.onError) {
        options.onError(
          context.template.steps[context.currentStepIndex],
          error as Error,
        );
      }

      if (!options.pauseOnError) {
        throw error;
      }
    } finally {
      this.currentContext = null;
      this.abortController = null;
    }

    return context;
  }

  /**
   * 暂停执行
   */
  pause(): void {
    if (this.currentContext && this.currentContext.status === 'running') {
      this.currentContext.status = 'paused';
    }
  }

  /**
   * 恢复执行
   */
  resume(): void {
    if (this.currentContext && this.currentContext.status === 'paused') {
      this.currentContext.status = 'running';
    }
  }

  /**
   * 取消执行
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.currentContext) {
      this.currentContext.status = 'cancelled';
      this.currentContext.endTime = Date.now();
    }
  }

  // ── 步骤执行 ──

  private async executeSteps(
    steps: TemplateStep[],
    context: TemplateExecutionContext,
    options: ExecutionOptions,
  ): Promise<void> {
    context.currentStepIndex = 0;
    while (context.currentStepIndex < steps.length) {
      const i = context.currentStepIndex;
      const step = steps[i];

      // 检查取消
      if (this.abortController?.signal.aborted) {
        throw new Error('Execution cancelled');
      }

      // 检查暂停
      while (context.status === 'paused') {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Resolve params for display (coordinates, expressions)
      const resolvedStep = this.resolveParams(step, context);

      // 步骤开始回调（传入已解析的 step，坐标直接可读）
      options.onStepStart?.(resolvedStep, i);

      // 执行步骤
      const startTime = Date.now();
      let success = true;
      let error: string | undefined;

      try {
        await this.executeStep(step, context, options);
      } catch (e) {
        success = false;
        error = (e as Error).message;

        if (options.pauseOnError) {
          context.status = 'paused';
          options.onStatusChange?.('paused');

          // 等待恢复
          while (context.status === 'paused') {
            await new Promise(resolve => setTimeout(resolve, 100));
          }

          if (context.status === 'cancelled') {
            throw new Error('Execution cancelled');
          }
        } else {
          throw e;
        }
      }

      // 记录日志
      const log: ExecutionLog = {
        timestamp: Date.now(),
        stepId: step.id,
        stepIndex: i,
        action: step.action,
        status: success ? 'success' : 'failure',
        message: step.description,
        error,
        duration: Date.now() - startTime,
      };
      context.logs.push(log);

      // 步骤结束回调
      options.onStepEnd?.(step, i, success);

      // 如果步骤内部已修改 currentStepIndex（如 loop_end 跳转），不再自动 +1
      if (context.currentStepIndex === i) {
        context.currentStepIndex++;
      }
    }
  }

  private async executeStep(
    step: TemplateStep,
    context: TemplateExecutionContext,
    options: ExecutionOptions,
  ): Promise<void> {
    // 解析参数
    const resolved = this.resolveParams(step, context);

    // 检查条件
    if (resolved.condition && !this.evaluateCondition(resolved.condition, context)) {
      return;
    }

    // 步骤前等待
    if (resolved.waitBefore) {
      await this.sleep(resolved.waitBefore);
    }

    // 执行动作
    switch (resolved.action) {
      case 'click':
      case 'double_click':
      case 'right_click':
      case 'long_press':
        await this.executeClick(resolved, context, options);
        break;

      case 'type':
        await this.executeType(resolved, context, options);
        break;

      case 'key':
      case 'hotkey':
        await this.executeKey(resolved, context, options);
        break;

      case 'copy':
        await this.executeCopy(resolved, context, options);
        break;

      case 'paste':
        await this.executePaste(resolved, context, options);
        break;

      case 'focus':
        await this.executeFocus(resolved, context, options);
        break;

      case 'scroll':
        await this.executeScroll(resolved, context, options);
        break;

      case 'wait':
        await this.executeWait(resolved, context, options);
        break;

      case 'loop_start':
        this.startLoop(resolved, context);
        break;

      case 'loop_end':
        this.endLoop(resolved, context);
        break;

      case 'if':
        this.executeIf(resolved, context);
        break;

      case 'else':
        this.executeElse(context);
        break;

      case 'endif':
        // 标记块结束，无操作（if/else 跳转的锚点）
        break;

      case 'goto':
        this.executeGoto(resolved, context);
        break;

      case 'break':
        this.executeBreak(context);
        break;

      case 'continue':
        this.executeContinue(context);
        break;

      case 'code':
        await this.executeCode(resolved, context, options);
        break;

      case 'drag':
        await this.executeDrag(resolved, context, options);
        break;

      case 'tool_call':
        await this.executeToolCall(resolved, context, options);
        break;

      case 'llm_call':
        await this.executeLLMCall(resolved, context, options);
        break;

      default:
        break;
    }

    // 步骤后等待
    if (resolved.waitAfter) {
      await this.sleep(resolved.waitAfter);
    }
  }

  // ── 参数解析 ──

  private resolveParams(step: TemplateStep, context: TemplateExecutionContext): TemplateStep {
    const resolved = JSON.parse(JSON.stringify(step)) as TemplateStep;

    // 解析 params 中的模板表达式
    if (resolved.params) {
      for (const [key, value] of Object.entries(resolved.params)) {
        if (typeof value === 'string') {
          (resolved.params as Record<string, unknown>)[key] = this.resolveExpression(value, context);
        }
      }
    }

    // 解析 target 中的模板表达式
    if (resolved.target?.semantic?.name) {
      resolved.target.semantic.name = this.resolveExpression(
        resolved.target.semantic.name as string,
        context,
      ) as string;
    }

    // 解析 target 中的坐标表达式
    if (resolved.target?.coordinate) {
      const coord = resolved.target.coordinate;
      if (typeof coord.x === 'string') {
        const resolved_x = this.resolveExpression(coord.x, context);
        coord.x = Number(resolved_x);
      }
      if (typeof coord.y === 'string') {
        const resolved_y = this.resolveExpression(coord.y, context);
        coord.y = Number(resolved_y);
      }
    }

    return resolved;
  }

  private resolveExpression(expr: TemplateExpression, context: TemplateExecutionContext): unknown {
    if (typeof expr !== 'string') return expr;

    // 处理模板表达式 {{xxx}}
    return expr.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const trimmedPath = path.trim();
      const value = this.evaluateExpression(trimmedPath, context);
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * 求值表达式 — 支持变量引用和简单算术
   * 如 "index" → 变量值, "150 + index * 60" → 计算结果
   */
  private evaluateExpression(expr: string, context: TemplateExecutionContext): unknown {
    // 纯数字
    if (/^\d+(\.\d+)?$/.test(expr)) {
      return Number(expr);
    }
    // 纯变量名或路径（无运算符）
    if (/^[\w.[\]]+$/.test(expr)) {
      return this.evaluatePath(expr, context);
    }

    // 替换变量名 → 数值，然后做算术求值
    const substituted = expr.replace(/\b[\w.[\]]+\b/g, (token) => {
      // 跳过纯数字
      if (/^\d+(\.\d+)?$/.test(token)) return token;
      const val = this.evaluatePath(token, context);
      if (typeof val === 'number') return String(val);
      if (typeof val === 'string' && !isNaN(Number(val))) return val;
      return token; // 无法解析的保留原样
    });

    // 安全检查：只允许数字、运算符、括号、空格
    if (!/^[\d\s+\-*/().]+$/.test(substituted)) {
      return undefined;
    }

    try {
      const result = Function(`"use strict"; return (${substituted})`)();
      return typeof result === 'number' ? result : undefined;
    } catch {
      return undefined;
    }
  }

  private evaluatePath(path: string, context: TemplateExecutionContext): unknown {
    // 处理简单的变量引用
    if (path in context.variables) {
      return context.variables[path];
    }

    // 处理参数引用
    if (path in context.params) {
      return context.params[path];
    }

    // 处理点号路径（如 source.rows）
    const parts = path.split('.');
    let current: unknown = { ...context.variables, ...context.params };

    for (const part of parts) {
      // 处理数组索引
      const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
      if (arrayMatch) {
        const [, key, index] = arrayMatch;
        current = (current as Record<string, unknown>)?.[key];
        if (Array.isArray(current)) {
          current = current[parseInt(index)];
        } else {
          return undefined;
        }
      } else {
        if (current && typeof current === 'object') {
          current = (current as Record<string, unknown>)[part];
        } else {
          return undefined;
        }
      }
    }

    return current;
  }

  private evaluateCondition(condition: string, context: TemplateExecutionContext): boolean {
    // 空条件默认通过
    if (!condition || !condition.trim()) return true;

    // 先解析模板表达式 {{var}} → 实际值
    const resolved = condition.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
      const value = this.evaluatePath(path.trim(), context);
      if (typeof value === 'string') return `'${value.replace(/'/g, "\\'").replace(/"/g, '\\"')}'`;
      if (value === undefined || value === null) return 'null';
      if (typeof value === 'boolean') return String(value);
      return String(value);
    });

    const trimmed = resolved.trim();

    // 布尔字面量
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null' || trimmed === 'undefined') return false;

    // 逻辑或（低优先级）
    if (/\s+or\s+/i.test(trimmed) || /\s*\|\|\s*/.test(trimmed)) {
      const parts = trimmed.split(/\s+(?:or|\|\|)\s+/i);
      return parts.some(p => this.evaluateCondition(p, context));
    }

    // 逻辑与（高优先级）
    if (/\s+and\s+/i.test(trimmed) || /\s*&&\s*/.test(trimmed)) {
      const parts = trimmed.split(/\s+(?:and|&&)\s+/i);
      return parts.every(p => this.evaluateCondition(p, context));
    }

    // 逻辑非
    const notMatch = trimmed.match(/^(?:not|!)\s+(.+)$/i);
    if (notMatch) return !this.evaluateCondition(notMatch[1], context);

    // 比较运算：==, !=, >=, <=, >, <, includes, not_includes
    const compMatch = trimmed.match(/^(.+?)\s+(==|!=|>=|<=|>|<|includes|not_includes)\s+(.+)$/i);
    if (compMatch) {
      const [, leftRaw, op, rightRaw] = compMatch;
      const l = this.parseConditionValue(leftRaw.trim());
      const r = this.parseConditionValue(rightRaw.trim());
      switch (op) {
        case '==': return l === r;
        case '!=': return l !== r;
        case '>=': return Number(l) >= Number(r);
        case '<=': return Number(l) <= Number(r);
        case '>': return Number(l) > Number(r);
        case '<': return Number(l) < Number(r);
        case 'includes': return typeof l === 'string' && typeof r === 'string' && l.includes(r);
        case 'not_includes': return typeof l === 'string' && typeof r === 'string' && !l.includes(r);
      }
    }

    // 纯数字或字符串：truthiness
    const value = this.resolveExpression(condition, context);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.length > 0;
    if (typeof value === 'number') return value !== 0;
    return value != null;
  }

  /** 解析条件表达式中的值 */
  private parseConditionValue(raw: string): unknown {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null') return null;
    if (raw === 'undefined') return undefined;
    // 带引号的字符串
    if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
      return raw.slice(1, -1);
    }
    // 数字
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    // 无引号字符串（变量名已解析为值后的残留）
    return raw;
  }

  // ── 流程控制：if/else/endif/goto ──

  /** 执行 if：条件为 true 则继续执行下一步，false 则跳到匹配的 else 或 endif */
  private executeIf(step: TemplateStep, context: TemplateExecutionContext): void {
    const condition = step.condition || step.control?.condition || '';
    const result = this.evaluateCondition(condition, context);

    if (result) {
      // 条件成立，继续执行下一步
      return;
    }

    // 条件不成立，跳到匹配的 else 或 endif
    this.skipToMatchingEndifOrElse(context);
  }

  /** 执行 else：从 if(true) 路径到达时跳到 endif */
  private executeElse(context: TemplateExecutionContext): void {
    // 能执行到 else 说明 if 条件为 true，应跳过 else 块到 endif
    this.skipToMatchingEndif(context);
  }

  /** 跳转到匹配的 endif（跳过嵌套块） */
  private skipToMatchingEndif(context: TemplateExecutionContext): void {
    const steps = context.template.steps;
    let depth = 1;
    for (let j = context.currentStepIndex + 1; j < steps.length; j++) {
      if (steps[j].action === 'if') depth++;
      if (steps[j].action === 'endif') {
        depth--;
        if (depth === 0) {
          context.currentStepIndex = j;
          return;
        }
      }
    }
  }

  /** 跳转到匹配的 else 或 endif（if 条件为 false 时） */
  private skipToMatchingEndifOrElse(context: TemplateExecutionContext): void {
    const steps = context.template.steps;
    let depth = 1;
    for (let j = context.currentStepIndex + 1; j < steps.length; j++) {
      if (steps[j].action === 'if') depth++;
      if (steps[j].action === 'endif') {
        depth--;
        if (depth === 0) {
          context.currentStepIndex = j;
          return;
        }
      }
      if (steps[j].action === 'else' && depth === 1) {
        // 找到同层级的 else，跳到这里（else 会继续执行其后的步骤）
        context.currentStepIndex = j;
        return;
      }
    }
  }

  /** 执行 goto：跳转到指定步骤 ID */
  private executeGoto(step: TemplateStep, context: TemplateExecutionContext): void {
    const targetId = step.params?.stepId as string
      || step.control?.stepId
      || '';
    if (!targetId) return;

    const steps = context.template.steps;
    for (let j = 0; j < steps.length; j++) {
      if (steps[j].id === targetId) {
        context.currentStepIndex = j;
        return;
      }
    }
  }

  // ── 动作执行 ──

  private async executeClick(
    step: TemplateStep,
    context: TemplateExecutionContext,
    options: ExecutionOptions,
  ): Promise<void> {
    const target = step.target;

    if (options.dryRun) {
      return;
    }

    // 1. 语义定位（优先）
    if (target?.semantic) {
      const element = await this.findElementBySemantic(target.semantic, context);
      if (element) {
        await this.clickElement(element);
        return;
      }
    }

    // 2. 路径定位
    if (target?.path) {
      const element = await this.findElementByPath(target.path);
      if (element) {
        await this.clickElement(element);
        return;
      }
    }

    // 3. 坐标定位（兜底）
    if (target?.coordinate) {
      const x = Number(this.resolveExpression(String(target.coordinate.x), context));
      const y = Number(this.resolveExpression(String(target.coordinate.y), context));
      if (step.action === 'double_click') {
        await desktopService.doubleClick(x, y);
      } else if (step.action === 'right_click') {
        await desktopService.rightClick(x, y);
      } else {
        await desktopService.click(x, y);
      }
      return;
    }

    // 4. 变量引用
    if (target?.variable) {
      const element = context.variables[target.variable] as UnifiedElement;
      if (element) {
        await this.clickElement(element);
        return;
      }
    }

    throw new Error('No valid target for click');
  }

  private async executeType(
    step: TemplateStep,
    context: TemplateExecutionContext,
    options: ExecutionOptions,
  ): Promise<void> {
    const text = String(step.params?.text || '');
    const target = step.target;

    if (options.dryRun) {
      return;
    }

    if (target?.semantic) {
      const element = await this.findElementBySemantic(target.semantic, context);
      if (element) {
        const adapter = await this.getAdapterForElement(element);
        if (adapter) {
          await adapter.type(element, text);
          return;
        }
      }
    }

    // 使用桌面服务直接输入
    await desktopService.typeText(text);
  }

  private async executeKey(
    step: TemplateStep,
    context: TemplateExecutionContext,
    options: ExecutionOptions,
  ): Promise<void> {
    const key = String(step.params?.key || '');

    if (options.dryRun) {
      return;
    }

    await desktopService.pressKey(key);
  }

  private async executeCopy(
    step: TemplateStep,
    context: TemplateExecutionContext,
    options: ExecutionOptions,
  ): Promise<void> {
    if (options.dryRun) {
      return;
    }

    await desktopService.pressKey('Ctrl+C');

    // 等待剪贴板更新，然后读取内容存入变量
    await this.sleep(200);
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        context.variables['clipboard'] = text;
      }
    } catch {
      // 剪贴板读取可能被拒绝，忽略
    }
  }

  private async executePaste(
    step: TemplateStep,
    context: TemplateExecutionContext,
    options: ExecutionOptions,
  ): Promise<void> {
    if (options.dryRun) {
      return;
    }

    await desktopService.pressKey('Ctrl+V');
  }

  private async executeFocus(
    step: TemplateStep,
    context: TemplateExecutionContext,
    options: ExecutionOptions,
  ): Promise<void> {
    const target = step.target;

    if (options.dryRun) {
      return;
    }

    // 优先：target.semantic 直接指定窗口名
    const windowName = typeof target?.semantic === 'string'
      ? target.semantic
      : target?.semantic?.name as string | undefined;
    if (windowName) {
      const windows = await desktopService.listWindows();
      const match = windows.find(w => w.title.toLowerCase().includes(windowName.toLowerCase()));
      if (match) {
        await desktopService.focusWindow(match.hwnd);
        return;
      }
    }
    // 兜底：UIA 元素查找
    if (target?.semantic && typeof target.semantic !== 'string') {
      const element = await this.findElementBySemantic(target.semantic, context);
      if (element) {
        const title = element.identity.name;
        const windows = await desktopService.listWindows();
        const window = windows.find(w => w.title.includes(title));
        if (window) {
          await desktopService.focusWindow(window.hwnd);
        }
      }
    }
  }

  private async executeScroll(
    step: TemplateStep,
    context: TemplateExecutionContext,
    options: ExecutionOptions,
  ): Promise<void> {
    const direction = String(step.params?.direction || 'down');
    const amount = Number(step.params?.amount || 100);
    const target = step.target;

    if (options.dryRun) {
      return;
    }

    if (target?.coordinate) {
      const x = Number(this.resolveExpression(String(target.coordinate.x), context));
      const y = Number(this.resolveExpression(String(target.coordinate.y), context));
      const delta = direction === 'down' ? -amount : amount;
      await desktopService.scroll(x, y, delta);
    }
  }

  private async executeDrag(
    step: TemplateStep,
    context: TemplateExecutionContext,
    options: ExecutionOptions,
  ): Promise<void> {
    const params = step.params || {};

    if (options.dryRun) {
      return;
    }

    const start_x = Number(this.resolveExpression(String(params.start_x ?? 0), context));
    const start_y = Number(this.resolveExpression(String(params.start_y ?? 0), context));
    const end_x = Number(this.resolveExpression(String(params.end_x ?? 0), context));
    const end_y = Number(this.resolveExpression(String(params.end_y ?? 0), context));
    const duration_ms = params.duration_ms ? Number(params.duration_ms) : undefined;
    const button = params.button ? String(params.button) : undefined;

    await desktopService.drag(start_x, start_y, end_x, end_y, duration_ms, button);
  }

  private async executeWait(
    step: TemplateStep,
    context: TemplateExecutionContext,
    options: ExecutionOptions,
  ): Promise<void> {
    const duration = Number(step.params?.duration || 1000);

    if (options.dryRun) {
      return;
    }

    await this.sleep(duration);
  }

  private async executeCode(
    step: TemplateStep,
    context: TemplateExecutionContext,
    options: ExecutionOptions,
  ): Promise<void> {
    const code = String(step.params?.code || '');
    if (!code) return;

    if (options.dryRun) {
      return;
    }

    try {
      // 沙箱环境：vars（读写上下文变量）、params（步骤参数）、ok/fail（返回结果）
      const sandboxFn = new Function('vars', 'params', 'ok', 'fail', code);
      const result = sandboxFn(
        context.variables,
        step.params || {},
        (msg: string, data?: Record<string, unknown>) => ({ success: true, message: msg, ...data }),
        (msg: string) => ({ success: false, message: msg }),
      );

      // 如果代码返回了对象，合并到上下文变量
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        Object.assign(context.variables, result);
      }
    } catch (e) {
      throw new Error(`Code execution error: ${(e as Error).message}`);
    }
  }

  // ── 流程控制 ──

  private startLoop(step: TemplateStep, context: TemplateExecutionContext): void {
    const over = String(step.params?.over || '');
    const variable = String(step.params?.variable || 'item');

    // 解析循环数据源
    let items: unknown[] = [];

    if (over.startsWith('{{') && over.endsWith('}}')) {
      // 参数引用
      const path = over.slice(2, -2);
      const value = this.evaluatePath(path, context);
      if (Array.isArray(value)) {
        items = value;
      } else if (typeof value === 'number' && value > 0) {
        items = Array.from({ length: value }, (_, i) => i);
      }
    } else if (Array.isArray(context.params[over])) {
      // 参数数组
      items = context.params[over] as unknown[];
    } else {
      // 数字循环次数（坐标参数化场景：over: "5" → 循环 5 次）
      const count = parseInt(over, 10);
      if (!isNaN(count) && count > 0) {
        items = Array.from({ length: count }, (_, i) => i);
      }
    }

    // 解析 startIndex（支持 {{表达式}}）
    let startIndex = 0;
    const startIndexRaw = step.params?.startIndex;
    if (startIndexRaw !== undefined) {
      const resolved = this.resolveExpression(String(startIndexRaw), context);
      startIndex = Number(resolved) || 0;
    }

    context.loopStack.push({
      items,
      currentIndex: 0,
      variable,
      bodyStartIndex: context.currentStepIndex + 1,
      startIndex,
    });

    // 设置初始变量
    if (items.length > 0) {
      context.variables[variable] = startIndex;
      // 始终暴露 index 变量（兼容旧模板）
      context.variables['index'] = startIndex;
    }
  }

  private endLoop(step: TemplateStep, context: TemplateExecutionContext): void {
    const loop = context.loopStack[context.loopStack.length - 1];
    if (!loop) return;

    loop.currentIndex++;

    if (loop.currentIndex < loop.items.length) {
      // 更新变量（加上 startIndex 偏移）
      context.variables[loop.variable] = loop.startIndex + loop.currentIndex;
      // 同步更新 index 变量
      context.variables['index'] = loop.startIndex + loop.currentIndex;

      // 跳回循环体开始（while 循环直接使用 currentStepIndex，不需要 -1）
      context.currentStepIndex = loop.bodyStartIndex;
    } else {
      // 循环结束
      context.loopStack.pop();
    }
  }

  private executeBreak(context: TemplateExecutionContext): void {
    const loop = context.loopStack[context.loopStack.length - 1];
    if (!loop) return;

    // 弹出当前循环，跳转到 loop_end 之后
    context.loopStack.pop();
    // 从当前位置向前找到对应的 loop_end，跳到它后面
    const steps = context.template.steps;
    let depth = 1;
    for (let j = context.currentStepIndex + 1; j < steps.length; j++) {
      if (steps[j].action === 'loop_start') depth++;
      if (steps[j].action === 'loop_end') {
        depth--;
        if (depth === 0) {
          context.currentStepIndex = j;
          return;
        }
      }
    }
  }

  private executeContinue(context: TemplateExecutionContext): void {
    const loop = context.loopStack[context.loopStack.length - 1];
    if (!loop) return;

    // 跳到循环体开始（while 循环直接使用 currentStepIndex，不需要 -1）
    context.currentStepIndex = loop.bodyStartIndex;
  }

  private async executeToolCall(
    step: TemplateStep,
    context: TemplateExecutionContext,
    options: ExecutionOptions,
  ): Promise<void> {
    const toolName = String(step.params?.toolName || '');
    const args = (step.params?.arguments || {}) as Record<string, unknown>;

    if (options.dryRun) {
      return;
    }

    try {
      const { getBuiltinExecutor } = await import('@/skills/builtin-executor');
      const executor = getBuiltinExecutor();
      const result = await executor.executeToolCall(toolName, args);
      if (!result?.success) {
        throw new Error(result?.message || `Tool ${toolName} returned failure`);
      }
      // 存储结果到上下文
      if (result?.data) {
        // 截图类工具：额外保存压缩截图供后续 llm_call 多模态引用
        if ((toolName === 'desktop_screenshot' || toolName === 'screenshot') && result.data.image_data) {
          try {
            const { compressImage } = await import('@/utils/image');
            const rawData = result.data.image_data as string;
            const dataUrl = rawData.startsWith('data:') ? rawData : `data:image/bmp;base64,${rawData}`;
            const compressed = await compressImage(dataUrl, 1024, 45);
            context.variables['_screenshot_' + step.id] = compressed.dataUrl;
            // 过滤掉原始大图数据
            const filteredData = { ...result.data } as Record<string, unknown>;
            filteredData.image_data = '[image data omitted — stored as screenshot]';
            filteredData['_screenshot_step_id'] = step.id;
            Object.assign(context.variables, filteredData);
          } catch {
            Object.assign(context.variables, result.data);
          }
        } else if (result.data.region_screenshot) {
          // 点击/拖拽等返回的区域截图
          context.variables['_screenshot_' + step.id] = result.data.region_screenshot as string;
          Object.assign(context.variables, result.data);
        } else {
          Object.assign(context.variables, result.data);
        }
      }
    } catch (e) {
      console.warn(`[UnifiedExecutor] tool_call ${toolName} failed:`, e);
    }
  }

  private async executeLLMCall(
    step: TemplateStep,
    context: TemplateExecutionContext,
    options: ExecutionOptions,
  ): Promise<void> {
    const rawPrompt = String(step.params?.prompt || '');
    if (!rawPrompt || options.dryRun) return;

    // 解析 prompt 中的模板表达式
    const prompt = this.resolveExpression(rawPrompt, context) as string;
    const systemPrompt = this.resolveExpression(
      String(step.params?.systemPrompt || ''), context,
    ) as string;
    const model = String(step.params?.model || '');
    const multimodal = !!(step.params?.multimodal);
    const includeScreenshots = (step.params?.include_screenshots || []) as string[];

    try {
      const { useModelConfigStore } = await import('@/stores/model-config-store');
      await useModelConfigStore.getState().load();
      const config = useModelConfigStore.getState().defaultConfig();
      if (!config) throw new Error('No LLM config');

      const apiKey = await useModelConfigStore.getState().getApiKey(config.id, '');
      const { getModelService } = await import('@/services/model-service-singleton');
      const service = getModelService();

      const messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }> = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });

      // 多模态消息：附加前序步骤的截图
      if (multimodal && includeScreenshots.length > 0) {
        const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

        // 先放截图
        for (const stepId of includeScreenshots) {
          const screenshotUrl = context.variables['_screenshot_' + stepId] as string | undefined;
          if (screenshotUrl) {
            contentParts.push({
              type: 'image_url',
              image_url: { url: screenshotUrl },
            });
          }
        }

        // 再放文本提示词
        contentParts.push({ type: 'text', text: prompt });

        messages.push({ role: 'user', content: contentParts });
      } else {
        messages.push({ role: 'user', content: prompt });
      }

      const stream = service.chatStream({
        scenario: 'recorderAnalysis' as any,
        messages,
        provider: config,
        apiKey,
        model: model || undefined,
      });

      let result = '';
      for await (const chunk of stream) {
        if (chunk.startsWith('__ERROR__:')) throw new Error(chunk.substring(10));
        if (chunk.startsWith('__REASONING__:')) continue;
        result += chunk;
      }
      context.variables['llm_result'] = result;
      context.variables['llm_result_' + context.currentStepIndex] = result;
    } catch (e) {
      console.warn(`[UnifiedExecutor] llm_call failed:`, e);
      context.variables['llm_result'] = `[LLM call error: ${(e as Error).message}]`;
    }
  }

  // ── 元素查找 ──

  private async findElementBySemantic(
    semantic: { role: string; name: unknown },
    context: TemplateExecutionContext,
  ): Promise<UnifiedElement | null> {
    const role = semantic.role;
    const name = String(this.resolveExpression(String(semantic.name), context));

    // 遍历所有适配器查找
    for (const adapter of this.adapters.values()) {
      try {
        const element = await adapter.findElement({ role, name });
        if (element) return element;
      } catch {
        // 继续尝试其他适配器
      }
    }

    return null;
  }

  private async findElementByPath(path: string): Promise<UnifiedElement | null> {
    for (const adapter of this.adapters.values()) {
      try {
        const element = await adapter.findElement({ path });
        if (element) return element;
      } catch {
        // 继续尝试其他适配器
      }
    }
    return null;
  }

  private async clickElement(element: UnifiedElement): Promise<void> {
    const adapter = await this.getAdapterForElement(element);
    if (adapter) {
      await adapter.click(element);
    } else {
      // 使用坐标点击
      if (element.location.bounds) {
        const { x, y, width, height } = element.location.bounds;
        await desktopService.click(x + width / 2, y + height / 2);
      }
    }
  }

  private async clickCoordinate(x: number, y: number): Promise<void> {
    await desktopService.click(x, y);
  }

  private async getAdapterForElement(element: UnifiedElement): Promise<PlatformAdapter | null> {
    const platform = element.raw?.platform;
    if (platform && this.adapters.has(platform)) {
      return this.adapters.get(platform)!;
    }

    // 返回第一个可用的适配器
    for (const adapter of this.adapters.values()) {
      return adapter;
    }

    return null;
  }

  // ── 辅助方法 ──

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取当前执行上下文
   */
  getCurrentContext(): TemplateExecutionContext | null {
    return this.currentContext;
  }

  /**
   * 获取执行日志
   */
  getLogs(): ExecutionLog[] {
    return this.currentContext?.logs || [];
  }
}

// 导出单例
export const unifiedExecutor = new UnifiedExecutor();
