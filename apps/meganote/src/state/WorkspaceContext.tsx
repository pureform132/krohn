/* Estado del cuaderno: fuente única de verdad, con persistencia en IndexedDB (debounce). */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import {
  emptyBlock, emptyPage, newId, now,
  type AppStore, type Block, type BlockType, type DBState, type Notebook, type Page, type PageKind,
} from '../lib/types';
import { loadStore, saveStore } from '../lib/db';
import { seedStore } from '../lib/seed';
import { htmlToText } from '../lib/html';
import {
  workspaceToJSON, downloadFile, timestamp, pageToMarkdown, pageToHtml, slugify,
} from '../lib/export';
import { pageVersionOf } from '../lib/markdown';
import { PAGE_TEMPLATES, pageFromTemplate } from '../lib/templates';

export interface Toast {
  id: string;
  message: string;
  kind: 'ok' | 'info' | 'err';
}

export interface WorkspaceContextValue {
  loaded: boolean;
  saveError: string | null;
  saveState: 'idle' | 'saving' | 'saved';
  savedAt: number | null;
  pages: Page[];
  byId: Map<string, Page>;
  activePageId: string | null;
  setActivePageId: (id: string | null) => void;
  showTrash: boolean;
  setShowTrash: (v: boolean) => void;
  searchOpen: boolean;
  setSearchOpen: (v: boolean | ((v: boolean) => boolean)) => void;

  // navegación
  goBack: () => void;
  goForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  recentPages: Page[];
  focusMode: boolean;
  setFocusMode: (v: boolean | ((v: boolean) => boolean)) => void;

  // modales globales
  templatesOpen: boolean;
  setTemplatesOpen: (v: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (v: boolean) => void;
  printPageId: string | null;
  setPrintPageId: (id: string | null) => void;

  // toasts
  toasts: Toast[];
  toast: (message: string, kind?: Toast['kind']) => void;
  dismissToast: (id: string) => void;

  // notebooks (workspaces)
  notebooks: { id: string; name: string; icon: string }[];
  currentNotebookId: string;
  currentNotebookName: string;
  setCurrentNotebook: (id: string) => void;
  createNotebook: (name: string) => string;
  renameNotebook: (id: string, name: string) => void;

  createPage: (parentId: string | null, kind?: PageKind) => string;
  createPageFromTemplate: (templateId: string, parentId?: string | null) => string;
  duplicatePage: (id: string) => string;
  movePage: (id: string, parentId: string | null) => boolean;
  updatePage: (id: string, patch: Partial<Omit<Page, 'id' | 'created'>>) => void;
  toggleFavorite: (id: string) => void;
  trashPage: (id: string) => void;
  restorePage: (id: string) => void;
  deletePageForever: (id: string) => void;
  emptyTrash: () => void;
  trashCount: number;
  trashedPages: Page[];

  addBlock: (pageId: string, block: Block, index?: number) => void;
  insertBlocks: (pageId: string, blocks: Block[], index?: number) => void;
  updateBlock: (pageId: string, blockId: string, patch: Partial<Block>) => void;
  removeBlock: (pageId: string, blockId: string) => void;
  duplicateBlock: (pageId: string, blockId: string) => void;
  moveBlock: (pageId: string, blockId: string, index: number) => void;
  splitBlock: (pageId: string, blockId: string, beforeHtml: string, beforeText: string, afterHtml: string, afterText: string) => string;
  mergeIntoPrevious: (pageId: string, blockId: string) => void;
  focusRequest: { id: string; nonce: number } | null;
  requestFocus: (id: string) => void;

  updateDB: (pageId: string, updater: (db: DBState) => DBState) => void;
  importPages: (pages: Page[]) => number;

  // deshacer / rehacer
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Increments when undo/redo/restore rewrites page content, so editors can
      refresh a focused contenteditable whose DOM is now stale. */
  undoRevision: number;
  /** Starts a new undo group before a discrete action (formatting, etc.). */
  markUndoBoundary: () => void;

  // historial de versiones
  saveVersion: (pageId: string, label?: string) => void;
  restoreVersion: (pageId: string, versionId: string) => void;
  deleteVersion: (pageId: string, versionId: string) => void;

  exportBackup: () => void;
  exportPageMarkdown: (pageId: string) => void;
  exportPageHtml: (pageId: string) => void;
  copyPageLink: (pageId: string) => Promise<void>;
  importBackup: (file: File) => Promise<{ ok: boolean; error?: string; count?: number }>;
}

const Ctx = createContext<WorkspaceContextValue | null>(null);
const RECENTS_KEY = 'takenotes.recents';
const UNDO_LIMIT = 80;

function subtreeIds(pages: Page[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pages) {
      if (p.parentId && ids.has(p.parentId) && !ids.has(p.id)) {
        ids.add(p.id);
        grew = true;
      }
    }
  }
  return ids;
}

function loadRecents(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

function hashPageId(): string | null {
  const h = window.location.hash;
  const m = /^#\/p\/([A-Za-z0-9_-]+)/.exec(h);
  return m ? m[1] : null;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [store, setStore] = useState<AppStore | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [activePageId, setActivePageIdRaw] = useState<string | null>(null);
  const [showTrash, setShowTrashRaw] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [printPageId, setPrintPageId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>(loadRecents);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [undoRevision, setUndoRevision] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  const saveTimer = useRef<number | null>(null);
  const storeRef = useRef<AppStore | null>(null);
  const activeRef = useRef<string | null>(null);
  const undoRef = useRef<Page[][]>([]);
  const redoRef = useRef<Page[][]>([]);
  const lastUndo = useRef<{ at: number; key: string }>({ at: 0, key: '' });
  const mutationToken = useRef(0);
  const pushedToken = useRef(-1);
  const suppressUndo = useRef(false);
  const navPos = useRef(0);
  const navMax = useRef(0);

  useEffect(() => {
    storeRef.current = store;
  }, [store]);
  useEffect(() => {
    activeRef.current = activePageId;
  }, [activePageId]);

  const syncNavButtons = useCallback(() => {
    setCanGoBack(navPos.current > 0);
    setCanGoForward(navPos.current < navMax.current);
  }, []);

  const toast = useCallback((message: string, kind: Toast['kind'] = 'ok') => {
    const id = newId();
    setToasts((prev) => [...prev.slice(-3), { id, message, kind }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3600);
  }, []);
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const rememberRecent = useCallback((id: string | null) => {
    if (!id) return;
    setRecentIds((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 8);
      try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* almacenamiento lleno */ }
      return next;
    });
  }, []);

  const writeHash = useCallback((id: string | null, mode: 'push' | 'replace', idx: number) => {
    const url = id ? `#/p/${id}` : '#/';
    if (mode === 'push') window.history.pushState({ takenotes: true, idx }, '', url);
    else window.history.replaceState({ takenotes: true, idx }, '', url);
  }, []);

  const navigateTo = useCallback((id: string | null, mode: 'push' | 'replace' = 'push') => {
    setActivePageIdRaw(id);
    setShowTrashRaw(false);
    rememberRecent(id);
    if (mode === 'push') {
      navPos.current += 1;
      navMax.current = navPos.current;
      syncNavButtons();
    }
    writeHash(id, mode, navPos.current);
    lastUndo.current = { at: 0, key: '' };
  }, [rememberRecent, syncNavButtons, writeHash]);

  const setActivePageId = useCallback((id: string | null) => navigateTo(id, 'push'), [navigateTo]);

  const goBack = useCallback(() => {
    if (navPos.current <= 0) return;
    window.history.back();
  }, []);

  const goForward = useCallback(() => {
    if (navPos.current >= navMax.current) return;
    window.history.forward();
  }, []);

  // carga inicial (con migración de v1)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await loadStore();
        const initial = stored ?? seedStore();
        if (cancelled) return;
        setStore(initial);
        const nb = initial.notebooks.find((n) => n.id === initial.currentId) ?? initial.notebooks[0];
        const fromHash = hashPageId();
        const first = (fromHash && nb?.pages.find((p) => p.id === fromHash && !p.trashed)) || nb?.pages.find((p) => !p.trashed) || nb?.pages[0];
        setActivePageIdRaw(first?.id ?? null);
        if (first) {
          rememberRecent(first.id);
          writeHash(first.id, 'replace', 0);
        }
        if (!stored) await saveStore(initial);
      } catch (e) {
        if (!cancelled) {
          setStore(seedStore());
          setSaveError('No se pudo abrir el almacén local — los cambios pueden no guardarse. ' + (e instanceof Error ? e.message : ''));
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rememberRecent, writeHash]);

  // hash / historial del navegador
  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const id = hashPageId();
      if (id) {
        const s = storeRef.current;
        const nb = s?.notebooks.find((n) => n.id === s.currentId) ?? s?.notebooks[0];
        if (nb?.pages.some((p) => p.id === id && !p.trashed)) {
          setActivePageIdRaw(id);
          setShowTrashRaw(false);
          rememberRecent(id);
        }
      } else if (window.location.hash === '#/trash') {
        setShowTrashRaw(true);
      }
      const idx = typeof (event.state as { idx?: unknown } | null)?.idx === 'number'
        ? Number((event.state as { idx: number }).idx)
        : Math.max(0, navPos.current - 1);
      navPos.current = idx;
      navMax.current = Math.max(navMax.current, idx);
      syncNavButtons();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [rememberRecent, syncNavButtons]);

  // persistencia con debounce
  useEffect(() => {
    if (!loaded || !store) return;
    setSaveState('saving');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveStore(store)
        .then(() => {
          setSaveError(null);
          setSaveState('saved');
          setSavedAt(Date.now());
        })
        .catch((e) => {
          setSaveError(e instanceof Error ? e.message : 'No se pudo guardar');
          setSaveState('idle');
        });
    }, 350);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [store, loaded]);

  const notebooksMeta = useMemo(
    () => (store?.notebooks ?? []).map((n) => ({ id: n.id, name: n.name, icon: n.icon })),
    [store],
  );
  const currentNotebook = useMemo(
    () => store?.notebooks.find((n) => n.id === store.currentId) ?? store?.notebooks[0] ?? null,
    [store],
  );
  const pages = useMemo(() => currentNotebook?.pages ?? [], [currentNotebook]);
  const byId = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages]);
  const visiblePages = useMemo(() => pages.filter((p) => !p.trashed), [pages]);
  const trashedPages = useMemo(() => pages.filter((p) => p.trashed), [pages]);
  const trashCount = trashedPages.length;
  const recentPages = useMemo(
    () => recentIds.map((id) => byId.get(id)).filter((p): p is Page => !!p && !p.trashed).slice(0, 6),
    [recentIds, byId],
  );

  /**
   * Toda mutación pasa por aquí. Antes de aplicar, guarda una instantánea para
   * deshacer; las pulsaciones seguidas sobre la misma página se agrupan.
   */
  const updateCurrent = useCallback((fn: (pages: Page[]) => Page[]) => {
    const token = ++mutationToken.current;
    const key = activeRef.current ?? 'root';
    setStore((prev) => {
      if (!prev) return prev;
      const current = prev.notebooks.find((n) => n.id === prev.currentId) ?? prev.notebooks[0];
      if (!current) return prev;
      if (!suppressUndo.current) {
        const t = Date.now();
        if (pushedToken.current !== token && (t - lastUndo.current.at > 650 || lastUndo.current.key !== key)) {
          const snap = current.pages;
          undoRef.current.push(snap);
          if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift();
          redoRef.current = [];
          lastUndo.current = { at: t, key };
          setCanUndo(true);
          setCanRedo(false);
        }
        pushedToken.current = token;
      }
      const nextPages = fn(current.pages);
      const nextNotebooks = prev.notebooks.map((n) => (n.id === current.id ? { ...n, pages: nextPages } : n));
      return { ...prev, notebooks: nextNotebooks };
    });
  }, []);

  const replaceCurrentPages = useCallback((nextPages: Page[]) => {
    suppressUndo.current = true;
    setStore((prev) => {
      if (!prev) return prev;
      const current = prev.notebooks.find((n) => n.id === prev.currentId) ?? prev.notebooks[0];
      if (!current) return prev;
      return {
        ...prev,
        notebooks: prev.notebooks.map((n) => (n.id === current.id ? { ...n, pages: nextPages } : n)),
      };
    });
    suppressUndo.current = false;
    lastUndo.current = { at: 0, key: '' };
  }, []);

  const undo = useCallback(() => {
    const snap = undoRef.current.pop();
    if (!snap) return;
    const s = storeRef.current;
    const current = s?.notebooks.find((n) => n.id === s.currentId) ?? s?.notebooks[0];
    if (!current) return;
    redoRef.current.push(current.pages);
    replaceCurrentPages(snap);
    setCanUndo(undoRef.current.length > 0);
    setCanRedo(true);
    setUndoRevision((v) => v + 1);
    toast('Deshecho');
  }, [replaceCurrentPages, toast]);

  const redo = useCallback(() => {
    const snap = redoRef.current.pop();
    if (!snap) return;
    const s = storeRef.current;
    const current = s?.notebooks.find((n) => n.id === s.currentId) ?? s?.notebooks[0];
    if (!current) return;
    undoRef.current.push(current.pages);
    replaceCurrentPages(snap);
    setCanUndo(true);
    setCanRedo(redoRef.current.length > 0);
    setUndoRevision((v) => v + 1);
    toast('Rehecho');
  }, [replaceCurrentPages, toast]);

  const markUndoBoundary = useCallback(() => {
    lastUndo.current = { at: 0, key: '' };
  }, []);

  const touch = (patch: Partial<Page>) => ({ ...patch, updated: now() });

  const setCurrentNotebook = useCallback((id: string) => {
    setStore((prev) => {
      if (!prev) return prev;
      const target = prev.notebooks.find((n) => n.id === id);
      if (!target) return prev;
      return { ...prev, currentId: id };
    });
    undoRef.current = [];
    redoRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
    setActivePageIdRaw(null);
    setShowTrashRaw(false);
    setRecentIds([]);
    writeHash(null, 'replace', 0);
  }, [writeHash]);

  const createNotebook = useCallback((name: string) => {
    const id = newId();
    setStore((prev) => {
      const fresh: Notebook = {
        id,
        name: name.trim() || 'Nuevo workspace',
        icon: 'folder',
        created: now(),
        pages: [emptyPage(null, 'page')],
      };
      return prev
        ? { ...prev, notebooks: [...prev.notebooks, fresh], currentId: id }
        : prev;
    });
    undoRef.current = [];
    redoRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
    setActivePageIdRaw(null);
    setShowTrashRaw(false);
    return id;
  }, []);

  const renameNotebook = useCallback((id: string, name: string) => {
    setStore((prev) =>
      prev
        ? { ...prev, notebooks: prev.notebooks.map((n) => (n.id === id ? { ...n, name: name.trim() || n.name } : n)) }
        : prev,
    );
  }, []);

  const createPage = useCallback(
    (parentId: string | null, kind: PageKind = 'page') => {
      const p = emptyPage(parentId, kind);
      updateCurrent((prev) => [...prev, p]);
      navigateTo(p.id);
      return p.id;
    },
    [navigateTo, updateCurrent],
  );

  const createPageFromTemplate = useCallback(
    (templateId: string, parentId: string | null = null) => {
      const template = PAGE_TEMPLATES.find((t) => t.id === templateId);
      if (!template) return '';
      const p = pageFromTemplate(template);
      p.parentId = parentId;
      updateCurrent((prev) => [...prev, p]);
      setTemplatesOpen(false);
      navigateTo(p.id);
      toast(`Plantilla «${template.name}» creada`);
      return p.id;
    },
    [navigateTo, toast, updateCurrent],
  );

  const duplicatePage = useCallback(
    (id: string) => {
      const source = pages.find((p) => p.id === id);
      if (!source) return '';
      const ids = subtreeIds(pages, id);
      const ordered = pages.filter((p) => ids.has(p.id));
      const idMap = new Map(ordered.map((p) => [p.id, newId()]));
      const t = now();
      const copies: Page[] = ordered.map((p, index) => ({
        ...p,
        id: idMap.get(p.id)!,
        parentId: p.parentId && idMap.has(p.parentId) ? idMap.get(p.parentId)! : p.parentId,
        title: index === 0 ? (p.title ? `${p.title} (copia)` : 'Copia sin título') : p.title,
        favorite: false,
        trashed: false,
        created: t,
        updated: t,
        blocks: p.blocks.map((b) => ({
          ...b,
          id: newId(),
          pageId: b.pageId && idMap.has(b.pageId) ? idMap.get(b.pageId)! : b.pageId,
        })),
        db: p.db ? (JSON.parse(JSON.stringify(p.db)) as DBState) : undefined,
      }));
      const root = copies[0];
      if (!root) return '';
      updateCurrent((prev) => [...prev, ...copies]);
      navigateTo(root.id);
      toast('Página duplicada');
      return root.id;
    },
    [navigateTo, pages, toast, updateCurrent],
  );

  const movePage = useCallback(
    (id: string, parentId: string | null) => {
      if (id === parentId) return false;
      const ids = subtreeIds(pages, id);
      if (parentId && ids.has(parentId)) return false;
      updateCurrent((prev) =>
        prev.map((p) => (p.id === id ? { ...p, parentId, updated: now() } : p)),
      );
      return true;
    },
    [pages, updateCurrent],
  );

  const updatePage = useCallback(
    (id: string, patch: Partial<Omit<Page, 'id' | 'created'>>) => {
      updateCurrent((prev) => prev.map((p) => (p.id === id ? { ...p, ...touch(patch) } : p)));
    },
    [updateCurrent],
  );

  const toggleFavorite = useCallback(
    (id: string) => {
      updateCurrent((prev) => prev.map((p) => (p.id === id ? { ...p, favorite: !p.favorite } : p)));
    },
    [updateCurrent],
  );

  const trashPage = useCallback(
    (id: string) => {
      const ids = subtreeIds(pages, id);
      updateCurrent((prev) => prev.map((p) => (ids.has(p.id) ? { ...p, trashed: true } : p)));
      const act = activeRef.current;
      if (act && ids.has(act)) {
        setActivePageIdRaw(null);
        setShowTrashRaw(true);
        writeHash(null, 'replace', navPos.current);
      }
      toast('Página movida a la papelera', 'info');
    },
    [pages, toast, updateCurrent, writeHash],
  );

  const restorePage = useCallback(
    (id: string) => {
      const ids = subtreeIds(pages, id);
      updateCurrent((prev) => prev.map((p) => (ids.has(p.id) ? { ...p, trashed: false } : p)));
      toast('Página restaurada');
    },
    [pages, toast, updateCurrent],
  );

  const deletePageForever = useCallback(
    (id: string) => {
      const ids = subtreeIds(pages, id);
      updateCurrent((prev) => prev.filter((p) => !ids.has(p.id)));
      setActivePageIdRaw((cur) => (cur && ids.has(cur) ? null : cur));
      toast('Página eliminada para siempre', 'info');
    },
    [pages, toast, updateCurrent],
  );

  const emptyTrash = useCallback(() => {
    updateCurrent((prev) => prev.filter((p) => !p.trashed));
    setActivePageIdRaw(null);
    setShowTrashRaw(false);
    toast('Papelera vaciada', 'info');
  }, [toast, updateCurrent]);

  const addBlock = useCallback(
    (pageId: string, block: Block, index?: number) => {
      updateCurrent((prev) =>
        prev.map((p) => {
          if (p.id !== pageId) return p;
          const blocks = [...p.blocks];
          const at = index === undefined ? blocks.length : Math.max(0, Math.min(index, blocks.length));
          blocks.splice(at, 0, block);
          return { ...p, blocks, updated: now() };
        }),
      );
    },
    [updateCurrent],
  );

  const insertBlocks = useCallback(
    (pageId: string, blocks: Block[], index?: number) => {
      if (blocks.length === 0) return;
      updateCurrent((prev) =>
        prev.map((p) => {
          if (p.id !== pageId) return p;
          const next = [...p.blocks];
          const at = index === undefined ? next.length : Math.max(0, Math.min(index, next.length));
          next.splice(at, 0, ...blocks);
          return { ...p, blocks: next, updated: now() };
        }),
      );
    },
    [updateCurrent],
  );

  const updateBlock = useCallback(
    (pageId: string, blockId: string, patch: Partial<Block>) => {
      updateCurrent((prev) =>
        prev.map((p) =>
          p.id === pageId
            ? {
                ...p,
                updated: now(),
                blocks: p.blocks.map((b) => (b.id === blockId ? { ...b, ...patch, text: patch.text ?? (patch.html !== undefined ? htmlToText(patch.html) : b.text) } : b)),
              }
            : p,
        ),
      );
    },
    [updateCurrent],
  );

  const removeBlock = useCallback(
    (pageId: string, blockId: string) => {
      updateCurrent((prev) =>
        prev.map((p) => {
          if (p.id !== pageId) return p;
          const blocks = p.blocks.filter((b) => b.id !== blockId);
          return { ...p, blocks: blocks.length ? blocks : [emptyBlock('text')], updated: now() };
        }),
      );
    },
    [updateCurrent],
  );

  const duplicateBlock = useCallback(
    (pageId: string, blockId: string) => {
      updateCurrent((prev) =>
        prev.map((p) => {
          if (p.id !== pageId) return p;
          const i = p.blocks.findIndex((b) => b.id === blockId);
          if (i < 0) return p;
          const src = p.blocks[i];
          const copy: Block = JSON.parse(JSON.stringify(src)) as Block;
          copy.id = newId();
          if (copy.columns) copy.columns = copy.columns.map((c) => ({ ...c, id: newId() }));
          const blocks = [...p.blocks];
          blocks.splice(i + 1, 0, copy);
          return { ...p, blocks, updated: now() };
        }),
      );
      toast('Bloque duplicado');
    },
    [toast, updateCurrent],
  );

  const moveBlock = useCallback(
    (pageId: string, blockId: string, index: number) => {
      updateCurrent((prev) =>
        prev.map((p) => {
          if (p.id !== pageId) return p;
          const from = p.blocks.findIndex((b) => b.id === blockId);
          if (from < 0) return p;
          const blocks = [...p.blocks];
          const [moved] = blocks.splice(from, 1);
          let to = Math.max(0, Math.min(index, blocks.length + 1));
          if (to > from) to -= 1;
          blocks.splice(to, 0, moved);
          return { ...p, blocks, updated: now() };
        }),
      );
    },
    [updateCurrent],
  );

  const splitBlock = useCallback(
    (pageId: string, blockId: string, beforeHtml: string, beforeText: string, afterHtml: string, afterText: string) => {
      const newId2 = newId();
      updateCurrent((prev) =>
        prev.map((p) => {
          if (p.id !== pageId) return p;
          const i = p.blocks.findIndex((b) => b.id === blockId);
          if (i < 0) return p;
          const src = p.blocks[i];
          const childType: BlockType =
            src.type === 'bulleted' || src.type === 'numbered' || src.type === 'todo' || src.type === 'toggle' ? src.type : 'text';
          const before: Block = { ...src, html: beforeHtml, text: beforeText };
          const after: Block = {
            id: newId2,
            type: childType,
            html: afterHtml,
            text: afterText,
            level: src.level,
            checked: childType === 'todo' ? false : undefined,
            open: childType === 'toggle' ? true : undefined,
            align: src.align,
          };
          const blocks = [...p.blocks];
          blocks.splice(i, 1, before, after);
          return { ...p, blocks, updated: now() };
        }),
      );
      return newId2;
    },
    [updateCurrent],
  );

  const mergeIntoPrevious = useCallback(
    (pageId: string, blockId: string) => {
      updateCurrent((prev) =>
        prev.map((p) => {
          if (p.id !== pageId) return p;
          const i = p.blocks.findIndex((b) => b.id === blockId);
          if (i <= 0) return p;
          const prevBlock = p.blocks[i - 1];
          const cur = p.blocks[i];
          if (['divider', 'image', 'file', 'table', 'columns', 'bookmark', 'embed', 'video', 'audio', 'equation', 'toc', 'subpage', 'pageLink'].includes(prevBlock.type)) return p;
          const merged: Block = {
            ...prevBlock,
            html: prevBlock.html + cur.html,
            text: (prevBlock.text + ' ' + cur.text).trim(),
          };
          const blocks = [...p.blocks];
          blocks.splice(i - 1, 2, merged);
          return { ...p, blocks, updated: now() };
        }),
      );
    },
    [updateCurrent],
  );

  const requestFocus = useCallback((id: string) => {
    setFocusRequest({ id, nonce: Date.now() });
  }, []);

  const updateDB = useCallback(
    (pageId: string, updater: (db: DBState) => DBState) => {
      updateCurrent((prev) =>
        prev.map((p) => (p.id === pageId && p.db ? { ...p, db: updater(p.db), updated: now() } : p)),
      );
    },
    [updateCurrent],
  );

  const importPages = useCallback(
    (incoming: Page[]) => {
      if (incoming.length === 0) return 0;
      updateCurrent((prev) => [...prev, ...incoming]);
      toast(`${incoming.length} páginas importadas`);
      return incoming.length;
    },
    [toast, updateCurrent],
  );

  const saveVersion = useCallback(
    (pageId: string, label?: string) => {
      const p = pages.find((x) => x.id === pageId);
      if (!p) return;
      const version = pageVersionOf(p, label || 'Versión manual');
      updatePage(pageId, { history: [version, ...(p.history ?? [])].slice(0, 30) });
      toast('Versión guardada');
    },
    [pages, toast, updatePage],
  );

  const restoreVersion = useCallback(
    (pageId: string, versionId: string) => {
      const p = pages.find((x) => x.id === pageId);
      const version = p?.history?.find((v) => v.id === versionId);
      if (!p || !version) return;
      const current = pageVersionOf(p, 'Antes de restaurar');
      updatePage(pageId, {
        title: version.title,
        icon: version.icon,
        cover: version.cover,
        blocks: JSON.parse(JSON.stringify(version.blocks)) as Block[],
        db: version.db ? (JSON.parse(JSON.stringify(version.db)) as DBState) : p.db,
        history: [current, ...(p.history ?? []).filter((v) => v.id !== versionId)].slice(0, 30),
      });
      setUndoRevision((v) => v + 1);
      toast('Versión restaurada');
    },
    [pages, toast, updatePage],
  );

  const deleteVersion = useCallback(
    (pageId: string, versionId: string) => {
      const p = pages.find((x) => x.id === pageId);
      if (!p) return;
      updatePage(pageId, { history: (p.history ?? []).filter((v) => v.id !== versionId) });
      toast('Versión eliminada', 'info');
    },
    [pages, toast, updatePage],
  );

  const exportBackup = useCallback(() => {
    const s = storeRef.current;
    if (!s) return;
    downloadFile(`takenotes-backup-${timestamp()}.json`, workspaceToJSON(s), 'application/json');
    toast('Copia de seguridad descargada');
  }, [toast]);

  const exportPageMarkdown = useCallback((pageId: string) => {
    const s = storeRef.current;
    const current = s?.notebooks.find((n) => n.id === s.currentId) ?? s?.notebooks[0];
    const p = current?.pages.find((x) => x.id === pageId);
    if (!p) return;
    downloadFile(`takenotes-${slugify(p.title || 'sin-titulo')}-${timestamp()}.md`, pageToMarkdown(p, current?.pages), 'text/markdown');
    toast('Markdown descargado');
  }, [toast]);

  const exportPageHtml = useCallback((pageId: string) => {
    const s = storeRef.current;
    const current = s?.notebooks.find((n) => n.id === s.currentId) ?? s?.notebooks[0];
    const p = current?.pages.find((x) => x.id === pageId);
    if (!p) return;
    downloadFile(`takenotes-${slugify(p.title || 'sin-titulo')}-${timestamp()}.html`, pageToHtml(p, current?.pages), 'text/html');
    toast('HTML descargado');
  }, [toast]);

  const copyPageLink = useCallback(async (pageId: string) => {
    const url = `${window.location.origin}${window.location.pathname}#/p/${pageId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Enlace copiado al portapapeles');
    } catch {
      const area = document.createElement('textarea');
      area.value = url;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); toast('Enlace copiado al portapapeles'); }
      catch { toast('No se pudo copiar el enlace', 'err'); }
      area.remove();
    }
  }, [toast]);

  const importBackup = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as unknown;
      if (!data || typeof data !== 'object') return { ok: false, error: 'Archivo de backup no válido.' };
      const d = data as Record<string, unknown>;

      if (d.version === 2 && Array.isArray(d.notebooks)) {
        const notebooks = (d.notebooks as unknown[]).filter(
          (n): n is Notebook =>
            !!n && typeof n === 'object' && typeof (n as Notebook).id === 'string' &&
            typeof (n as Notebook).name === 'string' && Array.isArray((n as Notebook).pages),
        );
        if (notebooks.length === 0) return { ok: false, error: 'El backup no contiene ningún notebook válido.' };
        const normalized: Notebook[] = notebooks.map((n) => ({
          ...n,
          pages: n.pages.map(normalizePage),
        }));
        const store: AppStore = {
          version: 2,
          notebooks: normalized,
          currentId: typeof d.currentId === 'string' && normalized.some((n) => n.id === d.currentId) ? (d.currentId as string) : normalized[0].id,
        };
        setStore(store);
        setActivePageIdRaw(store.notebooks.find((n) => n.id === store.currentId)?.pages[0]?.id ?? null);
        setShowTrashRaw(false);
        undoRef.current = [];
        redoRef.current = [];
        setCanUndo(false);
        setCanRedo(false);
        await saveStore(store);
        toast('Backup restaurado');
        return { ok: true, count: store.notebooks.reduce((a, n) => a + n.pages.length, 0) };
      }

      if (d.version === 1 && Array.isArray(d.pages)) {
        const valid = (d.pages as unknown[]).filter(
          (p): p is Page =>
            !!p && typeof p === 'object' &&
            typeof (p as Page).id === 'string' &&
            typeof (p as Page).title === 'string' &&
            Array.isArray((p as Page).blocks),
        );
        if (valid.length === 0) return { ok: false, error: 'El backup no contiene páginas válidas.' };
        const notebook: Notebook = {
          id: newId(),
          name: 'Personal',
          icon: 'leaf',
          created: now(),
          pages: valid.map(normalizePage),
        };
        const store: AppStore = { version: 2, notebooks: [notebook], currentId: notebook.id };
        setStore(store);
        setActivePageIdRaw(notebook.pages[0]?.id ?? null);
        setShowTrashRaw(false);
        undoRef.current = [];
        redoRef.current = [];
        setCanUndo(false);
        setCanRedo(false);
        await saveStore(store);
        toast('Backup restaurado');
        return { ok: true, count: notebook.pages.length };
      }

      return { ok: false, error: 'Formato no reconocido — se esperaba un backup Takenotes (v1 o v2).' };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'No se pudo leer el archivo de backup.' };
    }
  }, [toast]);

  const setShowTrash = useCallback((v: boolean) => {
    setShowTrashRaw(v);
    if (v) {
      setActivePageIdRaw(null);
      writeHash(null, 'replace', navPos.current);
      window.history.replaceState({ takenotes: true, idx: navPos.current }, '', '#/trash');
    }
  }, [writeHash]);

  const value: WorkspaceContextValue = {
    loaded,
    saveError,
    saveState,
    savedAt,
    pages: visiblePages,
    byId,
    activePageId,
    setActivePageId,
    showTrash,
    setShowTrash,
    searchOpen,
    setSearchOpen,
    goBack,
    goForward,
    canGoBack,
    canGoForward,
    recentPages,
    focusMode,
    setFocusMode,
    templatesOpen,
    setTemplatesOpen,
    shortcutsOpen,
    setShortcutsOpen,
    printPageId,
    setPrintPageId,
    toasts,
    toast,
    dismissToast,
    notebooks: notebooksMeta,
    currentNotebookId: currentNotebook?.id ?? '',
    currentNotebookName: currentNotebook?.name ?? 'Workspace',
    setCurrentNotebook,
    createNotebook,
    renameNotebook,
    createPage,
    createPageFromTemplate,
    duplicatePage,
    movePage,
    updatePage,
    toggleFavorite,
    trashPage,
    restorePage,
    deletePageForever,
    emptyTrash,
    trashCount,
    trashedPages,
    addBlock,
    insertBlocks,
    updateBlock,
    removeBlock,
    duplicateBlock,
    moveBlock,
    splitBlock,
    mergeIntoPrevious,
    focusRequest,
    requestFocus,
    updateDB,
    importPages,
    undo,
    redo,
    canUndo,
    canRedo,
    undoRevision,
    markUndoBoundary,
    saveVersion,
    restoreVersion,
    deleteVersion,
    exportBackup,
    exportPageMarkdown,
    exportPageHtml,
    copyPageLink,
    importBackup,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function normalizePage(p: Page): Page {
  return {
    ...p,
    favorite: !!p.favorite,
    trashed: !!p.trashed,
    blocks: (p.blocks ?? []).map((b) => ({ ...b, html: b.html ?? '', text: b.text ?? '', level: b.level ?? 0 })),
    parentId: typeof p.parentId === 'string' ? p.parentId : null,
    history: Array.isArray(p.history) ? p.history : [],
  };
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWorkspace debe usarse dentro de WorkspaceProvider');
  return ctx;
}
