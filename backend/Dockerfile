FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

COPY pyproject.toml uv.lock README.md ./
COPY agents agents/
COPY gateway gateway/
COPY seed seed/
COPY entrypoint.sh ./

RUN uv sync --frozen --no-dev

EXPOSE 8080

# entrypoint.sh copies a Render-mounted Secret File (agent_config.yaml) into /app
# if present, then execs the gateway. See backend/entrypoint.sh for why this isn't
# inlined into render.yaml's dockerCommand (Render execs that without a shell).
CMD ["sh", "entrypoint.sh"]
