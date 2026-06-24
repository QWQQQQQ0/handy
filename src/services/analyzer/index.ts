/**
 * 统一分析器服务
 *
 * 功能：
 * 1. 从录制会话中提取数据流
 * 2. 调用 LLM 分析操作模式
 * 3. 生成通用自动化模板
 *
 * 结构：
 *   index.ts              — UnifiedAnalyzer 主类 (组合)
 *   types.ts              — LLMAnalysisResult, CoordinatePattern
 *   utils.ts              — median, variance, diffs, getScreenCoord
 *   data-flow.ts          — extractDataFlow + 辅助函数
 *   coord-patterns.ts     — 坐标模式检测、摘要、应用
 *   prompt-builder.ts     — LLM 提示构建 (分析/微调)
 *   template-generator.ts — 本地模板生成 + 模式检测
 *   llm-client.ts         — LLM 调用 + JSON 解析
 */

import type { RecordingSession, DetectedPattern } from '@/types/recording-session';
import type { AutomationTemplate, TemplateStep, TemplateParameter } from '@/types/automation-template';
import type { DataFlow } from '@/types/unified-data';
import type { IModelService } from '@/interfaces/model-service';
import type { ProviderConfig } from '@/types/provider';

import { getScreenCoord } from './utils';
import { extractDataFlow } from './data-flow';
import {
  detectCoordinatePatterns,
  detectCoordinatePatternsFromTemplate,
  applyCoordinatePatterns,
  removeRedundantClicks,
} from './coord-patterns';
import { buildCombinedPrompt, buildRefinePrompt } from './prompt-builder';
import { callLLM, parseLLMResponse, parseSimpleTemplateResponse } from './llm-client';
import { detectPatternLocally, generateTemplateLocally } from './template-generator';
import type { LLMAnalysisResult, CoordinatePattern } from './types';

// Re-export types for external consumers
export type { LLMAnalysisResult, CoordinatePattern } from './types';

class UnifiedAnalyzer {
  constructor(
    private modelService?: IModelService,
    private provider?: ProviderConfig,
    private apiKey?: string,
  ) {}

  /**
   * 设置 LLM 配置
   */
  configure(modelService: IModelService, provider: ProviderConfig, apiKey: string): void {
    this.modelService = modelService;
    this.provider = provider;
    this.apiKey = apiKey;
  }

  /**
   * 单次 LLM 调用完成分析+生成
   */
  private async analyzeAndGenerateWithLLM(
    session: RecordingSession,
    dataFlow: DataFlow | null,
    callbacks?: {
      onReasoning?: (text: string) => void;
      onProgress?: (text: string) => void;
    },
  ): Promise<AutomationTemplate> {
    // 提前提取坐标规律（LLM 调用前后都需要用）
    const coordPatterns = detectCoordinatePatterns(session.events);

    // 获取屏幕尺寸
    let screenSize = { width: window.screen.width, height: window.screen.height };
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const s = await invoke<{ width: number; height: number }>('get_screen_size');
      if (s?.width && s?.height) screenSize = s;
    } catch { /* use browser fallback */ }

    // 构建组合 prompt
    const prompt = buildCombinedPrompt(session, dataFlow, coordPatterns, screenSize);

    if (!this.modelService || !this.provider || !this.apiKey) {
      throw new Error('LLM not configured');
    }

    // 调用 LLM
    const response = await callLLM(this.modelService, this.provider, this.apiKey, prompt, 600000, callbacks);
    console.log('[UnifiedAnalyzer] LLM raw response length:', response.length);
    console.log('[UnifiedAnalyzer] LLM raw response preview:', response.substring(0, 500));

    // 解析结果
    const result = parseLLMResponse(response);

    // 后处理：将检测到的坐标规律强制应用到 LLM 输出
    if (coordPatterns.size > 0) {
      applyCoordinatePatterns(result, coordPatterns);
      console.log('[UnifiedAnalyzer] applied coordinate patterns:', coordPatterns.size, 'groups');
    }

    // 后处理：删除 desktop_focus_window 后面冗余的窗口切换 click
    removeRedundantClicks(result, screenSize);

    // 构建 pattern
    const pattern: DetectedPattern = {
      type: result.pattern.type,
      confidence: result.pattern.confidence,
      description: result.pattern.description,
      loopVariable: result.pattern.loopVariable || (result.pattern.count !== undefined ? 'index' : undefined),
      loopSource: result.pattern.loopSource || (result.pattern.count !== undefined ? String(result.pattern.count) : undefined),
      dataFlow: dataFlow || undefined,
    };

    return {
      id: crypto.randomUUID(),
      name: session.metadata.userDescription || 'Recorded Template',
      description: pattern.description,
      version: '1.0.0',
      dataFlow: dataFlow || undefined,
      parameters: result.parameters.map(p => ({
        name: p.name,
        description: p.description,
        type: p.type as TemplateParameter['type'],
        required: p.required,
      })),
      steps: result.steps.map((step, index) => ({
        id: `step_${index}`,
        action: step.action,
        description: step.description,
        target: step.target ? {
          semantic: step.target.semantic,
          path: step.target.path,
          coordinate: step.target.coordinate,
        } : undefined,
        waitBefore: step.waitBefore,
        params: step.params,
        control: step.control ? {
          type: step.control.type as TemplateStep['control'] extends { type: infer T } ? T : never,
          over: step.control.over,
          variable: step.control.variable,
          body: step.control.body,
        } : undefined,
      })),
      createdAt: Date.now(),
      sourceSession: session.id,
      llmModel: this.provider?.model,
    };
  }

  /**
   * 多轮对话微调模板
   */
  async refine(
    currentTemplate: AutomationTemplate,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
    userMessage: string,
    callbacks?: {
      onReasoning?: (text: string) => void;
      onProgress?: (text: string) => void;
    },
  ): Promise<AutomationTemplate> {
    if (!this.modelService || !this.provider || !this.apiKey) {
      throw new Error('LLM not configured');
    }

    let screenSize = { width: window.screen.width, height: window.screen.height };
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const s = await invoke<{ width: number; height: number }>('get_screen_size');
      if (s?.width && s?.height) screenSize = s;
    } catch { /* use browser fallback */ }

    const prompt = buildRefinePrompt(currentTemplate, conversationHistory, userMessage, screenSize);

    console.log('[UnifiedAnalyzer] refine — userMessage:', userMessage);
    const response = await callLLM(this.modelService, this.provider, this.apiKey, prompt, 300000, callbacks);
    console.log('[UnifiedAnalyzer] refine — LLM response length:', response.length);

    const result = parseSimpleTemplateResponse(response);

    // 后处理
    const coordPatterns = detectCoordinatePatternsFromTemplate(currentTemplate);
    if (coordPatterns.size > 0) {
      applyCoordinatePatterns(result as LLMAnalysisResult, coordPatterns);
    }
    removeRedundantClicks(result as LLMAnalysisResult, screenSize);

    return {
      id: currentTemplate.id,
      name: result.name || currentTemplate.name,
      description: result.description || currentTemplate.description,
      version: currentTemplate.version,
      dataFlow: currentTemplate.dataFlow,
      parameters: (result.parameters || currentTemplate.parameters).map(p => ({
        name: p.name,
        description: p.description || '',
        type: (p.type as TemplateParameter['type']) || 'string',
        required: p.required ?? false,
      })),
      steps: (result.steps || []).map((step, index) => ({
        id: `step_${index}`,
        action: step.action || 'click',
        description: step.description || '',
        target: step.target ? {
          semantic: step.target.semantic,
          path: step.target.path,
          coordinate: step.target.coordinate,
        } : undefined,
        waitBefore: step.waitBefore,
        params: step.params,
        control: step.control ? {
          type: step.control.type as TemplateStep['control'] extends { type: infer T } ? T : never,
          over: step.control.over,
          variable: step.control.variable,
          body: step.control.body,
        } : undefined,
      })),
      createdAt: currentTemplate.createdAt,
      sourceSession: currentTemplate.sourceSession,
      llmModel: this.provider?.model,
    };
  }

  /**
   * 分析录制会话，生成模板（单次 LLM 调用完成分析+生成）
   */
  async analyze(session: RecordingSession, callbacks?: {
    onReasoning?: (text: string) => void;
    onProgress?: (text: string) => void;
  }): Promise<AutomationTemplate> {
    // 1. 提取数据流
    const dataFlow = extractDataFlow(session.events);

    // 2. 如果配置了 LLM，一次性完成分析+生成
    if (this.modelService && this.provider && this.apiKey) {
      try {
        console.log('[UnifiedAnalyzer] Starting LLM analysis...');
        callbacks?.onProgress?.('正在分析操作模式...');
        const start = Date.now();
        const result = await this.analyzeAndGenerateWithLLM(session, dataFlow, callbacks);
        console.log(`[UnifiedAnalyzer] LLM analysis completed in ${Date.now() - start}ms`);
        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn('[UnifiedAnalyzer] LLM analysis failed, using local fallback:', error);
        callbacks?.onProgress?.(`LLM 分析失败: ${errorMsg}，使用本地分析`);
      }
    } else {
      console.warn('[UnifiedAnalyzer] LLM not configured, using local analysis');
      callbacks?.onProgress?.('未配置 LLM，使用本地分析');
    }

    // 3. 本地回退
    const pattern = detectPatternLocally(session, dataFlow);
    return generateTemplateLocally(session, pattern, dataFlow);
  }
}

// 导出单例
export const unifiedAnalyzer = new UnifiedAnalyzer();
