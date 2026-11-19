import { useEffect } from 'react';
import { useWorkspace } from '../state/WorkspaceContext';
import { Icon } from '../lib/icons';

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Navegación',
    rows: [
      ['Ctrl K', 'Buscar páginas o ejecutar comandos'],
      ['Ctrl Shift F', 'Modo concentración'],
      ['Alt ← / Alt →', 'Atrás / adelante'],
      ['Esc', 'Cerrar cualquier capa'],
      ['?', 'Esta lista de atajos'],
    ],
  },
  {
    title: 'Escribir',
    rows: [
      ['/', 'Insertar un bloque'],
      ['@', 'Mencionar una página'],
      ['Enter', 'Nuevo bloque'],
      ['Tab / Shift Tab', 'Sangrar / desangrar'],
      ['Ctrl B / I / U', 'Negrita, itálica, subrayado'],
      ['Ctrl Shift X', 'Tachado'],
      ['Ctrl K', 'Enlace en la selección'],
      ['Ctrl Z / Ctrl Shift Z', 'Deshacer / rehacer'],
      ['Ctrl F', 'Buscar dentro de la página'],
    ],
  },
  {
    title: 'Markdown al vuelo',
    rows: [
      ['# + espacio', 'Encabezado 1'],
      ['## + espacio', 'Encabezado 2'],
      ['- + espacio', 'Lista de viñetas'],
      ['1. + espacio', 'Lista numerada'],
      ['[] + espacio', 'To-do'],
      ['> + espacio', 'Cita'],
      ['``` + espacio', 'Bloque de código'],
      ['--- + Enter', 'Divisor'],
    ],
  },
  {
    title: 'Páginas y datos',
    rows: [
      ['Ctrl Shift L', 'Bloquear o desbloquear la página'],
      ['Ctrl P', 'Imprimir o guardar como PDF'],
      ['Ctrl Shift E', 'Exportar HTML'],
      ['Ctrl Shift M', 'Exportar Markdown'],
    ],
  },
];

export function ShortcutsHelp() {
  const { shortcutsOpen, setShortcutsOpen } = useWorkspace();
  useEffect(() => {
    if (!shortcutsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShortcutsOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shortcutsOpen, setShortcutsOpen]);
  if (!shortcutsOpen) return null;
  return (
    <div className="modal-backdrop" onMouseDown={() => setShortcutsOpen(false)} role="dialog" aria-modal="true" aria-label="Atajos de teclado">
      <div className="modal shortcuts" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <div>
            <p className="kicker">Dedos, no ratón</p>
            <h2>Todo lo que puedes hacer sin soltar el teclado.</h2>
          </div>
          <button className="rowaction" onClick={() => setShortcutsOpen(false)} aria-label="Cerrar atajos">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="shortcutgrid">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <dl>
                {g.rows.map(([keys, label]) => (
                  <div key={keys + label} className="shortcutrow">
                    <dt>
                      {keys.split(' ').map((k, i) => (
                        <kbd key={`${k}-${i}`}>{k}</kbd>
                      ))}
                    </dt>
                    <dd>{label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className="modal__hint">Los atajos no se disparan mientras escribes dentro de un campo de texto, salvo los de formato y navegación.</p>
      </div>
    </div>
  );
}
