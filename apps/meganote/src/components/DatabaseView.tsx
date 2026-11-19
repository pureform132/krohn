import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from '../state/WorkspaceContext';
import { Icon, type IconName } from '../lib/icons';
import { getPageDrag, hasPageDrag } from '../lib/pageDrag';
import {
  newId, type CalcOp, type DBColumn, type DBFilter, type DBRow, type DBSort,
  type DBView, type FilterOp, type Page, type PropertyType,
} from '../lib/types';
import {
  CALC_LABELS, calcsFor, cellText, computeCalc, effectiveSorts, filterAndSort,
  formatStamp, isFilterValueHidden, opsFor,
} from '../lib/dbUtils';
import { CalendarView, ChartView, GalleryView } from './database/DatabaseViews';

const TONE_BY_INDEX = ['ink', 'terra', 'sage'] as const;

const PROPERTY_TYPES: { type: PropertyType; label: string; icon: IconName }[] = [
  { type: 'text', label: 'Texto', icon: 'text' },
  { type: 'number', label: 'Número', icon: 'sort' },
  { type: 'select', label: 'Selección', icon: 'toggle' },
  { type: 'multiselect', label: 'Selección múltiple', icon: 'list' },
  { type: 'date', label: 'Fecha', icon: 'calendar' },
  { type: 'checkbox', label: 'Casilla', icon: 'checkSquare' },
  { type: 'url', label: 'URL', icon: 'link' },
  { type: 'email', label: 'Correo', icon: 'mail' },
  { type: 'phone', label: 'Teléfono', icon: 'phone' },
  { type: 'created', label: 'Creada el', icon: 'clock' },
  { type: 'updated', label: 'Editada el', icon: 'history' },
];

const PROPERTY_LABEL: Record<PropertyType, string> = Object.fromEntries(
  PROPERTY_TYPES.map((p) => [p.type, p.label]),
) as Record<PropertyType, string>;

const TYPE_ICON: Record<PropertyType, IconName> = Object.fromEntries(
  PROPERTY_TYPES.map((p) => [p.type, p.icon]),
) as Record<PropertyType, IconName>;

const VIEWS: { v: DBView; label: string; icon: IconName }[] = [
  { v: 'table', label: 'Tabla', icon: 'table' },
  { v: 'list', label: 'Lista', icon: 'list' },
  { v: 'board', label: 'Tablero', icon: 'board' },
  { v: 'calendar', label: 'Calendario', icon: 'calendar' },
  { v: 'chart', label: 'Gráfico', icon: 'chart' },
  { v: 'gallery', label: 'Galería', icon: 'gallery' },
];

function cloneDB<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function moveInList<T extends { id: string }>(list: T[], draggedId: string, targetId: string, after: boolean): T[] {
  if (draggedId === targetId) return list;
  const from = list.findIndex((x) => x.id === draggedId);
  if (from < 0) return list;
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  const target = copy.findIndex((x) => x.id === targetId);
  if (target < 0) return list;
  copy.splice(target + (after ? 1 : 0), 0, item);
  return copy;
}

function toISODate(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function DatabaseView({ page }: { page: Page }) {
  const { updateDB, updatePage, toggleFavorite, trashPage, movePage, byId, toast } = useWorkspace();
  const db = page.db!;
  const [dragOver, setDragOver] = useState(false);
  const [dropNotice, setDropNotice] = useState<string | null>(null);
  const [addPropOpen, setAddPropOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [openCell, setOpenCell] = useState<string | null>(null);
  const [renamingCol, setRenamingCol] = useState<string | null>(null);
  const [colMenu, setColMenu] = useState<string | null>(null);
  const [optionCol, setOptionCol] = useState<string | null>(null);
  const [monthOffset, setMonthOffset] = useState(0);
  const [newOption, setNewOption] = useState('');
  const [rowOpen, setRowOpen] = useState<string | null>(null);
  const [colOver, setColOver] = useState<string | null>(null);
  const [rowOver, setRowOver] = useState<{ id: string; after: boolean } | null>(null);
  const addPropRef = useRef<HTMLDivElement>(null);
  const cellPopRef = useRef<HTMLDivElement>(null);
  const dragRow = useRef<string | null>(null);
  const dragCol = useRef<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  useEffect(() => {
    if (!dropNotice) return;
    const timer = window.setTimeout(() => setDropNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [dropNotice]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (addPropOpen && !addPropRef.current?.contains(t)) setAddPropOpen(false);
      if (openCell && !cellPopRef.current?.contains(t) && !t.closest('.pill')) setOpenCell(null);
      if (colMenu && !t.closest('.colmenu-wrap')) setColMenu(null);
      if ((filterOpen || sortOpen) && !t.closest('.dbtools')) { setFilterOpen(false); setSortOpen(false); }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setFilterOpen(false); setSortOpen(false); setOpenCell(null);
      setColMenu(null); setAddPropOpen(false); setRowOpen(null); setOptionCol(null);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [addPropOpen, openCell, colMenu, filterOpen, sortOpen]);

  const mutate = (fn: (draft: typeof db) => void) =>
    updateDB(page.id, (d) => {
      const draft = cloneDB(d);
      fn(draft);
      return draft;
    });

  const setView = (view: DBView) => mutate((d) => { d.view = view; });

  const filteredRows = useMemo(() => filterAndSort(db), [db]);
  const filters = (db.filters ?? []).filter((f) => db.columns.some((c) => c.id === f.columnId));
  const activeFilterCount = filters.length + (db.filter.trim() ? 1 : 0);
  const sorts = effectiveSorts(db);
  const sortIndexFor = (colId: string) => sorts.findIndex((s) => s.columnId === colId);

  const addRow = (preset?: Record<string, string | number | boolean | string[] | null>) => {
    const id = newId();
    mutate((d) => {
      const cells: DBRow['cells'] = {};
      for (const c of d.columns) {
        cells[c.id] = c.type === 'checkbox' ? false : c.type === 'multiselect' ? [] : c.type === 'number' ? null : '';
      }
      Object.assign(cells, preset ?? {});
      const stamp = Date.now();
      d.rows.push({ id, cells, created: stamp, updated: stamp });
    });
    return id;
  };

  const duplicateRow = (rowId: string) => {
    const copyId = newId();
    mutate((d) => {
      const index = d.rows.findIndex((r) => r.id === rowId);
      const source = d.rows[index];
      if (!source) return;
      const stamp = Date.now();
      const cells: DBRow['cells'] = cloneDB(source.cells);
      for (const c of d.columns) {
        if (c.type === 'checkbox' && cells[c.id] == null) cells[c.id] = false;
        if (c.type === 'multiselect' && !Array.isArray(cells[c.id])) cells[c.id] = [];
      }
      d.rows.splice(index + 1, 0, { id: copyId, cells, created: stamp, updated: stamp });
    });
    toast('Fila duplicada');
  };

  const setCell = (rowId: string, colId: string, value: DBRow['cells'][string]) =>
    mutate((d) => {
      const row = d.rows.find((r) => r.id === rowId);
      if (row) {
        row.cells[colId] = value;
        row.updated = Date.now();
      }
    });

  const deleteRow = (rowId: string) => mutate((d) => { d.rows = d.rows.filter((r) => r.id !== rowId); });
  const moveRow = (draggedId: string, targetId: string, after: boolean) =>
    mutate((d) => { d.rows = moveInList(d.rows, draggedId, targetId, after); });

  const addColumn = (type: PropertyType) => {
    const id = newId();
    mutate((d) => {
      const base: DBColumn = { id, name: PROPERTY_LABEL[type], type };
      if (type === 'select' || type === 'multiselect') {
        base.options = [
          { id: newId(), label: 'Opción A', tone: 'ink' },
          { id: newId(), label: 'Opción B', tone: 'terra' },
        ];
      }
      d.columns.push(base);
    });
    setAddPropOpen(false);
    toast(`Propiedad «${PROPERTY_LABEL[type]}» añadida`);
  };

  const deleteColumn = (colId: string) =>
    mutate((d) => {
      if (d.columns.length <= 1) return;
      d.columns = d.columns.filter((c) => c.id !== colId);
      for (const r of d.rows) delete r.cells[colId];
      d.filters = (d.filters ?? []).filter((f) => f.columnId !== colId);
      d.sorts = (d.sorts ?? []).filter((s) => s.columnId !== colId);
      if (d.sortColumnId === colId) { d.sortColumnId = null; d.sortDir = 'asc'; }
      if (d.groupByColumnId === colId) d.groupByColumnId = d.columns.find((c) => c.type === 'select')?.id ?? null;
      if (d.calendarColumnId === colId) d.calendarColumnId = d.columns.find((c) => c.type === 'date')?.id ?? null;
      if (d.listColumnIds) d.listColumnIds = d.listColumnIds.filter((id) => id !== colId);
      if (d.cardCoverColumnId === colId) d.cardCoverColumnId = null;
      if (d.calculations) delete d.calculations[colId];
    });

  const renameColumn = (colId: string, name: string) =>
    mutate((d) => {
      const col = d.columns.find((c) => c.id === colId);
      if (col) col.name = name.trim() || col.name;
    });

  const moveColumn = (colId: string, targetId: string, after: boolean) =>
    mutate((d) => { d.columns = moveInList(d.columns, colId, targetId, after); });

  const addSelectOption = (colId: string, label: string, applyTo?: { rowId: string; multi: boolean }) => {
    const id = newId();
    const clean = label.trim();
    if (!clean) return;
    mutate((d) => {
      const col = d.columns.find((c) => c.id === colId);
      if (!col || (col.type !== 'select' && col.type !== 'multiselect')) return;
      col.options = [...(col.options ?? []), { id, label: clean, tone: TONE_BY_INDEX[(col.options?.length ?? 0) % 3] }];
      if (applyTo) {
        const row = d.rows.find((r) => r.id === applyTo.rowId);
        if (row) {
          if (applyTo.multi) {
            const arr = Array.isArray(row.cells[colId]) ? row.cells[colId] as string[] : [];
            row.cells[colId] = [...arr, id];
          } else {
            row.cells[colId] = id;
          }
          row.updated = Date.now();
        }
      }
    });
    setNewOption('');
    return id;
  };

  const renameOption = (colId: string, optId: string, label: string) =>
    mutate((d) => {
      const col = d.columns.find((c) => c.id === colId);
      const opt = col?.options?.find((o) => o.id === optId);
      if (opt) opt.label = label.trim() || opt.label;
    });

  const recolorOption = (colId: string, optId: string) =>
    mutate((d) => {
      const col = d.columns.find((c) => c.id === colId);
      const opt = col?.options?.find((o) => o.id === optId);
      if (opt) opt.tone = TONE_BY_INDEX[(TONE_BY_INDEX.indexOf(opt.tone) + 1) % 3];
    });

  const deleteOption = (colId: string, optId: string) =>
    mutate((d) => {
      const col = d.columns.find((c) => c.id === colId);
      if (!col) return;
      col.options = (col.options ?? []).filter((o) => o.id !== optId);
      for (const row of d.rows) {
        const v = row.cells[colId];
        if (Array.isArray(v)) row.cells[colId] = v.filter((x) => x !== optId);
        else if (v === optId) row.cells[colId] = col.type === 'multiselect' ? [] : null;
      }
    });

  const convertColumn = (colId: string, nextType: PropertyType) =>
    mutate((d) => {
      const col = d.columns.find((c) => c.id === colId);
      if (!col || col.type === nextType) return;
      const oldType = col.type;
      const wantedOptions = nextType === 'select' || nextType === 'multiselect';

      if (wantedOptions && !(col.options && col.options.length > 0)) {
        const seen = new Set<string>();
        const options: NonNullable<DBColumn['options']> = [];
        for (const row of d.rows) {
          const text = cellText(row, col).trim();
          if (!text || seen.has(text)) continue;
          seen.add(text);
          options.push({ id: newId(), label: text, tone: TONE_BY_INDEX[options.length % 3] });
          if (options.length >= 16) break;
        }
        if (options.length === 0) options.push({ id: newId(), label: 'Opción A', tone: 'ink' });
        col.options = options;
      }

      const labelToId = new Map<string, string>();
      for (const opt of col.options ?? []) labelToId.set(opt.label.toLowerCase(), opt.id);

      for (const row of d.rows) {
        const raw = row.cells[colId];
        if (nextType === 'select') {
          if (Array.isArray(raw)) row.cells[colId] = (raw[0] as string | undefined) ?? null;
          else if (typeof raw === 'boolean') {
            const label = raw ? 'Sí' : 'No';
            let opt = col.options?.find((o) => o.label.toLowerCase() === label.toLowerCase());
            if (!opt) {
              opt = { id: newId(), label, tone: raw ? 'sage' : 'ink' };
              col.options = [...(col.options ?? []), opt];
            }
            row.cells[colId] = opt.id;
          } else if (raw != null && raw !== '') {
            const text = cellText(row, col);
            row.cells[colId] = labelToId.get(text.toLowerCase())
              ?? col.options?.find((o) => o.id === raw)?.id
              ?? null;
          } else {
            row.cells[colId] = null;
          }
        } else if (nextType === 'multiselect') {
          if (Array.isArray(raw)) row.cells[colId] = raw;
          else if (raw != null && raw !== '') {
            const text = cellText(row, col);
            const id = labelToId.get(text.toLowerCase()) ?? col.options?.find((o) => o.id === raw)?.id ?? null;
            row.cells[colId] = id ? [id] : [];
          } else {
            row.cells[colId] = [];
          }
        } else if (nextType === 'number') {
          if (typeof raw === 'boolean') row.cells[colId] = raw ? 1 : 0;
          else {
            const n = Number(String(raw ?? '').replace(',', '.'));
            row.cells[colId] = Number.isFinite(n) && String(raw ?? '').trim() !== '' ? n : null;
          }
        } else if (nextType === 'checkbox') {
          const text = cellText(row, col).trim().toLowerCase();
          row.cells[colId] = typeof raw === 'boolean' ? raw : !!text && !['no', 'false', '0'].includes(text);
        } else if (nextType === 'date') {
          row.cells[colId] = toISODate(raw ?? cellText(row, col));
        } else if (nextType === 'created' || nextType === 'updated') {
          delete row.cells[colId];
        } else {
          row.cells[colId] = cellText(row, col);
        }
      }

      col.type = nextType;
      if (nextType !== 'select' && nextType !== 'multiselect') col.options = undefined;
      if (d.calculations && !calcsFor(col).includes(d.calculations[colId] ?? 'none')) {
        d.calculations[colId] = 'none';
      }
      if (oldType === nextType) return;
    });

  const cycleSort = (colId: string) =>
    mutate((d) => {
      const current = effectiveSorts(d);
      const index = current.findIndex((s) => s.columnId === colId);
      let next: DBSort[];
      if (index === 0) {
        next = current[0].dir === 'asc'
          ? [{ ...current[0], dir: 'desc' }]
          : current.slice(1);
      } else if (index > 0) {
        next = [{ ...current[index], dir: 'asc' }, ...current.filter((_, i) => i !== index)];
      } else {
        next = [{ id: newId(), columnId: colId, dir: 'asc' }, ...current];
      }
      d.sorts = next;
      d.sortColumnId = next[0]?.columnId ?? null;
      d.sortDir = next[0]?.dir ?? 'asc';
    });

  const addFilter = () => mutate((d) => {
    const col = d.columns[0];
    if (!col) return;
    const op = opsFor(col)[0]?.id ?? 'contains';
    d.filters = [...(d.filters ?? []), { id: newId(), columnId: col.id, op, value: '' }];
  });

  const updateFilter = (id: string, patch: Partial<DBFilter>) =>
    mutate((d) => {
      const f = (d.filters ?? []).find((x) => x.id === id);
      if (f) Object.assign(f, patch);
    });

  const removeFilter = (id: string) =>
    mutate((d) => { d.filters = (d.filters ?? []).filter((f) => f.id !== id); });

  const addSort = () => mutate((d) => {
    const col = d.columns[0];
    if (!col) return;
    const current = effectiveSorts(d);
    d.sorts = [...current, { id: newId(), columnId: col.id, dir: 'asc' }];
    d.sortColumnId = d.sorts[0]?.columnId ?? null;
    d.sortDir = d.sorts[0]?.dir ?? 'asc';
  });

  const updateSort = (id: string, patch: Partial<DBSort>) =>
    mutate((d) => {
      const next = effectiveSorts(d).map((s) => (s.id === id ? { ...s, ...patch } : s));
      d.sorts = next;
      d.sortColumnId = next[0]?.columnId ?? null;
      d.sortDir = next[0]?.dir ?? 'asc';
    });

  const removeSort = (id: string) =>
    mutate((d) => {
      const next = effectiveSorts(d).filter((s) => s.id !== id);
      d.sorts = next;
      d.sortColumnId = next[0]?.columnId ?? null;
      d.sortDir = next[0]?.dir ?? 'asc';
    });

  const groupCol = db.columns.find((c) => c.id === db.groupByColumnId && c.type === 'select')
    ?? db.columns.find((c) => c.type === 'select') ?? null;
  const dateCol = db.columns.find((c) => c.id === db.calendarColumnId && c.type === 'date')
    ?? db.columns.find((c) => c.type === 'date') ?? null;
  const firstColId = db.columns[0]?.id ?? '';
  const firstCol = db.columns[0];
  const openRow = rowOpen ? db.rows.find((r) => r.id === rowOpen) : undefined;
  const managerCol = optionCol ? db.columns.find((c) => c.id === optionCol) : undefined;
  const titleOf = (row: DBRow) => cellText(row, firstCol) || 'Sin título';

  const selectPopover = (row: DBRow, col: DBColumn, multi: boolean) => {
    const raw = row.cells[col.id];
    const values = multi && Array.isArray(raw) ? raw : [];
    return (
      <div className="cellopts" ref={cellPopRef} role="listbox" aria-label={`Elegir ${col.name}`} aria-multiselectable={multi}>
        {(col.options ?? []).map((o) => {
          const selected = multi ? values.includes(o.id) : raw === o.id;
          return (
            <button
              key={o.id}
              role="option"
              aria-selected={selected}
              className={selected ? 'is-sel' : ''}
              onClick={() => {
                if (multi) {
                  setCell(row.id, col.id, selected ? values.filter((v) => v !== o.id) : [...values, o.id]);
                } else {
                  setCell(row.id, col.id, selected ? null : o.id);
                  setOpenCell(null);
                }
              }}
            >
              <span className="pill" data-tone={o.tone} style={{ pointerEvents: 'none' }}><i />{o.label}</span>
              {selected && <Icon name="check" size={12} />}
            </button>
          );
        })}
        {(col.options ?? []).length === 0 && <p className="cellopts__empty">Aún no hay opciones.</p>}
        <button className="cellopts__manage" onClick={() => { setOptionCol(col.id); setOpenCell(null); }}>
          <Icon name="sliders" size={12} /> Gestionar opciones…
        </button>
        <div className="newopt">
          <Icon name="plus" size={11} />
          <input
            value={newOption}
            placeholder="Nueva opción…"
            onChange={(e) => setNewOption(e.target.value)}
            aria-label="Nueva opción de selección"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newOption.trim()) {
                addSelectOption(col.id, newOption, { rowId: row.id, multi });
                if (!multi) setOpenCell(null);
              }
            }}
          />
        </div>
      </div>
    );
  };

  const renderCell = (row: DBRow, col: DBColumn) => {
    const cellKey = `${row.id}:${col.id}`;
    const value = row.cells[col.id];
    if (col.type === 'select' || col.type === 'multiselect') {
      const multi = col.type === 'multiselect';
      const selected = multi && Array.isArray(value) ? value : [];
      const opt = multi
        ? col.options?.find((o) => o.id === selected[0])
        : col.options?.find((o) => o.id === value);
      return (
        <div className="cellwrap">
          <button
            className={`pill${multi && selected.length > 0 ? ' pill--multi' : ''}`}
            data-tone={opt?.tone ?? 'ink'}
            onClick={() => { setOpenCell(openCell === cellKey ? null : cellKey); setNewOption(''); }}
            aria-expanded={openCell === cellKey}
          >
            <i />
            {multi
              ? selected.length > 0
                ? selected.map((v) => col.options?.find((o) => o.id === v)?.label ?? '—').join(', ')
                : 'Vacío'
              : opt?.label ?? 'Elegir…'}
            {multi && selected.length > 1 && <span className="pill__count">{selected.length}</span>}
          </button>
          {openCell === cellKey && selectPopover(row, col, multi)}
        </div>
      );
    }
    if (col.type === 'checkbox') {
      return (
        <button
          className={`dbcheckcell${value ? ' is-on' : ''}`}
          role="checkbox"
          aria-checked={!!value}
          aria-label={col.name}
          onClick={() => setCell(row.id, col.id, !value)}
        >
          {value && <Icon name="check" size={11} strokeWidth={2.6} />}
        </button>
      );
    }
    if (col.type === 'date') {
      return (
        <input
          className="celldate"
          type="date"
          value={String(value ?? '')}
          onChange={(e) => setCell(row.id, col.id, e.target.value)}
          aria-label={col.name}
        />
      );
    }
    if (col.type === 'created' || col.type === 'updated') {
      return <span className="cellstamp">{formatStamp(col.type === 'created' ? row.created : row.updated) || '—'}</span>;
    }
    const inputType = col.type === 'number' ? 'number' : col.type === 'url' ? 'url' : col.type === 'email' ? 'email' : col.type === 'phone' ? 'tel' : 'text';
    return (
      <input
        className="cellinput"
        type={inputType}
        value={String(value ?? '')}
        onChange={(e) => setCell(row.id, col.id, col.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
        aria-label={col.name}
      />
    );
  };

  const groups = groupCol
    ? [...(groupCol.options ?? []), { id: '__none__', label: 'Sin estado', tone: 'ink' as const }]
        .map((opt) => ({
          opt,
          rows: filteredRows.filter((r) => (opt.id === '__none__' ? !r.cells[groupCol.id] : r.cells[groupCol.id] === opt.id)),
        }))
        .filter(({ rows }) => !db.boardHideEmpty || rows.length > 0)
    : [];

  return (
    <div
      className={`dbwrap${dragOver ? ' is-page-drop' : ''}`}
      onDragOver={(e) => {
        if (!hasPageDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        const next = e.relatedTarget as Node | null;
        if (!next || !e.currentTarget.contains(next)) setDragOver(false);
      }}
      onDrop={(e) => {
        const draggedId = getPageDrag(e);
        if (!draggedId) return;
        e.preventDefault();
        setDragOver(false);
        if (draggedId === page.id) return;
        if (!movePage(draggedId, page.id)) {
          setDropNotice('No puedes mover una página dentro de sí misma ni de sus subpáginas.');
          return;
        }
        setDropNotice(`«${byId.get(draggedId)?.title || 'Sin título'}» ahora vive dentro de esta base de datos.`);
      }}
    >
      <div className="titlerow" style={{ marginBottom: 14 }}>
        <div className="titleicon" aria-hidden="true" style={{ width: 44, height: 44 }}>
          <Icon name="database" size={22} />
        </div>
        <input
          className="titleinput"
          style={{ fontSize: '30px', flex: 1, minWidth: 0 }}
          value={page.title}
          placeholder="Base de datos sin título"
          aria-label="Nombre de la base de datos"
          onChange={(e) => updatePage(page.id, { title: e.target.value })}
        />
        <button className="rowaction" style={{ marginTop: 10 }} title={page.favorite ? 'Quitar de favoritos' : 'Guardar en favoritos'} onClick={() => toggleFavorite(page.id)} aria-label="Alternar favorito">
          <Icon name="star" size={16} filled={page.favorite} />
        </button>
        <button className="rowaction" style={{ marginTop: 10 }} title="Mover a la papelera" onClick={() => trashPage(page.id)} aria-label="Mover base de datos a la papelera">
          <Icon name="trash" size={16} />
        </button>
      </div>

      <div className="dbhead">
        <div className="viewtabs" role="tablist" aria-label="Vistas de la base de datos">
          {VIEWS.map(({ v, label, icon }) => (
            <button key={v} role="tab" aria-selected={db.view === v}
              className={`viewtab${db.view === v ? ' is-active' : ''}`} onClick={() => setView(v)}>
              <Icon name={icon} size={15} /> {label}
            </button>
          ))}
        </div>

        <div className="dbtools">
          <div className={`dbfilter-wrap${db.filter ? ' is-filled' : ''}`}>
            <Icon name="search" size={13} />
            <input
              className="dbfilter"
              placeholder="Buscar en la base…"
              value={db.filter}
              onChange={(e) => mutate((d) => { d.filter = e.target.value; })}
              aria-label="Buscar filas"
            />
            {db.filter && (
              <button className="dbfilter__clear" onClick={() => mutate((d) => { d.filter = ''; })} aria-label="Limpiar búsqueda" title="Limpiar búsqueda">
                <Icon name="x" size={11} />
              </button>
            )}
          </div>
          <span className="dbcount" aria-live="polite">
            {(db.filter.trim() || filters.length > 0) ? `${filteredRows.length} de ${db.rows.length}` : `${db.rows.length} filas`}
          </span>

          <button
            className={`dbtoolbtn${filters.length ? ' is-active' : ''}`}
            onClick={() => { setFilterOpen((v) => !v); setSortOpen(false); }}
            aria-expanded={filterOpen}
          >
            <Icon name="filter" size={13} /> Filtro {filters.length > 0 && <b>{filters.length}</b>}
          </button>
          <button
            className={`dbtoolbtn${sorts.length ? ' is-active' : ''}`}
            onClick={() => { setSortOpen((v) => !v); setFilterOpen(false); }}
            aria-expanded={sortOpen}
          >
            <Icon name="sort" size={13} /> Orden {sorts.length > 0 && <b>{sorts.length}</b>}
          </button>

          {db.view === 'board' && groupCol && (
            <>
              <select
                className="dbselect"
                value={groupCol.id}
                onChange={(e) => mutate((d) => { d.groupByColumnId = e.target.value; })}
                aria-label="Agrupar tablero por columna"
              >
                {db.columns.filter((c) => c.type === 'select').map((c) => (
                  <option key={c.id} value={c.id}>Agrupar: {c.name}</option>
                ))}
              </select>
              <label className="dbcheck">
                <input
                  type="checkbox"
                  checked={!!db.boardHideEmpty}
                  onChange={(e) => mutate((d) => { d.boardHideEmpty = e.target.checked; })}
                />
                Ocultar vacías
              </label>
            </>
          )}

          {db.view === 'calendar' && dateCol && (
            <select
              className="dbselect"
              value={dateCol.id}
              onChange={(e) => mutate((d) => { d.calendarColumnId = e.target.value; })}
              aria-label="Columna de fecha del calendario"
            >
              {db.columns.filter((c) => c.type === 'date').map((c) => (
                <option key={c.id} value={c.id}>Fecha: {c.name}</option>
              ))}
            </select>
          )}

          {db.view === 'gallery' && (
            <>
              <div className="gallerytool">
                <span>Portada</span>
                <select
                  className="dbselect"
                  value={db.cardCoverColumnId === 'none' ? 'none' : db.cardCoverColumnId ?? ''}
                  onChange={(e) => mutate((d) => { d.cardCoverColumnId = e.target.value === '' ? null : e.target.value; })}
                  aria-label="Propiedad de portada de la galería"
                >
                  <option value="">Automática</option>
                  <option value="none">Sin portada</option>
                  {db.columns.filter((c) => c.type === 'select').map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="sizeseg" role="group" aria-label="Tamaño de tarjeta">
                {(['s', 'm', 'l'] as const).map((size) => (
                  <button
                    key={size}
                    className={(db.gallerySize ?? 'm') === size ? 'is-active' : ''}
                    aria-pressed={(db.gallerySize ?? 'm') === size}
                    onClick={() => mutate((d) => { d.gallerySize = size; })}
                  >
                    {size === 's' ? 'S' : size === 'm' ? 'M' : 'L'}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="addprop" ref={addPropRef}>
            <button className="btn-ghost" onClick={() => setAddPropOpen((v) => !v)} aria-expanded={addPropOpen} aria-haspopup="menu">
              + Propiedad
            </button>
            {addPropOpen && (
              <div className="addprop__menu" role="menu">
                {PROPERTY_TYPES.map(({ type, label, icon }) => (
                  <button key={type} role="menuitem" onClick={() => addColumn(type)}>
                    <Icon name={icon} size={15} /> {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {filterOpen && (
            <div className="dbpop filterpop" role="dialog" aria-label="Filtros avanzados">
              <div className="dbpop__head">
                <div>
                  <p className="kicker">Filtros</p>
                  <b>Mostrar filas que cumplan</b>
                </div>
                <button className="rowaction" onClick={() => setFilterOpen(false)} aria-label="Cerrar filtros"><Icon name="x" size={13} /></button>
              </div>
              <div className="filterjoin" role="group" aria-label="Combinar filtros">
                <button className={db.filterJoin !== 'or' ? 'is-active' : ''} onClick={() => mutate((d) => { d.filterJoin = 'and'; })}>Todas (Y)</button>
                <button className={db.filterJoin === 'or' ? 'is-active' : ''} onClick={() => mutate((d) => { d.filterJoin = 'or'; })}>Alguna (O)</button>
              </div>
              {filters.length === 0 && <p className="dbpop__empty">Sin filtros. Añade uno para acotar las filas; la búsqueda rápida sigue activa.</p>}
              {filters.map((f) => {
                const col = db.columns.find((c) => c.id === f.columnId);
                if (!col) return null;
                const ops = opsFor(col);
                return (
                  <div className="filterrow" key={f.id}>
                    <select
                      value={f.columnId}
                      aria-label="Propiedad del filtro"
                      onChange={(e) => {
                        const nextCol = db.columns.find((c) => c.id === e.target.value);
                        if (!nextCol) return;
                        updateFilter(f.id, { columnId: nextCol.id, op: opsFor(nextCol)[0]?.id ?? 'contains', value: '' });
                      }}
                    >
                      {db.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <select value={f.op} aria-label="Condición del filtro" onChange={(e) => updateFilter(f.id, { op: e.target.value as FilterOp })}>
                      {ops.map((op) => <option key={op.id} value={op.id}>{op.label}</option>)}
                    </select>
                    {!isFilterValueHidden(f.op) && (
                      col.type === 'select' || col.type === 'multiselect' ? (
                        <select value={f.value} aria-label="Valor del filtro" onChange={(e) => updateFilter(f.id, { value: e.target.value })}>
                          <option value="">Cualquiera</option>
                          {(col.options ?? []).map((o) => <option key={o.id} value={o.label}>{o.label}</option>)}
                        </select>
                      ) : (
                        <input
                          type={col.type === 'number' ? 'number' : col.type === 'date' || col.type === 'created' || col.type === 'updated' ? 'date' : 'text'}
                          value={f.value}
                          placeholder={col.type === 'checkbox' ? 'sí / no' : 'Valor…'}
                          aria-label="Valor del filtro"
                          onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                        />
                      )
                    )}
                    <button className="rowaction" onClick={() => removeFilter(f.id)} aria-label="Quitar filtro" title="Quitar filtro">
                      <Icon name="x" size={12} />
                    </button>
                  </div>
                );
              })}
              <div className="dbpop__actions">
                <button className="btn-ghost btn-ghost--small" onClick={addFilter}><Icon name="plus" size={12} /> Añadir filtro</button>
                {filters.length > 0 && (
                  <button className="btn-ghost btn-ghost--small" onClick={() => mutate((d) => { d.filters = []; })}>Limpiar todo</button>
                )}
              </div>
            </div>
          )}

          {sortOpen && (
            <div className="dbpop sortpop" role="dialog" aria-label="Reglas de orden">
              <div className="dbpop__head">
                <div>
                  <p className="kicker">Orden</p>
                  <b>Ordenar por varias propiedades</b>
                </div>
                <button className="rowaction" onClick={() => setSortOpen(false)} aria-label="Cerrar orden"><Icon name="x" size={13} /></button>
              </div>
              {sorts.length === 0 && <p className="dbpop__empty">Sin reglas. Las filas se muestran en el orden en que las arrastras.</p>}
              {sorts.map((rule, index) => (
                <div className="sortrow" key={rule.id}>
                  <span className="sortrow__no">{index + 1}</span>
                  <select value={rule.columnId} aria-label="Propiedad de orden" onChange={(e) => updateSort(rule.id, { columnId: e.target.value })}>
                    {db.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button
                    className="sortdir"
                    onClick={() => updateSort(rule.id, { dir: rule.dir === 'asc' ? 'desc' : 'asc' })}
                    aria-label={rule.dir === 'asc' ? 'Cambiar a descendente' : 'Cambiar a ascendente'}
                    title={rule.dir === 'asc' ? 'Ascendente' : 'Descendente'}
                  >
                    <Icon name={rule.dir === 'asc' ? 'chevronUp' : 'chevronDown'} size={12} />
                    {rule.dir === 'asc' ? 'Asc' : 'Desc'}
                  </button>
                  <button className="rowaction" onClick={() => removeSort(rule.id)} aria-label="Quitar orden" title="Quitar orden">
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ))}
              <div className="dbpop__actions">
                <button className="btn-ghost btn-ghost--small" onClick={addSort}><Icon name="plus" size={12} /> Añadir orden</button>
                {sorts.length > 0 && (
                  <button className="btn-ghost btn-ghost--small" onClick={() => mutate((d) => { d.sorts = []; d.sortColumnId = null; d.sortDir = 'asc'; })}>Limpiar</button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* VISTA TABLA */}
      {db.view === 'table' && (
        <div className="dbtable-wrap">
          <table className="dbtable" aria-label="Tabla de la base de datos">
            <thead>
              <tr>
                {db.columns.map((col) => {
                  const sortIndex = sortIndexFor(col.id);
                  return (
                    <th
                      key={col.id}
                      className={colOver === col.id ? 'is-col-over' : ''}
                      onDragOver={(e) => { if (dragCol.current) { e.preventDefault(); setColOver(col.id); } }}
                      onDragLeave={() => setColOver((c) => (c === col.id ? null : c))}
                      onDrop={(e) => {
                        if (!dragCol.current) return;
                        e.preventDefault();
                        const rect = e.currentTarget.getBoundingClientRect();
                        moveColumn(dragCol.current, col.id, e.clientX > rect.left + rect.width / 2);
                        dragCol.current = null;
                        setColOver(null);
                      }}
                    >
                      <div className="th-inner">
                        <button
                          className="thdrag"
                          draggable
                          title="Arrastra para reordenar la propiedad"
                          aria-label={`Mover propiedad ${col.name}`}
                          onDragStart={(e) => {
                            dragCol.current = col.id;
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', `col:${col.id}`);
                          }}
                          onDragEnd={() => { dragCol.current = null; setColOver(null); }}
                        >
                          <Icon name="grip" size={11} />
                        </button>
                        <Icon name={TYPE_ICON[col.type]} size={12} className="thtype" />
                        {renamingCol === col.id ? (
                          <input
                            className="cellinput"
                            autoFocus
                            defaultValue={col.name}
                            onBlur={(e) => { renameColumn(col.id, e.target.value); setRenamingCol(null); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              if (e.key === 'Escape') setRenamingCol(null);
                            }}
                            aria-label="Renombrar columna"
                          />
                        ) : (
                          <button
                            className="thsort"
                            onClick={() => cycleSort(col.id)}
                            title="Ordenar · doble clic para renombrar"
                          >
                            {col.name}
                            {sortIndex >= 0 && (
                              <span className="thsort__badge">
                                <Icon name={sorts[sortIndex].dir === 'asc' ? 'chevronUp' : 'chevronDown'} size={10} />
                                {sorts.length > 1 && <i>{sortIndex + 1}</i>}
                              </span>
                            )}
                          </button>
                        )}
                        <button className="coldel" title="Opciones de la propiedad" aria-label={`Opciones de ${col.name}`} onClick={() => setColMenu(colMenu === col.id ? null : col.id)}>
                          <Icon name="more" size={13} />
                        </button>
                        {colMenu === col.id && (
                          <div className="colmenu-wrap">
                            <div className="colmenu" role="menu" aria-label={`Propiedad ${col.name}`}>
                              <p className="colmenu__label">{PROPERTY_LABEL[col.type]}</p>
                              <button role="menuitem" onClick={() => { setRenamingCol(col.id); setColMenu(null); }}>
                                <Icon name="pen" size={13} /> Renombrar propiedad
                              </button>
                              {(col.type === 'select' || col.type === 'multiselect') && (
                                <button role="menuitem" onClick={() => { setOptionCol(col.id); setColMenu(null); }}>
                                  <Icon name="sliders" size={13} /> Editar opciones
                                </button>
                              )}
                              <button role="menuitem" disabled={db.columns[0]?.id === col.id} onClick={() => { const i = db.columns.findIndex((c) => c.id === col.id); moveColumn(col.id, db.columns[i - 1].id, false); setColMenu(null); }}>
                                <span className="flip"><Icon name="chevronRight" size={12} /></span> Mover a la izquierda
                              </button>
                              <button role="menuitem" disabled={db.columns[db.columns.length - 1]?.id === col.id} onClick={() => { const i = db.columns.findIndex((c) => c.id === col.id); moveColumn(col.id, db.columns[i + 1].id, true); setColMenu(null); }}>
                                <span><Icon name="chevronRight" size={12} /></span> Mover a la derecha
                              </button>
                              <span className="colmenu__sep" />
                              <p className="colmenu__label">Convertir en</p>
                              <div className="colmenu__types">
                                {PROPERTY_TYPES.map(({ type, label, icon }) => (
                                  <button
                                    key={type}
                                    role="menuitemradio"
                                    aria-checked={col.type === type}
                                    className={col.type === type ? 'is-sel' : ''}
                                    disabled={col.type === type}
                                    onClick={() => { convertColumn(col.id, type); setColMenu(null); toast(`«${col.name}» ahora es ${label.toLowerCase()}`); }}
                                  >
                                    <Icon name={icon} size={12} /> {label}
                                  </button>
                                ))}
                              </div>
                              <span className="colmenu__sep" />
                              <button
                                role="menuitem"
                                className="is-danger"
                                disabled={db.columns.length <= 1}
                                onClick={() => { deleteColumn(col.id); setColMenu(null); }}
                              >
                                <Icon name="trash" size={13} /> Eliminar propiedad
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </th>
                  );
                })}
                <th aria-label="Añadir fila" style={{ width: 46 }}>
                  <button className="thadd" onClick={() => addRow()} title="Nueva fila" aria-label="Nueva fila"><Icon name="plus" size={13} /></button>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={db.columns.length + 1} style={{ textAlign: 'center', padding: '26px 12px', color: 'var(--ink-55)' }}>
                    {db.filter || filters.length > 0 ? (
                      <>
                        Ninguna fila coincide con los filtros.
                        <button className="btn-ghost btn-ghost--small" style={{ marginLeft: 8 }} onClick={() => mutate((d) => { d.filter = ''; d.filters = []; })}>Limpiar</button>
                      </>
                    ) : 'Aún no hay filas — añade la primera abajo.'}
                  </td>
                </tr>
              )}
              {filteredRows.map((row) => {
                const isOver = rowOver?.id === row.id;
                return (
                  <tr
                    key={row.id}
                    className={`${isOver ? (rowOver!.after ? 'is-drop-after' : 'is-drop-before') : ''}`}
                    onDragOver={(e) => {
                      if (!dragRow.current) return;
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      setRowOver({ id: row.id, after: e.clientY > rect.top + rect.height / 2 });
                    }}
                    onDragLeave={() => setRowOver((r) => (r?.id === row.id ? null : r))}
                    onDrop={(e) => {
                      if (!dragRow.current) return;
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      moveRow(dragRow.current, row.id, e.clientY > rect.top + rect.height / 2);
                      dragRow.current = null;
                      setRowOver(null);
                    }}
                  >
                    {db.columns.map((col, index) => (
                      <td key={col.id} style={{ position: 'relative' }}>
                        {index === 0 ? (
                          <div className="firstcell">
                            <button
                              className="rowdrag"
                              draggable
                              title="Arrastra para reordenar la fila"
                              aria-label="Reordenar fila"
                              onDragStart={(e) => {
                                dragRow.current = row.id;
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', `row:${row.id}`);
                              }}
                              onDragEnd={() => { dragRow.current = null; setRowOver(null); }}
                            >
                              <Icon name="grip" size={11} />
                            </button>
                            {renderCell(row, col)}
                          </div>
                        ) : renderCell(row, col)}
                      </td>
                    ))}
                    <td>
                      <div className="rowactions">
                        <button className="rowaction" title="Abrir fila" aria-label={`Abrir ${titleOf(row)}`} onClick={() => setRowOpen(row.id)}>
                          <Icon name="arrowRight" size={12} />
                        </button>
                        <button className="rowaction" title="Duplicar fila" aria-label={`Duplicar ${titleOf(row)}`} onClick={() => duplicateRow(row.id)}>
                          <Icon name="copy" size={12} />
                        </button>
                        <button className="rowdel" title="Eliminar fila" aria-label={`Eliminar ${titleOf(row)}`} onClick={() => deleteRow(row.id)}>
                          <Icon name="x" size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="dbfootrow">
                <td className="dbfootrow__label"><Icon name="chart" size={12} /> Cálculo</td>
                {db.columns.map((col) => {
                  const calc = db.calculations?.[col.id] ?? 'none';
                  const value = computeCalc(filteredRows, col, calc);
                  return (
                    <td key={col.id}>
                      <div className="calccell">
                        <select
                          value={calc}
                          onChange={(e) => mutate((d) => {
                            d.calculations = { ...(d.calculations ?? {}), [col.id]: e.target.value as CalcOp };
                          })}
                          aria-label={`Cálculo de ${col.name}`}
                          title={`Cálculo de ${col.name}`}
                        >
                          {calcsFor(col).map((op) => <option key={op} value={op}>{CALC_LABELS[op]}</option>)}
                        </select>
                        {calc !== 'none' && <span className="calccell__value">{value}</span>}
                      </div>
                    </td>
                  );
                })}
                <td />
              </tr>
            </tfoot>
          </table>
          <div className="addrow">
            <button onClick={() => addRow()}><Icon name="plus" size={13} /> Nueva fila</button>
          </div>
        </div>
      )}

      {/* VISTA LISTA */}
      {db.view === 'list' && (
        <div className="dblist">
          <div className="dblist__head">
            <span>{firstCol?.name ?? 'Nombre'}</span>
            <span>Propiedades</span>
            <span>Editada</span>
            <span aria-hidden="true" />
          </div>
          {filteredRows.length === 0 && (
            <p className="dblist__empty">{db.filter || filters.length > 0 ? 'Ninguna fila coincide con los filtros.' : 'Aún no hay filas.'}</p>
          )}
          {filteredRows.map((row, index) => (
            <div
              key={row.id}
              className={`dblist__row${rowOver?.id === row.id ? ' is-over' : ''}`}
              draggable
              onDragStart={(e) => {
                dragRow.current = row.id;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', `row:${row.id}`);
              }}
              onDragEnd={() => { dragRow.current = null; setRowOver(null); }}
              onDragOver={(e) => {
                if (!dragRow.current) return;
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                setRowOver({ id: row.id, after: e.clientY > rect.top + rect.height / 2 });
              }}
              onDrop={(e) => {
                if (!dragRow.current) return;
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                moveRow(dragRow.current, row.id, e.clientY > rect.top + rect.height / 2);
                dragRow.current = null;
                setRowOver(null);
              }}
            >
              <button className="dblist__title" onClick={() => setRowOpen(row.id)}>
                <span className="dblist__no">{String(index + 1).padStart(2, '0')}</span>
                <Icon name="grip" size={11} className="dblist__grip" />
                <span>{titleOf(row) || 'Sin título'}</span>
              </button>
              <div className="dblist__props">
                {db.columns.slice(1, 5).map((col) => {
                  const text = cellText(row, col);
                  if (!text) return null;
                  if (col.type === 'select' || col.type === 'multiselect') {
                    const raw = row.cells[col.id];
                    const ids = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
                    return ids.slice(0, 2).map((idv) => {
                      const opt = col.options?.find((o) => o.id === idv);
                      return opt ? <span key={`${col.id}-${idv}`} className="pill" data-tone={opt.tone}><i />{opt.label}</span> : null;
                    });
                  }
                  if (col.type === 'checkbox') {
                    const raw = row.cells[col.id];
                    return <span key={col.id} className={`dblist__bool${raw ? ' is-on' : ''}`}><Icon name={raw ? 'check' : 'x'} size={10} /> {col.name}</span>;
                  }
                  return <span key={col.id} className="dblist__prop"><b>{col.name}</b> {text}</span>;
                })}
              </div>
              <span className="dblist__date">{formatStamp(row.updated)}</span>
              <div className="rowactions">
                <button className="rowaction" title="Duplicar fila" aria-label="Duplicar fila" onClick={() => duplicateRow(row.id)}><Icon name="copy" size={12} /></button>
                <button className="rowdel" title="Eliminar fila" aria-label="Eliminar fila" onClick={() => deleteRow(row.id)}><Icon name="x" size={13} /></button>
              </div>
            </div>
          ))}
          <button className="dblist__add" onClick={() => addRow()}><Icon name="plus" size={13} /> Nueva fila</button>
        </div>
      )}

      {/* VISTA TABLERO */}
      {db.view === 'board' && groupCol && (
        <div className="board" role="list" aria-label={`Tablero agrupado por ${groupCol.name}`}>
          {groups.map(({ opt, rows }) => (
            <div
              key={opt.id}
              role="listitem"
              className={`bcol${overCol === opt.id ? ' is-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOverCol(opt.id); }}
              onDragLeave={() => setOverCol((c) => (c === opt.id ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                const id = dragRow.current;
                if (id) setCell(id, groupCol.id, opt.id === '__none__' ? null : opt.id);
                dragRow.current = null;
                setOverCol(null);
              }}
            >
              <div className="bcol__head">
                <span className="pill" data-tone={opt.tone}><i />{opt.label}</span>
                <span className="bcol__count">{rows.length}</span>
              </div>
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="bcard"
                  draggable
                  onDragStart={() => { dragRow.current = row.id; }}
                  onDragEnd={() => { dragRow.current = null; setOverCol(null); }}
                >
                  <button className="bcard__main" onClick={() => setRowOpen(row.id)} aria-label={`Abrir ${titleOf(row)}`}>
                    <span className="bcard__name">{titleOf(row)}</span>
                    <span className="bcard__meta">
                      {db.columns.filter((c) => c.type === 'select' && c.id !== groupCol.id).slice(0, 1).map((c) => {
                        const o = c.options?.find((x) => x.id === row.cells[c.id]);
                        return o ? <span key={c.id} className="pill" data-tone={o.tone}><i />{o.label}</span> : null;
                      })}
                      {dateCol && row.cells[dateCol.id] && (
                        <span className="bcard__date">{formatStamp(Date.parse(String(row.cells[dateCol.id])) || undefined)}</span>
                      )}
                    </span>
                  </button>
                  <div className="bcard__actions">
                    <button className="rowaction" title="Abrir fila" onClick={() => setRowOpen(row.id)} aria-label="Abrir fila"><Icon name="arrowRight" size={12} /></button>
                    <button className="rowaction" title="Duplicar fila" onClick={() => duplicateRow(row.id)} aria-label="Duplicar fila"><Icon name="copy" size={12} /></button>
                    <button className="rowdel" title="Eliminar fila" onClick={() => deleteRow(row.id)} aria-label="Eliminar fila"><Icon name="x" size={12} /></button>
                  </div>
                </div>
              ))}
              <button className="bcol__add" onClick={() => addRow(opt.id === '__none__' ? {} : { [groupCol.id]: opt.id })}>
                <Icon name="plus" size={12} /> Añadir
              </button>
            </div>
          ))}
          {groups.length === 0 && <p className="dbempty">Todas las columnas están vacías. Desactiva «Ocultar vacías» o añade una fila.</p>}
        </div>
      )}
      {db.view === 'board' && !groupCol && (
        <p className="dbempty">Añade una propiedad de Selección para agrupar este tablero en columnas.</p>
      )}

      {/* VISTA CALENDARIO */}
      {db.view === 'calendar' && (
        <CalendarView
          db={{ ...db, rows: filteredRows }}
          dateCol={dateCol}
          monthOffset={monthOffset}
          setMonthOffset={setMonthOffset}
          onAdd={(iso) => addRow(dateCol ? { [dateCol.id]: iso } : {})}
        />
      )}

      {/* VISTA GRÁFICO */}
      {db.view === 'chart' && <ChartView db={{ ...db, rows: filteredRows }} mutate={mutate} />}

      {/* VISTA GALERÍA */}
      {db.view === 'gallery' && (
        <GalleryView
          db={{ ...db, rows: filteredRows }}
          firstColId={firstColId}
          onAdd={() => addRow()}
          onDelete={deleteRow}
          onOpen={setRowOpen}
          onDuplicate={duplicateRow}
          setCell={setCell}
        />
      )}

      <p className="dbfoot">
        {filteredRows.length} de {db.rows.length} {db.rows.length === 1 ? 'fila' : 'filas'}
        {activeFilterCount > 0 ? ` · ${activeFilterCount} ${activeFilterCount === 1 ? 'filtro activo' : 'filtros activos'}` : ''}
        {sorts.length > 0 ? ` · ${sorts.length} ${sorts.length === 1 ? 'orden' : 'órdenes'}` : ''}
        {' '}· guardado localmente
      </p>

      {dropNotice && (
        <div className="dropnotice" role="status" aria-live="polite">
          <Icon name="subpage" size={14} /> {dropNotice}
        </div>
      )}

      {optionCol && managerCol && (
        <div className="modal-backdrop" onMouseDown={() => setOptionCol(null)} role="dialog" aria-modal="true" aria-label={`Opciones de ${managerCol.name}`}>
          <div className="modal optionmodal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal__head">
              <div>
                <p className="kicker">Propiedad de selección</p>
                <h2>Opciones de «{managerCol.name}».</h2>
              </div>
              <button className="rowaction" onClick={() => setOptionCol(null)} aria-label="Cerrar"><Icon name="x" size={16} /></button>
            </div>
            <p className="modal__lede">Cambia el nombre, el color o elimina una opción. Las filas que la usaban quedan vacías.</p>
            <div className="optionlist">
              {(managerCol.options ?? []).map((opt) => {
                const usage = db.rows.filter((r) => {
                  const v = r.cells[managerCol.id];
                  return Array.isArray(v) ? v.includes(opt.id) : v === opt.id;
                }).length;
                return (
                  <div className="optionrow" key={opt.id}>
                    <button className="optionrow__dot" data-tone={opt.tone} onClick={() => recolorOption(managerCol.id, opt.id)} title="Cambiar color" aria-label={`Cambiar color de ${opt.label}`} />
                    <input
                      defaultValue={opt.label}
                      aria-label={`Nombre de ${opt.label}`}
                      onBlur={(e) => renameOption(managerCol.id, opt.id, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    />
                    <span className="optionrow__usage">{usage} {usage === 1 ? 'fila' : 'filas'}</span>
                    <button className="rowaction" title="Eliminar opción" aria-label={`Eliminar ${opt.label}`} onClick={() => deleteOption(managerCol.id, opt.id)}>
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="optionadd">
              <Icon name="plus" size={13} />
              <input
                value={newOption}
                placeholder="Nueva opción…"
                aria-label="Nueva opción"
                onChange={(e) => setNewOption(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addSelectOption(managerCol.id, newOption); }}
              />
              <button className="btn btn--primary btn--small" onClick={() => addSelectOption(managerCol.id, newOption)}>Añadir</button>
            </div>
          </div>
        </div>
      )}

      {openRow && (
        <>
          <div className="panel-backdrop" onMouseDown={() => setRowOpen(null)} />
          <aside className="rowpanel" role="dialog" aria-modal="true" aria-label={`Fila ${titleOf(openRow)}`}>
            <div className="rowpanel__head">
              <div>
                <p className="kicker">Detalle de fila</p>
                <h2>{titleOf(openRow) || 'Sin título'}</h2>
              </div>
              <button className="rowaction" onClick={() => setRowOpen(null)} aria-label="Cerrar detalle"><Icon name="x" size={17} /></button>
            </div>
            <div className="rowpanel__fields">
              {db.columns.map((col) => (
                <div className="rowpanel__field" key={col.id}>
                  <span className="rowpanel__label">
                    <Icon name={TYPE_ICON[col.type]} size={12} /> {col.name}
                  </span>
                  <RowField col={col} row={openRow} setCell={setCell} onManageOptions={() => setOptionCol(col.id)} />
                </div>
              ))}
            </div>
            <p className="rowpanel__meta">
              Creada el {formatStamp(openRow.created) || '—'} · editada el {formatStamp(openRow.updated) || '—'}
            </p>
            <div className="rowpanel__actions">
              <button className="btn btn--primary btn--small" onClick={() => setRowOpen(null)}>Listo</button>
              <button className="btn-ghost btn-ghost--small" onClick={() => duplicateRow(openRow.id)}><Icon name="copy" size={12} /> Duplicar</button>
              <button className="btn-ghost btn-ghost--small is-danger" onClick={() => { deleteRow(openRow.id); setRowOpen(null); }}><Icon name="trash" size={12} /> Eliminar</button>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

function RowField({
  col,
  row,
  setCell,
  onManageOptions,
}: {
  col: DBColumn;
  row: DBRow;
  setCell: (rowId: string, colId: string, value: DBRow['cells'][string]) => void;
  onManageOptions: () => void;
}) {
  const value = row.cells[col.id];
  if (col.type === 'select') {
    return (
      <div className="rowfield-inline">
        <select value={String(value ?? '')} onChange={(e) => setCell(row.id, col.id, e.target.value || null)} aria-label={col.name}>
          <option value="">Sin valor</option>
          {(col.options ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <button className="rowaction" onClick={onManageOptions} title="Gestionar opciones" aria-label="Gestionar opciones"><Icon name="sliders" size={12} /></button>
      </div>
    );
  }
  if (col.type === 'multiselect') {
    const values = Array.isArray(value) ? value : [];
    return (
      <div className="rowfield-multi">
        <div className="rowfield-chips">
          {(col.options ?? []).map((o) => {
            const on = values.includes(o.id);
            return (
              <button
                key={o.id}
                className={`pill${on ? '' : ' is-off'}`}
                data-tone={o.tone}
                aria-pressed={on}
                onClick={() => setCell(row.id, col.id, on ? values.filter((v) => v !== o.id) : [...values, o.id])}
              >
                <i />{o.label}
              </button>
            );
          })}
          {(col.options ?? []).length === 0 && <span className="rowpanel__empty">Sin opciones todavía.</span>}
        </div>
        <button className="rowaction" onClick={onManageOptions} title="Gestionar opciones" aria-label="Gestionar opciones"><Icon name="sliders" size={12} /></button>
      </div>
    );
  }
  if (col.type === 'checkbox') {
    return (
      <button
        className={`switchrow${value ? ' is-on' : ''}`}
        role="checkbox"
        aria-checked={!!value}
        aria-label={col.name}
        onClick={() => setCell(row.id, col.id, !value)}
      >
        <span className="switchrow__track"><i /></span>
        {value ? 'Hecho' : 'Pendiente'}
      </button>
    );
  }
  if (col.type === 'date') {
    return <input className="cellinput" type="date" value={String(value ?? '')} onChange={(e) => setCell(row.id, col.id, e.target.value)} aria-label={col.name} />;
  }
  if (col.type === 'created' || col.type === 'updated') {
    return <span className="cellstamp">{formatStamp(col.type === 'created' ? row.created : row.updated) || '—'}</span>;
  }
  const inputType = col.type === 'number' ? 'number' : col.type === 'url' ? 'url' : col.type === 'email' ? 'email' : col.type === 'phone' ? 'tel' : 'text';
  return (
    <input
      className="cellinput"
      type={inputType}
      value={String(value ?? '')}
      onChange={(e) => setCell(row.id, col.id, col.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
      aria-label={col.name}
      placeholder={col.type === 'url' ? 'https://…' : col.type === 'email' ? 'nombre@dominio.com' : col.type === 'phone' ? '+34 600 000 000' : 'Vacío'}
    />
  );
}
