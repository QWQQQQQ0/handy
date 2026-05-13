// 来源: lib/widgets/chat/streaming_text.dart

'use client';

import { memo } from 'react';

export const StreamingText = memo(function StreamingText({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  return (
    <span>
      {text}
      {isStreaming && (
        <span className="inline-block w-0.5 h-[1em] bg-blue-600 dark:bg-blue-400 ml-0.5 animate-pulse align-middle" />
      )}
    </span>
  );
});
