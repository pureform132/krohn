import { useEffect, useState } from 'react';
import { WorkspaceProvider, useWorkspace } from './state/WorkspaceContext';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { DatabaseView } from './components/DatabaseView';
import { SearchPalette } from './components/SearchPalette';
import { TrashView } from './components/TrashView';
import { TemplateGallery } from './components/TemplateGallery';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { PrintPreview } from './components/PrintPreview';
import { Icon } from './lib/icons';

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

function MainArea() {
  const {
    loaded, byId, activePageId, showTrash, saveError, createPage, saveState,
    goBack, goForward, canGoBack, canGoForward, undo, redo, canUndo, canRedo,
    setSearchOpen, setTemplatesOpen, setShortcutsOpen, setPrintPageId,
    focusMode, setFocusMode, updatePage, exportPageHtml, exportPageMarkdown,
    toast, toasts, dismissToast,
  } = useWorkspace();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const active = activePageId ? byId.get(activePageId) : undefined;
  const visibleActive = active && !active.trashed ? active : undefined;

  // Atajos globales. Los de formato/navegación funcionan también al escribir.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const typing = isTypingTarget(e.target);
      if (mod && e.key.toLowerCase() === 'k' && !e.shiftKey) {
        e.preventDefault();
        setSearchOpen((v) => !v);
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFocusMode((v) => !v);
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'l' && visibleActive) {
        e.preventDefault();
        updatePage(visibleActive.id, { locked: !visibleActive.locked });
        toast(visibleActive.locked ? 'Página desbloqueada' : 'Página bloqueada', 'info');
        return;
      }
      if (mod && e.key.toLowerCase() === 'p' && visibleActive) {
        e.preventDefault();
        setPrintPageId(visibleActive.id);
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'e' && visibleActive) {
        e.preventDefault();
        exportPageHtml(visibleActive.id);
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'm' && visibleActive) {
        e.preventDefault();
        exportPageMarkdown(visibleActive.id);
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        toast(saveState === 'saving' ? 'Guardando…' : 'Guardado localmente');
        return;
      }
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        goBack();
        return;
      }
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        goForward();
        return;
      }
      if (!typing && (e.key === '?' || (mod && e.key === '/'))) {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (e.key === 'Escape' && focusMode) {
        setFocusMode(false);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    visibleActive, focusMode, saveState, setFocusMode, setPrintPageId, setSearchOpen,
    setShortcutsOpen, updatePage, toast, undo, redo, goBack, goForward, exportPageHtml,
    exportPageMarkdown,
  ]);

  if (!loaded) {
    return (
      <div className="main" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--ink-55)', fontFamily: 'var(--font-display)', fontSize: 20 }}>Abriendo tu cuaderno…</p>
      </div>
    );
  }

  return (
    <>
      <div className={`topbar${focusMode ? ' is-hidden' : ''}`} role="toolbar" aria-label="Barra superior">
        <button className="iconbtn" onClick={() => setSidebarOpen((v) => !v)} aria-label="Mostrar/ocultar barra lateral">
          <Icon name="notebook" size={17} />
        </button>
        <span className="topbar__brand">Takenotes</span>
        <span className="topbar__sep" aria-hidden="true" />
        <button className="iconbtn" onClick={goBack} disabled={!canGoBack} aria-label="Atrás" title="Atrás (Alt ←)">
          <span className="flip"><Icon name="chevronRight" size={15} /></span>
        </button>
        <button className="iconbtn" onClick={goForward} disabled={!canGoForward} aria-label="Adelante" title="Adelante (Alt →)">
          <Icon name="chevronRight" size={15} />
        </button>
        <span className="topbar__sep" aria-hidden="true" />
        <button className="iconbtn" onClick={undo} disabled={!canUndo} aria-label="Deshacer" title="Deshacer (Ctrl Z)">
          <Icon name="undo" size={15} />
        </button>
        <button className="iconbtn" onClick={redo} disabled={!canRedo} aria-label="Rehacer" title="Rehacer (Ctrl Shift Z)">
          <Icon name="redo" size={15} />
        </button>
        <span style={{ flex: 1 }} />
        <span className="topbar__save" aria-live="polite">
          <Icon name={saveState === 'saved' ? 'check' : 'clock'} size={10} />
          {saveState === 'saving' ? 'Guardando…' : 'Local'}
        </span>
        <button className="iconbtn" onClick={() => setTemplatesOpen(true)} aria-label="Plantillas" title="Nuevas páginas desde plantilla">
          <Icon name="gallery" size={15} />
        </button>
        <button className="iconbtn" onClick={() => setShortcutsOpen(true)} aria-label="Atajos de teclado" title="Atajos (?)">
          <Icon name="keyboard" size={15} />
        </button>
        <button
          className="iconbtn"
          onClick={() => setFocusMode((v) => !v)}
          aria-pressed={focusMode}
          aria-label="Modo concentración"
          title="Modo concentración (Ctrl Shift F)"
        >
          <Icon name="target" size={15} />
        </button>
        <button className="iconbtn" onClick={() => setSearchOpen(true)} aria-label="Buscar (Ctrl K)" title="Buscar (Ctrl K)">
          <Icon name="search" size={15} />
        </button>
      </div>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className={`main${focusMode ? ' is-focus' : ''}`} id="main">
        {showTrash ? (
          <TrashView />
        ) : visibleActive ? (
          visibleActive.kind === 'database' ? (
            <DatabaseView key={visibleActive.id} page={visibleActive} />
          ) : (
            <Editor key={visibleActive.id} page={visibleActive} />
          )
        ) : (
          <div className="emptystate">
            <div className="es-art"><Icon name="logo" size={64} strokeWidth={1.3} /></div>
            <h2>Una página en blanco es una virtud</h2>
            <p>Nada seleccionado, nada perdido. Elige una página del árbol, o empieza una nueva — se queda en esta máquina, siempre.</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn--primary" onClick={() => createPage(null, 'page')}>
                <Icon name="plus" size={14} strokeWidth={2} /> Nueva página
              </button>
              <button className="btn-ghost" onClick={() => setTemplatesOpen(true)}>
                <Icon name="gallery" size={14} /> Usar una plantilla
              </button>
              <button className="btn-ghost" onClick={() => setShortcutsOpen(true)}>
                <Icon name="keyboard" size={14} /> Ver atajos
              </button>
            </div>
          </div>
        )}
        {saveError && (
          <div className="savetoast savetoast--err" role="alert">
            <Icon name="warning" size={13} /> {saveError}
          </div>
        )}
      </main>
      <SearchPalette />
      <TemplateGallery />
      <ShortcutsHelp />
      <PrintPreview />
      <div className="toaststack" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`} role="status">
            <Icon name={t.kind === 'ok' ? 'check' : t.kind === 'err' ? 'warning' : 'info'} size={14} />
            <span>{t.message}</span>
            <button className="rowaction" onClick={() => dismissToast(t.id)} aria-label="Cerrar aviso">
              <Icon name="x" size={11} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

export default function App() {
  return (
    <WorkspaceProvider>
      <div className="app">
        <MainArea />
      </div>
    </WorkspaceProvider>
  );
}
