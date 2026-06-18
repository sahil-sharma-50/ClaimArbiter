# Dashboard (platform console)

Live command center at **`/app/*`** — watch claims move through agents, pick demo presets, sign off as human reviewer.

## Routes

| Path | Page |
|------|------|
| `/app` | Overview — stats and recent sessions |
| `/app/live` | Live claim view (main demo) |
| `/app/sessions` | Session history |
| `/app/agents` | Band agent directory |
| `/app/settings` | Provider keys form |
| `/app/new` | Custom claim intake |

Route files live in `app/app/` (Next.js App Router). They import from this folder.

## Key folders

| Path | What |
|------|------|
| `components/platform/` | Shell, sidebar, claim picker, keys form |
| `components/scenes/` | Phase-specific live views (intake, evidence, verdict…) |
| `lib/` | Gateway API client, polling hooks, session storage |

## Data

The dashboard **never talks to Band directly.** It polls the gateway at `NEXT_PUBLIC_GATEWAY_URL` (default `http://localhost:8080`).
