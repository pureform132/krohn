# KROHN — Handoff (qué debes saber y hacer tú)

Última actualización: 2026-11-18 sesión 5 — mascota conectada, webs en carpetas independientes, créditos.

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
