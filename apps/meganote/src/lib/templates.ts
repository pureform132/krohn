/* Authored page templates — our own wording and structure. */
import { emptyBlock, newId, now, type Block, type DBState, type Page } from './types';

export interface PageTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  kind: 'page' | 'database';
  build: () => Pick<Page, 'title' | 'icon' | 'kind' | 'blocks' | 'db' | 'cover'>;
}

function b(type: Block['type'], html: string, extra: Partial<Block> = {}): Block {
  return { id: newId(), type, text: html.replace(/<[^>]+>/g, ''), html, level: 0, ...extra };
}

function daysFromNow(n: number): string {
  const d = new Date(Date.now() + n * 86400000);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const PAGE_TEMPLATES: PageTemplate[] = [
  {
    id: 'meeting',
    name: 'Notas de reunión',
    description: 'Asistentes, agenda, decisiones y próximos pasos.',
    icon: 'briefcase',
    kind: 'page',
    build: () => ({
      title: 'Reunión — ' + new Date().toLocaleDateString('es', { day: 'numeric', month: 'long' }),
      icon: 'briefcase',
      kind: 'page',
      blocks: [
        b('callout', '<b>Fecha</b> · hoy · <b>Duración</b> · 30 min · <b>Lugar</b> · por confirmar'),
        b('h2', 'Asistentes'),
        b('bulleted', ''),
        b('h2', 'Agenda'),
        b('numbered', ''),
        b('h2', 'Decisiones'),
        b('bulleted', ''),
        b('h2', 'Próximos pasos'),
        b('todo', ''),
      ],
    }),
  },
  {
    id: 'weekly',
    name: 'Plan semanal',
    description: 'Una página para lunes a domingo, con prioridades y revisiones.',
    icon: 'compass',
    kind: 'page',
    build: () => ({
      title: 'Plan de la semana',
      icon: 'compass',
      kind: 'page',
      blocks: [
        b('callout', 'Tres prioridades, no treinta. Elige lo que hará que la semana cuente.'),
        b('h2', 'Las tres de esta semana'),
        b('todo', ''), b('todo', ''), b('todo', ''),
        b('h2', 'Lunes'),
        b('bulleted', ''),
        b('h2', 'Martes'),
        b('bulleted', ''),
        b('h2', 'Miércoles'),
        b('bulleted', ''),
        b('h2', 'Jueves'),
        b('bulleted', ''),
        b('h2', 'Viernes'),
        b('bulleted', ''),
        b('h2', 'Revisión del viernes'),
        b('toggle', '¿Qué funcionó?'),
        b('toggle', '¿Qué sobra la próxima semana?'),
      ],
    }),
  },
  {
    id: 'project',
    name: 'Proyecto',
    description: 'Objetivo, alcance, hitos y un tablero de tareas.',
    icon: 'target',
    kind: 'page',
    build: () => ({
      title: 'Nuevo proyecto',
      icon: 'target',
      kind: 'page',
      blocks: [
        b('callout', '<b>Objetivo</b> — una frase que quepa en una tarjeta.'),
        b('h2', 'Alcance'),
        b('text', 'Lo que entra y, sobre todo, lo que no.'),
        b('h2', 'Hitos'),
        b('todo', 'Definir el resultado visible'),
        b('todo', 'Primera versión utilizable'),
        b('todo', 'Revisión con ojos frescos'),
        b('h2', 'Tareas'),
      ],
    }),
  },
  {
    id: 'recipe',
    name: 'Receta',
    description: 'Ingredientes, pasos y notas de cocina.',
    icon: 'pizza',
    kind: 'page',
    build: () => ({
      title: 'Receta sin título',
      icon: 'pizza',
      kind: 'page',
      blocks: [
        b('callout', 'Para 2 personas · 25 min · dificultad baja'),
        b('h2', 'Ingredientes'),
        b('bulleted', ''), b('bulleted', ''), b('bulleted', ''),
        b('h2', 'Pasos'),
        b('numbered', ''), b('numbered', ''), b('numbered', ''),
        b('h2', 'Notas'),
        b('quote', 'Lo que cambiarías la próxima vez.'),
      ],
    }),
  },
  {
    id: 'habits',
    name: 'Hábitos',
    description: 'Un registro simple de treinta días.',
    icon: 'sprout',
    kind: 'page',
    build: () => ({
      title: 'Hábitos del mes',
      icon: 'sprout',
      kind: 'page',
      blocks: [
        b('callout', 'Marca el hábito, no el resultado. La constancia hace el resto.'),
        b('h2', 'Hábitos'),
        b('todo', 'Caminar 20 minutos'),
        b('todo', 'Leer 10 páginas'),
        b('todo', 'Escribir una página'),
        b('h2', 'Registro'),
        b('table', '', {
          table: {
            header: true,
            rows: [
              ['Día', 'Caminar', 'Leer', 'Escribir'],
              ['1', '', '', ''], ['2', '', '', ''], ['3', '', '', ''],
              ['4', '', '', ''], ['5', '', '', ''], ['6', '', '', ''], ['7', '', '', ''],
            ],
          },
        }),
      ],
    }),
  },
  {
    id: 'reading',
    name: 'Biblioteca',
    description: 'Libros, estado y citas favoritas.',
    icon: 'book',
    kind: 'database',
    build: () => {
      const db: DBState = {
        columns: [
          { id: 'c-title', name: 'Libro', type: 'text' },
          { id: 'c-author', name: 'Autor', type: 'text' },
          {
            id: 'c-state', name: 'Estado', type: 'select',
            options: [
              { id: 'o-next', label: 'Por leer', tone: 'ink' },
              { id: 'o-reading', label: 'Leyendo', tone: 'terra' },
              { id: 'o-done', label: 'Terminado', tone: 'sage' },
            ],
          },
          { id: 'c-stars', name: 'Estrellas', type: 'number' },
          { id: 'c-date', name: 'Terminado el', type: 'date' },
        ],
        rows: [],
        view: 'table',
        filter: '',
        sortColumnId: null,
        sortDir: 'asc',
        groupByColumnId: 'c-state',
        calendarColumnId: 'c-date',
        filters: [],
        filterJoin: 'and',
        sorts: [],
        calculations: { 'c-stars': 'avg' },
        listColumnIds: [],
        cardCoverColumnId: null,
        gallerySize: 'm',
        boardHideEmpty: false,
        chartKind: 'bar',
        chartColumnId: 'c-state',
        chartMetricColumnId: null,
        chartMetricOp: 'sum',
      };
      return { title: 'Biblioteca', icon: 'book', kind: 'database', blocks: [], db };
    },
  },
  {
    id: 'content',
    name: 'Calendario editorial',
    description: 'Un tablero para ideas, borradores y publicaciones.',
    icon: 'table',
    kind: 'database',
    build: () => {
      const db: DBState = {
        columns: [
          { id: 'c-title', name: 'Pieza', type: 'text' },
          {
            id: 'c-state', name: 'Estado', type: 'select',
            options: [
              { id: 'o-idea', label: 'Idea', tone: 'ink' },
              { id: 'o-draft', label: 'Borrador', tone: 'terra' },
              { id: 'o-edit', label: 'Edición', tone: 'ink' },
              { id: 'o-done', label: 'Publicado', tone: 'sage' },
            ],
          },
          { id: 'c-date', name: 'Publicar', type: 'date' },
          { id: 'c-words', name: 'Palabras', type: 'number' },
          { id: 'c-link', name: 'Enlace', type: 'url' },
        ],
        rows: [],
        view: 'board',
        filter: '',
        sortColumnId: null,
        sortDir: 'asc',
        groupByColumnId: 'c-state',
        calendarColumnId: 'c-date',
        filters: [],
        filterJoin: 'and',
        sorts: [],
        calculations: { 'c-words': 'sum' },
        listColumnIds: [],
        cardCoverColumnId: null,
        gallerySize: 'm',
        boardHideEmpty: false,
        chartKind: 'bar',
        chartColumnId: 'c-state',
        chartMetricColumnId: 'c-words',
        chartMetricOp: 'sum',
      };
      return { title: 'Calendario editorial', icon: 'table', kind: 'database', blocks: [], db };
    },
  },
  {
    id: 'trip',
    name: 'Viaje',
    description: 'Itinerario, equipo y reservas.',
    icon: 'plane',
    kind: 'page',
    build: () => ({
      title: 'Viaje a…',
      icon: 'plane',
      cover: 'dawn',
      kind: 'page',
      blocks: [
        b('callout', `<b>Salida</b> · ${daysFromNow(30)} · <b>Vuelta</b> · ${daysFromNow(37)}`),
        b('h2', 'Itinerario'),
        b('table', '', {
          table: {
            header: true,
            rows: [
              ['Día', 'Mañana', 'Tarde', 'Noche'],
              ['1', '', '', ''], ['2', '', '', ''], ['3', '', '', ''],
            ],
          },
        }),
        b('h2', 'Reservas'),
        b('todo', 'Transporte'),
        b('todo', 'Alojamiento'),
        b('todo', 'Entradas'),
        b('h2', 'Equipo'),
        b('bulleted', ''), b('bulleted', ''),
      ],
    }),
  },
];

export function pageFromTemplate(t: PageTemplate): Page {
  const built = t.build();
  const stamp = now();
  return {
    id: newId(),
    parentId: null,
    title: built.title,
    icon: built.icon,
    cover: built.cover,
    kind: built.kind,
    favorite: false,
    trashed: false,
    blocks: built.kind === 'page' && built.blocks.length === 0 ? [emptyBlock('text')] : built.blocks,
    db: built.db,
    created: stamp,
    updated: stamp,
  };
}
