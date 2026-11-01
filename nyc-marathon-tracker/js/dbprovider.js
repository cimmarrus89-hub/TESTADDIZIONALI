/* Provider "ponte dati": la pagina pubblicata su claude.ai non può chiamare le API NYRR,
 * quindi legge un feed aggiornato dal database della pagina (scritto da Claude durante la gara)
 * e invia lì le richieste di ricerca e la lista dei runner da seguire. */
window.DbProvider = (function () {
  let db = null, feed = null, feedAt = 0, unsub = null;
  const listeners = new Set();
  function notify() { for (const fn of listeners) { try { fn(feed); } catch (e) { /* ignore */ } } }

  async function init() {
    if (!db) {
      db = window.claude && typeof claude.use === 'function' ? await claude.use('db') : null;
      if (!db) throw new Error('Database della pagina non disponibile in questa vista');
      unsub = db.collection('feed').orderBy('at', 'desc').limit(1).onSnapshot((snap) => {
        if (snap.empty) return;
        const d = snap.docs[0].data();
        if (!feed || (d.at || 0) >= (feed.at || 0)) { feed = d; feedAt = Date.now(); notify(); }
      }, (e) => { console.error('feed', e); });
      await new Promise((res) => { const t = setTimeout(res, 10000); const fn = () => { clearTimeout(t); listeners.delete(fn); res(); }; listeners.add(fn); });
    }
    const ev = (feed && feed.event) || {};
    return { eventCode: ev.eventCode || 'M' + U.RACE.year, eventName: ev.eventName || U.RACE.name, found: !!ev.found, relay: true };
  }

  function summaryOf(entry) { return entry && entry.summary ? entry.summary : null; }
  function localMatches(q) {
    const out = [];
    if (!feed || !feed.runners) return out;
    const lq = q.toLowerCase();
    for (const id of Object.keys(feed.runners)) {
      const s = summaryOf(feed.runners[id]); if (!s) continue;
      if (s.bib === q || `${s.firstName} ${s.lastName}`.toLowerCase().includes(lq) || `${s.lastName} ${s.firstName}`.toLowerCase().includes(lq)) out.push(s);
    }
    return out;
  }

  /* La ricerca passa dal ponte: scrive la richiesta e aspetta il feed con la risposta (fino a 150 s). */
  async function search(query) {
    const q = String(query || '').trim(); if (!q) return [];
    if (feed && feed.search && feed.search.query && feed.search.query.toLowerCase() === q.toLowerCase()) return feed.search.items || [];
    const local = localMatches(q);
    const reqAt = Date.now();
    try { await db.doc('requests/search').set({ query: q, at: reqAt }); } catch (e) { if (local.length) return local; throw new Error('Richiesta non inviata: ' + (e && e.message)); }
    const items = await new Promise((res) => {
      const t = setTimeout(() => { listeners.delete(fn); res(null); }, 150000);
      const fn = (f) => { if (f && f.search && f.search.query && f.search.query.toLowerCase() === q.toLowerCase() && (f.search.at || 0) >= reqAt - 60000) { clearTimeout(t); listeners.delete(fn); res(f.search.items || []); } };
      listeners.add(fn);
    });
    if (items == null) { if (local.length) return local; throw new Error('Nessuna risposta dal ponte dati entro 2 minuti e mezzo: riprova tra poco'); }
    return items;
  }

  async function details(runnerId) {
    const entry = feed && feed.runners && feed.runners[String(runnerId)];
    if (!entry) return null;
    return Stats.normalizeDetails(entry.details || null);
  }
  function trackHints(runnerId) {
    const entry = feed && feed.runners && feed.runners[String(runnerId)];
    return entry ? { firstSeen: entry.firstSeen || {}, baseline: entry.baseline || [] } : null;
  }
  async function leaderCandidates() {
    const out = { M: [], W: [] };
    if (!feed || !feed.leaders) return out;
    for (const g of ['M', 'W']) for (const id of feed.leaders[g] || []) { const s = summaryOf(feed.runners && feed.runners[id]); if (s) out[g].push(s); }
    return out;
  }
  async function overview() { return (feed && feed.overview) || null; }
  async function setFollowed(list) {
    if (!db) return;
    try { await db.doc('requests/follow').set({ ids: list.map((r) => r.id), runners: list.map((r) => ({ id: r.id, bib: r.bib, firstName: r.firstName, lastName: r.lastName, gender: r.gender })), at: Date.now() }); } catch (e) { console.error('follow', e); }
  }
  function onUpdate(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  return { id: 'relay', asyncSearch: true, now: () => Date.now(), init, search, details, trackHints, leaderCandidates, overview, setFollowed, onUpdate, get feed() { return feed; }, get feedAt() { return feedAt; }, get eventCode() { return (feed && feed.event && feed.event.eventCode) || 'M' + U.RACE.year; } };
})();
