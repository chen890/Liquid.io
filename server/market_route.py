"""
Local FastAPI mirror of api/market.ts for Stocks view.

  GET /api/market?action=candles&ticker=MBLY&range=3mo&interval=1d
  GET /api/market?action=news&ticker=MBLY&name=Mobileye
  GET /api/market?action=filings&ticker=MBLY
  GET /api/market?action=lookup&q=Mobileye

On Vercel these are served by api/market.ts; Vite proxies /api → this server in dev.
"""

from __future__ import annotations

import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query

log = logging.getLogger("equitylens.market")

YAHOO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
SEC_UA = (os.getenv("SEC_USER_AGENT") or "EquityLens/1.0 (personal portfolio tool)").strip()
TICKER_RE = re.compile(r"^[A-Z0-9.\-^=]{1,12}$")
NAME_RE = re.compile(r"^[\w .,&'\-]{2,80}$", re.UNICODE)
RANGES = {"5d", "1mo", "3mo", "6mo", "1y", "2y", "5y"}
INTERVALS = {"15m", "1d", "1wk"}
COMPANY_SUFFIX = re.compile(
    r"\b(inc|corp|corporation|ltd|limited|plc|co|company|holdings|global|group|n v|nv|class [a-c])\b",
    re.I,
)

_memo: dict[str, tuple[float, Any]] = {}
_MEMO_MS = 5 * 60
_ticker_map: dict[str, dict[str, Any]] | None = None

FACTS = [
    {
        "label": "Revenue",
        "tags": [
            "RevenueFromContractWithCustomerExcludingAssessedTax",
            "Revenues",
            "SalesRevenueNet",
        ],
        "unit": "USD",
    },
    {"label": "Net income", "tags": ["NetIncomeLoss"], "unit": "USD"},
    {"label": "Diluted EPS", "tags": ["EarningsPerShareDiluted"], "unit": "USD/shares"},
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


async def _get_json(url: str, ua: str) -> Any:
    async with httpx.AsyncClient(timeout=12, verify=False) as client:
        r = await client.get(url, headers={"User-Agent": ua, "Accept": "application/json"})
        if r.status_code >= 400:
            raise HTTPException(502, f"HTTP {r.status_code} from {httpx.URL(url).host}")
        return r.json()


async def _memoized(key: str, fn) -> Any:
    hit = _memo.get(key)
    if hit and (time.time() - hit[0]) < _MEMO_MS:
        return hit[1]
    body = await fn()
    if len(_memo) > 200:
        _memo.clear()
    _memo[key] = (time.time(), body)
    return body


def classify_news(
    ticker: str, name: str, title: str, related_raw: Any
) -> str:
    related = [str(x).upper() for x in related_raw] if isinstance(related_raw, list) else []
    core = COMPANY_SUFFIX.sub("", name.lower())
    core = re.sub(r"[^a-z0-9 ]", " ", core)
    core = re.sub(r"\s+", " ", core).strip()
    nt = " " + re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", title.lower())) + " "
    esc = re.escape(ticker)
    ticker_in_title = bool(re.search(rf"(^|[^A-Za-z0-9])\${esc}([^A-Za-z0-9]|$)", title)) or bool(
        re.search(rf"(^|[^A-Za-z0-9]){esc}([^A-Za-z0-9]|$)", title)
    )
    names_company = (len(core) >= 4 and f" {core}" in nt) or ticker_in_title
    tagged = ticker in related
    others = {t for t in related if t != ticker}
    if tagged and not others:
        return "specific"
    if tagged:
        return "specific" if names_company and len(others) <= 1 else "multi"
    return "multi" if names_company else "broad"


async def candles(ticker: str, range_: str, interval: str) -> dict[str, Any]:
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
        f"?range={range_}&interval={interval}&includePrePost=false"
    )
    j = await _get_json(url, YAHOO_UA)
    result = (j.get("chart") or {}).get("result") or [None]
    result = result[0]
    if not result:
        raise HTTPException(502, "No chart data for ticker")
    q = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    ts = result.get("timestamp") or []
    out = []
    for i, t in enumerate(ts):
        o, h, l, c = (
            (q.get("open") or [None])[i],
            (q.get("high") or [None])[i],
            (q.get("low") or [None])[i],
            (q.get("close") or [None])[i],
        )
        if all(isinstance(v, (int, float)) for v in (o, h, l, c)):
            out.append(
                {
                    "time": t,
                    "open": o,
                    "high": h,
                    "low": l,
                    "close": c,
                    "volume": (q.get("volume") or [0])[i] or 0,
                }
            )
    m = result.get("meta") or {}
    return {
        "ok": True,
        "source": "Yahoo Finance (unofficial)",
        "fetchedAt": _now_iso(),
        "candles": out,
        "meta": {
            "symbol": m.get("symbol"),
            "shortName": m.get("shortName") or m.get("longName"),
            "currency": m.get("currency"),
            "exchange": m.get("fullExchangeName"),
            "regularMarketPrice": m.get("regularMarketPrice"),
            "previousClose": m.get("previousClose"),
            "regularMarketTime": m.get("regularMarketTime"),
            "fiftyTwoWeekHigh": m.get("fiftyTwoWeekHigh"),
            "fiftyTwoWeekLow": m.get("fiftyTwoWeekLow"),
        },
    }


async def news(ticker: str, name: str) -> dict[str, Any]:
    url = (
        "https://query2.finance.yahoo.com/v1/finance/search"
        f"?q={ticker}&newsCount=20&quotesCount=0"
    )
    j = await _get_json(url, YAHOO_UA)
    items = []
    for n in j.get("news") or []:
        title = str(n.get("title") or "")
        related = [str(x).upper() for x in (n.get("relatedTickers") or [])]
        pub = n.get("providerPublishTime")
        items.append(
            {
                "title": title,
                "publisher": n.get("publisher"),
                "link": n.get("link"),
                "relatedTickers": list(dict.fromkeys(related)),
                "relevance": classify_news(ticker, name, title, related),
                "publishedAt": (
                    datetime.fromtimestamp(pub, tz=timezone.utc).isoformat().replace("+00:00", "Z")
                    if isinstance(pub, (int, float))
                    else None
                ),
            }
        )
    return {
        "ok": True,
        "source": "Yahoo Finance search (unofficial)",
        "fetchedAt": _now_iso(),
        "items": items,
    }


async def lookup(q: str) -> dict[str, Any]:
    from urllib.parse import quote

    url = (
        "https://query2.finance.yahoo.com/v1/finance/search"
        f"?q={quote(q)}&quotesCount=8&newsCount=0"
    )
    j = await _get_json(url, YAHOO_UA)
    seen: set[str] = set()
    candidates = []
    for x in j.get("quotes") or []:
        sym = str(x.get("symbol") or "")
        if x.get("quoteType") != "EQUITY" or not TICKER_RE.match(sym):
            continue
        if sym in seen:
            continue
        seen.add(sym)
        candidates.append(
            {
                "symbol": sym,
                "name": str(x.get("longname") or x.get("shortname") or ""),
                "exchange": str(x.get("exchDisp") or x.get("exchange") or ""),
            }
        )
        if len(candidates) >= 6:
            break
    return {
        "ok": True,
        "source": "Yahoo Finance search (unofficial)",
        "fetchedAt": _now_iso(),
        "query": q,
        "candidates": candidates,
    }


async def _lookup_cik(ticker: str) -> dict[str, Any] | None:
    global _ticker_map
    if _ticker_map is None:
        j = await _get_json("https://www.sec.gov/files/company_tickers.json", SEC_UA)
        _ticker_map = {
            str(r["ticker"]).upper(): r
            for r in j.values()
            if isinstance(r, dict) and "ticker" in r
        }
    return _ticker_map.get(ticker.upper())


def _days(a: str, b: str) -> int:
    return round((datetime.fromisoformat(b).timestamp() - datetime.fromisoformat(a).timestamp()) / 86_400)


def _latest_comparable(points: list[dict[str, Any]], kind: str) -> dict[str, Any] | None:
    lo, hi = (80, 100) if kind == "quarterly" else (350, 380)
    own = []
    for p in points:
        start = p.get("start")
        end = p.get("end")
        if not start or not end:
            continue
        try:
            d = _days(start, end)
        except Exception:
            continue
        if not (lo <= d <= hi):
            continue
        form = p.get("form")
        if kind == "annual" and form != "10-K":
            continue
        if kind == "quarterly" and form not in ("10-Q", "10-K"):
            continue
        own.append(p)
    if not own:
        return None
    own.sort(key=lambda p: (p.get("end") or "", p.get("filed") or ""), reverse=True)
    cur = own[0]
    prior = None
    for p in own:
        try:
            if abs(_days(p["end"], cur["end"]) - 365) <= 20:
                prior = p
                break
        except Exception:
            continue
    return {"cur": cur, "prior": prior}


async def filings(ticker: str) -> dict[str, Any]:
    row = await _lookup_cik(ticker)
    if not row:
        return {
            "ok": True,
            "covered": False,
            "source": "SEC EDGAR",
            "fetchedAt": _now_iso(),
            "note": "Ticker not found in the SEC reporting-issuer list (foreign or non-SEC issuer, or wrong symbol).",
            "filings": [],
            "facts": [],
            "factsNote": "",
        }
    cik = str(row["cik_str"]).zfill(10)
    sub = await _get_json(f"https://data.sec.gov/submissions/CIK{cik}.json", SEC_UA)
    recent = (sub.get("filings") or {}).get("recent") or {}
    wanted = {"10-K", "10-Q", "8-K", "20-F", "6-K", "40-F"}
    listing: list[dict[str, str]] = []
    forms = recent.get("form") or []
    for i, form in enumerate(forms):
        if form not in wanted:
            continue
        acc = str(recent["accessionNumber"][i])
        listing.append(
            {
                "form": form,
                "filedAt": recent["filingDate"][i],
                "period": recent.get("reportDate", [""])[i] or "",
                "description": (recent.get("primaryDocDescription") or [""])[i] or "",
                "url": (
                    f"https://www.sec.gov/Archives/edgar/data/{row['cik_str']}/"
                    f"{acc.replace('-', '')}/{(recent.get('primaryDocument') or [''])[i]}"
                ),
            }
        )
        if len(listing) >= 8:
            break

    facts: list[dict[str, Any]] = []
    facts_note = ""
    try:
        cf = await _get_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json", SEC_UA)
        gaap = (cf.get("facts") or {}).get("us-gaap")
        if not gaap:
            facts_note = "No US-GAAP figures for this filer (for example IFRS foreign issuers); see the filings list."
        else:
            for f in FACTS:
                for kind in ("quarterly", "annual"):
                    pick = None
                    for tag in f["tags"]:
                        pts = ((gaap.get(tag) or {}).get("units") or {}).get(f["unit"]) or []
                        r = _latest_comparable(pts, kind)
                        if r and (not pick or r["cur"]["end"] > pick["cur"]["end"]):
                            pick = r
                    if pick:
                        cur, prior = pick["cur"], pick["prior"]
                        facts.append(
                            {
                                "label": f["label"],
                                "kind": kind,
                                "value": cur["val"],
                                "unit": f["unit"],
                                "start": cur.get("start"),
                                "end": cur["end"],
                                "fiscal": f"{cur.get('fp')} {cur.get('fy')}",
                                "form": cur.get("form"),
                                "filedAt": cur.get("filed"),
                                "priorYearValue": prior["val"] if prior else None,
                                "priorYearEnd": prior["end"] if prior else None,
                            }
                        )
    except Exception:
        facts_note = "Reported figures could not be loaded."

    return {
        "ok": True,
        "covered": True,
        "source": "SEC EDGAR",
        "fetchedAt": _now_iso(),
        "company": {"name": row.get("title"), "cik": row["cik_str"], "ticker": row.get("ticker")},
        "filings": listing,
        "facts": facts,
        "factsNote": facts_note,
    }


def register(app: FastAPI) -> None:
    @app.get("/api/market")
    async def market(
        action: str = Query(""),
        ticker: str = Query(""),
        range: str = Query("3mo"),
        interval: str = Query("1d"),
        name: str = Query(""),
        q: str = Query(""),
    ) -> Any:
        if action == "lookup":
            q = q.strip()
            if not NAME_RE.match(q):
                raise HTTPException(400, "Invalid company name")
            try:
                return await _memoized(f"l:{q.lower()}", lambda: lookup(q))
            except HTTPException:
                raise
            except Exception as exc:
                log.warning("lookup failed: %s", exc)
                raise HTTPException(502, "Upstream data provider error") from exc

        sym = ticker.upper().strip()
        if not TICKER_RE.match(sym):
            raise HTTPException(400, "Invalid ticker")

        try:
            if action == "candles":
                if range not in RANGES or interval not in INTERVALS:
                    raise HTTPException(400, "Invalid range or interval")
                return await _memoized(
                    f"c:{sym}:{range}:{interval}",
                    lambda: candles(sym, range, interval),
                )
            if action == "news":
                nm = name[:80]
                return await _memoized(f"n:{sym}:{nm}", lambda: news(sym, nm))
            if action == "filings":
                return await _memoized(f"f:{sym}", lambda: filings(sym))
            raise HTTPException(400, "Unknown action")
        except HTTPException:
            raise
        except Exception as exc:
            log.warning("market %s failed: %s", action, exc)
            raise HTTPException(502, "Upstream data provider error") from exc
