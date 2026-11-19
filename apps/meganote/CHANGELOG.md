# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado [SemVer](https://semver.org/lang/es/).

## [1.3.0] — 2026-11-18

### Añadido

**Editor y página (23)**

- Barra de formato flotante al seleccionar texto (negrita, itálica, subrayado, tachado, código en línea, quitar formato).
- Colores de texto y de fondo por selección (tonos de la paleta del cuaderno).
- Editor de enlaces con diálogo propio y validación de URLs seguras (`Ctrl K`).
- Menú de bloque: duplicar, copiar texto, mover, convertir en…, color y fondo, alineación, eliminar.
- Bloques de tabla editable (2×3 de serie, filas/columnas dinámicas, encabezado alternable).
- Arrastrar y soltar bloques con el asa de agarre (reordena el contenido del documento).
- Bloque de columnas (2 o 3) con contenido independiente por columna.
- Bloque de marcador web con tarjeta, host y enlace abrir/cambiar.
- Bloque para incrustar YouTube, Vimeo y Spotify (iframe con `youtube-nocookie.com`).
- Bloque de vídeo (reproductor) desde una URL con portada y cambiar URL/quitar.
- Bloque de audio (reproductor) desde una URL con cambiar URL/quitar.
- Ecuaciones LaTeX con previsualización en vivo (`equationfield` + ejemplos).
- Destacados (callouts) personalizables: icono y tono tinta/terracota/salvia.
- Bloque de código con selector de lenguaje, conteo de líneas y copiar al portapapeles.
- Pegado inteligente de Markdown (`# `, listas, to-dos, citas, código, tablas) convierte varios bloques de una vez.
- Atajos Markdown al inicio de línea mejorados (`# `, `- `, `1. `, `[] `, `> `, ``` ` ```); restauran el foco tras convertir.
- Subrayado de búsqueda dentro de la página (`Ctrl F`) con navegación por coincidencias.
- Bloquear/desbloquear la página completa (`Ctrl Shift L`, solo lectura).
- Opciones de visualización: ancho completo, texto pequeño, tipografía (sans/serif/mono) y altura de portada.
- Alineación de bloques a izquierda/centro/derecha.
- Menciones de páginas con `@` y navegación al destino.
- Historial de versiones local: guardar instantánea, restaurar, eliminar (30 últimas).
- Deshacer/rehacer con agrupación de cambios y aviso en pantalla (`Ctrl Z` / `Ctrl Shift Z`).

**Navegación y páginas (13)**

- Galería de plantillas con 8 diseños escritos a mano (reunión, semanal, retro, lectura…).
- Páginas recientes en la barra lateral (persisten entre sesiones).
- Enlaces profundos por página; atrás/adelante con botones de la barra superior o `Alt ←/→`.
- Modo concentración: oculta barra lateral y barra superior (`Ctrl Shift F`, `Esc` para salir).
- Imprimir / Guardar como PDF desde la vista previa (`Ctrl P`).
- Exportar la página como HTML autónomo (`Ctrl Shift E`) y como Markdown (`Ctrl Shift M`).
- Exportar la base de datos como CSV e importar un CSV como base de datos con tipos inferidos.
- Ayuda de atajos (`?`) con grupos Navegación/Escritura/Markdown/Páginas.
- Paleta de comandos completa (`Ctrl K`): búsqueda de páginas con ranking, acciones (`>`), recién creadas primero para páginas.
- Barra lateral redimensionable y con ancho persistente (`localStorage`).
- Copiar enlace de la página al portapapeles.
- Duplicar página con su subárbol completo.
- Árbol lateral con acciones rápidas de página (favorito, duplicar, mover, papelera, exportar).

**Bases de datos (14)**

- Filtros avanzados combinables (Y / O), con operadores por tipo de propiedad y limpieza individual.
- Multi-orden por varias propiedades con dirección por regla y badges en el encabezado.
- 12 tipos de propiedad (texto, número, selección, multiselección, fecha, casilla, URL, correo, teléfono, creada, editada) con conversión en caliente.
- Vista Lista con propiedades en línea y fecha de última edición.
- Cálculos de pie de tabla (recuento, suma, media, min/max, vacías/rellenas, %).
- Panel de taller de fila con todos los campos editables y gestión de opciones desde ahí.
- Reordenar columnas por arrastre o con el menú (Mover a la izquierda/derecha).
- Reordenar filas arrastrando el asa de agarre.
- Duplicar fila desde la fila o la lista.
- Gestión de opciones de selección: renombrar, recolorear (tinta/terracota/salvia), eliminar, ver uso.
- Tablero con ocultar grupos vacíos.
- Galería con portada automática por columna de selección y tamaño S/M/L persistente.
- Búsqueda rápida dentro de la base con cuenta de resultados y limpieza.
- Conversión de propiedad en caliente (texto ⇄ número ⇄ selección ⇄ fecha ⇄ casilla…).

### Corregido

- `# `/`- `/…` al inicio de línea perdían el foco del editor al convertir el bloque; ahora vuelve al final del texto.
- El menú `/` no se abría con consultas con tildes o ñ (`/vídeo`, `/ecuación`) y la búsqueda era sensible a acentos; ahora todo es insensible a acentos.
- La barra de formato desaparecía al abrir el editor de enlace o el selector de tono (el foco salía del bloque); ahora se mantiene mientras el foco vive en ella.
- Incrustar YouTube mostraba una tarjeta de enlace tras recargar (la URL guardada era `youtube-nocookie.com`, no reconocida); ahora se detecta y se muestra el iframe.
- La cuenta de resultados (`N de M`) solo reflejaba la búsqueda rápida, no los filtros avanzados.
- `Ctrl K` tenía dos manejadores que se anulaban entre sí; queda uno solo.
- En la paleta, Enter abría «Nueva página» antes que la página buscada; las páginas ahora encabezan los resultados.
- La ayuda de atajos y la galería de plantillas no se cerraban con `Esc`.

### Pruebas

- 66 pruebas de extremo a extremo en Chrome real vía CDP (`scripts/e2e-*.mjs`): editor (32), bases de datos (17) y navegación/persistencia/descargas (17). `tsc -b` y `vite build` en verde.

## [1.2.0] — 2026-11-17

### Añadido

- **Clic en cualquier espacio libre** para crear un bloque de texto y escribir, como en Notion; el papel bajo el contenido es ahora una zona de escritura.
- **Arrastrar y soltar páginas**: desde el árbol lateral, las tarjetas de subpágina, los enlaces de página o las migas de pan.
- Al soltar sobre el **papel de una página**, la página arrastrada se convierte en subpágina y aparece como tarjeta en el punto de destino.
- Al soltar sobre una **fila del árbol**, una **tarjeta** o una **miga**, la página se anida bajo ese destino.
- Al soltar sobre una **base de datos**, la página pasa a ser su subpágina.
- Avisos de confirmación, resaltado del destino y protección contra mover una página dentro de sí misma o de sus descendientes.

## [1.1.0] — 2026-11-17

### Añadido

- **Subpáginas**: crea una página hija desde el encabezado o con `/subpágina`; aparece como tarjeta dentro del padre y en el árbol lateral.
- **Stickers de página**: 43 iconos propios con buscador y cuatro grupos (Esenciales, Naturaleza, Vida, Símbolos).
- **Portadas**: seis tonos planos de la paleta (Salvia, Terracota, Papel, Amanecer, Atardecer, Noche) con cambio y borrado.
- **Tabla de contenido**: bloque `/toc` generado automáticamente desde H1–H3, con navegación al encabezado.
- **Duplicar página**: copia la página y todo su subárbol, incluidos bases de datos y referencias internas.
- **Mover página**: diálogo con buscador y árbol de destinos, con protección contra ciclos.
- **Enlaces a páginas y backlinks**: bloque `Enlace a página` con selector y sección «Mencionada en».
- **Vista Galería** para bases de datos, con tarjetas editables y portada por tono.
- **Gráficos**: cuatro tipos (barras, horizontal, líneas/área y donut), agrupación por selección/fecha/casilla/texto, métrica de recuento/suma/media y tarjetas de resumen.
- Columna numérica de ejemplo «Esfuerzo (h)» para probar suma y media.

### Corregido

- El DOM editable ya no conserva el texto `/comando` al convertir un bloque en índice, enlace o subpágina.
- Las portadas usan formas planas, no degradados, para respetar «The Paper Desk».

## [1.0.0] — 2026-11-17

Primera versión pública de Takenotes.

### Añadido

- Editor de bloques: texto, H1–H3, listas, to-dos, toggles, citas, código, destacados, divisores, imágenes y adjuntos de cualquier tipo (hasta 8 MB).
- Menú de comandos `/` con 14 tipos de bloque y navegación por teclado.
- Formato inline (`Ctrl+B`, `Ctrl+I`, `Ctrl+Shift+X`, `` Ctrl+` ``) y atajos Markdown al inicio de bloque.
- Páginas anidadas, favoritos, papelera reversible y restauración en cascada.
- Búsqueda a texto completo (`Ctrl/Cmd+K`) en títulos, bloques y filas de bases de datos.
- Bases de datos con propiedades de texto, número, selección, fecha y casilla.
- Cuatro vistas: tabla, kanban con drag & drop, calendario y gráfico de barras SVG.
- Varios workspaces con creación, cambio y renombrado; migración automática v1→v2.
- Importación del export oficial de Notion (**Markdown y CSV**): jerarquía, bloques, bases de datos e imágenes incrustadas.
- Modo oscuro «The Night Desk» y modo claro, con preferencia persistente.
- Copia de seguridad JSON, restauración validada y exportación Markdown por página.
- App de escritorio para Windows (PyInstaller + WebView2, ~13 MB) y build web autocontenido.
- Landing page y documentación de producto/diseño.

### Corregido

- El panel de importación ya no se comprime dentro de la barra lateral: aparece como tarjeta flotante.
- Las fechas del calendario se calculan en ISO local, sin desplazamientos por zona horaria.
- La búsqueda indexa también las celdas de bases de datos.

### Limitaciones conocidas

- Sin colaboración en tiempo real, IA ni publicaciones web.
- El ejecutable de Windows no tiene firma comercial (SmartScreen puede avisar).
- Los adjuntos de Notion que no son imágenes se importan como referencia textual.
