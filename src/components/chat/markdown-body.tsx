// 来源: lib/widgets/markdown/handy_markdown.dart

'use client';

import React, { useState, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check } from 'lucide-react';

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800">
        <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
          {language || 'text'}
        </span>
        <button
          onClick={handleCopy}
          className="p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          title="Copy code"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <pre className="p-3 bg-zinc-50 dark:bg-[#1e1e1e] overflow-x-auto">
        <code className="text-[13px] font-mono leading-relaxed text-zinc-800 dark:text-zinc-200">
          {code}
        </code>
      </pre>
    </div>
  );
}

export const MarkdownBody = memo(function MarkdownBody({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5 prose-headings:my-2 prose-pre:my-0 prose-pre:p-0 prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const codeStr = String(children).replace(/\n$/, '');

            if (match) {
              return <CodeBlock language={match[1]} code={codeStr} />;
            }

            return (
              <code
                className="px-1 py-0.5 rounded text-[13px] font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200"
                {...props}
              >
                {children}
              </code>
            );
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline">
                {children}
              </a>
            );
          },
          img({ src, alt }) {
            return (
              <img
                src={src}
                alt={alt}
                className="rounded-lg max-w-full my-2"
                loading="lazy"
              />
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
