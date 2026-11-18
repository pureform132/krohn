# KROHN — Documentación (Netlify)

Documentación estática de KROHN (ES, con términos técnicos en inglés).

**Producción prevista:** https://krohn-docs.netlify.app/ (Site #2 en Netlify, `publish = "."`).
La landing vive en https://krohn.netlify.app/ (ver `../landing/`).

## Contenido

- Instalación en Windows, primer arranque y proveedores.
- CLI, TUI y Desktop (Electron) — uso básico.
- La mascota Ultrón (Desktop): estados, Shift+clic para ventana flotante, opt-in.
- config.yaml y .env, proveedores (DeepSeek, Gemini, NVIDIA, OpenRouter, Nous, Ollama/LM Studio).
- Skills, MCP, gateways y mensajería, cron/kanban, subagentes, seguridad.
- Licencia y atribución (MIT + Nous Research) y créditos (Creado por Cesar D. Ciprian).

## Despliegue

```powershell
# 1. Arrastra esta carpeta a https://app.netlify.com/drop, o
# 2. netlify deploy --prod --dir=.
```

No hay build. Los assets son relativos (`assets/...`).
