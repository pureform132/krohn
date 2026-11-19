import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../../lib/icons';
import type { Block, BlockType, Page } from '../../lib/types';
import { BG_TONES, CONVERT_TARGETS, TEXT_TONES } from './editorUtils';

export function FormatToolbar({
  top,
  left,
  onCommand,
  onCode,
  onTone,
  onClear,
  onLink,
}: {
  top: number;
  left: number;
  onCommand: (cmd: 'bold' | 'italic' | 'underline' | 'strikeThrough') => void;
  onCode: () => void;
  onTone: (cls: string, group: 'text' | 'bg') => void;
  onClear: () => void;
  onLink: (href: string) => void;
}) {
  const [toneOpen, setToneOpen] = useState<'text' | 'bg' | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('https://');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (linkOpen) window.setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 20);
  }, [linkOpen]);

  const submitLink = () => {
    const clean = href.trim();
    if (!clean) return;
    onLink(clean);
    setLinkOpen(false);
  };

  return (
    <div
      className="formattoolbar"
      style={{ top, left }}
      role="toolbar"
      aria-label="Formato de texto"
      onMouseDown={(e) => e.preventDefault()}
    >
      <button title="Negrita (Ctrl B)" aria-label="Negrita" onClick={() => onCommand('bold')}><b>B</b></button>
      <button title="Itálica (Ctrl I)" aria-label="Itálica" onClick={() => onCommand('italic')}><i>I</i></button>
      <button title="Subrayado (Ctrl U)" aria-label="Subrayado" onClick={() => onCommand('underline')}><u>U</u></button>
      <button title="Tachado (Ctrl Shift X)" aria-label="Tachado" onClick={() => onCommand('strikeThrough')}><s>S</s></button>
      <button title="Código en línea (Ctrl `)" aria-label="Código en línea" onClick={onCode}><Icon name="code" size={13} /></button>
      <span className="formattoolbar__sep" aria-hidden="true" />
      <button title="Enlace (Ctrl K)" aria-label="Insertar enlace" className={linkOpen ? 'is-active' : ''} onClick={() => setLinkOpen((v) => !v)}>
        <Icon name="link" size={13} />
      </button>
      <button title="Color del texto" aria-label="Color del texto" className={toneOpen === 'text' ? 'is-active' : ''} onClick={() => setToneOpen(toneOpen === 'text' ? null : 'text')}>
        <span className="tonebtn"><b>A</b><i className="tonebtn__bar" /></span>
      </button>
      <button title="Color de fondo" aria-label="Color de fondo" className={toneOpen === 'bg' ? 'is-active' : ''} onClick={() => setToneOpen(toneOpen === 'bg' ? null : 'bg')}>
        <Icon name="highlight" size={13} />
      </button>
      <button title="Quitar formato" aria-label="Quitar formato" onClick={onClear}><Icon name="x" size={12} /></button>

      {toneOpen && (
        <div className="tonechoices" role="menu" aria-label="Colores">
          {(toneOpen === 'text' ? TEXT_TONES : BG_TONES).map((t) => (
            <button key={t.cls || 'none'} role="menuitem" onClick={() => { onTone(t.cls, toneOpen); setToneOpen(null); }}>
              <i style={{ background: t.swatch }} />
              {t.label}
            </button>
          ))}
        </div>
      )}

      {linkOpen && (
        <div className="linkpop" role="dialog" aria-label="Editar enlace">
          <input
            ref={inputRef}
            value={href}
            onChange={(e) => setHref(e.target.value)}
            placeholder="https://… o #/p/id"
            aria-label="Dirección del enlace"
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submitLink(); }
              if (e.key === 'Escape') setLinkOpen(false);
            }}
          />
          <button className="btn btn--primary btn--small" onClick={submitLink}>Aplicar</button>
        </div>
      )}
    </div>
  );
}

export function BlockMenu({
  block,
  x,
  y,
  index,
  total,
  onClose,
  onDuplicate,
  onDelete,
  onMove,
  onConvert,
  onTone,
  onAlign,
  onCopy,
}: {
  block: Block;
  x: number;
  y: number;
  index: number;
  total: number;
  onClose: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onConvert: (type: BlockType) => void;
  onTone: (patch: Partial<Block>) => void;
  onAlign: (align: 'left' | 'center' | 'right') => void;
  onCopy: () => void;
}) {
  const [convertOpen, setConvertOpen] = useState(false);
  const [toneOpen, setToneOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('.blockhandle')) onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [onClose]);

  return (
    <div className="blockmenu" style={{ top: y, left: x }} ref={ref} role="menu" aria-label="Acciones del bloque">
      <p className="blockmenu__kind">{block.type === 'text' ? 'Párrafo' : block.type}</p>
      {!convertOpen ? (
        <>
          <button role="menuitem" onClick={onDuplicate}><Icon name="copy" size={14} /> Duplicar bloque</button>
          <button role="menuitem" onClick={onCopy}><Icon name="export" size={14} /> Copiar texto</button>
          <button role="menuitem" onClick={() => onMove(-1)} disabled={index <= 0}><Icon name="chevronUp" size={14} /> Mover arriba</button>
          <button role="menuitem" onClick={() => onMove(1)} disabled={index >= total - 1}><Icon name="chevronDown" size={14} /> Mover abajo</button>
          <button role="menuitem" onClick={() => setConvertOpen(true)}><Icon name="move" size={14} /> Convertir en…</button>
          <button role="menuitem" onClick={() => setToneOpen((v) => !v)} aria-expanded={toneOpen}><Icon name="palette" size={14} /> Color y fondo</button>
          {toneOpen && (
            <div className="blockmenu__tones">
              <p>Texto</p>
              <div>
                {TEXT_TONES.map((t) => (
                  <button
                    key={`t-${t.cls}`}
                    className={`swatch${(block.color ?? '') === t.cls ? ' is-sel' : ''}`}
                    style={{ background: t.swatch }}
                    title={`Texto ${t.label}`}
                    aria-label={`Texto ${t.label}`}
                    onClick={() => onTone({ color: (t.cls || 'default') as Block['color'] })}
                  />
                ))}
              </div>
              <p>Fondo</p>
              <div>
                {BG_TONES.map((t) => (
                  <button
                    key={`b-${t.cls}`}
                    className={`swatch${(block.bg ?? '') === t.cls ? ' is-sel' : ''}`}
                    style={{ background: t.swatch === 'transparent' ? 'repeating-conic-gradient(var(--line) 0 25%, transparent 0 50%) 50%/8px 8px' : t.swatch }}
                    title={`Fondo ${t.label}`}
                    aria-label={`Fondo ${t.label}`}
                    onClick={() => onTone({ bg: (t.cls || 'default') as Block['bg'] })}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="blockmenu__align" role="group" aria-label="Alineación del bloque">
            {([['left', 'alignLeft'], ['center', 'alignCenter'], ['right', 'alignRight']] as [Block['align'], IconName][]).map(([align, icon]) => (
              <button
                key={align}
                className={(block.align ?? 'left') === align ? 'is-active' : ''}
                title={`Alinear ${align === 'left' ? 'a la izquierda' : align === 'center' ? 'al centro' : 'a la derecha'}`}
                aria-label={`Alinear ${align}`}
                onClick={() => onAlign(align!)}
              >
                <Icon name={icon} size={13} />
              </button>
            ))}
          </div>
          <span className="blockmenu__sep" />
          <button role="menuitem" className="is-danger" onClick={onDelete}><Icon name="trash" size={14} /> Eliminar bloque</button>
        </>
      ) : (
        <>
          <button role="menuitem" className="blockmenu__back" onClick={() => setConvertOpen(false)}>
            <span className="flip"><Icon name="chevronRight" size={12} /></span> Convertir en
          </button>
          <div className="blockmenu__convert">
            {CONVERT_TARGETS.map((t) => (
              <button key={t.type} role="menuitem" onClick={() => onConvert(t.type)}>
                <Icon name={t.icon} size={13} /> {t.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function MentionMenu({
  items,
  selected,
  onHover,
  onPick,
  style,
}: {
  items: Page[];
  selected: number;
  onHover: (index: number) => void;
  onPick: (page: Page) => void;
  style: React.CSSProperties;
}) {
  return (
    <div className="slash mentionmenu" style={style} role="listbox" aria-label="Mencionar página">
      <p className="slash__head">Mencionar página</p>
      <div className="slash__list">
        {items.length === 0 && <p className="slash__empty">No hay páginas con ese nombre.</p>}
        {items.map((p, i) => (
          <button
            key={p.id}
            role="option"
            aria-selected={i === selected}
            className={`slashitem${i === selected ? ' is-sel' : ''}`}
            onMouseEnter={() => onHover(i)}
            onMouseDown={(e) => { e.preventDefault(); onPick(p); }}
          >
            <span className="slashitem__ic"><Icon name={(p.icon || 'doc') as IconName} size={16} /></span>
            <span>
              <span className="slashitem__label">{p.title || 'Sin título'}</span>
              <br />
              <span className="slashitem__hint">{p.kind === 'database' ? 'Base de datos' : 'Página'} · @mencionar</span>
            </span>
          </button>
        ))}
      </div>
      <p className="mentionmenu__hint">↑↓ para elegir · Enter para insertar · Esc para cerrar</p>
    </div>
  );
}

export function FindBar({
  query,
  setQuery,
  count,
  index,
  onNext,
  onPrev,
  onClose,
}: {
  query: string;
  setQuery: (v: string) => void;
  count: number;
  index: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  return (
    <div className="findbar" role="search" aria-label="Buscar en la página">
      <Icon name="search" size={14} />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar en esta página…"
        aria-label="Buscar en esta página"
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) onPrev(); else onNext(); }
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
      />
      <span className="findbar__count" aria-live="polite">
        {query.trim() ? `${count === 0 ? 0 : index + 1} de ${count}` : '0 de 0'}
      </span>
      <button className="iconbtn" onClick={onPrev} aria-label="Coincidencia anterior" disabled={count === 0}>
        <Icon name="chevronUp" size={13} />
      </button>
      <button className="iconbtn" onClick={onNext} aria-label="Coincidencia siguiente" disabled={count === 0}>
        <Icon name="chevronDown" size={13} />
      </button>
      <button className="iconbtn" onClick={onClose} aria-label="Cerrar búsqueda">
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

export function VersionHistory({
  page,
  onClose,
  onSave,
  onRestore,
  onDelete,
}: {
  page: Page;
  onClose: () => void;
  onSave: () => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const versions = page.history ?? [];
  return (
    <div className="modal-backdrop" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Historial de versiones">
      <div className="modal versionmodal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <div>
            <p className="kicker">Historial local</p>
            <h2>Versiones de «{page.title || 'Sin título'}».</h2>
          </div>
          <button className="rowaction" onClick={onClose} aria-label="Cerrar historial"><Icon name="x" size={16} /></button>
        </div>
        <div className="versionactions">
          <button className="btn btn--primary btn--small" onClick={onSave}>
            <Icon name="history" size={13} /> Guardar versión ahora
          </button>
          <span className="modal__hint">Se conservan las 30 últimas versiones, en esta máquina.</span>
        </div>
        {versions.length === 0 ? (
          <p className="versionempty">Aún no hay versiones. Guarda una antes de un cambio grande; podrás volver a ella con un clic.</p>
        ) : (
          <ol className="versionlist">
            {versions.map((v) => (
              <li key={v.id}>
                <div className="versionitem__body">
                  <span className="versionitem__date">
                    {new Date(v.at).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="versionitem__label">{v.label || 'Versión'}</span>
                  <span className="versionitem__meta">{v.words} palabras · {v.blocks.length} bloques</span>
                </div>
                <button className="btn-ghost btn-ghost--small" onClick={() => onRestore(v.id)}>Restaurar</button>
                <button className="rowaction" onClick={() => onDelete(v.id)} title="Eliminar versión" aria-label="Eliminar versión">
                  <Icon name="trash" size={12} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
