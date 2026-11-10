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

## Carta de jugador (por puntos)
- Nadie escribe números: los puntos se reparten. Reglas en `netlify/lib/card-rules.mjs` (el servidor las valida).
- Carta inicial: cada atributo empieza en 30, el jugador reparte 540 puntos (máx. 80 por atributo) → OVR 60.
- Cada semana: 3 puntos + bonus del coach (0-2). Pasos de 0,5, máx. 2 por atributo y semana. Por encima de 80 cuesta el doble. Máx. 99.
- Los puntos no usados se acumulan solo una semana (máx. 6 + bonus).
- OVR = media de los 18 atributos. Temporada (~36 semanas) ≈ +7 a +10 OVR.
