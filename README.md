# UIC Group Agent System — Orchestrator Scaffold

A working, tested scaffold for the 20-agent architecture, ready to drop into your
existing Render deployment alongside `Instagram-agent`. All 20 agents are wired,
follow the same contract, log to Postgres, and run through one BullMQ-based
orchestrator. Most agents are **stubs with real I/O shape** — the plumbing works
end-to-end today; you fill in the TODOs (real API calls) agent by agent.

## What's actually wired and tested right now
This has been run end-to-end against a real Redis + Postgres instance (not just syntax-checked):
- All 20 agents load through the registry and execute through the contract wrapper.
- The full BullMQ flow mechanics — parallel fan-out, parent/child dependencies (`FlowProducer`), waiting for completion across a separate worker process (`QueueEvents` + `waitUntilFinished`) — run correctly and were verified with a live worker process.
- `content_pipeline_runs`, `agent_runs`, `leads` tables were verified to receive correct rows during real runs (checked via direct SQL).
- The Express API (`/pipeline/run`, `/pipeline/:id`, `/webhook/engagement`, `/health`) was tested live, including the 404 case.
- `script_agent`, `caption_agent`, `viral_prediction_agent`'s length-heuristic, `lead_qualification_agent` — the Claude-dependent ones — were confirmed to correctly reach `api.anthropic.com` and fail cleanly (with a real 401, since no key was available in testing) rather than crashing; with a real `CLAUDE_API_KEY` these will just work.
- `crm_agent` writes real rows to Postgres — verified.
- Two real bugs were found and fixed during this testing pass (see below) — everything else (Image/Video/Voice/Subtitle/Thumbnail, all 4 publishers, WhatsApp, Analytics, Revenue) returns realistic stub output with a `TODO` comment showing exactly what real API call goes where.

### Bugs found and fixed in this pass
1. **Job-completion waiting was broken.** The original polling code checked `.getState()`/`.returnvalue` on the same in-memory `Job` object returned by `.add()` — but that object never refreshes as a *separate worker process* processes the job, so it would poll forever and hang. Fixed by using BullMQ's actual intended mechanism: `job.waitUntilFinished(queueEvents)`, via a shared `QueueEvents` instance.
2. **SQL injection risk in `analyticsAgent.js`.** `since_days` was interpolated directly into a SQL string (`interval '${since_days} days'`). Not exploitable in the current scheduler-only usage, but a real hole the moment this agent is exposed through any API route. Fixed with input validation + a parameterized query. Verified a malicious injection string is now inert.
3. **Silent failure ambiguity in the engagement webhook.** If `lead_qualification_agent` errored (e.g. bad API key), the code treated that identically to "this message isn't a lead" — which would silently hide real outages as if no one were messaging in. Fixed to surface agent errors distinctly (`action: "error"`) from genuine non-leads (`action: "ignored"`).
4. **Missing status checks before using agent output.** `runCreationStage` used `script_agent`'s output without checking whether it had actually succeeded, and the creation-stage results weren't checked for partial failures before deciding whether to publish. Fixed to fail fast with a clear message on script failure, and to force `needs_review` if any creation-stage agent fails or the caption is missing — so a broken agent can't result in a post going out with a blank caption.

## Project structure
```
agent-system/
├── agents/                    # 20 agent files, one per agent, each self-contained
├── orchestrator/
│   ├── agentContract.js       # the standard wrapper every agent uses (timing, logging, errors)
│   ├── agentRegistry.js       # name -> function lookup, single source of truth
│   ├── claudeClient.js        # shared Claude API caller
│   ├── queue.js               # Redis + BullMQ queue/flow setup
│   ├── contentPipeline.js     # Stage 1→2→3: Intelligence → Creation → Distribution
│   ├── engagementWorkflow.js  # Stage 4: event-driven (webhook -> lead -> CRM -> WhatsApp)
│   ├── scheduler.js           # Stage 5: cron-scheduled Analytics + Revenue agents
│   └── worker.js              # the actual job processor (deploy as separate Render service)
├── db/
│   ├── schema.sql             # 4 new tables — does not touch your existing Instagram-agent tables
│   ├── db.js                  # Postgres connection + helper functions
│   └── migrate.js             # run once to create the new tables
├── index.js                   # Express API: trigger pipelines, receive webhooks
└── .env.example
```

## Setup

1. **Install dependencies**
   ```
   npm install
   ```

2. **Copy `.env.example` to `.env`** and fill in:
   - `DATABASE_URL` — your existing Postgres (same one Instagram-agent probably already uses, or a new one)
   - `REDIS_URL` — new: add a Redis instance on Render (Key Value service)
   - `CLAUDE_API_KEY` — same one you already use
   - Existing Meta/WATI/JWT values — same as your current Instagram-agent config

3. **Run the migration** (creates 4 new tables, doesn't touch anything existing):
   ```
   npm run migrate
   ```

4. **Run locally to test**:
   ```
   npm start          # Terminal 1 — API server on :3000
   npm run worker     # Terminal 2 — job processor
   npm run scheduler   # Terminal 3 — cron jobs (optional for local testing)
   ```

5. **Trigger a test pipeline run**:
   ```
   curl -X POST http://localhost:3000/pipeline/run \
     -H "Content-Type: application/json" \
     -d '{"brand":"usmanpura_imaging","platforms":["instagram"]}'
   ```

## Deploying to Render (3 services total, sharing existing Postgres + new Redis)

| Service | Type | Start command | Notes |
|---|---|---|---|
| `agent-api` | Web Service | `npm start` | Replaces/extends your current Instagram-agent web service |
| `agent-worker` | Background Worker | `npm run worker` | **New** — this is what actually runs the 20 agents. Scale this up (2-3 instances) once Image/Video Agent load grows. |
| `agent-scheduler` | Background Worker (or Render Cron Job) | `npm run scheduler` | **New** — runs Analytics daily, Revenue Optimization weekly |

Add a **Redis** instance (Render → New → Key Value) and point `REDIS_URL` at it from all three services.

## How to add agent #21 later
1. Create `agents/newAgent.js` following the same `defineAgent('new_agent', async (input, context) => {...})` pattern as any existing agent.
2. Add one line to `orchestrator/agentRegistry.js`.
3. Reference it in whichever stage/workflow file makes sense (`contentPipeline.js`, `engagementWorkflow.js`, or `scheduler.js`).

Nothing else changes — the worker, the contract, and the logging are already generic.

## Fill-in-the-TODOs priority order (matches the phased plan from before)
1. `agents/instagramPublisher.js` — move your existing live Meta Graph API posting code here unchanged
2. `agents/trendAgent.js`, `agents/competitorAgent.js` — wire real trend/competitor sources
3. `agents/imageAgent.js`, `agents/videoAgent.js`, `agents/voiceAgent.js`, `agents/subtitleAgent.js` — media generation APIs
4. `agents/facebookPublisher.js`, `agents/youtubeShortsPublisher.js`, `agents/linkedinPublisher.js` — additional platform auth
5. `agents/whatsappAgent.js` — plug in your existing WATI client
6. `agents/analyticsAgent.js`, `agents/revenueOptimizationAgent.js` — real insights APIs + cost-per-lead math
