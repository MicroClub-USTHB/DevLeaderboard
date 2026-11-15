# Phase Progress — DevLeaderboard frontend

> **Status: complete.** Phases 0–7 are done, verified and committed. This file records what each
> phase shipped and the evidence that it works; it is a project record, not a to-do list.

## Phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Scaffold & shell — Vite, React 19, strict TS, Tailwind v4 `@theme` tokens, router, providers, ESLint | ✅ done |
| 1 | API layer — typed DTOs, fetch wrapper (`ApiError`, ETag cache, network→status 0), `cn`, formatters | ✅ done |
| 2 | Read path — TanStack Query hooks, period tabs, table + mobile cards, rank badges, all five page states | ✅ done |
| 3 | Resilience — 304 replay, toast system, stale-data banner, failure drill against a dead GitHub API | ✅ done |
| 4 | Auth — session context/provider split, login/register (RHF + zod), header session state, redirects | ✅ done |
| 5 | Refresh — `useRefresh` mutation + `RefreshButton`, auth-gated, rate-limit aware, cache invalidation | ✅ done |
| 6 | Temporary test suite — API client, page states, refresh flow, auth flows; green twice, then removed | ✅ done |
| 7 | Cleanup & ship — gates/tests removed, dead code deleted, clean install, README, final commit | ✅ done |

## What Phase 5 ships

- `POST /leaderboard/:org/refresh?period=X`; omitting `period` refreshes all three periods.
- Header **Refresh** re-syncs the visible period; the empty-state CTA **Run the first refresh**
  syncs everything.
- Signed out → the button is disabled with a "Sign in to trigger a refresh" hint. In-flight →
  disabled + spinner, so a double click can never start two syncs.
- `401` → session cleared, toast, redirect to `/login`; `429` → toast with the server's
  `Retry-After`; other failures → the API message.
- Success → toasts, then invalidates the org's leaderboard + meta queries so the visible table
  refetches immediately.

## Bug found and fixed while testing

`onSuccess` originally called `queryClient.removeQueries(...)`, which drops the cache entry without
refetching. The page kept showing the pre-refresh snapshot even though the refresh succeeded.
Replaced with `invalidateQueries`, which marks the org's queries stale and refetches the active
one (inactive periods refetch when opened). The ETag cannot cause a false `304` here because the
validator embeds `generatedAt`.

A TypeScript trap was also fixed: calling `isAuthError(error)` inside `onError` (where `error` was
already typed `ApiError`) narrowed the parameter to `never`, producing `TS2339`. The handler now
reads `status` / `retryAfterSeconds` / `message` into locals before branching.

## Final verification (Phase 7)

Run on a clean `npm ci` (frontend) with the backend live on port 3000:

- `npm run typecheck` ✅ · `npm run lint` ✅ · `npm run build` ✅
- Temporary suite before removal: **27/27** across the API client (9), leaderboard page (9) and
  auth flows (9) — run green twice. Tests and all test tooling were then deleted, per policy.
- Live API smoke (through the Vite `/api` proxy): snapshot, limit, ranking, weak ETag → `304`,
  `202` for an unknown org, `401` for an anonymous refresh, register → JWT, one real single-period
  refresh → `200`, fresh snapshot readable, meta reports weights + all stored periods. **20/20**.
- Dev server serves the SPA shell, proxies `/api`, and falls back to `index.html` for deep links.

## Stack decisions

- Dark-only theme, deep-blue accent on zinc surfaces, all colors as `@theme` roles
  (`canvas`, `surface`, `overlay`, `line`, `ink*`, `accent-*`).
- Self-hosted Inter Variable via `@fontsource-variable/inter` — no runtime font CDN.
- Hand-written DTOs (no generated client); one fetch wrapper for every request.
- TanStack Query owns caching, retries and invalidation; auth state lives in one context backed by
  `localStorage` (`dlb.auth`), read synchronously so there is no logged-out flash.
