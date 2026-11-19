import { useEffect } from 'react';
import { useWorkspace } from '../state/WorkspaceContext';
import { Icon, type IconName } from '../lib/icons';
import { PAGE_TEMPLATES } from '../lib/templates';

export function TemplateGallery() {
  const { templatesOpen, setTemplatesOpen, createPageFromTemplate } = useWorkspace();
  useEffect(() => {
    if (!templatesOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTemplatesOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [templatesOpen, setTemplatesOpen]);
  if (!templatesOpen) return null;

  return (
    <div className="modal-backdrop" onMouseDown={() => setTemplatesOpen(false)} role="dialog" aria-modal="true" aria-label="Plantillas de página">
      <div className="modal templategallery" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <div>
            <p className="kicker">Empezar con ventaja</p>
            <h2>Plantillas de Takenotes.</h2>
          </div>
          <button className="rowaction" onClick={() => setTemplatesOpen(false)} aria-label="Cerrar plantillas">
            <Icon name="x" size={16} />
          </button>
        </div>
        <p className="modal__lede">
          Estructuras escritas a mano con el vocabulario del cuaderno. Elige una y tendrás una página
          real que puedes editar, mover o borrar como cualquier otra.
        </p>
        <div className="templategrid">
          {PAGE_TEMPLATES.map((t) => (
            <button
              key={t.id}
              className="templatecard"
              onClick={() => createPageFromTemplate(t.id)}
              aria-label={`Crear página con plantilla ${t.name}`}
            >
              <span className="templatecard__ic"><Icon name={t.icon as IconName} size={22} /></span>
              <span className="templatecard__body">
                <span className="templatecard__name">{t.name}</span>
                <span className="templatecard__desc">{t.description}</span>
                <span className="templatecard__kind">{t.kind === 'database' ? 'Base de datos' : 'Página'}</span>
              </span>
              <Icon name="arrowRight" size={14} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
