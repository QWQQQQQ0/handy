// 来源: lib/widgets/chat/chat_bubble.dart

'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronUp, Loader2, AlertCircle, Music, Trash2, Pencil, Check, X } from 'lucide-react';
import type { ChatMessage } from '@/types/message';
import { MarkdownBody } from './markdown-body';
import { StreamingText } from './streaming-text';
import { extractBbox, BboxOverlay } from '@/components/bbox-overlay';

function extractUserImage(message: ChatMessage): string | null {
  const content = message.content;
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    if (
      typeof part === 'object' &&
      part !== null &&
      'type' in part &&
      part.type === 'image_url' &&
      'image_url' in part &&
      part.image_url
    ) {
      return (part.image_url as { url: string }).url;
    }
  }
  return null;
}

function ImageFromUrl({ url }: { url: string }) {
  return (
    <img
      src={url}
      alt="Attached"
      className="rounded-lg object-cover w-[200px] h-[200px]"
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = 'none';
      }}
    />
  );
}

function ToolBubble({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const contentStr = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);

  let label = 'TOOL RESULT';
  let colorClass = 'border-zinc-400 text-zinc-600 dark:text-zinc-400';
  let bgClass = 'bg-zinc-50 dark:bg-zinc-900';

  if ((message.role as string) === 'tool_call') {
    label = 'TOOL CALL';
    colorClass = 'border-purple-500 text-purple-600 dark:text-purple-400';
    bgClass = 'bg-purple-50 dark:bg-purple-950';
  } else {
    try {
      const json = JSON.parse(contentStr);
      if (json && json['success'] === true) {
        label = 'TOOL OK';
        colorClass = 'border-green-500 text-green-600 dark:text-green-400';
        bgClass = 'bg-green-50 dark:bg-green-950';
      } else if (json && json['success'] === false) {
        label = 'TOOL FAIL';
        colorClass = 'border-red-500 text-red-600 dark:text-red-400';
        bgClass = 'bg-red-50 dark:bg-red-950';
      }
    } catch { /* not JSON */ }
  }

  const preview = contentStr.length > 100 ? `${contentStr.substring(0, 100)}...` : contentStr;

  let formattedContent = contentStr;
  try {
    formattedContent = JSON.stringify(JSON.parse(contentStr), null, 2);
  } catch { /* use raw */ }

  return (
    <div className="px-4 py-1">
      <div className={`border-l-4 ${colorClass} rounded-r-md ${bgClass}`}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-3 py-2 flex items-center gap-2 text-left rounded-r-md"
        >
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider ${colorClass} bg-black/5 dark:bg-white/5`}>
            {label}
          </span>
          <span className="flex-1 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 truncate">
            {preview}
          </span>
          {expanded ? <ChevronUp size={14} className="text-zinc-400 shrink-0" /> : <ChevronDown size={14} className="text-zinc-400 shrink-0" />}
        </button>
        {expanded && (
          <pre className="px-3 pb-2 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap leading-relaxed overflow-x-auto">
            {formattedContent}
          </pre>
        )}
      </div>
    </div>
  );
}

// ── Edit mode for user messages ──

function EditableContent({
  initialContent,
  onSave,
  onCancel,
}: {
  initialContent: string;
  onSave: (content: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialContent);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(value.length, value.length);
    }
  }, []);

  return (
    <div className="flex flex-col gap-2 w-full">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-300 dark:border-zinc-600 rounded-lg px-3 py-2 text-[14px] leading-relaxed resize-y min-h-[60px] focus:outline-none focus:ring-2 focus:ring-blue-500"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSave(value); }
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="flex gap-1.5 self-end">
        <button onClick={onCancel} className="p-1.5 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors" title="取消">
          <X size={14} className="text-zinc-500" />
        </button>
        <button onClick={() => onSave(value)} className="p-1.5 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors" title="保存">
          <Check size={14} className="text-blue-600" />
        </button>
      </div>
    </div>
  );
}

// ── Hover action bar ──

function MessageActions({
  message,
  onDelete,
  onEdit,
  onEditStart,
}: {
  message: ChatMessage;
  onDelete?: (id: string) => void;
  onEdit?: (id: string, content: string) => void;
  onEditStart?: () => void;
}) {
  const canEdit = message.role === 'user' && typeof message.content === 'string' && message.status === 'done';
  const canDelete = message.status === 'done' || message.status === 'error';

  if (!canEdit && !canDelete) return null;

  return (
    <div className="flex items-center gap-0.5">
      {canEdit && onEditStart && (
        <button
          onClick={(e) => { e.stopPropagation(); onEditStart(); }}
          className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          title="编辑"
        >
          <Pencil size={12} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" />
        </button>
      )}
      {canDelete && onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(message.id); }}
          className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
          title="删除"
        >
          <Trash2 size={12} className="text-zinc-400 hover:text-red-500" />
        </button>
      )}
    </div>
  );
}

// ── User Bubble ──

function UserBubble({
  message,
  onDelete,
  onEdit,
}: {
  message: ChatMessage;
  onDelete?: (id: string) => void;
  onEdit?: (id: string, content: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const content = message.content;

  if (editing && typeof content === 'string') {
    return (
      <div className="flex justify-end px-3 py-1.5">
        <div className="max-w-[82%]">
          <EditableContent
            initialContent={content}
            onSave={(newContent) => {
              onEdit?.(message.id, newContent);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      </div>
    );
  }

  if (Array.isArray(content)) {
    return (
      <div
        className="flex flex-col items-end px-3 py-1.5"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="max-w-[82%] bg-blue-600 text-white rounded-2xl rounded-br-md px-3 py-2">
          {content.map((part, i) => {
            if ('type' in part && part.type === 'image_url' && 'image_url' in part && part.image_url) {
              return (
                <div key={i} className="mb-2 last:mb-0">
                  <ImageFromUrl url={(part.image_url as { url: string }).url} />
                </div>
              );
            }
            if ('type' in part && part.type === 'input_audio' && 'input_audio' in part && part.input_audio) {
              const audio = part.input_audio as { data: string };
              return (
                <div key={i} className="mb-2 last:mb-0">
                  <audio controls className="w-full max-w-[280px] h-8" src={audio.data}>
                    <track kind="captions" />
                  </audio>
                </div>
              );
            }
            if ('type' in part && part.type === 'text' && 'text' in part) {
              return <p key={i} className="text-[14px] leading-relaxed">{part.text as string}</p>;
            }
            return null;
          })}
        </div>
        <div className={`flex items-center gap-0.5 mt-0.5 transition-opacity duration-150 ${hovered ? 'opacity-100' : 'opacity-0'}`}>
          <MessageActions message={message} onDelete={onDelete} onEdit={onEdit} onEditStart={() => setEditing(true)} />
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-end px-3 py-1.5"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="max-w-[82%] bg-blue-600 text-white rounded-2xl rounded-br-md px-3 py-2">
        <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{String(content)}</p>
      </div>
      <div className={`flex items-center gap-0.5 mt-0.5 transition-opacity duration-150 ${hovered ? 'opacity-100' : 'opacity-0'}`}>
        <MessageActions message={message} onDelete={onDelete} onEdit={onEdit} onEditStart={() => setEditing(true)} />
      </div>
    </div>
  );
}

// ── Thinking Block ──

function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-2 border-l-2 border-amber-300 dark:border-amber-600 pl-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[12px] text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
      >
        <span className="font-medium">💭 思考过程</span>
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {expanded && (
        <div className="mt-1.5 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap font-mono max-h-[400px] overflow-y-auto">
          {content}
        </div>
      )}
    </div>
  );
}

// ── Assistant Bubble ──

function AssistantBubble({
  message,
  userImage,
}: {
  message: ChatMessage;
  userImage?: string | null;
}) {
  const content = message.content;
  const text = typeof content === 'string' ? content : '';
  const isStreaming = message.status === 'streaming';
  const bbox = !isStreaming && userImage ? extractBbox(text) : null;

  return (
    <div className="flex justify-start px-3 py-1.5">
      <div className="max-w-[82%] bg-zinc-100 dark:bg-zinc-800 rounded-2xl rounded-bl-md px-3 py-2">
        {message.reasoning_content && (
          <ThinkingBlock content={message.reasoning_content} />
        )}
        {isStreaming ? (
          <StreamingText text={text} isStreaming={isStreaming} />
        ) : (
          <MarkdownBody content={text} />
        )}
        {bbox && (
          <BboxOverlay imageUrl={userImage!} bbox={bbox} />
        )}
        {message.status === 'streaming' && (
          <Loader2 size={12} className="mt-1 animate-spin text-blue-500" />
        )}
        {message.status === 'error' && (
          <AlertCircle size={14} className="mt-1 text-red-500" />
        )}
      </div>
    </div>
  );
}

// ── Main Export ──

export function ChatBubble({
  message,
  previousMessage,
  onDelete,
  onEdit,
}: {
  message: ChatMessage;
  previousMessage?: ChatMessage;
  onDelete?: (id: string) => void;
  onEdit?: (id: string, content: string) => void;
}) {
  // Hide internal messages (system-injected screenshots)
  if (message._internal) return null;

  if (message.role === 'tool' || (message.role as string) === 'tool_call') {
    return <ToolBubble message={message} />;
  }

  if (message.role === 'user') {
    return <UserBubble message={message} onDelete={onDelete} onEdit={onEdit} />;
  }

  const userImage = previousMessage ? extractUserImage(previousMessage) : null;
  return <AssistantBubble message={message} userImage={userImage} />;
}
