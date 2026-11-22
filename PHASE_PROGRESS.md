# Phase Progress — DevLeaderboard

> **Status: complete.** Phases 0–7 built the original app; phases 8–10 rebuilt it as a public
> leaderboard that opens on `MicroClub-USTHB`. This file records what each phase shipped and the
> evidence that it works; it is a project record, not a to-do list.

## Phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Scaffold & shell — Vite, React 19, strict TS, Tailwind v4 `@theme` tokens, router, providers, ESLint | ✅ done |
| 1 | API layer — typed DTOs, fetch wrapper (`ApiError`, ETag cache, network→status 0), `cn`, formatters | ✅ done |
| 2 | Read path — TanStack Query hooks, period tabs, table + mobile cards, rank badges, all five page states | ✅ done |
| 3 | Resilience — 304 replay, toast system, stale-data banner, failure drill against a dead GitHub API | ✅ done |
| 4 | Auth — session context/provider split, login/register, header session state, redirects | ✅ done, **removed in Phase 8** |
| 5 | Refresh — `useRefresh` mutation + `RefreshButton`, auth-gated, rate-limit aware, invalidation | ✅ done, **superseded in Phase 9** |
| 6 | Temporary test suite — API client, page states, refresh flow, auth flows; green twice, then removed | ✅ done |
| 7 | Cleanup & ship — gates/tests removed, dead code deleted, clean install, README, final commit | ✅ done |
| 8 | Backend rebuild — reliable collection, `month \| all \| custom`, TTL cache, auth removal, boot refresh | ✅ done |
| 9 | Frontend rebuild — default org, timeline selector, 202 auto-refresh, public forced refresh | ✅ done |
| 10 | Docs & cleanup — READMEs, dependency pruning, final live verification | ✅ done |
| 11 | Completeness — always union repo contributors, private-repo direct counting, token-scope docs | ✅ done |

## Original build (Phases 0–7)

- **Read path:** TanStack Query hooks, desktop table + mobile cards, rank badges, and five explicit
  page states (loading, error, empty, stale, data).
- **Resilience:** the fetch wrapper replays cached bodies on `304`, turns network failures into a
  typed status `0`, and the stale-data banner keeps a good snapshot on screen when a refresh fails.
- **Auth (later removed):** session context backed by `localStorage`, login/register pages, and an
  auth-gated refresh button. Phase 8 deleted the backend auth routes, controller, middleware, user
  model, JWT config and bcrypt/jsonwebtoken dependencies; Phase 9 deleted the frontend feature.
- **Refresh (superseded):** the original button re-synced the visible period and invalidated the
  org's queries. The rebuild kept the invalidation design but removed auth and added `force=1`.

### Bug found and fixed while testing

`onSuccess` originally called `queryClient.removeQueries(...)`, which drops the cache entry without
refetching. The page kept showing the pre-refresh snapshot even though the refresh succeeded.
Replaced with `invalidateQueries`, which marks the org's queries stale and refetches the active one.
The ETag cannot cause a false `304` here because the validator embeds `generatedAt`.

### Final verification (Phase 7)

Run on a clean `npm ci` (frontend) with the backend live on port 3000:

- `npm run typecheck` ✅ · `npm run lint` ✅ · `npm run build` ✅
- Temporary suite before removal: **27/27** across the API client (9), leaderboard page (9) and
  auth flows (9) — run green twice. Tests and all test tooling were then deleted, per policy.
- Live API smoke (through the Vite `/api` proxy): snapshot, limit, ranking, weak ETag → `304`,
  `202` for an unknown org, `401` for an anonymous refresh, register → JWT, one real single-period
  refresh → `200`, fresh snapshot readable, meta reports weights + all stored periods. **20/20**.
- Dev server serves the SPA shell, proxies `/api`, and falls back to `index.html` for deep links.

---

## Rebuild (Phases 8–10)

### Phase 8 — Backend: reliable collection + new timeline

**Root cause of the broken refresh.** The fine-grained PAT in `backend/config/.env` cannot read
`membersWithRole` (`FORBIDDEN: Resource not accessible by personal access token`). GraphQL returns
HTTP 200 for that error, so the old client mapped it to status `0` and the controller turned every
failure into the generic `"GitHub is unavailable right now"` 502.

**What changed**

- **Typed GitHub errors:** GraphQL error `type` → HTTP status (`FORBIDDEN`/`INSUFFICIENT_SCOPES`
  → 403, `NOT_FOUND` → 404, `RATE_LIMITED` → 429, `UNAUTHORIZED` → 401). Controllers forward
  GitHub's own explanation for 403/5xx and keep the generic message only for unknown failures.
- **Member fallback:** when the token cannot read membership, the collector unions the public
  member list with the contributors of every non-fork repository. Live result: **116 contributors**
  instead of 27 public members.
- **Silent, correct outside-collaborator handling:** a 403/404 there is expected for non-owner
  tokens and no longer produces the `"Outside collaborators unavailable"` warning. Only unexpected
  errors become warnings.
- **Bot handling:** `[bot]` accounts are filtered before GraphQL; an unresolvable login (e.g.
  `Copilot`, `dependabot[bot]`) is retried alone and skipped instead of failing a 10-user batch.
- **Zero-activity filtering:** members with no commits/PRs/reviews/issues in the window are not
  ranked.
- **Periods:** `month` (1st of the current month, 00:00 UTC → now), `all` (organization creation →
  now), `custom` (validated `from`/`to`, ≤366 days, not in the future).
- **Multi-year collection:** windows are split into ≤364-day chunks and summed per contributor.
- **Bounded concurrency:** repository scans 5 in parallel, contribution batches 4. All-time dropped
  from **140s → ~37s**; month/custom are ~8s.
- **Caching:** `month` 60s, `all`/`custom` 24h, `force=1` bypasses it. Snapshots are keyed by
  `{org, period, rangeKey}`; the model stores `rangeKey` and `orgCreatedAt` and migrates old
  periods away.
- **Auth removed:** routes/controller/middleware/user model, JWT config, and
  bcrypt/jsonwebtoken dependencies deleted. The refresh route is public and rate-limited.
- **Default org + boot refresh:** `LEADERBOARD_ORGS` defaults to `MicroClub-USTHB`; the server
  refreshes `month` and `all` once at startup.

**Verification**

- `npm run typecheck` ✅
- Live collector: month **12 active**, custom Q1 2026 **28 active**, all-time **97 active**, all
  with **0 warnings** and real activity.
- Live API: month `200`, unknown org `202`, `period=7d` `400`, `custom` without dates `400`,
  `/meta` `200` with `orgCreatedAt: 2018-10-13T21:55:27.000Z`, custom refresh `200`, forced month
  refresh `200`, ETag round-trip `304`, unknown-org refresh `404`, >366-day range `400`,
  `from > to` `400`.

### Phase 9 — Frontend: public, default org, timeline selector

**What changed**

- **Default org:** `/` redirects to `/leaderboard/MicroClub-USTHB`. The header keeps a compact
  "Switch org" field, so the app is not a dead end.
- **Timeline selector:** **This month** / **All time** / **Custom range**. The custom option opens
  From/To date inputs with local validation (both dates, `from ≤ to`, `to ≤ today`, ≤366 days) and
  commits only on **Apply**, so typing never fires a request per keystroke.
- **URL as state:** `?period=month|all|custom&from=YYYY-MM-DD&to=YYYY-MM-DD`; invalid custom
  ranges are normalized to a default 30-day window and written back with `replace`.
- **202 auto-refresh:** when a period has no snapshot, the page starts the refresh itself once per
  org+period+range and polls every 4s until the snapshot lands. A failed first refresh renders an
  explicit retry panel instead of polling forever.
- **Forced refresh:** the **Refresh** button sends `force=1`, so it always recomputes. In-flight
  state disables the button and shows a spinner.
- **Auth removed:** `AuthProvider`, auth context, login/register pages, home page, token option in
  the fetch wrapper, and the auth DTOs are gone. `react-hook-form`, `@hookform/resolvers` and
  `zod` were pruned from `package.json`.
- **Meta panel:** labels fixed periods and renders custom snapshots as `from → to`; keys include
  `rangeKey` so multiple ranges coexist.
- **Window context:** the page shows `Updated … · Nov 1, 2026 – Nov 22, 2026 · showing N of M
  contributors`, and an empty period gets a dedicated "No activity" state.

**Verification**

- `npm run typecheck` ✅ · `npm run lint` ✅ · `npm run build` ✅
- SPA shell and deep link both `200`; `/api` proxy serves month, all and custom snapshots `200`.
- ETag round-trip through the proxy → `304`.
- `POST .../refresh?period=month&force=1` through the proxy → `200`, `skipped: false`.
- Bundle audit: contains `This month`, `All time`, `Custom range`, `Preparing this leaderboard`,
  `MicroClub-USTHB`, `Switch org`; contains none of `This year`, `7 days`, `Create an account`,
  `Sign in`.

### Phase 10 — Docs & cleanup

- Root `README.md`, `backend/README.md` and this file rewritten to describe the public,
  default-org product: timeline options, caching TTLs, `force`, custom-range rules, member
  fallback, and the 202 auto-refresh contract.
- Unused frontend dependencies removed; both packages re-installed cleanly.
- Final gates: backend `typecheck` ✅ · frontend `typecheck` / `lint` / `build` ✅.

### Phase 11 — Completeness: repo contributors and private repositories

**Report.** A contributor known as **"malek bz"** was missing from the board.

**Investigation.** The account is `malek-bz09` (display name `malek bz `). It is not a public
member of any organization, has no commits/PRs/reviews/issues in `MicroClub-USTHB` across its full
history (chunked 2018 → now), does not appear in any org repository's contributor list, and has no
commit or PR matching `malek`/`bz` in the org. Its only recent work is in personal repositories and
`maito-guy/wildfire-dz` (2 commits, 22 PRs). The likely explanation is a contribution in a
**private** organization repository that the fine-grained token cannot see.

**What changed**

- **Repository contributors are always unioned**, not only on the permission-limited fallback.
  A one-off contributor who is neither a member nor an outside collaborator is no longer missed
  when the token can read `membersWithRole`.
- **Private repositories are counted directly** when the token can see them but lacks the classic
  `read:user` scope (fine-grained tokens). The collector reads commits, PRs, reviews and issues
  from each private repo and merges them by login. With `read:user`, GitHub's
  `contributionsCollection` already includes private activity, so the direct scan is skipped to
  avoid double counting. Forks are excluded from both paths.
- **Token scopes documented** in both READMEs: classic `repo` + `read:org` + `read:user`, or a
  fine-grained token with access to the private repositories.

**Verification**

- Temporary fake-client test (removed after passing): private repo with commits, PRs, reviews and
  issues produced exactly one entry per contributor; reviews counted once per person per PR; PRs
  not double-counted as issues; forks skipped; `read:user` skipped the direct scan.
- Backend `typecheck` ✅ · `build` ✅.
- Live forced refresh unchanged: month **12**, all-time **97**, **0 warnings**; month ≈ 7.6 s,
  all-time ≈ 36.5 s.

**Outcome.** The code now supports private repositories, but the token in `backend/config/.env`
still sees **0** private repositories for `MicroClub-USTHB`, so `malek-bz09` remains absent until
the token is granted access to the private repository (fine-grained), or replaced with a classic
PAT that has `repo` + `read:user`. The only visible activity for `malek-bz09` is outside the org
(`maito-guy/wildfire-dz`: 2 commits, 22 PRs), which an org-scoped leaderboard does not count.

## Stack decisions

- Dark-only theme, deep-blue accent on zinc surfaces, all colors as `@theme` roles
  (`canvas`, `surface`, `overlay`, `line`, `ink*`, `accent-*`).
- Self-hosted Inter Variable via `@fontsource-variable/inter` — no runtime font CDN.
- Hand-written DTOs (no generated client); one fetch wrapper for every request.
- TanStack Query owns caching, retries and invalidation. There is no auth state: the app is
  public and the refresh endpoint is rate-limited instead.
