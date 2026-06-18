# ClaimArbiter backend

Python stack: **agents**, **gateway**, **seed**, and **tests**.

| Folder | What it is |
|--------|------------|
| `agents/` | Six Band agents (intake, evidence, coordinator, three specialists) |
| `gateway/` | FastAPI service — polls Band, serves `/api/state` to the dashboard |
| `seed/` | Demo claims and one-click seed script |
| `tests/` | Unit tests |

Config files (`.env`, `agent_config.yaml`) live at the **repo root** so judges only configure one place.

## Run (local, no Docker)

From the repo root, after `make setup` and filling in credentials:

```bash
cd backend
uv sync
uv run python agents/run_all.py    # terminal 1
uv run python gateway/main.py      # terminal 2
```

Or use `make dev` from the repo root for the full three-terminal instructions (includes the frontend).

## Tests

```bash
make test
# or: cd backend && uv run python -m unittest discover -s tests
```

## Docker

The backend image is built from this folder. From the repo root:

```bash
make up
```

See the [root README](../README.md) and [SETUP.md](../SETUP.md) for credentials and troubleshooting.

---

## Architecture

Two planes:

1. **Agent plane** — agents talk through Band (system of record).
2. **Observability plane** — gateway polls Band REST (~1.5s), normalizes events into case-file phases, serves `/api/state` to the frontend.

### Live flow

1. `@Intake` receives a preset claim (`property`, `medical`, or `legal`) and classifies its domain from the narrative.
2. Intake posts coverage → `@EvidenceAnalyst`.
3. Evidence Analyst runs vision on uploads, posts `evidence_analysis` → `@Case Coordinator`.
4. Case Coordinator matches the claim's domain to a specialist `capability_tag` and recruits it (a claim that fits no domain is decided by the coordinator alone).
5. The specialist adjudicates — returns an approve/deny `specialist_verdict` with a written rationale; the coordinator relays it.
6. Escalate to `@Human Reviewer`; human signs off. PDF at `GET /api/report/{chat_id}`.

### Folder map

```
backend/
├── agents/
│   ├── run_all.py
│   ├── insurer/          intake, evidence, coordinator (+ bootstrap)
│   ├── investigation/    property, medical, legal specialists (shared specialist.py)
│   └── shared/           config, casefile, policies, evidence, prompts, scoring,
│                         registry, expert_match, handoff, readiness, providers
├── gateway/              FastAPI — main.py, band_client, agent_runner,
│                         projection, report, audit_seal
├── seed/                 demo claims + golden_claim assets
├── tests/
```

## Environment variables

See [`.env.example`](../.env.example) at the repo root. Agent credentials go in [`agent_config.yaml`](../agent_config.example.yaml).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Stalls after coverage | Evidence Analyst creds/name wrong in `agent_config.yaml` |
| Never recruits | Specialist capability tag missing in Band UI |
| Agents start but Band silent | Replace `<uuid>` / `<key>` placeholders in `agent_config.yaml` |

Full table in [SETUP.md §12](../SETUP.md).
