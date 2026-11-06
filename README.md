# BrickFlow

**Real Estate Receivables, Made Liquid.**

BrickFlow is a demonstration platform for **channel-partner invoice discounting** in Indian real estate. Channel partners (brokers) raise brokerage invoices on the builders they sell for. Once a builder approves an invoice, the channel partner can take early payment from the builder's financing partner (Veefin) at a discount rate pre-agreed between the builder and the financier. The builder then pays the full approved amount to the financier on the invoice's original due date, so the partner's credit terms with the builder do not change.

Every organisation is fictional and every payment is **simulated**. No bank integration exists.

---

## Contents

- [Workspaces](#workspaces)
- [End-to-end business flow](#end-to-end-business-flow)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Local setup](#local-setup)
- [Demo credentials](#demo-credentials)
- [Seeded demo data](#seeded-demo-data)
- [Guided demo script](#guided-demo-script)
- [Financial calculation](#financial-calculation)
- [Status model](#status-model)
- [Security](#security)
- [Testing](#testing)
- [Docker](#docker)
- [Deployment](#deployment)
- [Contributing and branching model](#contributing-and-branching-model)

---

## Workspaces

Each user belongs to one organisation, and the organisation type decides the workspace. Signing in takes you to your workspace; other workspaces are not reachable.

| Workspace | Path | Organisation type | What it covers |
| --- | --- | --- | --- |
| Channel Partner | `/partner` | Channel partner (broker) | Overview, invoices, invoice upload with PDF field extraction, financing offers, transactions, disbursements, documents, verification (KYC and payout account), organisation profile |
| Builder | `/builder` | Real estate developer | Overview, empanelled channel partners, projects, invoice approvals, approved invoices, financed invoices, settlements, reports, verification |
| Veefin Finance | `/finance` | Financier | Overview, builders, channel partners, financing programmes, financing requests, disbursements, transactions, reports, verification |
| Super Admin | `/admin` | Platform operator | Dashboard, organisations, users, builders, channel partners, KYC review, financing configuration (programmes and rates), transactions, audit logs, settings |

## End-to-end business flow

1. **Invoice upload.** A channel partner uploads a brokerage invoice PDF for a project of a builder it is empanelled with. The invoice gets a reference such as `BF-INV-2026-000010` and the status *Submitted* (pending approval).
2. **Builder review.** The builder's accounts team starts a review (*Under review*). It can request clarification, which sends the invoice back to the partner, or reject it with a mandatory reason.
3. **Approval.** The builder approves the invoice for the full amount or a lower (partial) amount. The approved amount is the basis for financing.
4. **Partner sees the decision.** The invoice shows *Accepted*, together with the approved amount and the review history.
5. **Early payment request.** On an accepted invoice that is not yet due, the partner chooses **Get discounted amount**. The server generates an offer at the rate of the builder's active financing programme, valid for the programme's offer validity (7 days by default).
6. **Consent.** The partner accepts the offer and explicitly confirms the consent statement.
7. **Financing request.** A financing request is created with status *Pending Veefin approval*. It stores a snapshot of the approved amount, rate, discount and net payable, so later rate changes never alter it.
8. **Financier decision.** Veefin finance operations approves the request (or rejects it with a reason, which is final for that invoice).
9. **Simulated disbursement.** Veefin initiates the payout (payment reference `BFPAY-DEMO-…`) and then confirms the simulated transfer (a demo UTR is generated). The financing status becomes *Disbursed*.
10. **Settlement.** A settlement for the full approved amount is opened against the builder, due on the invoice's original due date (or invoice date + the empanelment credit period when the invoice has no due date). It shows as *Not due*, *Due* or *Overdue* until Veefin marks it *Settled* with the payment reference.

Every state change is recorded in the audit log.

## Tech stack

| Area | Technology |
| --- | --- |
| Framework | Next.js 16 (App Router, server components, server actions), React 19 |
| Language | TypeScript 5.9 (strict) |
| Styling | Tailwind CSS 4, Radix UI primitives, lucide-react icons, Recharts |
| Data | PostgreSQL 17, Prisma 7 with the `@prisma/adapter-pg` driver adapter (`pg` connection pool) |
| Auth | jose (HS256 JWT in an httpOnly cookie), bcryptjs |
| Validation | zod |
| Documents | pdf-lib (invoice PDF generation), tesseract.js and pdfjs-dist (in-browser text extraction, see [A14](docs/ASSUMPTIONS.md)) |
| Testing | Vitest (unit and service integration), Playwright (end-to-end, Chromium) |
| Delivery | Docker (Next.js standalone output), Docker Compose (Caddy, PostgreSQL, backups), GitHub Actions CI |

## Architecture

```
src/
  app/
    (workspaces)/            partner, builder, finance and admin workspaces (layouts enforce the role)
    api/
      documents/             authorised invoice PDF downloads
      health/                liveness and database check for load balancers and Docker
    login/                   sign-in page
  components/
    ui/                      design-system primitives
    common/                  BrickFlow building blocks (page header, data table, status badge, dialogs)
    shell/                   application shell, navigation, user menu
    brand/                   logo
  server/
    services/                business rules, state transitions and authorisation (invoices, financing, admin, auth)
    actions/                 thin server actions: actor -> service -> revalidate -> result
    auth/                    sessions, password hashing, token signing
    db.ts                    Prisma client
    storage.ts               pluggable document storage (local driver)
    audit.ts                 audit log writer
    sequence.ts              human-readable references (BF-INV, BF-OFR, BF-FIN, BFPAY-DEMO, BF-PRG)
  lib/                       money, discount calculation, formatting, statuses, PDF rendering, demo catalogue
  proxy.ts                   optimistic sign-in gate for workspace routes
prisma/                      schema, migrations, seed
test/                        Vitest setup and service integration tests
e2e/                         Playwright smoke tests
infra/compose/               Caddy configuration and backup script for the Compose stack
docs/                        conventions, assumptions, deployment, progress
```

Layering rules are in [docs/CONVENTIONS.md](docs/CONVENTIONS.md): all money is `BigInt` paise, rates are integer basis points, every service takes the authenticated actor and scopes reads to its organisation, and pages only read through services.

## Local setup

Requirements: **Node.js 24**, npm and **Docker** (for PostgreSQL; any PostgreSQL 17 server works if you prefer a native install).

```bash
cp .env.example .env
docker compose up -d postgres   # PostgreSQL 17 on localhost:5432, data in the volume postgres-data
npm ci
```

`npm ci` runs `prisma generate`, which reads `DATABASE_URL` from `.env`, so create `.env` first. If port 5432 is already taken, start the database with `POSTGRES_PORT=5433 docker compose up -d postgres` and change the port in `DATABASE_URL` (and set `TEST_DATABASE_URL` / `E2E_DATABASE_URL` for the tests).

Generate a session secret and put it in `AUTH_SECRET` in `.env`:

```bash
openssl rand -base64 48
# or
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Apply the migrations, seed the demo data and start the app:

```bash
npm run setup      # prisma migrate deploy + seed
npm run dev
```

Open <http://localhost:3000>. `npm run demo:reset` deletes the stored invoice PDFs and reseeds the selected `DEMO_DATASET` at any time. `npm run db:reset` drops and recreates the schema from the migrations (follow it with `npm run db:seed`). `docker compose down -v` deletes the local database volume.

| Variable | Default in `.env.example` | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://brickflow:brickflow@localhost:5432/brickflow` | PostgreSQL connection URL |
| `DATABASE_POOL_MAX` | `10` (commented out) | Maximum connections in the app's pool |
| `TEST_DATABASE_URL` / `E2E_DATABASE_URL` | `…/brickflow_test` / `…/brickflow_e2e` on the same server (commented out) | Databases the Vitest and Playwright runs drop and recreate |
| `AUTH_SECRET` | placeholder | Session signing secret, at least 32 characters |
| `MFA_ENFORCED` | unset (commented out) | Mandatory two-step verification for builder, finance and admin users; defaults to `true` in production, `false` in development and tests |
| `CSP_REPORT_ONLY` | unset (commented out) | `true` sends the Content Security Policy as Report-Only |
| `TRUSTED_PROXY_HOPS` | unset (commented out) | Reverse proxies in front of the app (default `1`); used to read the client IP |
| `STORAGE_DRIVER` | `local` | Document storage driver |
| `STORAGE_DIR` | `./storage` | Where invoice PDFs are stored |
| `DEMO_PASSWORD` | `BrickFlow@2026` | Shared password for the seeded accounts |
| `DEMO_DATASET` | `standard` | Which demo dataset to seed and offer on the sign-in page (see below) |
| `APP_URL` | `http://localhost:3000` | Public base URL; `https://` enables secure cookies |
| `DATA_ENCRYPTION_KEY` | empty (development key) | Encrypts bank account numbers, PAN and authenticator secrets; required in production |
| `VERIFICATION_PROVIDER` | `sandbox` | KYC verification provider; see [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) for live providers and the other verification and KYC variables |

## Demo datasets

`DEMO_DATASET` selects the data the seed creates and the accounts the sign-in page offers. Reseed after changing it.

| Dataset | Contents | Use |
| --- | --- | --- |
| `standard` (default) | 7 organisations, 8 users, 9 invoices covering every workflow stage | Local development, automated tests (always seeded with this dataset), full walkthroughs |
| `chandak` | BrickFlow Platform, Veefin Finance Demo, **Chandak Group** (builder; projects Chandak Treesourus and 34 Park Estate) and **Westline Realty Partners** (channel partner); 2 invoices: `WRP/2026/014` ₹5,00,000 accepted and ready for early payment at 3%, `WRP/2026/015` ₹3,00,000 awaiting approval | Builder pitch demo with simple figures |

The `chandak` dataset uses relative dates, so the accepted invoice is always still eligible after a reseed. Its Documents page offers two new sample invoices (`WRP/2026/016`, `WRP/2026/017`) to upload live. Chandak dataset logins: `partner@westline-demo.test`, `accounts@chandak-demo.test`, `finance@brickflow.demo`, `admin@brickflow.demo`.

## Demo credentials

The table below lists the `standard` dataset. All accounts share the password **`BrickFlow@2026`** (the value of `DEMO_PASSWORD` when the database was seeded). The sign-in page also offers one-click buttons for the four main accounts.

| Email | Name | Organisation | Workspace |
| --- | --- | --- | --- |
| `admin@brickflow.demo` | Arjun Shah | BrickFlow Platform | Super Admin |
| `finance@brickflow.demo` | Kavita Iyer | Veefin Finance Demo | Veefin Finance |
| `accounts@godrej-demo.test` | Rohan Mehta | Godrej Properties Demo | Builder |
| `partner@prestige-demo.test` | Ananya Rao | Prestige Realty Partners | Channel Partner |
| `credit.analyst@brickflow.demo` | Nikhil Bansal | Veefin Finance Demo | Veefin Finance |
| `accounts@skyline-demo.test` | Meera Krishnan | Skyline Habitat Developers | Builder |
| `accounts@coastal-demo.test` | Vikram Naik | Coastal Crest Builders | Builder |
| `partner@urbannest-demo.test` | Siddharth Kulkarni | UrbanNest Property Advisors | Channel Partner |

## Seeded demo data

`prisma/seed.ts` recreates a consistent dataset every time it runs (it wipes the demo tables and stored PDFs first).

**Organisations (7):** BrickFlow Platform (platform), Veefin Finance Demo (financier), Godrej Properties Demo, Skyline Habitat Developers and Coastal Crest Builders (builders), Prestige Realty Partners and UrbanNest Property Advisors (channel partners).

**Projects (4):** Greenfield Heights (`GFH`, Pune) and Godrej Horizon (`GHZ`, Mumbai) for Godrej; Royal Gardens (`RGD`, Bengaluru) for Skyline; Seabreeze Villas (`SBV`, Goa) for Coastal Crest.

**Empanelments (5):** Prestige with Godrej (60-day credit period) and Skyline (45 days); UrbanNest with Godrej (60), Skyline (45) and Coastal Crest (30).

**Financing programmes (3, all active, financier Veefin):**

| Code | Builder | Discount rate |
| --- | --- | --- |
| `BF-PRG-0001` | Godrej Properties Demo | 3% |
| `BF-PRG-0002` | Skyline Habitat Developers | 2.5% |
| `BF-PRG-0003` | Coastal Crest Builders | 3.5% |

**Invoices (9),** each with a generated GST brokerage invoice PDF, approval history and audit entries:

| Invoice | Channel partner | Builder / project | Amount | Invoice status | Financing |
| --- | --- | --- | --- | --- | --- |
| `GFH/2026/001` | Prestige | Godrej / Greenfield Heights | ₹5,00,000 | Submitted (pending approval) | Not requested |
| `GFH/2026/002` | Prestige | Godrej / Greenfield Heights | ₹3,50,000 | Accepted | Not requested (eligible) |
| `GFH/2026/003` | Prestige | Godrej / Greenfield Heights | ₹2,75,000 | Rejected | — |
| `GHZ/2026/014` | Prestige | Godrej / Godrej Horizon | ₹8,40,000 | Accepted | Disbursed (₹25,200 discount, ₹8,14,800 net); settlement due 30 Nov 2026 |
| `RGD/2026/007` | Prestige | Skyline / Royal Gardens | ₹4,20,000, **approved ₹4,00,000** | Accepted (partial) | Pending Veefin approval (2.5%: ₹10,000 discount, ₹3,90,000 net) |
| `UNA/GFH/2026/031` | UrbanNest | Godrej / Greenfield Heights | ₹6,15,000 | Under review | Not requested |
| `UNA/GHZ/2026/009` | UrbanNest | Godrej / Godrej Horizon | ₹2,95,000 | Accepted | Approved, awaiting disbursement (₹8,850 discount, ₹2,86,150 net) |
| `UNA/RGD/2026/004` | UrbanNest | Skyline / Royal Gardens | ₹3,80,000 | Accepted | Disbursed; settlement **settled** |
| `UNA/SBV/2026/002` | UrbanNest | Coastal Crest / Seabreeze Villas | ₹1,85,000 | Clarification requested | Not requested |

Amounts are GST-inclusive invoice totals. Invoice and due dates are fixed calendar dates in 2026, while submission and decision timestamps are relative to the time of seeding. Early payment is only offered while the due date is in the future, so reseed or use newly uploaded invoices once the seeded due dates have passed.

## Guided demo script

The fastest complete walk-through uses `GFH/2026/001` (₹5,00,000, pending approval at Godrej, 3% programme). Use a private window per account, or sign out between steps.

1. **Channel partner** (`partner@prestige-demo.test`): open *My Invoices* and find `GFH/2026/001` (pending approval). Optionally upload a new invoice from *Upload Invoice*: choose the builder and project, attach the PDF, check the extracted fields and submit.
2. **Builder** (`accounts@godrej-demo.test`): open *Invoice Approvals*, open `GFH/2026/001`, start the review and approve the full amount (or enter a lower amount to show a partial approval). Requesting clarification or rejecting requires a reason of at least 10 characters.
3. **Channel partner:** the invoice now shows *Accepted*. Choose **Get discounted amount**: the offer shows ₹5,00,000 approved, 3% discount = ₹15,000, net payable ₹4,85,000. Accept it and confirm the consent statement. The request appears under *My Transactions* as pending Veefin approval.
4. **Veefin Finance** (`finance@brickflow.demo`): open *Financing Requests*, review the request and approve it. In *Disbursements*, initiate the simulated payout, then confirm the simulated transfer. The payment reference and UTR appear and the status becomes *Disbursed*.
5. **Builder:** *Financed Invoices* and *Settlements* show the obligation of ₹5,00,000 to Veefin, due on the invoice's original due date (19 Dec 2026).
6. **Veefin Finance:** mark the settlement as settled with a payment reference.
7. **Super Admin** (`admin@brickflow.demo`): in *Financing Configuration*, change the Godrej programme rate (for example 3% to 3.25%). Requests already accepted keep their original figures; open offers on that programme are withdrawn and the next offer uses the new rate. *Audit Logs* shows every step of the walk-through.

Seeded shortcuts: `RGD/2026/007` is waiting for Veefin approval, `UNA/GHZ/2026/009` is approved and waiting for disbursement, `GFH/2026/002` is ready for **Get discounted amount**, and `UNA/SBV/2026/002` (UrbanNest) is waiting for the partner's clarification response.

## Financial calculation

The formula lives only in `src/lib/financing.ts` and the server recomputes every figure; client-supplied amounts are never trusted.

```
discount   = approved amount × rate          (rate in basis points: 300 = 3%, divided by 10,000)
net payable = approved amount − discount     (charges are 0 in all programmes)
```

- All amounts are integer **paise** (`BigInt`); no floating point is used for money.
- The discount is rounded **half-up to the nearest paisa**.
- Rates are integers in basis points between 0.01% and 30%.
- Example: ₹5,00,000 at 3% gives a discount of ₹15,000 and a net payable of ₹4,85,000. At 2.5% the discount is ₹12,500; at 3.5% it is ₹17,500.
- The builder settles the **full approved amount** with the financier, due on the invoice due date, or on invoice date + the empanelment credit period when no due date was given.

## Status model

Invoice, financing and settlement statuses are **separate fields**; none is inferred from another.

| Field | Values |
| --- | --- |
| Invoice status | `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `CLARIFICATION_REQUESTED`, `REJECTED`, `ACCEPTED` |
| Financing status (invoice and request) | `NOT_REQUESTED` → `OFFER_GENERATED` → `PENDING_APPROVAL` → `APPROVED` → `DISBURSEMENT_INITIATED` → `DISBURSED`, or `REJECTED` by the financier. `ACCEPTED_BY_CP` is recorded in the request timeline at acceptance. |
| Offer status | `OFFERED`, `ACCEPTED`, `EXPIRED` (validity passed), `SUPERSEDED` (replaced, or withdrawn after a programme change) |
| Settlement status | `NOT_DUE`, `DUE`, `OVERDUE` (derived from the due date), `SETTLED` (set by Veefin) |
| Disbursement status | `INITIATED`, `SUCCESS` (simulated) |

When a programme's rate or terms change, open offers priced on it are superseded and the partner regenerates to see current terms. Accepted requests keep their stored snapshot and are never repriced. Decisions that the brief left open are listed in [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md).

## Security

- Passwords hashed with bcrypt (cost 12); unknown accounts are compared against a dummy hash so timing does not reveal which emails exist. New passwords need at least 12 characters, are checked against a built-in list of common passwords and the user's name and email, and cannot repeat the current one.
- Sign-in is throttled in PostgreSQL per account (progressive 1/2/4-second delays, then a 15-minute lockout after 5 failures) and per client IP (30 failures). Unknown and real accounts get identical responses. Lockouts are audited.
- Server-side sessions: the httpOnly, `SameSite=Lax` cookie carries a signed session id; every request re-validates the `Session` row, the user, the organisation and the role. Sessions end after 30 minutes idle or 8 hours, and are revoked on sign-out, "Sign out of all devices", password change (other sessions) and administrator deactivation. The session id is rotated (keeping the original expiry) after a password or two-step verification change.
- Two-step verification with an authenticator app (TOTP, RFC 6238, ±1 step drift, replay-protected), 10 single-use recovery codes stored as hashes, secrets encrypted with AES-256-GCM (`DATA_ENCRYPTION_KEY`). Mandatory for builder, finance and admin users when `MFA_ENFORCED` is on (default in production); optional for channel partners. Each user manages it, their sessions and their password on the **Security** page in the account menu.
- Step-up confirmation (`requireStepUp(actor, purpose)` in `src/server/auth/step-up.ts`): sensitive actions require a fresh authenticator code (or the password, for accounts without two-step verification) within the last 5 minutes.
- Authorisation is enforced in the service layer by a central permission map (`can(actor, permission)`, deny by default) together with organisation type and ownership. Reads are scoped to the actor's organisation, and records of other organisations return "not found" rather than "forbidden".
- State changes use conditional updates on the expected current status, which prevents double approval, double acceptance and duplicate disbursement. One financing request per invoice is also enforced by unique constraints.
- An audit entry is written in the same transaction as every state change.
- Uploads must be real PDFs (magic-byte check), at most 10 MB; duplicate invoice numbers and duplicate PDFs (SHA-256) are refused. Storage keys are server-generated and path traversal is blocked. Documents are only served through an authorised route with `no-store` caching.
- Security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) and a nonce-based Content Security Policy per request (`src/proxy.ts`, `src/server/security/csp.ts`), switchable to Report-Only with `CSP_REPORT_ONLY`; the `X-Powered-By` header is disabled.
- CI fails on high or critical advisories in production dependencies; dependency versions are pinned and the lockfile is committed.

## Testing

```bash
npm test             # unit tests and service integration tests (Vitest)
npm run test:watch   # watch mode
npm run test:e2e     # Playwright smoke tests (Chromium)
```

- **Unit tests** cover money parsing and formatting, the discount calculation, amounts in words, the GST split and PDF generation.
- **Service integration tests** (`test/integration`) run the real services against an isolated PostgreSQL database (`brickflow_test`) that is dropped, recreated, migrated and seeded with the real seed before the run. They cover sign-in for every role, the full invoice-to-settlement flow, rate changes, cross-organisation access, duplicate prevention, case-insensitive search and list ordering.
- **End-to-end smoke tests** (`e2e/`) build and start the app on port 3300 against a fresh database (`brickflow_e2e`) and check sign-in and sign-out for the four main accounts. Install the browser once with `npx playwright install chromium`.

Both suites need the PostgreSQL server from `docker compose up -d postgres` (or `TEST_DATABASE_URL` / `E2E_DATABASE_URL` pointing elsewhere). `scripts/prepare-db.mjs` only recreates databases whose name ends in `_test` or `_e2e`, so it never touches the development database.

## Docker

```bash
docker compose up --build
```

Then open <http://localhost:3000>. This starts PostgreSQL and the app container; the app waits for the database to be healthy. Compose needs `AUTH_SECRET` from your shell or `.env`. The database lives in the named volume `postgres-data` and the PDFs in `app-storage`. On start the container applies migrations, seeds only when the database is empty (or every time with `SEED_ON_START=true`), so data persists across restarts, and serves the app as a non-root user. `GET /api/health` returns `{"status":"ok","db":"ok"}` and backs the container health check. Reset the demo inside the container with `docker compose exec app node scripts/demo-reset.mjs --yes`. `docker compose down -v` removes the volumes.

For a single production server (PostgreSQL, Caddy with automatic HTTPS, nightly backups), use `docker-compose.prod.yml`; see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#2-single-server-with-docker-compose-and-postgresql).

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): a single server with Docker Compose, PostgreSQL and automatic HTTPS, ECS Fargate behind an HTTPS load balancer (CloudFormation template in `infra/aws/` and a GitHub Actions workflow using OIDC; still to be moved to PostgreSQL), and the managed PostgreSQL + S3 production path.

## Contributing and branching model

- `feature/*`, `fix/*` and `chore/*` branches are opened from `develop` and merged into `develop` through pull requests.
- `develop` is promoted to `main` (production) through a pull request from `develop` only.
- No direct pushes to `main` or `develop`; CI (lint, type-check, tests, dependency audit, build) must pass.

Further reading: [CONTRIBUTING.md](CONTRIBUTING.md), [docs/CONVENTIONS.md](docs/CONVENTIONS.md), [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md).
