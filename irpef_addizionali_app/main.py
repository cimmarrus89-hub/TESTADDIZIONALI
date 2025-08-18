\
import os, json, datetime
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, Query
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from apscheduler.schedulers.background import BackgroundScheduler
import pandas as pd

from province_to_region import PROVINCIA_TO_REGIONE, REGIONI_ORDINATE
from calculators import compute_component
import data_loader as dl

app = FastAPI(title="Calcolatore Addizionali IRPEF", version="1.0.0")

# Static
app.mount("/static", StaticFiles(directory="static"), name="static")

LATEST_CACHE: Dict[str, Any] = {
    "dfc": None,
    "dfr": None,
    "meta": None,
    "year": None,
}

def refresh_data(year: Optional[int] = None) -> Dict[str, Any]:
    dfc, dfr, meta = dl.load_latest(year)
    dfc = dl.normalize_headers(dfc)
    dfr = dl.normalize_headers(dfr)
    LATEST_CACHE["dfc"] = dfc
    LATEST_CACHE["dfr"] = dfr
    LATEST_CACHE["meta"] = meta
    LATEST_CACHE["year"] = meta.get("year") if meta else year
    return {"ok": True, "year": LATEST_CACHE["year"], "rows_comuni": len(dfc), "rows_regioni": len(dfr), "meta": meta}

# schedule ogni 15 giorni
scheduler = BackgroundScheduler()
scheduler.add_job(lambda: refresh_data(None), "interval", days=15, id="refresh-15d", replace_existing=True)
scheduler.start()

# caricamento iniziale
refresh_data(None)

@app.get("/", response_class=HTMLResponse)
def index():
    with open("static/index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())

@app.get("/api/status")
def status():
    meta = LATEST_CACHE.get("meta") or {}
    return {
        "year": LATEST_CACHE.get("year"),
        "last_refresh": meta.get("timestamp"),
        "rows_comuni": int(LATEST_CACHE.get("dfc").shape[0]) if LATEST_CACHE.get("dfc") is not None else 0,
        "rows_regioni": int(LATEST_CACHE.get("dfr").shape[0]) if LATEST_CACHE.get("dfr") is not None else 0,
    }

@app.post("/api/refresh")
def manual_refresh(year: Optional[int] = Query(None, description="Anno da aggiornare (default anno corrente)")):
    return refresh_data(year)

@app.get("/api/regions")
def list_regions():
    # Dal CSV regionale prendiamo la prima colonna come nome regione; ma per filtro comuni useremo mapping provincia->regione
    regions = list(set(PROVINCIA_TO_REGIONE.values()))
    # Ordina secondo elenco canonico
    ordered = [r for r in REGIONI_ORDINATE if r in regions]
    return {"regions": ordered}

@app.get("/api/municipalities")
def list_municipalities(region: str = Query(..., description="Nome regione")):
    dfc = LATEST_CACHE["dfc"]
    if dfc is None:
        return JSONResponse({"error": "Dati non caricati"}, status_code=503)
    # colonna provincia è terza (indice 2)
    records = []
    for _, row in dfc.iterrows():
        prov = str(row.iloc[2]) if len(row) > 2 else None
        reg = PROVINCIA_TO_REGIONE.get(prov, None)
        if reg == region:
            records.append({
                "codice_catastale": str(row.iloc[0]),
                "comune": str(row.iloc[1]),
                "provincia": prov
            })
    # elimina duplicati/ordinamento
    uniq = {(r["codice_catastale"], r["comune"], r["provincia"]) for r in records}
    out = [{"codice_catastale": a, "comune": b.title(), "provincia": c} for (a,b,c) in sorted(uniq, key=lambda x: (x[1], x[2]))]
    return {"municipalities": out}

@app.post("/api/calc")
async def calc(payload: Dict[str, Any]):
    """payload: {imponibile: float, regione: str, codice_catastale: str}"""
    dfc = LATEST_CACHE["dfc"]
    dfr = LATEST_CACHE["dfr"]
    year = LATEST_CACHE["year"] or dl.available_year()
    if dfc is None or dfr is None:
        return JSONResponse({"error": "Dati non caricati"}, status_code=503)
    imponibile = float(payload.get("imponibile", 0) or 0)
    regione = payload.get("regione")
    cod_cat = payload.get("codice_catastale")

    # --- comunale ---
    rowc = None
    if cod_cat:
        # filtro per codice catastale
        try:
            rowc = dfc[dfc.iloc[:,0].astype(str) == str(cod_cat)].iloc[0]
        except Exception:
            rowc = None
    comunale = None
    if rowc is not None:
        from data_loader import extract_fields_comunale
        fc = extract_fields_comunale(rowc)
        comunale = compute_component(
            imponibile=imponibile, year=year, flag=fc.get("flag") or 1,
            rates=fc.get("aliquote") or [], esenzione_raw=fc.get("esenzione"),
            componente="comunale", note_raw=fc.get("note"), cod_catastale=fc.get("codice"),
            denominazione=fc.get("denominazione")
        )
    # --- regionale ---
    rowr = None
    if regione:
        # regioni: prima colonna del df regionale è il nome
        try:
            rowr = dfr[dfr.iloc[:,0].astype(str).str.lower().str.strip() == str(regione).lower().strip()].iloc[0]
        except Exception:
            rowr = None
    regionale = None
    if rowr is not None:
        from data_loader import extract_fields_regionale
        fr = extract_fields_regionale(rowr)
        regionale = compute_component(
            imponibile=imponibile, year=year, flag=fr.get("flag") or 1,
            rates=fr.get("aliquote") or [], esenzione_raw=fr.get("esenzione"),
            componente="regionale", note_raw=fr.get("note")
        )

    totale = (comunale.imposta if comunale else 0.0) + (regionale.imposta if regionale else 0.0)
    return {
        "year": year,
        "input": {"imponibile": imponibile, "regione": regione, "codice_catastale": cod_cat},
        "comunale": comunale.__dict__ if comunale else None,
        "regionale": regionale.__dict__ if regionale else None,
        "totale": round(totale, 2),
    }
