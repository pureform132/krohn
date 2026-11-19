import { useEffect, useMemo } from 'react';
import { useWorkspace } from '../state/WorkspaceContext';
import { Icon } from '../lib/icons';
import { pageToHtml } from '../lib/export';

export function PrintPreview() {
  const { printPageId, setPrintPageId, byId, pages, exportPageHtml } = useWorkspace();
  const page = printPageId ? byId.get(printPageId) : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPrintPageId(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setPrintPageId]);

  const html = useMemo(() => (page ? pageToHtml(page, pages) : ''), [page, pages]);

  if (!printPageId) return null;
  if (!page) {
    return (
      <div className="modal-backdrop" onMouseDown={() => setPrintPageId(null)} role="dialog" aria-modal="true" aria-label="Vista de impresión">
        <div className="modal printmodal" onMouseDown={(e) => e.stopPropagation()}>
          <p className="modal__lede">La página ya no está disponible.</p>
          <button className="btn-ghost" onClick={() => setPrintPageId(null)}>Cerrar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => setPrintPageId(null)} role="dialog" aria-modal="true" aria-label="Vista de impresión">
      <div className="modal printmodal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <div>
            <p className="kicker">Imprimir / PDF</p>
            <h2>{page.title || 'Sin título'}</h2>
          </div>
          <button className="rowaction" onClick={() => setPrintPageId(null)} aria-label="Cerrar vista de impresión">
            <Icon name="x" size={16} />
          </button>
        </div>
        <iframe
          className="printframe"
          title={`Vista de impresión de ${page.title || 'la página'}`}
          srcDoc={html}
        />
        <div className="printactions">
          <button className="btn btn--primary" onClick={() => {
            const frame = document.querySelector<HTMLIFrameElement>('.printframe');
            frame?.contentWindow?.focus();
            frame?.contentWindow?.print();
          }}>
            <Icon name="export" size={14} /> Imprimir / Guardar PDF
          </button>
          <button className="btn-ghost" onClick={() => exportPageHtml(page.id)}>
            <Icon name="download" size={14} /> Descargar HTML
          </button>
          <span className="modal__hint">El diálogo de impresión permite elegir «Guardar como PDF».</span>
        </div>
      </div>
    </div>
  );
}
