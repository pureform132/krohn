# KROHN — Prompts para generar imágenes con IA

Objetivo: ilustraciones coherentes con el branding **editorial oscuro** de KROHN.
KROHN: papel carbón (`#0E0D0B`), tinta crema (`#F2EAD9`), carmesí `#C8392B` (acento `#E0503E`), serifa editorial alto contraste (Fraunces), grotesca Inter para UI, hairlines finas, números en versalitas «Nº 01…», sin glassmorphism, sin neon, sin degradados baratos, sin texto AI-slop.

## Imágenes de referencia (enviar junto al prompt)

1. `assets/banner.png` — masterbrand: glifo K + wordmark sobre negro carbón.
2. `assets/krohn-glyph-white.svg` — glifo puro (blanco sobre transparente).
3. `apps/desktop/public/krohn-mark-dark.png` — icono cuadrado (glifo blanco sobre `#0E0D0B`).
4. `landing/og-1200x630.png` — póster de portada editorial.
5. `landing/assets/screens/home.png` — captura real de KROHN 1.0 (sesión vacía, shell cromado).

## 1) Portada de la landing (hero, 16:9)
"Cinematic editorial magazine cover, 16:9. A KROHN crown-stripe mark floating in darkness over a faint grid of computing traces, warm cream serif type reading 'You bring the idea. KROHN finishes it.' top third, thin crimson rule underneath, subtle film grain, tiny moon-bright highlight on the glyph, no people, no faces, no UI screenshots, deep matte black background (#0E0D0B) with 5% paper noise. Ultra-premium tech-magazine look, Fraunces type, crimson accent #C8392B. No text beyond the one line. No gradients, no bevels, no lens flares."

## 2) Spot page — la mano que guía (16:9, para sección "Cómo funciona")
"Editorial photograph-style render: a single human hand silhouetted against an enormous glowing filament of circuit-lines warming from ember orange to crimson, deep black background, soft vignette, film grain, no faces, no UI, no letters other than 'KROHN' in tiny copper plate at bottom-left. Matte, cinematic, editorial, extreme contrast, 7×4 ratio magazine print spread feel."

## 3) Spot page — KROHN cognición (16:9, "The first agent that simulates consciousness")
"Editorial illustration: a single closed eye drawn in fine cream line work with concentric arcs of slate-gray thought rings orbiting it slowly, on deep charcoal paper with grain. A single crimson dot at the pupil's center. Extremely restrained, museum-catalog quality. No other text or objects."

## 4) Spot page — cron (16:9, "Ask once. Done forever.")
"Editorial still life: a matte black analog alarm clock (flat, no digital elements) with a crimson second hand standing on a dark desk, deep black background, single warm pool of light from upper-left, paper grain, cinematic crop, no text, no faces. Print-magazine photography feel."

## 5) OG/Marca de agua para rede compartir (1200×630)
"Use the existing `/assets/og-1200x630.png`. Do NOT regenerate; reuse. If regeneration is requested, rebuild with the same layout: dark field, glyph left, wordmark right, one kicker line 'KROHN · THE FORK WITH A REAL IDENTITY', fine crimson rule, 'pureform132.github.com/krohn · MIT' bottom-left."

## 6) Icono app (1024×1024, para el .exe)
"Do NOT regenerate; `apps/desktop/public/krohn-mark-dark.png` and `krohn-mark.png` are final. If a fresh master is requested: pure white angular K glyph in a squircle of #0E0D0B with a single crimson optic slit. No gradients, no glow, no shadows, flat."

## 7) Ilustration futurist landing-hero (opcional, 1920×1080)
"1000×562 cinematic wide shot: a lone crown-stripe floating over a dark metropolis seen from above at 3 AM, warm streetlamps as faint orange filaments, the city below indistinct, sky almost black. No people. No lettering. Slight grain. Premium editorial feature image for a technology magazine."

## Reglas de coherencia (pegar con cada prompt)

- Respeta estrictamente: `#0E0D0B` (fondo), `#F2EAD9` (tinta), `#C8392B` (acento), `#A79A83` (acento secundario).
- Tipografía serifa de contraste (Fraunces o similar); nunca sans para titulares.
- Papel con micro-ruido, no gradientes suaves.
- Cero UI falsa detallada; cero logos de terceros; cero caritas humanoides synth-AI genéricos; esto es una revista editorial, no un cartel de evento cripto.
- Sin texto más allá de lo indicado; sin watermarks; sin manos/cuerpos; sin gatos.
- Aspect ratios: hero 16:9, spot 16:9, og 1200×630, app-icon 1:1.
