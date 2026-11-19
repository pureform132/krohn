/* Database evaluation helpers shared by every view. */
import type { CalcOp, DBColumn, DBFilter, DBRow, DBState, DBSort, FilterOp } from './types';

export function optionLabel(col: DBColumn, value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((v) => col.options?.find((o) => o.id === v)?.label ?? String(v)).filter(Boolean).join(', ');
  }
  return col.options?.find((o) => o.id === value)?.label ?? String(value ?? '');
}

export function cellText(row: DBRow, col: DBColumn | undefined): string {
  if (!col) return '';
  const v = row.cells[col.id];
  if (v == null || v === '') return '';
  if (col.type === 'select') return col.options?.find((o) => o.id === v)?.label ?? String(v);
  if (col.type === 'multiselect') return optionLabel(col, v);
  if (col.type === 'checkbox') return v ? 'sí' : 'no';
  if (col.type === 'created') return formatStamp(row.created);
  if (col.type === 'updated') return formatStamp(row.updated);
  return String(v);
}

export function formatStamp(ms: number | undefined): string {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export const FILTER_OPS: Record<string, { id: FilterOp; label: string }[]> = {
  text: [
    { id: 'contains', label: 'contiene' },
    { id: 'notContains', label: 'no contiene' },
    { id: 'is', label: 'es exactamente' },
    { id: 'isNot', label: 'no es' },
    { id: 'isEmpty', label: 'está vacío' },
    { id: 'isNotEmpty', label: 'no está vacío' },
  ],
  number: [
    { id: 'eq', label: '=' },
    { id: 'neq', label: '≠' },
    { id: 'gt', label: '>' },
    { id: 'lt', label: '<' },
    { id: 'gte', label: '≥' },
    { id: 'lte', label: '≤' },
    { id: 'isEmpty', label: 'está vacío' },
    { id: 'isNotEmpty', label: 'no está vacío' },
  ],
  select: [
    { id: 'is', label: 'es' },
    { id: 'isNot', label: 'no es' },
    { id: 'isEmpty', label: 'está vacío' },
    { id: 'isNotEmpty', label: 'no está vacío' },
  ],
  multiselect: [
    { id: 'has', label: 'contiene' },
    { id: 'hasNot', label: 'no contiene' },
    { id: 'isEmpty', label: 'está vacío' },
    { id: 'isNotEmpty', label: 'no está vacío' },
  ],
  date: [
    { id: 'on', label: 'es el día' },
    { id: 'before', label: 'es antes de' },
    { id: 'after', label: 'es después de' },
    { id: 'isEmpty', label: 'está vacío' },
    { id: 'isNotEmpty', label: 'no está vacío' },
  ],
  checkbox: [
    { id: 'checked', label: 'está marcado' },
    { id: 'unchecked', label: 'está desmarcado' },
  ],
};

export function opsFor(col: DBColumn): { id: FilterOp; label: string }[] {
  if (col.type === 'select' || col.type === 'created' || col.type === 'updated') {
    return col.type === 'select' ? FILTER_OPS.select : FILTER_OPS.date;
  }
  return FILTER_OPS[col.type] ?? FILTER_OPS.text;
}

export function isFilterValueHidden(op: FilterOp): boolean {
  return ['isEmpty', 'isNotEmpty', 'checked', 'unchecked'].includes(op);
}

function asNumber(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  const n = Number(String(raw ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

function timestampOf(row: DBRow, col: DBColumn): number | null {
  if (col.type === 'created') return row.created ?? null;
  if (col.type === 'updated') return row.updated ?? null;
  const raw = row.cells[col.id];
  if (typeof raw !== 'string' || !raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function matchesOne(row: DBRow, col: DBColumn, filter: DBFilter): boolean {
  const raw = row.cells[col.id];
  const text = cellText(row, col).toLowerCase();
  const target = filter.value.toLowerCase();
  if (filter.op === 'isEmpty') return Array.isArray(raw) ? raw.length === 0 : raw == null || raw === '' || raw === false;
  if (filter.op === 'isNotEmpty') return Array.isArray(raw) ? raw.length > 0 : raw != null && raw !== '' && raw !== false;
  if (filter.op === 'checked') return !!raw;
  if (filter.op === 'unchecked') return !raw;
  if (col.type === 'checkbox') return filter.op === 'is' ? String(raw) === target : !!raw;
  if (col.type === 'number') {
    const a = asNumber(raw);
    const b = asNumber(filter.value);
    if (Number.isNaN(a) || Number.isNaN(b)) return filter.op === 'isNot' || filter.op === 'neq';
    switch (filter.op) {
      case 'eq': return a === b;
      case 'neq': return a !== b;
      case 'gt': return a > b;
      case 'lt': return a < b;
      case 'gte': return a >= b;
      case 'lte': return a <= b;
      default: return true;
    }
  }
  if (col.type === 'date' || col.type === 'created' || col.type === 'updated') {
    const a = timestampOf(row, col);
    const b = Date.parse(filter.value);
    if (a == null) return false;
    if (!Number.isFinite(b)) return true;
    const ad = new Date(a); ad.setHours(0, 0, 0, 0);
    const bd = new Date(b); bd.setHours(0, 0, 0, 0);
    switch (filter.op) {
      case 'on': return ad.getTime() === bd.getTime();
      case 'before': return ad.getTime() < bd.getTime();
      case 'after': return ad.getTime() > bd.getTime();
      default: return true;
    }
  }
  if (col.type === 'multiselect') {
    const values = Array.isArray(raw) ? raw.map(String) : [];
    const has = values.some((v) => {
      const label = col.options?.find((o) => o.id === v)?.label.toLowerCase() ?? v.toLowerCase();
      return v === filter.value || label === target;
    });
    return filter.op === 'hasNot' ? !has : has;
  }
  switch (filter.op) {
    case 'contains': return text.includes(target);
    case 'notContains': return !text.includes(target);
    case 'is': return text === target;
    case 'isNot': return text !== target;
    default: return true;
  }
}

export function rowMatchesFilters(
  row: DBRow,
  columns: DBColumn[],
  filters: DBFilter[] | undefined,
  join: 'and' | 'or' = 'and',
  quick = '',
): boolean {
  const q = quick.trim().toLowerCase();
  if (q && !columns.some((c) => cellText(row, c).toLowerCase().includes(q))) return false;
  const active = (filters ?? []).filter((f) => columns.some((c) => c.id === f.columnId));
  if (active.length === 0) return true;
  const results = active.map((f) => {
    const col = columns.find((c) => c.id === f.columnId)!;
    return matchesOne(row, col, f);
  });
  return join === 'or' ? results.some(Boolean) : results.every(Boolean);
}

function sortValue(row: DBRow, col: DBColumn | undefined): string | number {
  if (!col) return '';
  const raw = row.cells[col.id];
  if (col.type === 'number') {
    const n = asNumber(raw);
    return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
  }
  if (col.type === 'checkbox') return raw ? 1 : 0;
  if (col.type === 'date' || col.type === 'created' || col.type === 'updated') return timestampOf(row, col) ?? 0;
  if (col.type === 'select') return col.options?.find((o) => o.id === raw)?.label.toLowerCase() ?? '';
  return cellText(row, col).toLowerCase();
}

export function effectiveSorts(db: DBState): DBSort[] {
  if (db.sorts && db.sorts.length > 0) return db.sorts.filter((s) => db.columns.some((c) => c.id === s.columnId));
  if (db.sortColumnId) return [{ id: 'legacy', columnId: db.sortColumnId, dir: db.sortDir }];
  return [];
}

export function sortRows(rows: DBRow[], columns: DBColumn[], sorts: DBSort[]): DBRow[] {
  if (sorts.length === 0) return rows;
  const out = [...rows];
  out.sort((a, b) => {
    for (const rule of sorts) {
      const col = columns.find((c) => c.id === rule.columnId);
      if (!col) continue;
      const av = sortValue(a, col);
      const bv = sortValue(b, col);
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), 'es');
      if (cmp !== 0) return rule.dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
  return out;
}

export function filterAndSort(db: DBState): DBRow[] {
  const filters = db.filters ?? [];
  const rows = db.rows.filter((r) => rowMatchesFilters(r, db.columns, filters, db.filterJoin ?? 'and', db.filter));
  return sortRows(rows, db.columns, effectiveSorts(db));
}

export function calcValues(rows: DBRow[], col: DBColumn): number[] {
  return rows
    .map((r) => {
      if (col.type === 'number') return asNumber(r.cells[col.id]);
      if (col.type === 'checkbox') return r.cells[col.id] ? 1 : 0;
      return NaN;
    })
    .filter((n) => Number.isFinite(n));
}

export function computeCalc(rows: DBRow[], col: DBColumn, op: CalcOp): string {
  if (op === 'none') return '';
  const filled = rows.filter((r) => {
    const v = r.cells[col.id];
    return Array.isArray(v) ? v.length > 0 : v != null && v !== '';
  }).length;
  if (op === 'count') return String(rows.length);
  if (op === 'filled') return String(filled);
  if (op === 'empty') return String(rows.length - filled);
  if (op === 'percent') return rows.length ? `${Math.round((filled / rows.length) * 100)}%` : '0%';
  const nums = calcValues(rows, col);
  if (nums.length === 0) return '—';
  if (op === 'sum') return formatNumber(nums.reduce((a, b) => a + b, 0));
  if (op === 'avg') return formatNumber(nums.reduce((a, b) => a + b, 0) / nums.length);
  if (op === 'min') return formatNumber(Math.min(...nums));
  if (op === 'max') return formatNumber(Math.max(...nums));
  return '';
}

export const CALC_LABELS: Record<CalcOp, string> = {
  none: 'Ninguno',
  count: 'Recuento',
  sum: 'Suma',
  avg: 'Media',
  min: 'Mínimo',
  max: 'Máximo',
  empty: 'Vacías',
  filled: 'Rellenas',
  percent: '% rellenas',
};

export function calcsFor(col: DBColumn): CalcOp[] {
  if (col.type === 'number') return ['none', 'count', 'sum', 'avg', 'min', 'max', 'empty', 'filled', 'percent'];
  return ['none', 'count', 'empty', 'filled', 'percent'];
}
