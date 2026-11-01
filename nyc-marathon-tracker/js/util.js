/* Utilità comuni: tempi, fusi orari, formattazione, configurazione gara. */
window.U = (function () {
  const RACE = {
    year: 2026,
    name: 'TCS New York City Marathon 2026',
    dateLocal: '2026-11-01',
    tz: 'America/New_York',
    tzHome: 'Europe/Rome',
    distanceKm: 42.195,
    waves: [
      { id: 'wc', label: 'Carrozzine pro', time: '08:00', kind: 'pro' },
      { id: 'hc', label: 'Handbike / AWD', time: '08:22', kind: 'pro' },
      { id: 'proW', label: 'Pro donne', time: '08:40', kind: 'pro' },
      { id: 'proM', label: 'Pro uomini', time: '09:05', kind: 'pro' },
      { id: 'w1', label: 'Onda 1', time: '09:10', kind: 'mass' },
      { id: 'w2', label: 'Onda 2', time: '09:45', kind: 'mass' },
      { id: 'w3', label: 'Onda 3', time: '10:20', kind: 'mass' },
      { id: 'w4', label: 'Onda 4', time: '10:55', kind: 'mass' },
      { id: 'w5', label: 'Onda 5', time: '11:30', kind: 'mass' },
    ],
    gunReferenceWave: 'w1',
    records: {
      M: { time: '2:04:58', who: 'Tamirat Tola', year: 2023 },
      W: { time: '2:19:51', who: 'Hellen Obiri', year: 2025 },
    },
    lastYear: { M: { time: '2:08:09', who: 'Benson Kipruto' }, W: { time: '2:19:51', who: 'Hellen Obiri' } },
  };

  const MI = 1.609344;
  const SPLIT_KM = { '5K': 5, '10K': 10, '15K': 15, '20K': 20, HALF: 21.0975, '25K': 25, '30K': 30, '35K': 35, '40K': 40, FIN: 42.195 };
  const SPLIT_LABEL = { '5K': '5 km', '10K': '10 km', '15K': '15 km', '20K': '20 km', HALF: 'Mezza', '25K': '25 km', '30K': '30 km', '35K': '35 km', '40K': '40 km', FIN: 'Arrivo' };

  function parseTime(s) {
    if (s == null || s === '') return null;
    const parts = String(s).trim().split(':').map(Number);
    if (parts.some((n) => Number.isNaN(n))) return null;
    let sec = 0;
    for (const p of parts) sec = sec * 60 + p;
    return sec;
  }
  function fmtTime(sec, { hours = true } = {}) {
    if (sec == null || !Number.isFinite(sec)) return '–';
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    return hours || h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  }
  function fmtGap(sec) {
    if (sec == null || !Number.isFinite(sec)) return '–';
    const sign = sec < 0 ? '−' : '+';
    sec = Math.abs(Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h > 0) return `${sign}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${sign}${m}:${String(s).padStart(2, '0')}`;
  }
  function fmtPace(secPerKm) {
    if (secPerKm == null || !Number.isFinite(secPerKm) || secPerKm <= 0) return '–';
    const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
    return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
  }
  function fmtKm(km, dec = 1) {
    if (km == null || !Number.isFinite(km)) return '–';
    return km.toFixed(dec).replace('.', ',');
  }
  function fmtNum(n, dec = 0) {
    if (n == null || !Number.isFinite(n)) return '–';
    return n.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  function fmtDuration(sec) {
    if (sec == null || !Number.isFinite(sec)) return '–';
    sec = Math.round(Math.abs(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h} h ${m} min`;
    if (m > 0) return `${m} min`;
    return `${sec} s`;
  }

  /* Epoch (ms) di una data/ora locale in un fuso orario IANA (es. 09:10 a New York). */
  function zonedEpoch(dateStr, timeStr, tz) {
    const [y, mo, d] = dateStr.split('-').map(Number);
    const [h, mi] = timeStr.split(':').map(Number);
    const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const asZone = (ms) => {
      const p = {};
      for (const part of fmt.formatToParts(new Date(ms))) p[part.type] = part.value;
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour === 24 ? 0 : +p.hour, +p.minute, +p.second);
    };
    const offset = asZone(guess) - guess;
    return guess - offset;
  }
  function fmtClock(epoch, tz, withSeconds = true) {
    if (epoch == null) return '–';
    return new Intl.DateTimeFormat('it-IT', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: withSeconds ? '2-digit' : undefined, hourCycle: 'h23' }).format(new Date(epoch));
  }
  function waveById(id) { return RACE.waves.find((w) => w.id === id) || null; }
  function waveEpoch(id) { const w = waveById(id); return w ? zonedEpoch(RACE.dateLocal, w.time, RACE.tz) : null; }
  function raceDayEpoch(timeStr) { return zonedEpoch(RACE.dateLocal, timeStr, RACE.tz); }

  /* Classificazione pettorale: 1-99 uomini pro, 101-199 donne pro (convenzione NYRR). */
  function bibKind(bib) {
    const n = parseInt(String(bib).replace(/\D/g, ''), 10);
    if (/^[A-Za-z]/.test(String(bib))) return 'other';
    if (n >= 1 && n <= 99) return 'proM';
    if (n >= 101 && n <= 199) return 'proW';
    return 'mass';
  }

  const FLAGS = { ITA: '🇮🇹', USA: '🇺🇸', KEN: '🇰🇪', ETH: '🇪🇹', GBR: '🇬🇧', FRA: '🇫🇷', GER: '🇩🇪', ESP: '🇪🇸', NED: '🇳🇱', BRA: '🇧🇷', MEX: '🇲🇽', CAN: '🇨🇦', JPN: '🇯🇵', AUS: '🇦🇺', SUI: '🇨🇭', BEL: '🇧🇪', NOR: '🇳🇴', SWE: '🇸🇪', DEN: '🇩🇰', POL: '🇵🇱', ARG: '🇦🇷', COL: '🇨🇴', CHI: '🇨🇱', IRL: '🇮🇪', POR: '🇵🇹', AUT: '🇦🇹', UGA: '🇺🇬', TAN: '🇹🇿', ERI: '🇪🇷', MAR: '🇲🇦', CHN: '🇨🇳', KOR: '🇰🇷', IND: '🇮🇳', RSA: '🇿🇦', NZL: '🇳🇿', ISR: '🇮🇱', TUR: '🇹🇷', GRE: '🇬🇷', CZE: '🇨🇿', HUN: '🇭🇺', FIN: '🇫🇮', PER: '🇵🇪', VEN: '🇻🇪', ECU: '🇪🇨', CRC: '🇨🇷', GUA: '🇬🇹', DOM: '🇩🇴', PUR: '🇵🇷', PHI: '🇵🇭', TPE: '🇹🇼', HKG: '🇭🇰', SGP: '🇸🇬', UKR: '🇺🇦', ROU: '🇷🇴', SVK: '🇸🇰', SLO: '🇸🇮', CRO: '🇭🇷', SRB: '🇷🇸', BUL: '🇧🇬', LUX: '🇱🇺', ISL: '🇮🇸' };
  function flag(code) { return FLAGS[String(code || '').toUpperCase()] || '🏳️'; }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function haversineM(a, b) {
    const R = 6371000, toR = Math.PI / 180;
    const dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function load(key, def) { try { const v = localStorage.getItem(key); return v == null ? def : JSON.parse(v); } catch (e) { return def; } }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ } }

  return { RACE, MI, SPLIT_KM, SPLIT_LABEL, parseTime, fmtTime, fmtGap, fmtPace, fmtKm, fmtNum, fmtDuration, zonedEpoch, fmtClock, waveById, waveEpoch, raceDayEpoch, bibKind, flag, esc, clamp, haversineM, load, save };
})();
