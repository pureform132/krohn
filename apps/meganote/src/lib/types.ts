/* Takenotes data model — independent implementation. */

export type BlockType =
  | 'text'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h1toggle'
  | 'h2toggle'
  | 'h3toggle'
  | 'bulleted'
  | 'numbered'
  | 'todo'
  | 'toggle'
  | 'quote'
  | 'code'
  | 'callout'
  | 'divider'
  | 'image'
  | 'file'
  | 'subpage'
  | 'pageLink'
  | 'toc'
  | 'table'
  | 'columns'
  | 'bookmark'
  | 'embed'
  | 'video'
  | 'audio'
  | 'equation'
  | 'database';

export type BlockTone =
  | 'default'
  | 'ink'
  | 'terra'
  | 'sage'
  | 'ink-soft'
  | 'terra-soft'
  | 'sage-soft';

export interface TableData {
  rows: string[][];
  header: boolean;
}

export interface ColumnData {
  id: string;
  html: string;
  text: string;
}

export interface Block {
  id: string;
  type: BlockType;
  /** Plain-text content of the block. Inline formatting is kept as HTML in `html`. */
  text: string;
  /** Sanitized HTML for inline formatting (bold/italic/code/strike/link/color). */
  html: string;
  /** todo blocks only */
  checked?: boolean;
  /** toggle blocks only */
  open?: boolean;
  /** indent depth 0–4 for lists, toggles, quotes, todos */
  level: number;
  /** code blocks: language label */
  lang?: string;
  /** image blocks */
  src?: string;
  alt?: string;
  /** file blocks */
  fileName?: string;
  fileSize?: number;
  fileMime?: string;
  /** subpage, pageLink and database blocks: target page id */
  pageId?: string;
  /** text / background tone for the whole block */
  color?: BlockTone;
  bg?: BlockTone;
  /** horizontal alignment for text-bearing blocks */
  align?: 'left' | 'center' | 'right';
  /** bookmark / embed / video / audio */
  url?: string;
  title?: string;
  description?: string;
  embedType?: 'youtube' | 'vimeo' | 'spotify' | 'generic';
  /** table blocks */
  table?: TableData;
  /** columns blocks (2–3 editable columns) */
  columns?: ColumnData[];
  /** equation blocks: LaTeX-ish source */
  equation?: string;
  /** callout blocks */
  calloutIcon?: string;
  calloutTone?: 'ink' | 'terra' | 'sage';
}

export type PropertyType =
  | 'text'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone'
  | 'created'
  | 'updated';

export interface DBColumn {
  id: string;
  name: string;
  type: PropertyType;
  /** select / multiselect columns only */
  options?: { id: string; label: string; tone: 'sage' | 'terra' | 'ink' }[];
}

export interface DBRow {
  id: string;
  cells: Record<string, string | number | boolean | string[] | null>;
  created?: number;
  updated?: number;
}

export type DBView = 'table' | 'board' | 'list' | 'calendar' | 'chart' | 'gallery';

/** Chart types observed in Notion's icon set: chartLine, chartDonut, chartArea, chartAlternate. */
export type ChartKind = 'bar' | 'horizontal' | 'line' | 'donut';

export type FilterOp =
  | 'contains' | 'notContains' | 'is' | 'isNot' | 'isEmpty' | 'isNotEmpty'
  | 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte'
  | 'before' | 'after' | 'on'
  | 'checked' | 'unchecked'
  | 'has' | 'hasNot';

export interface DBFilter {
  id: string;
  columnId: string;
  op: FilterOp;
  value: string;
}

export interface DBSort {
  id: string;
  columnId: string;
  dir: 'asc' | 'desc';
}

export type CalcOp = 'none' | 'count' | 'sum' | 'avg' | 'min' | 'max' | 'empty' | 'filled' | 'percent';

export interface DBState {
  columns: DBColumn[];
  rows: DBRow[];
  view: DBView;
  filter: string;
  sortColumnId: string | null;
  sortDir: 'asc' | 'desc';
  /** board grouping column */
  groupByColumnId: string | null;
  /** calendar date column */
  calendarColumnId: string | null;
  /** chart preferences (optional: old databases fall back to bars by status) */
  chartKind?: ChartKind;
  chartColumnId?: string | null;
  chartMetricColumnId?: string | null;
  chartMetricOp?: 'sum' | 'avg';
  /** advanced filter builder; the quick text search stays in `filter` */
  filters?: DBFilter[];
  filterJoin?: 'and' | 'or';
  /** multiple sort rules; legacy sortColumnId/sortDir mirror the first rule */
  sorts?: DBSort[];
  /** table footer calculations by column id */
  calculations?: Record<string, CalcOp>;
  listColumnIds?: string[];
  cardCoverColumnId?: string | null;
  gallerySize?: 's' | 'm' | 'l';
  boardHideEmpty?: boolean;
}

export type PageKind = 'page' | 'database';

export interface PageVersion {
  id: string;
  at: number;
  title: string;
  icon: string;
  cover?: string;
  blocks: Block[];
  db?: DBState;
  words: number;
  label?: string;
}

export interface Page {
  id: string;
  parentId: string | null;
  title: string;
  /** id into the authored icon set, or empty for default doc icon */
  icon: string;
  /** cover preset id (a CSS gradient from the four-color palette) */
  cover?: string;
  kind: PageKind;
  favorite: boolean;
  trashed: boolean;
  blocks: Block[];
  db?: DBState;
  created: number;
  updated: number;
  /** Notion-style page preferences */
  locked?: boolean;
  fullWidth?: boolean;
  font?: 'sans' | 'serif' | 'mono';
  smallText?: boolean;
  coverHeight?: 's' | 'm' | 'l';
  /** local version history (newest first) */
  history?: PageVersion[];
}

export interface Workspace {
  version: 1;
  pages: Page[];
}

/** v2: multiple notebooks sharing one store. */
export interface Notebook {
  id: string;
  name: string;
  icon: string;
  created: number;
  pages: Page[];
}

export interface AppStore {
  version: 2;
  notebooks: Notebook[];
  currentId: string;
}

export function newId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + Math.floor(Math.random() * 1e6).toString(36)
  );
}

export function now(): number {
  return Date.now();
}

export function emptyBlock(type: BlockType = 'text'): Block {
  return { id: newId(), type, text: '', html: '', level: 0 };
}

export function emptyPage(parentId: string | null, kind: PageKind = 'page'): Page {
  const t = now();
  return {
    id: newId(),
    parentId,
    title: '',
    icon: kind === 'database' ? 'table' : 'doc',
    kind,
    favorite: false,
    trashed: false,
    blocks: kind === 'page' ? [emptyBlock('text')] : [],
    db: kind === 'database' ? defaultDBState() : undefined,
    created: t,
    updated: t,
  };
}

function opt(id: string, label: string, tone: 'sage' | 'terra' | 'ink') {
  return { id, label, tone };
}

export function defaultDBState(): DBState {
  return {
    columns: [
      { id: 'c-name', name: 'Nombre', type: 'text' },
      {
        id: 'c-status',
        name: 'Estado',
        type: 'select',
        options: [opt('o-idea', 'Idea', 'ink'), opt('o-doing', 'En progreso', 'terra'), opt('o-done', 'Hecho', 'sage')],
      },
      {
        id: 'c-priority',
        name: 'Prioridad',
        type: 'select',
        options: [opt('o-low', 'Baja', 'sage'), opt('o-med', 'Media', 'ink'), opt('o-high', 'Alta', 'terra')],
      },
      { id: 'c-due', name: 'Entrega', type: 'date' },
      { id: 'c-done', name: 'Hecho', type: 'checkbox' },
    ],
    rows: [],
    view: 'table',
    filter: '',
    sortColumnId: null,
    sortDir: 'asc',
    groupByColumnId: 'c-status',
    calendarColumnId: 'c-due',
    filters: [],
    filterJoin: 'and',
    sorts: [],
    calculations: {},
    listColumnIds: [],
    cardCoverColumnId: null,
    gallerySize: 'm',
    boardHideEmpty: false,
    chartKind: 'bar',
    chartColumnId: 'c-status',
    chartMetricColumnId: null,
    chartMetricOp: 'sum',
  };
}
