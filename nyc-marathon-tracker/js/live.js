/* Provider "Live": dati reali dalle API dei risultati NYRR. */
window.LiveProvider = (function () {
  const state = { eventCode: null, eventName: null, startDateTime: null, elitePool: { M: [], W: [] }, eliteQueue: [], eliteQueueAt: 0, eliteMissing: new Set() };

  async function init(settings) {
    const override = (settings.eventCode || '').trim();
    let ev = null;
    if (override) {
      state.eventCode = override;
      try { ev = await NYRR.eventDetails(override); } catch (e) { /* codice forzato: proseguo comunque */ }
    } else {
      try { ev = await NYRR.findMarathonEvent(U.RACE.year); } catch (e) { /* rete */ }
      state.eventCode = ev ? ev.eventCode : 'M' + U.RACE.year;
    }
    state.eventName = ev ? ev.eventName : U.RACE.name;
    state.startDateTime = ev ? ev.startDateTime : null;
    state.found = !!ev;
    return { eventCode: state.eventCode, eventName: state.eventName, found: state.found };
  }

  function normalizeSummary(it) {
    return {
      id: String(it.runnerId), bib: String(it.bib || ''), firstName: it.firstName || '', lastName: it.lastName || '',
      gender: it.gender || '', age: it.age ?? null, city: it.city || '', country: it.iaaf || it.iaafCode || it.countryCode || '',
      overallPlace: it.overallPlace ?? null, genderPlace: it.genderPlace ?? null, overallTime: it.overallTime || null, gunTime: it.gunTime || null,
    };
  }

  async function search(query) {
    const q = String(query || '').trim();
    if (!q) return [];
    const map = new Map();
    const isBib = /^[A-Za-z]?\d{1,6}$/.test(q);
    if (isBib) {
      const r = await NYRR.runnerByBib(state.eventCode, q).catch(() => null);
      if (r && r.runnerId) map.set(String(r.runnerId), normalizeSummary(r));
    }
    const res = await NYRR.searchFinishers(state.eventCode, { searchString: q, pageSize: 30 }).catch(() => ({ items: [] }));
    for (const it of res.items) if (!map.has(String(it.runnerId))) map.set(String(it.runnerId), normalizeSummary(it));
    if (!map.size && !isBib) {
      // Fallback: ricerca globale filtrata sull'evento (utile quando i risultati dell'evento non sono ancora pubblicati)
      const g = await NYRR.globalSearch(q, 40).catch(() => ({ items: [] }));
      for (const it of g.items) if (String(it.eventCode || '').toLowerCase() === state.eventCode.toLowerCase()) map.set(String(it.runnerId), normalizeSummary(it));
    }
    return Array.from(map.values());
  }

  async function details(runnerId, fresh) {
    if (fresh) NYRR.invalidate('rd:' + runnerId);
    const raw = await NYRR.resultDetails(runnerId, 15000);
    return Stats.normalizeDetails(raw);
  }

  /* Candidati leader: primi classificati per genere + pettorali élite (1-N uomini, 101-100+N donne). */
  async function leaderCandidates(poolSize) {
    const out = { M: new Map(), W: new Map() };
    for (const g of ['M', 'W']) {
      const res = await NYRR.searchFinishers(state.eventCode, { gender: g, pageSize: 12 }).catch(() => ({ items: [] }));
      for (const it of res.items) out[g].set(String(it.runnerId), normalizeSummary(it));
    }
    const now = Date.now();
    if (!state.eliteQueue.length && now - state.eliteQueueAt > 10 * 60 * 1000) {
      // (ri)costruisce la coda dei pettorali élite da controllare: max 20 lookup per ciclo
      state.eliteQueueAt = now;
      const known = new Set(state.elitePool.M.concat(state.elitePool.W).map((r) => r.bib));
      for (let i = 1; i <= poolSize; i++) if (!known.has(String(i))) state.eliteQueue.push(String(i));
      for (let i = 101; i <= 100 + poolSize; i++) if (!known.has(String(i))) state.eliteQueue.push(String(i));
    }
    let budget = 20;
    while (state.eliteQueue.length && budget-- > 0) {
      const bib = state.eliteQueue.shift();
      const r = await NYRR.runnerByBib(state.eventCode, bib).catch(() => null);
      if (r && r.runnerId) {
        const s = normalizeSummary(r);
        const g = s.gender === 'W' ? 'W' : 'M';
        if (!state.elitePool[g].some((x) => x.id === s.id)) state.elitePool[g].push(s);
        state.eliteMissing.delete(bib);
      } else state.eliteMissing.add(bib);
      await new Promise((ok) => setTimeout(ok, 100));
    }
    for (const g of ['M', 'W']) for (const s of state.elitePool[g]) if (!out[g].has(s.id)) out[g].set(s.id, s);
    return { M: Array.from(out.M.values()), W: Array.from(out.W.values()) };
  }

  async function overview() { return NYRR.eventOverview(state.eventCode).catch(() => null); }

  return { id: 'live', now: () => Date.now(), init, search, details, leaderCandidates, overview, get eventCode() { return state.eventCode; }, get eventName() { return state.eventName; } };
})();
