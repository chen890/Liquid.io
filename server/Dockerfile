# ──────────────────────────────────────────────────────────────────────────────
# EquityLens — Python extraction server
#
# Uses the official uv Docker image which ships Python 3.12 + uv together.
# me-auth-client is pulled from Mobileye's internal PyPI — the build MUST run
# on a machine that can reach:
#   https://artifactory.sddc.mobileye.com/artifactory/api/pypi/pypi/simple
# (Mobileye VPN or internal network required at build time).
# ──────────────────────────────────────────────────────────────────────────────
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

# curl is needed for the Docker health check
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency manifest and lock file first for layer caching
COPY pyproject.toml uv.lock ./

# Sync dependencies into the project's virtual environment
# --frozen:   respect the exact lock file — no version drift
# --no-dev:   skip test/dev tools
RUN uv sync --frozen --no-dev

# Copy application source
COPY *.py ./

EXPOSE 3712

# Run inside the uv-managed venv
CMD ["uv", "run", "python", "main.py"]
