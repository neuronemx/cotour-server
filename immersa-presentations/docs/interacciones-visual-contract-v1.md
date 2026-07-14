# Contrato visual de Interacciones v1

Este documento define el contrato visual vigente para el shell nativo de Interacciones en Speaker y Stage.

## Procedencia

La referencia visual aprobada proviene del freeze documentado en el respaldo del PR #75 (`agent/interactions-home-modal`), específicamente de:

- `immersa-presentations/docs/interacciones-visual-freeze.md`
- `immersa-presentations/public/shared/interactions.css`
- `immersa-presentations/public/shared/interactions-home.css`
- `immersa-presentations/public/shared/interactions-home-recovery.css`

Los blobs identificados por ese freeze fueron usados sólo como contrato visual:

- `public/shared/interactions.css`: `a5aba78d7d0615e16fc91f5aecd4e241a1580d27`
- `public/shared/interactions-home.css`: `a3736da613aa4f5265fcc7ca4516a69c0d30f998`
- `public/shared/interactions-home-recovery.css`: `c99cc6e55a7a2ec5017093cc7de502b5a72347a7`

## Tokens obligatorios

- Gradiente Immersa: `linear-gradient(135deg, #7f77dd 0%, #378add 55%, #5dcaa5 100%)`.
- Fondo glass: `linear-gradient(160deg, rgba(30, 26, 48, .96), rgba(18, 16, 30, .98))`.
- Títulos con Poppins.
- Cuerpo, controles y botones con Inter.
- Scrim limitado al slide: `rgba(2, 4, 8, .22)` y `blur(4px)`.

## Estructura del shell

- Título: `Interacciones` en estado neutral.
- Menú superior permanente de cuatro columnas, en este orden:
  1. Encuestas
  2. Sorteos
  3. Concursos
  4. Juegos
- Estado neutral: `Selecciona una interacción.`.
- Encuestas y Sorteos se renderizan bajo el mismo menú.
- Concursos y Juegos permanecen visibles, apagados, deshabilitados, sin badges y sin texto adicional.

## Reglas de interacción visual

- El panel de Speaker no debe exceder `380px`, debe permanecer centrado y no debe desbordar el viewport.
- El menú es una barra única segmentada: un contenedor oscuro y redondeado con cuatro segmentos internos del mismo ancho.
- Cada segmento usa el SVG exacto aprobado del PR #75; está prohibido redibujar, reinterpretar o sustituir esos iconos.
- Sólo el segmento activo usa el gradiente Immersa exacto y un radio interior; los segmentos inactivos son transparentes y no parecen tarjetas separadas.
- Existe una sola pleca horizontal con gradiente, integrada al borde superior interior del panel principal.
- Durante una interacción activa el menú permanece visible pero bloqueado.
- La X de cierre es única, ligera, circular, centrada ópticamente, posicionada en la esquina superior derecha real y sólo se muestra cuando no hay interacción activa.
- El estado neutral no tiene tarjeta interna: conserva sólo el texto centrado `Selecciona una interacción.` sobre el fondo del panel principal.
- El scrim no debe convertirse en backdrop fullscreen global; sólo oscurece y desenfoca el slide.

## Prohibición arquitectónica

El PR #75 no debe recuperarse como arquitectura. Queda prohibido reintroducir desde ese respaldo:

- JavaScript legacy o handlers globales de compatibilidad.
- Observers, intervalos o capas adicionales de `polish`/`recovery`.
- Duplicación de nodos, clonación de handlers o selectores dependientes de texto visible.
- Cambios funcionales al shell nativo actual, sockets, stores, renderers persistentes, slide-to-close, Stage, Speaker, Público o Screen.

La implementación funcional estable de `main` es la fuente de verdad. Este contrato sólo gobierna la reconciliación visual mantenible en la capa compartida actual.
