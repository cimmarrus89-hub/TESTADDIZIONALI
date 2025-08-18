\
from dataclasses import dataclass
from typing import List, Optional, Dict, Any, Tuple
import re, math

# IRPEF scaglioni nazionali per anno (solo soglie; servono a mappare gli scaglioni locali)
# Nota: per ampliare, aggiungere altri anni con le rispettive soglie.
IRPEF_SCAGLIONI = {
    2025: [(0, 28_000), (28_000, 50_000), (50_000, None)],
    2024: [(0, 28_000), (28_000, 50_000), (50_000, None)],
    # 2023: [(0, 15_000),(15_000, 28_000),(28_000, 50_000),(50_000, None)],  # esempio se servisse per fallback
}

def _parse_rate(val: str) -> Optional[float]:
    """Converte stringhe tipo '0,8' oppure '0.8' o '0,80%' in rate decimale (0.008)."""
    if val is None:
        return None
    s = str(val).strip()
    if not s or s == "0*":
        return None
    s = s.replace("%","").replace(" ", "")
    s = s.replace(",", ".")
    try:
        f = float(s)
        # I dataset MEF riportano l'aliquota come percentuale in punti, es. 0,8 = 0.8% => 0.008
        if f > 1.0:  # se qualcuno mette 8 ==> 8% => 0.08
            return f / 100.0
        return f / 100.0
    except ValueError:
        return None

def _parse_amount(val: str) -> Optional[float]:
    """Converte importi con formati italiani/es. '28.000,00' -> 28000.0."""
    if val is None:
        return None
    s = str(val).strip()
    if not s or s == "0*":
        return None
    # rimuovi punti come separatori migliaia, poi sostituisci virgola con punto
    s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None

@dataclass
class Bracket:
    lower: float
    upper: Optional[float]  # None significa "oltre"
    rate: float             # es. 0.008 per 0,8%

@dataclass
class CalcResult:
    imponibile: float
    componente: str    # "comunale" o "regionale"
    aliquota_unica: Optional[float]
    soglia_esenzione: float
    scaglioni: List[Bracket]
    imposta: float
    avvisi: List[str]
    note_raw: Optional[str]
    fonte_anno: int
    cod_catastale: Optional[str] = None
    denominazione: Optional[str] = None

def _apply_brackets(imponibile: float, brackets: List[Bracket], esenzione: float = 0.0) -> float:
    base = max(0.0, imponibile - (esenzione or 0.0))
    tax = 0.0
    for b in brackets:
        low = b.lower
        up = b.upper if b.upper is not None else base  # se None, usa tutto il resto
        # quantità imponibile nel bracket
        amount = max(0.0, min(base, up) - low)
        if amount > 0:
            tax += amount * b.rate
    return round(tax, 2)

def build_brackets_from_rates(year: int, rates: List[float]) -> List[Bracket]:
    """Costruisce gli scaglioni locali allineando la lista di aliquote alle soglie IRPEF nazionali dell'anno."""
    soglie = IRPEF_SCAGLIONI.get(year) or IRPEF_SCAGLIONI[max(IRPEF_SCAGLIONI.keys())]
    brackets: List[Bracket] = []
    for i, soglia in enumerate(soglie):
        if i < len(rates) and rates[i] is not None:
            lower, upper = soglia
            brackets.append(Bracket(lower=lower, upper=upper, rate=rates[i]))
    return brackets

def compute_addizionale_unica(imponibile: float, rate: float, esenzione: float = 0.0) -> float:
    base = max(0.0, imponibile - (esenzione or 0.0))
    return round(base * rate, 2)

def compute_component(
    imponibile: float,
    year: int,
    flag: int,
    rates: List[Optional[str]],
    esenzione_raw: Optional[str],
    componente: str,
    note_raw: Optional[str] = None,
    cod_catastale: Optional[str] = None,
    denominazione: Optional[str] = None
) -> CalcResult:
    """
    Calcola l'addizionale per un componente (comunale/regionale) data la semantica MEF:
    flag 1: aliquota unica
    flag 2: aliquota unica con esenzione
    flag 3: scaglioni
    flag 4: scaglioni con esenzione
    flag 5: aliquota unica con esenzioni specifiche (categoria)
    flag 6: scaglioni con esenzioni specifiche
    flag 0: casi specifici (non standard) -> si tenta best-effort
    """
    avvisi = []
    esenzione = _parse_amount(esenzione_raw) or 0.0
    clean_rates = [_parse_rate(x) for x in rates if x is not None]
    clean_rates = [r for r in clean_rates if r is not None]

    if flag in (1, 2, 5):
        if not clean_rates:
            avvisi.append("Aliquota unica non reperita nei dati MEF.")
            imposta = 0.0
            rate = None
        else:
            rate = clean_rates[0]
            imposta = compute_addizionale_unica(imponibile, rate, esenzione if flag in (2,5) else 0.0)
        if flag in (5, 6):
            avvisi.append("Attenzione: questo ente prevede esenzioni specifiche di categoria; verifica le note prima di applicare il risultato.")
        return CalcResult(
            imponibile=imponibile, componente=componente, aliquota_unica=rate if clean_rates else None,
            soglia_esenzione=esenzione if flag in (2,5) else 0.0, scaglioni=[],
            imposta=imposta, avvisi=avvisi, note_raw=note_raw, fonte_anno=year,
            cod_catastale=cod_catastale, denominazione=denominazione
        )

    elif flag in (3, 4, 6, 0):
        # scaglioni: allineiamo ai scaglioni IRPEF dell'anno
        if not clean_rates:
            avvisi.append("Aliquote per scaglioni non reperite nei dati MEF.")
            br = []
        else:
            br = build_brackets_from_rates(year, clean_rates)
        if flag in (4, 6):
            esenz = esenzione
        else:
            esenz = 0.0
        if flag in (5, 6):
            avvisi.append("Attenzione: esenzioni specifiche di categoria; verifica le note.")
        imposta = _apply_brackets(imponibile, br, esenz)
        return CalcResult(
            imponibile=imponibile, componente=componente, aliquota_unica=None,
            soglia_esenzione=esenz, scaglioni=br, imposta=imposta, avvisi=avvisi,
            note_raw=note_raw, fonte_anno=year, cod_catastale=cod_catastale, denominazione=denominazione
        )
    else:
        avvisi.append("Flag metodo non riconosciuto; calcolo non eseguibile.")
        return CalcResult(
            imponibile=imponibile, componente=componente, aliquota_unica=None, soglia_esenzione=0.0,
            scaglioni=[], imposta=0.0, avvisi=avvisi, note_raw=note_raw, fonte_anno=year,
            cod_catastale=cod_catastale, denominazione=denominazione
        )
