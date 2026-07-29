FROM python:3.12-slim AS builder

WORKDIR /app

# System deps for patchright Chromium + audio codecs
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libxkbcommon0 libasound2 curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install uv (fast Python package manager)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Install project dependencies (frozen lock file, no dev extras)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Install patchright Chromium browser
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN uv run patchright install chromium

# ── Runtime stage ──────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libxkbcommon0 libasound2 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy uv + venv from builder
COPY --from=builder /uv /uvx /bin/
COPY --from=builder /app/.venv /app/.venv

# Copy Chromium from builder
COPY --from=builder /opt/playwright /opt/playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright

# Copy application code
COPY . .

# Default environment
ENV SAU_HOST=0.0.0.0
ENV SAU_PORT=6001
EXPOSE 6001

# Use explicit venv path to avoid uv project-resolution edge cases in runtime stage
CMD [".venv/bin/python", "run.py"]
