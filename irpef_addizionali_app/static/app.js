async function api(path, opts={}){
  const r = await fetch(path, {headers: {"Content-Type":"application/json"}, ...opts});
  if(!r.ok){ throw new Error(await r.text()); }
  return await r.json();
}

function euro(n){
  return n.toLocaleString('it-IT',{style:'currency',currency:'EUR', maximumFractionDigits:2});
}

function ratePct(r){
  if(r == null) return '-';
  return (r*100).toLocaleString('it-IT', {maximumFractionDigits:3}) + '%';
}

function bracketStr(b){
  const a = b.lower; const u = b.upper;
  const range = (u === null || u === undefined) ? `oltre ${a.toLocaleString('it-IT')}` : `${a.toLocaleString('it-IT')}–${u.toLocaleString('it-IT')}`;
  return `${range} → ${ratePct(b.rate)}`;
}

async function init(){
  // status
  try{
    const s = await api('/api/status');
    const el = document.getElementById('status');
    const when = s.last_refresh ? new Date(s.last_refresh).toLocaleString('it-IT') : '—';
    el.textContent = `Anno ${s.year} • Comuni: ${s.rows_comuni} • Regioni: ${s.rows_regioni} • Aggiornato: ${when}`;
  }catch(e){}

  // regioni
  const regSel = document.getElementById('regione');
  const comuniSel = document.getElementById('comune');
  regSel.innerHTML = '<option value="" disabled selected>Seleziona regione</option>';
  comuniSel.innerHTML = '<option value="" disabled selected>Seleziona comune</option>';
  try{
    const j = await api('/api/regions');
    j.regions.forEach(r => {
      const o = document.createElement('option'); o.value=r; o.textContent=r; regSel.appendChild(o);
    });
  }catch(e){
    alert('Errore nel caricamento delle regioni: '+e.message);
  }

  regSel.addEventListener('change', async () => {
    comuniSel.disabled = true;
    comuniSel.innerHTML = '<option value="" disabled selected>Caricamento…</option>';
    try{
      const j = await api('/api/municipalities?region='+encodeURIComponent(regSel.value));
      comuniSel.innerHTML = '<option value="" disabled selected>Seleziona comune</option>';
      j.municipalities.forEach(m => {
        const o = document.createElement('option');
        o.value = m.codice_catastale;
        o.textContent = `${m.comune} (${m.provincia})`;
        o.dataset.provincia = m.provincia;
        comuniSel.appendChild(o);
      });
      comuniSel.disabled = false;
    }catch(e){
      comuniSel.innerHTML = '<option value="" disabled selected>Errore</option>';
      alert('Errore nel caricamento dei comuni: '+e.message);
    }
  });

  document.getElementById('reset').addEventListener('click', () => {
    document.getElementById('calc-form').reset();
    document.getElementById('risultato').classList.add('hidden');
    comuniSel.disabled = true;
    comuniSel.innerHTML = '<option value="" disabled selected>Seleziona comune</option>';
  });

  document.getElementById('calcola').addEventListener('click', async () => {
    const imponibile = parseFloat(document.getElementById('imponibile').value || '0');
    if(!imponibile || imponibile <= 0){
      alert('Inserisci un reddito imponibile valido.');
      return;
    }
    const regione = regSel.value;
    const cod = comuniSel.value;
    if(!regione || !cod){ alert('Seleziona regione e comune.'); return; }

    try{
      const res = await api('/api/calc', {method:'POST', body: JSON.stringify({imponibile, regione, codice_catastale: cod})});
      renderResult(res);
    }catch(e){
      alert('Errore nel calcolo: '+e.message);
    }
  });
}

function renderComponent(el, comp){
  if(!comp){ el.innerHTML = '<div class="muted">—</div>'; return; }
  const parts = [];
  if(comp.aliquota_unica != null){
    parts.push(`<div><span class="pill">Aliquota unica</span> ${ratePct(comp.aliquota_unica)}</div>`);
  }else if(comp.scaglioni && comp.scaglioni.length){
    const list = comp.scaglioni.map(bracketStr).map(s => `<li>${s}</li>`).join('');
    parts.push(`<div><span class="pill">Scaglioni</span><ul class="ul">${list}</ul></div>`);
  }
  if(comp.soglia_esenzione && comp.soglia_esenzione > 0){
    parts.push(`<div class="muted">Soglia di esenzione: € ${comp.soglia_esenzione.toLocaleString('it-IT')}</div>`);
  }
  parts.push(`<div class="amount">${euro(comp.imposta)}</div>`);
  if(comp.avvisi && comp.avvisi.length){
    parts.push(`<div class="warn">${comp.avvisi.join(' ')}</div>`);
  }
  el.innerHTML = parts.join('');
}

function renderResult(res){
  document.getElementById('risultato').classList.remove('hidden');
  renderComponent(document.getElementById('res-comunale'), res.comunale);
  renderComponent(document.getElementById('res-regionale'), res.regionale);
  document.getElementById('res-totale').textContent = euro(res.totale);

  const notes = [];
  if(res.comunale && res.comunale.note_raw){
    notes.push(`<strong>Note comunale:</strong> ${res.comunale.note_raw}`);
  }
  if(res.regionale && res.regionale.note_raw){
    notes.push(`<strong>Note regionale:</strong> ${res.regionale.note_raw}`);
  }
  document.getElementById('note').innerHTML = notes.join('<br>');
}

window.addEventListener('DOMContentLoaded', init);
