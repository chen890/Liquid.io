"""
E*TRADE OAuth 1.0a integration (PIN-based flow for local apps).
Developer portal: https://developer.etrade.com/getting-started
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel
from requests_oauthlib import OAuth1Session  # type: ignore[import]

log = logging.getLogger("equitylens.etrade")

ETRADE_BASE = "https://api.etrade.com"
ETRADE_SB   = "https://apisb.etrade.com"
ETRADE_AUTH = "https://us.etrade.com/e/t/etws/authorize"

# In-process token store keyed by consumer_key
_sessions: dict[str, dict] = {}


class StartRequest(BaseModel):
    consumerKey:    str
    consumerSecret: str
    sandbox:        bool = False


class VerifyRequest(BaseModel):
    consumerKey:     str
    consumerSecret:  str
    oauthToken:      str
    oauthTokenSecret: str
    verifier:        str
    sandbox:         bool = False


class AccountsRequest(BaseModel):
    consumerKey: str


def _base(sandbox: bool) -> str:
    return ETRADE_SB if sandbox else ETRADE_BASE


def _sess(consumer_key: str) -> dict:
    s = _sessions.get(consumer_key)
    if not s:
        raise HTTPException(401, "E*TRADE not connected. Complete the OAuth flow first.")
    return s


def _oauth(s: dict) -> OAuth1Session:
    return OAuth1Session(
        s["consumerKey"], s["consumerSecret"],
        s["accessToken"],  s["accessSecret"],
    )


def register(app: Any) -> None:
    """Mount E*TRADE routes onto the FastAPI app."""

    @app.post("/api/etrade/auth/start")
    def auth_start(req: StartRequest) -> dict:
        """
        Step 1 — get a request token + build the authorization URL.
        The browser must open this URL so the user can authorize and get a PIN.
        """
        try:
            session = OAuth1Session(req.consumerKey, req.consumerSecret)
            tok = session.fetch_request_token(f"{_base(req.sandbox)}/oauth/request_token")
            url = session.authorization_url(ETRADE_AUTH, tok["oauth_token"])
            log.info("E*TRADE OAuth started for key %s...", req.consumerKey[:8])
            return {
                "ok":              True,
                "authUrl":         url,
                "oauthToken":      tok["oauth_token"],
                "oauthTokenSecret":tok["oauth_token_secret"],
            }
        except Exception as exc:
            raise HTTPException(400, f"OAuth start failed: {exc}") from exc

    @app.post("/api/etrade/auth/verify")
    def auth_verify(req: VerifyRequest) -> dict:
        """Step 2 — exchange request token + verifier PIN for an access token."""
        try:
            session = OAuth1Session(
                req.consumerKey, req.consumerSecret,
                req.oauthToken,  req.oauthTokenSecret,
                verifier=req.verifier,
            )
            tokens = session.fetch_access_token(
                f"{_base(req.sandbox)}/oauth/access_token"
            )
            _sessions[req.consumerKey] = {
                "consumerKey":    req.consumerKey,
                "consumerSecret": req.consumerSecret,
                "accessToken":    tokens["oauth_token"],
                "accessSecret":   tokens["oauth_token_secret"],
                "sandbox":        req.sandbox,
            }
            log.info("E*TRADE connected for key %s...", req.consumerKey[:8])
            return {"ok": True}
        except Exception as exc:
            raise HTTPException(400, f"OAuth verify failed: {exc}") from exc

    @app.post("/api/etrade/accounts")
    def accounts(req: AccountsRequest) -> dict:
        """Return E*TRADE account list."""
        s = _sess(req.consumerKey)
        r = _oauth(s).get(f"{_base(s['sandbox'])}/v1/accounts/list.json")
        r.raise_for_status()
        accts = r.json().get("AccountListResponse", {}).get("Accounts", {}).get("Account", [])
        return {"ok": True, "accounts": accts}

    @app.post("/api/etrade/portfolio")
    def portfolio(req: AccountsRequest) -> dict:
        """
        Fetch all positions across all accounts.
        Returns raw position data + a normalized 'grants' list suitable for import.
        """
        s = _sess(req.consumerKey)
        base = _base(s["sandbox"])
        oauth = _oauth(s)

        accts = oauth.get(f"{base}/v1/accounts/list.json")
        accts.raise_for_status()
        account_list = (
            accts.json()
            .get("AccountListResponse", {})
            .get("Accounts", {})
            .get("Account", [])
        )

        positions: list[dict] = []
        for acct in account_list:
            key = acct.get("accountIdKey")
            if not key:
                continue
            try:
                rp = oauth.get(
                    f"{base}/v1/accounts/{key}/portfolio.json",
                    params={"count": 250, "view": "COMPLETE"},
                )
                rp.raise_for_status()
                raw_pos = (
                    rp.json()
                    .get("PortfolioResponse", {})
                    .get("AccountPortfolio", [{}])[0]
                    .get("Position", [])
                )
                for pos in raw_pos:
                    prod     = pos.get("Product", {})
                    complete = pos.get("Complete", {})
                    positions.append({
                        "symbol":       prod.get("symbol"),
                        "securityType": prod.get("securityType"),
                        "quantity":     pos.get("quantity"),
                        "pricePaid":    pos.get("pricePaid"),
                        "marketValue":  pos.get("marketValue"),
                        "currentPrice": complete.get("lastTrade"),
                        "daysGain":     complete.get("daysGain"),
                        "totalGain":    complete.get("totalGain"),
                        "accountId":    acct.get("accountId"),
                        "accountName":  acct.get("accountName"),
                        "source":       "E*TRADE",
                    })
            except Exception as exc:
                log.warning("Portfolio error for account %s: %s", key, exc)

        # Normalize equity positions to grant-like format
        grants = [
            {
                "grantType":          {"value": "RSU", "confidence": 70},
                "tickerSymbol":       {"value": p["symbol"], "confidence": 99},
                "totalShares":        {"value": p["quantity"], "confidence": 99},
                "vestedShares":       {"value": p["quantity"], "confidence": 90},
                "fairMarketValue":    {"value": p["currentPrice"], "confidence": 99},
                "currentMarketValue": {"value": p["marketValue"],  "confidence": 99},
                "costBasis":          {"value": p["pricePaid"] * p["quantity"] if p["pricePaid"] and p["quantity"] else None, "confidence": 80},
                "sourceSnippets":     [{"field": "source", "snippet": f"E*TRADE account {p['accountName'] or p['accountId']}"}],
            }
            for p in positions
            if p.get("quantity") and float(p["quantity"]) > 0
            and p.get("securityType") in ("EQ", "OPTN", None)
        ]

        return {
            "ok":           True,
            "positions":    positions,
            "grants":       grants,
            "accountCount": len(account_list),
        }

    @app.get("/api/etrade/status/{consumer_key}")
    def status(consumer_key: str) -> dict:
        connected = consumer_key in _sessions
        return {"connected": connected, "consumerKey": consumer_key[:8] + "..." if connected else None}
