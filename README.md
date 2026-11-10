# ATA Player Journal

App del diario de jugadores de Almuñécar Tennis Academy.

- `public/index.html`: la app (jugadores y coach).
- `netlify/functions/journal.mjs`: la API. Aquí están los PIN por defecto (coach 0603, Matej 1111, Rudolf 2222).
- Los datos se guardan en Netlify Blobs (store `player-journal`).

## Añadir un jugador
1. En `public/index.html`, en `PLAYERS`, añade `{ id: 'nombre', name: 'Nombre', level: 'simple' }`.
   `level`: `'simple'` (más toques, menos texto; "go deeper" discreto) o `'reflective'` ("go deeper" recomendado).
2. En `netlify/functions/journal.mjs`, en `DEFAULT_PINS`, añade `nombre: '1234'` con el mismo id.

Netlify Forms (detección activada) envía además una copia por email de cada registro.

## Criterios (informe "Coaching mental tenistas sub 13")
- Escalas de 5 puntos etiquetadas, no 1-10.
- Formularios cortos; lo reflexivo va en "Go deeper" (opcional).
- Sin rachas diarias: semana con puntos, reto del mes puesto por el coach.
- Patrones automáticos y alertas de bienestar: solo para el coach.
- Responde a cada post-partido y semanal con un comentario de proceso en menos de 48 h.
