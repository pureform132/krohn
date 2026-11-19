import { useEffect, useMemo, useState } from 'react';
import { Icon, type IconName } from '../../lib/icons';
import { COVERS } from '../../lib/pageIcons';
import { FILE_SIZE_LIMIT } from './editorUtils';
import type { Page } from '../../lib/types';

export function CoverPicker({
  current,
  onPick,
  onRemove,
  onClose,
}: {
  current?: string;
  onPick: (id: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Elegir portada">
      <div className="modal coverpick" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <div>
            <p className="kicker">Portada de página</p>
            <h2>Elige un tono.</h2>
          </div>
          <button className="rowaction" onClick={onClose} aria-label="Cerrar"><Icon name="x" size={16} /></button>
        </div>
        <p className="modal__lede">Portadas dibujadas con los cuatro matices del cuaderno. Sin imágenes externas.</p>
        <div className="covergrid">
          {COVERS.map((cover) => (
            <button
              key={cover.id}
              className={`coverchoice${current === cover.id ? ' is-sel' : ''}`}
              onClick={() => onPick(cover.id)}
              aria-label={`Portada ${cover.label}`}
            >
              <span className={`coverswatch ${cover.className}`} />
              <span>{cover.label}</span>
              {current === cover.id && <Icon name="check" size={14} />}
            </button>
          ))}
        </div>
        {current && (
          <button className="btn-ghost modal__remove" onClick={onRemove}>
            <Icon name="x" size={13} /> Quitar portada
          </button>
        )}
      </div>
    </div>
  );
}

function descendantIds(pages: Page[], rootId: string): Set<string> {
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

export function MoveDialog({
  page,
  pages,
  onMove,
  onClose,
}: {
  page: Page;
  pages: Page[];
  onMove: (parentId: string | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const blocked = useMemo(() => descendantIds(pages, page.id), [pages, page.id]);
  const tree = useMemo(() => {
    const byParent = new Map<string | null, Page[]>();
    for (const p of pages) {
      if (p.trashed) continue;
      const key = p.parentId;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(p);
    }
    const out: { page: Page; depth: number }[] = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const p of byParent.get(parentId) ?? []) {
        out.push({ page: p, depth });
        walk(p.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [pages]);

  const q = query.trim().toLowerCase();
  const items = tree.filter(
    ({ page: p }) => !blocked.has(p.id) && (!q || `${p.title || 'Sin título'}`.toLowerCase().includes(q)),
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Mover página">
      <div className="modal movepick" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <div>
            <p className="kicker">Mover página</p>
            <h2>¿Dónde va «{page.title || 'Sin título'}»?</h2>
          </div>
          <button className="rowaction" onClick={onClose} aria-label="Cerrar"><Icon name="x" size={16} /></button>
        </div>
        <div className="movepick__search">
          <Icon name="search" size={14} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar una página de destino…"
            aria-label="Buscar página de destino"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && items[0]) onMove(items[0].page.id);
            }}
          />
        </div>
        <div className="movepick__list" role="listbox" aria-label="Páginas de destino">
          <button className={`movepick__item${page.parentId === null ? ' is-current' : ''}`} onClick={() => onMove(null)}>
            <Icon name="notebook" size={15} />
            <span>Nivel raíz del cuaderno</span>
            {page.parentId === null && <Icon name="check" size={13} />}
          </button>
          {items.map(({ page: p, depth }) => (
            <button
              key={p.id}
              className={`movepick__item${page.parentId === p.id ? ' is-current' : ''}`}
              style={{ paddingLeft: `${12 + depth * 16}px` }}
              onClick={() => onMove(p.id)}
            >
              <Icon name={(p.icon || 'doc') as IconName} size={14} />
              <span>{p.title || 'Sin título'}</span>
              {page.parentId === p.id && <Icon name="check" size={13} />}
            </button>
          ))}
          {items.length === 0 && <p className="movepick__empty">No hay destinos con ese nombre.</p>}
        </div>
        <p className="modal__hint">Una página no puede moverse dentro de sí misma ni de sus subpáginas.</p>
      </div>
    </div>
  );
}

export function ImageUploader({
  onInsert,
  onError,
  error,
}: {
  onInsert: (src: string) => void;
  onError?: (msg: string) => void;
  error?: string;
}) {
  const [url, setUrl] = useState('');
  return (
    <div className="imgpick">
      <Icon name="image" size={17} />
      <input
        type="url"
        placeholder="Pega una URL de imagen…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        aria-label="URL de la imagen"
      />
      <button className="filebtn" onClick={() => url.trim() && onInsert(url.trim())} disabled={!url.trim()}>Insertar</button>
      <label className="filebtn">
        Subir
        <input
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 1_600_000) {
              onError?.('Mantén las imágenes por debajo de ~1.5 MB — se guardan localmente en tu navegador.');
              return;
            }
            const reader = new FileReader();
            reader.onload = () => onInsert(String(reader.result));
            reader.readAsDataURL(file);
          }}
        />
      </label>
      {error && <span className="errormsg">{error}</span>}
    </div>
  );
}

export function FileUploader({
  onInsert,
  onError,
  error,
}: {
  onInsert: (src: string, fileName: string, fileSize: number, fileMime: string) => void;
  onError?: (msg: string) => void;
  error?: string;
}) {
  return (
    <div className="imgpick">
      <Icon name="file" size={17} />
      <label className="filebtn">
        Elegir archivo…
        <input
          type="file"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > FILE_SIZE_LIMIT) {
              onError?.('Máximo 8 MB por archivo — se guarda en el almacenamiento local.');
              return;
            }
            const reader = new FileReader();
            reader.onload = () => onInsert(String(reader.result), file.name, file.size, file.type || 'application/octet-stream');
            reader.readAsDataURL(file);
          }}
        />
      </label>
      <span style={{ fontSize: 11.5, color: 'var(--ink-55)' }}>Cualquier tipo · máx. 8 MB</span>
      {error && <span className="errormsg">{error}</span>}
    </div>
  );
}
