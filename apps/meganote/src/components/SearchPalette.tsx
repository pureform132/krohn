import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from '../state/WorkspaceContext';
import { Icon, type IconName } from '../lib/icons';
import { htmlToText, escapeHtml } from '../lib/html';
import { databaseToCsv, downloadFile, slugify } from '../lib/export';
import type { Page } from '../lib/types';
import { foldAccents } from '../lib/text';

interface Hit {
  page: Page;
  score: number;
  snippet: string | null;
}

interface Command {
  id: string;
  label: string;
  hint: string;
  icon: IconName;
  keywords: string;
  shortcut?: string;
  quick?: boolean;
  disabled?: boolean;
  run: () => void;
}

type PaletteItem =
  | { kind: 'command'; command: Command }
  | { kind: 'page'; hit: Hit };

function subsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return false;
}

function rank(p: Page, qRaw: string): Hit | null {
  const q = foldAccents(qRaw);
  const title = foldAccents(p.title || 'Sin título');
  let score = 0;
  if (title.includes(q)) score = 1000 - title.indexOf(q);
  else if (subsequence(q, title)) score = 400;
  else score = 0;

  let snippet: string | null = null;
  for (const b of p.blocks) {
    if (b.type === 'divider' || b.type === 'image') continue;
    const t = htmlToText(b.html || b.text);
    const i = foldAccents(t).indexOf(q);
    if (i >= 0) {
      score = Math.max(score, 700 - i);
      const start = Math.max(0, i - 36);
      const end = Math.min(t.length, i + q.length + 60);
      snippet = (start > 0 ? '…' : '') + t.slice(start, end) + (end < t.length ? '…' : '');
      break;
    }
  }

  if (p.kind === 'database' && p.db) {
    for (const r of p.db.rows) {
      const text = Object.entries(r.cells)
        .map(([cid, v]) => {
          if (v === null || v === undefined || v === '') return '';
          const col = p.db!.columns.find((c) => c.id === cid);
          if (!col) return String(v);
          if (col.type === 'select') return col.options?.find((o) => o.id === v)?.label ?? String(v);
          if (col.type === 'multiselect') {
            const arr = Array.isArray(v) ? v : [];
            return arr.map((id) => col.options?.find((o) => o.id === id)?.label ?? String(id)).join(' ');
          }
          if (col.type === 'checkbox') return v ? 'sí' : '';
          return String(v);
        })
        .join(' ');
      const folded = foldAccents(text);
      const i = folded.indexOf(q);
      if (i >= 0) {
        score = Math.max(score, 650 - i);
        const start = Math.max(0, i - 36);
        const end = Math.min(text.length, i + q.length + 60);
        snippet = 'Fila · ' + (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
        break;
      }
    }
  }
  if (score <= 0) return null;
  return { page: p, score, snippet };
}

export function SearchPalette() {
  const {
    pages, byId, activePageId, searchOpen, setSearchOpen, setActivePageId, setShowTrash,
    createPage, setTemplatesOpen, setPrintPageId, exportPageMarkdown, exportPageHtml,
    focusMode, setFocusMode, setShortcutsOpen, copyPageLink, recentPages,
    undo, redo, canUndo, canRedo, toast,
  } = useWorkspace();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && searchOpen) {
        e.preventDefault();
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen, setSearchOpen]);

  useEffect(() => {
    if (searchOpen) {
      setQuery('');
      setSelected(0);
      const t = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(t);
    }
  }, [searchOpen]);

  const activePage = activePageId ? byId.get(activePageId) : undefined;

  const commands: Command[] = useMemo(() => {
    const list: Command[] = [
      {
        id: 'new-page', label: 'Nueva página', hint: 'Crear una página en blanco', icon: 'plus', keywords: 'crear pagina nueva blank', quick: true,
        run: () => createPage(null, 'page'),
      },
      {
        id: 'new-db', label: 'Nueva base de datos', hint: 'Crear una base de datos vacía', icon: 'table', keywords: 'crear database tabla', quick: true,
        run: () => createPage(null, 'database'),
      },
      {
        id: 'templates', label: 'Abrir plantillas', hint: 'Empezar con un diseño listo', icon: 'sparkles', keywords: 'plantilla template diseño', quick: true,
        run: () => setTemplatesOpen(true),
      },
      {
        id: 'focus', label: focusMode ? 'Salir del modo concentración' : 'Modo concentración', hint: 'Ocultar el ruido y centrarte', icon: 'target', keywords: 'focus concentracion zen', quick: true,
        run: () => setFocusMode((v) => !v),
      },
      {
        id: 'shortcuts', label: 'Ver atajos de teclado', hint: 'Todos los atajos disponibles', icon: 'keyboard', keywords: 'atajos teclado shortcuts ayuda', quick: true,
        run: () => setShortcutsOpen(true),
      },
      {
        id: 'trash', label: 'Abrir papelera', hint: 'Restaurar o borrar páginas', icon: 'trash', keywords: 'papelera basura restaurar',
        run: () => { setShowTrash(true); setSearchOpen(false); },
      },
      {
        id: 'undo', label: 'Deshacer', hint: 'Volver al estado anterior', icon: 'undo', keywords: 'undo deshacer atras', shortcut: 'Ctrl Z', disabled: !canUndo,
        run: undo,
      },
      {
        id: 'redo', label: 'Rehacer', hint: 'Recuperar el cambio deshecho', icon: 'redo', keywords: 'redo rehacer adelante', shortcut: 'Ctrl Y', disabled: !canRedo,
        run: redo,
      },
    ];
    if (activePage) {
      list.push(
        {
          id: 'print', label: 'Imprimir / guardar PDF', hint: `Preparar «${activePage.title || 'Sin título'}»`, icon: 'export', keywords: 'imprimir print pdf',
          run: () => setPrintPageId(activePage.id),
        },
        {
          id: 'copy-link', label: 'Copiar enlace de la página', hint: 'Enlace profundo a esta página', icon: 'link', keywords: 'copiar enlace link url',
          run: () => copyPageLink(activePage.id),
        },
        {
          id: 'export-md', label: 'Exportar Markdown', hint: 'Descargar esta página en .md', icon: 'download', keywords: 'exportar markdown md descargar',
          run: () => exportPageMarkdown(activePage.id),
        },
        {
          id: 'export-html', label: 'Exportar HTML', hint: 'Descargar una página HTML autónoma', icon: 'file', keywords: 'exportar html web descargar',
          run: () => exportPageHtml(activePage.id),
        },
      );
      if (activePage.kind === 'database' && activePage.db) {
        list.push({
          id: 'export-csv', label: 'Exportar CSV de la base de datos', hint: 'Descargar las filas como .csv', icon: 'table', keywords: 'exportar csv excel hoja',
          run: () => {
            downloadFile(`${slugify(activePage.title || 'base-de-datos')}.csv`, databaseToCsv(activePage), 'text/csv;charset=utf-8');
            toast('CSV exportado');
          },
        });
      }
    }
    return list;
  }, [
    activePage, canRedo, canUndo, copyPageLink, createPage, exportPageHtml, exportPageMarkdown,
    focusMode, redo, setFocusMode, setPrintPageId, setSearchOpen, setShowTrash, setShortcutsOpen,
    setTemplatesOpen, toast, undo,
  ]);

  const pageResults: Hit[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      const recent = recentPages.filter((p) => !p.trashed);
      const base = recent.length > 0 ? recent : [...pages].sort((a, b) => b.updated - a.updated);
      return base.slice(0, 6).map((page) => ({ page, score: 1, snippet: null }));
    }
    return pages
      .map((p) => rank(p, q))
      .filter((h): h is Hit => h !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [pages, query, recentPages]);

  const commandHits = useMemo(() => {
    const q = foldAccents(query.trim().replace(/^>\s*/, ''));
    if (!q) return commands.filter((c) => c.quick);
    return commands.filter((c) => {
      const hay = foldAccents(`${c.label} ${c.hint} ${c.keywords}`);
      return hay.includes(q) || subsequence(q, hay);
    });
  }, [commands, query]);

  const items: PaletteItem[] = useMemo(() => {
    const onlyCommands = query.trim().startsWith('>');
    if (onlyCommands) {
      return commandHits.map((command): PaletteItem => ({ kind: 'command', command }));
    }
    // Con una búsqueda activa, las páginas (mejor coincidencia primero) mandan;
    // las acciones quedan debajo y la selección por defecto cae en la página.
    return [
      ...pageResults.map((hit): PaletteItem => ({ kind: 'page', hit })),
      ...commandHits.map((command): PaletteItem => ({ kind: 'command', command })),
    ];
  }, [commandHits, pageResults, query]);

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    if (selected > items.length - 1) setSelected(Math.max(0, items.length - 1));
  }, [items.length, selected]);

  useEffect(() => {
    listRef.current?.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!searchOpen) return null;

  const open = (pageId: string) => {
    setActivePageId(pageId);
    setShowTrash(false);
    setSearchOpen(false);
  };

  const runCommand = (command: Command) => {
    if (command.disabled) return;
    setSearchOpen(false);
    command.run();
  };

  const q = query.trim();
  const highlight = (text: string) => {
    if (!q) return escapeHtml(text);
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return escapeHtml(text);
    return (
      escapeHtml(text.slice(0, idx)) +
      '<mark>' + escapeHtml(text.slice(idx, idx + q.length)) + '</mark>' +
      escapeHtml(text.slice(idx + q.length))
    );
  };

  return (
    <div className="palette-backdrop" onMouseDown={() => setSearchOpen(false)} role="dialog" aria-modal="true" aria-label="Buscar páginas y acciones">
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette__inputrow">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            className="palette__input"
            value={query}
            placeholder="Buscar páginas o escribe > para acciones…"
            aria-label="Buscar páginas o acciones"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(Math.max(0, items.length - 1), s + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(0, s - 1)); }
              else if (e.key === 'Enter' && items[selected]) {
                e.preventDefault();
                const item = items[selected];
                if (item.kind === 'command') runCommand(item.command);
                else open(item.hit.page.id);
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette__list" ref={listRef} role="listbox">
          {items.length === 0 && (
            <p className="palette__empty">Nada coincide con “{query}”.<br />Prueba con menos letras, escribe <b>&gt;</b> para ver acciones o revisa la papelera.</p>
          )}
          {items.map((item, i) => {
            const previous = items[i - 1];
            const showHead = !previous || previous.kind !== item.kind;
            if (item.kind === 'command') {
              return (
                <div key={`cmd-${item.command.id}`}>
                  {showHead && (
                    <p className="slash__head" style={{ padding: '6px 10px 2px' }}>
                      {q ? 'Acciones' : 'Acciones rápidas'}
                    </p>
                  )}
                  <button
                    role="option"
                    aria-selected={i === selected}
                    aria-disabled={item.command.disabled}
                    className={`palette__item palette__item--cmd${i === selected ? ' is-sel' : ''}${item.command.disabled ? ' is-disabled' : ''}`}
                    onMouseEnter={() => setSelected(i)}
                    onClick={() => runCommand(item.command)}
                  >
                    <span className="pi-ic"><Icon name={item.command.icon} size={16} /></span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="pi-title">{item.command.label}</span>
                      <br />
                      <span className="pi-snippet">{item.command.hint}</span>
                    </span>
                    {item.command.shortcut && <kbd className="palette__shortcut">{item.command.shortcut}</kbd>}
                  </button>
                </div>
              );
            }
            return (
              <div key={`page-${item.hit.page.id}`}>
                {showHead && (
                  <p className="slash__head" style={{ padding: '6px 10px 2px' }}>
                    {q ? 'Páginas' : 'Recientes'}
                  </p>
                )}
                <button
                  role="option"
                  aria-selected={i === selected}
                  className={`palette__item${i === selected ? ' is-sel' : ''}`}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => open(item.hit.page.id)}
                >
                  <span className="pi-ic"><Icon name={(item.hit.page.icon || 'doc') as IconName} size={16} /></span>
                  <span style={{ minWidth: 0 }}>
                    <span className="pi-title">{item.hit.page.title || 'Sin título'}</span>
                    {item.hit.snippet && <br />}
                    {item.hit.snippet && <span className="pi-snippet" dangerouslySetInnerHTML={{ __html: highlight(item.hit.snippet) }} />}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette__foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
          <span><kbd>↵</kbd> abrir</span>
          <span><kbd>&gt;</kbd> acciones</span>
          <span><kbd>Esc</kbd> cerrar</span>
        </div>
      </div>
    </div>
  );
}
