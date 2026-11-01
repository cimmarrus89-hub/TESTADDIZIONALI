/* Provider "Simulazione": una gara finta ma realistica per provare il sito prima della maratona
 * (stessi formati dei dati NYRR). L'orologio simulato parte dalle 08:30 di New York del giorno di gara. */
window.SimProvider = (function () {
  let seed = 20261101;
  function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
  function pick(a) { return a[Math.floor(rnd() * a.length)]; }

  const clock = { speed: 10, simAt: null, realAt: null };
  function now() { return clock.simAt + (Date.now() - clock.realAt) * clock.speed; }
  function setSpeed(s) { const t = now(); clock.simAt = t; clock.realAt = Date.now(); clock.speed = s; }
  function jump(minutes) { clock.simAt = now() + minutes * 60 * 1000; clock.realAt = Date.now(); }
  function setTime(timeStr) { clock.simAt = U.raceDayEpoch(timeStr); clock.realAt = Date.now(); }

  const FIRST_PRO_M = ['Benson', 'Evans', 'Abel', 'Tamirat', 'Geoffrey', 'Albert', 'Conner', 'Yuki', 'Tadesse', 'Daniel', 'Eliud', 'Sisay', 'Kenenisa', 'Joshua'];
  const FIRST_PRO_W = ['Hellen', 'Sharon', 'Sheila', 'Letesenbet', 'Peres', 'Sifan', 'Molly', 'Emily', 'Yalemzerf', 'Brigid', 'Tigist', 'Ruth', 'Vivian', 'Edna'];
  const FIRST_M = ['Marco', 'Luca', 'Giovanni', 'Andrea', 'Paolo', 'Francesco', 'Matteo', 'Stefano', 'Davide', 'Michele', 'John', 'Mike', 'Carlos', 'Pierre', 'Hans', 'Kenji', 'Diego'];
  const FIRST_W = ['Giulia', 'Francesca', 'Chiara', 'Sara', 'Elena', 'Valentina', 'Martina', 'Laura', 'Anna', 'Jessica', 'Sophie', 'Maria', 'Emma', 'Yuki', 'Olga'];
  const LAST_PRO = ['Kipruto', 'Chebet', 'Kipchoge', 'Tola', 'Kamworor', 'Korir', 'Mantz', 'Kawauchi', 'Abraham', 'Do Nascimento', 'Obiri', 'Lokedi', 'Chepkirui', 'Gidey', 'Jepchirchir', 'Hassan', 'Seidel', 'Sisson', 'Yehualaw', 'Kosgei'];
  const LAST_IT = ['Rossi', 'Bianchi', 'Cimmarrusto', 'Esposito', 'Russo', 'Ferrari', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Costa', 'Giordano', 'Mancini', 'Rizzo', 'Lombardi', 'Moretti', 'Barbieri', 'Fontana', 'Santoro', 'Mariani'];
  const LAST_INT = ['Smith', 'Johnson', 'Garcia', 'Müller', 'Dubois', 'Tanaka', 'Silva', 'Kowalski', 'Nielsen', 'O\'Brien', 'Martinez', 'Schmidt', 'Rodriguez', 'Lee', 'Walker'];
  const CITIES_IT = ['Milano', 'Roma', 'Torino', 'Bari', 'Napoli', 'Bologna', 'Firenze', 'Verona', 'Genova', 'Palermo', 'Lecce', 'Brescia'];
  const CITIES_INT = [['New York', 'USA'], ['Boston', 'USA'], ['London', 'GBR'], ['Paris', 'FRA'], ['Berlin', 'GER'], ['Madrid', 'ESP'], ['Tokyo', 'JPN'], ['Sao Paulo', 'BRA'], ['Toronto', 'CAN'], ['Mexico City', 'MEX'], ['Amsterdam', 'NED'], ['Sydney', 'AUS']];

  const SPLITS = [['5K', 5], ['10K', 10], ['15K', 15], ['20K', 20], ['HALF', 21.0975], ['25K', 25], ['30K', 30], ['35K', 35], ['40K', 40], ['FIN', 42.195]];
  const field = [];
  let nextId = 7000001;

  function makeRunner(kind, bib) {
    const gender = kind === 'proW' ? 'W' : kind === 'proM' ? 'M' : rnd() < 0.44 ? 'W' : 'M';
    const pro = kind === 'proM' || kind === 'proW';
    const italian = !pro && rnd() < 0.55;
    const firstName = pick(pro ? (gender === 'W' ? FIRST_PRO_W : FIRST_PRO_M) : (gender === 'W' ? FIRST_W : FIRST_M));
    const lastName = pro ? pick(LAST_PRO) : italian ? pick(LAST_IT) : pick(LAST_INT);
    const [city, country] = pro ? [pick(['Eldoret', 'Addis Abeba', 'Iten', 'Flagstaff', 'Boulder']), pick(['KEN', 'ETH', 'KEN', 'USA', 'ETH'])] : italian ? [pick(CITIES_IT), 'ITA'] : pick(CITIES_INT);
    let basePace; // sec/km
    if (kind === 'proM') basePace = 179 + rnd() * 16; else if (kind === 'proW') basePace = 199 + rnd() * 18; else basePace = 240 + rnd() * rnd() * 240;
    const waveId = pro ? kind : pick(['w1', 'w2', 'w3', 'w4', 'w5']);
    const corralDelay = pro ? 0 : Math.floor(rnd() * 240);
    const startEpoch = U.waveEpoch(waveId) + corralDelay * 1000;
    const fatigue = pro ? 0.98 + rnd() * 0.06 : 1.0 + rnd() * 0.14;
    const dnfAt = !pro && rnd() < 0.05 ? pick([15, 25, 30, 35]) : null;
    const splits = []; let t = 0, prevKm = 0;
    for (const [code, km] of SPLITS) {
      const seg = km - prevKm;
      let p = basePace * (0.97 + rnd() * 0.06);
      if (km <= 5) p *= 1.03; // ponte di Verrazzano in salita
      if (km > 24 && km <= 25) p *= 1.02; // Queensboro
      if (km > 30) p *= 1 + (fatigue - 1) * ((km - 30) / 12);
      if (km > 40) p *= pro ? 0.985 : 1.0;
      t += seg * p; prevKm = km;
      if (dnfAt != null && km > dnfAt) break;
      splits.push({ code, km, sec: Math.round(t) });
    }
    const r = { runnerId: nextId++, bib: String(bib), firstName, lastName, gender, age: pro ? 24 + Math.floor(rnd() * 12) : 20 + Math.floor(rnd() * 45), city, country, waveId, startEpoch, splits, dnf: dnfAt != null, team: pro ? pick(['adidas', 'Nike', 'NN Running', 'On']) : italian ? pick(['Road Runners Club Milano', 'Atletica Bari', 'Running Roma', null, null]) : null };
    return r;
  }
  function buildField() {
    for (let i = 1; i <= 14; i++) field.push(makeRunner('proM', i));
    for (let i = 101; i <= 114; i++) field.push(makeRunner('proW', i));
    const used = new Set();
    for (let i = 0; i < 46; i++) { let bib; do { bib = 1000 + Math.floor(rnd() * 59000); } while (used.has(bib)); used.add(bib); field.push(makeRunner('mass', bib)); }
    // un runner "di casa" facile da trovare
    const me = makeRunner('mass', 26210); me.firstName = 'Michele'; me.lastName = 'Cimmarrusto'; me.city = 'Bari'; me.country = 'ITA'; me.gender = 'M'; me.age = 37; me.waveId = 'w2'; me.startEpoch = U.waveEpoch('w2') + 95 * 1000; me.dnf = false;
    me.splits = SPLITS.map(([code, km], i) => ({ code, km, sec: Math.round(km * (285 + i * 2.5)) }));
    field.push(me);
  }

  const REPORT_DELAY = 45 * 1000; // uno split appare 45 s (simulati) dopo il passaggio
  function visibleSplits(r, t) { return r.splits.filter((s) => r.startEpoch + s.sec * 1000 + REPORT_DELAY <= t); }
  function finishSec(r, t) { const f = r.splits.find((s) => s.code === 'FIN'); return f && r.startEpoch + f.sec * 1000 + REPORT_DELAY <= t ? f.sec : null; }
  function placeOf(r, t, genderOnly) {
    const f = finishSec(r, t); if (f == null) return null;
    let place = 1;
    for (const o of field) { if (genderOnly && o.gender !== r.gender) continue; const of = finishSec(o, t); if (of != null && (of < f || (of === f && o.runnerId < r.runnerId))) place++; }
    return place;
  }
  function summary(r, t) {
    const f = finishSec(r, t);
    const gun = f != null ? f + Math.max(0, (r.startEpoch - U.waveEpoch('w1')) / 1000) : null;
    return { id: String(r.runnerId), bib: r.bib, firstName: r.firstName, lastName: r.lastName, gender: r.gender, age: r.age, city: r.city, country: r.country, overallPlace: placeOf(r, t, false), genderPlace: placeOf(r, t, true), overallTime: f != null ? U.fmtTime(f) : null, gunTime: gun != null ? U.fmtTime(gun) : null };
  }

  async function init() {
    if (!field.length) buildField();
    if (clock.simAt == null) { clock.simAt = U.raceDayEpoch('08:30'); clock.realAt = Date.now(); }
    return { eventCode: 'SIM2026', eventName: 'Simulazione · ' + U.RACE.name, found: true };
  }
  async function search(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const t = now();
    return field.filter((r) => r.bib === q || (r.firstName + ' ' + r.lastName).toLowerCase().includes(q) || (r.lastName + ' ' + r.firstName).toLowerCase().includes(q)).slice(0, 30).map((r) => summary(r, t));
  }
  async function details(runnerId) {
    const r = field.find((x) => String(x.runnerId) === String(runnerId)); if (!r) return null;
    const t = now();
    const vis = visibleSplits(r, t).filter((s) => s.code !== 'FIN');
    const f = finishSec(r, t);
    const raw = {
      runnerId: r.runnerId, bib: r.bib, teamName: r.team, iaaf: r.country,
      splitResults: vis.map((s) => ({ splitCode: s.code, time: U.fmtTime(s.sec), distance: s.km / U.MI, pace: null })),
      timeOverall: f != null ? U.fmtTime(f) : null, netTime: f != null ? U.fmtTime(f) : null,
      gunTime: f != null ? U.fmtTime(f + Math.max(0, (r.startEpoch - U.waveEpoch('w1')) / 1000)) : null,
      placeOverall: placeOf(r, t, false), placeGender: placeOf(r, t, true), placeAgeGroup: null, ageGroupFromTo: `${Math.floor(r.age / 5) * 5}-${Math.floor(r.age / 5) * 5 + 4}`,
    };
    return Stats.normalizeDetails(raw);
  }
  async function leaderCandidates() {
    const t = now();
    return { M: field.filter((r) => U.bibKind(r.bib) === 'proM').map((r) => summary(r, t)), W: field.filter((r) => U.bibKind(r.bib) === 'proW').map((r) => summary(r, t)) };
  }
  async function overview() { return { avgFinishTime: '4:32:25', totalMenFinishers: 31925, totalWomenFinishers: 27156 }; }

  return { id: 'sim', now, setSpeed, jump, setTime, get speed() { return clock.speed; }, init, search, details, leaderCandidates, overview, eventCode: 'SIM2026', eventName: 'Simulazione' };
})();
