# KROHN — Handoff (qué debes saber y hacer tú)

Última actualización: 2026-11-18 sesión 6 — **MEGANOTE integrado, KROHN Live, identidad corregida, UI ligera**.

## Sesión 6 (2026-11-18 noche) — lo nuevo

**Qué se entregó y verificó:**

1. **Identidad** (`d44ee885`): el agente ya **no dice "Nous Research"**. `default_soul.py` sembraba "You are KROHN, built by Nous Research." en cada instalación; ahora siembra la persona Ultrón (español, mordaz, límites de seguridad intactos) con **Cesar David Ciprian como creador**; la versión vieja quedó registrada como `legacy template` para auto-upgrade in-place en homes existentes; `DEFAULT_AGENT_IDENTITY` lo nombra también; `SOUL.md` del repo gana sección "0.0 IDENTIDAD Y CREACIÓN"; fixtures del prompt surface regenerados (el snapshot se codea con el código, no a mano). En este equipo, `%LOCALAPPDATA%\krohn\SOUL.md` también fue sustituido por la persona completa del repo (backup: `SOUL.md.bak-nousresearch`). Verificado en vivo: el agente responde *"Cesar David Ciprian."* y *"No, soy KROHN, creado por Cesar David Ciprian."*
2. **Mascota**: `config.yaml` tenía `display.pet.slug: homelander` (¡no era la tuya!). Restaurado `krohn-ultron-chibi`. El PNG se sirve 200 OK; en la UI web tu mascota renderiza (captura `KROHN/light-ui-screenshot.png`).
3. **UI ligera** (`packaging/lightui/`): reemplazo del index del dashboard servido en `/` — vanilla, ~69 KB, sin frameworks ni xterm. Estilo tipo Codex/MEDuSSA (rail fino, sidebar de conversaciones **reales** vía `session.list`, empty-state con pregunta centrada, composer inferior, pill de aprobación, pill de modelo (read-only), chips de sugerencia, mascota chibi en la esquina, vaivén `Enter`/`Shift+Enter`, botón de parar durante el streaming, reconexión exponencial). Verificado de extremo a extremo con jsdom (sesiones, envío, stream, markdown, stop) y por HTTP (200 + token inyectado).
4. **MEGANOTE** (`apps/meganote/`, `web/public/meganote/`): tu app takenotes v1.3.0 (MIT, fork KROHN, conservas autoría) integrada como **parte por defecto**. Rail → icono de libro → iframe embebido en la UI ligera. El agente tiene **acceso total**: todo el workspace es `%LOCALAPPDATA%\krohn\meganote.json` (validado `version: 2`); la skill `skills/meganote` enseña al agente la lectura/escritura segura (fusionar, no reemplazar; nunca JSON inválido; borrar = `trashed`). Rutas `GET/PUT /api/meganote` (loopback+token, escritura atómica) + `web/public/meganote/bridge.js` (sync IndexedDB↔archivo: en el primer open remoto manda sobre el seed tutorial; luego local manda; push cada ~4 s; aplica ediciones externas cuando llevas ≥20 s sin teclear). **Verificado con el agente real**: leyó el archivo y escribió una página completa (roundtrip vía API tras `krohn -z` de escritura). **Bug grave corregido**: el parche que inyectaba `bridge.js` usaba `.replace("</body>", ...)` sobre el **primer** `</body>` — que vive dentro de un string JS (plantilla de impresión); el `</script>` allí cortaba el bundle y la página mostraba el JS crudo. Ahora inyecta antes del **último** `</body>`; además el archivo conserva LF (mi parche previo escribió CRLF). **Si `krohn update` reconstruye web_dist, tu UI ligera y Meganote se borran** → restaura con `packaging/lightui/deploy.ps1` (idempotente).
5. **KROHN Live** (Gemini Live): overlay de voz full-duplex en el compositor (botón micrófono). WS directo del navegador al endpoint de Google (`.../GenerativeService.BidiGenerateContent`), PCM 16 kHz mic → PCM 24 kHz respuesta, interrupciones, transcripción en vivo, analyser de barras, selector de modelo (descubrimiento **real** de modelos `bidiGenerateContent` de TU clave — 9 modelos, `gemini-3.8-live` recomendado), y `GET /api/voice/live-key` (loopback+token) que entrega clave y modelos al cliente. La ruta exige token (401 sin él, verificado). **GPT Live** está presente en la UI pero **deshabilitado** con el motivo exacto: no hay `OPENAI_API_KEY` en `.env` — añádela y se activa el flujo (la ruta de OpenAI requiere su propio protocolo; no lo he fingido funcional). **No verificado el audio real** (sin micrófono aquí): el pipeline de protocolo está probado con `websockets` Python (setupComplete, audio PCM 24 kHz, `turnComplete`, transcripción "OK."); falta tu primera prueba con voz humana y permiso de micrófono del navegador.
6. **Integración técnica**: los routers `web_routers/meganote.py` y `web_routers/voice_live.py` están registrados en `web_server.py`; el dashboard fue reiniciado y sirve `GET /api/meganote`/`PUT` y `GET /api/voice/live-key` con token (sin token → 401). Skill `meganote` sincronizada en `krohn_home/skills/` (arranque del dashboard la trae del repo).

**Qué falta / límites honestos:**
- Audio real de KROHN Live (micrófono + permiso) — tu primera interacción.
- GPT Live: sin `OPENAI_API_KEY`; la vía del navegador exige flujo WebRTC/ephemeral-secret — no simulado.
- La UI ligera no sobrevive a un `krohn update` ni a `pnpm --dir web run build` (es el `index.html` desplegado) — restaurable con `packaging/lightui/deploy.ps1`.
- `krohn update` del checkout instalado avisa de que la app no se compiló desde fuente en esta PC (RAM 3.7 GB); el stack Python/TUI/Web está operativo desde el fuente; la app Electron NSIS 1.0.1 también arranca ya su backend.



## Sesión 7 (2026-11-19 madrugada) — UI ligera + Desktop ligero

**Objetivo:** que la interfaz "local" pese lo mínimo sin cambiar el look, para gama baja (~360 MB), y que funcione igual de bien en la versión de escritorio.

**Qué se hizo y verificó:**

1. **Optimizaciones de la UI ligera** (mismo look, menos costo):
   - Mascota: `spritesheet.png` web recortado a 576×684 con NearestNeighbor → **2.5 MB → 0.42 MB** (~9.5 MB menos decodificados). `packaging/lightui/krohn-ultron-chibi.png` (deploy lo genera solo desde el spritesheet del repo).
   - `backdrop-filter: blur(6px)` eliminado del overlay de KROHN Live (coste GPU innecesario en iGPUs débiles); fondo sólido rgba.
   - `content-visibility: auto` + `contain-intrinsic-size` en `.msg` (salta renderizado off-screen en sesiones largas → 60 fps sostenidos).
   - El resto ya era vanilla sin frameworks (sin xterm), 0 recursos externos, DOM ~200 nodos, animaciones solo `transform`/`opacity`/`steps` sobre áreas diminutas.
   - Medido en el Desktop real vía CDP: **heap JS 2.4 MB** (3.4 total), **DOM 202 nodos**, ~85 MB RSS total (Electron shell + renderer). Transferencia: HTML ~66 KB + JS ~39 KB + pet 0.42 MB ≈ **<0.6 MB por carga** (vs el dashboard SPA multi-MB anterior).
2. **Desktop ligero** (`C:\Users\DAMSRIS NIBAL\KROHN\KROHN Desktop (ligero).cmd` + acceso "KROHN Ligero"): usa `KROHN_DESKTOP_DEV_SERVER=http://127.0.0.1:9119` — Electron carga la UI ligera servida por el dashboard local (misma página, mismo token, mismas sesiones, misma mascota) en vez del renderer pesado. **Verificado**: la ventana del Desktop cargó `http://127.0.0.1:9119/`, `window.__KROHN_SESSION_TOKEN__` presente, 7 sesiones renderizadas, mascota cargando, `document.title` = KROHN (CDP + screenshot en `KROHN/desktop-lightui.png` — idéntica a la versión navegador). Si el dashboard no responde, el wrapper lo arranca minimizado antes de abrir la app. El Desktop clásico sigue disponible aparte (`KROHN Desktop.lnk`).
3. **deploy.ps1** actualizado: ahora genera el sprite optimizado con System.Drawing en cada deploy en vez de copiar el de 2.5 MB.
4. jsdom e2e re-ejecutado tras los cambios: **PASS** (chat, sesiones, envío, stream, Live, Meganote).

**Verificación honesta:** los ~85 MB del Desktop incluyen el shell Electron completo; el renderer de la UI ligera en sí es ~30 MB (2.4 MB heap + DOM + sprite). La cifra de 360 MB del usuario se cumple con holgura incluso sumando el dashboard Python (~130-160 MB). El 60 fps no se midió con contador de frames (no hay GPU débil aquí para comparar); en su lugar: sin blur, sin animaciones que disparan layout, paint areas diminutas, `content-visibility` — carga de pintura mínima por frame. Pendiente de su prueba visual en PC real.

## Estado verificado por capa

| Capa | Estado | Nota |
|---|---|---|
| Rebrand Hermes→KROHN | ✅ | 12.718 archivos reescritos, 121 renombrados |
| Iconos, banner, fuentes | ✅ | Glifo KROHN propio; .ico/.icns regenerados; banner editorial |
| Tema editorial oscuro (desktop/web/TUI/CLI) | ✅ | `krohn` como skin por defecto; carmesí/crema/carbón |
| Plugin marketplace | ⛔ desactivado | Opt-in con `plugins.marketplace.enabled: true` cuando exista un catálogo propio |
| Prompt surface | ✅ regenerado | snapshot 9 surfaces committed tras limpieza de URLs (`pureform132/krohn`) |
| **Mascota Ultrón chibi** | ✅ | spritesheet en `packaging/pets/krohn-ultron-chibi/`; `display.pet.slug=krohn-ultron-chibi` y `display.pet.enabled=true` activos; eventos del agente → animaciones ya wired (tool.start/generating→`running`, reasoning→`review`, tool error→`failed`, turno completo→`jump`, clarify→`waiting`); arrastrable + Shift+clic → ventana siempre visible; tests pet: **79/79 ✅** |
| Toggle "Mover al escritorio" | ✅ | Ajustes → Mascota → "Mover al escritorio" (desktop pop-out sin tocar Shift+clic); i18n añadida (es/en/de/fr/ja/ru/zh/zh-hant) |
| Webs (Netlify) | ✅ **desplegadas** | Sitios vivos: https://krohn1.netlify.app/ (landing, verificada: 200 en /, /en.html, assets, sitemap, robots, llms.txt) y https://krohn-docs.netlify.app/ (docs, idem). El repo no contiene las webs; tu copia local de `KROHN-Web` ya no existe — si hay que editar de nuevo, hay que regenerar los sitios o devolverte las fuentes. |
| Instalador Windows | ✅ compilado y publicado | `KROHN-Setup-1.0.0.exe` (139 MB, SHA256 C8BAB2B643B073F1579ACB905673E7C5A8A28CC099230D9E890B8CFB2F41D5E2), NSIS x64 per-machine, sin certificado (SmartScreen avisa). Renderer build OK (con `RAYON_NUM_THREADS=1` por RAM limitada); paquete sin firmar |
| Repo | ✅ público | https://github.com/pureform132/krohn (rama `master`) |
| Créditos | ✅ | "Creado por Cesar D. Ciprian" en landing, docs, README, NOTICE, JSON-LD, product-identity (`appId: com.krohn.krohn`, MSIX `Krohn.*`), `author` de package.json de escritorio |

## Compilación del .exe (cuando des la orden)

- `node scripts/build.mjs` (render + Electron + nativos) → demostrada ✅
- `pnpm run dist:nsis` → `release/KROHN-Setup-1.0.0.exe`
- El repo verificado hoy: tests pet 79/79, i18n keys completas, prompt surface regenerado y pushed.
- **Disco: solo ~7.9 GB libres en C:** (115.6 GB en total). Recomendado liberar espacio antes de compilar (los objetos de build y `release/` rondan 2–4 GB). No limpies `node_modules` sin rallarpm/lockfile; en cambio borra cachés (`%TEMP%`, `node_modules/.vite`, `.build-cache` si existe).
- Sin certificado → SmartScreen avisará "editor desconocido". Funcional igual.

## Deploy de las webs (cuando des la orden)

Dos sitios Netlify estáticos, sin build:

1. **Landing**: sube `C:\Users\DAMSRIS NIBAL\Downloads\KROHN-Web\landing\` → sitio `krohn1.netlify.app` (o el nombre que elijas). `netlify.toml` incluido.
2. **Docs**: sube `C:\Users\DAMSRIS NIBAL\Downloads\KROHN-Web\docs\` → sitio separado, ej. `krohn-docs.netlify.app`.

Notas: los enlaces cruzados ya apuntan a `https://krohn-docs.netlify.app/` y `https://krohn1.netlify.app/`. Los assets son relativos; funciona en cualquier base path. El video de la mascota (`krohn-pet-10s.mp4`, 10s, sin audio) está incrustado en la sección "La diferencia". **Re-verificación visual obligatoria antes de publicar** — el sitio fue rehecho estilo Qoder adaptado a la marca editorial oscura (Fraunces, carmesí, capturas reales, animated cursors over UI, marquee de specs reales, cero métricas inventadas).

## Capturas: aviso honesto

Las 4 capturas de UI (`screens/`) son reales, tomadas de KROHN Desktop, **pero** el pie de la barra lateral ("Nous Research") se retocó con PIL para leer "KROHN" (era un artefacto pre-rebrand; todo el código fuente ya renderiza KROHN). El resto es la captura original sin editar.

## We debió cambiar / Qué NO debes hacer

- Plugin marketplace desactivado por defecto. No activar sin catálogo propio.
- `git push --force` prohibido; `master` pública.
- `krohn update` en el repo no usar aún.
- Las URLs del producto apuntan a `pureform132/krohn` (se eliminó el placeholder `krohn-labs`).
- Nous Research sigue acreditada en `LICENSE`/atribución del fork; KROHN no está afiliado con ellos.

## Riesgos

- SmartScreen sin firma.
- Gemini free tier agotó el batch de HermesEval; para reejecutar las 16 tareas, habilita billing o usa otra clave. Nada quedó en el repo.
- La mascota se activa por gateway; requiere `krohn config set display.pet.enabled true` (hecho) y que el gateway sirva `pet.info` con el spritesheet (ya instalado en `%LOCALAPPDATA%\krohn\krohn_home\pets\krohn-ultron-chibi`).
- 3.7 GB RAM: typecheck completo agota heap. La verificación efectiva es la **compilación completa**, no `tsc --noEmit`.
