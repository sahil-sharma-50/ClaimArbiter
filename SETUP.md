# ClaimArbiter — Pre-Flight Setup

Everything you must create and configure **before** running the demo. Work top to
bottom; the pre-flight checklist at the end confirms you're ready.

You are wiring up **6 Band agents** across two conceptual orgs, **2 model
providers** (AI/ML API + Featherless), and **1 human reviewer user**. Budget ~20–30
minutes the first time.

---

## 0. The shape of what you're building

```
Insurer (Org A)                          Outside specialists (Org B)
┌──────────────────────────────┐        ┌────────────────────────────┐
│ Intake          (AI/ML API)   │        │ Property   (Featherless)    │  tag: property-damage
│ Evidence Analyst(AI/ML + VL)  │  ──▶   │ Medical    (Featherless)    │  tag: medical-review
│ Case Coordinator (AI/ML API)  │  recruit│ Legal      (Featherless)    │  tag: legal-review
│ Human Reviewer  (Band user)   │  across └────────────────────────────┘
└──────────────────────────────┘  org boundary
```

Flow: `Intake (classifies domain) → Evidence Analyst → Case Coordinator → (recruits the matching specialist) → specialist adjudicates → Case Coordinator relays → Human signs off`.

---

## 1. Accounts, plans & credits

| Service | What to do | Cost for the hackathon |
|---|---|---|
| **Band** | Sign up at [app.band.ai](https://app.band.ai). Apply promo **`BANDHACK26`** for 1 month of **Band Pro free** (Manage Billing → Pro → Add promotion code). Cross-org recruiting needs Pro. | **Free** with code |
| **AI/ML API** | Get an API key at [aimlapi.com](https://aimlapi.com). Claim the **$10** hackathon credit via lablab.ai. | **$10** credit |
| **Featherless** | Subscribe at [featherless.ai](https://featherless.ai), apply promo **`BOA26`** for **$25** credit. Featherless is **subscription + concurrency** based (unlimited requests, fixed concurrent connections) — **not per-token**. See the plan table in §6. | **$25** credit |

> Cancel the Band Pro and Featherless subscriptions before the next billing cycle if you don't intend to continue.

---

## 2. Create the 6 Band agents

Go to **[app.band.ai/agents](https://app.band.ai/agents) → New Agent** and create **six** agents.
For each, copy its **Agent ID (UUID)** and **API key** — you'll paste them into `agent_config.yaml` in §7.

> **Naming matters — the code finds agents by name.** The seed script locates the
> insurer agents with a case-insensitive name match, and the agents @mention each
> other by handle. Use the **exact names and handles** below.

| # | Name (use exactly) | Handle | Description to paste into Band | Capability tag |
|---|---|---|---|---|
| 1 | `Intake` | `intake` | Insurance intake & coverage agent. Parses a filed claim and confirms policy coverage, then hands off for evidence analysis. | *(none)* |
| 2 | `Evidence Analyst` | `evidence-analyst` | Insurance evidence analyst. Reads uploaded damage photos and supporting documents, derives structured concern signals, and shares them with the Case Coordinator. | *(none)* |
| 3 | `Case Coordinator` | `case-coordinator` | Insurance claim case coordinator. Classifies the claim's domain, discovers and recruits the matching outside specialist across the org boundary, relays the specialist's recommendation, and escalates to a human. | *(none)* |
| 4 | `Legal Review` | `legal-review` | Legal-expense reviewer (Legal Group). Reviews lawyer fees and legal proceedings for policy coverage. | **`legal-review`** |
| 5 | `Property Assessment` | `property-agent` | Property & water-damage assessor (Property Group). Judges whether a loss is consistent with a covered peril. | **`property-damage`** |
| 6 | `Medical Review` | `medical-agent` | Medical/injury claims reviewer (Medical Group). Checks billed treatment against the reported injury. | **`medical-review`** |

**Minimum for the hero demo:** agents 1, 2, 3, and one specialist (4, 5, or 6).
Register all six to demo domain routing across property, medical, and legal.

> The three insurer agents (Intake / Evidence Analyst / Case Coordinator) can all live
> under your own Band account. The three specialists demonstrate cross-org
> recruiting best if registered under a **second Band account/org**, but a single
> account also works for a first run.

---

## 3. Set capability tags (web UI only — there is no API for this)

The Case Coordinator discovers specialists by **tag**, not by name. On each specialist
agent's page in the Band web UI, add its tag **exactly**:

- Property Assessment → `property-damage`
- Medical Review → `medical-review`
- Legal Review → `legal-review`

If a tag is missing or misspelled, `lookup_peers` won't match and the Case Coordinator
can't recruit — the claim will stall after classification.

---

## 4. Human reviewer (for the sign-off beat)

The Case Coordinator escalates to `@Human Reviewer` for the final approve/deny.

- **`HUMAN_REVIEWER_USER_ID`** — the **UUID of a Band user** (your account owner, or a
  dedicated reviewer user). Find it in your Band account/profile. This user is
  added to each claim room so `@Human Reviewer` resolves and approve/deny posts as a human.
- **`HUMAN_REVIEWER_USER_API_KEY`** *(optional)* — a **user** API key (not an agent key).
  Only needed to click Approve/Deny **from the dashboard**. Without it, sign-off is
  done from the Band UI instead.

---

## 5. Fill `.env`

```bash
make setup
# or: cp .env.example .env
```

Edit `.env`:

| Variable | Put here | Notes |
|---|---|---|
| `AIML_API_KEY` | your AI/ML API key | Org A (Intake, Evidence Analyst orchestration, Case Coordinator) |
| `AIML_MODEL` | `gpt-4o` | default tool-capable model (matches `.env.example`); `gpt-4o-mini` is a cheaper option — see §6 |
| `FEATHERLESS_API_KEY` | your Featherless key | Org B specialists + the vision call |
| `FEATHERLESS_MODEL` | `meta-llama/Meta-Llama-3.1-8B-Instruct` | specialist **text** model — see §6 |
| `FEATHERLESS_VISION_MODEL` | `google/gemma-4-31B-it` | Evidence Analyst **vision** model (matches `.env.example`; open / ungated) — see §6 |
| `HUMAN_REVIEWER_USER_ID` | Band user UUID | enables the `@Human Reviewer` sign-off |
| `HUMAN_REVIEWER_USER_API_KEY` | Band user API key | optional; dashboard approve/deny |
| `THENVOI_REST_URL` / `THENVOI_WS_URL` | leave as default | already point at `app.band.ai` |

> The dashboard can also store the reviewer key in-browser via its **Keys** form
> (`/app` settings) instead of `.env` — handy for a hosted demo.

---

## 6. Model choices — cheapest that does the job

### AI/ML API (per-token; your $10 credit) — Intake, Evidence Analyst, Case Coordinator

| Model | Why | Verdict |
|---|---|---|
| **`gpt-4o`** | The shipped default (`.env.example`). Strongest tool-calling and reasoning of these three — the most reliable run for a demo. The brittle multi-step work (recruit, cross_check, evidence read) runs as **deterministic Python tools**, so the model mostly has to *call* them. | ✅ **Recommended (default)** |
| `gpt-4o-mini` | ~15× cheaper, still tool-calling capable. A fine budget choice if you want to stretch the $10 credit; the deterministic tools carry the brittle logic either way. | ✅ cheaper option |
| `gpt-4.1-mini` | Similar price/quality to `-mini`; fine alternative. | ok |

Set `AIML_MODEL=gpt-4o` (the default). Switch to `gpt-4o-mini` if you want to conserve the $10 credit.

### Featherless text (subscription; your $25 credit) — 3 specialists

| Model | Size / tier | Verdict |
|---|---|---|
| **`meta-llama/Meta-Llama-3.1-8B-Instruct`** | 8B — fits even the **$10 Basic** tier; fast; good enough for a role-based verdict. | ✅ **Recommended** |
| `Qwen/Qwen2.5-32B-Instruct` (or similar) | stronger reasoning, needs the **$25 Premium** tier (any model). | quality upgrade |

> ⚠️ Featherless serves **open-weight models only.** An OpenAI id like
> `openai/gpt-4o-mini` **404s** here — keep `FEATHERLESS_MODEL` on the Llama value
> above (or another open-weight id).

### Featherless vision (subscription) — Evidence Analyst perception

| Model | Size / tier | Verdict |
|---|---|---|
| **`google/gemma-4-31B-it`** | 31B — the shipped default (`.env.example`). **Open / ungated**, so it loads without HuggingFace OAuth. | ✅ **Recommended (default)** |
| `google/gemma-3-*-it` | The `gemma-3` line is **HuggingFace-gated** and 403s on Featherless (`model_gated_needs_oauth`). Avoid unless your org has accepted the gate. | ⚠️ gated — avoid |

> **You can go cheap on vision.** We hardened the deterministic path so the trap is
> sprung by the **police-report PDF text vs the claim narrative** (pure Python) —
> vision is *enrichment*, not the load-bearing signal. The demo even works with
> vision degraded entirely, so the exact VL model matters little to the result.

### Featherless plan — which subscription?

| Plan | $/mo | Model cap | Concurrency | Use it when |
|---|---|---|---|---|
| **Basic** | $10 | ≤ 15B | 2 | Budget run with `Llama-3.1-8B` for the specialists. The default 31B vision model exceeds the cap, so pick a smaller **open / ungated** VL (≤15B) or run with vision degraded — the deterministic PDF path still carries the signals. |
| **Premium** | $25 | **any** | 4 | **Recommended** — exactly covered by the `BOA26` $25 credit. Runs the default `google/gemma-4-31B-it` vision model and gives 4 concurrent connections (safer with 4 Featherless agents alive). |

---

## 7. Fill `agent_config.yaml`

```bash
cp agent_config.example.yaml agent_config.yaml
```

Paste each agent's **UUID** and **API key** from §2:

```yaml
intake_coverage:  { agent_id: "<uuid>", api_key: "<key>" }
evidence_analyst: { agent_id: "<uuid>", api_key: "<key>" }
case_coordinator: { agent_id: "<uuid>", api_key: "<key>" }
legal_agent:      { agent_id: "<uuid>", api_key: "<key>" }
property_agent:   { agent_id: "<uuid>", api_key: "<key>" }
medical_agent:    { agent_id: "<uuid>", api_key: "<key>" }
```

> The placeholders `<uuid>` / `<key>` are **truthy strings**, so the agents will
> *start* but silently fail to authenticate to Band — leaving the chain stuck. Make
> sure every value is real before running.

---

## 8. Where each secret goes — quick map

| Secret | File / location |
|---|---|
| AI/ML API key, Featherless key, model names, reviewer IDs | `.env` (repo root) |
| 6 × Band agent UUID + API key | `agent_config.yaml` (repo root) |
| Capability tags (`property-damage`, `medical-review`, `legal-review`) | **Band web UI**, per specialist agent |
| Human Reviewer approve/deny key (alternative to `.env`) | Dashboard **Keys** form (in-browser) |

---

## 9. Generate the demo evidence assets

The repo ships small synthetic placeholders. Regenerate them (and optionally drop
in **real** car-damage photos for a stronger vision read):

```bash
cd backend

# optional: real photos override the synthetic ones, matched by filename
mkdir -p seed/source_photos
#   e.g. seed/source_photos/damage_rear.jpg, water_kitchen.jpg, ...

uv run python seed/generate_golden_assets.py
```

This writes per-claim photos + the police / plumber / intake PDFs whose text drives
the deterministic signals. Real photos are copied verbatim; missing ones fall back
to clear synthetic renders.

---

## 10. Pre-flight checklist

- [ ] Band Pro active (`BANDHACK26` applied)
- [ ] 6 agents created; UUIDs + keys copied
- [ ] Agent **names/handles** match §2 (Intake / Evidence Analyst / Case Coordinator especially)
- [ ] 3 specialist **tags** set in the Band web UI
- [ ] `.env` filled: both API keys + the three model vars
- [ ] `agent_config.yaml` filled with all 6 real credentials (no `<uuid>` left)
- [ ] `HUMAN_REVIEWER_USER_ID` set (and key, if signing off from the dashboard)
- [ ] Featherless plan covers your chosen vision model size (Premium runs the default 31B; on Basic pick an open ≤15B VL or run vision degraded)
- [ ] Assets generated (`seed/generate_golden_assets.py`)
- [ ] `cd backend && uv sync` run (Python deps incl. `pymupdf`, `pillow`, `reportlab`)

---

## 11. Run it

From the repo root (after `make setup`):

```bash
make up
```

**On Windows** (no `make`), use the cross-platform Python script — it does the
same build, health-wait, and prints the same banner:

```powershell
python scripts\up.py        # build + start
python scripts\up.py logs   # follow logs
python scripts\up.py down   # stop
```

Both wait for the gateway healthcheck, then print the dashboard URLs. (The Band
poll/404 chatter is now suppressed from the logs — those 404s are normal while a
chat's context warms up.)

Or without Docker (`make dev` prints all three terminals):

```bash
cd backend && uv sync && uv run python agents/run_all.py    # terminal 1
cd backend && uv run python gateway/main.py                 # terminal 2
cd frontend && cp .env.local.example .env.local && npm install && npm run dev   # terminal 3
```

Open **http://localhost:3000/app/live**, pick the **legal** preset, and watch:
`Intake (classifies domain) → Evidence Analyst (reads the photo/PDF) → Case Coordinator recruits
Legal across the org boundary → Legal adjudicates (a deny: attorney fees for an excluded
business dispute) → coordinator relays → human sign-off`. Pick **property** or **medical**
to see the other domains route to their specialists.

---

## 12. Troubleshooting (the usual first-run snags)

| Symptom | Likely cause | Fix |
|---|---|---|
| Chain stalls after **coverage**, never reaches evidence | Evidence Analyst agent not registered / wrong name / placeholder creds; or `@EvidenceAnalyst` mention didn't resolve | Verify agent #2 exists, name contains "evidence", real creds in `agent_config.yaml`; check it's added to the room |
| Case Coordinator classifies but **never recruits** | Specialist **tag** missing/misspelled in Band UI | Re-set the exact tag (§3); confirm the specialist agent is online |
| Specialist 404 / "model not found" | `FEATHERLESS_MODEL` set to a non-Featherless model (e.g. an OpenAI id) | Use an open-weight id like `meta-llama/Meta-Llama-3.1-8B-Instruct` |
| Vision "degraded" banner, but routing still works | Open-weight VL returned low confidence on synthetic art | Expected & safe — deterministic PDF path carries the signals. Drop in real photos for a clean read |
| `@Human Reviewer` mention fails / no sign-off prompt | `HUMAN_REVIEWER_USER_ID` missing or not added to the room | Set it in `.env`; it must be a **user** UUID, not an agent |
| Dashboard approve/deny does nothing | No `HUMAN_REVIEWER_USER_API_KEY` | Add it to `.env` or the dashboard Keys form, or sign off from the Band UI |
| Agents "start" but nothing happens in Band | Placeholder `<uuid>`/`<key>` still in `agent_config.yaml` | Paste real credentials for all six |
| 401 from a provider | Wrong/empty `AIML_API_KEY` or `FEATHERLESS_API_KEY` | Re-check `.env` |
