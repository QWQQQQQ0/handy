// FreeAgent 独立页面 — 全能力 AI 开发者
// 布局：左侧对话区 + 右侧预览区

import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, LoaderCircle, Wrench, CheckCircle, XCircle, Code, Globe, Trash2 } from 'lucide-react';
import { useModelConfigStore } from '@/stores/model-config-store';
import { FreeAgentGateway } from '@/services/free-agent';
import type { AgentProgressEvent } from '@/services/task-agent/runner';
import { useSettingsStore } from '@/stores/settings-store';

interface ToolCallEntry {
  id: string;
  name: string;
  args: Record<string, unknown>;
  success?: boolean;
  message?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCallEntry[];
  timestamp: string;
}

export default function FreeAgentPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [currentToolCalls, setCurrentToolCalls] = useState<ToolCallEntry[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, streamingText, currentToolCalls]);

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isRunning) return;

    setInput('');
    setIsRunning(true);
    setStreamingText('');
    setCurrentToolCalls([]);
    setPreviewHtml(null);
    setPreviewImage(null);

    const abortController = new AbortController();
    abortRef.current = abortController;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    const assistantMsgId = crypto.randomUUID();
    let assistantContent = '';
    const toolCalls: ToolCallEntry[] = [];

    try {
      await useModelConfigStore.getState().load();
      const config = useModelConfigStore.getState().defaultConfig();
      if (!config) {
        setMessages((prev) => [...prev, {
          id: assistantMsgId, role: 'assistant',
          content: '未配置模型，请先在模型设置中添加一个模型。',
          timestamp: new Date().toISOString(),
        }]);
        return;
      }

      const apiKey = await useModelConfigStore.getState().getApiKey(config.id, '');
      if (!apiKey) {
        setMessages((prev) => [...prev, {
          id: assistantMsgId, role: 'assistant',
          content: 'API Key 为空，请在模型设置中配置。',
          timestamp: new Date().toISOString(),
        }]);
        return;
      }

      const { getBuiltinExecutor } = await import('@/skills/builtin-executor');
      const executor = getBuiltinExecutor();
      const gateway = new FreeAgentGateway(executor);

      const response = await gateway.handleUserGoal({
        goal: text,
        provider: config,
        apiKey,
        signal: abortController.signal,
        onProgress: (event: AgentProgressEvent) => {
          switch (event.type) {
            case 'llm_thinking':
              setStreamingText((prev) => prev + (event.text || ''));
              assistantContent += event.text || '';
              break;
            case 'tool_start': {
              const tc: ToolCallEntry = {
                id: crypto.randomUUID(),
                name: event.name,
                args: event.args,
              };
              toolCalls.push(tc);
              setCurrentToolCalls([...toolCalls]);
              break;
            }
            case 'tool_end': {
              const tc = toolCalls.find((t) => t.name === event.name && t.success === undefined);
              if (tc) {
                tc.success = event.success;
                tc.message = event.message;
              }
              setCurrentToolCalls([...toolCalls]);
              break;
            }
          }
        },
      });

      // Extract HTML/image preview from results
      if (response.tasks[0]?.message) {
        const msg = response.tasks[0].message;
        // Check for HTML content
        const htmlMatch = msg.match(/```html\n([\s\S]*?)```/) || msg.match(/<html[\s\S]*?<\/html>/i);
        if (htmlMatch) {
          setPreviewHtml(htmlMatch[1] || htmlMatch[0]);
        }
        // Check for image
        const imgMatch = msg.match(/!\[.*?\]\((data:image\/[^)]+)\)/);
        if (imgMatch) {
          setPreviewImage(imgMatch[1]);
        }
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (errorMsg !== 'AbortError' && !errorMsg.includes('abort')) {
        assistantContent += `\n\n> ⚠️ ${errorMsg}`;
      }
    }

    setStreamingText('');
    setCurrentToolCalls([]);
    setMessages((prev) => [...prev, {
      id: assistantMsgId,
      role: 'assistant',
      content: assistantContent || '任务执行完成',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      timestamp: new Date().toISOString(),
    }]);
    setIsRunning(false);
    abortRef.current = null;
  }, [input, isRunning]);

  const handleStop = () => {
    abortRef.current?.abort();
    setIsRunning(false);
  };

  const clearChat = () => {
    setMessages([]);
    setPreviewHtml(null);
    setPreviewImage(null);
  };

  return (
    <div className="flex h-full">
      {/* ── 左侧：对话区 ── */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-zinc-200 dark:border-zinc-800">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Globe size={18} className="text-purple-500" />
            <span className="font-semibold text-[15px] text-zinc-900 dark:text-zinc-100">FreeAgent</span>
            <span className="text-[11px] text-zinc-400">全能力 AI 开发者</span>
          </div>
          <button
            onClick={clearChat}
            disabled={isRunning}
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-30"
            title="清空对话"
          >
            <Trash2 size={15} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-zinc-400 dark:text-zinc-500 gap-3">
              <Code size={40} className="opacity-30" />
              <div className="text-center">
                <p className="text-[14px] font-medium">FreeAgent — 全能力 AI 开发者</p>
                <p className="text-[12px] mt-1 max-w-md">
                  完整代码执行环境 | Python 完全访问 | 文件系统 | 网络搜索 | Shell 命令
                </p>
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-xl px-4 py-2.5 text-[13px] ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
              }`}>
                <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                    {msg.toolCalls.map((tc) => (
                      <div key={tc.id} className="flex items-center gap-1.5 py-0.5 text-[11px]">
                        {tc.success === undefined
                          ? <LoaderCircle size={10} className="text-zinc-400 animate-spin" />
                          : tc.success
                            ? <CheckCircle size={10} className="text-green-500" />
                            : <XCircle size={10} className="text-red-500" />
                        }
                        <Wrench size={10} className="text-zinc-400" />
                        <span className="font-medium text-zinc-600 dark:text-zinc-400">{tc.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {/* Streaming / tool calls in progress */}
          {(streamingText || currentToolCalls.length > 0) && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-xl px-4 py-2.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">
                {streamingText && (
                  <div className="whitespace-pre-wrap break-words text-[13px]">{streamingText}</div>
                )}
                {currentToolCalls.length > 0 && (
                  <div className="mt-1 pt-1 border-t border-zinc-200 dark:border-zinc-700">
                    {currentToolCalls.map((tc) => (
                      <div key={tc.id} className="flex items-center gap-1.5 py-0.5 text-[11px]">
                        {tc.success === undefined
                          ? <LoaderCircle size={10} className="text-blue-500 animate-spin" />
                          : tc.success
                            ? <CheckCircle size={10} className="text-green-500" />
                            : <XCircle size={10} className="text-red-500" />
                        }
                        <Wrench size={10} className="text-zinc-400" />
                        <span className="text-zinc-600 dark:text-zinc-400">{tc.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 p-3 border-t border-zinc-200 dark:border-zinc-800">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) handleSend(); }}
              placeholder="描述你的需求，如：分析 sales.csv 并画趋势图 / 爬取这个网站的文章列表 / 建一个图书管理数据库..."
              disabled={isRunning}
              className="flex-1 px-3 py-2 text-[13px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:border-purple-500 disabled:opacity-50"
            />
            {isRunning ? (
              <button
                onClick={handleStop}
                className="px-4 py-2 rounded-lg bg-red-500 text-white text-[13px] font-medium hover:bg-red-600 flex items-center gap-1"
              >
                <XCircle size={14} /> 停止
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="px-4 py-2 rounded-lg bg-purple-600 text-white text-[13px] font-medium hover:bg-purple-700 disabled:opacity-40 flex items-center gap-1"
              >
                <Send size={14} /> 发送
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── 右侧：预览区 ── */}
      <div className="w-[40%] min-w-[300px] flex flex-col bg-white dark:bg-zinc-950">
        <div className="shrink-0 px-4 py-2 border-b border-zinc-100 dark:border-zinc-800">
          <span className="text-[13px] font-medium text-zinc-600 dark:text-zinc-400">预览</span>
        </div>
        <div className="flex-1 overflow-hidden">
          {previewHtml ? (
            <iframe
              srcDoc={previewHtml}
              sandbox="allow-scripts allow-same-origin"
              className="w-full h-full border-0"
              title="Preview"
            />
          ) : previewImage ? (
            <div className="flex items-center justify-center h-full p-4">
              <img src={previewImage} alt="Preview" className="max-w-full max-h-full object-contain rounded-lg" />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-400 dark:text-zinc-600 text-[13px]">
              HTML 输出或图片将在此预览
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
