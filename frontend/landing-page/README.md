# Landing page

Marketing / briefing page at **`/`** — hero, problem statement, agent flow, architecture diagram, and a link into the live console (`/app`).

## Key files

| Path | What |
|------|------|
| `LandingPage.tsx` | Main page component (imported by `app/page.tsx`) |
| `components/` | Brandmark, BrandLockup, ArchitectureDiagram, TransmissionBand |
| `lib/` | Flow copy, scroll/reveal hooks |

Shared with the dashboard: `Brandmark` (used in the platform sidebar).

## Edit

Change copy and layout in `LandingPage.tsx`. Styles live in `app/globals.css` at the frontend root.
