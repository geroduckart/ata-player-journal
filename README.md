# ATA Player Journal

App del diario de jugadores de Almuñécar Tennis Academy.

- `public/index.html`: la app (jugadores y coach).
- `netlify/functions/journal.mjs`: la API. Aquí están los PIN por defecto (coach 0603, Matej 1111, Rudolf 2222).
- Los datos se guardan en Netlify Blobs (store `player-journal`).

## Añadir un jugador
1. En `public/index.html`, en `PLAYERS`, añade `{ id: 'nombre', name: 'Nombre' }`.
2. En `netlify/functions/journal.mjs`, en `DEFAULT_PINS`, añade `nombre: '1234'` con el mismo id.

Netlify Forms (detección activada) envía además una copia por email de cada registro.
