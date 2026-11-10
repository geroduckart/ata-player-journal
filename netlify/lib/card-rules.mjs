/**
 * Player card rules, shared by the server and the app.
 *
 * Nobody types a number. Points are DISTRIBUTED:
 *  1. Starting card: every attribute starts at 30 and can go up to 99. The player has 540 points
 *     to share out. Average = 60 (OVR 60, silver). They must use all of them, so being great
 *     at something means being weaker at something else.
 *  2. Every week: 3 points to add to the shots that improved, +0 to +2 bonus from the coach.
 *     Steps of 0.5, max 2 points per attribute per week. Unused points carry over one week only
 *     (max 6 + this week's bonus), so it stays about "what improved lately".
 *     Above 80 everything costs double (1 point = +0.5), max 99.
 *  3. Match points (added to the week's budget, max +3 a week):
 *     win +0.5 · process goal kept +0.5 (win or lose) · coach "great match" +1 ·
 *     tournament: semi-final +0.5, final +1, champion +2. The coach can void a match.
 *     So losing while playing well (+1.5) beats winning without keeping the goal (+0.5).
 *  4. OVR = average of the 18 attributes, so every point is worth the same.
 *
 * Season maths (Oct-Jun, ~36 weeks): 3.5-5 points/week = 126-180 points
 * = +7 to +10 OVR. A 60 can reach gold (70) with a great season.
 */
export const CARD = {
  START: 30, START_BUDGET: 540, START_MAX: 99,
  WEEKLY: 3, BONUS_MAX: 2, PER_ATTR_WEEK: 2, STEP: 0.5, BANK: 6,
  HIGH: 80, CAP: 99,
  MATCH: { WIN: 0.5, PROCESS: 0.5, AWARD: 1, SEMI: 0.5, FINAL: 1, CHAMPION: 2, CAP_WEEK: 3 },
};
export const ROUNDS = ['Qualifying','Group stage','1st round','2nd round','Round of 16','Quarter-final','Semi-final','Final'];
export const T_RESULTS = ['Champion','Final','Semi-final','Quarter-final','Round of 16','2nd round','1st round','Group stage','Qualifying','Earlier round','Withdrew'];

/* Match + tournament points per week (capped). Returns { byWeek, items } */
export function matchPoints(entries) {
  const M = CARD.MATCH, byWeek = {}, items = [];
  const awards = {}; entries.filter(e => e.type === 'matchaward' && e.data && e.data.match).forEach(e => { awards[e.data.match] = e.data; });
  const add = (wk, pts, label, ref) => { if (!pts) return; byWeek[wk] = (byWeek[wk] || 0) + pts; items.push({ week: wk, pts, label, ref }); };
  entries.filter(e => e.type === 'post').forEach(e => {
    const a = awards[e.id] || {}; if (a.void) return;
    const wk = weekKey(e.date), d = e.data || {};
    if (d.result === 'Won') add(wk, M.WIN, 'Match won', e.id);
    if (d.process_ok === 'Yes') add(wk, M.PROCESS, 'Process goal kept', e.id);
    if (a.great) add(wk, M.AWARD, 'Great match (coach)', e.id);
  });
  entries.filter(e => e.type === 'tournament' && e.data && e.data.status === 'finished').forEach(e => {
    const r = e.data.result, pts = r === 'Champion' ? M.CHAMPION : r === 'Final' ? M.FINAL : r === 'Semi-final' ? M.SEMI : 0;
    add(weekKey(e.data.finishedAt || e.date), pts, `Tournament: ${r}`, e.id);
  });
  Object.keys(byWeek).forEach(wk => { byWeek[wk] = Math.min(M.CAP_WEEK, byWeek[wk]); });
  return { byWeek, items };
}
export const ATTRS = ['fh','bh','slice','return','fv','bv','overhead','drop','serve_flat','serve_slice','serve_kick',
  'speed','endurance','m_confidence','m_focus','m_fight','m_pressure','m_mistakes'];

/* Week = Monday to Sunday, Spain time. Key = the Monday as YYYY-MM-DD */
export function weekKey(d) {
  const day = new Date(d).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
  const t = new Date(day + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}
export const weekId = wk => 'cw' + wk.replace(/-/g, '');
const weeksBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / (7 * 864e5));

/* Adding p points to value v: double cost above 80, capped at 99 */
export function addPoints(v, p) {
  let out = v;
  for (let left = p; left > 1e-9; left -= CARD.STEP) out = Math.min(CARD.CAP, out + (out >= CARD.HIGH ? CARD.STEP / 2 : CARD.STEP));
  return out;
}

/* Rebuild the card from its events. now = current date (for the week budget). */
export function buildCard(entries, now = new Date()) {
  const init = entries.filter(e => e.type === 'cardinit').sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  if (!init) return null;
  const startWk = weekKey(init.date), curWk = weekKey(now);
  const weeks = entries.filter(e => e.type === 'cardweek' && e.data && e.data.week).sort((a, b) => a.data.week.localeCompare(b.data.week));
  const bonus = {}; entries.filter(e => e.type === 'cardbonus' && e.data && e.data.week).forEach(e => { bonus[e.data.week] = Math.min(CARD.BONUS_MAX, Math.max(0, Number(e.data.points) || 0)); });
  const mp = matchPoints(entries).byWeek;
  const values = {}; ATTRS.forEach(k => values[k] = Number(init.data[k]) || CARD.START);
  const history = [{ week: startWk, ovr: ovrOf(values) }];
  let spentBefore = 0, thisWeek = null;
  weeks.forEach(w => {
    const alloc = w.data.alloc || {};
    if (w.data.week === curWk) thisWeek = w;
    else spentBefore += sumAlloc(alloc);
    ATTRS.forEach(k => { if (alloc[k]) values[k] = addPoints(values[k], alloc[k]); });
    history.push({ week: w.data.week, ovr: ovrOf(values) });
  });
  // Budget earned from the starting week to this week, minus what earlier weeks used
  let earned = 0;
  for (let i = 0; i <= Math.max(0, weeksBetween(startWk, curWk)); i++) {
    const d = new Date(startWk + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + i * 7);
    const wk = d.toISOString().slice(0, 10);
    earned += CARD.WEEKLY + (bonus[wk] || 0) + (mp[wk] || 0);
  }
  const usedNow = thisWeek ? sumAlloc(thisWeek.data.alloc) : 0;
  const budget = Math.min(Math.max(0, earned - spentBefore), CARD.BANK + (bonus[curWk] || 0) + (mp[curWk] || 0));
  return {
    init, values, ovr: ovrOf(values), history, curWk, startWk, thisWeek,
    budgetThisWeek: budget,                                      // what can be spent this week in total
    left: Math.max(0, budget - usedNow),                         // still unspent
    bonusThisWeek: bonus[curWk] || 0, matchThisWeek: mp[curWk] || 0, canRedoStart: weeks.length === 0,
  };
}
export const sumAlloc = a => Object.values(a || {}).reduce((s, v) => s + (Number(v) || 0), 0);
export const ovrOf = v => ATTRS.reduce((s, k) => s + (Number(v[k]) || 0), 0) / ATTRS.length;

/* Validation (server side). Returns an error string or null. */
export function checkStart(data) {
  let extra = 0;
  for (const k of ATTRS) {
    const v = data[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < CARD.START || v > CARD.START_MAX) return `Each attribute must be a whole number between ${CARD.START} and ${CARD.START_MAX}`;
    extra += v - CARD.START;
  }
  if (extra !== CARD.START_BUDGET) return `Exactly ${CARD.START_BUDGET} points must be shared out (got ${extra})`;
  return null;
}
export function checkWeek(alloc, available) {
  let total = 0;
  for (const [k, v] of Object.entries(alloc || {})) {
    if (!ATTRS.includes(k)) return 'Unknown attribute';
    if (typeof v !== 'number' || v < 0 || v > CARD.PER_ATTR_WEEK || Math.round(v / CARD.STEP) * CARD.STEP !== v) return `Max ${CARD.PER_ATTR_WEEK} points per attribute per week, in steps of ${CARD.STEP}`;
    total += v;
  }
  if (total > available + 1e-9) return `Only ${available} points available this week`;
  return null;
}
