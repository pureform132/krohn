/* Markdown ↔ Takenotes blocks. Independent parser, no external library. */
import { escapeHtml, isSafeUrl, normalizeUrl, sanitizeInline } from './html';
import { newId, type Block, type BlockType, type Page, type PageVersion } from './types';

function plain(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}

export function inlineMarkdownToHtml(src: string): string {
  let s = escapeHtml(src);
  // code spans first so their contents are not formatted
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(code);
    return `\u0000CODE${codes.length - 1}\u0000`;
  });
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt: string, url: string) => (isSafeUrl(url) ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${alt || url}</a>` : m));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label: string, url: string) => {
    const safe = isSafeUrl(url) ? url : normalizeUrl(url);
    return isSafeUrl(safe) ? `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>` : m;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/__([^_]+)__/g, '<b>$1</b>');
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>');
  s = s.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<i>$2</i>');
  s = s.replace(/\u0000CODE(\d+)\u0000/g, (_, i: string) => `<code>${codes[Number(i)]}</code>`);
  return sanitizeInline(s);
}

function b(type: BlockType, html: string, extra: Partial<Block> = {}): Block {
  return { id: newId(), type, text: plain(html), html, level: 0, ...extra };
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

export function parseMarkdownToBlocks(markdown: string): Block[] {
  const text = markdown.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // fenced code
    const fence = /^```([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] || 'plain';
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
      i++;
      const src = code.join('\n');
      blocks.push({ id: newId(), type: 'code', text: src, html: escapeHtml(src), lang, level: 0 });
      continue;
    }

    // table
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const rows: string[][] = [splitTableRow(line)];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const width = Math.max(...rows.map((r) => r.length));
      blocks.push({
        id: newId(),
        type: 'table',
        text: '',
        html: '',
        level: 0,
        table: { header: true, rows: rows.map((r) => [...r, ...Array(width - r.length).fill('')]) },
      });
      continue;
    }

    // divider
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      blocks.push(b('divider', ''));
      i++;
      continue;
    }

    // headings
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(3, h[1].length);
      blocks.push(b((`h${level}`) as BlockType, inlineMarkdownToHtml(h[2])));
      i++;
      continue;
    }

    // image only
    const img = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line);
    if (img) {
      blocks.push({ ...b('image', ''), src: img[2], alt: img[1] });
      i++;
      continue;
    }

    // callout
    const call = /^>\s*\[!(note|tip|important|warning|info)\]\s*$/i.exec(line.trim());
    if (call) {
      const body: string[] = [];
      i++;
      while (i < lines.length && /^>/.test(lines[i])) {
        body.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(b('callout', inlineMarkdownToHtml(body.join('\n').replace(/\n/g, '<br>'))));
      continue;
    }

    // quote
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(b('quote', inlineMarkdownToHtml(body.join(' '))));
      continue;
    }

    // to-do
    const todo = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (todo) {
      const level = Math.min(4, Math.floor(todo[1].length / 2));
      blocks.push(b('todo', inlineMarkdownToHtml(todo[3]), { checked: todo[2].toLowerCase() === 'x', level }));
      i++;
      continue;
    }

    // bulleted
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      const level = Math.min(4, Math.floor(bullet[1].length / 2));
      blocks.push(b('bulleted', inlineMarkdownToHtml(bullet[2]), { level }));
      i++;
      continue;
    }

    // numbered
    const num = /^(\s*)\d+[.)]\s+(.*)$/.exec(line);
    if (num) {
      const level = Math.min(4, Math.floor(num[1].length / 2));
      blocks.push(b('numbered', inlineMarkdownToHtml(num[2]), { level }));
      i++;
      continue;
    }

    // paragraph: collect until blank or a new block marker
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim()) {
      if (/^(#{1,6})\s+/.test(lines[i]) || /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || /^>/.test(lines[i]) || /^```/.test(lines[i]) || /^\s*([-*_])\s*\1\s*\1/.test(lines[i])) break;
      para.push(lines[i]);
      i++;
    }
    blocks.push(b('text', inlineMarkdownToHtml(para.join('\n')).replace(/\n/g, '<br>')));
  }
  return blocks.length ? blocks : [b('text', '')];
}

/** True when pasted text clearly contains block-level Markdown, so plain text pastes stay untouched. */
export function looksLikeMarkdown(text: string): boolean {
  if (!text.includes('\n')) return false;
  return /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```|#{1,6}\s|\|.*\|)/m.test(text);
}

export function parseHtmlToBlocks(html: string): Block[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: Block[] = [];
  const walkInline = (el: Element): string => sanitizeInline(el.innerHTML);
  for (const el of Array.from(doc.body.children)) {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      out.push(b((`h${Math.min(3, Number(tag[1]))}`) as BlockType, walkInline(el)));
    } else if (tag === 'p') {
      const e = b('text', walkInline(el));
      if (e.text.trim()) out.push(e);
    } else if (tag === 'ul' || tag === 'ol') {
      for (const li of Array.from(el.children)) {
        if (li.tagName.toLowerCase() !== 'li') continue;
        const checkbox = li.querySelector('input[type="checkbox"]');
        const clone = li.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('input').forEach((x) => x.remove());
        out.push(b(tag === 'ul' ? (checkbox ? 'todo' : 'bulleted') : 'numbered', walkInline(clone), { checked: !!checkbox?.hasAttribute('checked') }));
      }
    } else if (tag === 'blockquote') {
      out.push(b('quote', walkInline(el)));
    } else if (tag === 'pre') {
      out.push({ id: newId(), type: 'code', text: el.textContent ?? '', html: escapeHtml(el.textContent ?? ''), lang: 'plain', level: 0 });
    } else if (tag === 'hr') {
      out.push(b('divider', ''));
    } else if (tag === 'img') {
      out.push({ ...b('image', ''), src: el.getAttribute('src') ?? '', alt: el.getAttribute('alt') ?? '' });
    } else if (tag === 'table') {
      const rows: string[][] = [];
      el.querySelectorAll('tr').forEach((tr) => {
        rows.push(Array.from(tr.querySelectorAll('th,td')).map((c) => c.textContent?.trim() ?? ''));
      });
      if (rows.length) out.push({ id: newId(), type: 'table', text: '', html: '', level: 0, table: { header: true, rows } });
    } else {
      const e = b('text', walkInline(el));
      if (e.text.trim()) out.push(e);
    }
  }
  return out.length ? out : parseMarkdownToBlocks(doc.body.textContent ?? '');
}

export function pageVersionOf(page: Page, label?: string): PageVersion {
  const words = page.blocks.reduce((n, b) => n + (b.text ? b.text.split(/\s+/).filter(Boolean).length : 0), 0);
  return {
    id: newId(),
    at: Date.now(),
    title: page.title,
    icon: page.icon,
    cover: page.cover,
    blocks: JSON.parse(JSON.stringify(page.blocks)) as Block[],
    db: page.db ? (JSON.parse(JSON.stringify(page.db)) as Page['db']) : undefined,
    words,
    label,
  };
}
