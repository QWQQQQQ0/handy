// 来源: lib/widgets/chat/message_input.dart

'use client';

import { useState, useRef, useCallback, useEffect, useMemo, ChangeEvent } from 'react';
import { ImageIcon, ArrowUp, X, Bot, Music, Paperclip, BookOpen, Pin } from 'lucide-react';
import { useSkillStore } from '@/stores/skill-store';
import type { MessageContent, ContentPart } from '@/types/message';
import type { SemanticAnnotation } from '@/types/cache';
import { compressImage } from '@/utils/image';
import type { CompressedImage } from '@/utils/image';
import { getCacheService } from '@/services/cache-service-singleton';
import { PageKnowledgeService } from '@/services/page-knowledge';

export interface AudioFile {
  dataUrl: string;
  name: string;
}

export interface FileAttachment {
  name: string;
  /** 文件完整路径 */
  path: string;
}

export function buildUserContent(
  text: string,
  images: CompressedImage[],
  audios?: AudioFile[],
  files?: FileAttachment[],
): MessageContent {
  const hasImages = images.length > 0;
  const hasAudios = audios && audios.length > 0;
  const hasFiles = files && files.length > 0;
  if (!hasImages && !hasAudios && !hasFiles) return text;

  const parts: ContentPart[] = [];
  if (text) {
    parts.push({ type: 'text', text });
  }
  // File paths — LLM 通过 read_file 按需读取
  if (hasFiles) {
    for (const file of files!) {
      parts.push({
        type: 'text',
        text: `\n[File: ${file.path}]`,
      });
    }
  }
  for (const img of images) {
    parts.push({ type: 'image_url', image_url: { url: img.dataUrl } });
  }
  if (audios) {
    for (const a of audios) {
      parts.push({ type: 'input_audio', input_audio: { data: a.dataUrl } });
    }
  }
  return parts as MessageContent;
}

function ImagePreview({ dataUrl, onRemove }: { dataUrl: string; onRemove: () => void }) {
  return (
    <div className="relative shrink-0 rounded-lg overflow-hidden w-12 h-12">
      <img
        src={dataUrl}
        alt="Preview"
        className="w-full h-full object-cover"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
      <button
        onClick={onRemove}
        className="absolute top-0 right-0 w-4 h-4 flex items-center justify-center bg-black/50 text-white rounded-bl"
      >
        <X size={10} />
      </button>
    </div>
  );
}

function AudioPreview({ audio, onRemove }: { audio: AudioFile; onRemove: () => void }) {
  return (
    <div className="relative shrink-0 rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-800 h-10 flex items-center justify-center gap-1 px-2">
      <Music size={12} className="text-purple-500 shrink-0" />
      <span className="text-[10px] text-zinc-600 dark:text-zinc-400 truncate max-w-[80px]" title={audio.name}>
        {audio.name.length > 10 ? audio.name.slice(0, 8) + '...' : audio.name}
      </span>
      <button
        onClick={onRemove}
        className="absolute top-0 right-0 w-4 h-4 flex items-center justify-center bg-black/50 text-white rounded-bl"
      >
        <X size={10} />
      </button>
    </div>
  );
}

function FilePreview({ file, onRemove }: { file: FileAttachment; onRemove: () => void }) {
  return (
    <div className="relative shrink-0 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center gap-2 pl-2 pr-6 py-1.5 w-full max-w-[240px]">
      <Paperclip size={12} className="text-blue-500 shrink-0" />
      <div className="flex-1 min-w-0 text-[11px] font-medium text-zinc-700 dark:text-zinc-300 truncate" title={file.path}>
        {file.path}
      </div>
      <button
        onClick={onRemove}
        className="absolute top-0.5 right-0.5 w-4 h-4 flex items-center justify-center bg-black/50 text-white rounded-bl"
      >
        <X size={10} />
      </button>
    </div>
  );
}

interface AgentInfo {
  appName: string;
  pageCount: number;
  isCustomAgent?: boolean;
  isBuiltin?: boolean;
  agentId?: string;
  /** 知识型技能（区别于 Agent） */
  isKnowledgeSkill?: boolean;
}

interface MessageInputProps {
  onSend: (content: MessageContent, agentContext?: string) => void;
  onAgentSelect?: (agentName: string | null) => void;
  /** 长效 @ 选择（持久化到下次发送） */
  stickyAgent?: { context: string; label: string } | null;
  onClearStickyAgent?: () => void;
  enabled?: boolean;
  hintText?: string;
  allowImagePaste?: boolean;
  allowFileUpload?: boolean;
  compact?: boolean;
  onStop?: () => void;
  /** @ 下拉过滤：'all' 显示全部，'knowledge' 仅显示知识型 skill */
  agentTypes?: 'all' | 'knowledge';
}

async function processImageFiles(files: FileList | File[]): Promise<CompressedImage[]> {
  const results: CompressedImage[] = [];
  const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
  for (const file of arr) {
    if (file.size > 20 * 1024 * 1024) continue;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
    try {
      const compressed = await compressImage(dataUrl);
      results.push(compressed);
    } catch { /* skip */ }
  }
  return results;
}

async function processAudioFiles(files: FileList | File[]): Promise<AudioFile[]> {
  const results: AudioFile[] = [];
  const arr = Array.from(files).filter((f) => f.type.startsWith('audio/'));
  for (const file of arr) {
    if (file.size > 50 * 1024 * 1024) continue; // 50 MB limit
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
    results.push({ dataUrl, name: file.name });
  }
  return results;
}

const MAX_FILE_COUNT = 5;

async function pickFiles(): Promise<FileAttachment[]> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    multiple: true,
    title: '选择文件',
  });
  if (!selected) return [];

  const rawPaths = Array.isArray(selected) ? selected : [selected];
  return rawPaths
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .map((filePath) => ({
      name: filePath.replace(/^.*[\\/]/, ''),
      path: filePath,
    }));
}

export function MessageInput({ onSend, onAgentSelect, enabled = true, hintText = '发送消息...', allowImagePaste = true, allowFileUpload = true, compact = false, onStop, agentTypes = 'all', stickyAgent, onClearStickyAgent }: MessageInputProps) {
  const [text, setText] = useState('');
  const [pendingImages, setPendingImages] = useState<CompressedImage[]>([]);
  const [pendingAudios, setPendingAudios] = useState<AudioFile[]>([]);
  const [pendingFiles, setPendingFiles] = useState<FileAttachment[]>([]);
  const [minHeight, setMinHeight] = useState(() => {
    const saved = localStorage.getItem('msg_input_height');
    return saved ? Math.max(40, Math.min(400, Number(saved))) : 60;
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragStartY = useRef(0);
  const dragStartH = useRef(0);

  // Agent @ mention
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [showAgentDropdown, setShowAgentDropdown] = useState(false);
  const [agentFilter, setAgentFilter] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<AgentInfo | null>(null);
  const [agentContext, setAgentContext] = useState<string | undefined>();

  // Load agents on mount (cached apps + custom agents)
  useEffect(() => {
    const loadAgents = async () => {
      // Load cached app agents
      const rows = await getCacheService().getAllUICacheRows();
      const byApp = new Map<string, number>();
      for (const row of rows) {
        byApp.set(row.app_name, (byApp.get(row.app_name) ?? 0) + 1);
      }
      const list: AgentInfo[] = [];
      for (const [appName, pageCount] of byApp) {
        list.push({ appName, pageCount });
      }

      // Add built-in agents
      const builtinAgents = [
        { appName: 'computeruse', pageCount: 0, isBuiltin: true as const },
        { appName: 'web', pageCount: 0, isBuiltin: true as const },
        { appName: 'document', pageCount: 0, isBuiltin: true as const },
        { appName: 'code', pageCount: 0, isBuiltin: true as const },
      ];
      for (const ba of builtinAgents) {
        if (!byApp.has(ba.appName)) {
          list.push({ appName: ba.appName, pageCount: 0, isBuiltin: true });
        }
      }

      // Load custom user agents
      try {
        const { useAgentStore } = await import('@/stores/agent-store');
        const agentStore = useAgentStore.getState();
        if (!agentStore.loaded) await agentStore.load();
        for (const agent of agentStore.getEnabledAgents()) {
          list.push({ appName: agent.name, pageCount: 0, isCustomAgent: true, agentId: agent.id });
        }
      } catch { /* agent-store not available */ }

      // 知识型技能由 zustand 订阅实时更新，不在此缓存

      list.sort((a, b) => b.pageCount - a.pageCount);
      setAgents(list);
    };
    loadAgents();
  }, []);

  // Auto-grow textarea when content changes
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(minHeight, ta.scrollHeight)}px`;
  }, [text, minHeight]);

  // Detect @ trigger
  const handleTextChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    // Find @ in the text (last occurrence before cursor)
    const lastAt = val.lastIndexOf('@');
    if (lastAt >= 0 && lastAt === val.length - 1 || (lastAt >= 0 && !val.slice(lastAt).includes(' '))) {
      const filter = val.slice(lastAt + 1).toLowerCase();
      setAgentFilter(filter);
      setShowAgentDropdown(true);
    } else {
      setShowAgentDropdown(false);
    }
  }, []);

  const showRegularAgents = agentTypes !== 'knowledge';
  const filteredAgents = showRegularAgents ? agents.filter(a => !a.isKnowledgeSkill && a.appName.toLowerCase().includes(agentFilter)) : [];
  // 知识型技能：从 store 订阅，按来源分组
  const storeKnowledge = useSkillStore(s => s.knowledgeSkills);
  const filteredKnowledgeBySource = useMemo(() => {
    const filtered = storeKnowledge.filter(ks => ks.name.toLowerCase().includes(agentFilter));
    const groups = new Map<string, Array<{ appName: string; pageCount: number; isKnowledgeSkill: true; description: string }>>();
    for (const ks of filtered) {
      const src = ks.sourceLabel || '其他';
      if (!groups.has(src)) groups.set(src, []);
      groups.get(src)!.push({ appName: ks.name, pageCount: 0, isKnowledgeSkill: true, description: ks.description });
    }
    return groups;
  }, [storeKnowledge, agentFilter]);

  const selectAgent = useCallback(async (agent: AgentInfo) => {
    setSelectedAgent(agent);
    setShowAgentDropdown(false);
    // Remove @... from text
    const lastAt = text.lastIndexOf('@');
    if (lastAt >= 0) {
      setText(text.slice(0, lastAt));
    }
    // 知识技能来源分组：全组注入 LLM
    if (agent.isKnowledgeSkill && agent.agentId?.startsWith('__src__')) {
      setAgentContext(`knowledge_source:${agent.appName}`);
      onAgentSelect?.(agent.appName);
      return;
    }
    // 单个知识技能
    if (agent.isKnowledgeSkill) {
      setAgentContext(`knowledge_skill:${agent.appName}`);
      onAgentSelect?.(agent.appName);
      return;
    }
    // Custom / builtin agent: pass name as context prefix for direct routing
    if (agent.isCustomAgent || agent.isBuiltin) {
      setAgentContext(`custom_agent:${agent.appName}`);
      onAgentSelect?.(agent.appName);
      return;
    }
    // App agent: build page capability context
    try {
      const cache = getCacheService();
      const pageKnowledge = new PageKnowledgeService(cache);
      const pages = await pageKnowledge.getAppPageGraph(agent.appName);
      if (pages.length > 0) {
        const lines = pages.flatMap(p => p.capabilities.length > 0
          ? [`[${p.name}]`, ...p.capabilities.map(c => `  - ${c}`)]
          : [`[${p.name}]`]
        );
        setAgentContext(`Agent "${agent.appName}" 的页面能力：\n${lines.join('\n')}`);
      }
    } catch { /* non-critical */ }
  }, [text]);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStartY.current = e.clientY;
    dragStartH.current = minHeight;
    const onMove = (ev: MouseEvent) => {
      const newH = Math.max(40, Math.min(400, dragStartH.current - (ev.clientY - dragStartY.current)));
      setMinHeight(newH);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setMinHeight((h) => { localStorage.setItem('msg_input_height', String(h)); return h; });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [minHeight]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && pendingImages.length === 0 && pendingAudios.length === 0 && pendingFiles.length === 0) return;
    if (!enabled) return;

    const content = buildUserContent(trimmed, pendingImages, pendingAudios, pendingFiles);
    onSend(content, agentContext);
    setText('');
    setPendingImages([]);
    setPendingAudios([]);
    setPendingFiles([]);
    setSelectedAgent(null);
    setAgentContext(undefined);
    onAgentSelect?.(null);
  }, [text, pendingImages, pendingAudios, pendingFiles, enabled, onSend, agentContext]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const imageResults = await processImageFiles(files);
    const audioResults = await processAudioFiles(files);
    setPendingImages((prev) => [...prev, ...imageResults]);
    setPendingAudios((prev) => [...prev, ...audioResults]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileUploadClick = useCallback(async () => {
    if (!enabled) return;
    const fileResults = await pickFiles();
    setPendingFiles((prev) => [...prev, ...fileResults].slice(0, MAX_FILE_COUNT));
  }, [enabled]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!allowImagePaste) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    const audioFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const file = items[i].getAsFile();
      if (file && file.type.startsWith('image/')) {
        imageFiles.push(file);
      } else if (file && file.type.startsWith('audio/')) {
        audioFiles.push(file);
      }
    }
    if (imageFiles.length === 0 && audioFiles.length === 0) return;
    e.preventDefault();
    Promise.all([
      processImageFiles(imageFiles).then((results) => {
        setPendingImages((prev) => [...prev, ...results]);
      }),
      processAudioFiles(audioFiles).then((results) => {
        setPendingAudios((prev) => [...prev, ...results]);
      }),
    ]);
  }, [allowImagePaste]);

  const removeImage = (index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  };

  const removeFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-black px-3 pt-2 pb-3">
      {/* Drag handle — hidden in compact mode */}
      {!compact && (
        <div
          className="flex justify-center pb-1 cursor-ns-resize group"
          onMouseDown={onDragStart}
          title="Drag to resize"
        >
          <div className="w-8 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600 group-hover:bg-zinc-400 dark:group-hover:bg-zinc-500 transition-colors" />
        </div>
      )}

      {pendingImages.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {pendingImages.map((img, i) => (
            <ImagePreview key={`img-${i}`} dataUrl={img.dataUrl} onRemove={() => removeImage(i)} />
          ))}
        </div>
      )}

      {pendingAudios.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {pendingAudios.map((audio, i) => (
            <AudioPreview key={`audio-${i}`} audio={audio} onRemove={() => setPendingAudios((prev) => prev.filter((_, j) => j !== i))} />
          ))}
        </div>
      )}

      {pendingFiles.length > 0 && (
        <div className="flex flex-col gap-1 mb-2">
          {pendingFiles.map((file, i) => (
            <FilePreview key={`file-${i}`} file={file} onRemove={() => removeFile(i)} />
          ))}
        </div>
      )}

      {/* Agent @ dropdown */}
      {(filteredAgents.length > 0 || filteredKnowledgeBySource.size > 0) && showAgentDropdown && (
        <div className="mb-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg max-h-[240px] overflow-y-auto">
          {/* Agent 区 */}
          {filteredAgents.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Agent</div>
              {filteredAgents.slice(0, 8).map(agent => (
                <button
                  key={agent.appName}
                  onClick={() => selectAgent(agent)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left"
                >
                  <Bot size={14} className={agent.isCustomAgent ? 'text-purple-500 shrink-0' : agent.isBuiltin ? 'text-blue-500 shrink-0' : 'text-blue-400 shrink-0'} />
                  <span className="truncate">{agent.appName}</span>
                  <span className="text-xs text-zinc-400 ml-auto shrink-0">{agent.isBuiltin ? '内置' : agent.isCustomAgent ? 'Agent' : `${agent.pageCount} 页`}</span>
                </button>
              ))}
            </>
          )}
          {/* 知识技能区（只显示分组，选中后全组注入 LLM） */}
          {filteredKnowledgeBySource.size > 0 && [...filteredKnowledgeBySource.entries()].map(([sourceLabel, skills]) => (
            <button
              key={`ksrc-${sourceLabel}`}
              onClick={() => selectAgent({ appName: sourceLabel, pageCount: skills.length, isKnowledgeSkill: true, agentId: `__src__${sourceLabel}` })}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-emerald-50 dark:hover:bg-emerald-950 text-left border-t border-zinc-100 dark:border-zinc-800"
            >
              <BookOpen size={14} className="text-emerald-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <span className="truncate block font-medium">{sourceLabel}</span>
                <span className="text-[10px] text-zinc-400 truncate block">{skills.length} 个知识技能</span>
              </div>
              <span className="text-xs text-zinc-400 ml-auto shrink-0">组</span>
            </button>
          ))}
        </div>
      )}

      {/* Selected agent badge (current @ typing) */}
      {selectedAgent && (
        <div className={`mb-2 flex items-center gap-1.5 px-2 py-1 rounded-md text-xs w-fit ${
          selectedAgent.isKnowledgeSkill
            ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
            : 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
        }`}>
          {selectedAgent.isKnowledgeSkill ? <BookOpen size={12} /> : <Bot size={12} />}
          <span>{selectedAgent.appName}</span>
          <button onClick={() => { setSelectedAgent(null); setAgentContext(undefined); onAgentSelect?.(null); }} className="hover:text-blue-900">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Sticky agent badge (长效保持，跨消息持久) */}
      {stickyAgent && !selectedAgent && (
        <div className="mb-2 flex items-center gap-1.5 px-2 py-1 rounded-md text-xs w-fit bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">
          <Pin size={12} />
          <span>@{stickyAgent.label}</span>
          <button onClick={onClearStickyAgent} className="hover:text-violet-900 dark:hover:text-violet-200" title="取消长效 @">
            <X size={12} />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-0.5 shrink-0">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!enabled}
            className="p-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40"
            title="上传图片/音频"
          >
            <ImageIcon size={16} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,audio/*"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />

          {allowFileUpload && (
            <button
              onClick={handleFileUploadClick}
              disabled={!enabled}
              className="p-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40"
              title="上传文件"
            >
              <Paperclip size={16} />
            </button>
          )}
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={!enabled}
          placeholder={hintText}
          rows={1}
          className="flex-1 resize-none rounded-2xl bg-zinc-100 dark:bg-zinc-800 px-4 py-2.5 text-[14px] text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none disabled:opacity-40 overflow-y-auto"
        />

        {!enabled && onStop ? (
          <button
            onClick={onStop}
            className="p-2.5 rounded-full bg-red-600 text-white hover:bg-red-700 shrink-0"
            title="停止"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!enabled || (!text.trim() && pendingImages.length === 0 && pendingAudios.length === 0 && pendingFiles.length === 0)}
            className="p-2.5 rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 shrink-0"
          >
            <ArrowUp size={20} />
          </button>
        )}
      </div>
    </div>
  );
}
