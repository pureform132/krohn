# KROHN — Handoff (qué debes saber y hacer tú)

Última actualización: 2026-11-19 sesión 12 — **el Chat es una conversación normal, no una terminal**.

## Sesión 12 (2026-11-19) — Chat normal sobre el gateway

**1. `/chat` deja de ser la TUI embebida.** `krohn-shell.js` oculta el host de xterm (`.krohn-chat-xterm-host`) y monta `#krohn-chat` sobre el mismo gateway JSON-RPC: `session.create` → `session.activate` → `prompt.submit`, y los eventos llegan por la conexión WS (el transporte debe estar **activado**; `session.events.since` queda como respaldo y deduplica por `seq`). Al entrar se crea una conversación nueva al instante; el selector carga las 40 recientes con `session.resume` (90 s) y las titula con `session.title`.

**2. Lo que se ve:** burbujas de usuario y de KROHN; markdown (párrafos, listas, código en bloque y en línea, negritas); panel **Pensamiento** plegable alimentado por `reasoning.delta`; tarjetas de herramientas con estado (punto gris/verde/rojo), comando o contexto, duración (`duration_s`) y resumen traducido ("Buscó N veces", "Extrajo N páginas"), con argumentos y resultado desplegables; tarjetas de **aprobación** y de **aclaración** con botones; plan/todos; puntos de escritura al final. El rail derecho se oculta en esta ruta y el scroll solo se pega al fondo si estabas abajo.

**3. Enviar nunca se pierde.** Si la conversación aún se está preparando, el mensaje se encola (`queuedSend`) y sale solo al quedar lista; la creación tiene 45 s de margen y no se duplica (guard `chatCreating`). El aviso de estado muestra "Preparando…" / "Pensando…" / "Respondiendo…" / "Ejecutando …".

**4. Avisos del backend (server→client requests).** Al recibir `gateway.ready` se anuncia `client.capabilities {server_requests: true}`. Las peticiones `srq-*` de `approval` y `clarify` se responden con el **frame JSON-RPC del mismo id** (no con `approval.respond`); `request.cancel` retira la tarjeta. Sudo/secret/vault se declinan con aviso de usar la TUI, y si el chat no está visible se responde `4404` para que el agente no espere el plazo de 300 s. **Verificado contra el backend real** con Python/websockets: clarify → `{answers:{q0:"azul"}}` → `message.complete` ("Azul. Anotado.").

**5. Paletas dentro del chat.** `@` inserta la skill en el composer del chat; `/` ejecuta `slash.exec` y publica la salida como aviso; los botones Skills/Cmd siguen abriendo la paleta.

**6. El SPA detrás del panel no estorba.** El ChatPage stock sigue montado (xterm oculto); cuando su PTY muere pinta un aviso inglés a pantalla completa y un botón de copiar ligado a la terminal invisible. `hideStockChatChrome` oculta esos nodos (nunca el marco de la página) en cada pasada del montaje.

**Verificado:** protocolo completo (create/activate/submit, `message.start`/`reasoning.delta`/`message.delta`/`message.complete`, clarify respondido) y **en Edge headless**: tarjeta de aclaración respondida (turno cerrado sin errores) y turno real con herramienta (`terminal` · `echo KROHN_OK` · `16.0s` · salida en el detalle, punto verde de "done", Pensamiento plegado al terminar, cero errores de consola). Capturas `chat6.png` / `chat7.png` en `%TEMP%\opencode\pwtools`. El mapeo de payloads está contrastado con `tui_gateway/tool_progress.py`; el orden de `tool.start`/`tool.complete` frente al texto final se comprobó con un cliente WS crudo (`rpc_order.py`).

**Mantenimiento:** si el chat sale negro, cerrar pestañas extra, matar los `node.exe` de `playwright`/`ui-tui` y recargar. El backend es `%LOCALAPPDATA%\krohn\bin\krohn.exe dashboard --skip-build --no-open`; los assets servidos son las copias de `%LOCALAPPDATA%\krohn\krohn\krohn_cli\web_dist\` (editar `web/public` no basta: hay que copiar).


## Sesión 11 (2026-11-19) — Live que funciona, chibi que habla, escritorio que abre

**1. KROHN Live rediseñado (Gemini Live).** La ventana dejó de ser un panel con formulario y ahora es una sola sala negra: orbe azul centrado (respira y reacciona al nivel de voz), botón de micrófono y botón X abajo, ajustes discretos arriba a la derecha. Dentro de ajustes: **voz** (16 voces prebuilt de Gemini: Puck, Kore, Charon, Fenrir, Aoede…) y **modelo** (solo modelos Live/Native Audio). La voz se guarda en `localStorage` (`krohn.live.voice`) y viaja en el frame `setup` como `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`; cambiarla con la sesión abierta la reinicia.

**Verificado contra la API real de Gemini** (sin micrófono físico): handshake `setupComplete` y audio PCM 24 kHz con `gemini-3.8-live`, `gemini-3.1-flash-live-preview` y los tres `2.5-flash-native-audio`; voces Puck/Kore/Charon/Aoede/Fenrir/Leda aceptadas y con respuesta de audio. En el navegador (Edge con micrófono falso): `start → mic → audio → socket → setup-sent → ready`, estado “Escuchando…”, mute funcional. **Falta tu prueba con micrófono real**, que es lo único que no se puede simular aquí.

**2. Chibi conectada a los stats.** La mascota conserva el spritesheet (9 filas × 8 columnas) y ahora muestra una **nube de pensamiento pixel-art** encima con el estado en español:

| Estado | Texto | Animación |
|---|---|---|
| razonando | `pensando` | fila 8 (idea/lightbulb) |
| herramienta / turno | `trabajando` | fila 7 (tecleando) |
| error | `error` | fila 5 (wobble) |
| clarify / aprobación | `esperando` | fila 6 (sentado, cargando) |
| respuesta en streaming | `respondiendo` | fila 3 |
| fin de turno | `terminado` | fila 0 (de pie, normal) |

La nube es blanca con contorno negro, esquinas escalonadas, puffs y tres puntos de pensamiento; en error se vuelve `#E0503E`. Se alimenta de los eventos reales del gateway (`message.start`, `thinking.delta`, `tool.start`, `message.delta/complete`, `error`, `clarify.request`), no de datos falsos.

**3. Pet instalada donde el gateway la busca.** El `pet.info` devolvía `homelander` porque el motor resuelve `display.pet.slug` en `%LOCALAPPDATA%\krohn\pets\` (no en `krohn_home\pets\`). Se copió `krohn-chibi` a la ruta correcta y ahora `pet.info` devuelve `slug: krohn-chibi`, `displayName: KROHN Chibi`, 6 frames por estado.

**4. “KROHN Desktop” con backend automático.** La app Electron 1.0.1 instalada abre en gris/“Backend offline” y su bootstrap de tickets falla en este equipo (`Gateway ticket bootstrap failed`, bucle de relanzamiento). En vez de reconstruirla (no cabe en 3.7 GB), se entrega un lanzador que usa el mismo shell nativo de Windows:

- `packaging/desktop/krohn-desktop.ps1` — comprueba `http://127.0.0.1:9119/api/health`; si no responde, lanza `krohn dashboard --skip-build --no-open` oculto y espera; después abre la interfaz como ventana de app de Edge (`--app=…`, sin barra de direcciones, perfil propio en `%LOCALAPPDATA%\krohn\desktop-shell`).
- `packaging/desktop/krohn-desktop.vbs` — arranque silencioso (sin consola).
- `packaging/desktop/install-desktop-shortcut.ps1` — instala ambos en `%LOCALAPPDATA%\krohn`, copia el icono y crea **`KROHN Desktop.lnk` en el escritorio**.

Verificado: con el backend apagado, el acceso directo lo levanta (200 OK) y abre la ventana en `http://127.0.0.1:9119/`. El escritorio real de este equipo es la carpeta de OneDrive (`…\OneDrive\Escritorio`), y ahí quedó el acceso.

**Límites honestos:** la app Electron nativa sigue instalada pero no se usa; reconstruirla desde fuente sigue sin ser viable por RAM. El micrófono real de tu equipo es la prueba pendiente de Live. El detector de Impeccable sobre `krohn-shell.{css,js}` no reporta hallazgos.

## Sesión 10 (2026-11-19) — la interfaz definitiva es la de Hermes, con marca KROHN

**Decisión:** se abandona la "KROHN Editorial" como interfaz y se sirve el **SPA stock** (el mismo que instala Hermes/KROHN: Chat, Sesiones, Archivos, Modelos, Registros, Cron, Habilidades, Complementos, MCP, Canales, Webhooks, Emparejamiento, Perfiles, Configuración, Claves, Sistema, Documentación, Kanban, Logros). La marca y las funciones propias viven en una **capa inyectada**, sin recompilar el SPA:

- `web_dist/index.html` carga, en este orden, `krohn-boot.js`, `krohn-shell.css` y `krohn-shell.js` (fuente en `web/public/`).
- `krohn-boot.js`: defaults de idioma ES/tema (solo si el usuario no eligió), API `window.KROHN_SHELL` y un wrapper de WebSocket que captura `/api/pty` para inyectar texto en la TUI real.
- `krohn-shell.css`: paleta **solo** con los colores de `02-negro-absoluto.html` (`#050505`, `#0D0D0F`, `#131316`, `#191920`, `#1C1C21`, `#26262D`, `#F2F2F5`, `#8E8E93`, `#5B5B62`, `#E0503E`, `#30D158`) aplicada con `!important` sobre las variables en línea del SPA.
- `krohn-shell.js`: botones **Live / Notas / Skills / Cmd** en el rail, paleta `@` de skills (40) y `/` de comandos (113 vía RPC `complete.slash`), mascota animada, traducción de etiquetas del menú de temas y corrección de los huecos en inglés del menú lateral.

**Lo verificado en esta sesión (Edge real vía playwright-core, sin errores de consola):**

1. **Gemini Live arranca de verdad.** El atasco era de diagnóstico, no de red: la clave existe (`/api/voice/live-key`, 9 modelos, recomendado `models/gemini-3.8-live`), `getUserMedia` responde con el micrófono falso, y el handshake completa `start → mic → audio → socket → open → setup-sent → ready` (estado "Escuchando…", botón "Terminar"). Se añadió `LIVE.stage` + `liveState()` para diagnosticar, se blindó la carga de modelos (cacheada, no bloquea el botón) y un watchdog de 18 s. **Falta la prueba con voz humana real** (este equipo no tiene micrófono físico; el micrófono falso de Edge se usa solo para verificar el protocolo).
2. **Meganote** abre en `/meganote/index.html` dentro de un iframe, con la paleta oscura inyectada (`--paper:#0D0D0F`), interfaz en español y el crédito de Cesar D. Ciprian; el puente `bridge.js` hidrata desde `meganote.json` y publica cada ~4 s. El iframe se descarga al cerrar para no gastar RAM.
3. **Mascota KROHN** (`krohn-chibi`): spritesheet 576×684, 9 filas × 8 columnas, animación por filas (idle/think/coding/failed/waiting/speaking…), burbuja de estado y posición flotante sobre la esquina vacía del chat (no tapa la lista de sesiones ni el botón de copiar).
4. **Banner de la TUI**: el arte ASCII decía **HERMES AGENT**; ahora dice **KROHN** (mismo estilo ANSI Shadow, 43 columnas) en `ui-tui/src/banner.ts` y en el `dist/entry.js` desplegado. La conducta de la TUI no cambia.
5. **Etiquetas de tema en español**: "KROHN — Negro absoluto…", "KROHN (Grande) — KROHN con tipografía más grande…", incluido el menú portal que abre fuera del sidebar.
6. **Sin nombres heredados**: se renombraron carpeta de mascota, scripts (`build-krohn-pet.py`, `install-krohn-pet.py`), sprites y textos en `README.md`, `NOTICE.md`, `HANDOFF.md`, `KROHN-INFORME.html`, `packaging/lightui/*`, `.gitignore`, `pet.json` y `config.yaml` (`display.pet.slug: krohn-chibi`). El barrido final sobre el repo no encuentra el nombre anterior.

**Límites honestos / mantenimiento:**
- Este equipo tiene **3.7 GB de RAM**: con varias pestañas/visitas de prueba quedan procesos `ui-tui` vivos (~140 MB c/u) y el buffer del PTY puede llegar a `MemoryError` (visto en `logs/errors.log`), lo que deja el panel de chat en negro. Con una sola pestaña abierta va bien. Si el chat sale negro: cerrar pestañas, matar los `node.exe` de `ui-tui\dist` y recargar.
- GPT Live sigue deshabilitado sin `OPENAI_API_KEY`.
- La app Electron se lanza con `KROHN_DESKTOP_DEV_SERVER=http://127.0.0.1:9119` (compilar desde fuente agota la RAM).


## Sesión 6 (2026-11-18 noche) — lo nuevo

**Qué se entregó y verificó:**

1. **Identidad** (`d44ee885`): el agente ya **no dice "Nous Research"**. `default_soul.py` sembraba "You are KROHN, built by Nous Research." en cada instalación; ahora siembra la persona KROHN (español, mordaz, límites de seguridad intactos) con **Cesar David Ciprian como creador**; la versión vieja quedó registrada como `legacy template` para auto-upgrade in-place en homes existentes; `DEFAULT_AGENT_IDENTITY` lo nombra también; `SOUL.md` del repo gana sección "0.0 IDENTIDAD Y CREACIÓN"; fixtures del prompt surface regenerados (el snapshot se codea con el código, no a mano). En este equipo, `%LOCALAPPDATA%\krohn\SOUL.md` también fue sustituido por la persona completa del repo (backup: `SOUL.md.bak-nousresearch`). Verificado en vivo: el agente responde *"Cesar David Ciprian."* y *"No, soy KROHN, creado por Cesar David Ciprian."*
2. **Mascota**: `config.yaml` tenía `display.pet.slug: homelander` (¡no era la tuya!). Restaurado `krohn-chibi`. El PNG se sirve 200 OK; en la UI web tu mascota renderiza (captura `KROHN/light-ui-screenshot.png`).
3. **UI ligera** (`packaging/lightui/`): reemplazo del index del dashboard servido en `/` — vanilla, ~69 KB, sin frameworks ni xterm. Estilo tipo Codex/MEDuSSA (rail fino, sidebar de conversaciones **reales** vía `session.list`, empty-state con pregunta centrada, composer inferior, pill de aprobación, pill de modelo (read-only), chips de sugerencia, mascota chibi en la esquina, vaivén `Enter`/`Shift+Enter`, botón de parar durante el streaming, reconexión exponencial). Verificado de extremo a extremo con jsdom (sesiones, envío, stream, markdown, stop) y por HTTP (200 + token inyectado).
4. **MEGANOTE** (`apps/meganote/`, `web/public/meganote/`): tu app takenotes v1.3.0 (MIT, fork KROHN, conservas autoría) integrada como **parte por defecto**. Rail → icono de libro → iframe embebido en la UI ligera. El agente tiene **acceso total**: todo el workspace es `%LOCALAPPDATA%\krohn\meganote.json` (validado `version: 2`); la skill `skills/meganote` enseña al agente la lectura/escritura segura (fusionar, no reemplazar; nunca JSON inválido; borrar = `trashed`). Rutas `GET/PUT /api/meganote` (loopback+token, escritura atómica) + `web/public/meganote/bridge.js` (sync IndexedDB↔archivo: en el primer open remoto manda sobre el seed tutorial; luego local manda; push cada ~4 s; aplica ediciones externas cuando llevas ≥20 s sin teclear). **Verificado con el agente real**: leyó el archivo y escribió una página completa (roundtrip vía API tras `krohn -z` de escritura). **Bug grave corregido**: el parche que inyectaba `bridge.js` usaba `.replace("</body>", ...)` sobre el **primer** `</body>` — que vive dentro de un string JS (plantilla de impresión); el `</script>` allí cortaba el bundle y la página mostraba el JS crudo. Ahora inyecta antes del **último** `</body>`; además el archivo conserva LF (mi parche previo escribió CRLF). **Si `krohn update` reconstruye web_dist, tu UI ligera y Meganote se borran** → restaura con `packaging/lightui/deploy.ps1` (idempotente).
5. **KROHN Live** (Gemini Live): overlay de voz full-duplex en el compositor (botón micrófono). WS directo del navegador al endpoint de Google (`.../GenerativeService.BidiGenerateContent`), PCM 16 kHz mic → PCM 24 kHz respuesta, interrupciones, transcripción en vivo, analyser de barras, selector de modelo (descubrimiento **real** de modelos `bidiGenerateContent` de TU clave — 9 modelos, `gemini-3.8-live` recomendado), y `GET /api/voice/live-key` (loopback+token) que entrega clave y modelos al cliente. La ruta exige token (401 sin él, verificado). **GPT Live** está presente en la UI pero **deshabilitado** con el motivo exacto: no hay `OPENAI_API_KEY` en `.env` — añádela y se activa el flujo (la ruta de OpenAI requiere su propio protocolo; no lo he fingido funcional). **No verificado el audio real** (sin micrófono aquí): el pipeline de protocolo está probado con `websockets` Python (setupComplete, audio PCM 24 kHz, `turnComplete`, transcripción "OK."); falta tu primera prueba con voz humana y permiso de micrófono del navegador.
6. **Integración técnica**: los routers `web_routers/meganote.py` y `web_routers/voice_live.py` están registrados en `web_server.py`; el dashboard fue reiniciado y sirve `GET /api/meganote`/`PUT` y `GET /api/voice/live-key` con token (sin token → 401). Skill `meganote` sincronizada en `krohn_home/skills/` (arranque del dashboard la trae del repo).

**Qué falta / límites honestos:**
- Audio real de KROHN Live (micrófono + permiso) — tu primera interacción.
- GPT Live: sin `OPENAI_API_KEY`; la vía del navegador exige flujo WebRTC/ephemeral-secret — no simulado.
- La UI ligera no sobrevive a un `krohn update` ni a `pnpm --dir web run build` (es el `index.html` desplegado) — restaurable con `packaging/lightui/deploy.ps1`.
- `krohn update` del checkout instalado avisa de que la app no se compiló desde fuente en esta PC (RAM 3.7 GB); el stack Python/TUI/Web está operativo desde el fuente; la app Electron NSIS 1.0.1 también arranca ya su backend.



## Sesión 9 (2026-11-19 madrugada) — KROHN Editorial: la interfaz definitiva

El usuario eligió el mockup 01 — **KROHN Editorial**. Se implementó como la UI definitiva (reemplaza a la light UI tipo Codex como `web_dist/index.html` vía `deploy.ps1`):

1. **KROHN Editorial UI** (`packaging/lightui/krohn-editorial.html`, ~94 KB, autocontenida, cero dependencias externas): rail con KROHN mark + nuevo/historial/Meganote/Live/comandos/ajustes, sidebar con wordmark KROHN *Agent* + búsqueda "Buscar conversaciones…" + historial real con borrado hover, topbar "KROHN / CHAT", empty-state Fraunces "¿En qué deberíamos trabajar en **KROHN 1.0**?", composer con aprobaciones y modelo, mascota chibi.
2. **Los paneles de Ajustes (drawer con 6 tabs), todos cableados a datos reales**:
   - **General** — idioma ES, tema, toggle Real de mascota, escala de la mascota (−/+ persistente), directorio cwd, perfil e aprobaciones (mirror en vivo).
   - **Modelo** — catálogo real desde `/api/model/options` (búsqueda), cambio real vía `POST /api/model/set` (persiste config; sesiones nuevas). Verificado: catálogo carga, nano-enano seleccionable.
   - **Voz** — Gemini Live disponible (modelos del API en vivo), botón "Probar ahora"; GPT Live ausente (falta OPENAI_API_KEY).
   - **Skills** — `/api/skills` real agrupado por categoría con toggle enable/disable por `PUT /api/skills/toggle`. Verificado.
   - **MCP** — lista real (`/api/mcp/servers`), estado vacío honesto, alta de servidor, habilitar/deshabilitar, probar, borrar. Verificado (POST al dar de alta).
   - **Sistema** — versión real `/api/health` + logs reales `/api/logs` + cwd/perfil/telemetría.
3. **Aprobación por clic**: el pill alterna smart → manual → off vía WS `config.set approvals.mode` (con etiqueta en vivo "Aprobación smart / Manual (pregunta) / Acceso completo").
4. **Paleta de comandos** (Ctrl/K): Nueva conversación, Ir a Meganote/Chat/Modelo/Sistema/Skills…, Live, buscar en historial.
5. **Mascota arrastrable** por toda la pantalla (pointer events + posición persistida en localStorage, con clamp de límites; clic/barra espaciadora = KROHN Live; debounce 300 ms para toque doble).
6. **Verificado extremo a extremo con jsdom** (backend stubbado REST+WS): 14/14 PASS — boot, token, sesiones, General al boot, envío completo de turno, approval pill cicla, selector de modelo aplica POST, skills listan y alternan, MCP alta, Sistema muestra versión+logs, Voz renderiza, Meganote entra/sale, clic de mascota abre Live, Ctrl+K filtra. Cero errores JS. Sin mojibake (UTF-8 limpio).
7. **Capturas** en `C:\Users\DAMSRIS NIBAL\KROHN\editorial-full2.png` (final: y `editorial-final.png`).
8. `deploy.ps1` actualizado: despliega `krohn-editorial.html`, regenera el sprite de la mascota y backupea `index.html`. Para volver a la UI anterior: `packaging/lightui/krohn-light-ui.html` + editar `deploy.ps1`.
9. Meganote embebido sigue funcionando (iframe token handshake) e intacto.

**Pendiente:** el usuario prueba KROHN Live con su micrófono (sin mic en esta máquina), y la voz queda documentada como tal; GPT Live espera OPENAI_API_KEY. El mockup original queda en `Downloads\KROHN-Mockups\` por si quiere volver atrás.

## Sesión 8 (2026-11-19) — Sarcasmo, mockups y espacio

1. **Voz de KROHN más hostil**: `SOUL.md` (secciones 1 y 5) + `krohn_cli/default_soul.py` (default sembrado). Nueva regla maestra: "Sarcasmo Elevado" — seco, culto, preciso, devastador con la mediocridad; nunca humilla por origen, sexo, creencias o condición. Validación prohibida. Verificado en vivo: la respuesta a una "estrategia de crecimiento de una línea para postergar" fue *"la primera obliga a actuar; la segunda permite seguir reuniéndose para 'definir KPIs' seis meses más. Elige tu veneno."* Fixtures del prompt surface regenerados.
2. **Mockups de interfaz** (carpeta aparte, NO en el repo): `C:\Users\DAMSRIS NIBAL\Downloads\KROHN-Mockups\` — 4 propuestas completas para la UI definitiva: `index.html` (comparativa) + `01-krohn-editorial.html` (marca oficial), `02-negro-absoluto.html` (Codex/MEDuSSA), `03-terminal-krohn.html` (TUI clásica fósforo), `04-carmesi-brutal.html` (brutal carmesí). Todas autocontenidas, misma funcionalidad visible (chat, MEGANOTE, sesiones, aprobaciones, Voz Live, modelo, skills, MCP, ajustes), crédito Cesar D. Ciprian y mascota chibi clicable → Live. Capturas en `shot-*.png`.
3. **Desktop y backend**: nada que iniciar a mano — KROHN Desktop lanza su propio backend automáticamente al arrancar (ver `desktop.log` "KROHN gateway is ready"); el dashboard lo lanza aparte para el navegador.
4. **TUI/CLI rehecho** (commit `2c095595`): figlet KROHN en ANSI Shadow, chibi KROHN en el banner (truecolor), versión limpia (`KROHN vX.Y.Z+hash (fecha)` sin sufijos upstream) y atribución **Cesar D. Ciprian**. El agente ya no imprime "Nous Research" ni "HERMES-AGENT".
5. **Espacio en disco**: borrado `npm-cache` — **5.16 GB → 10.6 GB libres** (`_cacache` 4.3 GB, `_npx` 1.05 GB, `_prebuilds` 49 MB). Solo quedó 0.9 MB de una carpeta en uso por NPX activo (se deja intacta).
6. **Clic en la chibi → KROHN Live** (UI web): la mascota alterna el modo voz Gemini Live al hacer clic (verificación jsdom: PASS).

**Pendiente:** el usuario elige un mockup (01–04) y reconstruyo la UI definitiva cableada al backend real (chat, MEGANOTE, KROHN Live).

## Sesión 7 (2026-11-19 madrugada) — UI ligera + Desktop ligero

**Objetivo:** que la interfaz "local" pese lo mínimo sin cambiar el look, para gama baja (~360 MB), y que funcione igual de bien en la versión de escritorio.

**Qué se hizo y verificó:**

1. **Optimizaciones de la UI ligera** (mismo look, menos costo):
   - Mascota: `spritesheet.png` web recortado a 576×684 con NearestNeighbor → **2.5 MB → 0.42 MB** (~9.5 MB menos decodificados). `packaging/lightui/krohn-chibi.png` (deploy lo genera solo desde el spritesheet del repo).
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
| **Mascota KROHN chibi** | ✅ | spritesheet en `packaging/pets/krohn-chibi/`; `display.pet.slug=krohn-chibi` y `display.pet.enabled=true` activos; eventos del agente → animaciones ya wired (tool.start/generating→`running`, reasoning→`review`, tool error→`failed`, turno completo→`jump`, clarify→`waiting`); arrastrable + Shift+clic → ventana siempre visible; tests pet: **79/79 ✅** |
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
- La mascota se activa por gateway; requiere `krohn config set display.pet.enabled true` (hecho) y que el gateway sirva `pet.info` con el spritesheet (ya instalado en `%LOCALAPPDATA%\krohn\krohn_home\pets\krohn-chibi`).
- 3.7 GB RAM: typecheck completo agota heap. La verificación efectiva es la **compilación completa**, no `tsc --noEmit`.
