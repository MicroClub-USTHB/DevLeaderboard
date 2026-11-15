# DevLeaderboard

A GitHub organization leaderboard. It collects contribution activity for every member of an
organization across **all of its repositories**, ranks them with a composite score, caches the
result in MongoDB, and serves it through a small HTTP API. The read path never talks to GitHub.

The repo contains both halves of the product:

| Folder | What it is |
|---|---|
| [`backend/`](backend/) | Express 5 + TypeScript API, MongoDB cache, GitHub collector, cron refreshes |
| [`frontend/`](frontend/) | React 19 + Tailwind v4 single-page app (dark-only) |

## What the app does

- **Search any organization** and open its leaderboard at `/leaderboard/:org`.
- **Three windows** — last 7 days, last 30 days, or the current year — switchable in the URL
  (`?period=7d|30d|year`) so every view is shareable and bookmarkable.
- **Desktop table and mobile cards** with rank, commits, pull requests, reviews, issues and the
  weighted score.
- **Praised for its failure behavior:** a stale snapshot stays on screen when GitHub or the API is
  down, with a retry hint and the server's `Retry-After`.
- **Auth-gated refreshes:** sign in to trigger a re-sync (one period or all three). Success
  invalidates the cached views, `401` ends the session, `429` shows the retry delay.
- **Meta panel:** scoring weights, GitHub rate-limit budget and snapshot freshness.

## Stack

**Backend** — Express 5 · TypeScript (ESM) · Mongoose · Node 22+ · GitHub GraphQL API (REST
fallback for outside collaborators) · node-cron · zod-validated config.

**Frontend** — Vite 8 · React 19 · TypeScript (strict) · Tailwind CSS v4 (`@theme` tokens) ·
React Router 7 · TanStack Query 5 · react-hook-form + zod · lucide-react.

## Quick start

Prerequisites: Node 22+, MongoDB (or a MongoDB Atlas connection string), and a GitHub token with
`read:org` access.

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env          # fill in JWT_SECRET, GITHUB_TOKEN, DATABASE_URL
npm run dev                   # http://localhost:3000

# 2. Frontend (second terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

The Vite dev server proxies `/api/*` to `http://localhost:3000`, so the browser never makes a
cross-origin request and the backend needs no CORS headers.

### Production build

```bash
cd frontend && npm run build    # static assets in frontend/dist/
```

Serve `frontend/dist/` from any static host and make sure `/api` is reverse-proxied to the backend
(the client always calls the relative path `/api/...`).

## Project structure

```
backend/
  app.ts                 Express app (helmet, rate limits, routes, error handling)
  server.ts              entry point (DB connect, listen, cron, graceful shutdown)
  routes/                Express routers (auth, leaderboard + rate-limit buckets)
  controllers/           HTTP semantics: validation, status codes, ETag, GitHub→HTTP error mapping
  services/
    leaderboard/         collector → aggregator → sync (single-flight writes)
    github/              typed REST/GraphQL client (timeout, backoff, rate-limit merge)
  models/                Mongoose schemas (User, LeaderboardSnapshot)
  jobs/                  node-cron scheduler
  middleware/            auth (requireAuth), request logging, error handling
  lib/                   structured JSON logger (level filtering + credential redaction)
  config/                zod-validated config, fail-fast at boot

frontend/
  src/app/               router, provider stack, layout, 404
  src/features/
    auth/                session context/provider, login and register pages
    home/                organization search
    leaderboard/         queries + refresh mutation, table/cards, meta, stale banner
  src/shared/
    api/                 typed DTOs and the single fetch wrapper (ApiError, ETag cache)
    lib/                 cn, formatters, toast queue
    ui/                  Button, States, Toasts
```

## How it works

1. **Collect** — the scheduler (or an authenticated `POST /refresh`) walks every repository and
   every member, batching GitHub GraphQL queries and merging REST results for outside
   collaborators.
2. **Score** — commits, pull requests, reviews and issues are weighted into one number; ties break
   deterministically.
3. **Cache** — the ranked list is stored per organization and period, with a `generatedAt`
   timestamp and any collector warnings.
4. **Serve** — reads come from MongoDB only. `GET /leaderboard/:org` sends a weak ETag derived from
   the snapshot (`generatedAt`, entry count, limit), so repeat views answer `304 Not Modified` and
   reuse the cached body. A missing snapshot is a `202` with a message, not an error.

## API overview

All responses are JSON; errors use `{ "error": "..." }`.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | — | Create an account, returns `{ user, token }` |
| `POST` | `/auth/login` | — | Sign in, returns `{ user, token }` |
| `GET` | `/leaderboard/:org` | — | Snapshot from Mongo (never hits GitHub); `?period=7d\|30d\|year&limit=1..100`, supports ETag/304 |
| `GET` | `/leaderboard/:org/meta` | — | Score weights, GitHub rate-limit budget, snapshot freshness |
| `POST` | `/leaderboard/:org/refresh` | Bearer JWT | Trigger a refresh (spends GitHub quota); omit `period` to sync all three |
| `GET` | `/health` | — | `{ "status": "ok" }` |

## Scripts

Run from `backend/`:

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with watch (`tsx watch`) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled server |
| `npm run typecheck` | Strict type check |

Run from `frontend/`:

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server with the `/api` proxy |
| `npm run build` | Type-check and emit static assets to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | Strict type check |
| `npm run lint` | ESLint (flat config) |

---

Full backend documentation — environment variables, scoring formula, periods, scheduling, failure
behavior and logging — is in [`backend/README.md`](backend/README.md).
