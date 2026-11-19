/* Shared helpers for the Takenotes editor. No third-party editor dependencies. */
import type { BlockType } from '../../lib/types';
import type { IconName } from '../../lib/icons';
import { escapeHtml, sanitizeInline } from '../../lib/html';

export const LISTISH: BlockType[] = ['bulleted', 'numbered', 'todo', 'toggle'];
export const FILE_SIZE_LIMIT = 8 * 1024 * 1024;

export const CODE_LANGS = ['plain', 'ts', 'tsx', 'js', 'jsx', 'html', 'css', 'json', 'bash', 'python', 'sql', 'markdown', 'go', 'rust', 'java'];

export const CALLOUT_ICONS: string[] = ['info', 'bulb', 'warning', 'check', 'sun', 'leaf', 'zap', 'pin', 'flag', 'target', 'clock', 'heart', 'sparkles', 'rocket'];

export const CALLOUT_TONES: { id: 'ink' | 'terra' | 'sage'; label: string }[] = [
  { id: 'ink', label: 'Tinta' },
  { id: 'terra', label: 'Terracota' },
  { id: 'sage', label: 'Salvia' },
];

export const TEXT_TONES: { cls: string; label: string; swatch: string }[] = [
  { cls: '', label: 'Normal', swatch: 'var(--ink)' },
  { cls: 'tc-ink', label: 'Tinta', swatch: 'var(--ink)' },
  { cls: 'tc-terra', label: 'Terracota', swatch: 'var(--terra)' },
  { cls: 'tc-sage', label: 'Salvia', swatch: 'var(--sage)' },
];

export const BG_TONES: { cls: string; label: string; swatch: string }[] = [
  { cls: '', label: 'Sin fondo', swatch: 'transparent' },
  { cls: 'bg-ink-soft', label: 'Tinta suave', swatch: 'var(--ink-12)' },
  { cls: 'bg-terra-soft', label: 'Terracota suave', swatch: 'var(--terra-12)' },
  { cls: 'bg-sage-soft', label: 'Salvia suave', swatch: 'var(--sage-12)' },
  { cls: 'bg-ink', label: 'Tinta', swatch: 'var(--ink)' },
  { cls: 'bg-terra', label: 'Terracota', swatch: 'var(--terra)' },
  { cls: 'bg-sage', label: 'Salvia', swatch: 'var(--sage)' },
];

export const CONVERT_TARGETS: { type: BlockType; label: string; icon: IconName }[] = [
  { type: 'text', label: 'Texto', icon: 'text' },
  { type: 'h1', label: 'Encabezado 1', icon: 'heading' },
  { type: 'h2', label: 'Encabezado 2', icon: 'heading' },
  { type: 'h3', label: 'Encabezado 3', icon: 'heading' },
  { type: 'bulleted', label: 'Lista de viñetas', icon: 'bulletList' },
  { type: 'numbered', label: 'Lista numerada', icon: 'numberedList' },
  { type: 'todo', label: 'To-do', icon: 'checkSquare' },
  { type: 'toggle', label: 'Desplegable', icon: 'toggle' },
  { type: 'quote', label: 'Cita', icon: 'quote' },
  { type: 'callout', label: 'Destacado', icon: 'callout' },
  { type: 'code', label: 'Código', icon: 'code' },
  { type: 'table', label: 'Tabla', icon: 'table' },
  { type: 'columns', label: 'Columnas', icon: 'columns' },
  { type: 'divider', label: 'Divisor', icon: 'divider' },
];

export function placeholderFor(type: BlockType): string {
  switch (type) {
    case 'text': return 'Escribe, o pulsa / para bloques…';
    case 'h1': return 'Encabezado 1';
    case 'h2': return 'Encabezado 2';
    case 'h3': return 'Encabezado 3';
    case 'bulleted': return 'Elemento de la lista';
    case 'numbered': return 'Elemento de la lista';
    case 'todo': return 'To-do';
    case 'toggle': return 'Desplegable';
    case 'quote': return 'Cita';
    case 'callout': return 'Destacado';
    case 'code': return 'Código…';
    default: return '';
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function fragToParts(frag: DocumentFragment) {
  const d = document.createElement('div');
  d.appendChild(frag);
  return { html: sanitizeInline(d.innerHTML), text: (d.textContent ?? '').trim() };
}

/** Extrae el texto antes/después del caret dentro del elemento. Vacía el elemento. */
export function splitAtCaret(el: HTMLElement) {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
    const range = sel.getRangeAt(0);
    const post = range.cloneRange();
    post.selectNodeContents(el);
    post.setStart(range.endContainer, range.endOffset);
    const postParts = fragToParts(post.extractContents());
    const pre = document.createRange();
    pre.selectNodeContents(el);
    const preParts = fragToParts(pre.extractContents());
    return { before: preParts, after: postParts };
  }
  const text = el.textContent ?? '';
  return { before: { html: escapeHtml(text), text }, after: { html: '', text: '' } };
}

export function caretToEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export function preCaretText(el: HTMLElement): string {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return '';
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString();
}

/** Envuelve la selección actual en un <code> en línea. */
export function wrapSelectionInCode(el: HTMLElement) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.commonAncestorContainer)) return;
  const frag = range.extractContents();
  const code = document.createElement('code');
  code.appendChild(frag);
  range.insertNode(code);
  const r = document.createRange();
  r.selectNodeContents(code);
  sel.removeAllRanges();
  sel.addRange(r);
  el.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

export function restoreRange(range: Range) {
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

export function selectedBlockElement(range: Range): HTMLElement | null {
  const node = range.commonAncestorContainer;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  return el?.closest<HTMLElement>('.block-content') ?? null;
}

/** Aplica una clase de color a la selección; `group` limpia clases del mismo grupo. */
export function applyToneToSelection(range: Range, cls: string, group: 'text' | 'bg', blockEl: HTMLElement): void {
  restoreRange(range);
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const live = sel.getRangeAt(0);
  const frag = live.extractContents();
  for (const span of Array.from(frag.querySelectorAll('span'))) {
    if (group === 'text') span.classList.remove('tc-ink', 'tc-terra', 'tc-sage');
    else span.classList.remove('bg-ink', 'bg-terra', 'bg-sage', 'bg-ink-soft', 'bg-terra-soft', 'bg-sage-soft');
    if (span.classList.length === 0) span.replaceWith(...Array.from(span.childNodes));
  }
  if (!cls) {
    live.insertNode(frag);
  } else {
    const span = document.createElement('span');
    span.className = cls;
    span.appendChild(frag);
    live.insertNode(span);
    const after = document.createRange();
    after.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(after);
  }
  blockEl.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

/** Aplica un enlace seguro a la selección. */
export function applyLinkToSelection(range: Range, href: string, blockEl: HTMLElement, text?: string): void {
  restoreRange(range);
  const sel = window.getSelection();
  if (!sel) return;
  const frag = sel.getRangeAt(0).extractContents();
  const a = document.createElement('a');
  a.setAttribute('href', href);
  if (href.startsWith('#/p/')) {
    const id = href.slice(4);
    a.setAttribute('data-page-id', id);
    a.className = 'mention';
  } else {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  }
  if (frag.textContent?.trim()) a.appendChild(frag);
  else a.textContent = text || href;
  const r = window.getSelection();
  if (r && r.rangeCount) {
    r.getRangeAt(0).insertNode(a);
    const after = document.createRange();
    after.setStartAfter(a);
    after.collapse(true);
    r.removeAllRanges();
    r.addRange(after);
  }
  blockEl.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

export function removeLinkFromSelection(blockEl: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  let node = sel.anchorNode;
  while (node && node !== blockEl) {
    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'A') {
      const a = node as HTMLElement;
      a.replaceWith(...Array.from(a.childNodes));
      blockEl.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return true;
    }
    node = node.parentNode;
  }
  return false;
}

export function deleteBeforeCaret(count: number) {
  for (let i = 0; i < count; i++) document.execCommand('delete');
}

export function insertMention(pageId: string, title: string) {
  const safeTitle = escapeHtml(title || 'Sin título');
  document.execCommand(
    'insertHTML',
    false,
    `<a href="#/p/${pageId}" data-page-id="${pageId}" class="mention">@${safeTitle}</a>&nbsp;`,
  );
}

export interface FindRange {
  range: Range;
  blockId: string;
}

export function collectFindRanges(root: HTMLElement, query: string): FindRange[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: FindRange[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest('.block-content, .columns-cell, .tablecell') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent ?? '';
    const lower = text.toLowerCase();
    let from = 0;
    let idx = lower.indexOf(q, from);
    while (idx >= 0 && out.length < 300) {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + q.length);
      const host = (node.parentElement?.closest('[data-block-id]') as HTMLElement | null);
      out.push({ range, blockId: host?.dataset.blockId ?? '' });
      from = idx + q.length;
      idx = lower.indexOf(q, from);
    }
    if (out.length >= 300) break;
    node = walker.nextNode();
  }
  return out;
}
