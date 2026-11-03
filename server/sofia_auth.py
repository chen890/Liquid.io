"""
Sofia / Meezeh token lifecycle (Lucy-style).

Priority when obtaining a token:
  1. Cached in-memory token (if not near expiry)
  2. Meezeh faceless user (MEEZEH_USERNAME / MEEZEH_PASSWORD)
  3. Device-flow fallback (interactive / cached device session)
  4. SOFIA_API_KEY / SOFIA_API_TOKEN env seed (one-shot; invalidated on auth failure)

On InvalidAuthenticationToken / 401:
  - clear in-memory + Meezeh filesystem cache
  - invalidate the env seed so we don't keep replaying an expired paste
  - re-authenticate and retry the caller once
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Optional

log = logging.getLogger("equitylens.sofia_auth")

FACELESS_TOKEN_LIFETIME_SECONDS = 50 * 60  # Azure AD ~60m; refresh early
TOKEN_REFRESH_BUFFER_SECONDS = 5 * 60


class SofiaAuthenticator:
    def __init__(self) -> None:
        self.api_key: Optional[str] = None
        self.auth_method: Optional[str] = None
        self.token_expires_at: Optional[float] = None
        self._lock = threading.Lock()
        self._env_seed_invalidated = False
        self._consecutive_auth_failures = 0

    # ── sources ───────────────────────────────────────────────────────────────

    def _env_seed(self) -> Optional[str]:
        if self._env_seed_invalidated:
            return None
        token = (os.getenv("SOFIA_API_KEY") or os.getenv("SOFIA_API_TOKEN") or "").strip()
        return token or None

    def _meezeh_username_password(self) -> Optional[str]:
        username = (os.getenv("MEEZEH_USERNAME") or "").strip()
        password = (os.getenv("MEEZEH_PASSWORD") or "").strip()
        if not username or not password:
            return None
        try:
            from me_auth_client import meezeh_app  # type: ignore[import]
        except Exception as exc:
            log.error("me_auth_client unavailable: %s", exc)
            return None

        try:
            # Fresh token via Meezeh proxy (avoids stale MSAL silent cache when possible).
            try:
                token = meezeh_app.get_token_by_username_password(
                    username=username,
                    password=password,
                    use_meezeh_proxy=True,
                )
            except TypeError:
                token = meezeh_app.get_token_by_username_password(username, password)
            if token:
                log.info("Sofia auth via Meezeh faceless user (%s…)", token[:16])
                return str(token)
        except Exception as exc:
            log.error("Meezeh username/password failed: %s", exc)
        return None

    def _device_flow(self) -> Optional[str]:
        try:
            from me_auth_client import meezeh_app  # type: ignore[import]
        except Exception:
            return None
        try:
            token = meezeh_app.get_token_with_device_flow_fallback(fallback=True)
            if token:
                log.info("Sofia auth via Meezeh device-flow (%s…)", token[:16])
                return str(token)
        except TypeError:
            try:
                token = meezeh_app.get_token_with_device_flow_fallback()
                if token:
                    log.info("Sofia auth via Meezeh device-flow (%s…)", token[:16])
                    return str(token)
            except Exception as exc:
                log.error("Meezeh device-flow failed: %s", exc)
        except Exception as exc:
            log.error("Meezeh device-flow failed: %s", exc)
        return None

    def authenticate(self, *, allow_env_seed: bool = True) -> Optional[str]:
        """Obtain a token using the best available refreshable method."""
        # Prefer refreshable Meezeh credentials over a static pasted token.
        token = self._meezeh_username_password()
        if token:
            self.api_key = token
            self.auth_method = "faceless_user"
            self.token_expires_at = time.time() + FACELESS_TOKEN_LIFETIME_SECONDS
            self._consecutive_auth_failures = 0
            return token

        token = self._device_flow()
        if token:
            self.api_key = token
            self.auth_method = "device_flow"
            # Device-flow sessions are refreshed by Meezeh; keep a soft TTL as a hint.
            self.token_expires_at = time.time() + FACELESS_TOKEN_LIFETIME_SECONDS
            self._consecutive_auth_failures = 0
            return token

        if allow_env_seed:
            token = self._env_seed()
            if token:
                self.api_key = token
                self.auth_method = "environment"
                # Unknown lifetime — treat as already near expiry so next ensure
                # prefers Meezeh once credentials work; still usable for one call.
                self.token_expires_at = time.time() + TOKEN_REFRESH_BUFFER_SECONDS
                log.warning(
                    "Using SOFIA_API_KEY/SOFIA_API_TOKEN env seed (no Meezeh refresh). "
                    "Will invalidate automatically on auth failure."
                )
                return token

        return None

    # ── lifecycle ─────────────────────────────────────────────────────────────

    def is_token_expired(self) -> bool:
        if not self.api_key:
            return True
        if not self.token_expires_at:
            return self.auth_method != "device_flow"
        remaining = self.token_expires_at - time.time()
        if remaining <= 0:
            log.info("Sofia token expired %.0fs ago", abs(remaining))
            return True
        if remaining <= TOKEN_REFRESH_BUFFER_SECONDS:
            log.info("Sofia token expiring in %.0fs — proactive refresh", remaining)
            return True
        return False

    def clear_meezeh_cache(self) -> None:
        try:
            from me_auth_client import meezeh_app  # type: ignore[import]
        except Exception:
            return
        try:
            meezeh_app.reset_file_system_cache()
            log.info("Cleared Meezeh filesystem token cache")
        except Exception as exc:
            log.warning("Failed to clear Meezeh filesystem cache: %s", exc)
        try:
            if getattr(meezeh_app, "public_app", None) is not None:
                meezeh_app.public_app = None
            if getattr(meezeh_app, "public_app_instance", None) is not None:
                meezeh_app.public_app_instance = None
        except Exception:
            pass

    def clear_token(self, *, invalidate_env_seed: bool = False) -> None:
        prev = self.auth_method
        self.api_key = None
        self.token_expires_at = None
        self.auth_method = None
        if invalidate_env_seed or prev == "environment":
            self._env_seed_invalidated = True
            log.info("Invalidated SOFIA_API_KEY/SOFIA_API_TOKEN env seed for this process")
        self.clear_meezeh_cache()
        log.info("Sofia token cleared (was %s)", prev or "none")

    def ensure_valid_token(self, *, force_refresh: bool = False) -> str:
        """Return a usable bearer token, refreshing when expired / forced."""
        with self._lock:
            if force_refresh:
                self.clear_token(invalidate_env_seed=self.auth_method == "environment")

            if self.api_key and not self.is_token_expired():
                return self.api_key

            if self.api_key:
                self.clear_token(invalidate_env_seed=self.auth_method == "environment")

            if self._consecutive_auth_failures > 0:
                backoff = min(2**self._consecutive_auth_failures, 30)
                log.info(
                    "Auth backoff %ss after %d failure(s)",
                    backoff,
                    self._consecutive_auth_failures,
                )
                time.sleep(backoff)

            token = self.authenticate(allow_env_seed=not self._env_seed_invalidated)
            if token:
                self._consecutive_auth_failures = 0
                return token

            self._consecutive_auth_failures += 1
            return ""

    def status(self) -> dict:
        remaining = None
        if self.token_expires_at:
            remaining = max(0, int(self.token_expires_at - time.time()))
        return {
            "authMethod": self.auth_method or (
                "api_key" if self._env_seed() else (
                    "meezeh" if (os.getenv("MEEZEH_USERNAME") and os.getenv("MEEZEH_PASSWORD")) else "none"
                )
            ),
            "tokenCached": bool(self.api_key),
            "tokenExpiresInSec": remaining,
            "envSeedInvalidated": self._env_seed_invalidated,
            "meezehConfigured": bool(
                (os.getenv("MEEZEH_USERNAME") or "").strip()
                and (os.getenv("MEEZEH_PASSWORD") or "").strip()
            ),
            "sofiaKeyConfigured": bool(self._env_seed()) or (
                bool((os.getenv("SOFIA_API_KEY") or os.getenv("SOFIA_API_TOKEN") or "").strip())
                and not self._env_seed_invalidated
            ),
        }


def is_sofia_auth_error(status_code: int | None = None, body: str = "") -> bool:
    if status_code in (401, 403):
        return True
    lower = (body or "").lower()
    needles = (
        "invalidauthenticationtoken",
        "invalid token lifetime",
        "authentication error",
        "unauthorized",
        "lifetime validation",
        "token is expired",
        "failed to validate",
    )
    return any(n in lower for n in needles)


authenticator = SofiaAuthenticator()
