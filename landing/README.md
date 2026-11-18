# KROHN — Landing (Netlify)

Sitio público de KROHN. Estático, sin build: la carpeta es la app.

**Producción prevista:** https://krohn.netlify.app/ (Site #1 en Netlify, `publish = "."`).
Documentación en un sitio hermano: https://krohn-docs.netlify.app/ (ver `../docs/`).

## Contenido

- Hero editorial oscuro con el nombre del producto (Fraunces, negro carbón `#0E0D0B`, tinta crema `#F2EAD9`, carmesí `#C8392B`).
- Video hype de 30s (`assets/krohn-hype.mp4`) y video con la mascota de 10s (`assets/krohn-pet-10s.mp4`).
- Capturas reales de KROHN Desktop en `assets/screens/`.
- Mascota Ultrón chibi propia (`packaging/pets/krohn-ultron-chibi/` en el repo; celdas sueltas en `assets/`).
- Animaciones: flotación del glifo, typewriter en el hero, reveal on scroll (con fallback), cursor animado sobre las capturas, marquee de specs reales.
- Documentación SEO: Open Graph, Twitter Cards, JSON-LD (SoftwareApplication + Organization), hreflang, sitemap, robots.
- Sin métricas, testimonios ni cifras inventadas. Datos: 66 MCP · 44 skills · 26 plataformas · FTS5 · MIT.

## Despliegue

```powershell
# 1. Arrastra esta carpeta a https://app.netlify.com/drop, o
# 2. netlify deploy --prod --dir=.
```

No requiere build. `netlify.toml` fija `publish = "."` y headers de seguridad.
Los assets son relativos (`assets/...`), por lo que el sitio funciona en cualquier base path.

## Mantenimiento

- Los `.mp4` se generan con páginas `demo-highenergy.html` / `demo-pet.html` (seek(t) puro) vía `apps/desktop/scripts/render-krohn-demo.mjs` del repo.
- Si cambias capturas o videos, súbelos aquí y verifica el sitio antes de hacer deploy.
- No publiques `IMAGE-PROMPTS.md` con material a medidas: está bien como referencia interna.
