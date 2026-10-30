import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

interface MarkdownMessageContentProps {
  content: string;
  variant?: 'chat' | 'compact';
  isUserMessage?: boolean;
}

/**
 * Safely normalizes escaped Markdown syntax (such as `\*\*Пн\*\*`, `\#\#\# Заголовок`, `\|`)
 * ONLY outside fenced code blocks (` ```...``` `) and inline code spans (`` `...` ``).
 * Never alters code blocks, inline code, or user document contents.
 */
export function normalizeEscapedMarkdownOutsideCode(rawContent: string): string {
  if (!rawContent || !rawContent.includes('\\')) {
    return rawContent;
  }

  // Split by fenced code blocks (```...```) and inline code (`...`)
  const codeBlockOrInlineRegex = /(```[\s\S]*?```|`[^`\n]+`)/g;
  const segments = rawContent.split(codeBlockOrInlineRegex);

  return segments
    .map((segment, index) => {
      // Odd indices are matched fenced or inline code blocks — keep 100% untouched
      if (index % 2 === 1) {
        return segment;
      }

      // Prose segment: normalize escaped Markdown characters
      return segment
        // Unescape bold/italic sequences like \*\*text\*\* or \*text\*
        .replace(/\\\*\\\*/g, '**')
        .replace(/\\\*/g, '*')
        // Unescape underscores like \_\_text\_\_
        .replace(/\\_\\_/g, '__')
        // Unescape Markdown headings at start of line: \#\#\# Title -> ### Title
        .replace(/(^|\n)(\s*)((?:\\#){1,6})(?=\s)/g, (_m, prefix, indent, hashes) => {
          return `${prefix}${indent}${hashes.replace(/\\#/g, '#')}`;
        })
        // Unescape escaped list markers at start of line: \- item -> - item
        .replace(/(^|\n)(\s*)\\-(\s+)/g, '$1$2-$3')
        // Unescape escaped numbered list dots at start of line: 1\. item -> 1. item
        .replace(/(^|\n)(\s*\d+)\\.(\s+)/g, '$1$2.$3')
        // Unescape table pipes: \| -> |
        .replace(/\\\|/g, '|')
        // Unescape brackets in links: \[text\]\(url\) -> [text](url)
        .replace(/\\\[/g, '[')
        .replace(/\\\]/g, ']')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')');
    })
    .join('');
}

export const MarkdownMessageContent: React.FC<MarkdownMessageContentProps> = ({
  content,
  variant = 'chat',
  isUserMessage = false,
}) => {
  const normalizedContent = useMemo(() => {
    if (isUserMessage) {
      return content;
    }
    return normalizeEscapedMarkdownOutsideCode(content);
  }, [content, isUserMessage]);

  // Keep user messages simple & crisp with preserved line breaks
  if (isUserMessage) {
    return <div className="whitespace-pre-wrap break-words">{content}</div>;
  }

  const isCompact = variant === 'compact';

  return (
    <div
      className={`markdown-message-body break-words ${
        isCompact
          ? 'text-xs leading-relaxed space-y-2'
          : 'text-sm leading-relaxed space-y-2.5'
      }`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          h1: ({ children }) => (
            <h1
              className={`font-display font-bold text-slate-900 tracking-tight ${
                isCompact
                  ? 'text-sm mt-2.5 mb-1 first:mt-0'
                  : 'text-base sm:text-lg mt-4 mb-1.5 first:mt-0'
              }`}
            >
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2
              className={`font-display font-bold text-slate-900 tracking-tight ${
                isCompact
                  ? 'text-xs sm:text-sm mt-2.5 mb-1 first:mt-0'
                  : 'text-[15px] sm:text-base mt-3.5 mb-1.5 first:mt-0'
              }`}
            >
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3
              className={`font-display font-bold text-slate-900 ${
                isCompact
                  ? 'text-xs mt-2 mb-1 first:mt-0'
                  : 'text-sm sm:text-[15px] mt-3 mb-1 first:mt-0'
              }`}
            >
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="font-display font-semibold text-slate-900 text-xs sm:text-sm mt-2.5 mb-1 first:mt-0">
              {children}
            </h4>
          ),
          p: ({ children }) => (
            <p className="leading-relaxed last:mb-0">{children}</p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-slate-900">{children}</strong>
          ),
          em: ({ children }) => <em className="italic text-slate-800">{children}</em>,
          ul: ({ children }) => (
            <ul
              className={`list-disc pl-5 ${
                isCompact ? 'space-y-1 my-1.5' : 'space-y-1.5 my-2'
              }`}
            >
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol
              className={`list-decimal pl-5 ${
                isCompact ? 'space-y-1 my-1.5' : 'space-y-1.5 my-2'
              }`}
            >
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed pl-0.5 marker:text-slate-400">
              {children}
            </li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2.5 border-l-3 border-[#00A8B5] bg-slate-50/90 pl-3.5 pr-3 py-2 rounded-r-xl text-slate-700 italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-slate-200/80" />,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[#008C99] underline underline-offset-2 hover:text-[#006B75] break-all"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-2.5 w-full max-w-full overflow-x-auto rounded-xl border border-slate-200/90 bg-white shadow-2xs">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs sm:text-[13px]">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-slate-50/95 text-slate-700 font-semibold">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-slate-200/70 bg-white">
              {children}
            </tbody>
          ),
          tr: ({ children }) => (
            <tr className="hover:bg-slate-50/60 transition-colors">{children}</tr>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 font-semibold text-slate-900 whitespace-nowrap border-r border-slate-200/60 last:border-r-0">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-slate-700 align-top border-r border-slate-100 last:border-r-0 min-w-[96px]">
              {children}
            </td>
          ),
          pre: ({ children }) => (
            <pre className="my-2.5 max-w-full overflow-x-auto rounded-xl bg-slate-900 text-slate-100 p-3.5 font-mono text-xs leading-relaxed">
              {children}
            </pre>
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = Boolean(
              className && className.includes('language-')
            );
            if (isBlock) {
              return (
                <code className="font-mono text-xs text-slate-100" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-200/80 font-mono text-[12px] text-slate-800 break-words"
                {...props}
              >
                {children}
              </code>
            );
          },
        }}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
};
