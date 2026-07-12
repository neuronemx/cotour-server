# IMMERSA — Interacciones visual freeze

Referencia visual congelada para PR #75, rama `agent/interactions-home-modal`.

Estado de referencia: inmediatamente después de `f139042802ab96633f669c2623bfa5b63754ea16`.

## Regla operativa

Durante la corrección funcional de Interacciones no se deben modificar los archivos visuales congelados. Cualquier cambio visual requiere aprobación explícita de Arturo y actualización deliberada del contrato automático en el mismo commit.

## Archivos visuales congelados

| Archivo | Git blob SHA |
|---|---|
| `public/shared/interactions.css` | `a5aba78d7d0615e16fc91f5aecd4e241a1580d27` |
| `public/shared/interactions-home.css` | `a3736da613aa4f5265fcc7ca4516a69c0d30f998` |
| `public/shared/interactions-home-recovery.css` | `c99cc6e55a7a2ec5017093cc7de502b5a72347a7` |

## Elementos visuales protegidos

- Gradiente Immersa exacto: `linear-gradient(135deg, #7f77dd 0%, #378add 55%, #5dcaa5 100%)`.
- Fondo glass exacto: `linear-gradient(160deg, rgba(30, 26, 48, .96), rgba(18, 16, 30, .98))`.
- Tipografía del título: Poppins.
- Tipografía de cuerpo y botones: Inter.
- Modal de Speaker: ancho máximo de 380 px.
- Menú superior permanente de cuatro columnas.
- Orden del menú: Encuestas, Sorteos, Concursos, Juegos.
- Iconos exactos embebidos en SVG para las cuatro categorías.
- Categoría activa con gradiente Immersa.
- Tarjetas de categoría con altura mínima de 52 px y radio de 9 px.
- Pleca superior interior con gradiente.
- Cápsulas, radios, espaciados y estados aprobados contenidos en los tres CSS congelados.
- Texto neutral de Home: `Selecciona una interacción.`

## Estructura visual aprobada

1. Título `Interacciones`.
2. Menú superior permanente con cuatro categorías.
3. Cuerpo neutral cuando no hay categoría activa.
4. Encuestas y Sorteos renderizados debajo del mismo menú.
5. Concursos y Juegos visibles como categorías deshabilitadas.
6. X visible únicamente cuando no hay una interacción activa.
7. Durante una interacción activa, el menú permanece visible pero bloqueado.

## Elementos no congelados

Estos elementos pueden modificarse para reparar la lógica, siempre que no cambien el resultado visual:

- `public/shared/raffle-controller.js`
- `public/presenter/presenter.js`
- `public/stage/stage.js`
- stores y handlers Socket
- pruebas funcionales

No deben introducirse nuevos observers, intervalos, capas `polish`, capas `recovery` adicionales ni handlers globales de compatibilidad.

## Verificación automática

La prueba `test/interactions-visual-freeze.test.js` compara los Git blob SHA de los tres archivos contra esta referencia y también verifica los tokens visuales críticos.

Si la prueba falla durante una corrección funcional, el cambio visual debe revertirse; no se debe actualizar el hash para hacer pasar CI sin aprobación explícita.
