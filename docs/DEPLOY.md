# Deploying ClaimArbiter for a public URL

Two deployable tiers: the **frontend** (Vercel-friendly) and the **gateway** (an always-on host). You do **not** run the agents as a separate process — the gateway spawns and supervises the agent group itself (see [Agents](#agents) below).

## Topology

```
Vercel (frontend, HTTPS)
  NEXT_PUBLIC_GATEWAY_URL=https://gateway.<your-domain>
       │
   one VM / container host:
     - reverse proxy (Caddy/nginx): TLS → :8080
     - gateway:  python -m gateway.main
                 └─ spawns + supervises the agent group on demand
     - .env + ARBITER_STATE_DIR (optional)
```

The gateway needs:

- Server `.env` (provider keys, `HUMAN_REVIEWER_USER_API_KEY`, Band agent config)
- `.active_chat_id` fallback file (via `ARBITER_STATE_DIR` if not co-located)

It passes these through to the agent group it launches, so there is no separate agent config to manage.

## Frontend (Vercel)

1. Set build env: `NEXT_PUBLIC_GATEWAY_URL=https://your-gateway.example.com`
2. Deploy `frontend/`
3. Do **not** put provider or reviewer secrets in `NEXT_PUBLIC_*`

Copy from [`frontend/.env.local.example`](../frontend/.env.local.example).

## Gateway host

Environment (add to `.env`):

```env
GATEWAY_PORT=8080
GATEWAY_POLL_SECONDS=1.5
SEED_CAP_PER_HOUR=30
HUMAN_REVIEWER_USER_API_KEY=...   # shared demo reviewer — enables sign-off for all visitors
```

Run:

```bash
cd backend
uv run python -m gateway.main
```

Put TLS in front (Caddy example):

```
gateway.example.com {
  reverse_proxy localhost:8080
}
```

## Agents

**Do not start the agents yourself.** The gateway is the sole launcher: on the first claim run it spawns the agent group (`python -m agents.run_all`) as a child process, injecting the resolved provider keys, and keeps it alive across the session (`gateway/agent_runner.py`).

This is a hard requirement, not a convenience. Band allows only **one live connection per agent identity**, so running `agents.run_all` separately while the gateway is up would open a second connection per agent and break the workflow. Just run the gateway — keep it alive with a process supervisor (`restart: unless-stopped` in Docker, systemd, or platform policy) and the agents follow.

## Docker (local / single host)

Existing `make up` (or `docker compose up --build` from the repo root) runs the gateway and dashboard together — and the gateway spawns the agents on demand — suitable for demos and single-host deploys.

## Guardrails

| Risk | Mitigation |
|------|------------|
| Unbounded LLM spend | `SEED_CAP_PER_HOUR` on gateway (default 30/IP/hour) |
| Mixed content | Gateway must be HTTPS when frontend is HTTPS |
| Cache cross-talk | Per-chat gateway cache (implemented) |
| Misleading BYO-keys | Settings UI labels keys as self-host only; demo uses server env |

## Health check

`GET /api/health` → `{ "ok": true, "gateway": true }`

The platform sidebar polls this every 15s.

## Smoke test (production)

1. Open HTTPS frontend — no mixed-content errors in console
2. Dashboard → Run demo claim → live view updates
3. Two browsers seed simultaneously — each sees only its `chat_id` state
4. Approve/deny works with server `HUMAN_REVIEWER_USER_API_KEY`
