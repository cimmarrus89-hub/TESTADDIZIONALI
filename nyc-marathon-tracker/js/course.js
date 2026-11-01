/* Geometria del percorso: posizione lungo il tracciato, split, landmark, borough. */
window.Course = (function () {
  let C = null; // dati caricati da data/course.json

  async function load(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Percorso non caricato: HTTP ' + res.status);
    C = await res.json();
    return C;
  }

  /* Converte una distanza ufficiale (m) nella distanza lungo la polilinea usando le ancore. */
  function toPoly(officialM) {
    const A = C.anchors;
    if (officialM <= 0) return 0;
    for (let i = 1; i < A.length; i++) {
      if (officialM <= A[i][0]) {
        const [o0, p0] = A[i - 1], [o1, p1] = A[i];
        return p0 + (p1 - p0) * (officialM - o0) / (o1 - o0);
      }
    }
    return A[A.length - 1][1];
  }

  /* Posizione [lat, lon] e direzione (gradi) a una distanza ufficiale in metri. */
  function posAt(officialM) {
    const d = U.clamp(toPoly(officialM), 0, C.cum[C.cum.length - 1]);
    const cum = C.cum, coords = C.coords;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
    const a = coords[lo], b = coords[Math.min(hi, coords.length - 1)];
    const seg = cum[hi] - cum[lo];
    const t = seg > 0 ? (d - cum[lo]) / seg : 0;
    const lat = a[0] + (b[0] - a[0]) * t, lon = a[1] + (b[1] - a[1]) * t;
    const bearing = (Math.atan2((b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI + 360) % 360;
    return { lat, lon, bearing };
  }

  function boroughAt(km) {
    return (C.boroughs || []).find((b) => km >= b.fromKm && km < b.toKm) || C.boroughs[C.boroughs.length - 1];
  }
  function nextLandmark(km) { return (C.landmarks || []).find((l) => l.km > km + 0.05) || null; }
  function lastLandmark(km) { const past = (C.landmarks || []).filter((l) => l.km <= km + 0.05); return past.length ? past[past.length - 1] : null; }
  function bridgesPassed(km) { return (C.landmarks || []).filter((l) => l.bridge && l.km <= km).map((l) => l.name); }

  return { load, get data() { return C; }, toPoly, posAt, boroughAt, nextLandmark, lastLandmark, bridgesPassed };
})();
