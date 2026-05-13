// 来源: lib/widgets/chat/message_input.dart

'use client';

import { useState, useRef, useCallback, ChangeEvent } from 'react';
import { ImageIcon, ArrowUp, X } from 'lucide-react';
import type { MessageContent } from '@/types/message';
import { compressImage } from '@/utils/image';
import type { CompressedImage } from '@/utils/image';

export function buildUserContent(
  text: string,
  images: CompressedImage[],
): MessageContent {
  if (images.length === 0) return text;

  const sizeInfo = images
    .map((img) => `${img.originalWidth}x${img.originalHeight}`)
    .join(', ');
  const prefix = `[原始图片尺寸: ${sizeInfo}] `;

  const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: 'text', text: prefix + (text || '请描述这张图片') },
  ];
  for (const img of images) {
    parts.push({ type: 'image_url', image_url: { url: img.dataUrl } });
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

interface MessageInputProps {
  onSend: (content: MessageContent) => void;
  enabled?: boolean;
  hintText?: string;
  allowImagePaste?: boolean;
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

export function MessageInput({ onSend, enabled = true, hintText = '发送消息...', allowImagePaste = true }: MessageInputProps) {
  const [text, setText] = useState('');
  const [pendingImages, setPendingImages] = useState<CompressedImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && pendingImages.length === 0) return;
    if (!enabled) return;

    const content = buildUserContent(trimmed, pendingImages);
    onSend(content);
    setText('');
    setPendingImages([]);
  }, [text, pendingImages, enabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const results = await processImageFiles(files);
    setPendingImages((prev) => [...prev, ...results]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!allowImagePaste) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const file = items[i].getAsFile();
      if (file && file.type.startsWith('image/')) {
        imageFiles.push(file);
      }
    }
    if (imageFiles.length === 0) return; // No images, let default paste work for text
    e.preventDefault();
    processImageFiles(imageFiles).then((results) => {
      setPendingImages((prev) => [...prev, ...results]);
    });
  }, [allowImagePaste]);

  const removeImage = (index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-black px-3 pt-2 pb-3">
      {pendingImages.length > 0 && (
        <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
          {pendingImages.map((img, i) => (
            <ImagePreview key={i} dataUrl={img.dataUrl} onRemove={() => removeImage(i)} />
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!enabled}
          className="p-2 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 shrink-0"
          title="上传图片"
        >
          <ImageIcon size={20} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={!enabled}
          placeholder={hintText}
          rows={1}
          className="flex-1 resize-none rounded-2xl bg-zinc-100 dark:bg-zinc-800 px-4 py-2.5 text-[14px] text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none disabled:opacity-40 max-h-32"
        />

        <button
          onClick={handleSend}
          disabled={!enabled || (!text.trim() && pendingImages.length === 0)}
          className="p-2.5 rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 shrink-0"
        >
          <ArrowUp size={20} />
        </button>
      </div>
    </div>
  );
}
