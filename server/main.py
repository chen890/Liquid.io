"""
EquityLens extraction server (Python / FastAPI)

Endpoints
---------
GET  /api/health   — liveness + backend status
POST /api/extract  — extract equity grants from document text

Auth flow (Sofia preferred, restored from ca2f93d)
---------
1. Read MEEZEH_USERNAME / MEEZEH_PASSWORD from .env
2. Call me_auth_client.meezeh_app.get_token_by_username_password() → bearer token
3. Cache token for 50 minutes, refresh on expiry
4. Call Sofia's OpenAI-compatible chat/completions endpoint with the token
5. Parse JSON response → return grants list

Fallback: if Sofia/Meezeh is not configured, use the user-selected provider
(`openai`, `anthropic`, or `grok`) with keys from the app and/or `.env`.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Literal

import httpx
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Default dev origins (Vite + preview). Override with CORS_ORIGINS=comma,separated
_DEFAULT_CORS = (
    "http://localhost:5173,http://127.0.0.1:5173,"
    "http://localhost:4173,http://127.0.0.1:4173"
)

# ── Load .env from project root ───────────────────────────────────────────────
ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env", override=True)

# ── Config ────────────────────────────────────────────────────────────────────
PORT = int(os.getenv("EXTRACTION_SERVER_PORT", "3712"))
SOFIA_BASE = os.getenv("SOFIA_BASE_URL", "https://sofia-api.lgw.cloud.mobileye.com/v1/api").rstrip("/")
SOFIA_MODEL = os.getenv("SOFIA_MODEL_ID", "us.anthropic.claude-opus-4-5-20251101-v1:0")
MEEZEH_USER = os.getenv("MEEZEH_USERNAME", "")
MEEZEH_PASS = os.getenv("MEEZEH_PASSWORD", "")
SOFIA_API_KEY = os.getenv("SOFIA_API_KEY", "")  # pre-obtained token, skips Meezeh auth
OPENAI_KEY = os.getenv("OPENAI_API_KEY", "").strip()
ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
GROK_KEY = (os.getenv("GROK_API_KEY", "") or os.getenv("XAI_API_KEY", "")).strip()
OPENAI_CHAT_MODEL = os.getenv("OPENAI_EXTRACTION_MODEL", "gpt-4o").strip()
ANTHROPIC_CHAT_MODEL = os.getenv("ANTHROPIC_EXTRACTION_MODEL", "claude-sonnet-4-20250514").strip()
GROK_CHAT_MODEL = os.getenv("GROK_EXTRACTION_MODEL", "grok-3-latest").strip()

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger("equitylens")

# ── Meezeh token cache ────────────────────────────────────────────────────────
_token: str = ""
_token_expiry: float = 0.0  # epoch seconds
TOKEN_TTL = 50 * 60  # 50 minutes


def get_sofia_token() -> str:
    """Return a valid Sofia bearer token, trying sources in priority order:
       1. SOFIA_API_KEY  — pre-obtained token pasted directly into .env
       2. Meezeh username/password  — auto-refreshed via me_auth_client
    """
    global _token, _token_expiry

    # 1. Static pre-obtained token
    if SOFIA_API_KEY:
        return SOFIA_API_KEY

    # 2. Cached Meezeh token
    if _token and time.time() < _token_expiry:
        return _token

    if not MEEZEH_USER or not MEEZEH_PASS:
        return ""

    try:
        from me_auth_client import meezeh_app  # type: ignore[import]

        token: str = meezeh_app.get_token_by_username_password(MEEZEH_USER, MEEZEH_PASS)
        if token:
            _token = token
            _token_expiry = time.time() + TOKEN_TTL
            log.info("Meezeh token refreshed  (%s...)", token[:16])
        return _token
    except Exception as exc:
        log.error("Meezeh token fetch failed: %s", exc)
        return ""


# ── System prompt ─────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are an expert equity compensation analyst. Extract ALL stock grants, RSUs, stock options, and equity awards from the document provided.

The document may be a brokerage statement (Morgan Stanley, Fidelity, E*TRADE, Schwab, Carta, etc.) with tables like:

  Grant Date | Number   | Type | Symbol | Quantity  | Grant Price | Market Price | Total Est Mkt Value
  01/31/24   | 00005895 | RSU  | MBLY   | 454.000   | $0.00       | $6.87        | $3,118.98

Column mappings:
  Number / Grant #      → grantId
  Type                  → grantType
  Symbol / CUSIP        → tickerSymbol
  Grant Date            → grantDate  (→ YYYY-MM-DD)
  Quantity / Shares     → totalShares
  Grant Price           → strikePrice
  Market Price          → fairMarketValue
  Total Est Mkt Value   → currentMarketValue
  Vested rows           → vestedShares
  Unvested rows         → unvestedShares

Also look for: "Stock Plan Details", "Equity Awards", "Restricted Stock Units",
"Potential Restricted Stock", "Vesting Schedule".

Respond with ONLY valid JSON, no markdown fences:
{
  "grants": [{
    "grantId":            { "value": "<string|null>", "confidence": <0-100> },
    "grantType":          { "value": "<RSU|ISO|NSO|ESPP|RestrictedShares|PerformanceShares|null>", "confidence": <0-100> },
    "companyName":        { "value": "<string|null>", "confidence": <0-100> },
    "tickerSymbol":       { "value": "<string|null>", "confidence": <0-100> },
    "grantDate":          { "value": "<YYYY-MM-DD|null>", "confidence": <0-100> },
    "vestingStartDate":   { "value": "<YYYY-MM-DD|null>", "confidence": <0-100> },
    "vestingEndDate":     { "value": "<YYYY-MM-DD|null>", "confidence": <0-100> },
    "totalShares":        { "value": <number|null>, "confidence": <0-100> },
    "strikePrice":        { "value": <number|null>, "confidence": <0-100> },
    "exercisePrice":      { "value": <number|null>, "confidence": <0-100> },
    "fairMarketValue":    { "value": <number|null>, "confidence": <0-100> },
    "cliffDuration":      { "value": <months|null>, "confidence": <0-100> },
    "vestingFrequency":   { "value": "<Monthly|Quarterly|Annual|Custom|null>", "confidence": <0-100> },
    "vestedShares":       { "value": <number|null>, "confidence": <0-100> },
    "unvestedShares":     { "value": <number|null>, "confidence": <0-100> },
    "exercisedShares":    { "value": <number|null>, "confidence": <0-100> },
    "cancelledShares":    { "value": <number|null>, "confidence": <0-100> },
    "soldShares":         { "value": <number|null>, "confidence": <0-100> },
    "remainingShares":    { "value": <number|null>, "confidence": <0-100> },
    "currentMarketValue": { "value": <number|null>, "confidence": <0-100> },
    "costBasis":          { "value": <number|null>, "confidence": <0-100> },
    "estimatedTaxBasis":  { "value": <number|null>, "confidence": <0-100> },
    "sourceSnippets":     [ { "field": "<fieldName>", "snippet": "<exact quote>" } ]
  }]
}

Rules: Extract EVERY grant row. Dates → YYYY-MM-DD. Numbers → strip $, commas.
Confidence 95-100: explicitly stated. 70-94: inferred. 0-69: uncertain. No grants → {"grants":[]}"""


# ── LLM helpers ───────────────────────────────────────────────────────────────
def _strip_fences(text: str) -> str:
    import re
    return re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.IGNORECASE | re.MULTILINE) \
             .rstrip("```").strip()


async def _call_sofia(messages: list[dict], token: str) -> str:
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            f"{SOFIA_BASE}/chat/completions",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"model": SOFIA_MODEL, "messages": messages},
        )
        r.raise_for_status()
        data = r.json()
    content = data["choices"][0]["message"]["content"]
    if isinstance(content, list):  # Claude content blocks
        content = "".join(b.get("text", "") for b in content if isinstance(b, dict))
    return content


async def _call_openai(messages: list[dict], api_key: str, model: str) -> str:
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": messages,
                "response_format": {"type": "json_object"},
                "temperature": 0,
            },
        )
        r.raise_for_status()
        data = r.json()
    return data["choices"][0]["message"]["content"]


async def _call_anthropic(messages: list[dict], api_key: str, model: str) -> str:
    system = next((m["content"] for m in messages if m["role"] == "system"), "")
    user_text = "\n\n".join(m["content"] for m in messages if m["role"] == "user")
    async with httpx.AsyncClient(timeout=180) as client:
        r = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": 16384,
                "system": system,
                "messages": [{"role": "user", "content": user_text}],
            },
        )
        r.raise_for_status()
        data = r.json()
    parts = data.get("content") or []
    out: list[str] = []
    for block in parts:
        if isinstance(block, dict) and block.get("type") == "text":
            out.append(str(block.get("text", "")))
    return "".join(out)


async def _call_grok(messages: list[dict], api_key: str, model: str) -> str:
    """xAI Grok — OpenAI-compatible chat completions."""
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            "https://api.x.ai/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": messages,
                "temperature": 0,
            },
        )
        r.raise_for_status()
        data = r.json()
    return data["choices"][0]["message"]["content"]


def _chunk(text: str, max_chars: int = 12_000) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    chunks, cur = [], ""
    for line in text.splitlines():
        if cur and len(cur) + len(line) > max_chars:
            chunks.append(cur)
            cur = line
        else:
            cur = f"{cur}\n{line}" if cur else line
    if cur:
        chunks.append(cur)
    return chunks


# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(title="EquityLens extraction server")

_cors_raw = os.getenv("CORS_ORIGINS", _DEFAULT_CORS).strip()
_cors_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register E*TRADE routes
import importlib as _il, sys as _sys
_sys.path.insert(0, str(Path(__file__).parent))
_etrade = _il.import_module("etrade")
_etrade.register(app)

_auth = _il.import_module("auth_routes")
_auth.register(app)

# Register candle route
_candles = _il.import_module("candles_route")
_candles.register(app)

_market_ctx = _il.import_module("market_context_route")
_market_ctx.register(app)


class ExtractRequest(BaseModel):
    filename: str
    text: str
    apiKey: str = ""
    provider: Literal["openai", "anthropic", "grok"] = "openai"


@app.get("/api/price/{ticker}")
async def get_price(ticker: str) -> dict[str, Any]:
    """Fetch the latest market price for a ticker via Yahoo Finance (no API key required)."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker.upper()}"
    params = {"interval": "1d", "range": "1d"}
    headers = {"User-Agent": "Mozilla/5.0 (compatible; EquityLens/1.0)"}
    try:
        async with httpx.AsyncClient(timeout=10, verify=False) as client:
            r = await client.get(url, params=params, headers=headers)
            r.raise_for_status()
            data = r.json()
        meta     = data["chart"]["result"][0]["meta"]
        price    = meta.get("regularMarketPrice") or meta.get("previousClose", 0)
        currency = meta.get("currency", "USD")
        name     = meta.get("longName") or meta.get("shortName", ticker)
        return {"ticker": ticker.upper(), "price": price, "currency": currency, "name": name, "ok": True}
    except Exception as exc:
        log.warning("Price fetch failed for %s: %s", ticker, exc)
        return {"ticker": ticker.upper(), "price": None, "ok": False, "error": str(exc)}



# ── Competitor / related ticker map ──────────────────────────────────────────
RELATED_TICKERS: dict[str, list[str]] = {
    "MBLY": ["NVDA", "QCOM", "INTC", "TXN", "NXPI"],
    "NVDA": ["AMD", "INTC", "QCOM", "MBLY"],
    "AMD":  ["NVDA", "INTC", "QCOM"],
    "INTC": ["NVDA", "AMD", "QCOM", "MBLY"],
    "QCOM": ["NVDA", "AMD", "INTC", "MBLY", "NXPI"],
    "NXPI": ["MBLY", "TXN", "QCOM"],
    "TXN":  ["NXPI", "MBLY", "QCOM"],
    "TSLA": ["GM", "F", "RIVN", "NIO"],
    "MSFT": ["GOOG", "AMZN", "META", "AAPL"],
    "GOOG": ["MSFT", "AMZN", "META"],
    "AMZN": ["MSFT", "GOOG", "META"],
    "META": ["GOOG", "MSFT", "SNAP"],
    "AAPL": ["MSFT", "GOOG", "AMZN"],
}


import datetime as _dt

# ── Curated sector events ─────────────────────────────────────────────────────
from events_data import SECTOR_EVENTS  # noqa: E402

TICKER_SECTORS: dict[str, list[str]] = {
    "MBLY": ["ADAS_AV", "SEMICONDUCTOR"],
    "NVDA": ["SEMICONDUCTOR", "CLOUD_AI"],
    "INTC": ["SEMICONDUCTOR", "ADAS_AV"],
    "QCOM": ["SEMICONDUCTOR", "ADAS_AV"],
    "NXPI": ["SEMICONDUCTOR", "ADAS_AV"],
    "TXN":  ["SEMICONDUCTOR"],
    "AMD":  ["SEMICONDUCTOR", "CLOUD_AI"],
    "MSFT": ["CLOUD_AI"],
    "GOOG": ["CLOUD_AI", "ADAS_AV"],
    "AMZN": ["CLOUD_AI"],
    "META": ["CLOUD_AI"],
    "TSLA": ["ADAS_AV"],
}


async def _project_earnings(sym: str, client: httpx.AsyncClient) -> list[dict]:
    """
    Fetch 2yr historical earnings from Yahoo Finance, extrapolate next
    4 quarterly earnings dates by repeating the average spacing.
    """
    ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    try:
        r = await client.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}",
            params={"interval": "3mo", "range": "2y", "events": "earnings"},
            headers={"User-Agent": ua}, timeout=10,
        )
        r.raise_for_status()
        raw = r.json().get("chart", {}).get("result", [{}])[0].get("events", {})
        past = sorted(ev.get("date") or int(ts) for ts, ev in raw.get("earnings", {}).items())
        if not past:
            return []

        spacing = int(sum(past[i+1]-past[i] for i in range(len(past)-1)) / max(1, len(past)-1)) if len(past) >= 2 else 91*86400
        now_ts  = int(time.time())
        cutoff  = now_ts + 400 * 86400
        results, candidate = [], past[-1] + spacing
        while candidate <= cutoff and len(results) < 4:
            if candidate > now_ts:
                d = _dt.datetime.fromtimestamp(candidate)
                q = ((d.month - 1) // 3) + 1
                results.append({
                    "ticker": sym, "type": "earnings", "date": candidate,
                    "label": f"{sym} Q{q} {d.year} Earnings (estimated)",
                    "source": "Projected from historical pattern", "estimated": True,
                })
            candidate += spacing
        return results
    except Exception:
        return []


@app.get("/api/events/{ticker}")
async def get_events(ticker: str) -> dict[str, Any]:
    """
    Upcoming calendar events for a ticker:
    1. Projected quarterly earnings for ticker + key competitors
    2. Curated sector events (conferences, macro, peer announcements)
    """
    sym     = ticker.upper()
    related = RELATED_TICKERS.get(sym, [])
    sectors = TICKER_SECTORS.get(sym, [])
    now_ts  = int(time.time())
    cutoff  = now_ts + 400 * 86400

    # Projected earnings
    async with httpx.AsyncClient(verify=False) as client:
        raw = await asyncio.gather(*[_project_earnings(t, client) for t in [sym] + related])
    earnings_events = [ev for evlist in raw for ev in evlist]

    # Curated sector events (deduplicated)
    seen: set[str] = set()
    sector_events: list[dict] = []
    for sector in sectors:
        for ev in SECTOR_EVENTS.get(sector, []):
            if ev["label"] in seen:
                continue
            ts = int(_dt.datetime.strptime(ev["date"], "%Y-%m-%d").timestamp())
            if now_ts < ts <= cutoff:
                seen.add(ev["label"])
                sector_events.append({**ev, "date": ts, "ticker": None})

    return {
        "ticker":         sym,
        "relatedTickers": related,
        "sectors":        sectors,
        "events":         sorted(earnings_events + sector_events, key=lambda e: e["date"]),
    }


@app.get("/api/chart/{ticker}")
async def get_chart(ticker: str, interval: str = "1d", range_: str = "1y") -> dict[str, Any]:
    """
    Daily (or other interval) price history for a ticker.
    Default: 1-day candles for 1 year.
    Also returns the 2-year daily history for USD/ILS aligned by date.
    """
    sym = ticker.upper()
    ua  = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    result: dict[str, Any] = {"ticker": sym, "ok": False, "prices": [], "usdils": []}

    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        stock_task = client.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}",
            params={"interval": interval, "range": range_},
            headers={"User-Agent": ua},
        )
        fx_task = client.get(
            "https://query1.finance.yahoo.com/v8/finance/chart/USDILS=X",
            params={"interval": interval, "range": range_},
            headers={"User-Agent": ua},
        )
        stock_resp, fx_resp = await asyncio.gather(stock_task, fx_task, return_exceptions=True)

    # ── Stock prices ──────────────────────────────────────────────────────────
    try:
        stock_resp.raise_for_status()  # type: ignore[union-attr]
        sc = stock_resp.json()["chart"]["result"][0]  # type: ignore[union-attr]
        ts = sc.get("timestamp", [])
        closes = (sc.get("indicators", {}).get("adjclose") or
                  [{"adjclose": sc.get("indicators", {}).get("quote", [{}])[0].get("close", [])}]
                  )[0].get("adjclose") or []
        result["prices"] = [
            {"date": int(t), "price": round(float(p), 4)}
            for t, p in zip(ts, closes) if p is not None
        ]
        result["ok"] = True
    except Exception as exc:
        log.warning("Chart prices failed for %s: %s", sym, exc)

    # ── USD/ILS ───────────────────────────────────────────────────────────────
    try:
        fx_resp.raise_for_status()  # type: ignore[union-attr]
        fc = fx_resp.json()["chart"]["result"][0]  # type: ignore[union-attr]
        ts_fx = fc.get("timestamp", [])
        rates = (fc.get("indicators", {}).get("adjclose") or
                 [{"adjclose": fc.get("indicators", {}).get("quote", [{}])[0].get("close", [])}]
                 )[0].get("adjclose") or []
        result["usdils"] = [
            {"date": int(t), "rate": round(float(r), 4)}
            for t, r in zip(ts_fx, rates) if r is not None
        ]
    except Exception as exc:
        log.warning("FX rates failed: %s", exc)

    return result


@app.get("/api/currency/{pair}")
async def get_currency(pair: str) -> dict[str, Any]:
    """
    Fetch historical exchange rate data for a currency pair.
    pair examples: USDILS, EURUSD, GBPUSD
    Yahoo Finance format: USDILS=X
    Returns monthly closing rates for the last 2 years.
    """
    sym = f"{pair.upper()}=X" if "=" not in pair.upper() else pair.upper()
    ua  = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    try:
        async with httpx.AsyncClient(timeout=12, verify=False) as client:
            r = await client.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}",
                params={"interval": "1mo", "range": "2y"},
                headers={"User-Agent": ua},
            )
            r.raise_for_status()
            chart = r.json()["chart"]["result"][0]
            meta  = chart.get("meta", {})
            timestamps = chart.get("timestamp", [])
            closes = (
                chart.get("indicators", {}).get("adjclose") or
                [{"adjclose": chart.get("indicators", {}).get("quote", [{}])[0].get("close", [])}]
            )[0].get("adjclose") or []
            history = [
                {"date": int(ts), "rate": round(float(r_), 4)}
                for ts, r_ in zip(timestamps, closes) if r_ is not None
            ]
            return {
                "ok":      True,
                "pair":    pair.upper(),
                "symbol":  sym,
                "current": meta.get("regularMarketPrice"),
                "history": history,
            }
    except Exception as exc:
        log.warning("Currency fetch failed for %s: %s", sym, exc)
        return {"ok": False, "pair": pair.upper(), "current": None, "history": [], "error": str(exc)}


@app.get("/api/analysis/{ticker}")
async def get_analysis(ticker: str) -> dict[str, Any]:
    """
    Comprehensive ticker analysis from Yahoo Finance v8 chart API
    (works through corporate proxies — no crumb/cookie required).

    Returns:
      - 12-month monthly price history
      - Current price + 52w high/low, 50d/200d moving averages
      - Company name, exchange, currency
    """
    sym = ticker.upper()
    ua  = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    result: dict[str, Any] = {"ticker": sym, "ok": False, "priceHistory": []}

    try:
        async with httpx.AsyncClient(timeout=15, verify=False) as client:
            # 1y monthly — gives us closing prices for the sparkline
            r_mo = await client.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}",
                params={"interval": "1mo", "range": "1y"},
                headers={"User-Agent": ua},
            )
            r_mo.raise_for_status()
            chart = r_mo.json()["chart"]["result"][0]
            meta  = chart.get("meta", {})

            # Monthly price history
            timestamps = chart.get("timestamp", [])
            closes     = (chart.get("indicators", {}).get("adjclose") or
                          [{"adjclose": chart.get("indicators", {}).get("quote", [{}])[0].get("close", [])}]
                          )[0].get("adjclose") or []
            result["priceHistory"] = [
                {"date": int(ts), "price": round(float(p), 2)}
                for ts, p in zip(timestamps, closes) if p is not None
            ][-12:]

            # Market stats from chart meta
            result.update({
                "ok":                   True,
                "currentPrice":         meta.get("regularMarketPrice"),
                "previousClose":        meta.get("previousClose"),
                "fiftyTwoWeekHigh":     meta.get("fiftyTwoWeekHigh"),
                "fiftyTwoWeekLow":      meta.get("fiftyTwoWeekLow"),
                "fiftyDayAverage":      meta.get("fiftyDayAverage"),
                "twoHundredDayAverage": meta.get("twoHundredDayAverage"),
                "currency":             meta.get("currency", "USD"),
                "exchangeName":         meta.get("exchangeName"),
                "shortName":            meta.get("shortName") or meta.get("longName"),
                "regularMarketVolume":  meta.get("regularMarketVolume"),
            })

    except Exception as exc:
        log.warning("Analysis fetch failed for %s: %s", sym, exc)

    return result


@app.get("/api/check-url")
async def check_url(url: str) -> dict[str, Any]:
    """
    HEAD-check a URL and return whether it's reachable.
    Used by the frontend before opening external links.
    """
    try:
        async with httpx.AsyncClient(timeout=6, verify=False, follow_redirects=True,
                                     headers={"User-Agent": "Mozilla/5.0"}) as client:
            r = await client.head(url)
            ok = r.status_code < 400
            # Some sites reject HEAD — retry with GET on 405
            if r.status_code == 405:
                r2 = await client.get(url)
                ok = r2.status_code < 400
            return {"ok": ok, "status": r.status_code, "url": url}
    except Exception as exc:
        # Connection errors from corporate proxy ≠ URL broken in browser
        return {"ok": None, "status": None, "url": url, "note": str(exc)[:120]}


@app.get("/api/health")
def health() -> dict[str, Any]:
    # Use ONLY the cached token — never trigger a network call from a health check.
    cached_token = (_token if (_token and time.time() < _token_expiry) else SOFIA_API_KEY) or ""
    sofia_ok = bool(cached_token)
    auth_method = "api_key" if SOFIA_API_KEY else ("meezeh" if (MEEZEH_USER and MEEZEH_PASS) else "none")
    return {
        "ok": True,
        "pid": os.getpid(),
        "backend": "sofia" if sofia_ok else "fallback",
        "meezehConfigured": bool(MEEZEH_USER and MEEZEH_PASS),
        "sofiaKeyConfigured": bool(SOFIA_API_KEY),
        "tokenCached": sofia_ok,
        "authMethod": auth_method,
        "model": SOFIA_MODEL if sofia_ok else OPENAI_CHAT_MODEL,
        "openaiEnvConfigured": bool(OPENAI_KEY),
        "anthropicEnvConfigured": bool(ANTHROPIC_KEY),
        "grokEnvConfigured": bool(GROK_KEY),
        "openaiModel": OPENAI_CHAT_MODEL,
        "anthropicModel": ANTHROPIC_CHAT_MODEL,
        "grokModel": GROK_CHAT_MODEL,
    }


@app.post("/api/extract")
async def extract(req: ExtractRequest) -> dict[str, Any]:
    if not req.filename or not req.text:
        raise HTTPException(400, "filename and text are required")

    token = get_sofia_token()
    use_sofia = bool(token)

    if use_sofia:
        label = "sofia"
        model = SOFIA_MODEL

        async def call_llm(msgs: list[dict]) -> str:
            return await _call_sofia(msgs, token)
    elif req.provider == "openai":
        api_key = req.apiKey.strip() or OPENAI_KEY
        model = OPENAI_CHAT_MODEL
        label = "openai"
        if not api_key:
            raise HTTPException(
                503,
                "No OpenAI API key. Save one in the app (Secure vault) or set OPENAI_API_KEY on the server.",
            )

        async def call_llm(msgs: list[dict]) -> str:
            return await _call_openai(msgs, api_key, model)
    elif req.provider == "grok":
        api_key = req.apiKey.strip() or GROK_KEY
        model = GROK_CHAT_MODEL
        label = "grok"
        if not api_key:
            raise HTTPException(
                503,
                "No Grok API key. Save one in the app (Secure vault) or set GROK_API_KEY / XAI_API_KEY on the server.",
            )

        async def call_llm(msgs: list[dict]) -> str:
            return await _call_grok(msgs, api_key, model)
    else:
        api_key = req.apiKey.strip() or ANTHROPIC_KEY
        model = ANTHROPIC_CHAT_MODEL
        label = "anthropic"
        if not api_key:
            raise HTTPException(
                503,
                "No Anthropic API key. Save one in the app (Secure vault) or set ANTHROPIC_API_KEY on the server.",
            )

        async def call_llm(msgs: list[dict]) -> str:
            return await _call_anthropic(msgs, api_key, model)

    log.info("extract  %s  (%d chars, %s / %s)", req.filename, len(req.text), label, model)

    chunks = _chunk(req.text)
    all_grants: list[Any] = []

    for i, chunk in enumerate(chunks):
        label_chunk = f"{req.filename} [{i+1}/{len(chunks)}]" if len(chunks) > 1 else req.filename
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": f"File: {label_chunk}\n\n{chunk}"},
        ]

        try:
            raw = await call_llm(messages)
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            body = exc.response.text[:400]
            log.error("LLM API error %d: %s", status, body)
            # Sofia 401 → token expired; force refresh on next call
            if status == 401 and use_sofia:
                global _token, _token_expiry
                _token, _token_expiry = "", 0.0
            if status == 429:
                raise HTTPException(429, f"{label} rate limit / quota exceeded. {body}")
            if status == 401:
                raise HTTPException(401, f"{label} authentication failed. {body}")
            raise HTTPException(status, f"LLM API error {status}: {body}")

        try:
            parsed: dict = json.loads(_strip_fences(raw))
        except json.JSONDecodeError as exc:
            log.error("JSON parse failed: %s — raw: %s", exc, raw[:200])
            raise HTTPException(500, f"Failed to parse LLM response as JSON: {exc}")

        grants = parsed.get("grants") or []
        log.info("  chunk %d/%d → %d grant(s)", i + 1, len(chunks), len(grants))
        all_grants.extend(grants)

    log.info("total  %s → %d grant(s)", req.filename, len(all_grants))
    return {"grants": all_grants, "backend": label, "model": model}


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    meezeh_ok = bool(MEEZEH_USER and MEEZEH_PASS)
    sofia_key_ok = bool(SOFIA_API_KEY)
    log.info("\nEquityLens extraction server  http://localhost:%d", PORT)
    if sofia_key_ok:
        log.info("  Backend  : Sofia (%s) via SOFIA_API_KEY", SOFIA_BASE)
        log.info("  Model    : %s", SOFIA_MODEL)
    elif meezeh_ok:
        log.info("  Backend  : Sofia (%s) via Meezeh", SOFIA_BASE)
        log.info("  Meezeh   : %s", MEEZEH_USER)
        log.info("  Model    : %s", SOFIA_MODEL)
    else:
        log.info("  Backend  : OpenAI/Anthropic/Grok fallback (no Sofia auth configured)")
    log.info("  OpenAI env key     : %s", "yes" if OPENAI_KEY else "no")
    log.info("  Anthropic env key  : %s", "yes" if ANTHROPIC_KEY else "no")
    log.info("  Grok env key       : %s", "yes" if GROK_KEY else "no")
    log.info("")
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False, app_dir=str(Path(__file__).parent))
