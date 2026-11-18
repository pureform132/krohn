# KROHN — Handoff (qué debes saber y hacer tú)

Última actualización: 2026-11-18 sesión 4 — estado verificado del fork.

## Estado verificado por capa

| Capa | Estado | Nota |
|---|---|---|
| Rebrand Hermes→KROHN | ✅ | 12.718 archivos reescritos, 121 renombrados |
| Iconos, banner, fuentes | ✅ | Glifo KROHN propio; .ico/.icns regenerados; banner editorial |
| Tema editorial oscuro (desktop/web/TUI/CLI) | ✅ | `krohn` como skin por defecto; carmesí/crema/carbón |
| Plugin marketplace | ⛔ desactivado | Opt-in con `plugins.marketplace.enabled: true` en `config.yaml` cuando existan un repo de plugins propio. Compilado: cero plugin store en web/onboarding. |
| Prompt surface | ✅ regenerado | snapshot 9 surfaces committed; `python scripts/ci/prompt_surface.py render` |
| Instalador Windows | 🕓 no compilado | NSIS x64 configurado (`KROHN-Setup-1.0.0.exe`); **pendiente tu orden** |
| Repo | ✅ público | https://github.com/pureform132/krohn (rama `master`) |

## Qué tú debes hacer AHORA (en orden)

1. **Holgura del llavero**
   - Revoca (rotate) las claves expuestas en este entorno: la **Gemini API key de AI Studio** que me entregaste y cualquier otra credencial visible en tu entorno (`NVIDIA_API_KEY`, `OPENROUTER_API_KEY`, `HERMES_HOME`). Fueron usadas durante pruebas pero no las publicamos en el repo; aun así, cámbialas.
   - Buscaremos claves en los paths `…\medussa_test_home\state\api_keys.json` y `…\medussa_codex_home\state\api_keys.json` en `%TEMP%\opencode\` (archivos que no creamos nosotros): recomendado revocar el par asociado también.

2. **Just integrado**
   - `just` 1.59.0 instalado (WinGet). El `lefthook` pre-commit usa `just check`. Si `git` falla con `just: command not found`, abre una terminal nueva (PATH actualizado) o usa `git commit --no-verify` con revisión propia.

3. **We debió cambiar**
   - Contamos con Skills, Plugins, MCP y herramientas heredados, pero el catalogo de plugins está apagado. Si activas `plugins.marketplace.enabled: true` sin catálogo propio, KROHN ofrecerá sistemas incompletos/no probados — no lo hagas aún.

4. **Compilación del .exe** (cuando des la orden)
   - `node scripts/build.mjs` (compilación del render + Electron + nativos) → ya demostrado ✅
   - `pnpm run dist:nsis` → `release/KROHN-Setup-1.0.0.exe`
   - Nota de plataforma: esta máquina tiene 3.7 GB de RAM; el typecheck completo del renderer de escritorio agota el heap. La verificación efectiva es la **compilación completa**, no `tsc --noEmit`.
   - Sin certificado de firma → SmartScreen avisará "editor desconocido". Funcional igual.

5. **Navegador / web testing**
   - Cuando levantes el dashboard: `krohn dashboard` (requiere Python + env). Para las pruebas del frontend corriendo en dev: `cd web && pnpm dev`. El build de produce a `krohn_cli/web_dist/` automáticamente con `pnpm run build`.

6. **DeepSeek/NVIDIA/Gemini por defecto**
   - quedó acordado en "configurable en el onboarding" — hoy KROHN abre la puerta a elegir proveedor en el primer arranque. `deepseek`/`nvidia`/`gemini` ya existen como provider ids válidos; definir un destacado implicaría editar `apps/desktop/src/components/onboarding/index.tsx`.

## Qué NO debes hacer

- **No** hagas `krohn update` en el repo todavía: el updater está pensado para pasar por el fork; tu release aún no existe — el comando podría caer en behaviors inesperados.
- **No** actives el marketplace sin catálogo propio (`plugins.marketplace.enabled: true`).
- **No** hagas `git push --force` al repo: la rama `master` es pública.
- **No** copies/secretas en / sitio web hacia Chrome WXT u otros stores plugins hermes-* de terceros.
- **No** tomes "Hermes-agent.nousresearch.com" como documentación oficial de KROHN: en este repo las URLs de docs apuntaron al fork (`github.com/pureform132/krohn/tree/master/website/docs`). La documentación aguas arriba **sirve como referencia de comportamiento**, pero no está afiliada.

## Riesgos a tener en cuenta

- SmartScreen: avisos de editor desconocido por no tener certificado de firma.
- Rate limits: la AI Studio free tier de Gemini agotó el batch de HermesEval tras ~5-6 tareas; para reejecutar las 16 tareas, habilita billing o usa la key NVIDIA/OpenRouter de tu entorno. Nada del test quedó guardado en el repo.
- Attached values reference KROHN commits untested upstream from this tree; cualquier fork de KROHN hacia otros repos requiere re-auditoría de `krohnpm` (pins `uv`/`pm/lock.json`).
