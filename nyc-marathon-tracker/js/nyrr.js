/* Client per le API pubbliche dei risultati NYRR (results.nyrr.org).
 * Sono le stesse chiamate che fa il sito ufficiale; rispondono con CORS "*",
 * quindi funzionano anche da un sito statico. Se la chiamata diretta fallisce
 * (rete/CORS bloccati) si passa automaticamente al proxy locale /api/nyrr. */
window.NYRR = (function () {
  const DIRECT_BASE = 'https://rmsprodapi.nyrr.org/api/v2';
  const PROXY_BASE = '/api/nyrr';
  let base = DIRECT_BASE;
  let lastError = null;
  const cache = new Map();

  function cached(key, ttlMs, producer) {
    const hit = cache.get(key);
    const now = Date.now();
    if (hit && now - hit.t < ttlMs) return hit.p;
    const p = producer().catch((e) => { cache.delete(key); throw e; });
    cache.set(key, { t: now, p });
    return p;
  }

  async function rawPost(url, body, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' su ' + url.replace(base, ''));
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function post(path, body, opts) {
    const timeoutMs = (opts && opts.timeoutMs) || 20000;
    try {
      const out = await rawPost(base + path, body, timeoutMs);
      lastError = null;
      return out;
    } catch (e) {
      // Errore di rete/CORS sulla chiamata diretta: prova il proxy locale (solo se la pagina e' servita via http/https)
      const canProxy = base === DIRECT_BASE && /^https?:/.test(location.protocol);
      if (canProxy && (e instanceof TypeError || e.name === 'AbortError')) {
        try {
          const out = await rawPost(PROXY_BASE + path, body, timeoutMs);
          base = PROXY_BASE;
          lastError = null;
          return out;
        } catch (e2) {
          lastError = e2;
          throw e2;
        }
      }
      lastError = e;
      throw e;
    }
  }

  /* Cerca l'evento maratona di un anno (es. 2026) e restituisce eventCode e dettagli */
  async function findMarathonEvent(year) {
    // La ricerca generica "Marathon" è ordinata per data decrescente: l'edizione nuova compare in cima appena NYRR la pubblica.
    const data = await post('/events/search', { searchString: 'Marathon', pageIndex: 1, pageSize: 40 });
    const items = (data && data.items) || [];
    const found = items.find((i) => i.distanceUnitCode === 'MAR' && !i.isVirtual && /New York City Marathon/i.test(i.eventName || '') && !/Virtual|Training|Kids/i.test(i.eventName || '') && String(i.eventName).includes(String(year)));
    return found || null;
  }

  function eventDetails(eventCode) {
    return cached('ev:' + eventCode, 5 * 60 * 1000, async () => {
      const d = await post('/events/details', { eventCode });
      return d && d.eventDetails;
    });
  }

  function eventOverview(eventCode) {
    return cached('ov:' + eventCode, 60 * 1000, async () => {
      const d = await post('/events/overview', { eventCode });
      return d && d.eventOverview;
    });
  }

  /* Ricerca nei risultati di un evento (nome, cognome o pettorale). */
  async function searchFinishers(eventCode, { searchString = '', gender = null, sortColumn = 'overallPlace', sortDescending = false, pageIndex = 1, pageSize = 25 } = {}) {
    const d = await post('/runners/finishers-filter', {
      eventCode, searchString, gender, ageFrom: null, ageTo: null, sortColumn, sortDescending, pageIndex, pageSize,
    });
    return { total: (d && d.totalItems) || 0, items: (d && d.items) || [] };
  }

  /* Lookup diretto per pettorale */
  async function runnerByBib(eventCode, bib) {
    try {
      const d = await post('/runners/eventRunner', { eventCode, bib: String(bib) });
      return (d && d.finisher) || null;
    } catch (e) {
      if (/HTTP 4\d\d/.test(e.message)) return null;
      throw e;
    }
  }

  /* Dettaglio risultato con tutti i passaggi intermedi (splitResults) */
  function resultDetails(runnerId, ttlMs = 20000) {
    return cached('rd:' + runnerId, ttlMs, async () => {
      const d = await post('/runners/resultDetails', { runnerId: Number(runnerId) });
      return d && d.details;
    });
  }

  function runnerDetails(runnerId) {
    return cached('rn:' + runnerId, 10 * 60 * 1000, async () => {
      const d = await post('/runners/details', { runnerId: Number(runnerId) });
      return d && d.details;
    });
  }

  /* Ricerca globale per nome (tutti gli eventi NYRR): utile se il runner non compare ancora nei risultati dell'evento */
  async function globalSearch(searchString, pageSize = 25) {
    const d = await post('/runners/search', { searchString, pageIndex: 1, pageSize, sortColumn: null, sortDescending: false });
    return { total: (d && d.totalItems) || 0, items: (d && d.items) || [] };
  }

  function invalidate(prefix) {
    for (const k of Array.from(cache.keys())) if (!prefix || k.startsWith(prefix)) cache.delete(k);
  }

  return {
    findMarathonEvent, eventDetails, eventOverview, searchFinishers, runnerByBib, resultDetails, runnerDetails, globalSearch, invalidate,
    get base() { return base; },
    get lastError() { return lastError; },
    useProxy(flag) { base = flag ? PROXY_BASE : DIRECT_BASE; },
  };
})();
