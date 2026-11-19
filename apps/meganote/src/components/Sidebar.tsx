import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import Papa from 'papaparse';
import { useWorkspace } from '../state/WorkspaceContext';
import { Icon, type IconName } from '../lib/icons';
import { getPageDrag, hasPageDrag, setPageDrag } from '../lib/pageDrag';
import { parseNotionExport } from '../lib/notionImport';
import { currentTheme, toggleTheme, type Theme } from '../lib/theme';
import { databaseToCsv, downloadFile, slugify } from '../lib/export';
import { newId, type Page, type PropertyType } from '../lib/types';

const EXPANDED_KEY = 'takenotes.expanded';
const WIDTH_KEY = 'takenotes.sidebarWidth';

function loadExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    pages, byId, activePageId, setActivePageId, createPage, movePage, toggleFavorite, trashPage,
    setSearchOpen, setShowTrash, showTrash, trashCount, recentPages,
    notebooks, currentNotebookId, currentNotebookName, setCurrentNotebook, createNotebook, renameNotebook,
    exportBackup, importBackup, importPages, saveState, savedAt,
    updatePage, updateDB, setTemplatesOpen, setShortcutsOpen, setFocusMode, focusMode,
    setPrintPageId, exportPageMarkdown, exportPageHtml, toast, copyPageLink,
  } = useWorkspace();
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const [dropId, setDropId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const raw = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(raw) && raw >= 220 && raw <= 420 ? raw : 264;
  });
  const [csvBusy, setCsvBusy] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);

  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const [creatingWs, setCreatingWs] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [renamingWsId, setRenamingWsId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const wsRef = useRef<HTMLDivElement>(null);

  const [theme, setTheme] = useState<Theme>(() => currentTheme());
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [notionHelp, setNotionHelp] = useState(false);
  const [notionBusy, setNotionBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const notionFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
  }, [expanded]);

  useEffect(() => {
    localStorage.setItem(WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  const activePage = activePageId ? byId.get(activePageId) : undefined;

  const importCsv = async (file: File) => {
    setCsvBusy(true);
    try {
      const text = await file.text();
      const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
      const data = (parsed.data ?? []).filter((r) => Array.isArray(r) && r.some((v) => String(v ?? '').trim() !== ''));
      if (data.length === 0) {
        setNotice({ kind: 'err', text: 'El CSV está vacío o no se pudo leer.' });
        return;
      }
      const header = data[0].map((h, i) => String(h ?? '').trim() || `Columna ${i + 1}`);
      const body = data.slice(1);
      const valuesByCol = header.map((_, i) => body.map((r) => String(r[i] ?? '').trim()).filter(Boolean));
      const infer = (values: string[]): PropertyType => {
        if (values.length === 0) return 'text';
        if (values.every((v) => /^(sí|si|no|true|false|0|1|x)$/i.test(v))) return 'checkbox';
        if (values.every((v) => v !== '' && Number.isFinite(Number(v.replace(',', '.'))))) return 'number';
        if (values.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))) return 'date';
        return 'text';
      };
      const types = valuesByCol.map(infer);
      const pageId = createPage(null, 'database');
      updatePage(pageId, { title: file.name.replace(/\.csv$/i, '') || 'Importación CSV' });
      updateDB(pageId, (d) => {
        const columns = header.map((name, i) => ({ id: newId(), name, type: types[i] }));
        const stamp = Date.now();
        d.columns = columns;
        d.rows = body.map((values) => {
          const cells: Record<string, string | number | boolean | null> = {};
          columns.forEach((col, i) => {
            const raw = String(values[i] ?? '');
            if (col.type === 'number') cells[col.id] = raw.trim() === '' ? null : Number(raw.replace(',', '.'));
            else if (col.type === 'checkbox') cells[col.id] = /^(sí|si|true|1|x)$/i.test(raw.trim());
            else cells[col.id] = raw;
          });
          return { id: newId(), cells, created: stamp, updated: stamp };
        });
        d.view = 'table';
        d.filters = [];
        d.sorts = [];
        d.filter = '';
        d.calculations = {};
        d.groupByColumnId = columns.find((c) => c.type === 'select')?.id ?? null;
        d.calendarColumnId = columns.find((c) => c.type === 'date')?.id ?? null;
        return d;
      });
      setNotice({ kind: 'ok', text: `${body.length} filas y ${header.length} propiedades importadas desde ${file.name}.` });
      toast('Base de datos creada desde CSV');
    } catch (e) {
      setNotice({ kind: 'err', text: 'No se pudo importar el CSV: ' + (e instanceof Error ? e.message : String(e)) });
    } finally {
      setCsvBusy(false);
    }
  };

  const exportCsv = () => {
    if (!activePage || activePage.kind !== 'database' || !activePage.db) return;
    downloadFile(`${slugify(activePage.title || 'base-de-datos')}.csv`, databaseToCsv(activePage), 'text/csv;charset=utf-8');
    toast('CSV exportado');
  };

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (wsMenuOpen && !wsRef.current?.contains(t)) setWsMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [wsMenuOpen]);

  const currentNotebookIcon = (notebooks.find((n) => n.id === currentNotebookId)?.icon ?? 'folder') as IconName;

  const toggleOpen = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, Page[]>();
    for (const p of pages) {
      const key = p.parentId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [pages]);

  const favorites = pages.filter((p) => p.favorite);

  const confirmImport = async () => {
    if (!pendingImport) return;
    const res = await importBackup(pendingImport);
    if (res.ok) setNotice({ kind: 'ok', text: `Restauradas ${res.count} páginas desde el backup.` });
    else setNotice({ kind: 'err', text: res.error ?? 'No se pudo restaurar.' });
    setPendingImport(null);
  };

  const confirmNotionImport = async (file: File) => {
    setNotionBusy(true);
    try {
      const res = await parseNotionExport(file);
      const n = importPages(res.pages);
      setNotice({
        kind: 'ok',
        text: `Importación completa: ${n} páginas, ${res.databases} bases de datos${res.imagesEmbedded ? `, ${res.imagesEmbedded} imágenes` : ''}${res.skipped ? ` (${res.skipped} omitidas)` : ''}.`,
      });
      setNotionHelp(false);
    } catch (e) {
      setNotice({ kind: 'err', text: 'No se pudo importar: ' + (e instanceof Error ? e.message : String(e)) });
    } finally {
      setNotionBusy(false);
    }
  };

  const createWs = () => {
    const name = newWsName.trim();
    if (!name) return;
    createNotebook(name);
    setNewWsName('');
    setCreatingWs(false);
    setWsMenuOpen(false);
  };

  const moveInto = (targetId: string, e: DragEvent) => {
    const draggedId = getPageDrag(e);
    if (!draggedId) return;
    e.preventDefault();
    e.stopPropagation();
    setDropId(null);
    if (draggedId === targetId) return;
    const dragged = byId.get(draggedId);
    const target = byId.get(targetId);
    if (!dragged || !target) return;
    if (dragged.parentId === targetId) {
      setExpanded((prev) => new Set(prev).add(targetId));
      setNotice({ kind: 'ok', text: `«${dragged.title || 'Sin título'}» ya está dentro de «${target.title || 'Sin título'}».` });
      return;
    }
    if (!movePage(draggedId, targetId)) {
      setNotice({ kind: 'err', text: 'No puedes mover una página dentro de sí misma ni de una de sus subpáginas.' });
      return;
    }
    setExpanded((prev) => new Set(prev).add(targetId));
    setNotice({ kind: 'ok', text: `«${dragged.title || 'Sin título'}» ahora es una subpágina de «${target.title || 'Sin título'}».` });
  };

  const dropProps = (targetId: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!hasPageDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDropId(targetId);
    },
    onDragLeave: (e: DragEvent) => {
      const next = e.relatedTarget as Node | null;
      if (!next || !e.currentTarget.contains(next)) setDropId((current) => (current === targetId ? null : current));
    },
    onDrop: (e: DragEvent) => moveInto(targetId, e),
  });

  const renderTree = (parentId: string | null, depth: number) => {
    const kids = childrenOf.get(parentId) ?? [];
    return kids.map((p) => {
      const kids2 = childrenOf.get(p.id) ?? [];
      const hasKids = kids2.length > 0;
      const isOpen = expanded.has(p.id);
      return (
        <div key={p.id} role="treeitem" aria-expanded={hasKids ? isOpen : undefined}>
          <button
            className={`treerow${activePageId === p.id && !showTrash ? ' is-active' : ''}${dropId === p.id ? ' is-drop' : ''}`}
            style={{ paddingLeft: `${2 + depth * 14}px` }}
            data-page-id={p.id}
            draggable
            onDragStart={(e) => setPageDrag(e, p.id)}
            {...dropProps(p.id)}
            onClick={() => {
              setActivePageId(p.id);
              setShowTrash(false);
              onClose();
              if (hasKids && !isOpen) toggleOpen(p.id);
            }}
          >
            {activePageId === p.id && !showTrash && (
              <svg className="treerow__tab" viewBox="0 0 7 17" width="7" height="17" aria-hidden="true">
                <path d="M5.6 0.9 C4.4 5.2 4.4 11.6 5.6 16.1 L2.5 15.3 C1.4 10.6 1.4 6.3 2.5 1.7 Z" fill="currentColor" />
              </svg>
            )}
            <span
              className={`treerow__twisty${isOpen ? ' is-open' : ''}${hasKids ? '' : ' is-leaf'}`}
              role="button"
              aria-label={isOpen ? 'Contraer' : 'Expandir'}
              tabIndex={hasKids ? 0 : -1}
              onClick={(e) => {
                if (!hasKids) return;
                e.stopPropagation();
                toggleOpen(p.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleOpen(p.id);
                }
              }}
            >
              <Icon name="chevronRight" size={13} />
            </span>
            <span className="treerow__icon">
              <Icon name={(p.icon || 'doc') as IconName} size={15} />
            </span>
            <span className="treerow__title">{p.title || 'Sin título'}</span>
            <span className="treerow__actions">
              <button
                className={`rowaction${p.favorite ? ' is-fav' : ''}`}
                title={p.favorite ? 'Quitar de favoritos' : 'Guardar en favoritos'}
                aria-label={p.favorite ? 'Quitar de favoritos' : 'Guardar en favoritos'}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(p.id);
                }}
              >
                <Icon name="star" size={13} filled={p.favorite} />
              </button>
              <button
                className="rowaction"
                title="Mover a la papelera"
                aria-label="Mover página a la papelera"
                onClick={(e) => {
                  e.stopPropagation();
                  trashPage(p.id);
                }}
              >
                <Icon name="trash" size={13} />
              </button>
            </span>
          </button>
          {hasKids && isOpen && <div role="group">{renderTree(p.id, depth + 1)}</div>}
        </div>
      );
    });
  };

  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} aria-hidden="true" />}
      <aside
        className={`sidebar${open ? ' is-open' : ''}`}
        aria-label="Barra lateral del cuaderno"
        style={{ width: sidebarWidth, flexBasis: sidebarWidth }}
      >
        <div className="sidebar__brand">
          <Icon name="logo" size={26} strokeWidth={1.7} className="sidebar__logo" />
          <div>
            <h1 className="sidebar__wordmark">Takenotes</h1>
            <p className="sidebar__tagline">LOCAL · TUYO · PARA SIEMPRE</p>
          </div>
        </div>

        {/* Selector de workspaces */}
        <div className="wsswitch" ref={wsRef}>
          <button
            className="wsswitch__btn"
            onClick={() => setWsMenuOpen((v) => !v)}
            aria-expanded={wsMenuOpen}
            aria-haspopup="menu"
            title="Cambiar de workspace"
          >
            <Icon name={currentNotebookIcon} size={15} />
            <span className="wsswitch__name">{currentNotebookName}</span>
            <Icon name={wsMenuOpen ? 'chevronUp' : 'chevronDown'} size={13} />
          </button>
          {wsMenuOpen && (
            <div className="wsswitch__menu" role="menu" aria-label="Workspaces">
              {notebooks.map((nb) => (
                <div key={nb.id} className="wsswitch__row">
                  {renamingWsId === nb.id ? (
                    <input
                      className="wsswitch__rename"
                      autoFocus
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      aria-label="Renombrar workspace"
                      onBlur={() => {
                        renameNotebook(nb.id, renameVal);
                        setRenamingWsId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setRenamingWsId(null);
                      }}
                    />
                  ) : (
                    <>
                      <button
                        role="menuitem"
                        aria-current={nb.id === currentNotebookId ? 'true' : undefined}
                        className={`wsswitch__item${nb.id === currentNotebookId ? ' is-current' : ''}`}
                        onClick={() => {
                          setCurrentNotebook(nb.id);
                          setWsMenuOpen(false);
                        }}
                      >
                        <Icon name={(nb.icon || 'folder') as IconName} size={14} />
                        <span className="wsswitch__itemname">{nb.name}</span>
                        {nb.id === currentNotebookId && <Icon name="check" size={12} />}
                      </button>
                      <button
                        className="wsswitch__renamebtn"
                        title="Renombrar workspace"
                        aria-label={`Renombrar ${nb.name}`}
                        onClick={() => {
                          setRenamingWsId(nb.id);
                          setRenameVal(nb.name);
                        }}
                      >
                        <Icon name="pen" size={11} />
                      </button>
                    </>
                  )}
                </div>
              ))}
              <div className="wsswitch__footer">
                {creatingWs ? (
                  <form
                    className="wsswitch__newform"
                    onSubmit={(e) => {
                      e.preventDefault();
                      createWs();
                    }}
                  >
                    <input
                      autoFocus
                      value={newWsName}
                      onChange={(e) => setNewWsName(e.target.value)}
                      placeholder="Nombre del workspace…"
                      aria-label="Nombre del nuevo workspace"
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setCreatingWs(false);
                      }}
                    />
                    <button type="submit" className="wsswitch__renamebtn" aria-label="Crear workspace">
                      <Icon name="check" size={13} />
                    </button>
                  </form>
                ) : (
                  <button className="wsswitch__new" onClick={() => setCreatingWs(true)}>
                    <Icon name="plus" size={13} /> Nuevo workspace
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <button className="sidebar__search" onClick={() => setSearchOpen(true)} aria-label="Abrir búsqueda (Ctrl K)">
          <Icon name="search" size={14} />
          <span>Buscar o saltar a…</span>
          <kbd>Ctrl K</kbd>
        </button>

        <div className="sidebar__newrow">
          <button className="btn btn--primary" onClick={() => createPage(null, 'page')}>
            <Icon name="plus" size={14} strokeWidth={2} /> Nueva página
          </button>
          <button className="iconbtn" title="Nueva base de datos" aria-label="Nueva base de datos" onClick={() => createPage(null, 'database')}>
            <Icon name="table" size={16} />
          </button>
        </div>
        <button className="sidebar__templates" onClick={() => setTemplatesOpen(true)}>
          <Icon name="sparkles" size={13} />
          <span>Empezar con una plantilla</span>
          <Icon name="chevronRight" size={12} />
        </button>

        <div className="sidebar__scroll">
          {recentPages.length > 0 && (
            <div className="sidegroup">
              <p className="sidegroup__label">
                <span><Icon name="clock" size={11} /> Recientes</span>
              </p>
              <div className="recents" aria-label="Páginas recientes">
                {recentPages.slice(0, 5).map((p) => (
                  <button
                    key={p.id}
                    className={`recentrow${activePageId === p.id && !showTrash ? ' is-active' : ''}`}
                    onClick={() => { setActivePageId(p.id); setShowTrash(false); onClose(); }}
                  >
                    <Icon name={(p.icon || 'doc') as IconName} size={14} />
                    <span className="recentrow__title">{p.title || 'Sin título'}</span>
                    <span className="recentrow__kind">{p.kind === 'database' ? 'Base' : 'Página'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {favorites.length > 0 && (
            <div className="sidegroup">
              <p className="sidegroup__label">Favoritos</p>
              <div role="tree" aria-label="Páginas favoritas">
                {favorites.map((p) => (
                  <button
                    key={p.id}
                    className={`treerow${activePageId === p.id && !showTrash ? ' is-active' : ''}${dropId === p.id ? ' is-drop' : ''}`}
                    style={{ paddingLeft: '4px' }}
                    data-page-id={p.id}
                    draggable
                    onDragStart={(e) => setPageDrag(e, p.id)}
                    {...dropProps(p.id)}
                    onClick={() => {
                      setActivePageId(p.id);
                      setShowTrash(false);
                      onClose();
                    }}
                  >
                    {activePageId === p.id && !showTrash && (
                      <svg className="treerow__tab" viewBox="0 0 7 17" width="7" height="17" aria-hidden="true">
                        <path d="M5.6 0.9 C4.4 5.2 4.4 11.6 5.6 16.1 L2.5 15.3 C1.4 10.6 1.4 6.3 2.5 1.7 Z" fill="currentColor" />
                      </svg>
                    )}
                    <span className="treerow__icon"><Icon name={(p.icon || 'doc') as IconName} size={15} /></span>
                    <span className="treerow__title">{p.title || 'Sin título'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="sidegroup">
            <p className="sidegroup__label">
              {favorites.length > 0 ? 'Todas las páginas' : 'Páginas'}
              <button
                className="rowaction"
                title="Nueva página"
                aria-label="Nueva página"
                onClick={() => createPage(null, 'page')}
              >
                <Icon name="plus" size={13} />
              </button>
            </p>
            <div role="tree" aria-label="Árbol de páginas">
              {renderTree(null, 0)}
            </div>
          </div>
        </div>

        {/* Acciones de la página actual */}
        <div className="sidebar__pagebar" aria-label="Acciones de la página actual">
          <p className="sidebar__pagebar-label">
            <span>{activePage ? (activePage.title || 'Sin título') : 'Ninguna página'}</span>
            <span>{activePage?.kind === 'database' ? 'Base de datos' : activePage ? 'Página' : ''}</span>
          </p>
          <div className="sidebar__pagebar-btns">
            <button className={`iconbtn${focusMode ? ' is-active' : ''}`} title={focusMode ? 'Salir del modo concentración' : 'Modo concentración'} aria-label="Alternar modo concentración" disabled={!activePage} onClick={() => setFocusMode((v) => !v)}>
              <Icon name="target" size={15} />
            </button>
            <button className="iconbtn" title="Imprimir / PDF" aria-label="Imprimir página" disabled={!activePage} onClick={() => activePageId && setPrintPageId(activePageId)}>
              <Icon name="export" size={15} />
            </button>
            <button className="iconbtn" title="Copiar enlace de la página" aria-label="Copiar enlace de la página" disabled={!activePage} onClick={() => activePageId && copyPageLink(activePageId)}>
              <Icon name="link" size={15} />
            </button>
            <button className="iconbtn" title="Exportar Markdown" aria-label="Exportar página como Markdown" disabled={!activePage} onClick={() => activePageId && exportPageMarkdown(activePageId)}>
              <Icon name="download" size={15} />
            </button>
            <button className="iconbtn" title="Exportar HTML" aria-label="Exportar página como HTML" disabled={!activePage} onClick={() => activePageId && exportPageHtml(activePageId)}>
              <Icon name="file" size={15} />
            </button>
            <button className="iconbtn" title="Exportar CSV de la base de datos" aria-label="Exportar base de datos como CSV" disabled={activePage?.kind !== 'database'} onClick={exportCsv}>
              <Icon name="table" size={15} />
            </button>
            <button className="iconbtn" title="Importar un CSV como base de datos" aria-label="Importar CSV" disabled={csvBusy} onClick={() => csvRef.current?.click()}>
              <Icon name={csvBusy ? 'clock' : 'import'} size={15} />
            </button>
            <button className="iconbtn" title="Atajos de teclado" aria-label="Ver atajos de teclado" onClick={() => setShortcutsOpen(true)}>
              <Icon name="keyboard" size={15} />
            </button>
          </div>
          <input
            ref={csvRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            aria-hidden="true"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importCsv(f);
              e.target.value = '';
            }}
          />
        </div>

        {/* Copia de seguridad + restaurar + importar de Notion */}
        <div className="sidebar__data" aria-label="Copia de seguridad y restauración">
          <button className="iconbtn" title="Descargar copia de seguridad (JSON)" aria-label="Descargar copia de seguridad" onClick={exportBackup}>
            <Icon name="export" size={15} />
          </button>
          <button className="iconbtn" title="Restaurar copia de seguridad (JSON)" aria-label="Restaurar copia de seguridad" onClick={() => fileRef.current?.click()}>
            <Icon name="restore" size={15} />
          </button>
          <button
            className="iconbtn"
            title="Importar exportación de Notion"
            aria-label="Importar exportación de Notion"
            aria-expanded={notionHelp}
            onClick={() => setNotionHelp((v) => !v)}
          >
            <Icon name="import" size={15} />
          </button>
          <span className="savestatus" role="status" aria-live="polite">
            <Icon name={saveState === 'saved' ? 'check' : 'clock'} size={10} />
            {saveState === 'saving'
              ? 'Guardando…'
              : savedAt
                ? `Guardado · ${new Date(savedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`
                : 'Guardado localmente'}
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            aria-hidden="true"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setPendingImport(f);
              e.target.value = '';
            }}
          />
        </div>

        {notionHelp && (
          <div className="importbar importbar--info" role="status">
            <Icon name="import" size={13} />
            <span>
              En <b>Notion</b>: Configuración → <b>Exportar</b> → <b>Markdown y CSV</b> → descarga el .zip.
              {' '}Luego:
            </span>
            <button className="importbar__btn importbar__btn--danger" onClick={() => notionFileRef.current?.click()} disabled={notionBusy}>
              {notionBusy ? 'Importando…' : 'Elegir .zip…'}
            </button>
            <input
              ref={notionFileRef}
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              style={{ display: 'none' }}
              aria-hidden="true"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) confirmNotionImport(f);
                e.target.value = '';
              }}
            />
          </div>
        )}

        {pendingImport && (
          <div className="importbar" role="alert">
            <Icon name="warning" size={13} />
            <span>¿Reemplazar el cuaderno actual con <b>{pendingImport.name}</b>? Las páginas actuales se sobrescriben.</span>
            <button className="importbar__btn importbar__btn--danger" onClick={confirmImport}>Reemplazar</button>
            <button className="importbar__btn" onClick={() => setPendingImport(null)}>Cancelar</button>
          </div>
        )}
        {notice && (
          <div className={`importbar${notice.kind === 'ok' ? ' importbar--ok' : ''}`} role="status">
            <Icon name={notice.kind === 'ok' ? 'check' : 'warning'} size={13} />
            <span>{notice.text}</span>
          </div>
        )}

        <div className="sidebar__foot">
          <button
            className={`trashbtn${showTrash ? ' is-active' : ''}`}
            onClick={() => setShowTrash(!showTrash)}
            aria-pressed={showTrash}
          >
            <Icon name="trash" size={15} />
            Papelera
            {trashCount > 0 && <span className="trashbadge">{trashCount}</span>}
          </button>
          <button
            className="iconbtn"
            title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            onClick={() => setTheme(toggleTheme())}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
          </button>
        </div>

        <div
          className="sidebar__resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionar barra lateral"
          title="Arrastra para cambiar el ancho"
          onPointerDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = sidebarWidth;
            const move = (ev: PointerEvent) => {
              setSidebarWidth(Math.max(220, Math.min(430, startW + ev.clientX - startX)));
            };
            const up = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
              document.body.style.cursor = '';
            };
            document.body.style.cursor = 'col-resize';
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
        />
      </aside>
    </>
  );
}
