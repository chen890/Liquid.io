"""
Candlestick + volume endpoint with pre/post-market data.
Registered into the FastAPI app by main.py.
"""
from __future__ import annotations
import logging
import os
from typing import Any
import httpx

log = logging.getLogger("equitylens.candles")

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


async def _fetch_candles(ticker: str, interval: str, range_: str) -> dict[str, Any]:
    sym = ticker.upper()
    result: dict[str, Any] = {
        "ticker": sym, "ok": False,
        "candles": [], "preMarket": None, "postMarket": None, "meta": {},
    }
    try:
        async with httpx.AsyncClient(timeout=15, verify=False) as client:
            r = await client.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}",
                params={
                    "interval":       interval,
                    "range":          range_,
                    "includePrePost": "true",
                    "events":         "div,split",
                },
                headers={"User-Agent": UA},
            )
            r.raise_for_status()
            data = r.json()

        chart = data["chart"]["result"][0]
        meta  = chart.get("meta", {})
        ts    = chart.get("timestamp", [])
        quote = chart["indicators"]["quote"][0]

        opens, highs, lows, closes, volumes = (
            quote.get("open",   []),
            quote.get("high",   []),
            quote.get("low",    []),
            quote.get("close",  []),
            quote.get("volume", []),
        )

        candles = []
        for i, t in enumerate(ts):
            o  = opens[i]   if i < len(opens)   else None
            h  = highs[i]   if i < len(highs)   else None
            lo = lows[i]    if i < len(lows)     else None
            c  = closes[i]  if i < len(closes)  else None
            v  = volumes[i] if i < len(volumes) else None
            if None in (o, h, lo, c):
                continue
            candles.append({
                "time":   int(t),
                "open":   round(float(o),  4),
                "high":   round(float(h),  4),
                "low":    round(float(lo), 4),
                "close":  round(float(c),  4),
                "volume": int(v) if v is not None else 0,
            })

        reg_price  = meta.get("regularMarketPrice")
        prev_close = meta.get("chartPreviousClose") or meta.get("previousClose")

        if (pre := meta.get("preMarketPrice")) and prev_close:
            result["preMarket"] = {
                "price":     round(float(pre), 4),
                "change":    round(float(pre) - float(prev_close), 4),
                "changePct": round((float(pre) - float(prev_close)) / float(prev_close) * 100, 2),
            }

        if (post := meta.get("postMarketPrice")) and reg_price:
            result["postMarket"] = {
                "price":     round(float(post), 4),
                "change":    round(float(post) - float(reg_price), 4),
                "changePct": round((float(post) - float(reg_price)) / float(reg_price) * 100, 2),
            }

        result.update({
            "ok":      True,
            "candles": candles,
            "meta": {
                "symbol":              sym,
                "shortName":           meta.get("shortName") or meta.get("longName", sym),
                "currency":            meta.get("currency", "USD"),
                "exchangeName":        meta.get("exchangeName"),
                "regularMarketPrice":  reg_price,
                "previousClose":       prev_close,
                "regularMarketVolume": meta.get("regularMarketVolume"),
                "fiftyTwoWeekHigh":    meta.get("fiftyTwoWeekHigh"),
                "fiftyTwoWeekLow":     meta.get("fiftyTwoWeekLow"),
            },
        })
    except Exception as exc:
        log.warning("Candles failed for %s: %s", ticker, exc)

    return result


def register(app: Any) -> None:
    from fastapi import Query  # type: ignore[import]

    @app.get("/api/candles/{ticker}")
    async def get_candles(
        ticker:   str,
        interval: str = Query("1d"),
        range_:   str = Query("6mo"),
    ) -> dict[str, Any]:
        """
        OHLCV candlestick data + pre/post-market prices for a ticker.
        interval: 1m 5m 15m 30m 1h 1d 1wk 1mo
        range_:   1d 5d 1mo 3mo 6mo 1y 2y 5y
        """
        return await _fetch_candles(ticker, interval, range_)
