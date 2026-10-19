import type { ReactNode } from 'react';

const INLINE =
  /(\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;

function safeHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function inline(value: string, isLink = true): ReactNode[] {
  const parts: ReactNode[] = [];
  let from = 0;
  for (const match of value.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > from) parts.push(value.slice(from, index));
    const [raw, , label, href, bold, italic, code] = match;
    if (label && href) {
      const safe = safeHref(href);
      parts.push(
        safe && isLink ? (
          <a key={index} href={safe} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        ) : (
          label
        ),
      );
    } else if (bold) parts.push(<strong key={index}>{bold}</strong>);
    else if (italic) parts.push(<em key={index}>{italic}</em>);
    else if (code) parts.push(<code key={index}>{code}</code>);
    from = index + raw.length;
  }
  if (from < value.length) parts.push(value.slice(from));
  return parts;
}

export function MarkdownNote({
  value,
  compact = false,
}: {
  value: string;
  compact?: boolean;
}) {
  if (compact) {
    const snippet = value
      .replace(/(?:^|\n)\s*(?:#{1,6}\s|[-*+]\s|>\s?|\d+\.\s)/g, ' ')
      .replaceAll('`', '')
      .replaceAll('\n', ' ');
    return (
      <span data-deck="markdown-note" className="deck-markdown">
        {inline(snippet, false)}
      </span>
    );
  }
  const blocks: ReactNode[] = [];
  const lines = value.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.trim()) continue;
    if (line.startsWith('```')) {
      const code: string[] = [];
      while (++index < lines.length && !lines[index]?.startsWith('```'))
        code.push(lines[index] ?? '');
      blocks.push(
        <pre key={index}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      blocks.push(
        <Tag key={index} data-deck="markdown-heading" data-level={level}>
          {inline(heading[2] ?? '')}
        </Tag>,
      );
      continue;
    }
    if (/^>\s?/.test(line)) {
      blocks.push(
        <blockquote key={index}>
          {inline(line.replace(/^>\s?/, ''))}
        </blockquote>,
      );
      continue;
    }
    const list = /^(?:[-*+]\s+|(\d+)\.\s+)(.+)$/.exec(line);
    if (list) {
      const items = [list[2] ?? ''];
      const ordered = Boolean(list[1]);
      while (index + 1 < lines.length) {
        const next = /^(?:[-*+]\s+|(\d+)\.\s+)(.+)$/.exec(
          lines[index + 1] ?? '',
        );
        if (!next || Boolean(next[1]) !== ordered) break;
        items.push(next[2] ?? '');
        index += 1;
      }
      const children = items.map((item, itemIndex) => (
        <li key={itemIndex}>{inline(item)}</li>
      ));
      blocks.push(
        ordered ? (
          <ol key={index}>{children}</ol>
        ) : (
          <ul key={index}>{children}</ul>
        ),
      );
      continue;
    }
    const paragraph = [line];
    while (
      index + 1 < lines.length &&
      lines[index + 1]?.trim() &&
      !/^(?:#{1,6}\s|>|```|[-*+]\s|\d+\.\s)/.test(lines[index + 1] ?? '')
    ) {
      paragraph.push(lines[++index] ?? '');
    }
    blocks.push(<p key={index}>{inline(paragraph.join(' '))}</p>);
  }
  return (
    <div data-deck="markdown-note" className="deck-markdown">
      {blocks}
    </div>
  );
}
