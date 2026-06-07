"""
Market context for candle charts: CNN Fear & Greed, breadth (^NYAD), QQQ streak,
and simple pattern flags (three red days on the selected ticker).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from candles_route import fetch_candles

log = logging.getLogger("equitylens.market_context")

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
CNN_FEAR_GREED_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"


def _sorted_candles(candles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(candles, key=lambda x: int(x["time"]))


def _consecutive_higher_close_streak(candles: list[dict[str, Any]]) -> int:
    """Count trailing days where each close is strictly above the prior session's close."""
    c = _sorted_candles(candles)
    if len(c) < 2:
        return 0
    streak = 0
    i = len(c) - 1
    while i > 0 and c[i]["close"] > c[i - 1]["close"]:
        streak += 1
        i -= 1
    return streak


def _three_red_days(candles: list[dict[str, Any]]) -> bool:
    """Last three daily bars all close < open (red candles)."""
    c = _sorted_candles(candles)
    if len(c) < 3:
        return False
    last3 = c[-3:]
    return all(row["close"] < row["open"] for row in last3)


def _nyad_breadth_metrics(candles: list[dict[str, Any]]) -> dict[str, Any] | None:
    """
    NYSE cumulative advance-decline (^NYAD). 'collapse' = sharp 5-session drawdown
    on the line (heuristic for breadth stress).
    """
    c = _sorted_candles(candles)
    if len(c) < 6:
        return None
    last = float(c[-1]["close"])
    prev5 = float(c[-6]["close"])
    if prev5 == 0:
        return None
    change_5d_pct = round((last - prev5) / abs(prev5) * 100, 3)
    collapse = change_5d_pct <= -1.25
    return {
        "symbol": "^NYAD",
        "last": round(last, 4),
        "change5dPct": change_5d_pct,
        "collapse": collapse,
        "note": "NYSE cumulative A/D line; collapse heuristic: 5d change ≤ -1.25%",
    }


async def _fetch_fear_greed() -> dict[str, Any] | None:
    try:
        async with httpx.AsyncClient(timeout=12, verify=False) as client:
            r = await client.get(CNN_FEAR_GREED_URL, headers={"User-Agent": UA})
            r.raise_for_status()
            j = r.json()
        fg = j.get("fear_and_greed") or {}
        score = fg.get("score")
        if score is None:
            return None
        return {
            "score": round(float(score), 1),
            "rating": str(fg.get("rating") or "").replace("_", " ").title() or None,
            "previousClose": round(float(fg["previous_close"]), 1) if fg.get("previous_close") is not None else None,
            "previous1Week": round(float(fg["previous_1_week"]), 1) if fg.get("previous_1_week") is not None else None,
        }
    except Exception as exc:
        log.warning("Fear & Greed fetch failed: %s", exc)
        return None


def register(app: Any) -> None:
    from fastapi import Query  # type: ignore[import]

    @app.get("/api/market/context")
    async def get_market_context(
        ticker: str = Query("SPY", description="Primary ticker for daily pattern flags"),
    ) -> dict[str, Any]:
        sym = ticker.upper().strip() or "SPY"

        fear, qqq_pack, nyad_pack, user_pack = await asyncio.gather(
            _fetch_fear_greed(),
            fetch_candles("QQQ", "1d", "6mo"),
            fetch_candles("^NYAD", "1d", "1y"),
            fetch_candles(sym, "1d", "3mo"),
        )

        qqq_candles = qqq_pack.get("candles") or [] if qqq_pack.get("ok") else []
        nyad_candles = nyad_pack.get("candles") or [] if nyad_pack.get("ok") else []
        user_candles = user_pack.get("candles") or [] if user_pack.get("ok") else []

        qqq_streak = _consecutive_higher_close_streak(qqq_candles) if qqq_candles else 0
        breadth = _nyad_breadth_metrics(nyad_candles) if nyad_candles else None
        three_red = _three_red_days(user_candles) if user_candles else False

        return {
            "ok": True,
            "ticker": sym,
            "fearGreed": fear,
            "breadth": breadth,
            "qqq": {
                "symbol": "QQQ",
                "proxy": "Nasdaq-100",
                "upCloseStreak": qqq_streak,
                "elevenPlusUpDays": qqq_streak >= 11,
            },
            "tickerPattern": {
                "symbol": sym,
                "threeRedDays": three_red,
            },
        }
