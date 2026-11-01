/* Controller principale: stato, polling, mappa e rendering. */
(function () {
  const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  const ARTIFACT = !!window.ARTIFACT_MODE; // copia dimostrativa pubblicata su claude.ai: niente chiamate esterne
  const $ = (sel) => document.querySelector(sel);
  const KM_TOTAL = U.RACE.distanceKm;

  const S = {
    mode: U.load('nyc.mode', 'live'),
    settings: Object.assign({ refreshSec: 45, eventCode: '', elitePool: 30, showMiles: false, follow: true, showLeaders: true, showGhost: false }, U.load('nyc.settings', {})),
    followed: [], selectedId: null, track: U.load('nyc.track', {}),
    data: {}, candidates: { M: [], W: [] }, candData: {}, candidatesAt: 0, leaders: { M: null, W: null },
    provider: null, event: null, overview: null, lastUpdate: null, nextUpdate: null, timer: null, busy: false, error: null, searching: false,
    map: null, layers: {}, runnerMarkers: {}, leaderMarkers: {}, ghostMarkers: {}, mileLayer: null, splitLayer: null,
  };
  const followedKey = () => 'nyc.followed.' + S.mode;
  const persist = () => { U.save(followedKey(), S.followed); U.save('nyc.selected.' + S.mode, S.selectedId); U.save('nyc.track', S.track); U.save('nyc.settings', S.settings); U.save('nyc.mode', S.mode); };
  const now = () => (S.provider ? S.provider.now() : Date.now());
  const runnerName = (r) => `${r.firstName} ${r.lastName}`.trim() || `Pettorale ${r.bib}`;
  const genderKey = (r) => (r.gender === 'W' || r.gender === 'F' ? 'W' : 'M');
  const arrived = (r) => (genderKey(r) === 'W' ? 'arrivata' : 'arrivato');

  /* ---------- avvio ---------- */
  async function boot() {
    bindUI();
    if (ARTIFACT) { if (S.mode === 'live') S.mode = 'relay'; $('#artifact-note').classList.remove('hidden'); }
    try { await Course.load('data/course.json'); } catch (e) { setStatus('Impossibile caricare il percorso: ' + e.message, true); }
    initMap();
    setInterval(tick, 1000);
    await setMode(S.mode, true);
  }

  async function setMode(mode, first) {
    if (S.timer) { clearTimeout(S.timer); S.timer = null; }
    S.gen = (S.gen || 0) + 1; S.busy = false; S.tickCount = 0;
    S.mode = mode; U.save('nyc.mode', mode);
    S.provider = mode === 'sim' ? SimProvider : mode === 'relay' ? DbProvider : LiveProvider;
    if (S.unsubFeed) { S.unsubFeed(); S.unsubFeed = null; }
    S.followed = U.load(followedKey(), []);
    S.selectedId = U.load('nyc.selected.' + mode, null);
    S.data = {}; S.candidates = { M: [], W: [] }; S.candData = {}; S.candidatesAt = 0; S.leaders = { M: null, W: null }; S.error = null; S.lastUpdate = null;
    document.body.dataset.mode = mode;
    $('#mode-live').classList.toggle('active', mode === 'live' || mode === 'relay');
    $('#mode-sim').classList.toggle('active', mode === 'sim');
    $('#sim-controls').classList.toggle('hidden', mode !== 'sim');
    $('#search-results').innerHTML = '';
    setStatus(mode === 'sim' ? 'Avvio della simulazione…' : mode === 'relay' ? 'Collegamento al ponte dati…' : 'Collegamento ai risultati NYRR…');
    try {
      S.event = await S.provider.init(S.settings);
      S.overview = S.event.found ? await S.provider.overview() : null;
      if (mode === 'live') {
        setStatus(S.event.found ? `Evento trovato: ${S.event.eventName} (${S.event.eventCode})` : `Evento ${S.event.eventCode} non ancora pubblicato da NYRR: riprovo a ogni aggiornamento. Puoi forzare il codice nelle impostazioni.`, !S.event.found);
      }
      if (mode === 'relay') {
        S.unsubFeed = DbProvider.onUpdate(() => { if (S.mode === 'relay') { if (S.timer) clearTimeout(S.timer); refresh(); } });
        if (S.followed.length) DbProvider.setFollowed(S.followed);
      }
    } catch (e) {
      S.event = { eventCode: 'M' + U.RACE.year, eventName: U.RACE.name, found: false };
      if (mode === 'relay') { setStatus('Ponte dati non disponibile: ' + e.message + '. Passo alla simulazione.', true); return setMode('sim'); }
      setStatus('API NYRR non raggiungibili: ' + e.message, true);
    }
    $('#event-name').textContent = S.event.eventName || U.RACE.name;
    renderAll();
    refresh();
  }

  /* ---------- polling ---------- */
  async function refresh() {
    if (S.busy) return; S.busy = true; $('#btn-refresh').classList.add('spin');
    const gen = S.gen;
    try {
      if ((S.mode === 'live' || S.mode === 'relay') && !S.event.found) {
        try { const ev = await S.provider.init(S.settings); if (gen !== S.gen) return; S.event = ev; if (ev.found) $('#event-name').textContent = ev.eventName; } catch (e) { /* riprovo dopo */ }
      }
      for (const r of S.followed) { await updateRunner(r); if (gen !== S.gen) return; }
      await updateLeaders(gen);
      if (gen !== S.gen) return;
      S.lastUpdate = Date.now(); S.error = null;
    } catch (e) {
      if (gen === S.gen) S.error = e.message || String(e);
    } finally {
      if (gen !== S.gen) { $('#btn-refresh').classList.remove('spin'); return; }
      S.busy = false; $('#btn-refresh').classList.remove('spin');
      renderAll();
      const sec = Math.max(15, Number(S.settings.refreshSec) || 45);
      S.nextUpdate = Date.now() + sec * 1000;
      if (S.timer) clearTimeout(S.timer);
      S.timer = setTimeout(refresh, sec * 1000);
    }
  }

  async function updateRunner(r) {
    let details = null;
    try { details = await S.provider.details(r.id, true); } catch (e) { S.error = 'Dettaglio non disponibile per ' + runnerName(r) + ': ' + e.message; }
    const tr = S.track[r.id] || (S.track[r.id] = { baseline: null, firstSeen: {}, wave: 'auto' });
    const codes = details ? details.splits.map((s) => s.code) : [];
    if (tr.baseline == null) tr.baseline = codes.slice();
    const t = now();
    for (const c of codes) if (!tr.firstSeen[c]) tr.firstSeen[c] = t;
    if (S.provider.trackHints) { // il ponte dati ha visto i passaggi prima della pagina: usa i suoi orari
      const h = S.provider.trackHints(r.id);
      if (h) { for (const c of Object.keys(h.firstSeen)) if (!tr.firstSeen[c] || h.firstSeen[c] < tr.firstSeen[c]) tr.firstSeen[c] = h.firstSeen[c]; tr.baseline = h.baseline; }
    }
    const start = Stats.resolveStart(r, details, tr);
    S.data[r.id] = { details, start, prog: Stats.progress(r, details, start, t), fetchedAt: Date.now() };
    persist();
  }

  async function updateLeaders(gen) {
    const t = Date.now();
    if (S.mode === 'live' && !S.event.found) return; // evento non ancora pubblicato: inutile interrogare i leader
    if (S.mode === 'relay') S.candidatesAt = 0; // il feed cambia a ogni aggiornamento
    if (t - S.candidatesAt > 5 * 60 * 1000 || (!S.candidates.M.length && !S.candidates.W.length)) {
      try { const c = await S.provider.leaderCandidates(Number(S.settings.elitePool) || 30); if (gen !== S.gen) return; S.candidates = c; S.candidatesAt = t; } catch (e) { S.error = 'Leader non disponibili: ' + e.message; }
    }
    for (const g of ['M', 'W']) {
      if (gen !== S.gen) return;
      const list = S.candidates[g].slice();
      // priorità a chi è più avanti (dati già noti), poi gli altri a rotazione
      list.sort((a, b) => (kmOf(b.id) - kmOf(a.id)));
      const batch = list.slice(0, 8).concat(list.slice(8).filter(() => Math.random() < 0.25).slice(0, 4));
      for (const c of batch) {
        try {
          const details = await S.provider.details(c.id, true);
          if (gen !== S.gen) return;
          const start = Stats.resolveStart(c, details, {});
          S.candData[c.id] = { runner: c, details, start, prog: Stats.progress(c, details, start, now()) };
        } catch (e) { /* salto */ }
      }
      computeLeader(g);
    }
  }
  function kmOf(id) { const d = S.candData[id]; return d ? d.prog.km : -1; }
  function computeLeader(g) {
    let best = null;
    for (const c of S.candidates[g]) {
      const d = S.candData[c.id]; if (!d || !d.details) continue;
      d.prog = Stats.progress(c, d.details, d.start, now());
      if (!best) { best = d; continue; }
      const a = d.prog, b = best.prog;
      if (a.status === 'finished' && b.status === 'finished') { if (d.details.finishSec < best.details.finishSec) best = d; }
      else if (a.status === 'finished') best = d;
      else if (b.status !== 'finished' && a.km > b.km) best = d;
    }
    S.leaders[g] = best;
  }
  function rankedCandidates(g) {
    return S.candidates[g].map((c) => S.candData[c.id]).filter((d) => d && d.details).sort((x, y) => {
      if (x.prog.status === 'finished' && y.prog.status === 'finished') return x.details.finishSec - y.details.finishSec;
      if (x.prog.status === 'finished') return -1; if (y.prog.status === 'finished') return 1;
      return y.prog.km - x.prog.km;
    });
  }

  /* ---------- tick ogni secondo: orologi, posizioni interpolate ---------- */
  function tick() {
    const t = now();
    $('#clock-ny').textContent = U.fmtClock(t, U.RACE.tz);
    $('#clock-it').textContent = U.fmtClock(t, U.RACE.tzHome);
    $('#race-phase').textContent = racePhase(t);
    if (S.nextUpdate) { const left = Math.max(0, Math.round((S.nextUpdate - Date.now()) / 1000)); $('#status-timer').textContent = S.busy ? 'aggiornamento…' : `prossimo aggiornamento tra ${left}s`; }
    for (const r of S.followed) { const d = S.data[r.id]; if (d) d.prog = Stats.progress(r, d.details, d.start, t); }
    for (const g of ['M', 'W']) computeLeader(g);
    updateMarkers();
    if (S.mode === 'sim') $('#sim-time').textContent = U.fmtClock(t, U.RACE.tz, false) + ' NY';
    S.tickCount = (S.tickCount || 0) + 1;
    if (S.tickCount % 5 === 0) { renderFollowed(); renderLeaders(); renderDetailLight(); }
  }
  function racePhase(t) {
    const waves = U.RACE.waves.map((w) => ({ ...w, epoch: U.waveEpoch(w.id) }));
    const started = waves.filter((w) => w.epoch <= t);
    if (!started.length) { const w = waves[0]; return `Via alle ${w.time} NY (${U.fmtClock(w.epoch, U.RACE.tzHome, false)} IT)`; }
    if (started.length === waves.length) return t - waves[waves.length - 1].epoch > 7 * 3600 * 1000 ? 'Gara conclusa' : 'Tutte le onde sono partite';
    const next = waves[started.length];
    return `Partita: ${started[started.length - 1].label} · prossima ${next.label} alle ${next.time} NY`;
  }

  /* ---------- UI ---------- */
  function bindUI() {
    $('#mode-live').onclick = () => setMode('live');
    $('#mode-sim').onclick = () => setMode('sim');
    $('#btn-refresh').onclick = () => { if (S.timer) clearTimeout(S.timer); refresh(); };
    $('#btn-settings').onclick = () => openSettings();
    $('#settings-close').onclick = () => $('#settings-modal').classList.add('hidden');
    $('#settings-save').onclick = saveSettings;
    $('#settings-reset').onclick = (e) => { const b = e.currentTarget; if (b.dataset.armed) { try { localStorage.clear(); } catch (err) { /* ignore */ } location.reload(); } else { b.dataset.armed = '1'; b.textContent = 'Confermi? Cancella tutto'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Azzera dati salvati'; }, 4000); } };
    $('#search-form').onsubmit = (e) => { e.preventDefault(); doSearch($('#search-input').value); };
    $('#search-input').addEventListener('input', debounce(() => { const v = $('#search-input').value.trim(); if (v.length >= 3) doSearch(v); }, 500));
    for (const id of ['opt-follow', 'opt-miles', 'opt-leaders', 'opt-record']) {
      const key = { 'opt-follow': 'follow', 'opt-miles': 'showMiles', 'opt-leaders': 'showLeaders', 'opt-record': 'showGhost' }[id];
      $('#' + id).checked = !!S.settings[key];
      $('#' + id).onchange = (e) => { S.settings[key] = e.target.checked; persist(); applyMapOptions(); };
    }
    document.querySelectorAll('.sim-speed').forEach((b) => { b.onclick = () => { SimProvider.setSpeed(Number(b.dataset.speed)); document.querySelectorAll('.sim-speed').forEach((x) => x.classList.toggle('active', x === b)); }; });
    document.querySelectorAll('.sim-jump').forEach((b) => { b.onclick = () => { SimProvider.jump(Number(b.dataset.min)); refresh(); }; });
    $('#sim-set').onclick = () => { const v = $('#sim-timeinput').value; if (/^\d{2}:\d{2}$/.test(v)) { SimProvider.setTime(v); refresh(); } };
    document.querySelectorAll('.tabbar button').forEach((b) => { b.onclick = () => { document.querySelector('.layout').dataset.tab = b.dataset.tab; document.querySelectorAll('.tabbar button').forEach((x) => x.classList.toggle('active', x === b)); if (b.dataset.tab === 'map') setTimeout(() => S.map && S.map.invalidateSize(), 50); }; });
    $('#help-toggle').onclick = () => $('#help').classList.toggle('hidden');
  }
  function debounce(fn, ms) { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; }

  async function doSearch(q) {
    q = String(q || '').trim(); if (!q) return;
    const box = $('#search-results'); box.innerHTML = S.provider.asyncSearch ? '<li class="muted">Richiesta inviata al ponte dati: la risposta arriva entro un minuto o due, lascia aperta la pagina…</li>' : '<li class="muted">Ricerca in corso…</li>';
    try {
      const items = await S.provider.search(q);
      if (!items.length) { box.innerHTML = `<li class="muted">Nessun risultato per “${U.esc(q)}”. ${S.mode === 'live' ? 'Prima del via i risultati potrebbero non essere ancora pubblicati: riprova dopo la partenza, oppure controlla il pettorale.' : ''}</li>`; return; }
      box.innerHTML = items.map((r) => {
        const isF = S.followed.some((f) => f.id === r.id);
        return `<li class="result"><div class="r-main"><b>${U.esc(runnerName(r))}</b> <span class="bib">#${U.esc(r.bib)}</span><div class="r-sub">${U.flag(r.country)} ${U.esc(r.city || '')}${r.age ? ` · ${r.age} anni` : ''}${r.gender ? ` · ${r.gender === 'W' ? 'F' : r.gender}` : ''}${r.overallTime ? ` · ${arrived(r)} in ${U.esc(r.overallTime)}` : ''}</div></div><button class="btn small ${isF ? 'ghost' : 'primary'}" data-id="${U.esc(r.id)}" ${isF ? 'disabled' : ''}>${isF ? 'Seguito ✓' : 'Segui'}</button></li>`;
      }).join('');
      box.querySelectorAll('button[data-id]').forEach((b) => { b.onclick = () => follow(items.find((r) => r.id === b.dataset.id)); });
    } catch (e) { box.innerHTML = `<li class="muted err">Errore nella ricerca: ${U.esc(e.message)}</li>`; }
  }

  async function follow(r) {
    if (!r || S.followed.some((f) => f.id === r.id)) return;
    const used = new Set(S.followed.map((f) => f.color));
    const color = COLORS.find((c) => !used.has(c)) || COLORS[S.followed.length % COLORS.length];
    const f = { id: r.id, bib: r.bib, firstName: r.firstName, lastName: r.lastName, gender: r.gender, age: r.age, country: r.country, city: r.city, color };
    S.followed.push(f); S.selectedId = f.id; persist();
    if (S.provider.setFollowed) S.provider.setFollowed(S.followed);
    renderFollowed(); doSearch($('#search-input').value);
    await updateRunner(f);
    renderAll(); focusRunner(f.id, true);
    if (window.innerWidth < 900) document.querySelector('.tabbar button[data-tab="runner"]').click();
  }
  function unfollow(id) {
    S.followed = S.followed.filter((f) => f.id !== id); delete S.data[id];
    if (S.provider.setFollowed) S.provider.setFollowed(S.followed);
    if (S.runnerMarkers[id]) { S.map.removeLayer(S.runnerMarkers[id]); delete S.runnerMarkers[id]; }
    if (S.selectedId === id) S.selectedId = S.followed.length ? S.followed[0].id : null;
    persist(); renderAll();
  }
  function select(id) { S.selectedId = id; persist(); renderAll(); focusRunner(id, true); }

  function openSettings() {
    $('#set-refresh').value = S.settings.refreshSec; $('#set-event').value = S.settings.eventCode || ''; $('#set-pool').value = S.settings.elitePool;
    $('#set-apibase').textContent = NYRR.base; $('#settings-modal').classList.remove('hidden');
  }
  function saveSettings() {
    S.settings.refreshSec = Math.max(15, Number($('#set-refresh').value) || 45);
    const ev = $('#set-event').value.trim(); const changed = ev !== (S.settings.eventCode || '');
    S.settings.eventCode = ev; S.settings.elitePool = Math.min(60, Math.max(5, Number($('#set-pool').value) || 30));
    persist(); $('#settings-modal').classList.add('hidden');
    if (changed && S.mode === 'live') setMode('live'); else refresh();
  }

  /* ---------- rendering ---------- */
  function renderAll() { renderStatus(); renderFollowed(); renderLeaders(); renderDetail(); updateMarkers(); }
  function setStatus(text, isErr) { $('#status-text').textContent = text; $('#status-bar').classList.toggle('err', !!isErr); }
  function renderStatus() {
    if (S.error) return setStatus('Problema nell\'aggiornamento: ' + S.error, true);
    if (!S.lastUpdate) return;
    if (S.mode === 'relay') {
      const f = DbProvider.feed;
      if (!f) return setStatus('In attesa del primo aggiornamento dal ponte dati…', true);
      const age = (Date.now() - (f.at || 0)) / 60000;
      const stale = age > 4;
      return setStatus(`${f.event && f.event.found ? 'Dati NYRR via ponte' : 'Ponte dati (evento NYRR non ancora pubblicato)'} · aggiornato alle ${U.fmtClock(f.at, U.RACE.tzHome)}${stale ? ` · fermo da ${Math.round(age)} min` : ''}${f.note ? ' · ' + f.note : ''}`, stale);
    }
    const src = S.mode === 'sim' ? 'Simulazione' : `Dati NYRR (${S.event.eventCode})`;
    setStatus(`${src} · aggiornato alle ${U.fmtClock(S.lastUpdate, U.RACE.tzHome)}`, false);
  }

  function statusLine(r, d) {
    if (!d) return 'Caricamento…';
    const p = d.prog;
    if (p.status === 'finished') return `🏅 ${arrived(r)[0].toUpperCase() + arrived(r).slice(1)} in ${U.fmtTime(d.details.finishSec)}`;
    if (p.status === 'pre') return `⏳ Al via alle ${U.fmtClock(p.startEpoch, U.RACE.tz, false)} NY (${U.fmtClock(p.startEpoch, U.RACE.tzHome, false)} IT)`;
    if (p.status === 'started') return d.start.source === 'unknown' ? `🏃 Onda sconosciuta: in attesa del primo passaggio al 5 km` : `🏃 Partito, in attesa del passaggio al 5 km`;
    const b = Course.data ? Course.boroughAt(p.km) : null;
    return `🏃 km ${U.fmtKm(p.km)}${b ? ` · ${b.name}` : ''}${p.waitingAtMat ? ' · in attesa del rilevamento' : ''}`;
  }

  function renderFollowed() {
    const ul = $('#followed-list'); $('#followed-count').textContent = S.followed.length || '';
    $('#followed-empty').classList.toggle('hidden', S.followed.length > 0);
    ul.innerHTML = S.followed.map((r) => {
      const d = S.data[r.id]; const p = d && d.prog;
      return `<li class="frow ${r.id === S.selectedId ? 'sel' : ''}" data-id="${U.esc(r.id)}"><span class="dot" style="background:${r.color}"></span><div class="f-main"><b>${U.esc(runnerName(r))}</b> <span class="bib">#${U.esc(r.bib)}</span><div class="f-sub">${statusLine(r, d)}</div>${p && p.status === 'running' ? `<div class="f-sub">passo ${U.fmtPace(p.blendPace)} · arrivo stimato ${U.fmtTime(p.projFinishSec)}</div>` : ''}</div><button class="x" title="Non seguire più" data-x="${U.esc(r.id)}">×</button></li>`;
    }).join('');
    ul.querySelectorAll('li.frow').forEach((li) => { li.onclick = (e) => { if (e.target.dataset.x) return; select(li.dataset.id); }; });
    ul.querySelectorAll('button[data-x]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); unfollow(b.dataset.x); }; });
  }

  function renderLeaders() {
    const box = $('#leaders');
    const block = (g) => {
      const list = rankedCandidates(g).slice(0, 3);
      if (!list.length) return `<div class="lead-block"><h3>${g === 'M' ? 'Uomini' : 'Donne'}</h3><div class="muted">Nessun dato ancora.</div></div>`;
      return `<div class="lead-block"><h3>${g === 'M' ? '👑 Uomini' : '👑 Donne'}</h3>${list.map((d, i) => `<div class="lead-row"><span class="pos">${i + 1}</span><div><b>${U.esc(runnerName(d.runner))}</b> <span class="bib">#${U.esc(d.runner.bib)}</span> ${U.flag(d.runner.country)}<div class="f-sub">${d.prog.status === 'finished' ? `${arrived(d.runner)} in ${U.fmtTime(d.details.finishSec)}` : `km ${U.fmtKm(d.prog.km)} · passo ${U.fmtPace(d.prog.blendPace)}`}</div></div></div>`).join('')}</div>`;
    };
    box.innerHTML = block('M') + block('W');
  }

  function renderDetailLight() { const el = $('#dl-km'); if (!el) return; const d = S.data[S.selectedId]; if (d) { el.textContent = U.fmtKm(d.prog.km); const b = $('#dl-status'); if (b) b.textContent = statusLine(S.followed.find((f) => f.id === S.selectedId), d); const bar = $('#pb-marker'); if (bar) bar.style.left = `${d.prog.pct}%`; } }

  function renderDetail() {
    const box = $('#runner-detail');
    const r = S.followed.find((f) => f.id === S.selectedId);
    if (!r) { box.innerHTML = `<div class="empty big"><div class="emoji">🗽</div><p>Cerca un maratoneta per nome o pettorale e premi <b>Segui</b>: qui vedrai tempi, passaggi, mappa, confronto con i leader e qualche statistica divertente.</p>${S.mode === 'sim' ? '<p class="hint">Suggerimento per la simulazione: prova a cercare “Michele” o il pettorale 26210.</p>' : '<p class="hint">Prima della partenza i dati live potrebbero non essere ancora disponibili: usa la <b>Simulazione</b> per vedere come funziona.</p>'}</div>`; return; }
    const d = S.data[r.id];
    if (!d) { box.innerHTML = `<div class="empty big">Caricamento di ${U.esc(runnerName(r))}…</div>`; return; }
    const p = d.prog, det = d.details, g = genderKey(r);
    const leader = S.leaders[g];
    const tr = S.track[r.id] || {};
    const waveOpts = [`<option value="auto" ${!tr.wave || tr.wave === 'auto' ? 'selected' : ''}>Automatica (${waveLabel(d.start)})</option>`].concat(U.RACE.waves.map((w) => `<option value="${w.id}" ${tr.wave === w.id ? 'selected' : ''}>${w.label} · ${w.time} NY</option>`)).join('');
    const boroughs = Course.data ? Course.data.boroughs : [];
    const tiles = [];
    tiles.push(tile('Chilometri', `<span id="dl-km">${U.fmtKm(p.km)}</span> <small>/ ${U.fmtKm(KM_TOTAL, 1)}</small>`));
    tiles.push(tile('Passo medio', p.avgPace ? `${U.fmtPace(p.avgPace)} <small>min/km</small>` : '–'));
    tiles.push(tile('Ultimo tratto', p.segPace ? `${U.fmtPace(p.segPace)} <small>min/km</small>` : '–'));
    tiles.push(tile(p.status === 'finished' ? 'Tempo finale' : 'Arrivo previsto', p.projFinishSec ? U.fmtTime(p.projFinishSec) : '–'));
    tiles.push(tile(p.status === 'finished' ? 'Arrivato alle (Italia)' : 'Arrivo stimato (Italia)', p.etaEpoch ? `${U.fmtClock(p.etaEpoch, U.RACE.tzHome, false)} <small>${U.fmtClock(p.etaEpoch, U.RACE.tz, false)} NY</small>` : '–'));
    if (det && det.placeOverall) tiles.push(tile('Posizione', `${U.fmtNum(det.placeOverall)}° <small>${det.placeGender ? `· ${U.fmtNum(det.placeGender)}° ${g === 'W' ? 'donne' : 'uomini'}` : ''}</small>`));
    if (leader && leader.prog && p.status !== 'pre') {
      const dk = leader.prog.km - p.km;
      tiles.push(tile(`Distacco dal leader ${g === 'W' ? 'donne' : 'uomini'}`, leader.prog.status === 'finished' && p.status !== 'finished' ? `${U.fmtKm(KM_TOTAL - p.km)} km <small>il leader è già arrivato</small>` : p.status === 'finished' && leader.prog.status === 'finished' ? `${U.fmtGap(det.finishSec - leader.details.finishSec)} <small>sul tempo</small>` : `${U.fmtKm(Math.max(0, dk))} km <small>${U.esc(runnerName(leader.runner))}</small>`));
    }
    const splitsRows = Stats.compare(det, d.start.epoch, leader && leader.details, leader && leader.start.epoch);
    const paceRunner = Stats.paceSeries(det);
    const facts = Stats.funFacts(r, det, p, Course.data, { overview: S.overview });
    const nextLm = Course.data ? Course.data.landmarks.filter((l) => l.km > p.km).slice(0, 4) : [];
    box.innerHTML = `
      <div class="d-head"><span class="dot big" style="background:${r.color}"></span><div><h2>${U.esc(runnerName(r))} <span class="bib">#${U.esc(r.bib)}</span></h2><div class="d-sub">${U.flag(r.country)} ${U.esc(r.country || '')} ${r.city ? '· ' + U.esc(r.city) : ''}${r.age ? ` · ${r.age} anni` : ''}${det && det.ageGroup ? ` · cat. ${U.esc(det.ageGroup)}` : ''}${det && det.team ? ` · ${U.esc(det.team)}` : ''}</div></div><div class="d-actions"><button class="btn small ghost" id="d-center">📍 Mappa</button><button class="btn small ghost" id="d-remove">Rimuovi</button></div></div>
      <div class="d-status" id="dl-status">${statusLine(r, d)}</div>
      <div class="pbar" title="Avanzamento">${boroughs.map((b) => `<span class="pb-seg" style="left:${b.fromKm / KM_TOTAL * 100}%;width:${(Math.min(b.toKm, KM_TOTAL) - b.fromKm) / KM_TOTAL * 100}%;background:${b.color}" title="${U.esc(b.name)}"></span>`).join('')}<span class="pb-marker" id="pb-marker" style="left:${p.pct}%;--c:${r.color}"></span></div>
      <div class="pb-labels"><span>Staten Island</span><span>Brooklyn</span><span>Queens</span><span>Manhattan</span><span>Bronx</span><span>Arrivo</span></div>
      <div class="tiles">${tiles.join('')}</div>
      <div class="wave-row"><label>Onda di partenza <select id="wave-select">${waveOpts}</select></label><span class="hint">${startHint(d.start)}</span></div>
      ${nextLm.length && p.status !== 'finished' ? `<section class="d-sec"><h3>Prossimi punti del percorso</h3><ul class="lm-list">${nextLm.map((l) => `<li><span class="lm-emoji">${l.emoji}</span><div><b>${U.esc(l.name)}</b> <span class="muted">km ${U.fmtKm(l.km)}</span>${p.blendPace && p.km > 0 ? `<div class="f-sub">tra ${U.fmtKm(l.km - p.km)} km, verso le ${U.fmtClock(now() + (l.km - p.km) * p.blendPace * 1000, U.RACE.tzHome, false)} (IT)</div>` : ''}<div class="f-sub">${U.esc(l.desc)}</div></div></li>`).join('')}</ul></section>` : ''}
      <section class="d-sec"><h3>Passaggi intermedi ${leader ? `<span class="muted">· confronto con ${U.esc(runnerName(leader.runner))} (leader ${g === 'W' ? 'donne' : 'uomini'})</span>` : ''}</h3>
        ${splitsRows.length ? `<table class="splits"><thead><tr><th>Split</th><th>Tempo</th><th>Passo tratto</th><th>Leader</th><th>Distacco</th><th>Leader era al</th></tr></thead><tbody>${splitsRows.map((row, i) => { const prev = i ? splitsRows[i - 1] : { km: 0, sec: 0 }; const pace = (row.sec - prev.sec) / (row.km - prev.km); return `<tr><td>${U.SPLIT_LABEL[row.code] || row.code}</td><td class="num">${U.fmtTime(row.sec)}</td><td class="num">${U.fmtPace(pace)}</td><td class="num">${row.refSec != null ? U.fmtTime(row.refSec) : '–'}</td><td class="num">${row.gap != null ? U.fmtGap(row.gap) : '–'}</td><td class="num">${row.refKmWhen != null ? `km ${U.fmtKm(row.refKmWhen)}` : '–'}</td></tr>`; }).join('')}</tbody></table>` : '<div class="muted">Nessun passaggio ancora rilevato.</div>'}
      </section>
      <section class="d-sec"><h3>Passo per tratto</h3><div id="pace-chart"></div></section>
      ${leader && leader.prog ? `<section class="d-sec"><h3>Come sta andando rispetto ai migliori</h3>${leaderText(r, d, leader, g)}</section>` : ''}
      <section class="d-sec"><h3>Statistiche piacevoli e divertenti</h3><div class="facts">${facts.map((f) => `<div class="fact"><div class="f-icon">${f.icon}</div><div><b>${U.esc(f.title)}</b><div>${U.esc(f.text)}</div></div></div>`).join('')}</div></section>`;
    $('#d-center').onclick = () => focusRunner(r.id, true);
    $('#d-remove').onclick = () => unfollow(r.id);
    $('#wave-select').onchange = (e) => { S.track[r.id] = Object.assign(S.track[r.id] || { baseline: null, firstSeen: {} }, { wave: e.target.value }); const st = Stats.resolveStart(r, det, S.track[r.id]); d.start = st; d.prog = Stats.progress(r, det, st, now()); persist(); renderAll(); };
    const series = [{ name: runnerName(r), color: r.color, points: paceRunner }];
    if (leader && leader.details) series.push({ name: `${runnerName(leader.runner)} (leader)`, color: '#898781', dashed: true, points: Stats.paceSeries(leader.details) });
    PaceChart.render($('#pace-chart'), series);
  }
  function tile(label, value) { return `<div class="tile"><div class="t-label">${label}</div><div class="t-value">${value}</div></div>`; }
  function waveLabel(start) { const w = start.waveId ? U.waveById(start.waveId) : null; return w ? `${w.label}, ${w.time} NY` : 'da determinare'; }
  function startHint(start) {
    return { manual: 'Onda impostata manualmente.', bib: 'Partenza dedotta dal numero di pettorale (élite).', gun: 'Partenza calcolata dalla differenza tra tempo ufficiale e tempo netto.', inferred: 'Partenza stimata dall\'orario in cui è comparso un nuovo passaggio.', bounded: 'Onda dedotta dagli orari dei passaggi (la più tarda compatibile). Se la conosci, impostala per una stima più precisa.', unknown: 'Onda non ancora nota: la posizione sarà stimata dopo il primo passaggio al 5 km. Se conosci l\'onda, impostala qui.' }[start.source] || '';
  }
  function leaderText(r, d, leader, g) {
    const p = d.prog, lp = leader.prog, ln = runnerName(leader.runner);
    const parts = [];
    if (lp.status === 'finished') parts.push(`<p>🏁 <b>${U.esc(ln)}</b> ha vinto tra ${g === 'W' ? 'le donne' : 'gli uomini'} in <b>${U.fmtTime(leader.details.finishSec)}</b> (passo ${U.fmtPace(leader.details.finishSec / KM_TOTAL)} min/km)${p.status !== 'finished' ? `, quando ${U.esc(runnerName(r))} era circa al km ${U.fmtKm(Stats.kmAtTime(d.details, d.start.epoch, lp.etaEpoch))}.` : '.'}</p>`);
    else parts.push(`<p>👑 <b>${U.esc(ln)}</b> guida la gara ${g === 'W' ? 'femminile' : 'maschile'} al km <b>${U.fmtKm(lp.km)}</b> con un passo di ${U.fmtPace(lp.blendPace)} min/km (arrivo previsto ${U.fmtTime(lp.projFinishSec)}).</p>`);
    if (p.status === 'finished' && lp.status === 'finished') parts.push(`<p>⏱️ ${U.esc(runnerName(r))} ha chiuso in ${U.fmtTime(d.details.finishSec)}: ${U.fmtGap(d.details.finishSec - leader.details.finishSec)} rispetto al vincitore, cioè ${U.fmtNum((d.details.finishSec / leader.details.finishSec - 1) * 100, 0)}% in più di tempo. Il vincitore correva a ${U.fmtNum(3600 / (leader.details.finishSec / KM_TOTAL), 1)} km/h contro ${U.fmtNum(3600 / (d.details.finishSec / KM_TOTAL), 1)} km/h.</p>`);
    else if (p.status === 'running' && p.blendPace && lp.blendPace) {
      const ratio = p.blendPace / lp.blendPace;
      parts.push(`<p>📏 Distanza sul percorso: <b>${U.fmtKm(Math.max(0, lp.km - p.km))} km</b>. Il leader corre a ${U.fmtNum(3600 / lp.blendPace, 1)} km/h, ${U.esc(runnerName(r))} a ${U.fmtNum(3600 / p.blendPace, 1)} km/h: ogni chilometro del leader vale ${U.fmtNum(ratio, 2)} chilometri suoi.</p>`);
      const common = Stats.compare(d.details, d.start.epoch, leader.details, leader.start.epoch).filter((x) => x.gap != null).pop();
      if (common) parts.push(`<p>🔁 Al passaggio ${U.SPLIT_LABEL[common.code] || common.code}: ${U.fmtTime(common.sec)} contro ${U.fmtTime(common.refSec)} del leader (${U.fmtGap(common.gap)}). In quel momento il leader era già al km ${U.fmtKm(common.refKmWhen)}.</p>`);
    }
    const rec = U.RACE.records[g];
    if (rec) parts.push(`<p>📚 Record del percorso ${g === 'W' ? 'femminile' : 'maschile'}: ${rec.time} (${rec.who}, ${rec.year}); vincitore 2025: ${U.RACE.lastYear[g].who} in ${U.RACE.lastYear[g].time}.</p>`);
    return parts.join('');
  }

  /* ---------- mappa ---------- */
  function initMap() {
    if (!window.L) { $('#map').innerHTML = '<div class="map-err">Mappa non disponibile (Leaflet non caricato: serve la connessione a internet).</div>'; return; }
    S.map = L.map('map', { zoomControl: false, attributionControl: true }).setView([40.73, -73.97], 11);
    L.control.zoom({ position: 'bottomright' }).addTo(S.map);
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' });
    const gray = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, OpenStreetMap contributors' });
    const street = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, OpenStreetMap contributors' });
    if (ARTIFACT) {
      // mappa di sfondo inclusa nei file pubblicati (solo il corridoio del percorso, zoom 11-14)
      L.tileLayer('tiles/{z}/{x}/{y}.jpg', { minZoom: 11, maxNativeZoom: 14, maxZoom: 16, attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, OpenStreetMap contributors' }).addTo(S.map);
      S.map.setMinZoom(11);
    } else {
      (S.settings.basemap === 'gray' ? gray : S.settings.basemap === 'osm' ? osm : street).addTo(S.map); // predefinito Esri: i tile OSM bloccano l'app (403, tile usage policy)
      L.control.layers({ 'Stradale (Esri)': street, 'Grigio chiaro (Esri)': gray, 'OpenStreetMap': osm }, null, { position: 'topright', collapsed: true }).addTo(S.map);
      S.map.on('baselayerchange', (e) => { S.settings.basemap = e.layer === gray ? 'gray' : e.layer === street ? 'street' : 'osm'; persist(); });
    }
    const C = Course.data; if (!C) return;
    const group = L.featureGroup().addTo(S.map);
    for (const b of C.boroughs) {
      const from = Course.toPoly(b.fromKm * 1000), to = Course.toPoly(Math.min(b.toKm, KM_TOTAL) * 1000);
      const pts = C.coords.filter((_, i) => C.cum[i] >= from - 1 && C.cum[i] <= to + 1);
      if (pts.length > 1) L.polyline(pts, { color: '#fcfcfb', weight: 7, opacity: 0.9 }).addTo(group);
    }
    for (const b of C.boroughs) {
      const from = Course.toPoly(b.fromKm * 1000), to = Course.toPoly(Math.min(b.toKm, KM_TOTAL) * 1000);
      const pts = C.coords.filter((_, i) => C.cum[i] >= from - 1 && C.cum[i] <= to + 1);
      if (pts.length > 1) L.polyline(pts, { color: b.color, weight: 4, opacity: 0.95 }).addTo(group).bindTooltip(`${b.emoji} ${b.name}`, { sticky: true });
    }
    S.splitLayer = L.layerGroup().addTo(S.map);
    for (const s of C.splits) {
      const label = s.code === 'FIN' ? '🏁 Arrivo' : (U.SPLIT_LABEL[s.code] || s.code);
      L.circleMarker(s.pos, { radius: 5, color: '#0b0b0b', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(S.splitLayer).bindTooltip(label, { permanent: true, direction: 'right', className: 'split-label', offset: [6, 0] });
    }
    L.circleMarker(C.coords[0], { radius: 6, color: '#0b0b0b', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(S.splitLayer).bindTooltip('🏁 Partenza', { permanent: true, direction: 'left', className: 'split-label', offset: [-6, 0] });
    S.mileLayer = L.layerGroup();
    for (const m of C.miles) L.circleMarker(m.pos, { radius: 3, color: '#52514e', weight: 1, fillColor: '#fff', fillOpacity: 1 }).addTo(S.mileLayer).bindTooltip(`Miglio ${m.mi}`, { permanent: true, direction: 'left', className: 'mile-label', offset: [-4, 0] });
    for (const l of C.landmarks) if (l.bridge) L.marker(l.pos, { icon: L.divIcon({ className: 'lm-icon', html: `<span>${l.emoji}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: true, zIndexOffset: -100 }).addTo(S.map).bindPopup(`<b>${U.esc(l.name)}</b><br>km ${U.fmtKm(l.km)}<br>${U.esc(l.desc)}`);
    S.map.fitBounds(group.getBounds(), { padding: [20, 20] });
    applyMapOptions();
  }
  function applyMapOptions() {
    if (!S.map) return;
    if (S.settings.showMiles) S.mileLayer.addTo(S.map); else S.map.removeLayer(S.mileLayer);
    updateMarkers();
  }
  function runnerIcon(r, selected) { return L.divIcon({ className: 'runner-icon' + (selected ? ' selected' : ''), html: `<div class="rm" style="--c:${r.color}"><span>${U.esc(r.bib)}</span></div>`, iconSize: [34, 34], iconAnchor: [17, 17] }); }
  function updateMarkers() {
    if (!S.map || !Course.data) return;
    for (const r of S.followed) {
      const d = S.data[r.id]; if (!d) continue;
      const pos = Course.posAt(d.prog.km * 1000); const ll = [pos.lat, pos.lon];
      const sel = r.id === S.selectedId;
      let m = S.runnerMarkers[r.id];
      if (!m) { m = L.marker(ll, { icon: runnerIcon(r, sel), zIndexOffset: sel ? 1000 : 500 }).addTo(S.map); m.on('click', () => select(r.id)); S.runnerMarkers[r.id] = m; m._sel = sel; }
      else { m.setLatLng(ll); if (m._sel !== sel) { m.setIcon(runnerIcon(r, sel)); m.setZIndexOffset(sel ? 1000 : 500); m._sel = sel; } }
      m.bindTooltip(`<b>${U.esc(runnerName(r))}</b><br>${statusLine(r, d)}`, { direction: 'top', offset: [0, -14] });
      if (sel && S.settings.follow && S.map && !S.map.getBounds().pad(-0.15).contains(ll)) S.map.panTo(ll);
    }
    for (const g of ['M', 'W']) {
      const lead = S.leaders[g];
      let m = S.leaderMarkers[g];
      if (!lead || !S.settings.showLeaders) { if (m) { S.map.removeLayer(m); delete S.leaderMarkers[g]; } continue; }
      const pos = Course.posAt(lead.prog.km * 1000); const ll = [pos.lat, pos.lon];
      if (!m) { m = L.marker(ll, { icon: L.divIcon({ className: 'leader-icon', html: `<div class="lm ${g}"><span>👑</span><em>${g === 'W' ? 'F' : 'M'}</em></div>`, iconSize: [34, 34], iconAnchor: [17, 17] }), zIndexOffset: 800 }).addTo(S.map); S.leaderMarkers[g] = m; }
      else m.setLatLng(ll);
      m.bindTooltip(`👑 Leader ${g === 'W' ? 'donne' : 'uomini'}: <b>${U.esc(runnerName(lead.runner))}</b><br>${lead.prog.status === 'finished' ? arrived(lead.runner) + ' in ' + U.fmtTime(lead.details.finishSec) : 'km ' + U.fmtKm(lead.prog.km) + ' · passo ' + U.fmtPace(lead.prog.blendPace)}`, { direction: 'top', offset: [0, -14] });
    }
    for (const g of ['M', 'W']) {
      let m = S.ghostMarkers[g];
      if (!S.settings.showGhost) { if (m) { S.map.removeLayer(m); delete S.ghostMarkers[g]; } continue; }
      const rec = U.RACE.records[g]; const start = U.waveEpoch(g === 'W' ? 'proW' : 'proM');
      const km = U.clamp((now() - start) / 1000 / (U.parseTime(rec.time) / KM_TOTAL), 0, KM_TOTAL);
      const pos = Course.posAt(km * 1000); const ll = [pos.lat, pos.lon];
      if (!m) { m = L.marker(ll, { icon: L.divIcon({ className: 'ghost-icon', html: `<div class="gh"><span>👻</span><em>${g === 'W' ? 'F' : 'M'}</em></div>`, iconSize: [30, 30], iconAnchor: [15, 15] }), zIndexOffset: 300 }).addTo(S.map); S.ghostMarkers[g] = m; }
      else m.setLatLng(ll);
      m.bindTooltip(`👻 Fantasma del record ${g === 'W' ? 'femminile' : 'maschile'}: ${rec.who} (${rec.time})<br>sarebbe al km ${U.fmtKm(km)}`, { direction: 'top', offset: [0, -14] });
    }
  }
  function focusRunner(id, zoom) {
    const d = S.data[id]; if (!d || !S.map) return;
    const pos = Course.posAt(d.prog.km * 1000);
    if (zoom) S.map.setView([pos.lat, pos.lon], Math.max(S.map.getZoom(), 14)); else S.map.panTo([pos.lat, pos.lon]);
  }

  window.NYCApp = { state: S, refresh, select, follow, unfollow };
  document.addEventListener('DOMContentLoaded', boot);
})();
