// 来源: lib/widgets/chat/message_input.dart

'use client';

import { useState, useRef, useCallback, useEffect, ChangeEvent } from 'react';
import { ImageIcon, ArrowUp, X, Bot, Music } from 'lucide-react';
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

export function buildUserContent(
  text: string,
  images: CompressedImage[],
  audios?: AudioFile[],
): MessageContent {
  const hasImages = images.length > 0;
  const hasAudios = audios && audios.length > 0;
  if (!hasImages && !hasAudios) return text;

  const parts: ContentPart[] = [];
  if (text) {
    parts.push({ type: 'text', text });
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
    <div className="relative shrink-0 rounded-lg overflow-hidden w-16 h-16">
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
        className="absolute top-0 right-0 w-5 h-5 flex items-center justify-center bg-black/50 text-white rounded-bl"
      >
        <X size={12} />
      </button>
    </div>
  );
}

function AudioPreview({ audio, onRemove }: { audio: AudioFile; onRemove: () => void }) {
  return (
    <div className="relative shrink-0 rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-800 w-32 h-16 flex items-center justify-center gap-1 px-2">
      <Music size={14} className="text-purple-500 shrink-0" />
      <span className="text-[11px] text-zinc-600 dark:text-zinc-400 truncate flex-1" title={audio.name}>
        {audio.name.length > 12 ? audio.name.slice(0, 10) + '...' : audio.name}
      </span>
      <button
        onClick={onRemove}
        className="absolute top-0 right-0 w-5 h-5 flex items-center justify-center bg-black/50 text-white rounded-bl"
      >
        <X size={12} />
      </button>
    </div>
  );
}

interface AgentInfo {
  appName: string;
  pageCount: number;
}

interface MessageInputProps {
  onSend: (content: MessageContent, agentContext?: string) => void;
  enabled?: boolean;
  hintText?: string;
  allowImagePaste?: boolean;
  onStop?: () => void;
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

export function MessageInput({ onSend, enabled = true, hintText = '发送消息...', allowImagePaste = true, onStop }: MessageInputProps) {
  const [text, setText] = useState('');
  const [pendingImages, setPendingImages] = useState<CompressedImage[]>([]);
  const [pendingAudios, setPendingAudios] = useState<AudioFile[]>([]);
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

  // Load agents on mount
  useEffect(() => {
    getCacheService().getAllUICacheRows().then(rows => {
      const byApp = new Map<string, number>();
      for (const row of rows) {
        byApp.set(row.app_name, (byApp.get(row.app_name) ?? 0) + 1);
      }
      const list: AgentInfo[] = [];
      for (const [appName, pageCount] of byApp) {
        list.push({ appName, pageCount });
      }
      list.sort((a, b) => b.pageCount - a.pageCount);
      setAgents(list);
    });
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

  const filteredAgents = agents.filter(a => a.appName.toLowerCase().includes(agentFilter));

  const selectAgent = useCallback(async (agent: AgentInfo) => {
    setSelectedAgent(agent);
    setShowAgentDropdown(false);
    // Remove @... from text
    const lastAt = text.lastIndexOf('@');
    if (lastAt >= 0) {
      setText(text.slice(0, lastAt));
    }
    // Build agent context
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
    if (!trimmed && pendingImages.length === 0 && pendingAudios.length === 0) return;
    if (!enabled) return;

    const content = buildUserContent(trimmed, pendingImages, pendingAudios);
    onSend(content, agentContext);
    setText('');
    setPendingImages([]);
    setPendingAudios([]);
    setSelectedAgent(null);
    setAgentContext(undefined);
  }, [text, pendingImages, pendingAudios, enabled, onSend, agentContext]);

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

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-black px-3 pt-2 pb-3">
      {/* Drag handle */}
      <div
        className="flex justify-center pb-1 cursor-ns-resize group"
        onMouseDown={onDragStart}
        title="Drag to resize"
      >
        <div className="w-8 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600 group-hover:bg-zinc-400 dark:group-hover:bg-zinc-500 transition-colors" />
      </div>

      {pendingImages.length > 0 && (
        <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
          {pendingImages.map((img, i) => (
            <ImagePreview key={`img-${i}`} dataUrl={img.dataUrl} onRemove={() => removeImage(i)} />
          ))}
        </div>
      )}

      {pendingAudios.length > 0 && (
        <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
          {pendingAudios.map((audio, i) => (
            <AudioPreview key={`audio-${i}`} audio={audio} onRemove={() => setPendingAudios((prev) => prev.filter((_, j) => j !== i))} />
          ))}
        </div>
      )}

      {/* Agent @ dropdown */}
      {showAgentDropdown && filteredAgents.length > 0 && (
        <div className="mb-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg max-h-[200px] overflow-y-auto">
          {filteredAgents.slice(0, 10).map(agent => (
            <button
              key={agent.appName}
              onClick={() => selectAgent(agent)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left"
            >
              <Bot size={14} className="text-blue-500 shrink-0" />
              <span className="truncate">{agent.appName}</span>
              <span className="text-xs text-zinc-400 ml-auto shrink-0">{agent.pageCount} 页</span>
            </button>
          ))}
        </div>
      )}

      {/* Selected agent badge */}
      {selectedAgent && (
        <div className="mb-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs w-fit">
          <Bot size={12} />
          <span>{selectedAgent.appName}</span>
          <button onClick={() => { setSelectedAgent(null); setAgentContext(undefined); }} className="hover:text-blue-900">
            <X size={12} />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!enabled}
          className="p-2 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 shrink-0"
          title="上传图片/音频"
        >
          <ImageIcon size={20} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,audio/*"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

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
            disabled={!enabled || (!text.trim() && pendingImages.length === 0 && pendingAudios.length === 0)}
            className="p-2.5 rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 shrink-0"
          >
            <ArrowUp size={20} />
          </button>
        )}
      </div>
    </div>
  );
}
