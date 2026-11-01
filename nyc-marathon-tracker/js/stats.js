/* Calcoli: normalizzazione risultati, stima della posizione, proiezioni, confronti e statistiche divertenti. */
window.Stats = (function () {
  const KM_TOTAL = U.RACE.distanceKm;

  function codeToKm(code, distMi) {
    if (U.SPLIT_KM[code] != null) return U.SPLIT_KM[code];
    const m = /^(\d+(?:\.\d+)?)M$/i.exec(code || '');
    if (m) return Number(m[1]) * U.MI;
    const k = /^(\d+(?:\.\d+)?)K$/i.exec(code || '');
    if (k) return Number(k[1]);
    if (distMi != null) return Number(distMi) * U.MI;
    return null;
  }

  /* Da "details" NYRR (o equivalente simulato) a un modello uniforme. */
  function normalizeDetails(raw) {
    if (!raw) return null;
    const splits = [];
    for (const s of raw.splitResults || []) {
      const sec = U.parseTime(s.time);
      const km = codeToKm(s.splitCode, s.distance);
      if (sec == null || km == null || km <= 0) continue;
      splits.push({ code: s.splitCode, km, sec, metric: U.SPLIT_KM[s.splitCode] != null });
    }
    splits.sort((a, b) => a.km - b.km);
    const finishSec = U.parseTime(raw.netTime || raw.timeOverall);
    if (finishSec != null) splits.push({ code: 'FIN', km: KM_TOTAL, sec: finishSec, metric: true });
    return {
      splits,
      finishSec,
      gunSec: U.parseTime(raw.gunTime),
      placeOverall: raw.placeOverall ?? raw.netPlaceOverall ?? null,
      placeGender: raw.placeGender ?? null,
      placeAgeGroup: raw.placeAgeGroup ?? null,
      ageGroup: raw.ageGroupFromTo || null,
      team: raw.teamName || null,
      iaaf: raw.iaaf || null,
      agePercent: raw.percentAgeGrade ?? null,
    };
  }

  /* Solo gli split "metrici" (5K, 10K, ..., HALF, ..., FIN) per tabelle e grafici. */
  function metricSplits(details) { return (details ? details.splits : []).filter((s) => s.metric); }

  /* Risolve l'orario di partenza del runner (epoch ms) e la fonte della stima. */
  function resolveStart(runner, details, track) {
    track = track || {};
    if (track.wave && track.wave !== 'auto') return { epoch: U.waveEpoch(track.wave), source: 'manual', waveId: track.wave };
    const kind = U.bibKind(runner.bib);
    if (kind === 'proM' || kind === 'proW') return { epoch: U.waveEpoch(kind), source: 'bib', waveId: kind };
    if (details && details.gunSec != null && details.finishSec != null && details.gunSec > details.finishSec + 5) {
      return { epoch: U.waveEpoch(U.RACE.gunReferenceWave) + (details.gunSec - details.finishSec) * 1000, source: 'gun', waveId: nearestWave(U.waveEpoch(U.RACE.gunReferenceWave) + (details.gunSec - details.finishSec) * 1000).id };
    }
    // Inferenza: primo avvistamento di uno split (escludendo quelli già presenti al primo caricamento)
    let best = null;
    if (details && track.firstSeen) {
      for (const s of details.splits) {
        const seen = track.firstSeen[s.code];
        if (!seen || (track.baseline || []).includes(s.code)) continue;
        const est = seen - s.sec * 1000;
        if (best == null || est < best) best = est;
      }
    }
    const FEED_DELAY = 60 * 1000;
    if (best != null) {
      const raw = best - FEED_DELAY;
      const w = latestWaveBefore(raw + 12 * 60 * 1000, 'mass');
      const snapped = w ? U.clamp(raw, w.epoch, w.epoch + 8 * 60 * 1000) : raw;
      return { epoch: snapped, source: 'inferred', waveId: w ? w.id : null };
    }
    // Limite superiore: ogni passaggio visto all'istante T con tempo s implica partenza <= T - s.
    if (details && details.splits.length && track.firstSeen) {
      let ub = null;
      for (const s of details.splits) { const seen = track.firstSeen[s.code]; if (seen) { const e = seen - s.sec * 1000; if (ub == null || e < ub) ub = e; } }
      if (ub != null) {
        const w = latestWaveBefore(ub, 'mass') || { id: 'w1', epoch: U.waveEpoch('w1') };
        return { epoch: w.epoch, source: 'bounded', waveId: w.id };
      }
    }
    return { epoch: U.waveEpoch('w1'), source: 'unknown', waveId: null };
  }
  function latestWaveBefore(epoch, kind) {
    let best = null;
    for (const w of U.RACE.waves) {
      if (kind && w.kind !== kind) continue;
      const e = U.waveEpoch(w.id);
      if (e <= epoch && (!best || e > best.epoch)) best = { id: w.id, epoch: e };
    }
    return best;
  }
  function nearestWave(epoch, kind) {
    let best = null;
    for (const w of U.RACE.waves) {
      if (kind && w.kind !== kind) continue;
      const e = U.waveEpoch(w.id);
      if (!best || Math.abs(e - epoch) < Math.abs(best.epoch - epoch)) best = { id: w.id, epoch: e };
    }
    return best;
  }

  const DEFAULT_PACE = { proM: 178, proW: 198, mass: 390, other: 300 }; // sec/km prima del primo passaggio

  /* Stato di avanzamento stimato adesso. */
  function progress(runner, details, start, nowEpoch) {
    const startEpoch = typeof start === 'number' ? start : start.epoch;
    const startSource = typeof start === 'number' ? 'manual' : start.source;
    const splits = details ? details.splits : [];
    const out = { status: 'pre', km: 0, pct: 0, last: null, prev: null, next: null, segPace: null, avgPace: null, blendPace: null, projFinishSec: null, etaEpoch: null, elapsedSec: null, estimated: true, waitingAtMat: false, startEpoch };
    if (details && details.finishSec != null) {
      out.status = 'finished'; out.km = KM_TOTAL; out.pct = 100; out.estimated = false;
      out.projFinishSec = details.finishSec; out.etaEpoch = startEpoch + details.finishSec * 1000;
      out.avgPace = details.finishSec / KM_TOTAL;
      const metric = metricSplits(details);
      out.last = metric[metric.length - 1] || null; out.prev = metric[metric.length - 2] || null;
      if (out.last && out.prev) out.segPace = (out.last.sec - out.prev.sec) / (out.last.km - out.prev.km);
      return out;
    }
    const elapsed = (nowEpoch - startEpoch) / 1000;
    out.elapsedSec = elapsed;
    if (!splits.length) {
      if (elapsed < 0) { out.status = 'pre'; return out; }
      out.status = 'started';
      if (startSource === 'unknown') { out.next = { code: '5K', km: 5 }; return out; }
      const pace = DEFAULT_PACE[U.bibKind(runner.bib)] || 390;
      out.blendPace = pace; out.avgPace = null;
      out.km = Math.min(elapsed / pace, 4.95);
      out.waitingAtMat = out.km >= 4.95;
      out.next = { code: '5K', km: 5 };
      out.pct = out.km / KM_TOTAL * 100;
      out.projFinishSec = KM_TOTAL * pace; out.etaEpoch = startEpoch + out.projFinishSec * 1000;
      return out;
    }
    const last = splits[splits.length - 1];
    const prev = splits.length > 1 ? splits[splits.length - 2] : null;
    const back10 = [...splits].reverse().find((s) => last.km - s.km >= 9.5) || null;
    out.last = last; out.prev = prev;
    out.avgPace = last.sec / last.km;
    out.segPace = prev ? (last.sec - prev.sec) / (last.km - prev.km) : out.avgPace;
    const recent = back10 ? (last.sec - back10.sec) / (last.km - back10.km) : out.segPace;
    out.blendPace = 0.5 * recent + 0.3 * out.segPace + 0.2 * out.avgPace;
    const nextKm = nextMetricKm(last.km);
    out.next = nextKm != null ? { code: codeForKm(nextKm), km: nextKm } : null;
    let km = last.km;
    if (elapsed > last.sec) km = last.km + (elapsed - last.sec) / out.blendPace;
    if (out.next && km >= out.next.km - 0.03) { km = out.next.km - 0.03; out.waitingAtMat = true; }
    out.km = Math.min(km, KM_TOTAL - 0.01);
    out.status = 'running';
    out.pct = out.km / KM_TOTAL * 100;
    const fatigue = U.bibKind(runner.bib) === 'mass' && last.km < 30 ? 1.03 : 1.0;
    out.projFinishSec = last.sec + (KM_TOTAL - last.km) * out.blendPace * fatigue;
    out.etaEpoch = startEpoch + out.projFinishSec * 1000;
    return out;
  }
  const METRIC_KMS = [5, 10, 15, 20, 21.0975, 25, 30, 35, 40, KM_TOTAL];
  function nextMetricKm(km) { return METRIC_KMS.find((k) => k > km + 0.01) ?? null; }
  function codeForKm(km) { return Object.keys(U.SPLIT_KM).find((c) => Math.abs(U.SPLIT_KM[c] - km) < 0.01) || `${km}K`; }

  /* Km stimati di un runner a un dato istante (interpolando i suoi split). */
  function kmAtTime(details, startEpoch, epoch) {
    const t = (epoch - startEpoch) / 1000;
    const sp = details ? details.splits : [];
    if (t <= 0 || !sp.length) return 0;
    let prev = { km: 0, sec: 0 };
    for (const s of sp) {
      if (t <= s.sec) return prev.km + (s.km - prev.km) * (t - prev.sec) / (s.sec - prev.sec);
      prev = s;
    }
    if (details.finishSec != null) return KM_TOTAL;
    const last = sp[sp.length - 1];
    const pace = last.sec / last.km;
    return Math.min(KM_TOTAL, last.km + (t - last.sec) / pace);
  }

  /* Confronto split per split con un riferimento (leader). */
  function compare(runnerDetails, runnerStart, refDetails, refStart) {
    const rows = [];
    const refByCode = new Map((refDetails ? refDetails.splits : []).map((s) => [s.code, s]));
    for (const s of metricSplits(runnerDetails)) {
      const r = refByCode.get(s.code);
      const row = { code: s.code, km: s.km, sec: s.sec, refSec: r ? r.sec : null, gap: r ? s.sec - r.sec : null, refKmWhen: null, wallGap: null };
      if (refDetails && refDetails.splits.length) {
        const when = runnerStart + s.sec * 1000;
        row.refKmWhen = kmAtTime(refDetails, refStart, when);
        if (r) row.wallGap = (runnerStart + s.sec * 1000 - (refStart + r.sec * 1000)) / 1000;
      }
      rows.push(row);
    }
    return rows;
  }

  /* Passo per tratto (min/km) tra split metrici, per il grafico. */
  function paceSeries(details) {
    const pts = [];
    let prev = { km: 0, sec: 0 };
    for (const s of metricSplits(details)) {
      if (s.km - prev.km < 0.5) { prev = s; continue; }
      pts.push({ km: s.km, pace: (s.sec - prev.sec) / (s.km - prev.km), code: s.code });
      prev = s;
    }
    return pts;
  }

  const ITALY_TRIPS = [
    { km: 5, text: 'da Piazza Duomo a San Siro (Milano)' }, { km: 8, text: 'dal Colosseo allo Stadio Olimpico (Roma)' }, { km: 12, text: 'da Piazza del Plebiscito a Posillipo e ritorno (Napoli)' },
    { km: 15, text: 'da Milano a Monza' }, { km: 20, text: 'da Firenze a Prato' }, { km: 24, text: 'da Torino a Chivasso' }, { km: 28, text: 'da Roma a Fiumicino' },
    { km: 32, text: 'da Bologna a Imola' }, { km: 36, text: 'da Venezia a Padova' }, { km: 40, text: 'da Bergamo a Milano' }, { km: 42.195, text: 'tutta la maratona: da Staten Island a Central Park, cinque borough!' },
  ];

  /* Statistiche "piacevoli e divertenti" per un runner. */
  function funFacts(runner, details, prog, course, ctx) {
    const facts = [];
    const km = prog.km;
    const pace = prog.blendPace || prog.avgPace;
    if (km <= 0) {
      facts.push({ icon: '⏳', title: 'In attesa del via', text: `Partenza prevista alle ${U.fmtClock(prog.startEpoch, U.RACE.tz, false)} (ora di New York), cioè le ${U.fmtClock(prog.startEpoch, U.RACE.tzHome, false)} in Italia.` });
      return facts;
    }
    const b = course ? Course.boroughAt(km) : null;
    const next = course ? Course.nextLandmark(km) : null;
    if (prog.status !== 'finished' && b) facts.push({ icon: b.emoji || '📍', title: `Ora è a ${b.name}`, text: next ? `Prossimo punto di riferimento: ${next.name} tra ${U.fmtKm(Math.max(0, next.km - km))} km${pace ? ` (circa ${U.fmtDuration((next.km - km) * pace)})` : ''}.` : '' });
    if (pace) {
      const kmh = 3600 / pace;
      facts.push({ icon: '⚡', title: `${U.fmtNum(kmh, 1)} km/h`, text: `Passo ${U.fmtPace(pace)} min/km (${U.fmtPace(pace * U.MI)} min/miglio): un chilometro ogni ${U.fmtDuration(pace)}, 100 metri in ${U.fmtNum(pace / 10, 1)} secondi.` });
    }
    const kcal = Math.round(km * 70);
    facts.push({ icon: '🍕', title: `${U.fmtNum(kcal)} kcal bruciate`, text: `Più o meno ${U.fmtNum(kcal / 800, 1)} pizze margherita, ${U.fmtNum(kcal / 250, 0)} coni gelato o ${U.fmtNum(kcal / 300, 0)} cornetti (stima su 70 kg).` });
    if (pace) {
      const speed = 1000 / pace; // m/s
      const cadence = 2.55 + 0.08 * Math.max(0, speed - 2.5); // passi al secondo
      const steps = Math.round(km * 1000 / (speed / cadence));
      facts.push({ icon: '👟', title: `${U.fmtNum(steps)} passi`, text: `Circa ${Math.round(cadence * 60)} passi al minuto con una falcata di ${U.fmtNum(speed / cadence, 2)} m.` });
    }
    facts.push({ icon: '🏟️', title: `${U.fmtNum(km * 2.5, 0)} giri di pista`, text: `${U.fmtKm(km)} km valgono ${U.fmtNum(km * 1000 / 105, 0)} campi da calcio messi in fila.` });
    const trip = [...ITALY_TRIPS].reverse().find((t) => km >= t.km);
    if (trip) facts.push({ icon: '🇮🇹', title: 'Tradotto in italiano', text: `Ha già corso come ${trip.text}.` });
    const bridges = course ? Course.bridgesPassed(km) : [];
    facts.push({ icon: '🌉', title: `${bridges.length} ponti su 5`, text: bridges.length ? bridges.join(', ') + '.' : 'Il Verrazzano è il primo (e il più lungo): 2 km di salita subito dopo il via.' });
    if (prog.status === 'running') {
      facts.push({ icon: '🎯', title: `Manca il ${U.fmtNum(100 - prog.pct, 0)}%`, text: `${U.fmtKm(KM_TOTAL - km)} km all'arrivo. Previsione di arrivo ${U.fmtTime(prog.projFinishSec)} (alle ${U.fmtClock(prog.etaEpoch, U.RACE.tz, false)} a New York, ${U.fmtClock(prog.etaEpoch, U.RACE.tzHome, false)} in Italia).` });
    }
    if (prog.status === 'finished') {
      facts.push({ icon: '🏅', title: `${runner.gender === 'W' ? 'Arrivata' : 'Arrivato'} in ${U.fmtTime(details.finishSec)}`, text: `Passo medio ${U.fmtPace(details.finishSec / KM_TOTAL)} min/km. Traguardo tagliato alle ${U.fmtClock(prog.etaEpoch, U.RACE.tz, false)} (NY), ${U.fmtClock(prog.etaEpoch, U.RACE.tzHome, false)} in Italia.` });
    }
    const half = metricSplits(details).find((s) => s.code === 'HALF');
    if (half && prog.status === 'finished') {
      const second = details.finishSec - half.sec;
      const diff = second - half.sec;
      facts.push({ icon: diff < 0 ? '📈' : '📉', title: diff < 0 ? 'Negative split!' : 'Positive split', text: `Prima metà ${U.fmtTime(half.sec)}, seconda ${U.fmtTime(second)}: ${diff < 0 ? 'seconda metà più veloce di ' : 'seconda metà più lenta di '}${U.fmtTime(Math.abs(diff), { hours: false })}.` });
    } else if (half && prog.last && prog.last.km > half.km + 0.1) {
      const secondPace = (prog.last.sec - half.sec) / (prog.last.km - half.km);
      const firstPace = half.sec / half.km;
      const d = (secondPace - firstPace) / firstPace * 100;
      facts.push({ icon: d < 0 ? '📈' : '📉', title: d < 0 ? 'Seconda metà in crescendo' : 'Seconda metà in calo', text: `Passo ${U.fmtPace(secondPace)} dopo la mezza contro ${U.fmtPace(firstPace)} prima: ${d < 0 ? '' : '+'}${U.fmtNum(d, 1)}%.` });
    }
    if (prog.last && prog.prev && prog.last.km >= 25 && prog.segPace && prog.avgPace) {
      const d = (prog.segPace - prog.avgPace) / prog.avgPace * 100;
      if (d > 8) facts.push({ icon: '🧱', title: 'Il muro?', text: `L'ultimo tratto è del ${U.fmtNum(d, 0)}% più lento della media: le gambe cominciano a pesare.` });
      else if (d < -3) facts.push({ icon: '🔥', title: 'Sta accelerando', text: `Ultimo tratto ${U.fmtPace(prog.segPace)} min/km, più veloce della sua media di ${U.fmtNum(-d, 0)}%.` });
    }
    const rec = U.RACE.records[runner.gender === 'W' ? 'W' : 'M'];
    if (rec && pace) {
      const recSec = U.parseTime(rec.time);
      const recPace = recSec / KM_TOTAL;
      const recKmNow = prog.status === 'finished' ? KM_TOTAL : Math.min(KM_TOTAL, prog.elapsedSec / recPace);
      facts.push({ icon: '👑', title: `Record del percorso: ${rec.time}`, text: prog.status === 'finished' ? `${rec.who} (${rec.year}) avrebbe chiuso ${U.fmtDuration(details.finishSec - recSec)} prima.` : `${rec.who} (${rec.year}) a quest'ora sarebbe ${recKmNow >= KM_TOTAL ? 'già arrivato' : `al km ${U.fmtKm(recKmNow)}`}: il suo passo era ${U.fmtPace(recPace)} min/km.` });
    }
    if (ctx && ctx.overview && details.placeOverall && prog.status === 'finished') {
      facts.push({ icon: '🏆', title: `${U.fmtNum(details.placeOverall)}° assoluto`, text: `${details.placeGender ? U.fmtNum(details.placeGender) + '° di categoria genere' : ''}${details.ageGroup ? `, fascia ${details.ageGroup}` : ''}. Nel 2025 il tempo medio dei finisher è stato ${ctx.overview.avgFinishTime}.` });
    }
    if (prog.status === 'running' && prog.last) {
      const elapsedSinceMat = prog.elapsedSec - prog.last.sec;
      facts.push({ icon: prog.waitingAtMat ? '📡' : '🛰️', title: prog.waitingAtMat ? `In attesa del passaggio al ${U.SPLIT_LABEL[prog.next.code] || prog.next.code}` : `Ultimo passaggio: ${U.SPLIT_LABEL[prog.last.code] || prog.last.code}`, text: `Rilevato ${U.fmtDuration(elapsedSinceMat)} fa in ${U.fmtTime(prog.last.sec)}. La posizione sulla mappa è una stima basata sul passo recente.` });
    }
    return facts;
  }

  return { normalizeDetails, metricSplits, resolveStart, progress, kmAtTime, compare, paceSeries, funFacts, codeToKm };
})();
