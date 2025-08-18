\
import pandas as pd
import httpx
from typing import Dict, Any, Tuple, List, Optional
import time, os, io, datetime, re, json

# Endpoint ufficiali MEF (CSV elenchi generali aggiornati quotidianamente)
COMUNALE_URL_TEMPLATE = "https://www1.finanze.gov.it/finanze2/dipartimentopolitichefiscali/fiscalitalocale/nuova_addcomirpef/download/download.php?anno={year}"
REGIONALE_URL_TEMPLATE = "https://www1.finanze.gov.it/finanze2/dipartimentopolitichefiscali/fiscalitalocale/addregirpef/download/download.php?anno={year}&tipo=reg"

DATA_DIR = os.environ.get("DATA_DIR", "./data")
os.makedirs(DATA_DIR, exist_ok=True)

def _fetch_csv(url: str, timeout=60) -> bytes:
    headers = {"User-Agent": "AddizionaliBot/1.0 (+https://example.local)"}
    with httpx.Client(timeout=timeout, headers=headers) as client:
        r = client.get(url)
        r.raise_for_status()
        return r.content

def _save_bytes(content: bytes, path: str):
    with open(path, "wb") as f:
        f.write(content)

def available_year() -> int:
    # di default usiamo l'anno corrente
    return datetime.date.today().year

def download_all(year: Optional[int] = None) -> Dict[str, str]:
    """Scarica i CSV comunale e regionale per l'anno indicato (default: anno corrente). Restituisce i percorsi locali."""
    if year is None:
        year = available_year()
    paths = {}
    # Comunale
    cu = COMUNALE_URL_TEMPLATE.format(year=year)
    cc = _fetch_csv(cu)
    cpath = os.path.join(DATA_DIR, f"comunale_{year}.csv")
    _save_bytes(cc, cpath)
    paths["comunale"] = cpath
    # Regionale
    ru = REGIONALE_URL_TEMPLATE.format(year=year)
    rc = _fetch_csv(ru)
    rpath = os.path.join(DATA_DIR, f"regionale_{year}.csv")
    _save_bytes(rc, rpath)
    paths["regionale"] = rpath
    # write a small meta file
    meta = {"year": year, "timestamp": datetime.datetime.now().isoformat()}
    with open(os.path.join(DATA_DIR, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    return paths

def _read_csv_safely(path: str) -> pd.DataFrame:
    # MEF usa ; come separatore e spesso latin-1 o UTF-8
    # Tentiamo con encoding comuni
    for enc in ("utf-8-sig", "latin-1", "cp1252", "utf-8"):
        try:
            return pd.read_csv(path, sep=";", encoding=enc, dtype=str)
        except Exception:
            continue
    # tentativo crudo
    return pd.read_csv(path, sep=";", dtype=str)

def load_latest(year: Optional[int] = None) -> Tuple[pd.DataFrame, pd.DataFrame, Dict[str, Any]]:
    """Carica l'ultimo CSV disponibile (se mancante prova a scaricare) e restituisce (df_comunale, df_regionale, meta)."""
    if year is None:
        year = available_year()
    # ensure files exist
    cpath = os.path.join(DATA_DIR, f"comunale_{year}.csv")
    rpath = os.path.join(DATA_DIR, f"regionale_{year}.csv")
    if not (os.path.exists(cpath) and os.path.exists(rpath)):
        download_all(year)
    dfc = _read_csv_safely(cpath)
    dfr = _read_csv_safely(rpath)
    meta_path = os.path.join(DATA_DIR, "meta.json")
    meta = {"year": year, "timestamp": None}
    if os.path.exists(meta_path):
        try:
            import json
            meta = json.load(open(meta_path, "r", encoding="utf-8"))
        except Exception:
            pass
    return dfc, dfr, meta

def normalize_headers(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [re.sub(r"\s+", " ", str(c)).strip() for c in df.columns]
    return df

def extract_fields_comunale(row: pd.Series) -> Dict[str, Any]:
    """Estrae campi chiave da una riga del CSV comunale, in modo robusto agli header."""
    d = {c.lower(): str(row[c]) for c in row.index}
    # campi base
    codice = row.iloc[0] if len(row) > 0 else None  # col A
    denominazione = row.iloc[1] if len(row) > 1 else None  # col B
    provincia = row.iloc[2] if len(row) > 2 else None  # col C
    # Note e Flag
    flag = None
    esenzione = None
    note = None
    # proietto su header per cercare chiavi
    for i, col in enumerate(row.index):
        name = str(col).lower()
        val = str(row[col]) if not pd.isna(row[col]) else None
        if "flag" in name:
            try:
                flag = int(float(str(val).replace(",", ".")))
            except Exception:
                flag = None
        if "note" in name or "nota" in name:
            note = val
        if "esenz" in name and ("importo" in name or "fino" in name or "applica" in name):
            esenzione = val
    # aliquote (tutte le colonne che contengono 'aliquota')
    aliquote_vals: List[str] = []
    for col in row.index:
        name = str(col).lower()
        val = None if pd.isna(row[col]) else str(row[col])
        if "aliquota" in name:
            aliquote_vals.append(val)
    return {
        "codice": codice, "denominazione": denominazione, "provincia": provincia,
        "flag": flag, "esenzione": esenzione, "aliquote": aliquote_vals, "note": note
    }

def extract_fields_regionale(row: pd.Series) -> Dict[str, Any]:
    """Estrae campi chiave da una riga del CSV regionale."""
    d = {c.lower(): str(row[c]) for c in row.index}
    # La prima colonna è la regione, poi ci sono varie colonne con aliquote e descrizioni
    regione = row.iloc[0] if len(row) > 0 else None
    flag = None
    esenzione = None
    note = None
    aliquote_vals: List[str] = []
    for col in row.index:
        name = str(col).lower()
        val = None if pd.isna(row[col]) else str(row[col])
        if "flag" in name:  # non sempre presente nel regionale
            try:
                flag = int(float(val.replace(",", ".")))
            except Exception:
                flag = None
        if "esenz" in name and ("importo" in name or "fino" in name or "applica" in name):
            esenzione = val
        if "aliquota" in name:
            aliquote_vals.append(val)
        if "note" in name or "nota" in name:
            note = val
    # Heuristics: se non c'è flag, deduciamo da quante aliquote >0 ci sono (1 => unica, >=2 => scaglioni)
    numeric_rates = []
    for a in aliquote_vals:
        try:
            s = str(a).strip().replace("%","").replace(" ","").replace(",",".")
            if s and s != "0*":
                f = float(s)
                numeric_rates.append(f)
        except Exception:
            pass
    if flag is None:
        if len([x for x in numeric_rates if x > 0]) <= 1:
            flag = 1
        else:
            flag = 3
    return {"regione": regione, "flag": flag, "esenzione": esenzione, "aliquote": aliquote_vals, "note": note}

