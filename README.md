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
- Carta inicial: cada atributo empieza en 30 (máx. 99), el jugador reparte 540 puntos → OVR 60.
- Cada semana: 3 puntos + bonus del coach (0-2). Pasos de 0,5, máx. 2 por atributo y semana. Por encima de 80 cuesta el doble. Máx. 99.
- Los puntos no usados se acumulan solo una semana (máx. 6 + bonus).
- OVR = media de los 18 atributos. Temporada (~36 semanas) ≈ +7 a +10 OVR.

## Partidos y torneos
- Pre/post-partido: "Just a match" o "Tournament". En torneo: nombre y ronda; el torneo se crea solo y la siguiente ronda se rellena sola.
- Se cierra solo al perder (ronda alcanzada) o al ganar la final (campeón). También "Finish" a mano (p. ej. retirada).
- Puntos de partido (máx. +3/semana): ganar +0,5 · objetivo de proceso cumplido +0,5 · "Great match" del coach +1 · semifinal +0,5, final +1, campeón +2. El coach puede anular los puntos de un partido.
