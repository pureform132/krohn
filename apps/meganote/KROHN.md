# MEGANOTE en KROHN

**Meganote** es el fork de KROHN de [takenotes](https://github.com/pureform132/takenotes) v1.3.0 (MIT, por Cesar David Ciprian) — app local-first, en español, inspirada en Notion: bloques, bases de datos, kanban, búsqueda, importación.

En KROHN es **parte por defecto del sistema**:

- La UI embebida vive en `web/public/meganote/` (el `dist` de single-file ya compilado + `bridge.js`) y se sirve en `/meganote/`. La pestaña **Notas** de la interfaz ligera (icono de libro en el rail) la embebe en un iframe del mismo origen.
- El agente tiene **acceso total** al workspace: todo —cuadernos, páginas, bloques— es un único documento `meganote.json` en el KROHN home. La skill `skills/meganote/SKILL.md` documenta el formato y el flujo seguro de lectura/escritura.
- `krohn_cli/web_routers/meganote.py` expone `GET/PUT /api/meganote` (loopback + token) para el puente de sincronización; el agente no los necesita — usa sus herramientas de archivo.

## Qué cambió respecto a takenotes

- `src/` y demás fuentes copiados tal cual (sin `node_modules`, sin `dist`, sin `docs`).
- Se añadió `web/public/meganote/bridge.js` (sync IndexedDB ↔ `meganote.json`: hidrata en arranque, publica cambios cada ~4s, aplica cambios externos cuando estás inactivo ~20s, reload controlado).
- `web/public/meganote/index.html` = build de producción de Vite (single-file) **+ el `<script src="/meganote/bridge.js">` inyectado antes de `</body>`**.

## Reconstruir / regenerar el bundle

```bash
cd apps/meganote
npm install        # una vez
npm run build      # tsc -b && vite build  (single-file en dist/)
```
Luego copiar el nuevo `dist/index.html` a `web/public/meganote/index.html`, re-inyectar la etiqueta bridge (ver `packaging/lightui/deploy.ps1` / `apps/meganote/KROHN.md#sync-bridge`) y copiar `web/public/meganote/*` a `krohn_cli/web_dist/meganote/`.

## Licencia

MIT — ver `LICENSE`. Autor original: **Cesar David Ciprian**. KROHN es el fork oficial de distribución del producto.
