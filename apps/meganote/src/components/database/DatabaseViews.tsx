import { useMemo } from 'react';
import { Icon, type IconName } from '../../lib/icons';
import type { ChartKind, DBColumn, DBRow, Page } from '../../lib/types';
import { cellText } from '../../lib/dbUtils';

type ChartPoint = { key: string; label: string; value: number; tone: 'sage' | 'terra' | 'ink' };

const CHART_KINDS: { id: ChartKind; label: string; icon: IconName }[] = [
  { id: 'bar', label: 'Barras', icon: 'chart' },
  { id: 'horizontal', label: 'Horizontal', icon: 'sort' },
  { id: 'line', label: 'Líneas', icon: 'chartLine' },
  { id: 'donut', label: 'Donut', icon: 'chartDonut' },
];

function toneColor(tone: ChartPoint['tone']): string {
  if (tone === 'sage') return 'var(--sage)';
  if (tone === 'terra') return 'var(--terra)';
  return 'var(--ink-70, var(--ink))';
}

export function ChartView({
  db,
  mutate,
}: {
  db: NonNullable<Page['db']>;
  mutate: (fn: (draft: NonNullable<Page['db']>) => void) => void;
}) {
  const candidates = useMemo(
    () => db.columns.filter((c) => c.type === 'select' || c.type === 'date' || c.type === 'checkbox' || c.type === 'text'),
    [db.columns],
  );
  const numeric = useMemo(() => db.columns.filter((c) => c.type === 'number'), [db.columns]);
  const axis =
    candidates.find((c) => c.id === db.chartColumnId)
    ?? candidates.find((c) => c.type === 'select')
    ?? candidates.find((c) => c.type === 'date')
    ?? candidates.find((c) => c.type === 'checkbox')
    ?? candidates[0]
    ?? null;
  const metricCol = numeric.find((c) => c.id === db.chartMetricColumnId) ?? null;
  const metricOp = db.chartMetricOp ?? 'sum';
  const kind = db.chartKind ?? 'bar';

  const aggregate = (rows: DBRow[]): number => {
    if (!metricCol) return rows.length;
    const sum = rows.reduce((acc, row) => {
      const raw = row.cells[metricCol.id];
      return acc + (typeof raw === 'number' ? raw : Number(raw ?? 0) || 0);
    }, 0);
    if (metricOp === 'avg' && rows.length > 0) return sum / rows.length;
    return sum;
  };

  const points = useMemo<ChartPoint[]>(() => {
    if (!axis) return [];
    if (axis.type === 'select') {
      const out: ChartPoint[] = (axis.options ?? []).map((o) => ({
        key: o.id,
        label: o.label,
        value: aggregate(db.rows.filter((r) => r.cells[axis.id] === o.id)),
        tone: o.tone,
      }));
      const none = db.rows.filter((r) => !r.cells[axis.id]);
      if (none.length > 0) out.push({ key: '__none__', label: 'Sin valor', value: aggregate(none), tone: 'ink' });
      return out;
    }
    if (axis.type === 'checkbox') {
      return [
        { key: 'yes', label: 'Hecho', value: aggregate(db.rows.filter((r) => !!r.cells[axis.id])), tone: 'sage' },
        { key: 'no', label: 'Pendiente', value: aggregate(db.rows.filter((r) => !r.cells[axis.id])), tone: 'ink' },
      ];
    }
    if (axis.type === 'date') {
      const now = new Date();
      const months: { key: string; label: string }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
          key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          label: d.toLocaleString('es', { month: 'short' }),
        });
      }
      return months.map((m) => ({
        key: m.key,
        label: m.label,
        value: aggregate(db.rows.filter((r) => typeof r.cells[axis.id] === 'string' && String(r.cells[axis.id]).startsWith(m.key))),
        tone: 'terra',
      }));
    }
    const groups = new Map<string, DBRow[]>();
    for (const row of db.rows) {
      const raw = row.cells[axis.id];
      const label = String(raw ?? '').trim() || 'Sin valor';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(row);
    }
    const ordered = [...groups.entries()]
      .map(([label, rows], index) => ({
        key: label,
        label,
        rows,
        value: aggregate(rows),
        tone: (['ink', 'terra', 'sage'] as const)[index % 3],
      }))
      .sort((a, b) => b.value - a.value);
    const top: ChartPoint[] = ordered.slice(0, 8).map(({ key, label, value, tone }) => ({ key, label, value, tone }));
    if (ordered.length > 8) {
      top.push({
        key: '__other__',
        label: 'Otros',
        value: aggregate(ordered.slice(8).flatMap((x) => x.rows)),
        tone: 'ink',
      });
    }
    return top;
  }, [axis, db.rows, metricCol, metricOp]);

  if (candidates.length === 0) {
    return (
      <p style={{ color: 'var(--ink-55)', padding: '30px 8px' }}>
        Añade una propiedad de <b>Selección</b>, <b>Fecha</b>, <b>Casilla</b> o <b>Texto</b> para graficar los datos.
      </p>
    );
  }

  const total = points.reduce((acc, p) => acc + p.value, 0);
  const max = Math.max(1, ...points.map((p) => p.value));
  const avg = points.length > 0 ? total / points.length : 0;
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const valueLabel = metricCol
    ? `${metricOp === 'avg' ? 'Media' : 'Suma'} de ${metricCol.name}`
    : 'Recuento de filas';

  const W = 820;
  const H = 300;
  const PT = 28;
  const PB = 48;
  const barPL = 14;
  const barPR = 14;
  const innerH = H - PT - PB;

  const setMetric = (value: string) => {
    mutate((d) => {
      if (value === 'count') {
        d.chartMetricColumnId = null;
      } else {
        const [op, id] = value.split(':');
        d.chartMetricOp = op as 'sum' | 'avg';
        d.chartMetricColumnId = id;
      }
    });
  };

  return (
    <div className="chartwrap">
      <div className="charttools">
        <div className="charttool">
          <span className="charttools__label">Agrupar por</span>
          <select
            className="dbselect"
            value={axis?.id ?? ''}
            onChange={(e) => mutate((d) => { d.chartColumnId = e.target.value; })}
            aria-label="Columna para agrupar el gráfico"
          >
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="charttool">
          <span className="charttools__label">Valor</span>
          <select
            className="dbselect"
            value={metricCol ? `${metricOp}:${metricCol.id}` : 'count'}
            onChange={(e) => setMetric(e.target.value)}
            aria-label="Qué valor mostrar en el gráfico"
          >
            <option value="count">Recuento de filas</option>
            {numeric.map((c) => (
              <option key={`sum-${c.id}`} value={`sum:${c.id}`}>Suma de {c.name}</option>
            ))}
            {numeric.map((c) => (
              <option key={`avg-${c.id}`} value={`avg:${c.id}`}>Media de {c.name}</option>
            ))}
          </select>
        </div>
        <div className="chartkinds" role="tablist" aria-label="Tipo de gráfico">
          {CHART_KINDS.map((k) => (
            <button
              key={k.id}
              role="tab"
              aria-selected={kind === k.id}
              className={kind === k.id ? 'is-active' : ''}
              onClick={() => mutate((d) => { d.chartKind = k.id; })}
            >
              <Icon name={k.icon} size={14} /> {k.label}
            </button>
          ))}
        </div>
      </div>

      <div className="chartstats">
        <div><b>{fmt(total)}</b><span>Total</span></div>
        <div><b>{fmt(max)}</b><span>Máximo</span></div>
        <div><b>{fmt(avg)}</b><span>Media por grupo</span></div>
        <div><b>{points.length}</b><span>Grupos</span></div>
      </div>

      {points.length === 0 ? (
        <p className="chartempty">Aún no hay datos que dibujar.</p>
      ) : kind === 'donut' ? (
        <div className="donutwrap">
          <svg className="donutchart" viewBox="0 0 280 280" role="img" aria-label={`Gráfico donut de ${axis?.name ?? ''}`}>
            <circle cx="140" cy="140" r="92" fill="none" stroke="var(--line-soft)" strokeWidth="30" />
            {(() => {
              let offset = 0;
              return points.map((p) => {
                const pct = total > 0 ? p.value / total : 0;
                const dash = pct * 100;
                const el = (
                  <circle
                    key={p.key}
                    cx="140"
                    cy="140"
                    r="92"
                    fill="none"
                    stroke={toneColor(p.tone)}
                    strokeWidth="30"
                    pathLength={100}
                    strokeDasharray={`${dash} ${100 - dash}`}
                    strokeDashoffset={-offset}
                    transform="rotate(-90 140 140)"
                  >
                    <title>{`${p.label}: ${fmt(p.value)}`}</title>
                  </circle>
                );
                offset += dash;
                return el;
              });
            })()}
            <text x="140" y="134" textAnchor="middle" className="donuttotal">{fmt(total)}</text>
            <text x="140" y="156" textAnchor="middle" className="donutcap">{metricCol ? metricCol.name : 'filas'}</text>
          </svg>
          <ul className="donutlegend">
            {points.map((p) => (
              <li key={p.key}>
                <i style={{ background: toneColor(p.tone) }} />
                <span className="donutlegend__name">{p.label}</span>
                <span className="donutlegend__value">{fmt(p.value)}</span>
                <span className="donutlegend__pct">{total > 0 ? Math.round((p.value / total) * 100) : 0}%</span>
              </li>
            ))}
          </ul>
        </div>
      ) : kind === 'line' ? (
        <svg className="chartsvg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Gráfico de líneas de ${axis?.name ?? ''}`}>
          {[0.25, 0.5, 0.75].map((f, i) => {
            const y = PT + innerH * (1 - f);
            return <line key={i} x1={barPL} x2={W - barPR} y1={y} y2={y} stroke="var(--line-soft)" strokeDasharray="2 5" />;
          })}
          <line x1={barPL} x2={W - barPR} y1={PT + innerH} y2={PT + innerH} stroke="var(--line)" />
          {(() => {
            const slot = (W - barPL - barPR) / Math.max(1, points.length);
            const coords = points.map((p, i) => ({
              x: barPL + slot * i + slot / 2,
              y: PT + innerH - (p.value / max) * innerH,
              p,
            }));
            const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x} ${c.y}`).join(' ');
            const area = `${path} L ${coords[coords.length - 1].x} ${PT + innerH} L ${coords[0].x} ${PT + innerH} Z`;
            return (
              <>
                <path d={area} fill="color-mix(in oklab, var(--terra) 14%, transparent)" stroke="none" />
                <path d={path} fill="none" stroke="var(--terra)" strokeWidth="2.2" strokeLinejoin="round" />
                {coords.map((c) => (
                  <g key={c.p.key}>
                    <title>{`${c.p.label}: ${fmt(c.p.value)}`}</title>
                    <circle cx={c.x} cy={c.y} r="4.2" fill="var(--paper)" stroke="var(--terra)" strokeWidth="2" />
                    {c.p.value > 0 && <text x={c.x} y={c.y - 11} textAnchor="middle" className="chartval">{fmt(c.p.value)}</text>}
                    <text x={c.x} y={PT + innerH + 19} textAnchor="middle" className="chartlab">{c.p.label.length > 14 ? c.p.label.slice(0, 13) + '…' : c.p.label}</text>
                  </g>
                ))}
              </>
            );
          })()}
        </svg>
      ) : kind === 'horizontal' ? (
        <svg className="chartsvg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Gráfico horizontal de ${axis?.name ?? ''}`}>
          {[0.25, 0.5, 0.75].map((f, i) => {
            const x = 170 + (W - 230) * f;
            return <line key={i} x1={x} x2={x} y1={PT} y2={PT + innerH} stroke="var(--line-soft)" strokeDasharray="2 5" />;
          })}
          {(() => {
            const labelW = 158;
            const barW = W - labelW - 60;
            const rowH = innerH / Math.max(1, points.length);
            return points.map((p, i) => {
              const y = PT + i * rowH + rowH * 0.2;
              const h = Math.max(8, Math.min(26, rowH * 0.58));
              const w = (p.value / max) * barW;
              return (
                <g key={p.key}>
                  <title>{`${p.label}: ${fmt(p.value)}`}</title>
                  <text x={labelW - 10} y={y + h * 0.7} textAnchor="end" className="chartlab">{p.label.length > 20 ? p.label.slice(0, 19) + '…' : p.label}</text>
                  <rect x={labelW} y={y} width={Math.max(2, w)} height={h} rx={4} fill={toneColor(p.tone)} opacity={p.value > 0 ? 1 : 0.25} />
                  <text x={labelW + w + 8} y={y + h * 0.7} className="chartval">{fmt(p.value)}</text>
                </g>
              );
            });
          })()}
        </svg>
      ) : (
        <svg className="chartsvg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Gráfico de barras de ${axis?.name ?? ''}`}>
          {[0.25, 0.5, 0.75].map((f, i) => {
            const y = PT + innerH * (1 - f);
            return <line key={i} x1={barPL} x2={W - barPR} y1={y} y2={y} stroke="var(--line-soft)" strokeDasharray="2 5" />;
          })}
          <line x1={barPL} x2={W - barPR} y1={PT + innerH} y2={PT + innerH} stroke="var(--line)" />
          {(() => {
            const innerW = W - barPL - barPR;
            const slot = innerW / Math.max(1, points.length);
            const barW = Math.min(78, slot * 0.62);
            return points.map((p, i) => {
              const h = (p.value / max) * innerH;
              const x = barPL + i * slot + (slot - barW) / 2;
              const y = PT + innerH - h;
              return (
                <g key={p.key} className="chartbar">
                  <title>{`${p.label}: ${fmt(p.value)}`}</title>
                  <rect x={x} y={y} width={barW} height={Math.max(h, p.value > 0 ? 3 : 2)} rx={5} fill={toneColor(p.tone)} opacity={p.value > 0 ? 1 : 0.25} />
                  {p.value > 0 && <text x={x + barW / 2} y={y - 8} textAnchor="middle" className="chartval">{fmt(p.value)}</text>}
                  <text x={x + barW / 2} y={PT + innerH + 20} textAnchor="middle" className="chartlab">{p.label.length > 14 ? p.label.slice(0, 13) + '…' : p.label}</text>
                </g>
              );
            });
          })()}
        </svg>
      )}

      <p className="chartfoot">
        {points.length} {points.length === 1 ? 'grupo' : 'grupos'} · eje: {axis?.name} · {valueLabel} · guardado localmente
      </p>
    </div>
  );
}

export function GalleryView({
  db,
  firstColId,
  onAdd,
  onDelete,
  onOpen,
  onDuplicate,
  setCell,
  hideEmpty,
}: {
  db: NonNullable<Page['db']>;
  firstColId: string;
  onAdd: () => void;
  onDelete: (rowId: string) => void;
  onOpen: (rowId: string) => void;
  onDuplicate: (rowId: string) => void;
  setCell: (rowId: string, colId: string, value: DBRow['cells'][string]) => void;
  hideEmpty?: boolean;
}) {
  const first = db.columns.find((c) => c.id === firstColId);
  const selectCols = db.columns.filter((c) => c.type === 'select');
  const coverCol = db.cardCoverColumnId === 'none'
    ? null
    : selectCols.find((c) => c.id === db.cardCoverColumnId) ?? selectCols[0] ?? null;
  const showProps = db.columns.filter((c) => c.id !== firstColId).slice(0, 4);
  const size = db.gallerySize ?? 'm';
  const rows = hideEmpty ? db.rows.filter((r) => String(r.cells[firstColId] ?? '').trim()) : db.rows;

  return (
    <div className={`gallerywrap gallerywrap--${size}`}>
      <div className="gallerygrid">
        {rows.map((row, index) => {
          const tone = coverCol?.options?.find((o) => o.id === row.cells[coverCol.id])?.tone;
          const opt = coverCol?.options?.find((o) => o.id === row.cells[coverCol.id]);
          return (
            <article key={row.id} className={`gcard gcard--${size}`}>
              <button
                className={`gcard__band${tone ? ` tone-${tone}` : ''}`}
                onClick={() => onOpen(row.id)}
                aria-label={`Abrir fila ${String(row.cells[firstColId] ?? 'Sin título')}`}
              >
                <span className="gcard__band-no">{String(index + 1).padStart(2, '0')}</span>
                {opt ? <span className="gcard__band-pill"><i />{opt.label}</span> : <Icon name="doc" size={18} />}
              </button>
              <div className="gcard__body">
                <input
                  className="gcard__title"
                  value={String(row.cells[firstColId] ?? '')}
                  placeholder={first?.name ?? 'Sin título'}
                  aria-label={first?.name ?? 'Título de la tarjeta'}
                  onChange={(e) => setCell(row.id, firstColId, e.target.value)}
                />
                <div className="gcard__props">
                  {showProps.map((col) => {
                    const value = row.cells[col.id];
                    if (col.type === 'select') {
                      const o = col.options?.find((x) => x.id === value);
                      return o ? (
                        <span key={col.id} className="pill" data-tone={o.tone}><i />{o.label}</span>
                      ) : null;
                    }
                    if (col.type === 'multiselect') {
                      const vals = Array.isArray(value) ? value : [];
                      if (vals.length === 0) return null;
                      return (
                        <span key={col.id} className="gcard__multi">
                          {vals.slice(0, 2).map((v) => {
                            const o = col.options?.find((x) => x.id === v);
                            return o ? <span key={v} className="pill" data-tone={o.tone}><i />{o.label}</span> : null;
                          })}
                          {vals.length > 2 && <span className="gcard__prop">+{vals.length - 2}</span>}
                        </span>
                      );
                    }
                    if (col.type === 'checkbox') {
                      return (
                        <span key={col.id} className={`gcard__bool${value ? ' is-on' : ''}`}>
                          <Icon name={value ? 'check' : 'x'} size={10} /> {col.name}
                        </span>
                      );
                    }
                    if (value === null || value === undefined || value === '') return null;
                    return <span key={col.id} className="gcard__prop">{col.name}: {cellText(row, col)}</span>;
                  })}
                </div>
                <div className="gcard__actions">
                  <button className="btn-ghost btn-ghost--small" onClick={() => onOpen(row.id)}>Abrir</button>
                  <button className="rowaction" title="Duplicar fila" aria-label="Duplicar fila" onClick={() => onDuplicate(row.id)}>
                    <Icon name="copy" size={12} />
                  </button>
                  <button className="rowdel" style={{ visibility: 'visible' }} title="Eliminar tarjeta" aria-label="Eliminar tarjeta" onClick={() => onDelete(row.id)}>
                    <Icon name="x" size={13} />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
        <button className="gcard gcard--add" onClick={onAdd}>
          <Icon name="plus" size={16} />
          <span>Nueva tarjeta</span>
        </button>
      </div>
    </div>
  );
}

export function CalendarView({
  db,
  dateCol,
  monthOffset,
  setMonthOffset,
  onAdd,
}: {
  db: NonNullable<Page['db']>;
  dateCol: DBColumn | null;
  monthOffset: number;
  setMonthOffset: (fn: (n: number) => number) => void;
  onAdd: (iso: string) => void;
}) {
  const base = new Date();
  const cursor = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const monthName = cursor.toLocaleString('es', { month: 'long', year: 'numeric' });

  const pad = (n: number) => String(n).padStart(2, '0');
  const localISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const cells: { iso: string; day: number; inMonth: boolean; today: boolean }[] = [];
  const todayISO = localISO(new Date());
  // semana empezando en lunes
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - firstDow + i);
    const iso = localISO(d);
    cells.push({
      iso,
      day: d.getDate(),
      inMonth: d.getMonth() === month,
      today: iso === todayISO,
    });
  }

  const byDate = new Map<string, DBRow[]>();
  if (dateCol) {
    for (const r of db.rows) {
      const v = r.cells[dateCol.id];
      if (typeof v === 'string' && v) {
        if (!byDate.has(v)) byDate.set(v, []);
        byDate.get(v)!.push(r);
      }
    }
  }

  const weekdays = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

  return (
    <div className="cal">
      <div className="cal__nav">
        <button className="iconbtn" onClick={() => setMonthOffset((n) => n - 1)} aria-label="Mes anterior"><span className="flip"><Icon name="chevronRight" size={15} /></span></button>
        <span className="cal__title">{monthName}</span>
        <button className="iconbtn" onClick={() => setMonthOffset((n) => n + 1)} aria-label="Mes siguiente"><Icon name="chevronRight" size={15} /></button>
        <button className="btn-ghost" onClick={() => setMonthOffset(() => 0)}>Hoy</button>
        {!dateCol && <span className="errormsg">Añade una propiedad de Fecha para fijar filas en el calendario.</span>}
      </div>
      <div className="cal__grid" role="grid" aria-label="Calendario">
        {weekdays.map((d) => (
          <div key={d} className="cal__dow">{d}</div>
        ))}
        {cells.map((c) => {
          const rows = byDate.get(c.iso) ?? [];
          return (
            <button
              key={c.iso}
              className={`cal__cell${c.inMonth ? '' : ' is-dim'}${c.today ? ' is-today' : ''}`}
              onClick={() => onAdd(c.iso)}
              aria-label={`Añadir fila el ${c.iso}`}
            >
              <span className="cal__day">{c.day}</span>
              {rows.map((r) => (
                <span key={r.id} className="cal__chip" title={String(r.cells['c-name'] ?? r.cells[Object.keys(r.cells)[0] ?? ''] ?? 'Sin título')}>
                  {String(r.cells['c-name'] ?? r.cells[Object.keys(r.cells)[0] ?? ''] ?? 'Sin título')}
                </span>
              ))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
