import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode,
} from 'react';
import { useWorkspace } from '../state/WorkspaceContext';
import { Icon, type IconName } from '../lib/icons';
import { sanitizeInline, htmlToText, escapeHtml, isSafeUrl, normalizeUrl } from '../lib/html';
import { COVER_BY_ID, searchPageIcons } from '../lib/pageIcons';
import { getPageDrag, hasPageDrag, setPageDrag } from '../lib/pageDrag';
import { SlashMenu, SLASH_COMMANDS, type SlashCommand } from './SlashMenu';
import { newId, type Block, type BlockType, type ColumnData, type Page } from '../lib/types';
import { looksLikeMarkdown, parseHtmlToBlocks, parseMarkdownToBlocks } from '../lib/markdown';
import { foldAccents } from '../lib/text';
import { BlockBody } from './editor/BlockBody';
import { FormatToolbar, BlockMenu, MentionMenu, FindBar, VersionHistory } from './editor/EditorOverlays';
import { CoverPicker, MoveDialog, ImageUploader, FileUploader } from './editor/EditorDialogs';
import {
  LISTISH, caretToEnd, splitAtCaret, preCaretText, wrapSelectionInCode,
  selectedBlockElement, restoreRange, applyToneToSelection, applyLinkToSelection,
  deleteBeforeCaret, insertMention, collectFindRanges, type FindRange, formatBytes,
  placeholderFor,
} from './editor/editorUtils';

function defaultColumns(): ColumnData[] {
  return [
    { id: newId(), html: '', text: '' },
    { id: newId(), html: '', text: '' },
  ];
}

export function Editor({ page }: { page: Page }) {
  const {
    pages, updatePage, toggleFavorite, trashPage, byId, setActivePageId,
    createPage, duplicatePage, movePage, addBlock, insertBlocks, updateBlock,
    removeBlock, duplicateBlock, moveBlock, splitBlock, mergeIntoPrevious,
    focusRequest, requestFocus, exportPageMarkdown, exportPageHtml, copyPageLink,
    setPrintPageId, saveVersion, restoreVersion, deleteVersion, toast,
    undoRevision, markUndoBoundary,
  } = useWorkspace();

  const [slash, setSlash] = useState<{ blockId: string; query: string; selected: number } | null>(null);
  const [slashPos, setSlashPos] = useState({ top: 0, left: 0 });
  const [iconPick, setIconPick] = useState(false);
  const [iconQuery, setIconQuery] = useState('');
  const [coverOpen, setCoverOpen] = useState(false);
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [linkPickerFor, setLinkPickerFor] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dropNotice, setDropNotice] = useState<string | null>(null);
  const [imageErr, setImageErr] = useState<Record<string, string>>({});
  const [fmtBar, setFmtBar] = useState<{ top: number; left: number } | null>(null);
  const [blockMenu, setBlockMenu] = useState<{ blockId: string; x: number; y: number } | null>(null);
  const [mention, setMention] = useState<{ blockId: string; query: string; selected: number; top: number; left: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const [findCount, setFindCount] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const blockEls = useRef(new Map<string, HTMLElement>());
  const savedRange = useRef<Range | null>(null);
  const activeContent = useRef<HTMLElement | null>(null);
  const findRanges = useRef<FindRange[]>([]);
  const dragBlock = useRef<string | null>(null);

  const setBlockRef = useCallback((id: string) => (el: HTMLElement | null) => {
    if (el) blockEls.current.set(id, el);
    else blockEls.current.delete(id);
  }, []);

  const numbering = useMemo(() => {
    const map = new Map<string, number>();
    const counters = [0, 0, 0, 0, 0];
    for (const b of page.blocks) {
      if (b.type === 'numbered') {
        counters[b.level] += 1;
        map.set(b.id, counters[b.level]);
        for (let l = b.level + 1; l < counters.length; l++) counters[l] = 0;
      } else counters.fill(0);
    }
    return map;
  }, [page.blocks]);

  const visibleBlocks = useMemo(() => {
    const out: Block[] = [];
    let hideDeeperThan: number | null = null;
    for (const b of page.blocks) {
      if (hideDeeperThan !== null) {
        if (b.level > hideDeeperThan) continue;
        hideDeeperThan = null;
      }
      out.push(b);
      if (b.type === 'toggle' && b.open === false) hideDeeperThan = b.level;
    }
    return out;
  }, [page.blocks]);

  const iconGroups = useMemo(() => searchPageIcons(iconQuery), [iconQuery]);
  const inlineSubpageIds = useMemo(
    () => new Set(page.blocks.filter((b) => b.type === 'subpage' && b.pageId).map((b) => b.pageId!)),
    [page.blocks],
  );
  const extraSubpages = useMemo(
    () => pages.filter((p) => p.parentId === page.id && !p.trashed && !inlineSubpageIds.has(p.id)),
    [pages, page.id, inlineSubpageIds],
  );
  const backlinks = useMemo(
    () => pages.filter((p) => p.id !== page.id && p.blocks.some((b) => b.type === 'pageLink' && b.pageId === page.id)),
    [pages, page.id],
  );
  const childCount = useCallback(
    (targetId: string) => pages.filter((p) => p.parentId === targetId && !p.trashed).length,
    [pages],
  );
  const mentionItems = useMemo(() => {
    const q = (mention?.query ?? '').toLowerCase().trim();
    return pages
      .filter((p) => !p.trashed && p.id !== page.id)
      .filter((p) => !q || `${p.title || 'Sin título'}`.toLowerCase().includes(q))
      .slice(0, 7);
  }, [mention?.query, pages, page.id]);

  const menuBlock = blockMenu ? page.blocks.find((b) => b.id === blockMenu.blockId) : undefined;
  const menuIndex = blockMenu ? page.blocks.findIndex((b) => b.id === blockMenu.blockId) : -1;

  const createSubpage = useCallback(() => {
    const childId = createPage(page.id, 'page');
    addBlock(page.id, { id: newId(), type: 'subpage', text: '', html: '', level: 0, pageId: childId });
    setActivePageId(childId);
  }, [addBlock, createPage, page.id, setActivePageId]);

  useEffect(() => {
    if (!dropNotice) return;
    const timer = window.setTimeout(() => setDropNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [dropNotice]);

  const addParagraph = useCallback(() => {
    if (page.locked) return;
    const last = page.blocks[page.blocks.length - 1];
    if (last && last.type === 'text' && !last.text.trim() && !last.html.trim()) {
      requestFocus(last.id);
      return;
    }
    const block: Block = { id: newId(), type: 'text', text: '', html: '', level: 0 };
    addBlock(page.id, block);
    requestFocus(block.id);
  }, [addBlock, page.blocks, page.id, page.locked, requestFocus]);

  const dropIndex = useCallback((e: React.DragEvent): number => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-block-id]');
    if (!el?.dataset.blockId) return page.blocks.length;
    const index = page.blocks.findIndex((b) => b.id === el.dataset.blockId);
    if (index < 0) return page.blocks.length;
    const rect = el.getBoundingClientRect();
    return index + (e.clientY > rect.top + rect.height / 2 ? 1 : 0);
  }, [page.blocks]);

  const dropPageHere = useCallback((draggedId: string, index: number) => {
    if (!draggedId || draggedId === page.id) {
      setDropNotice('Una página no puede ser subpágina de sí misma.');
      return;
    }
    const target = byId.get(draggedId);
    if (!target) return;
    if (!movePage(draggedId, page.id)) {
      setDropNotice('No puedes mover una página dentro de una de sus propias subpáginas.');
      return;
    }
    const existing = page.blocks.find((b) => b.type === 'subpage' && b.pageId === draggedId);
    if (existing) blockEls.current.get(existing.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else addBlock(page.id, { id: newId(), type: 'subpage', pageId: draggedId, text: '', html: '', level: 0 }, index);
    setDropNotice(`«${target.title || 'Sin título'}» ahora es una subpágina de «${page.title || 'Sin título'}».`);
  }, [addBlock, byId, movePage, page.blocks, page.id, page.title]);

  const onEditorDragOver = useCallback((e: React.DragEvent) => {
    if (!hasPageDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(true);
  }, []);
  const onEditorDragLeave = useCallback((e: React.DragEvent) => {
    const next = e.relatedTarget as Node | null;
    if (!next || !e.currentTarget.contains(next)) setDragOver(false);
  }, []);
  const onEditorDrop = useCallback((e: React.DragEvent) => {
    const draggedId = getPageDrag(e);
    if (!draggedId) return;
    e.preventDefault();
    setDragOver(false);
    dropPageHere(draggedId, dropIndex(e));
  }, [dropIndex, dropPageHere]);

  useEffect(() => {
    if (!focusRequest) return;
    const wrap = blockEls.current.get(focusRequest.id);
    const inner = wrap?.querySelector<HTMLElement>('.block-content, .columncontent') ?? wrap;
    if (inner) { inner.focus(); caretToEnd(inner); }
  }, [focusRequest]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (iconPick && !t.closest('.titleicon') && !t.closest('.iconpick')) { setIconPick(false); setIconQuery(''); }
      if (pageMenuOpen && !t.closest('.pagemenu-wrap')) setPageMenuOpen(false);
      if (linkPickerFor && !t.closest('.pagelink-picker') && !t.closest('.pagelink-open')) setLinkPickerFor(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [iconPick, pageMenuOpen, linkPickerFor]);

  useLayoutEffect(() => {
    for (const b of page.blocks) {
      const wrap = blockEls.current.get(b.id);
      const inner = wrap?.querySelector<HTMLElement>('.block-content');
      if (inner && document.activeElement !== inner) {
        if (b.type === 'code') {
          if (inner.textContent !== b.text) inner.textContent = b.text;
        } else if (inner.innerHTML !== (b.html || '')) inner.innerHTML = b.html || '';
      }
    }
  }, [page.blocks, page.id]);

  /* Undo/redo/restore replace page content while the caret may still sit in a
     contenteditable. That DOM is intentionally left alone while typing, so
     refresh it here — otherwise the editor would show stale text and the next
     blur would write it back over the restored version. */
  const undoRevRef = useRef(undoRevision);
  useLayoutEffect(() => {
    if (undoRevision === undoRevRef.current) return;
    undoRevRef.current = undoRevision;
    for (const b of page.blocks) {
      const wrap = blockEls.current.get(b.id);
      const inner = wrap?.querySelector<HTMLElement>('.block-content');
      if (!inner) continue;
      const wasActive = document.activeElement === inner;
      if (b.type === 'code') {
        if (inner.textContent !== b.text) inner.textContent = b.text;
      } else if (inner.innerHTML !== (b.html || '')) {
        inner.innerHTML = b.html || '';
      }
      if (wasActive) caretToEnd(inner);
    }
  }, [undoRevision, page.blocks]);

  /* ------------------------------------------------------ barra de formato */

  const updateFmtBar = useCallback(() => {
    if (page.locked) { setFmtBar(null); return; }
    if (document.activeElement?.closest?.('.formattoolbar')) return; // escribiendo el enlace/tono
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { setFmtBar(null); return; }
    const range = sel.getRangeAt(0);
    const el = selectedBlockElement(range);
    if (!el || !rootRef.current?.contains(el)) { setFmtBar(null); return; }
    savedRange.current = range.cloneRange();
    activeContent.current = el;
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    setFmtBar({
      top: Math.max(58, rect.top - 10),
      left: Math.min(window.innerWidth - 190, Math.max(110, rect.left + rect.width / 2)),
    });
  }, [page.locked]);

  useEffect(() => {
    if (page.locked) return;
    const onSelection = () => window.setTimeout(updateFmtBar, 0);
    const hide = () => {
      // Keep the toolbar while focus lives inside it (p.ej. el campo de enlace).
      if (document.activeElement?.closest?.('.formattoolbar')) return;
      setFmtBar(null);
    };
    document.addEventListener('selectionchange', onSelection);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('selectionchange', onSelection);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [page.locked, updateFmtBar]);

  const refreshAfterFormat = useCallback(() => {
    const el = activeContent.current;
    if (el) el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    window.setTimeout(updateFmtBar, 0);
  }, [updateFmtBar]);

  const applyCommand = useCallback((cmd: 'bold' | 'italic' | 'underline' | 'strikeThrough') => {
    if (!savedRange.current) return;
    markUndoBoundary();
    restoreRange(savedRange.current);
    document.execCommand(cmd);
    refreshAfterFormat();
  }, [markUndoBoundary, refreshAfterFormat]);

  const applyCode = useCallback(() => {
    const el = activeContent.current;
    if (!el) return;
    markUndoBoundary();
    restoreRange(savedRange.current!);
    wrapSelectionInCode(el);
    window.setTimeout(updateFmtBar, 0);
  }, [markUndoBoundary, updateFmtBar]);

  const applyTone = useCallback((cls: string, group: 'text' | 'bg') => {
    const el = activeContent.current;
    if (!el || !savedRange.current) return;
    markUndoBoundary();
    applyToneToSelection(savedRange.current, cls, group, el);
    window.setTimeout(updateFmtBar, 0);
  }, [markUndoBoundary, updateFmtBar]);

  const applyLink = useCallback((raw: string) => {
    const el = activeContent.current;
    if (!el || !savedRange.current) return;
    const href = raw.startsWith('#') ? raw : normalizeUrl(raw);
    if (!isSafeUrl(href)) { toast('Ese enlace no es seguro.', 'err'); return; }
    markUndoBoundary();
    applyLinkToSelection(savedRange.current, href, el);
    toast('Enlace aplicado');
    window.setTimeout(updateFmtBar, 0);
  }, [markUndoBoundary, toast, updateFmtBar]);

  const clearFormat = useCallback(() => {
    if (!savedRange.current) return;
    markUndoBoundary();
    restoreRange(savedRange.current);
    document.execCommand('removeFormat');
    document.execCommand('unlink');
    refreshAfterFormat();
  }, [markUndoBoundary, refreshAfterFormat]);

  /* ------------------------------------------------------------- edición */

  const openSlashAt = useCallback((blockId: string, el: HTMLElement) => {
    const host = rootRef.current?.closest('.main') as HTMLElement | null;
    const hostRect = host?.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    setSlashPos({
      top: rect.bottom - (hostRect?.top ?? 0) + (host?.scrollTop ?? 0) + 6,
      left: Math.min(rect.left - (hostRect?.left ?? 0) + (host?.scrollLeft ?? 0), (host?.clientWidth ?? 800) - 300),
    });
    setSlash({ blockId, query: '', selected: 0 });
  }, []);

  const openMentionAt = useCallback((blockId: string, query: string) => {
    const sel = window.getSelection();
    const rect = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : ({ top: 120, left: 120 } as DOMRect);
    setMention((m) => ({
      blockId,
      query,
      selected: m && m.blockId === blockId ? m.selected : 0,
      top: Math.min(window.innerHeight - 300, Math.max(70, rect.bottom + 8)),
      left: Math.min(window.innerWidth - 320, Math.max(16, rect.left)),
    }));
  }, []);

  const filteredSlashCount = useMemo(() => {
    if (!slash) return 0;
    const q = foldAccents(slash.query.trim());
    return SLASH_COMMANDS.filter((c) => !q || foldAccents(`${c.label} ${c.keywords}`).includes(q)).length;
  }, [slash]);

  const handleInput = useCallback((b: Block, el: HTMLElement) => {
    if (el.innerHTML === '<br>') el.innerHTML = '';
    const text = el.textContent ?? '';
    if (b.type === 'code') {
      updateBlock(page.id, b.id, { text, html: escapeHtml(text) });
      return;
    }
    updateBlock(page.id, b.id, { html: sanitizeInline(el.innerHTML), text });
    const pre = preCaretText(el);

    const mm = /(^|\s)@([\p{L}\p{N}_-]*)$/u.exec(pre);
    if (mm) {
      if (!mention || mention.blockId !== b.id) openMentionAt(b.id, mm[2]);
      else setMention((m) => (m ? { ...m, query: mm[2], selected: Math.min(m.selected, Math.max(0, mentionItems.length - 1)) } : m));
    } else if (mention?.blockId === b.id) {
      setMention(null);
    }

    const m = /(^|\s)\/([\p{L}\p{N}_-]*)$/u.exec(pre);
    if (m) {
      if (!slash || slash.blockId !== b.id) openSlashAt(b.id, el);
      setSlash((s) => (s ? { ...s, query: m[2], selected: Math.min(s.selected, Math.max(0, filteredSlashCount - 1)) } : s));
    } else if (slash?.blockId === b.id) {
      setSlash(null);
    }
  }, [page.id, updateBlock, slash, mention, mentionItems.length, openSlashAt, openMentionAt, filteredSlashCount]);

  const convertBlockTo = useCallback((b: Block, type: BlockType, keepText = true) => {
    const patch: Partial<Block> = { type };
    if (!keepText) { patch.html = ''; patch.text = ''; }
    if (type === 'todo') patch.checked = false;
    if (type === 'toggle') patch.open = true;
    if (type === 'code') patch.lang = b.lang ?? 'plain';
    if (type === 'callout') { patch.calloutIcon = b.calloutIcon ?? 'info'; patch.calloutTone = b.calloutTone ?? 'ink'; }
    if (type === 'table') patch.table = { header: true, rows: [['', '', ''], ['', '', '']] };
    if (type === 'columns') patch.columns = defaultColumns();
    if (type === 'equation') patch.equation = b.equation ?? '';
    if (type === 'divider') { patch.html = ''; patch.text = ''; }
    updateBlock(page.id, b.id, patch);
    const inner = blockEls.current.get(b.id)?.querySelector<HTMLElement>('.block-content');
    if (inner) inner.innerHTML = patch.html ?? '';
    setSlash(null);
    if (['text', 'h1', 'h2', 'h3', 'bulleted', 'numbered', 'todo', 'toggle', 'quote', 'callout', 'code'].includes(type)) requestFocus(b.id);
  }, [page.id, updateBlock, requestFocus]);

  const applySlashPick = useCallback((cmd: SlashCommand) => {
    const b = page.blocks.find((x) => x.id === slash?.blockId);
    if (!b) { setSlash(null); return; }
    const inner = blockEls.current.get(b.id)?.querySelector<HTMLElement>('.block-content');
    const raw = inner?.textContent ?? '';
    const stripped = raw.replace(/(^|\s)\/[\p{L}\p{N}_-]*$/u, '$1').trim();

    if (cmd.type === 'subpage') {
      const childId = createPage(page.id, 'page');
      if (inner) inner.replaceChildren();
      updateBlock(page.id, b.id, { type: 'subpage', pageId: childId, html: '', text: '' });
      setSlash(null);
      setActivePageId(childId);
      return;
    }
    if (cmd.type === 'pageLink') {
      if (inner) inner.replaceChildren();
      updateBlock(page.id, b.id, { type: 'pageLink', pageId: undefined, html: '', text: '' });
      setSlash(null);
      setLinkPickerFor(b.id);
      return;
    }
    if (cmd.type === 'toc') {
      if (inner) inner.replaceChildren();
      updateBlock(page.id, b.id, { type: 'toc', html: '', text: '' });
      setSlash(null);
      return;
    }
    const textTypes = ['text', 'h1', 'h2', 'h3', 'bulleted', 'numbered', 'todo', 'toggle', 'quote', 'callout', 'code'];
    if (textTypes.includes(cmd.type)) {
      convertBlockTo({ ...b }, cmd.type, true);
      if (inner) {
        inner.innerHTML = stripped ? escapeHtml(stripped) : '';
        updateBlock(page.id, b.id, { html: escapeHtml(stripped), text: stripped });
        if (stripped) caretToEnd(inner);
      }
    } else {
      convertBlockTo({ ...b }, cmd.type, false);
    }
    setSlash(null);
  }, [page.blocks, page.id, slash, convertBlockTo, updateBlock, createPage, setActivePageId]);

  const pickMention = useCallback((target: Page) => {
    if (!mention) return;
    const el = blockEls.current.get(mention.blockId)?.querySelector<HTMLElement>('.block-content');
    deleteBeforeCaret(mention.query.length + 1);
    insertMention(target.id, target.title || 'Sin título');
    if (el) {
      el.focus();
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    setMention(null);
    toast(`Mención a «${target.title || 'Sin título'}»`);
  }, [mention, toast]);

  const focusPrev = useCallback((blocks: Block[], currentId: string) => {
    const i = blocks.findIndex((x) => x.id === currentId);
    if (blocks[i - 1]) requestFocus(blocks[i - 1].id);
  }, [requestFocus]);

  const handleKeyDown = (b: Block) => (e: KeyboardEvent<HTMLElement>) => {
    const el = e.currentTarget;

    if (mention?.blockId === b.id) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setMention((m) => {
          if (!m) return m;
          const count = Math.max(1, mentionItems.length);
          return { ...m, selected: (m.selected + (e.key === 'ArrowDown' ? 1 : -1) + count) % count };
        });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const target = mentionItems[mention.selected];
        if (target) { e.preventDefault(); pickMention(target); return; }
      }
      if (e.key === 'Escape') { e.preventDefault(); setMention(null); return; }
    }

    if (slash?.blockId === b.id) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSlash((s) => {
          if (!s) return s;
          const count = Math.max(1, filteredSlashCount);
          return { ...s, selected: (s.selected + (e.key === 'ArrowDown' ? 1 : -1) + count) % count };
        });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const q = foldAccents(slash.query.trim());
        const items = SLASH_COMMANDS.filter((c) => !q || foldAccents(`${c.label} ${c.keywords}`).includes(q));
        const pick = items[Math.min(slash.selected, items.length - 1)];
        if (pick) applySlashPick(pick);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setSlash(null); return; }
    }

    const mod = e.ctrlKey || e.metaKey;

    if (mod && b.type !== 'code') {
      const k = e.key.toLowerCase();
      if (k === 'b' && !e.shiftKey) { e.preventDefault(); document.execCommand('bold'); el.dispatchEvent(new InputEvent('input', { bubbles: true })); return; }
      if (k === 'i' && !e.shiftKey) { e.preventDefault(); document.execCommand('italic'); el.dispatchEvent(new InputEvent('input', { bubbles: true })); return; }
      if (k === 'u' && !e.shiftKey) { e.preventDefault(); document.execCommand('underline'); el.dispatchEvent(new InputEvent('input', { bubbles: true })); return; }
      if (e.shiftKey && k === 'x') { e.preventDefault(); document.execCommand('strikeThrough'); el.dispatchEvent(new InputEvent('input', { bubbles: true })); return; }
      if (k === '`') { e.preventDefault(); wrapSelectionInCode(el); return; }
      if (k === 'k' && !e.shiftKey) {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) {
          e.preventDefault();
          e.stopPropagation();
          savedRange.current = sel.getRangeAt(0).cloneRange();
          activeContent.current = el;
          const rect = savedRange.current.getBoundingClientRect();
          setFmtBar({ top: Math.max(58, rect.top - 10), left: Math.min(window.innerWidth - 190, Math.max(110, rect.left + rect.width / 2)) });
          return;
        }
      }
    }

    if (mod && e.key.toLowerCase() === 'f' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      setFindOpen(true);
      return;
    }

    if (b.type === 'code') {
      if (e.key === 'Enter' && !mod) { e.preventDefault(); document.execCommand('insertText', false, '\n'); return; }
      if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); return; }
      if (e.key === 'Backspace' && (el.textContent ?? '') === '') {
        e.preventDefault(); removeBlock(page.id, b.id); focusPrev(page.blocks, b.id); return;
      }
      return;
    }

    if (e.key === 'Enter' && !mod) {
      if (e.shiftKey) { e.preventDefault(); document.execCommand('insertLineBreak'); return; }
      const raw = (el.textContent ?? '').trim();
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(raw)) {
        e.preventDefault();
        convertBlockTo(b, 'divider', false);
        return;
      }
      e.preventDefault();
      const { before, after } = splitAtCaret(el);
      el.innerHTML = before.html;
      const newId2 = splitBlock(page.id, b.id, before.html, before.text, after.html, after.text);
      requestFocus(newId2);
      return;
    }

    if (e.key === 'Backspace') {
      const empty = (el.textContent ?? '') === '';
      if (empty) {
        e.preventDefault();
        if (b.type !== 'text') updateBlock(page.id, b.id, { type: 'text', html: '', text: '' });
        else { removeBlock(page.id, b.id); focusPrev(page.blocks, b.id); }
        return;
      }
      const pre = preCaretText(el);
      if (pre.length === 0) {
        if (LISTISH.includes(b.type) && b.level > 0) {
          e.preventDefault();
          updateBlock(page.id, b.id, { level: b.level - 1 });
          return;
        }
        e.preventDefault();
        mergeIntoPrevious(page.id, b.id);
        focusPrev(page.blocks, b.id);
        return;
      }
    }

    if (e.key === 'Tab' && LISTISH.includes(b.type)) {
      e.preventDefault();
      const next = Math.min(4, Math.max(0, b.level + (e.shiftKey ? -1 : 1)));
      updateBlock(page.id, b.id, { level: next });
      return;
    }

    if (e.key === ' ' && !mod) {
      const pre = preCaretText(el);
      const rules: Record<string, BlockType> = {
        '#': 'h1', '##': 'h2', '###': 'h3', '-': 'bulleted', '*': 'bulleted',
        '1.': 'numbered', '1)': 'numbered', '[]': 'todo', '[ ]': 'todo', '>': 'quote', '```': 'code',
      };
      const target = rules[pre];
      if (target) {
        e.preventDefault();
        const patch: Partial<Block> = { type: target, html: '', text: '' };
        if (target === 'todo') patch.checked = false;
        if (target === 'code') patch.lang = 'plain';
        updateBlock(page.id, b.id, patch);
        el.innerHTML = '';
        requestFocus(b.id);
        return;
      }
    }
  };

  const handleBlur = (b: Block) => (e: React.FocusEvent<HTMLElement>) => {
    const el = e.currentTarget;
    if (b.type === 'code') { updateBlock(page.id, b.id, { text: el.textContent ?? '', html: escapeHtml(el.textContent ?? '') }); return; }
    const clean = sanitizeInline(el.innerHTML);
    if (clean !== el.innerHTML) el.innerHTML = clean;
    updateBlock(page.id, b.id, { html: clean, text: htmlToText(clean) });
    // Don't tear down the format toolbar when focus moves into it (p.ej. el campo de enlace).
    const movingIntoToolbar = !!(e.relatedTarget as HTMLElement | null)?.closest?.('.formattoolbar');
    if (!movingIntoToolbar) setFmtBar(null);
  };

  const handlePaste = (b: Block) => (e: React.ClipboardEvent<HTMLElement>) => {
    if (b.type === 'code' || page.locked) return;
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const blockTags = /<(p|div|ul|ol|li|h[1-6]|table|blockquote|pre|hr)[\s>]/i;
    const index = page.blocks.findIndex((x) => x.id === b.id);
    if (html && blockTags.test(html)) {
      e.preventDefault();
      const blocks = parseHtmlToBlocks(html);
      insertBlocks(page.id, blocks, index + 1);
      toast(`${blocks.length} bloques pegados`);
      return;
    }
    if (text && looksLikeMarkdown(text)) {
      e.preventDefault();
      const blocks = parseMarkdownToBlocks(text);
      insertBlocks(page.id, blocks, index + 1);
      toast(`${blocks.length} bloques pegados desde Markdown`);
    }
  };

  const handleContentClick = (e: React.MouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
    const pid = a.getAttribute('data-page-id');
    if (pid && byId.get(pid)) { setActivePageId(pid); return; }
    const href = a.getAttribute('href');
    if (href) window.open(href, '_blank', 'noopener,noreferrer');
  };

  /* --------------------------------------------------------------- bloques */

  const blockDrop = (b: Block) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragBlock.current) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      setDropTarget({ id: b.id, after: e.clientY > rect.top + rect.height / 2 });
    },
    onDrop: (e: React.DragEvent) => {
      if (!dragBlock.current) return;
      e.preventDefault();
      e.stopPropagation();
      const dragged = dragBlock.current;
      const rect = e.currentTarget.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      const targetIndex = page.blocks.findIndex((x) => x.id === b.id) + (after ? 1 : 0);
      moveBlock(page.id, dragged, targetIndex);
      dragBlock.current = null;
      setDropTarget(null);
    },
  });

  const openBlockMenu = (b: Block, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setBlockMenu({ blockId: b.id, x: Math.min(window.innerWidth - 250, r.left + 20), y: Math.min(window.innerHeight - 420, r.bottom + 6) });
  };

  const copyBlockText = async (b: Block) => {
    try { await navigator.clipboard.writeText(b.text); toast('Texto del bloque copiado'); }
    catch { toast('No se pudo copiar', 'err'); }
    setBlockMenu(null);
  };

  /* ------------------------------------------------------------ búsqueda */

  useEffect(() => {
    const css = (window as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS;
    const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (css?.highlights) {
      css.highlights.delete('takenotes-find');
      css.highlights.delete('takenotes-find-active');
    }
    if (!findOpen || !findQuery.trim() || !rootRef.current) {
      findRanges.current = [];
      setFindCount(0);
      return;
    }
    const ranges = collectFindRanges(rootRef.current, findQuery);
    findRanges.current = ranges;
    setFindCount(ranges.length);
    setFindIndex((i) => Math.min(i, Math.max(0, ranges.length - 1)));
    if (css?.highlights && HighlightCtor) {
      css.highlights.set('takenotes-find', new HighlightCtor(...ranges.map((r) => r.range)));
      const active = ranges[Math.min(findIndex, ranges.length - 1)];
      if (active) css.highlights.set('takenotes-find-active', new HighlightCtor(active.range));
    }
    return () => {
      if (css?.highlights) {
        css.highlights.delete('takenotes-find');
        css.highlights.delete('takenotes-find-active');
      }
    };
  }, [findOpen, findQuery, page.blocks, findIndex]);

  const moveFind = useCallback((dir: 1 | -1) => {
    if (findCount === 0) return;
    const next = (findIndex + dir + findCount) % findCount;
    setFindIndex(next);
    const range = findRanges.current[next]?.range;
    if (range) {
      const host = range.startContainer.parentElement;
      host?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [findCount, findIndex]);

  /* -------------------------------------------------------------- migas */

  const crumbs: Page[] = [];
  {
    let cur: Page | undefined = page;
    const seen = new Set<string>();
    while (cur?.parentId && !seen.has(cur.parentId)) {
      seen.add(cur.parentId);
      cur = byId.get(cur.parentId);
      if (cur) crumbs.unshift(cur);
    }
  }

  const addFileName = (name: string, src: string) => {
    const a = document.createElement('a');
    a.href = src;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const editorClass = [
    'editor',
    page.locked ? 'is-locked' : '',
    page.fullWidth ? 'is-fullwidth' : '',
    page.smallText ? 'is-small' : '',
    page.font === 'serif' ? 'font-serif' : page.font === 'mono' ? 'font-mono' : '',
    page.coverHeight ? `coverh-${page.coverHeight}` : '',
    dragOver ? 'is-page-drop' : '',
  ].filter(Boolean).join(' ');

  const contentFor = (b: Block): ReactNode => {
    const props = {
      className: `block-content${b.type === 'code' ? ' codecontent' : ''}`,
      contentEditable: !page.locked,
      suppressContentEditableWarning: true,
      spellCheck: b.type !== 'code',
      role: 'textbox',
      'aria-multiline': true,
      'aria-label': `Bloque ${b.type}`,
      'data-placeholder': placeholderFor(b.type),
      onInput: (e: React.FormEvent<HTMLElement>) => handleInput(b, e.currentTarget),
      onKeyDown: handleKeyDown(b),
      onBlur: handleBlur(b),
      onPaste: handlePaste(b),
      onClick: handleContentClick,
    };
    return <div {...props} />;
  };

  const specialBody = (b: Block): ReactNode | null => {
    if (b.type === 'subpage') {
      const target = b.pageId ? byId.get(b.pageId) : undefined;
      const usable = !!target && !target.trashed;
      return (
        <div className="block subpageblock">
          <div
            className={`subpagecard${usable ? '' : ' is-missing'}`}
            onDragOver={(e) => { if (usable && target && hasPageDrag(e)) { e.preventDefault(); e.stopPropagation(); } }}
            onDrop={(e) => {
              if (!usable || !target) return;
              const draggedId = getPageDrag(e);
              if (!draggedId) return;
              e.preventDefault(); e.stopPropagation();
              if (draggedId === target.id) return;
              if (!movePage(draggedId, target.id)) { setDropNotice('No puedes mover una página dentro de sí misma.'); return; }
              setDropNotice(`«${byId.get(draggedId)?.title || 'Sin título'}» ahora vive dentro de «${target.title || 'Sin título'}».`);
            }}
          >
            <button
              className="subpagecard__main"
              disabled={!usable}
              draggable={usable}
              onDragStart={(e) => target && setPageDrag(e, target.id)}
              onClick={() => target && usable && setActivePageId(target.id)}
              aria-label={usable ? `Abrir subpágina ${target.title || 'Sin título'}` : 'Subpágina no disponible'}
            >
              <span className="subpagecard__ic"><Icon name={((usable && target.icon) || 'subpage') as IconName} size={21} /></span>
              <span className="subpagecard__body">
                <span className="subpagecard__title">{usable ? (target.title || 'Sin título') : 'Subpágina no encontrada'}</span>
                <span className="subpagecard__meta">
                  {usable ? `Subpágina · ${childCount(target.id)} ${childCount(target.id) === 1 ? 'hija' : 'hijas'} · editada ${new Date(target.updated).toLocaleDateString('es', { day: 'numeric', month: 'short' })}` : 'La página se movió a la papelera o se eliminó'}
                </span>
              </span>
              {usable && <Icon name="arrowRight" size={16} />}
            </button>
            <button className="rowaction" title="Quitar tarjeta (la subpágina sigue en el árbol)" aria-label="Quitar tarjeta de subpágina" onClick={() => removeBlock(page.id, b.id)}>
              <Icon name="x" size={13} />
            </button>
          </div>
        </div>
      );
    }
    if (b.type === 'pageLink') {
      const target = b.pageId ? byId.get(b.pageId) : undefined;
      const usable = !!target && !target.trashed;
      return (
        <div className="block pagelinkblock">
          {!b.pageId || linkPickerFor === b.id ? (
            <div className="pagelink-wrap">
              <button className="pagelink-open" onClick={() => setLinkPickerFor(b.id)}>
                <Icon name="pageLink" size={15} /> {b.pageId ? 'Elegir otra página…' : 'Elegir página…'}
              </button>
              {linkPickerFor === b.id && (
                <PageLinkPicker
                  pages={pages}
                  excludeId={page.id}
                  onPick={(targetId) => { updateBlock(page.id, b.id, { pageId: targetId }); setLinkPickerFor(null); }}
                  onClose={() => setLinkPickerFor(null)}
                />
              )}
            </div>
          ) : (
            <div className={`pagelinkchip${usable ? '' : ' is-missing'}`}>
              <button className="pagelinkchip__main" disabled={!usable} onClick={() => usable && target && setActivePageId(target.id)}>
                <span className="pagelinkchip__ic"><Icon name={((usable && target.icon) || 'pageLink') as IconName} size={16} /></span>
                <span className="pagelinkchip__title">{usable ? (target.title || 'Sin título') : 'Página no disponible'}</span>
                <span className="pagelinkchip__label">Enlace a página</span>
              </button>
              <button className="rowaction" title="Quitar enlace" aria-label="Quitar enlace a página" onClick={() => removeBlock(page.id, b.id)}>
                <Icon name="x" size={13} />
              </button>
            </div>
          )}
        </div>
      );
    }
    if (b.type === 'toc') {
      const heads = page.blocks.filter((x) => x.type === 'h1' || x.type === 'h2' || x.type === 'h3');
      return (
        <div className="block block--toc">
          <div className="toc">
            <div className="toc__head">
              <span><Icon name="toc" size={14} /> Tabla de contenido</span>
              <button className="rowaction" title="Quitar índice" aria-label="Quitar tabla de contenido" onClick={() => removeBlock(page.id, b.id)}>
                <Icon name="x" size={13} />
              </button>
            </div>
            {heads.length > 0 ? (
              <div className="toc__list">
                {heads.map((h) => (
                  <button
                    key={h.id}
                    className={`toc__item toc__item--${h.type}`}
                    onClick={() => { blockEls.current.get(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); requestFocus(h.id); }}
                  >
                    {htmlToText(h.html || h.text) || 'Sin título'}
                  </button>
                ))}
              </div>
            ) : <p className="toc__empty">Añade encabezados H1–H3 y aparecerán aquí.</p>}
          </div>
        </div>
      );
    }
    if (b.type === 'image') {
      return (
        <div className="block imgblock">
          {b.src ? (
            <figure>
              <img src={b.src} alt={b.alt ?? ''} />
              <div className="imgbar">
                <input className="imgcaption" placeholder="Descripción…" value={b.alt ?? ''} aria-label="Descripción de la imagen" onChange={(e) => updateBlock(page.id, b.id, { alt: e.target.value })} />
                <button className="rowaction" title="Quitar imagen" aria-label="Quitar imagen" onClick={() => removeBlock(page.id, b.id)}><Icon name="x" size={14} /></button>
              </div>
            </figure>
          ) : (
            <ImageUploader
              onInsert={(src) => updateBlock(page.id, b.id, { src, alt: '' })}
              error={imageErr[b.id]}
              onError={(msg) => setImageErr((m) => ({ ...m, [b.id]: msg }))}
            />
          )}
        </div>
      );
    }
    if (b.type === 'file') {
      return (
        <div className="block fileblock">
          {b.src ? (
            <div className="filechip">
              <span className="filechip__ic"><Icon name="file" size={20} /></span>
              <span className="filechip__meta">
                <span className="filechip__name">{b.fileName ?? 'archivo'}</span>
                <span className="filechip__sub">{b.fileSize ? formatBytes(b.fileSize) : ''}{b.fileMime ? ` · ${b.fileMime.split('/').pop()}` : ''}</span>
              </span>
              <button className="filechip__btn" onClick={() => addFileName(b.fileName ?? 'archivo', b.src!)}><Icon name="download" size={13} /> Descargar</button>
              <button className="rowaction" title="Quitar archivo" aria-label="Quitar archivo" onClick={() => removeBlock(page.id, b.id)}><Icon name="x" size={14} /></button>
            </div>
          ) : (
            <FileUploader
              error={imageErr[b.id]}
              onError={(msg) => setImageErr((m) => ({ ...m, [b.id]: msg }))}
              onInsert={(src, fileName, fileSize, fileMime) => updateBlock(page.id, b.id, { src, fileName, fileSize, fileMime })}
            />
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div
      className={editorClass}
      ref={rootRef}
      style={{ position: 'relative' }}
      onDragOver={onEditorDragOver}
      onDragLeave={onEditorDragLeave}
      onDrop={onEditorDrop}
    >
      {page.cover && COVER_BY_ID.get(page.cover) && (
        <div className={`pagecover ${COVER_BY_ID.get(page.cover)!.className}`}>
          <div className="pagecover__actions">
            <button className="coverbtn" onClick={() => setCoverOpen(true)}><Icon name="cover" size={13} /> Cambiar</button>
            <button className="coverbtn" onClick={() => updatePage(page.id, { cover: undefined })}><Icon name="x" size={13} /> Quitar</button>
          </div>
        </div>
      )}

      {findOpen && (
        <FindBar
          query={findQuery}
          setQuery={(v) => { setFindQuery(v); setFindIndex(0); }}
          count={findCount}
          index={findIndex}
          onNext={() => moveFind(1)}
          onPrev={() => moveFind(-1)}
          onClose={() => { setFindOpen(false); setFindQuery(''); }}
        />
      )}

      <div className="pagecrumb">
        <Icon name="notebook" size={13} />
        {crumbs.length > 0 ? (
          <>
            {crumbs.map((p) => (
              <button
                key={p.id}
                className="crumb-link"
                draggable
                onDragStart={(e) => setPageDrag(e, p.id)}
                onDragOver={(e) => { if (hasPageDrag(e)) { e.preventDefault(); e.stopPropagation(); } }}
                onDrop={(e) => {
                  const draggedId = getPageDrag(e);
                  if (!draggedId) return;
                  e.preventDefault(); e.stopPropagation();
                  if (draggedId !== p.id && movePage(draggedId, p.id)) setDropNotice(`«${byId.get(draggedId)?.title || 'Sin título'}» se movió dentro de «${p.title || 'Sin título'}».`);
                }}
                onClick={() => setActivePageId(p.id)}
                title={`Ir a ${p.title || 'Sin título'} · arrastra para mover`}
              >
                {p.title || 'Sin título'}
              </button>
            ))}
            <span className="crumb-sep" aria-hidden="true">›</span>
            <span>{page.title || 'Sin título'}</span>
          </>
        ) : <span>Cuaderno <span aria-hidden="true">›</span> {page.title || 'Sin título'}</span>}
        <span style={{ flex: 1 }} />

        <div className="pagemenu-wrap">
          <button
            className="rowaction"
            title="Más acciones de la página"
            aria-label="Más acciones de la página"
            aria-expanded={pageMenuOpen}
            aria-haspopup="menu"
            onClick={() => setPageMenuOpen((v) => !v)}
          >
            <Icon name="more" size={17} />
          </button>
          {pageMenuOpen && (
            <div className="pagemenu" role="menu" aria-label="Acciones de la página">
              <p className="pagemenu__label">Página</p>
              <button role="menuitem" onClick={() => { duplicatePage(page.id); setPageMenuOpen(false); }}><Icon name="copy" size={15} /> Duplicar página</button>
              <button role="menuitem" onClick={() => { setMoveOpen(true); setPageMenuOpen(false); }}><Icon name="move" size={15} /> Mover a…</button>
              <button role="menuitem" onClick={() => { copyPageLink(page.id); setPageMenuOpen(false); }}><Icon name="link" size={15} /> Copiar enlace</button>
              <button role="menuitem" onClick={() => { setHistoryOpen(true); setPageMenuOpen(false); }}><Icon name="history" size={15} /> Historial de versiones</button>
              <button role="menuitem" onClick={() => { setPageMenuOpen(false); setPrintPageId(page.id); }}><Icon name="export" size={15} /> Imprimir / PDF</button>
              <button role="menuitem" onClick={() => { exportPageMarkdown(page.id); setPageMenuOpen(false); }}><Icon name="download" size={15} /> Exportar Markdown</button>
              <button role="menuitem" onClick={() => { exportPageHtml(page.id); setPageMenuOpen(false); }}><Icon name="download" size={15} /> Exportar HTML</button>
              <span className="pagemenu__sep" />
              <p className="pagemenu__label">Apariencia</p>
              <button role="menuitemcheckbox" aria-checked={!!page.fullWidth} onClick={() => updatePage(page.id, { fullWidth: !page.fullWidth })}>
                <Icon name="columns" size={15} /> Ancho completo
              </button>
              <button role="menuitemcheckbox" aria-checked={!!page.smallText} onClick={() => updatePage(page.id, { smallText: !page.smallText })}>
                <Icon name="text" size={15} /> Texto pequeño
              </button>
              <div className="pagemenu__fonts" role="group" aria-label="Tipografía">
                {([['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']] as [Page['font'], string][]).map(([f, label]) => (
                  <button key={f} className={(page.font ?? 'sans') === f ? 'is-active' : ''} onClick={() => updatePage(page.id, { font: f })}>
                    {label}
                  </button>
                ))}
              </div>
              {page.cover && (
                <>
                  <p className="pagemenu__label">Altura de portada</p>
                  <div className="pagemenu__fonts" role="group" aria-label="Altura de la portada">
                    {([['s', 'Baja'], ['m', 'Media'], ['l', 'Alta']] as ['s' | 'm' | 'l', string][]).map(([h, label]) => (
                      <button key={h} className={(page.coverHeight ?? 'm') === h ? 'is-active' : ''} onClick={() => updatePage(page.id, { coverHeight: h })}>
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <span className="pagemenu__sep" />
              <button role="menuitem" onClick={() => { updatePage(page.id, { locked: !page.locked }); setPageMenuOpen(false); toast(page.locked ? 'Página desbloqueada' : 'Página bloqueada', 'info'); }}>
                <Icon name={page.locked ? 'unlock' : 'lock'} size={15} /> {page.locked ? 'Desbloquear página' : 'Bloquear página'}
              </button>
            </div>
          )}
        </div>
        <button className="rowaction" title="Descargar página como Markdown" onClick={() => exportPageMarkdown(page.id)} aria-label="Descargar página como Markdown"><Icon name="export" size={15} /></button>
        <button className="rowaction" title={page.favorite ? 'Quitar de favoritos' : 'Guardar en favoritos'} onClick={() => toggleFavorite(page.id)} aria-label="Alternar favorito"><Icon name="star" size={15} filled={page.favorite} /></button>
        <button className="rowaction" title="Mover a la papelera" onClick={() => trashPage(page.id)} aria-label="Mover página a la papelera"><Icon name="trash" size={15} /></button>
      </div>

      <div className="titlerow">
        <div className="titleicon">
          <button className="titleicon" style={{ border: 'none', background: 'transparent' }} onClick={() => !page.locked && setIconPick((v) => !v)} aria-label="Cambiar sticker de página" aria-expanded={iconPick} disabled={page.locked}>
            <Icon name={(page.icon || 'doc') as IconName} size={26} />
          </button>
          {iconPick && (
            <div className="iconpick" role="dialog" aria-label="Elegir sticker de página">
              <div className="iconpick__search">
                <Icon name="search" size={14} />
                <input autoFocus value={iconQuery} onChange={(e) => setIconQuery(e.target.value)} placeholder="Buscar sticker…" aria-label="Buscar sticker" />
                <span className="iconpick__count">{iconGroups.reduce((n, g) => n + g.icons.length, 0)}</span>
              </div>
              <div className="iconpick__scroll">
                {iconGroups.map((group) => (
                  <div key={group.name} className="iconpick__group">
                    <p className="iconpick__groupname">{group.name}</p>
                    <div className="iconpick__grid">
                      {group.icons.map((ic) => (
                        <button key={ic.id} className={page.icon === ic.id ? 'is-sel' : ''} title={ic.label} aria-label={`Sticker ${ic.label}`} onClick={() => { updatePage(page.id, { icon: ic.id }); setIconPick(false); setIconQuery(''); }}>
                          <Icon name={ic.id} size={19} />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {iconGroups.length === 0 && <p className="iconpick__empty">Ningún sticker coincide con “{iconQuery}”.</p>}
              </div>
            </div>
          )}
        </div>
        <input
          className="titleinput"
          value={page.title}
          placeholder="Sin título"
          aria-label="Título de la página"
          readOnly={page.locked}
          onChange={(e) => updatePage(page.id, { title: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' && page.blocks[0] && !page.locked) { e.preventDefault(); requestFocus(page.blocks[0].id); } }}
        />
        {page.locked ? (
          <span className="lockedchip"><Icon name="lock" size={12} /> Bloqueada</span>
        ) : (
          <button className="btn-ghost subpageadd" onClick={createSubpage} title="Crear una página dentro de esta página"><Icon name="subpage" size={14} /> Subpágina</button>
        )}
      </div>

      {page.locked && (
        <div className="lockedbanner" role="status">
          <Icon name="lock" size={14} />
          <span>Esta página está bloqueada. Puedes leerla; para editarla, desbloquéala.</span>
          <button className="btn-ghost btn-ghost--small" onClick={() => updatePage(page.id, { locked: false })}>Desbloquear</button>
        </div>
      )}

      <div className="blocks">
        {visibleBlocks.map((b) => {
          const special = specialBody(b);
          const body = special ?? (
            <BlockBody
              block={b}
              number={numbering.get(b.id)}
              content={contentFor(b)}
              updateBlock={(patch) => updateBlock(page.id, b.id, patch)}
              onToast={toast}
            />
          );
          const isTarget = dropTarget?.id === b.id;
          return (
            <div
              key={`${b.id}:${b.type}:${b.pageId ?? ''}`}
              className={`blockrow${isTarget ? (dropTarget!.after ? ' is-drop-after' : ' is-drop-before') : ''}${page.locked ? ' is-locked' : ''}`}
              data-block-id={b.id}
              data-level={Math.min(4, Math.max(0, b.level))}
              ref={setBlockRef(b.id)}
              {...blockDrop(b)}
            >
              {!page.locked && (
                <button
                  className="blockhandle"
                  draggable
                  title="Arrastra para mover · clic para acciones"
                  aria-label="Acciones del bloque"
                  onDragStart={(e) => {
                    dragBlock.current = b.id;
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', `block:${b.id}`);
                  }}
                  onDragEnd={() => { dragBlock.current = null; setDropTarget(null); }}
                  onClick={(e) => openBlockMenu(b, e.currentTarget)}
                >
                  <Icon name="grip" size={13} />
                </button>
              )}
              <div
                className="blockbody"
                style={{ textAlign: b.align === 'center' ? 'center' : b.align === 'right' ? 'right' : undefined }}
              >
                {body}
              </div>
            </div>
          );
        })}
      </div>

      {extraSubpages.length > 0 && (
        <section className="childpages" aria-label="Páginas dentro de esta página">
          <div className="childpages__head">
            <p className="sectionlabel"><Icon name="subpage" size={14} /> Páginas dentro de esta página</p>
            <button className="btn-ghost btn-ghost--small" onClick={createSubpage}><Icon name="plus" size={12} /> Nueva</button>
          </div>
          <div className="childgrid">
            {extraSubpages.map((child) => (
              <button key={child.id} className="childcard" onClick={() => setActivePageId(child.id)}>
                <span className="childcard__ic"><Icon name={(child.icon || 'doc') as IconName} size={18} /></span>
                <span className="childcard__body">
                  <span className="childcard__title">{child.title || 'Sin título'}</span>
                  <span className="childcard__meta">{childCount(child.id)} {childCount(child.id) === 1 ? 'subpágina' : 'subpáginas'} · {new Date(child.updated).toLocaleDateString('es', { day: 'numeric', month: 'short' })}</span>
                </span>
                <Icon name="arrowRight" size={14} />
              </button>
            ))}
          </div>
        </section>
      )}

      {backlinks.length > 0 && (
        <section className="backlinks" aria-label="Páginas que mencionan esta página">
          <p className="sectionlabel"><Icon name="backlink" size={14} /> Mencionada en</p>
          <div className="backlinklist">
            {backlinks.map((source) => (
              <button key={source.id} className="backlinkitem" onClick={() => setActivePageId(source.id)}>
                <Icon name={(source.icon || 'doc') as IconName} size={15} />
                <span>{source.title || 'Sin título'}</span>
                <Icon name="arrowRight" size={13} />
              </button>
            ))}
          </div>
        </section>
      )}

      {!page.locked && (
        <div
          className={`pagepad${page.blocks.length === 0 ? ' is-empty' : ''}`}
          onClick={addParagraph}
          role="button"
          tabIndex={0}
          aria-label="Hacer clic para escribir un bloque nuevo"
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addParagraph(); } }}
        >
          <span className="pagepad__hint"><Icon name="plus" size={13} /> Haz clic en cualquier espacio libre para escribir…</span>
        </div>
      )}

      {coverOpen && (
        <CoverPicker
          current={page.cover}
          onPick={(cover) => { updatePage(page.id, { cover }); setCoverOpen(false); }}
          onRemove={() => { updatePage(page.id, { cover: undefined }); setCoverOpen(false); }}
          onClose={() => setCoverOpen(false)}
        />
      )}
      {moveOpen && (
        <MoveDialog page={page} pages={pages} onMove={(parentId) => { if (movePage(page.id, parentId)) setMoveOpen(false); }} onClose={() => setMoveOpen(false)} />
      )}
      {historyOpen && (
        <VersionHistory
          page={page}
          onClose={() => setHistoryOpen(false)}
          onSave={() => saveVersion(page.id)}
          onRestore={(id) => { restoreVersion(page.id, id); setHistoryOpen(false); }}
          onDelete={(id) => deleteVersion(page.id, id)}
        />
      )}

      {dropNotice && (
        <div className="dropnotice" role="status" aria-live="polite"><Icon name="subpage" size={14} /> {dropNotice}</div>
      )}

      {slash && (
        <SlashMenu
          query={slash.query}
          selected={slash.selected}
          onHover={(i) => setSlash((s) => (s ? { ...s, selected: i } : s))}
          onPick={applySlashPick}
          style={{ top: slashPos.top, left: slashPos.left }}
        />
      )}

      {mention && (
        <MentionMenu
          items={mentionItems}
          selected={mention.selected}
          onHover={(i) => setMention((m) => (m ? { ...m, selected: i } : m))}
          onPick={pickMention}
          style={{ top: mention.top, left: mention.left }}
        />
      )}

      {fmtBar && (
        <FormatToolbar
          top={fmtBar.top}
          left={fmtBar.left}
          onCommand={applyCommand}
          onCode={applyCode}
          onTone={applyTone}
          onClear={clearFormat}
          onLink={applyLink}
        />
      )}

      {blockMenu && menuBlock && (
        <BlockMenu
          block={menuBlock}
          x={blockMenu.x}
          y={blockMenu.y}
          index={menuIndex}
          total={page.blocks.length}
          onClose={() => setBlockMenu(null)}
          onDuplicate={() => { duplicateBlock(page.id, menuBlock.id); setBlockMenu(null); }}
          onDelete={() => { removeBlock(page.id, menuBlock.id); setBlockMenu(null); }}
          onMove={(dir) => { const to = menuIndex + dir; if (to >= 0 && to < page.blocks.length) moveBlock(page.id, menuBlock.id, to); setBlockMenu(null); }}
          onConvert={(type) => { convertBlockTo(menuBlock, type, !['divider', 'table', 'columns'].includes(type)); setBlockMenu(null); }}
          onTone={(patch) => updateBlock(page.id, menuBlock.id, patch)}
          onAlign={(align) => { updateBlock(page.id, menuBlock.id, { align }); setBlockMenu(null); }}
          onCopy={() => copyBlockText(menuBlock)}
        />
      )}
    </div>
  );
}

function PageLinkPicker({ pages, excludeId, onPick, onClose }: {
  pages: Page[];
  excludeId: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const items = pages
    .filter((p) => p.id !== excludeId && !p.trashed)
    .filter((p) => !q || `${p.title || 'Sin título'}`.toLowerCase().includes(q))
    .slice(0, 8);
  return (
    <div className="pagelink-picker" role="dialog" aria-label="Elegir una página para enlazar">
      <div className="pagelink-picker__search">
        <Icon name="search" size={13} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar página…"
          aria-label="Buscar página para enlazar"
          onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && items[0]) onPick(items[0].id); }}
        />
      </div>
      <div className="pagelink-picker__list">
        {items.length === 0 && <p className="pagelink-picker__empty">No hay otra página con ese nombre.</p>}
        {items.map((p) => (
          <button key={p.id} onClick={() => onPick(p.id)}>
            <Icon name={(p.icon || 'doc') as IconName} size={14} />
            <span>{p.title || 'Sin título'}</span>
            <Icon name="arrowRight" size={12} />
          </button>
        ))}
      </div>
    </div>
  );
}
