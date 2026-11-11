/**
 * ATA Player Journal — API
 *
 *   POST /api/login     { role: 'player'|'coach', player?, pin }   → check a PIN
 *   GET  /api/entries   headers x-player, x-pin                     → a player's entries
 *   POST /api/entries   headers x-player, x-pin  body { entry }     → save an entry
 *   GET  /api/coach     header  x-pin (coach)                       → every player's entries
 *   POST /api/pin       headers x-player, x-pin  body { newPin }    → a player changes their PIN
 *   POST /api/pin-reset header  x-pin (coach)    body { player }    → coach resets a PIN to default
 *   POST /api/reply     header  x-pin (coach)    body { player, id, reaction, text } → coach replies to an entry
 *   POST /api/challenge header  x-pin (coach)    body { player, text }  → set the player's challenge of the month
 *   POST /api/coach-entry header x-pin (coach)   body { player, entry } → coach's own rating of the game profile
 *   POST /api/reset-all header  x-pin (coach)    body { confirm:'DELETE' } → wipe ALL journal data (irreversible)
 *
 * Default PINs live here, on the server. The browser never sees them.
 * When a player changes their PIN in the app, it is stored (hashed) in Blobs
 * and overrides the default. The coach can reset it back to the default.
 * To change them without touching code, set the Netlify environment variable
 *   JOURNAL_PINS = {"coach":"0603","matej":"4826","rudolf":"7391"}
 * To add a player: add their PIN here (or in JOURNAL_PINS) and their name in
 * PLAYERS at the top of public/index.html, using the same id.
 */

import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { CARD, weekKey, weekId, buildCard, checkStart, checkWeek, ATTRS, ROUNDS, T_RESULTS } from '../lib/card-rules.mjs';

const DEFAULT_PINS = {
  coach:  '0603',
  matej:  '1111',
  rudolf: '2222',
  nico:   '3333',
};

const MAX_FAILS = 10;                 // wrong PINs allowed per IP…
const FAIL_WINDOW_MS = 15 * 60 * 1000; // …per 15 minutes
const TYPES = new Set(['daily', 'pre', 'post', 'weekly', 'profile', 'cardinit', 'cardweek', 'tournament']);
const REACTIONS = new Set(['👏', '🔥', '💪', '🧠', '❤️', '😂']);

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function pins() {
  const p = { ...DEFAULT_PINS };
  try { if (process.env.JOURNAL_PINS) Object.assign(p, JSON.parse(process.env.JOURNAL_PINS)); } catch (e) {}
  return p;
}
const PIN_KEY = 'config/pin-overrides';
const pinHash = (id, pin) => crypto.createHash('sha256').update(`ata-journal:${id}:${pin}`).digest('hex');
async function overrides() { return (await store().get(PIN_KEY, { type: 'json' })) || {}; }
/* Is this the current PIN for this id? (custom PIN if set, otherwise the default) */
async function pinMatches(id, pin) {
  if (!pin) return false;
  const o = await overrides();
  if (o[id]) return same(pinHash(id, pin), o[id]);
  const P = pins();
  return P[id] !== undefined && same(pin, P[id]);
}
const playerIds = () => Object.keys(pins()).filter((k) => k !== 'coach');

const store = () => getStore({ name: 'player-journal', consistency: 'strong' });

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/* Calendar day in Spain, so "today" and "midnight" mean the same for player and server */
const madridDay = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

function clientIp(req, context) {
  return context?.ip || req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'unknown';
}
const rateKey = (ip) => 'ratelimit/' + sha(ip).toString('hex').slice(0, 24);

async function isLocked(ip) {
  const r = await store().get(rateKey(ip), { type: 'json' });
  return !!(r && Date.now() - r.since < FAIL_WINDOW_MS && r.count >= MAX_FAILS);
}
async function recordFail(ip) {
  const s = store(), key = rateKey(ip);
  const r = await s.get(key, { type: 'json' });
  const fresh = !r || Date.now() - r.since >= FAIL_WINDOW_MS;
  await s.setJSON(key, fresh ? { count: 1, since: Date.now() } : { count: r.count + 1, since: r.since });
}

/* Checks a PIN for a role. Returns null when OK, or an error Response. */
async function check(req, context, { role, player, pin }) {
  const ip = clientIp(req, context);
  if (await isLocked(ip)) return json({ error: 'Too many attempts. Try again later.' }, 429);
  let ok = false;
  if (role === 'coach') ok = await pinMatches('coach', pin);
  else ok = playerIds().includes(player) && await pinMatches(player, pin);
  if (!ok) { await recordFail(ip); return json({ error: 'Wrong PIN' }, 401); }
  return null;
}

/* Keep only plain answers: strings, numbers, short string lists. */
function cleanData(data) {
  const out = {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  for (const [k, v] of Object.entries(data).slice(0, 80)) {
    if (!/^[a-z_]{1,32}$/.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 2000);
    else if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string').slice(0, 30).map((x) => x.slice(0, 120));
  }
  return out;
}

async function listEntries(player) {
  const s = store();
  const { blobs } = await s.list({ prefix: `entries/${player}/` });
  const items = await Promise.all(blobs.map((b) => s.get(b.key, { type: 'json' })));
  return items.filter(Boolean).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/* ── Handler ─────────────────────────────────────────────────────────────── */

export default async (req, context) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, '');

  try {
    /* Sign in */
    if (path === '/api/login' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const role = body.role === 'coach' ? 'coach' : 'player';
      const err = await check(req, context, { role, player: String(body.player || ''), pin: String(body.pin || '') });
      return err || json({ ok: true, role });
    }

    /* A player's own entries */
    if (path === '/api/entries') {
      const player = String(req.headers.get('x-player') || '');
      const pin = String(req.headers.get('x-pin') || '');

      if (req.method === 'GET') {
        // the player, or the coach, can read
        const asCoach = playerIds().includes(player) && await pinMatches('coach', pin);
        if (!asCoach) { const err = await check(req, context, { role: 'player', player, pin }); if (err) return err; }
        const reset = await store().get('config/reset-at', { type: 'json' });
        return json({ entries: await listEntries(player), challenge: await store().get(`challenge/${player}`, { type: 'json' }), resetAt: reset && reset.at });
      }

      if (req.method === 'POST') {
        const err = await check(req, context, { role: 'player', player, pin });
        if (err) return err;
        const raw = await req.text();
        if (raw.length > 32000) return json({ error: 'Entry too large' }, 413);
        let body; try { body = JSON.parse(raw); } catch (e) { return json({ error: 'Bad JSON' }, 400); }
        const e = body && body.entry;
        if (!e || !/^[a-z0-9]{6,20}$/.test(String(e.id)) || !TYPES.has(e.type) || isNaN(Date.parse(e.date)))
          return json({ error: 'Invalid entry' }, 400);

        const key = `entries/${player}/${e.id}`;
        const s = store();
        const existing = await s.get(key, { type: 'json' });

        /* Tournament: created when the first match is logged, updated round by round, finished at the end */
        if (e.type === 'tournament') {
          const d = e.data || {};
          const status = d.status === 'finished' ? 'finished' : 'ongoing';
          if (status === 'finished' && !T_RESULTS.includes(d.result)) return json({ error: 'Invalid tournament result' }, 400);
          if (existing && existing.data.status === 'finished' && status === 'finished' && existing.data.result !== d.result
              && weekKey(existing.data.finishedAt || existing.date) !== weekKey(new Date()))
            return json({ error: 'This tournament is closed', locked: true }, 409);
          const entry = { id: e.id, type: 'tournament', date: existing ? existing.date : new Date(e.date).toISOString(),
            data: { name: String(d.name || 'Tournament').slice(0, 120), category: String(d.category || '').slice(0, 60), status,
                    result: status === 'finished' ? d.result : undefined,
                    lastRound: ROUNDS.includes(d.lastRound) ? d.lastRound : undefined,
                    finishedAt: status === 'finished' ? (existing && existing.data.finishedAt) || new Date().toISOString() : undefined },
            receivedAt: new Date().toISOString() };
          await s.setJSON(key, entry);
          return json({ ok: true, entry });
        }

        /* Player card: points are distributed, never typed. Validated here so nobody can set 99s. */
        if (e.type === 'cardinit' || e.type === 'cardweek') {
          const all = await listEntries(player);
          const data = {};
          if (e.type === 'cardinit') {
            if (e.id !== 'cardstart') return json({ error: 'Invalid card id' }, 400);
            if (all.some(x => x.type === 'cardweek')) return json({ error: 'The starting card is locked once weekly points have been added', locked: true }, 409);
            ATTRS.forEach(k => { data[k] = Number(e.data && e.data[k]); });
            const err = checkStart(data); if (err) return json({ error: err }, 400);
          } else {
            const wk = weekKey(new Date());
            if (e.id !== weekId(wk)) return json({ error: 'Only this week’s points can be changed', locked: true }, 409);
            const card = buildCard(all.filter(x => x.id !== e.id));
            if (!card) return json({ error: 'Create the starting card first' }, 409);
            const alloc = {};
            Object.entries((e.data && e.data.alloc) || {}).forEach(([k, v]) => { if (Number(v) > 0) alloc[k] = Number(v); });
            const err = checkWeek(alloc, card.budgetThisWeek); if (err) return json({ error: err }, 400);
            data.week = wk; data.alloc = alloc; data.note = String((e.data && e.data.note) || '').slice(0, 300);
          }
          const entry = { id: e.id, type: e.type, date: existing ? existing.date : new Date().toISOString(), data,
                          editedAt: existing ? new Date().toISOString() : undefined, receivedAt: new Date().toISOString() };
          await s.setJSON(key, entry);
          return json({ ok: true, entry });
        }

        /* Daily check-in: one per day. It can be edited the same day (Madrid time),
           and locks at midnight. */
        if (e.type === 'daily') {
          if (existing) {
            if (!body.edit) return json({ ok: true, duplicate: true });          // plain retry
            if (madridDay(existing.date) !== madridDay(new Date()))
              return json({ error: 'Locked: daily check-ins can only be edited the same day', locked: true }, 409);
            const updated = { ...existing, data: cleanData(e.data), editedAt: new Date().toISOString() };
            await s.setJSON(key, updated);
            return json({ ok: true, edited: true });
          }
          const today = madridDay(new Date());
          const other = (await listEntries(player)).find((x) => x.type === 'daily' && madridDay(x.date) === today);
          if (other) return json({ error: 'Already done today', existingId: other.id }, 409);
        } else if (existing) {
          return json({ ok: true, duplicate: true });                            // safe to retry
        }

        const entry = {
          id: e.id, type: e.type, date: new Date(e.date).toISOString(),
          data: cleanData(e.data),
          pre: /^[a-z0-9]{6,20}$/.test(String(e.pre || '')) ? e.pre : undefined,
          receivedAt: new Date().toISOString(),
        };
        await s.setJSON(key, entry);
        return json({ ok: true });
      }
    }

    /* Coach: everyone */
    if (path === '/api/coach' && req.method === 'GET') {
      const err = await check(req, context, { role: 'coach', pin: String(req.headers.get('x-pin') || '') });
      if (err) return err;
      const players = await Promise.all(playerIds().map(async (id) => ({
        id, entries: await listEntries(id), challenge: await store().get(`challenge/${id}`, { type: 'json' }),
      })));
      return json({ players });
    }

    /* A player sets a new PIN (needs the current one) */
    if (path === '/api/pin' && req.method === 'POST') {
      const player = String(req.headers.get('x-player') || '');
      const err = await check(req, context, { role: 'player', player, pin: String(req.headers.get('x-pin') || '') });
      if (err) return err;
      const body = await req.json().catch(() => ({}));
      const newPin = String(body.newPin || '');
      if (!/^\d{4}$/.test(newPin)) return json({ error: 'The PIN must be 4 digits' }, 400);
      const o = await overrides();
      o[player] = pinHash(player, newPin);
      await store().setJSON(PIN_KEY, o);
      return json({ ok: true });
    }

    /* Coach replies to an entry (reaction and/or short note). Empty both = remove. */
    if (path === '/api/reply' && req.method === 'POST') {
      const err = await check(req, context, { role: 'coach', pin: String(req.headers.get('x-pin') || '') });
      if (err) return err;
      const body = await req.json().catch(() => ({}));
      const player = String(body.player || ''), id = String(body.id || '');
      if (!playerIds().includes(player) || !/^[a-z0-9]{6,20}$/.test(id)) return json({ error: 'Invalid' }, 400);
      const key = `entries/${player}/${id}`, s = store();
      const entry = await s.get(key, { type: 'json' });
      if (!entry) return json({ error: 'Entry not found' }, 404);
      const reaction = REACTIONS.has(body.reaction) ? body.reaction : '';
      const text = String(body.text || '').trim().slice(0, 600);
      if (!reaction && !text) delete entry.reply;
      else entry.reply = { reaction, text, at: new Date().toISOString() };
      await s.setJSON(key, entry);
      return json({ ok: true, reply: entry.reply || null });
    }

    /* Coach sets (or clears) a player's challenge of the month */
    if (path === '/api/challenge' && req.method === 'POST') {
      const err = await check(req, context, { role: 'coach', pin: String(req.headers.get('x-pin') || '') });
      if (err) return err;
      const body = await req.json().catch(() => ({}));
      const player = String(body.player || '');
      if (!playerIds().includes(player)) return json({ error: 'Unknown player' }, 400);
      const text = String(body.text || '').trim().slice(0, 200);
      const value = text ? { text, set: new Date().toISOString() } : null;
      await store().setJSON(`challenge/${player}`, value);
      return json({ ok: true, challenge: value });
    }

    /* Coach's own rating of a player's game profile (shown next to the player's) */
    if (path === '/api/coach-entry' && req.method === 'POST') {
      const err = await check(req, context, { role: 'coach', pin: String(req.headers.get('x-pin') || '') });
      if (err) return err;
      const body = await req.json().catch(() => ({}));
      const player = String(body.player || ''), e = body.entry || {};
      if (!playerIds().includes(player) || !['coachprofile', 'cardbonus', 'matchaward'].includes(e.type) || !/^[a-z0-9]{6,20}$/.test(String(e.id))) return json({ error: 'Invalid' }, 400);
      let data = cleanData(e.data);
      if (e.type === 'cardbonus') {
        const wk = weekKey(new Date());
        if (e.id !== 'cb' + wk.replace(/-/g, '')) return json({ error: 'Bonus only for this week' }, 400);
        const pts = Number(e.data && e.data.points);
        if (!(pts >= 0 && pts <= CARD.BONUS_MAX) || Math.round(pts / CARD.STEP) * CARD.STEP !== pts) return json({ error: `Bonus between 0 and ${CARD.BONUS_MAX}` }, 400);
        data = { week: wk, points: pts, note: String((e.data && e.data.note) || '').slice(0, 300) };
      }
      if (e.type === 'matchaward') {
        const match = String((e.data && e.data.match) || '');
        if (e.id !== 'ma' + match) return json({ error: 'Invalid award' }, 400);
        data = { match, great: !!(e.data && e.data.great), void: !!(e.data && e.data.void) };
      }
      const entry = { id: e.id, type: e.type, date: new Date().toISOString(), data, receivedAt: new Date().toISOString() };
      await store().setJSON(`entries/${player}/${e.id}`, entry);
      return json({ ok: true, entry });
    }

    /* Coach wipes every entry, reply, card, challenge and custom PIN. Irreversible. */
    if (path === '/api/reset-all' && req.method === 'POST') {
      const err = await check(req, context, { role: 'coach', pin: String(req.headers.get('x-pin') || '') });
      if (err) return err;
      const body = await req.json().catch(() => ({}));
      if (body.confirm !== 'DELETE') return json({ error: 'Type DELETE to confirm' }, 400);
      const s = store();
      let deleted = 0;
      for (const prefix of ['entries/', 'challenge/', 'config/pin-overrides']) {
        const { blobs } = await s.list({ prefix });
        for (const b of blobs) { await s.delete(b.key); deleted++; }
      }
      await s.setJSON('config/reset-at', { at: new Date().toISOString() });  // tells every phone to clear its copy
      return json({ ok: true, deleted });
    }

    /* Coach resets a player's PIN back to the default */
    if (path === '/api/pin-reset' && req.method === 'POST') {
      const err = await check(req, context, { role: 'coach', pin: String(req.headers.get('x-pin') || '') });
      if (err) return err;
      const body = await req.json().catch(() => ({}));
      const player = String(body.player || '');
      if (!playerIds().includes(player)) return json({ error: 'Unknown player' }, 400);
      const o = await overrides();
      delete o[player];
      await store().setJSON(PIN_KEY, o);
      return json({ ok: true, defaultPin: pins()[player] });
    }

    return json({ error: 'Not found' }, 404);
  } catch (e) {
    console.error('journal api error', e);
    return json({ error: 'Server error' }, 500);
  }
};

export const config = { path: ['/api/login', '/api/entries', '/api/coach', '/api/pin', '/api/pin-reset', '/api/reply', '/api/challenge', '/api/coach-entry', '/api/reset-all'] };
