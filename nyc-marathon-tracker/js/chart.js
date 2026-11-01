/* Grafico del passo per tratto (SVG, senza librerie): linee 2px, marker 8px con anello, griglia hairline, tooltip. */
window.PaceChart = (function () {
  const NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs, children) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    for (const c of children || []) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return e;
  }

  /* series: [{name, color, points:[{km, pace, code}]}] - pace in secondi/km */
  function render(container, series, opts = {}) {
    container.innerHTML = '';
    const all = series.flatMap((s) => s.points);
    if (!all.length) { container.innerHTML = '<div class="chart-empty">Il grafico del passo apparirà dopo il primo passaggio al 5 km.</div>'; return; }
    const W = Math.max(280, container.clientWidth || 360), H = 200;
    const m = { t: 16, r: 14, b: 30, l: 46 };
    const x0 = m.l, x1 = W - m.r, y0 = m.t, y1 = H - m.b;
    const kmMax = U.RACE.distanceKm;
    let pMin = Math.min(...all.map((p) => p.pace)), pMax = Math.max(...all.map((p) => p.pace));
    const pad = Math.max(10, (pMax - pMin) * 0.15); pMin -= pad; pMax += pad;
    const sx = (km) => x0 + (km / kmMax) * (x1 - x0);
    const sy = (pace) => y0 + ((pace - pMin) / (pMax - pMin)) * (y1 - y0); // passo lento in basso, veloce in alto
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'pace-chart', role: 'img', 'aria-label': opts.ariaLabel || 'Grafico del passo per tratto' });

    // griglia y (passo): tick ogni 15 o 30 s
    const step = (pMax - pMin) > 240 ? 60 : (pMax - pMin) > 90 ? 30 : 15;
    for (let p = Math.ceil(pMin / step) * step; p <= pMax; p += step) {
      svg.appendChild(el('line', { x1: x0, x2: x1, y1: sy(p), y2: sy(p), class: 'grid' }));
      svg.appendChild(el('text', { x: x0 - 6, y: sy(p) + 4, class: 'tick', 'text-anchor': 'end' }, [U.fmtPace(p)]));
    }
    // asse x (km)
    svg.appendChild(el('line', { x1: x0, x2: x1, y1: y1, y2: y1, class: 'axis' }));
    for (const km of [0, 10, 20, 30, 40]) svg.appendChild(el('text', { x: sx(km), y: y1 + 16, class: 'tick', 'text-anchor': 'middle' }, [km + ' km']));
    svg.appendChild(el('text', { x: x0 - 6, y: y0 - 4, class: 'tick', 'text-anchor': 'end' }, ['min/km']));

    series.forEach((s) => {
      if (!s.points.length) return;
      const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.km).toFixed(1)},${sy(p.pace).toFixed(1)}`).join(' ');
      svg.appendChild(el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.dashed ? '6 4' : 'none' }));
      s.points.forEach((p) => {
        svg.appendChild(el('circle', { cx: sx(p.km), cy: sy(p.pace), r: 6, class: 'ring' }));
        svg.appendChild(el('circle', { cx: sx(p.km), cy: sy(p.pace), r: 4, fill: s.color }));
      });
      const last = s.points[s.points.length - 1];
      if (s.label !== false) svg.appendChild(el('text', { x: Math.min(sx(last.km) + 8, x1 - 30), y: sy(last.pace) - 8, class: 'end-label' }, [U.fmtPace(last.pace)]));
    });

    // tooltip al passaggio del mouse (split più vicino sull'asse x)
    const tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true;
    const cross = el('line', { x1: 0, x2: 0, y1: y0, y2: y1, class: 'crosshair', visibility: 'hidden' });
    svg.appendChild(cross);
    const kms = [...new Set(all.map((p) => p.km))].sort((a, b) => a - b);
    svg.addEventListener('mousemove', (ev) => {
      const rect = svg.getBoundingClientRect();
      const km = ((ev.clientX - rect.left) / rect.width * W - x0) / (x1 - x0) * kmMax;
      let best = kms[0]; for (const k of kms) if (Math.abs(k - km) < Math.abs(best - km)) best = k;
      cross.setAttribute('x1', sx(best)); cross.setAttribute('x2', sx(best)); cross.setAttribute('visibility', 'visible');
      const rows = series.map((s) => { const p = s.points.find((q) => Math.abs(q.km - best) < 0.01); return p ? `<div><span class="sw" style="background:${s.color}"></span>${U.esc(s.name)}: <b>${U.fmtPace(p.pace)}</b> min/km</div>` : ''; }).join('');
      tip.innerHTML = `<div class="tt-title">Tratto fino al km ${U.fmtKm(best, best % 1 ? 1 : 0)}</div>${rows}`;
      tip.hidden = false;
      const left = Math.min(rect.width - 170, Math.max(0, (ev.clientX - rect.left) + 12));
      tip.style.left = left + 'px'; tip.style.top = (ev.clientY - rect.top - 10) + 'px';
    });
    svg.addEventListener('mouseleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });

    const wrap = document.createElement('div'); wrap.className = 'chart-wrap'; wrap.appendChild(svg); wrap.appendChild(tip);
    container.appendChild(wrap);
    if (series.length >= 2) {
      const legend = document.createElement('div'); legend.className = 'chart-legend';
      legend.innerHTML = series.map((s) => `<span><span class="sw" style="background:${s.color}"></span>${U.esc(s.name)}</span>`).join('');
      container.appendChild(legend);
    }
    // vista tabellare (accessibilità)
    const det = document.createElement('details'); det.className = 'chart-table';
    det.innerHTML = `<summary>Vedi come tabella</summary><table><thead><tr><th>Tratto</th>${series.map((s) => `<th>${U.esc(s.name)}</th>`).join('')}</tr></thead><tbody>${kms.map((k) => `<tr><td>km ${U.fmtKm(k, k % 1 ? 1 : 0)}</td>${series.map((s) => { const p = s.points.find((q) => Math.abs(q.km - k) < 0.01); return `<td>${p ? U.fmtPace(p.pace) : '–'}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
    container.appendChild(det);
  }
  return { render };
})();
