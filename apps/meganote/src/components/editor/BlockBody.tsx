import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../../lib/icons';
import type { Block, ColumnData, TableData } from '../../lib/types';
import { htmlToText, isSafeUrl, normalizeUrl, sanitizeInline } from '../../lib/html';
import { embedFor, hostOf } from '../../lib/embeds';
import { renderEquation } from '../../lib/equation';
import { CALLOUT_ICONS, CALLOUT_TONES, CODE_LANGS } from './editorUtils';

export function tableOf(b: Block): TableData {
  return b.table ?? { header: true, rows: [['', ''], ['', '']] };
}

function defaultColumns(): ColumnData[] {
  return [
    { id: `col-${Math.random().toString(36).slice(2, 9)}`, html: '', text: '' },
    { id: `col-${Math.random().toString(36).slice(2, 9)}`, html: '', text: '' },
  ];
}

export function BlockBody({
  block: b,
  number,
  content,
  updateBlock,
  onToast,
}: {
  block: Block;
  number?: number;
  content: ReactNode;
  updateBlock: (patch: Partial<Block>) => void;
  onToast: (msg: string, kind?: 'ok' | 'info' | 'err') => void;
}) {
  switch (b.type) {
    case 'bulleted':
      return (
        <div className="block block--bulleted">
          <span className="bulleted-dot" aria-hidden="true"><i /></span>
          {content}
        </div>
      );
    case 'numbered':
      return (
        <div className="block block--numbered">
          <span className="listitem-marker" aria-hidden="true">{number ?? 1}.</span>
          {content}
        </div>
      );
    case 'todo':
      return (
        <div className="block block--todo">
          <button
            className={`todocheck${b.checked ? ' is-checked' : ''}`}
            onClick={() => updateBlock({ checked: !b.checked })}
            role="checkbox"
            aria-checked={!!b.checked}
            aria-label={b.checked ? 'Marcar como pendiente' : 'Marcar como hecha'}
          >
            <Icon name="check" size={13} strokeWidth={2.4} />
          </button>
          <div className={`todo-text${b.checked ? ' is-done' : ''}`} style={{ flex: 1, minWidth: 0 }}>
            {content}
          </div>
        </div>
      );
    case 'toggle':
      return (
        <div className="block block--toggle">
          <button
            className="togglebtn"
            data-open={b.open !== false}
            onClick={() => updateBlock({ open: b.open === false })}
            aria-label={b.open === false ? 'Expandir desplegable' : 'Contraer desplegable'}
            aria-expanded={b.open !== false}
          >
            <Icon name="chevronRight" size={15} />
          </button>
          {content}
        </div>
      );
    case 'quote':
      return <div className="block block--quote">{content}</div>;
    case 'callout':
      return (
        <CalloutBlock block={b} content={content} updateBlock={updateBlock} />
      );
    case 'code':
      return <CodeBlock block={b} content={content} updateBlock={updateBlock} onToast={onToast} />;
    case 'table':
      return <TableBlock block={b} updateBlock={updateBlock} />;
    case 'columns':
      return <ColumnsBlock block={b} updateBlock={updateBlock} />;
    case 'bookmark':
      return <BookmarkBlock block={b} updateBlock={updateBlock} onToast={onToast} />;
    case 'embed':
      return <EmbedBlock block={b} updateBlock={updateBlock} onToast={onToast} />;
    case 'video':
    case 'audio':
      return <MediaBlock block={b} updateBlock={updateBlock} onToast={onToast} />;
    case 'equation':
      return <EquationBlock block={b} updateBlock={updateBlock} />;
    case 'divider':
      return (
        <div className="block">
          <button className="divider-row" aria-label="Divisor">
            <hr />
          </button>
        </div>
      );
    default: {
      const cls = b.type === 'text' ? '' : b.type;
      return <div className={`block ${cls ? `block--${cls}` : ''}`}>{content}</div>;
    }
  }
}

function CalloutBlock({
  block: b,
  content,
  updateBlock,
}: {
  block: Block;
  content: ReactNode;
  updateBlock: (patch: Partial<Block>) => void;
}) {
  const [open, setOpen] = useState(false);
  const icon = (b.calloutIcon || 'info') as IconName;
  const tone = b.calloutTone ?? 'ink';
  return (
    <div className={`block block--callout callout-tone-${tone}`}>
      <div className="block-body">
        <button
          className="callout-ic-btn"
          onClick={() => setOpen((v) => !v)}
          aria-label="Cambiar icono y tono del destacado"
          aria-expanded={open}
        >
          <Icon name={icon} size={17} className="callout-ic" />
        </button>
        <div className="callout-main">
          {content}
          {open && (
            <div className="callout-menu" role="dialog" aria-label="Estilo del destacado">
              <p className="callout-menu__label">Icono</p>
              <div className="callout-menu__icons">
                {CALLOUT_ICONS.map((name) => (
                  <button
                    key={name}
                    className={icon === name ? 'is-sel' : ''}
                    onClick={() => { updateBlock({ calloutIcon: name }); setOpen(false); }}
                    aria-label={`Icono ${name}`}
                  >
                    <Icon name={name as IconName} size={15} />
                  </button>
                ))}
              </div>
              <p className="callout-menu__label">Tono</p>
              <div className="callout-menu__tones">
                {CALLOUT_TONES.map((t) => (
                  <button
                    key={t.id}
                    className={tone === t.id ? 'is-sel' : ''}
                    data-tone={t.id}
                    onClick={() => { updateBlock({ calloutTone: t.id }); setOpen(false); }}
                  >
                    <i /> {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CodeBlock({
  block: b,
  content,
  updateBlock,
  onToast,
}: {
  block: Block;
  content: ReactNode;
  updateBlock: (patch: Partial<Block>) => void;
  onToast: (msg: string, kind?: 'ok' | 'info' | 'err') => void;
}) {
  const languages = CODE_LANGS.includes(b.lang ?? 'plain') ? CODE_LANGS : [b.lang ?? 'plain', ...CODE_LANGS];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(b.text);
      onToast('Código copiado');
    } catch {
      const area = document.createElement('textarea');
      area.value = b.text;
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); onToast('Código copiado'); }
      catch { onToast('No se pudo copiar', 'err'); }
      area.remove();
    }
  };
  return (
    <div className="block block--code">
      <div className="codehead">
        <select
          className="codelang"
          value={b.lang ?? 'plain'}
          onChange={(e) => updateBlock({ lang: e.target.value })}
          aria-label="Lenguaje del código"
        >
          {languages.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <span className="codehead__grow" />
        <span className="codehead__lines">
          {b.text ? `${b.text.split('\n').length} ${b.text.split('\n').length === 1 ? 'línea' : 'líneas'}` : 'vacío'}
        </span>
        <button className="codecopy" onClick={copy} title="Copiar código" aria-label="Copiar código">
          <Icon name="copy" size={12} /> Copiar
        </button>
      </div>
      {content}
    </div>
  );
}

function TableBlock({
  block: b,
  updateBlock,
}: {
  block: Block;
  updateBlock: (patch: Partial<Block>) => void;
}) {
  const table = tableOf(b);
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const setTable = (next: TableData) => updateBlock({ table: next });
  const setCell = (r: number, c: number, value: string) => {
    const rows = table.rows.map((row) => [...row]);
    rows[r][c] = value;
    setTable({ ...table, rows });
  };
  const addRow = () => setTable({ ...table, rows: [...table.rows, Array.from({ length: Math.max(1, table.rows[0]?.length ?? 2) }, () => '')] });
  const addCol = () => setTable({ ...table, rows: table.rows.map((r) => [...r, '']) });
  const delRow = (r: number) => {
    if (table.rows.length <= 1) return;
    setTable({ ...table, rows: table.rows.filter((_, i) => i !== r) });
  };
  const delCol = (c: number) => {
    if ((table.rows[0]?.length ?? 0) <= 1) return;
    setTable({ ...table, rows: table.rows.map((row) => row.filter((_, i) => i !== c)) });
  };
  const rows = table.rows.length ? table.rows : [['', '']];

  return (
    <div className="block block--table">
      <div className="tabletools">
        <button className="btn-ghost btn-ghost--small" onClick={addRow}><Icon name="plus" size={11} /> Fila</button>
        <button className="btn-ghost btn-ghost--small" onClick={addCol}><Icon name="plus" size={11} /> Columna</button>
        <label className="tablehead-toggle">
          <input type="checkbox" checked={table.header} onChange={(e) => setTable({ ...table, header: e.target.checked })} />
          Fila de encabezado
        </label>
      </div>
      <div className="tablewrap">
        <table className="edittable" aria-label="Tabla editable">
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => {
                  const isHead = table.header && r === 0;
                  const Tag = isHead ? 'th' : 'td';
                  return (
                    <Tag key={c} onMouseEnter={() => setHover({ r, c })} onMouseLeave={() => setHover(null)}>
                      <input
                        className="tablecell"
                        value={cell}
                        onChange={(e) => setCell(r, c, e.target.value)}
                        aria-label={`Celda fila ${r + 1}, columna ${c + 1}`}
                        placeholder={isHead ? 'Encabezado' : ''}
                      />
                      {hover?.r === r && hover?.c === c && (
                        <span className="tablecell__tools">
                          {c > 0 && (
                            <button title="Eliminar columna" aria-label="Eliminar columna" onClick={() => delCol(c)}>
                              <Icon name="x" size={10} />
                            </button>
                          )}
                          {r > 0 && (
                            <button title="Eliminar fila" aria-label="Eliminar fila" onClick={() => delRow(r)}>
                              <Icon name="trash" size={10} />
                            </button>
                          )}
                        </span>
                      )}
                    </Tag>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ColumnsBlock({
  block: b,
  updateBlock,
}: {
  block: Block;
  updateBlock: (patch: Partial<Block>) => void;
}) {
  const cols = b.columns && b.columns.length >= 2 ? b.columns : defaultColumns();
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    cols.forEach((c, i) => {
      const el = refs.current[i];
      if (el && document.activeElement !== el && el.innerHTML !== c.html) el.innerHTML = c.html;
    });
  }, [cols]);

  const commit = (index: number, el: HTMLElement) => {
    const next = cols.map((c, i) => (i === index ? { id: c.id, html: sanitizeInline(el.innerHTML), text: htmlToText(el.innerHTML) } : c));
    updateBlock({ columns: next });
  };

  const add = () => {
    if (cols.length >= 3) return;
    updateBlock({ columns: [...cols, { id: `col-${Math.random().toString(36).slice(2, 9)}`, html: '', text: '' }] });
  };
  const remove = (i: number) => {
    if (cols.length <= 2) return;
    updateBlock({ columns: cols.filter((_, x) => x !== i) });
  };

  return (
    <div className="block block--columns">
      <div className="columnstools">
        Columnas · {cols.length}
        {cols.length < 3 && <button className="btn-ghost btn-ghost--small" onClick={add}><Icon name="plus" size={11} /> Añadir</button>}
      </div>
      <div className="columnswrap" data-count={cols.length}>
        {cols.map((col, i) => (
          <div key={col.id} className="columncell">
            <div
              ref={(el) => { refs.current[i] = el; }}
              className="columncontent"
              contentEditable
              suppressContentEditableWarning
              data-placeholder="Escribe en esta columna…"
              role="textbox"
              aria-label={`Columna ${i + 1}`}
              onFocus={() => setActive(i)}
              onBlur={(e) => { setActive(null); commit(i, e.currentTarget); }}
              onInput={(e) => commit(i, e.currentTarget)}
            />
            {active === i && cols.length > 2 && (
              <button className="columnremove" onClick={() => remove(i)} title="Eliminar columna">
                <Icon name="x" size={10} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BookmarkBlock({
  block: b,
  updateBlock,
  onToast,
}: {
  block: Block;
  updateBlock: (patch: Partial<Block>) => void;
  onToast: (msg: string, kind?: 'ok' | 'info' | 'err') => void;
}) {
  const [url, setUrl] = useState(b.url ?? '');
  const [editing, setEditing] = useState(!b.url);
  const save = () => {
    const clean = normalizeUrl(url);
    if (!isSafeUrl(clean)) { onToast('Escribe una URL http(s) válida.', 'err'); return; }
    updateBlock({ url: clean, title: hostOf(clean), description: b.description ?? '' });
    setUrl(clean);
    setEditing(false);
    onToast('Marcador guardado');
  };
  if (editing) {
    return (
      <div className="block block--bookmarkedit">
        <Icon name="bookmark" size={18} />
        <input
          type="url"
          className="urlfield"
          value={url}
          placeholder="https://ejemplo.com/articulo"
          aria-label="URL del marcador"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape' && b.url) setEditing(false); }}
          autoFocus={!b.url}
        />
        <button className="btn btn--primary btn--small" onClick={save}>Guardar</button>
      </div>
    );
  }
  return (
    <div className="block block--bookmark">
      <div className="bookmarkcard">
        <span className="bookmarkcard__fav">{hostOf(b.url ?? '').slice(0, 1).toUpperCase()}</span>
        <div className="bookmarkcard__body">
          <input
            className="bookmarkcard__title"
            value={b.title ?? ''}
            placeholder={hostOf(b.url ?? '')}
            aria-label="Título del marcador"
            onChange={(e) => updateBlock({ title: e.target.value })}
          />
          <input
            className="bookmarkcard__desc"
            value={b.description ?? ''}
            placeholder="Añade una descripción…"
            aria-label="Descripción del marcador"
            onChange={(e) => updateBlock({ description: e.target.value })}
          />
          <span className="bookmarkcard__host">{hostOf(b.url ?? '')}</span>
        </div>
        <a className="bookmarkcard__open" href={b.url} target="_blank" rel="noopener noreferrer" title="Abrir enlace" aria-label="Abrir marcador">
          <Icon name="arrowRight" size={15} />
        </a>
        <button className="rowaction" title="Cambiar URL" aria-label="Cambiar URL" onClick={() => { setUrl(b.url ?? ''); setEditing(true); }}>
          <Icon name="pen" size={12} />
        </button>
      </div>
    </div>
  );
}

function EmbedBlock({
  block: b,
  updateBlock,
  onToast,
}: {
  block: Block;
  updateBlock: (patch: Partial<Block>) => void;
  onToast: (msg: string, kind?: 'ok' | 'info' | 'err') => void;
}) {
  const [url, setUrl] = useState(b.url ?? '');
  const [editing, setEditing] = useState(!b.url);
  const info = b.url ? embedFor(b.url) : null;
  const save = () => {
    const info2 = embedFor(url);
    if (!info2) { onToast('Pega una URL de YouTube, Vimeo o Spotify.', 'err'); return; }
    updateBlock({ url: info2.src, title: info2.label, embedType: info2.type });
    setUrl(info2.src);
    setEditing(false);
    onToast(`Incrustado de ${info2.label}`);
  };
  if (editing) {
    return (
      <div className="block block--embededit">
        <Icon name="globe" size={18} />
        <input
          type="url"
          className="urlfield"
          value={url}
          placeholder="https://youtube.com/watch?v=…"
          aria-label="URL para incrustar"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape' && b.url) setEditing(false); }}
          autoFocus={!b.url}
        />
        <button className="btn btn--primary btn--small" onClick={save}>Incrustar</button>
      </div>
    );
  }
  return (
    <div className="block block--embed">
      <div className="embedhead">
        <span><Icon name="globe" size={13} /> {info?.label ?? 'Incrustado'}</span>
        <span className="embedhead__grow" />
        <button className="btn-ghost btn-ghost--small" onClick={() => { setUrl(b.url ?? ''); setEditing(true); }}>Cambiar</button>
        <a className="btn-ghost btn-ghost--small" href={b.url} target="_blank" rel="noopener noreferrer">Abrir</a>
      </div>
      {info && info.type !== 'generic' ? (
        <div className={`embedframe embedframe--${info.type}`}>
          <iframe
            src={info.src}
            title={`Incrustado de ${info.label}`}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : (
        <a className="embedfallback" href={b.url} target="_blank" rel="noopener noreferrer">
          <Icon name="globe" size={20} />
          <span>
            <b>{b.title || 'Abrir enlace'}</b>
            <small>{b.url}</small>
          </span>
          <Icon name="arrowRight" size={14} />
        </a>
      )}
    </div>
  );
}

function MediaBlock({
  block: b,
  updateBlock,
  onToast,
}: {
  block: Block;
  updateBlock: (patch: Partial<Block>) => void;
  onToast: (msg: string, kind?: 'ok' | 'info' | 'err') => void;
}) {
  const [url, setUrl] = useState(b.url ?? '');
  const video = b.type === 'video';
  const save = () => {
    const clean = normalizeUrl(url);
    if (!isSafeUrl(clean)) { onToast('Necesito una URL de vídeo o audio válida.', 'err'); return; }
    updateBlock({ url: clean });
    setUrl(clean);
    onToast(video ? 'Vídeo incrustado' : 'Audio incrustado');
  };
  if (!b.url) {
    return (
      <div className={`block block--${video ? 'video' : 'audio'}edit`}>
        <Icon name={video ? 'video' : 'audio'} size={18} />
        <input
          type="url"
          className="urlfield"
          value={url}
          placeholder={video ? 'https://…/video.mp4' : 'https://…/audio.mp3'}
          aria-label={video ? 'URL del vídeo' : 'URL del audio'}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          autoFocus
        />
        <button className="btn btn--primary btn--small" onClick={save}>Insertar</button>
      </div>
    );
  }
  return (
    <div className={`block block--${video ? 'video' : 'audio'}`}>
      <div className="mediahead">
        <Icon name={video ? 'video' : 'audio'} size={13} /> {video ? 'Vídeo' : 'Audio'}
        <span style={{ flex: 1 }} />
        <button className="rowaction" title="Cambiar URL" aria-label="Cambiar URL" onClick={() => { setUrl(b.url ?? ''); updateBlock({ url: '' }); }}>
          <Icon name="pen" size={12} />
        </button>
        <button className="rowaction" title="Quitar" aria-label="Quitar medio" onClick={() => updateBlock({ url: '' })}>
          <Icon name="x" size={12} />
        </button>
      </div>
      {video ? (
        <video className="mediablock" controls src={b.url} preload="metadata" />
      ) : (
        <audio className="mediablock" controls src={b.url} preload="metadata" />
      )}
    </div>
  );
}

function EquationBlock({
  block: b,
  updateBlock,
}: {
  block: Block;
  updateBlock: (patch: Partial<Block>) => void;
}) {
  const [source, setSource] = useState(b.equation ?? '');
  const [editing, setEditing] = useState(!b.equation);
  const save = () => {
    updateBlock({ equation: source });
    setEditing(false);
  };
  return (
    <div className="block block--equation">
      <div className="equationhead">
        <span><Icon name="equation" size={13} /> Ecuación</span>
        <span style={{ flex: 1 }} />
        <button className="btn-ghost btn-ghost--small" onClick={() => setEditing((v) => !v)}>
          {editing ? 'Ver' : 'Editar'}
        </button>
      </div>
      {editing ? (
        <div className="equationedit">
          <textarea
            className="equationfield"
            value={source}
            placeholder="\frac{a}{b} = \sqrt{c^2 + d^2}"
            aria-label="Fórmula LaTeX"
            onChange={(e) => setSource(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
              if (e.key === 'Escape') { setSource(b.equation ?? ''); setEditing(false); }
            }}
            spellCheck={false}
          />
          <div className="equationpreview" aria-label="Vista previa de la ecuación" dangerouslySetInnerHTML={{ __html: renderEquation(source || '') }} />
          <div className="equationexamples">
            {['\\frac{a}{b}', '\\sqrt{x^2 + y^2}', '\\sum_{i=1}^{n} x_i', 'e^{i\\pi} + 1 = 0'].map((ex) => (
              <button key={ex} className="equationchip" onClick={() => setSource(ex)}>{ex}</button>
            ))}
          </div>
        </div>
      ) : (
        <div className="equationrender" dangerouslySetInnerHTML={{ __html: renderEquation(b.equation ?? '') }} />
      )}
    </div>
  );
}
