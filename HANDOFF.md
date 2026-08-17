# HigherPays — Handoff

You (or your Cursor agent) are picking up a project already in progress.
Read this doc first. It captures the full mental model of the app,
what's been built, what runs where, and exactly what to do next.

If you only have five minutes, read sections **1**, **2**, and **9**.

---

## 1. What is this product?

**HigherPays** is a payments + operations platform for **creator agencies**
(agencies that manage content creators, e.g. OnlyFans creators, and the
"chatters" who message their fans on their behalf).

The agency uses the app to:

1. Create **payment links** for their creators' fans (customers).
2. Take payments through **MantaPay** (the payment provider — see §7).
3. Automatically split each payment across three parties:
   - the **creator** whose fan paid (rev-share % or fixed salary)
   - the **chatter** who closed the sale (commission %)
   - the **agency** itself (whatever's left after platform + provider fees)
4. Run **payouts** to creators and chatters on a schedule.
5. See **analytics, goals, and leaderboards** for the team.

The app is **multi-tenant SaaS**: multiple agencies use the same instance,
isolated from each other by **Postgres Row-Level Security (RLS)**. A
"workspace" == one agency.

There's also a **platform (super-admin) level** for the HigherPays
operator (Eran) sitting above every workspace.

---

## 2. Stack, at a glance

| Layer      | Tech                                               |
|------------|----------------------------------------------------|
| Frontend   | React 19 + TypeScript + Vite + Zustand + React Query + React Router v7 |
| Backend    | Node 22 + Express 4 + `pg` (raw SQL, no ORM)       |
| Database   | Postgres 16 with Row-Level Security                |
| Auth       | JWT (access + refresh), TOTP-based 2FA optional    |
| Provider   | MantaPay (hosted checkout; see `backend/src/providers/mantapay-*.js`) |
| Deploy     | Slim Docker containers, `docker compose up -d --build` |

**Repo layout** (monorepo):

```
higherpays/
├── frontend/         Vite + React app
├── backend/          Node/Express API + Postgres migrations
├── deploy/           Ops scripts (postgres init, etc.)
├── docker-compose.yml
└── .env.example
```

**Where it runs**:

- **Production/staging**: EC2 at `54.173.144.0`, path `/home/ubuntu/higherpays`.
  Public URL: `http://54.173.144.0:8083/`.
- **Local dev**: same `docker compose up -d --build` should work.

---

## 3. Where everything runs (EC2)

SSH: `ssh -i <key.pem> ubuntu@54.173.144.0`.

Three containers, all built from this repo:

| Container         | Image (base)          | Purpose                                   | Exposed port |
|-------------------|-----------------------|-------------------------------------------|--------------|
| `higherpays-pg`   | `postgres:16-alpine`  | Data. On first boot creates a restricted `hp_app` role via `deploy/postgres-init.sh`. | Not exposed |
| `higherpays-api`  | `node:22-alpine`      | Express API on `:3000`. Runs migrations as the DB owner, then serves as `hp_app`. | Not exposed |
| `higherpays`      | `nginx:alpine`        | Serves the built React app + proxies `/api/*` → backend. | `8083` |

All wired in `docker-compose.yml`. Secrets come from `.env` next to the
compose file (never committed — see `.env.example` for the shape).

**Common ops commands** (run from `~/higherpays` on the box):

```bash
docker compose ps                # what's up
docker compose logs -f api       # tail backend
docker compose logs -f frontend  # tail nginx
docker compose restart api       # restart backend after `git pull`
docker compose up -d --build     # rebuild + restart everything
docker compose down              # stop all (data survives)
```

**Deploy a change**:

```bash
# locally
git push origin main
# on EC2
cd ~/higherpays && git pull && docker compose up -d --build
```

**Login credentials seeded on first boot** (change these):

- URL: `http://54.173.144.0:8083/`
- Email: `owner@higherpays.local`
- Password: `change-me-please`

---

## 4. How Row-Level Security actually works here

This is the single most important thing to understand or you'll write
insecure code. The DB has two roles:

- **`postgres`** — owner, used only by the **migrations** step. Superuser,
  so it can do DDL and (accidentally) bypass RLS. **The app never uses this
  role.**
- **`hp_app`** — the runtime role. `NOSUPERUSER NOBYPASSRLS`. Subject to
  every RLS policy.

Every request must set two per-connection GUCs before touching data:

```sql
SET LOCAL app.workspace_id = '<workspace uuid>';
SET LOCAL app.user_id      = '<user uuid>';
```

`backend/src/db.js` and `backend/src/middleware/index.js` handle this
automatically per-request. **Never** run a raw pool query without going
through the middleware-provided client.

Boot check: `backend/src/server.js` refuses to start in production if the
runtime role can bypass RLS.

---

## 5. Frontend architecture

`frontend/src/`:

```
api/
  endpoints/         Typed API modules (one per backend domain)
  http.ts            fetch wrapper — injects JWT, active workspace id, refresh-on-401
  types.ts           shared response types (AuthUser, AuthWorkspace, etc.)
  workspacePath.ts   builds /workspaces/:id/... URLs from the session
business/            Pure money math (splitAmount, feeBreakdown, rateCard, revshareRules, timezone)
components/
  AppProviders.tsx   ErrorBoundary + QueryClientProvider
  AuthGuard.tsx      redirects to /login if not authenticated and not in demo
  Layout.tsx         sidebar + workspace picker + user block + logout
  ui/                shared kit (PageHeader, StatCard, DataTable, Money, Pill, DateCell, etc.)
demo/                Deterministic demo generators for offline demo mode
hooks/
  useCurrentSession  who am I + which workspace + demo or live?
  useTimezone        resolves user's IANA TZ from preferences
  useRateCard        active rate card (demo → workspace, live → API /fees)
  usePermission      RBAC — useCan()
lib/format/          money/date/text formatters
pages/               One folder per route: index.tsx + use<Page>Data.ts + filters.ts
rbac/                Permission → role tables
store/
  auth.ts            JWT + AuthUser + workspaces (persisted)
  session.ts         activeWorkspaceId (persisted)
  preferences.ts     tzMode + tzManual (persisted)
  demoMode.ts        transient "user opted into demo" flag
  appStore.ts        LEGACY monolithic demo store — being migrated away from
theme/               global.css + variables.css
```

### Two modes, one UI

Every page must work in two modes:

- **Demo mode** — no backend, all data comes from `appStore` (populated by
  `demo/generators.ts`). User opts in via "Try demo" on the login screen.
- **Live mode** — user logged in, data comes from React Query hitting the
  backend.

The pattern is: each page has a `use<Page>Data` hook that checks
`useCurrentSession().isDemo` and either reads from `appStore` or fires an
`api/endpoints/*` call. The page component itself is mode-agnostic.

**Examples of the pattern already in place**: `Payments`, `Links`,
`Payouts`. Copy those. Do NOT invent a new pattern.

---

## 6. What's wired to the backend vs. still demo-only

### Wired (works in live mode)
- **Auth**: login, refresh, logout, workspace listing (`Login` page + `Layout`).
- **Payments**: transactions list, refund modal (`Payments`).
- **Payment Links**: list, create, reconcile (`Links`).
- **Payouts**: breakdown, run payout, mark paid (`Payouts`).
- **Rate card** (fees %): via `useRateCard`.

### Scaffolded but not yet consumed by their pages
See §9 — these hooks already exist and just need their page to be
switched over to them:
- `frontend/src/pages/Creators/useCreatorsData.ts`
- `frontend/src/pages/Customers/useCustomersData.ts`
- `frontend/src/pages/Team/useTeamData.ts`

### Still demo-only (page reads `appStore` directly)
- `Analytics`, `Compare`, `Goals`, `Platform`, `Settings`, `Workspaces`
- `Team` (the "invite member" side)
- `Customers` add/edit
- Notifications (`NotificationBell`)
- Product tour (`ProductTour`) — kept for now but see §9 about whether we
  actually want a tour at all

---

## 7. Payment provider — MantaPay (NOT QRMoney)

**Important context**: this project started life integrating **QRMoney**.
It has since been migrated to **MantaPay**. **QRMoney is dead — do not
touch it, do not reintroduce it, and clean up its remains as you go.**

### Live MantaPay code lives here

```
backend/src/providers/mantapay.js           — high-level facade
backend/src/providers/mantapay-auth.js      — Search API login
backend/src/providers/mantapay-checkout.js  — hosted checkout link creation
backend/src/providers/mantapay-search.js    — per-transaction fee reconciliation
backend/src/providers/mantapay-signature.js — request/notify signature verification
backend/src/providers/mantapay-status.js    — status polling
```

Env vars are in `backend/.env.example` under the `MantaPay` sections.

### Known MantaPay open questions

See `backend/../OPEN-QUESTIONS-MANTAPAY.md` if it's still around (it may
have been dropped during the restructure — check `git log --all -- OPEN-QUESTIONS-MANTAPAY.md`).
The gist: refund flow is a two-step admin-approved request that isn't
implemented yet. Until it is, `MANTAPAY_REFUND_ENABLED=false` and the
app **records** refunds issued in MantaPay's dashboard rather than
calling their API.

### QRMoney references still lingering — cleanup task

These are all **comments, migration audit trails, or dead env-var
references** — not live code — but they're confusing and should be
scrubbed. Run this to find them:

```bash
rg -i qrmoney backend/
```

Currently returns matches in:

| File | Occurrences | What to do |
|------|-------------|-----------|
| `backend/src/config.js` | 5 | Rename the section header, drop the "Set once QRMoney supplies the spec" line, delete the `webhookPublicBase` QRMoney comment, delete the "QRMoney checkout links expire" comment on `linkTtlMinutes`. |
| `backend/src/routes/links.routes.js` | 4 | Rewrite the header comment ("Provider integration — MantaPay Hosted Checkout"), replace "QRMoney's hosted page" → "MantaPay's hosted page", replace "QRMoney uses the notifyUrl" → "MantaPay uses the notifyUrl", replace "ask QRMoney for the hosted checkout URL" → "ask MantaPay …". |
| `backend/src/routes/payouts.routes.js` | 2 | Rewrite the refund comment block to say MantaPay's refund flow instead of QRMoney's. Remove the `QRMONEY_REFUND_PATH` env-var reference (it's dead). |
| `backend/src/routes/webhooks.routes.js` | 2 | Rewrite the "QRMoney posts application/x-www-form-urlencoded" comment to describe MantaPay's notify webhook shape. |
| `backend/src/providers/mantapay-search.js` | 1 | Update the header comment — remove the QRMoney historical aside or rephrase it as a note about the previous provider. |
| `backend/src/util/seed.js` | 1 | Change `QRMONEY_API_KEY` → `MANTAPAY_HASH_KEY` in the friendly seed-complete message. |
| `backend/migrations/001_init.sql` | 1 | The comment `-- e.g. 'qrmoney'` → `-- e.g. 'mantapay'`. **Do NOT modify already-applied migration behaviour** — this is purely a comment. |
| `backend/migrations/010_actual_fee_reconciliation.sql` | 1 | Comment only — update or leave as historical audit trail. |
| `backend/migrations/026_fee_model_cascade.sql` | 1 | Comment only — update or leave as historical audit trail. |

**Ground rule for the migration files**: never *edit* an already-applied
migration to change what it *does*. Only fix comments. If a schema
change is needed, write a new migration file with the next sequential
number.

Also do a wider sweep:

```bash
rg -i 'qrmoney|QRMONEY_' .
```

---

## 8. Backend surface (what's callable)

Base URL from the browser: `/api/*` (proxied to backend by nginx).
Base URL from other services on the box: `http://backend:3000/*`.

Health: `GET /health` → `{ ok: true, env }`.

Routers registered in `backend/src/server.js` under `/workspaces/:workspaceId/...`:

- `/creators`, `/customers`, `/links`, `/commissions`
- `/{payouts,transactions,fees,me,settlements}` (all under workspaces)
- `/roles`, `/analytics`, `/targets`, `/memberships`, `/notifications`
- `/invites` (both workspace-scoped and public)
- `/permissions` (effective permissions for the current user)

Also:

- `/auth/*` — login/refresh/logout/register-2fa/verify-2fa
- `/platform/*` — super-admin only
- `/webhooks/*` — payment provider notifies (raw body)

The typed frontend clients for these live under
`frontend/src/api/endpoints/`. Add a new one when you touch a new domain
rather than raw-`fetch`ing.

---

## 9. What to do next — prioritised

### P0. Finish wiring the three business-critical pages (in progress)

The hooks are already written and TypeScript-clean. What's missing is
the page swap.

For each page, replace `useAppStore(s => s.<thing>)` reads with the
hook's return values, and route mutations through the hook:

1. **`frontend/src/pages/Creators/index.tsx`** — use `useCreatorsData`:
   - `const { creators, isLoading, create, updateStatus, updateSplit } = useCreatorsData();`
   - `toggleSuspend(cr)` → `updateStatus(cr.id, cr.status === 'active' ? 'suspended' : 'active')`.
   - `addCreator()` → `create({ name, handle, revModel, splitCreator, salary, salaryInc, status })`.
   - `saveSplits()` → `for each edited row: await updateSplit(id, pct)`, then clear edits.
   - Delete the `updateState` import if unused after the swap.

2. **`frontend/src/pages/Customers/index.tsx`** — use `useCustomersData`:
   - Swap `useAppStore(s => s.customers)` → `const { customers } = useCustomersData();`.
   - The add-customer modal has no backend endpoint yet — leave it demo-only for now, or hide it in live mode.

3. **`frontend/src/pages/Team/index.tsx`** — use `useTeamData`:
   - Swap `useAppStore(s => s.chatters)` → `const { chatters, setCommission } = useTeamData();`.
   - `saveCommission()` → `for each edited row: await setCommission(id, pct)`.
   - Leave `members` and invite/add-chatter modals demo-only for now (no
     backend endpoints).

After each swap: `cd frontend && npm run build && npm test`, then commit.

### P1. Clean up QRMoney remnants

See §7. Purely comment/doc changes, but leaving them makes the codebase
lie to future readers.

### P2. Wire the remaining pages

Rough order of business value:

1. **`Settings`** — currently reads `appStore.workspaces` and calls no API.
   Wire to `workspacesApi.getPlatformFee`, `getLinkLimits`, `setLinkLimits`,
   `rename`. Fee editing on the platform level goes through
   `platform.routes.js`.
2. **`Workspaces`** — for multi-workspace agencies. `workspacesApi.*` +
   `authApi.workspaces()`.
3. **`Analytics`** — the backend has `analytics.routes.js`. Build an
   `api/endpoints/analytics.ts` client + `useAnalyticsData` hook.
4. **`Goals`** — `targets.routes.js` on the backend.
5. **`Compare`** — pure UI on top of analytics data.
6. **`Platform`** — super-admin views over all workspaces (`platform.routes.js`).

### P3. UI polish (Wave 4 in earlier plans)

The user's goal was **"a UI that needs no tutorial."** Currently we ship
a `ProductTour` component from an earlier iteration. Decide with Eran:
either polish the UX to the point the tour is unnecessary and delete
`ProductTour`, or keep the tour but drastically simplify it. Do not do
both.

Specific ideas that came up:
- Better empty states (there's an `EmptyState` component in `ui/`, use it).
- The nav should hide items the current role can't access instead of
  showing them as read-only.
- The workspace picker should be replaced with a proper switcher (search,
  keyboard shortcut).
- Consolidate `Modal` vs. inline forms — pick one and stick to it.

### P4. Real MantaPay integration

Still open questions in the (possibly-dropped) `OPEN-QUESTIONS-MANTAPAY.md`.
Priority is:
1. Refund flow (currently records-only).
2. Search API credentials rotation (they expire every 90 days per
   provider policy).
3. Notify webhook shape confirmation.

Talk to Eran before touching real MantaPay credentials — the merchant
account is live.

---

## 10. Testing / verification workflow

**Frontend:**
```bash
cd frontend
npm run build      # tsc + Vite build; MUST pass before pushing
npm test           # Vitest — currently ~44 tests across business/ and pages/
npm run lint       # ESLint — some pre-existing warnings in un-migrated pages, that's OK
```

**Backend:**
```bash
cd backend
npm test           # node:test — MantaPay signature + payout engine
```

**End-to-end sanity** (on EC2):
```bash
curl -sS http://localhost:8083/api/health
# expect: {"ok":true,"env":"production"}
```

Login smoke test on EC2:
```bash
curl -sS -X POST http://localhost:8083/api/auth/login \
  -H 'Content-Type: application/json' \
  --data '{"email":"owner@higherpays.local","password":"change-me-please"}'
# expect: JSON with accessToken, refreshToken, user, workspaces
```

---

## 11. Ground rules (do not skip)

1. **Never commit `.env`, `.pem` keys, or anything under `.ssh/`**. They're
   gitignored — keep them that way.
2. **Never edit an already-applied migration.** Write a new one.
3. **Never bypass RLS.** No raw `pool.query()` outside the request-scoped
   client from the middleware.
4. **Money math is exact NUMERIC in the DB, JS `number` in the app.** If
   you find yourself doing floating-point currency math in a new place,
   pull the logic into `frontend/src/business/` and add a unit test.
5. **Line endings**: the repo forces LF on shell scripts, Dockerfiles, and
   compose files via `.gitattributes`. Don't override this — CRLF breaks
   the Alpine containers.
6. **Commit style**: conventional-ish — `feat(scope):`, `refactor(scope):`,
   `fix(scope):`, `chore:`, `infra:`. Small, reviewable, one concern each.
7. **When in doubt, follow the existing pattern.** `Payments`, `Links`,
   `Payouts` are the reference implementations for a page. Copy them,
   don't reinvent.

---

## 12. Where to look when something breaks

| Symptom                                          | First place to look                                     |
|--------------------------------------------------|---------------------------------------------------------|
| Frontend can't reach backend                     | Browser network tab → is it hitting `/api/*` at all? Check nginx logs: `docker compose logs -f frontend`. |
| API returns `server_error`                       | `docker compose logs -f api`. Also check the DB — is it healthy? |
| `docker compose up` fails on postgres init       | Delete the volume: `docker compose down -v` (destroys data, only OK in dev), then bring it back up. |
| Login returns 401                                | Password may have been rotated; check `backend/src/util/seed.js` for the current default. |
| RLS "policies not applied" warning at startup    | The `hp_app` role has `SUPERUSER` or `BYPASSRLS`. Check `deploy/postgres-init.sh` and reinit the DB. |
| Vite dev server won't hot-reload                 | Delete `frontend/node_modules/.vite` and restart. |
| tsc errors after pulling                         | `cd frontend && rm -rf node_modules && npm ci`. |

---

## 13. Contacts / accounts

- **GitHub**: `SirShabluli/higherpays` — main branch is the only branch;
  push directly (no PR workflow in place yet).
- **EC2**: `ubuntu@54.173.144.0`, key in `~/.ssh/` (ask Eran).
- **AWS account**: `584120132927`.
- **MantaPay**: merchant account is live — do not test against it without
  Eran's OK. Sandbox creds are in the (encrypted) `.env` on the box.

---

*Last updated as part of Wave 3 completion + EC2 dockerisation.
See `git log --oneline` for the exact commits behind each section.*
