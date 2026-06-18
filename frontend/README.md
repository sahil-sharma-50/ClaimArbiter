# ClaimArbiter frontend

Single [Next.js](https://nextjs.org) app — landing page at `/` and the live command center at `/app/*`.

| Folder | Route | Purpose |
|--------|-------|---------|
| [`landing-page/`](./landing-page/) | `/` | Hackathon briefing, architecture diagram, link into the console |
| [`dashboard/`](./dashboard/) | `/app/*` | Live claim view, sessions, agents, settings, new claim |

The `app/` directory is the Next.js App Router (required by the framework). Route files there are thin entry points that import from `landing-page/` and `dashboard/`.

## Run locally

Gateway must be running on port 8080 first.

```bash
cp .env.local.example .env.local   # set NEXT_PUBLIC_GATEWAY_URL if needed
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Usually you'll start everything from the repo root with `make up` (Docker) — see the [root README](../README.md).

## Scripts

| Script | Does |
|--------|------|
| `npm run dev` | Dev server on :3000 |
| `npm run build` | Production build |
| `npm run start` | Serve production build |
| `npm run lint` | ESLint |

## Deploying

Set `NEXT_PUBLIC_GATEWAY_URL` to your gateway's public HTTPS URL. See [`../docs/DEPLOY.md`](../docs/DEPLOY.md).
