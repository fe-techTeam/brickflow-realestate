# Deployment

BrickFlow ships as a single Docker image (Next.js standalone server, Prisma migrations and the demo seed). It stores data in **PostgreSQL** and uploaded invoice PDFs on the **local file system** (`STORAGE_DIR`), so a deployment needs a PostgreSQL database and one running container with a persistent volume mounted at `STORAGE_DIR`.

This guide covers:

1. [Managed AWS topology (later)](#1-managed-aws-topology-later): the planned multi-instance production deployment.
2. [Single server with Docker Compose and PostgreSQL](#2-single-server-with-docker-compose-and-postgresql): app, PostgreSQL, automatic HTTPS and nightly backups on one host.
3. [The production path](#3-production-path-postgresql-and-s3) (managed PostgreSQL + S3) for multi-instance and multi-tenant use.
4. [A note on Vercel](#4-vercel).

No AWS resources exist yet. Every command below is for the AWS account owner to run.

---

## Configuration

### Environment variables

| Variable | Required | Example / default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | `postgresql://brickflow:<password>@postgres:5432/brickflow` | PostgreSQL connection URL. Percent-encode special characters in the password, or use a hex password (`openssl rand -hex 24`). Append `?sslmode=require` for a managed database reached over the network. |
| `DATABASE_POOL_MAX` | No | `10` | Maximum connections in the app's pool. Keep the sum across all app containers below the server's `max_connections` (100 by default). |
| `AUTH_SECRET` | Yes | — | Signs session tokens (HS256). At least 32 random characters: `openssl rand -base64 48`. Store in a secret manager, never in the repository. Rotating it signs everyone out. |
| `DEMO_PASSWORD` | Yes | `BrickFlow@2026` | Shared password the seed gives every demo account. Treat it as a secret on public deployments. |
| `DEMO_DATASET` | No | `standard` | Demo dataset to seed and offer on the sign-in page: `standard` or `chandak` (builder pitch). Takes effect on the next seed. |
| `STORAGE_DRIVER` | No | `local` | Only `local` is implemented today. |
| `STORAGE_DIR` | Yes | `/app/data/storage` | Uploaded and seeded invoice PDFs. Must be on a persistent volume. |
| `APP_URL` | Yes | `https://brickflow.example.com` | Public base URL. When it starts with `https://`, session cookies are marked `Secure`. |
| `SEED_ON_START` | No | `false` | `true` wipes and reseeds the demo data on every container start. The database is always seeded when it is empty. |
| `PORT` | No | `3000` | Port the server listens on. |
| `HOSTNAME` | No | `0.0.0.0` | Bind address of the standalone server; must be `0.0.0.0` in containers. |
| `NODE_ENV` | No | `production` | Set by the image. |
| `NEXT_TELEMETRY_DISABLED` | No | `1` | Disables Next.js telemetry. |

**Background worker and notifications.** Read by the `worker` service unless marked *app*. `APP_URL` and `AUTH_SECRET` are also required by the worker (email links and signed unsubscribe links).

| Variable | Required | Example / default | Notes |
| --- | --- | --- | --- |
| `EMAIL_PROVIDER` | Yes (production) | `smtp` | `smtp` sends email; `log` writes each email to the worker log and sends nothing (bodies are omitted from the log in production because they can carry one-time links). The worker refuses to start in production when it is unset. |
| `EMAIL_ALLOW_LOG_IN_PRODUCTION` | No | `false` | Must be `true` for `EMAIL_PROVIDER=log` with `NODE_ENV=production`. For demo environments only; the worker logs a warning at start. |
| `SMTP_HOST` | With `smtp` | `email-smtp.ap-south-1.amazonaws.com` | Any SMTP relay. |
| `SMTP_PORT` | No | `587` | `465` uses implicit TLS; other ports upgrade with STARTTLS. |
| `SMTP_SECURE` | No | `true` on 465, else `false` | Implicit TLS. |
| `SMTP_REQUIRE_TLS` | No | `true` | Without implicit TLS, refuse to send unless STARTTLS succeeds. Set `false` only for a local relay. Certificates are always verified; TLS 1.2 minimum. |
| `SMTP_USER`, `SMTP_PASSWORD` | With an authenticated relay | — | Both or neither. For Amazon SES these are the SMTP credentials generated in the SES console, not IAM access keys. |
| `SMTP_FROM` | With `smtp` | `BrickFlow <no-reply@brickflow.example.com>` | Must be a verified identity on SES. |
| `SMTP_RATE_LIMIT_PER_SECOND` | No | — | Caps sends per second (set to the SES account's sending rate). |
| `WHATSAPP_PROVIDER` | No (worker, *app*) | `none` | `none` records WhatsApp deliveries as skipped; `cloud` uses the Meta WhatsApp Cloud API. The app shows the WhatsApp column on the preferences page only with `cloud`. |
| `WHATSAPP_TOKEN` | With `cloud` | — | Permanent system-user access token with `whatsapp_business_messaging`. Secret. |
| `WHATSAPP_PHONE_NUMBER_ID` | With `cloud` | `106540352242922` | Numeric id of the sending number (WhatsApp Manager, API setup). |
| `WHATSAPP_APP_SECRET` | With `cloud` (worker, *app*) | — | Meta app secret; verifies `X-Hub-Signature-256` on status callbacks. Secret. Without it the webhook answers 503. |
| `WHATSAPP_VERIFY_TOKEN` | With `cloud` (*app*) | random string | Echoed back during the webhook subscription handshake; enter the same value in the Meta app dashboard. |
| `WHATSAPP_API_VERSION` | No | `v27.0` | Graph API version. |
| `WHATSAPP_TEMPLATE_LANGUAGE` | No | `en` | Language code of the approved templates. |
| `WORKER_CONCURRENCY` | No | `4` | Jobs run in parallel per worker process. |
| `WORKER_POLL_INTERVAL_MS` | No | `1000` | Idle wait between claim attempts. |
| `WORKER_LEASE_MS` | No | `60000` | Visibility timeout. Renewed every third of it while a job runs; an expired lease makes the job claimable by another worker. |
| `WORKER_SCHEDULER_INTERVAL_MS` | No | `30000` | How often recurring schedules are checked. |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | No | `25000` | Grace period on `SIGTERM` before unfinished jobs are handed back (keep below the container stop timeout, 40 s in Compose). |
| `WORKER_HANDLER_TIMEOUT_MS` | No | `300000` | A handler running longer is aborted and retried. |
| `WORKER_JOB_TYPES` | No | — | Comma-separated job types for a dedicated worker; all types when unset. |
| `WORKER_HEARTBEAT_FILE` | No | `/tmp/brickflow-worker.alive` in Compose | Touched on every loop; the Compose health check fails when it is older than 2 minutes. |
| `WORKER_DATABASE_POOL_MAX` | No | `5` | Compose only: `DATABASE_POOL_MAX` for the worker. |
| `JOB_MAX_ATTEMPTS` | No | `8` | Attempts before a job is dead-lettered. |
| `JOB_BACKOFF_BASE_MS` / `JOB_BACKOFF_MAX_MS` | No | `5000` / `3600000` | Exponential backoff with jitter between attempts: 2.5-5 s, 5-10 s, and so on, capped at one hour. |
| `JOB_RETENTION_DAYS` | No | `14` | Succeeded and cancelled jobs are purged after this; dead-lettered jobs are kept. |
| `SETTLEMENT_REMINDER_CRON` | No | `0 9 * * *` | When settlement reminders run, in IST (five-field cron). |

### Container behaviour

On start, `docker-entrypoint.sh`:

1. checks that `DATABASE_URL` is a `postgresql://` URL and `AUTH_SECRET` is set, then waits up to 60 seconds for the database to accept connections;
2. runs `prisma migrate deploy` (forward-only migrations) against `DATABASE_URL`;
3. runs the demo seed only when the database has no users yet (first start) or when `SEED_ON_START=true`, so data persists across restarts and upgrades by default;
4. starts the Next.js standalone server with `node server.js`.

The same image runs the background worker with `node --conditions=react-server --import tsx src/worker/main.ts`. The `worker` service in the Compose files overrides the entrypoint, so it never migrates or seeds, and it starts once the app is healthy. The worker validates its configuration and exits with a clear message when, for example, `EMAIL_PROVIDER` is missing in production. Several workers can run at once.

The container runs as a non-root user (uid/gid `1001`) and declares a `HEALTHCHECK` on `GET /api/health`, which returns `{"status":"ok","db":"ok"}` after a `SELECT 1`, or HTTP 503 when the database is unreachable. The endpoint needs no authentication and exposes no configuration.

### Email (Amazon SES SMTP)

1. Verify the sending domain in SES (DKIM records in DNS) and request production access so you can send to any address.
2. Create SMTP credentials (SES console, SMTP settings) and set `SMTP_HOST=email-smtp.<region>.amazonaws.com`, `SMTP_PORT=587`, `SMTP_USER`, `SMTP_PASSWORD` and `SMTP_FROM` (an address on the verified domain). Port 587 uses STARTTLS, which is required.
3. Set `SMTP_RATE_LIMIT_PER_SECOND` to the account's sending rate.

Any other relay works the same way. Each email carries a `Message-ID` derived from the delivery id, so a resend after a worker crash is recognisable, and notification emails carry `List-Unsubscribe` / `List-Unsubscribe-Post` headers. Permanent rejections (5xx) are not retried; temporary failures retry with backoff. Every attempt is in the delivery log with the provider message id and the last error.

### WhatsApp Cloud API

1. In Meta Business Manager, add a WhatsApp Business Account and phone number, create a system user with the `whatsapp_business_messaging` permission and generate a permanent token (`WHATSAPP_TOKEN`). Note the phone number id (`WHATSAPP_PHONE_NUMBER_ID`) and the app secret (`WHATSAPP_APP_SECRET`).
2. Configure the webhook in the Meta app: callback URL `https://<DOMAIN>/api/webhooks/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN`, and subscribe to the `messages` field. Status callbacks (sent, delivered, read, failed) update the delivery log.
3. Create and get approval for one **utility** template per event, in the language set by `WHATSAPP_TEMPLATE_LANGUAGE`. Names and body parameters, in order:

| Template | Body parameters |
| --- | --- |
| `brickflow_invoice_submitted`, `brickflow_invoice_under_review`, `brickflow_invoice_approved`, `brickflow_invoice_rejected`, `brickflow_invoice_clarification_requested`, `brickflow_invoice_resubmitted` | {{1}} invoice number, {{2}} channel partner, {{3}} builder, {{4}} amount (the approved amount when set) |
| `brickflow_offer_generated` | {{1}} invoice number, {{2}} net payable, {{3}} discount rate, {{4}} valid until |
| `brickflow_offer_expiring` | {{1}} invoice number, {{2}} net payable, {{3}} valid until |
| `brickflow_offer_accepted`, `brickflow_financing_approved`, `brickflow_financing_rejected` | {{1}} financing request reference, {{2}} invoice number, {{3}} net payable |
| `brickflow_disbursement_initiated` | {{1}} payout reference, {{2}} amount, {{3}} invoice number |
| `brickflow_disbursement_completed` | Partner: {{1}} payout reference, {{2}} amount, {{3}} UTR. Builder: {{1}} invoice number, {{2}} settlement amount, {{3}} due date |
| `brickflow_settlement_due_soon`, `brickflow_settlement_due_today`, `brickflow_settlement_overdue`, `brickflow_settlement_settled` | {{1}} invoice number, {{2}} amount, {{3}} due date |

Messages go only to users who entered a number on their *Notifications* page and ticked the consent box; clearing it switches WhatsApp off for every category. Throttling, temporary errors and expired tokens are retried; invalid numbers and template errors are not.

---

## 1. Managed AWS topology (later)

The demo runs on a single server ([section 2](#2-single-server-with-docker-compose-and-postgresql), live environment in [section 5](#5-demo-environment-single-lightsail-server)). A multi-instance production deployment on managed AWS services (containers behind a load balancer, managed PostgreSQL, S3 for documents) follows [section 3](#3-production-path-postgresql-and-s3). Its infrastructure-as-code and deployment pipeline will be added together with the production environment.

---

## 2. Single server with Docker Compose and PostgreSQL

The lowest-cost persistent setup: one Linux host runs the whole stack from `docker-compose.prod.yml`.

```
  Internet ──► :80 / :443 ──► caddy ──► app:3000 ──► postgres:5432
               (only published      (edge network)   (internal network, no published port)
                ports)                                     ▲   ▲
                                                 backup ───┘   └─── worker ──► SMTP relay, WhatsApp Cloud API
                                     nightly pg_dump ──► volume postgres-backups
```

| Service | Image | Role |
| --- | --- | --- |
| `caddy` | `caddy:2.11.7-alpine` | Reverse proxy. Obtains and renews a Let's Encrypt certificate for `DOMAIN` automatically, redirects HTTP to HTTPS, adds HSTS. Config: `infra/compose/Caddyfile`. |
| `app` | built from this repository | BrickFlow. Invoice PDFs on the named volume `app-storage`, mounted at `STORAGE_DIR` (`/app/data/storage`). |
| `postgres` | `postgres:17.11-alpine3.24` | Database on the named volume `postgres-data`. Not published on any host port; reachable only from `app` and `backup` on an internal network. |
| `worker` | same image as `app` | Background jobs: email and WhatsApp delivery, offer-expiry and settlement reminders, job-table maintenance. Starts after `app` is healthy (migrations applied). Its health check reads a heartbeat file. On `docker compose stop` it finishes running jobs (up to `WORKER_SHUTDOWN_TIMEOUT_MS`) and hands back the rest. Scale with `--scale worker=2`. |
| `backup` | `postgres:17.11-alpine3.24` | Runs `infra/compose/pg-backup.sh`: a `pg_dump` (custom format) every night into the volume `postgres-backups`, deleting dumps older than 14 days. |

All images are pinned to exact versions. Update the tags deliberately (and check the release notes) rather than pulling `latest`.

### Prerequisites

- A Linux host (for example an Ubuntu 24.04 EC2 or Lightsail instance) with **2 GB RAM** or more (the image is built on the host) and about 20 GB of disk.
- Docker Engine 24+ with the Compose plugin (`docker compose version`).
- A DNS `A` (and optionally `AAAA`) record for your domain pointing at the host's public IP. Caddy needs it to obtain the certificate.
- Firewall / security group: inbound **80/tcp and 443/tcp** only (443/udp optionally, for HTTP/3), plus SSH (22/tcp) restricted to your own IP. Do not open 3000 or 5432; neither is published by the stack.

### First deploy

1. Clone the repository on the host and check out the release to run:

   ```bash
   git clone https://github.com/fe-techTeam/brickflow-realestate.git brickflow && cd brickflow
   git checkout main
   ```

2. Create `.env` next to `docker-compose.prod.yml` (Compose reads it automatically; it is git-ignored, never commit it) and restrict it with `chmod 600 .env`:

   ```bash
   DOMAIN=brickflow.example.com
   POSTGRES_PASSWORD=<openssl rand -hex 24>
   AUTH_SECRET=<openssl rand -base64 48>
   DEMO_PASSWORD=<shared password for the demo accounts>
   DEMO_DATASET=standard          # or chandak
   # Email (required by the worker in production):
   EMAIL_PROVIDER=smtp
   SMTP_HOST=email-smtp.ap-south-1.amazonaws.com
   SMTP_USER=<SES SMTP user name>
   SMTP_PASSWORD=<SES SMTP password>
   SMTP_FROM="BrickFlow <no-reply@brickflow.example.com>"
   # ...or, for a demo without email delivery:
   # EMAIL_PROVIDER=log
   # EMAIL_ALLOW_LOG_IN_PRODUCTION=true
   # Optional:
   # WHATSAPP_PROVIDER=cloud      # plus the WHATSAPP_* variables, see "WhatsApp Cloud API"
   # BACKUP_HOUR_UTC=21           # 21:00 UTC = 02:30 IST (default)
   # BACKUP_RETENTION_DAYS=14
   # DATABASE_POOL_MAX=10
   # BRICKFLOW_VERSION=latest     # tag given to the locally built image
   ```

   Use a hex `POSTGRES_PASSWORD` so it can be embedded in the connection URL without escaping. PostgreSQL applies the password only when it initialises an **empty** `postgres-data` volume; changing it later needs `ALTER USER brickflow PASSWORD '...'` as well.

3. Validate the configuration, then build and start:

   ```bash
   docker compose -f docker-compose.prod.yml config --quiet
   docker compose -f docker-compose.prod.yml up -d --build
   ```

   On first start the app applies the migrations and seeds the selected demo dataset (the database is empty). The worker starts once the app is healthy. Follow progress with `docker compose -f docker-compose.prod.yml logs -f app worker caddy`.

4. Open `https://<DOMAIN>`. `https://<DOMAIN>/api/health` returns `{"status":"ok","db":"ok"}`.

To save typing, `export COMPOSE_FILE=docker-compose.prod.yml` in the shell; the commands below assume this and are written as plain `docker compose ...`.

### Updates

```bash
git fetch && git checkout <release tag or main> && git pull
docker compose exec backup sh /usr/local/bin/pg-backup.sh --now   # backup before a release with migrations
docker compose up -d --build
docker image prune -f
```

The new app container applies pending migrations on start; data and PDFs persist. Migrations are forward-only: to roll back across a migration, restore the backup taken before the update and run the previous release.

### Backups and restore

- **Schedule:** the `backup` service writes `brickflow-<UTC timestamp>.dump` into the `postgres-backups` volume every night at `BACKUP_HOUR_UTC` and keeps `BACKUP_RETENTION_DAYS` (14) days. Check with `docker compose logs backup` and `docker compose exec backup ls -lh /backups`.
- **On demand:** `docker compose exec backup sh /usr/local/bin/pg-backup.sh --now`.
- **Off the host:** the volume lives on the same disk as the database, so also copy dumps elsewhere (for example a daily `aws s3 sync` or `rclone` of the volume's directory from the host, or EBS/Lightsail snapshots of the disk). Copy the dumps with `docker compose cp backup:/backups ./backups`.
- **Invoice PDFs** live in the `app-storage` volume, not in the dump. Back them up together, e.g. `docker run --rm -v brickflow_app-storage:/data:ro -v "$PWD":/out alpine:3.22 tar czf /out/storage-$(date -u +%Y%m%d).tgz -C /data .`.

**Restore** a dump (replaces all current data):

```bash
docker compose stop app
docker compose exec backup pg_restore --clean --if-exists --no-owner --no-privileges \
  -d brickflow /backups/brickflow-<timestamp>.dump
docker compose start app
```

To restore a dump taken on another host, copy it in first with `docker compose cp ./brickflow-<timestamp>.dump backup:/backups/`. Restore the matching `app-storage` archive at the same time so the PDFs referenced by the database exist.

### Resetting the demo

`npm run demo:reset` (script `scripts/demo-reset.mjs`) deletes every stored invoice PDF and re-seeds the dataset selected by `DEMO_DATASET`. All data entered since the last seed is lost. Inside the running container it needs `--yes`:

```bash
docker compose exec app node scripts/demo-reset.mjs --yes
```

To switch datasets, change `DEMO_DATASET` in `.env`, run `docker compose up -d app` to recreate the container with the new value, then run the reset. Leave `SEED_ON_START=false` (the default) so restarts keep the data; `SEED_ON_START=true` reseeds on every start.

### Operations notes

- Logs are rotated by Docker (`json-file`, 5 × 10 MB per service). The worker logs one JSON line per job outcome: `docker compose logs worker --tail 100`.
- Queue health, failed and dead-lettered jobs and the delivery log are under *Super Admin → Jobs*. A growing "Ready to run" figure or an old "oldest waiting" age means no worker is running or it is overloaded.
- All services restart automatically (`unless-stopped`), including after a host reboot.
- `docker compose down` keeps the volumes; `docker compose down -v` **deletes the database, PDFs, backups and certificates**.

---

## 3. Production path: PostgreSQL and S3

The demo topology is deliberately single-instance. For production use, and for the multi-tenant future of the platform, move state out of the container:

| Concern | Change |
| --- | --- |
| Database | Done in the application: BrickFlow runs on PostgreSQL through `@prisma/adapter-pg`. For production, point `DATABASE_URL` at Amazon RDS for PostgreSQL 17 (or Aurora PostgreSQL) with `?sslmode=require`, Multi-AZ and automated backups. Text sorting follows the database collation: the Alpine image used locally and in CI sorts byte-wise (as SQLite did), while a glibc `en_US.UTF-8` database (RDS default) sorts names linguistically. To keep byte-wise order, create the database with `CREATE DATABASE brickflow TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'en_US.UTF-8';`. |
| File storage | Add an S3 implementation of the existing `StorageDriver` interface (`put` / `get` / `delete`) in `src/server/storage.ts`, selected with `STORAGE_DRIVER=s3` and a bucket name. Use a private, encrypted bucket with Block Public Access and access through the task role. Downloads keep going through the authorised `/api/documents/...` route. |
| Scaling | With no local state, the ECS service can run two or more tasks across AZs with rolling deployments (minimum healthy 100 %, maximum 200 %) and target-tracking auto scaling. EFS is no longer needed. |
| Migrations | Run `prisma migrate deploy` as a one-off task in the pipeline before updating the service, instead of on every container start. |
| Secrets | Database credentials from Secrets Manager (RDS-managed secret). |

This is the path toward multiple builders, financiers and channel-partner networks on one platform with proper tenancy, availability and backups (RDS automated backups and point-in-time recovery, S3 versioning).

---

## 4. Vercel

Vercel works only after the storage change: its serverless functions have an ephemeral, read-only file system, so local PDF storage cannot persist there. Use a hosted PostgreSQL database (Neon / Vercel Postgres, with the existing `@prisma/adapter-pg` and a small `DATABASE_POOL_MAX`, or the provider's pooled connection URL) and **Vercel Blob** as the storage driver. Set `AUTH_SECRET`, `DEMO_PASSWORD`, `APP_URL` and the database and Blob variables in the project settings, and run migrations and the seed from the build pipeline or a one-off job.

---

## 5. Demo environment (single Lightsail server)

The demo environment runs the [single-server stack](#2-single-server-with-docker-compose-and-postgresql) on one Lightsail instance. Data and invoice PDFs persist across restarts and deployments.

| Item | Value |
| --- | --- |
| AWS account / region | `617103915273` / `ap-south-1` (Mumbai) |
| Instance | Lightsail `brickflow-app`: Ubuntu 24.04, 2 vCPU, 2 GB RAM (+2 GB swap), 60 GB SSD. Plan `small_3_1`. |
| Public IP | Static IP `brickflow-app-ip` = `35.154.239.217` |
| Domain | `https://brickflow.firsteconomy.com`: Cloudflare `A` record to the static IP, proxy off (DNS only). The certificate is issued and renewed by Caddy (Let's Encrypt). |
| Firewall | 80/tcp and 443/tcp+udp open to all; 22/tcp only from the office VPN egress IP |
| SSH | `ssh -i ~/.ssh/brickflow-app.pem ubuntu@35.154.239.217` (Lightsail key pair `brickflow-app-key`) |
| Stack | `~/brickflow` on the instance: `docker-compose.prod.yml`, `infra/compose/*` and a `chmod 600` `.env` |
| Secrets | `.env` on the instance; a recovery copy is in Secrets Manager `brickflow/demo/env` (same account) |
| Dataset | `DEMO_DATASET=chandak`, `SEED_ON_START=false` (seeded once on first start) |
| Email | `EMAIL_PROVIDER=log` with `EMAIL_ALLOW_LOG_IN_PRODUCTION=true`: emails are recorded in the delivery log and the worker log, not sent. Add both to `.env` before deploying a release with the worker, or the worker refuses to start (the app is unaffected). |
| Backups | Nightly `pg_dump` to the `postgres-backups` volume (14 days), plus Lightsail automatic instance snapshots daily at 22:00 UTC |
| Cost | About $12/month for the instance, plus snapshot storage |

All resources are tagged `Project=brickflow`. All BrickFlow resources were removed from the earlier account (870551426015).

### Redeploy a new version

The instance has 2 GB of RAM, so the image is built on a workstation and copied over; the instance needs no repository access.

```bash
SHA=$(git rev-parse --short HEAD)
docker build --platform linux/amd64 --provenance=false --sbom=false -t brickflow:$SHA .
docker save brickflow:$SHA | gzip -1 | ssh -i ~/.ssh/brickflow-app.pem ubuntu@35.154.239.217 'gunzip | docker load'
scp -i ~/.ssh/brickflow-app.pem docker-compose.prod.yml ubuntu@35.154.239.217:~/brickflow/
scp -i ~/.ssh/brickflow-app.pem infra/compose/* ubuntu@35.154.239.217:~/brickflow/infra/compose/
ssh -i ~/.ssh/brickflow-app.pem ubuntu@35.154.239.217 \
  "cd ~/brickflow && sed -i 's/^BRICKFLOW_VERSION=.*/BRICKFLOW_VERSION=$SHA/' .env && docker compose -f docker-compose.prod.yml up -d --no-build"
```

Migrations run on start. To roll back, set `BRICKFLOW_VERSION` back to the previous tag (older images stay on the instance until pruned) and run `up -d --no-build` again. A rollback across a migration also needs the matching database backup.

### Change the domain

Point an `A` record for the new host name at `35.154.239.217`, with the proxy off (DNS only) so Caddy can complete the certificate challenge. Then set `DOMAIN=<host name>` in `~/brickflow/.env` and run `docker compose -f docker-compose.prod.yml up -d --no-build`. Caddy obtains the certificate within a minute, and `APP_URL` follows `DOMAIN`.

### Operations

```bash
cd ~/brickflow
docker compose -f docker-compose.prod.yml ps                                   # status
docker compose -f docker-compose.prod.yml logs app --tail 100                  # app logs
docker compose -f docker-compose.prod.yml logs worker --tail 100               # worker logs (jobs; emails in log mode)
docker compose -f docker-compose.prod.yml exec backup /bin/sh /usr/local/bin/pg-backup.sh --now   # backup now
docker compose -f docker-compose.prod.yml exec app node scripts/demo-reset.mjs --yes             # reset demo data
```

`demo-reset` deletes every stored invoice PDF and all data entered since the last seed. Run it only to restore the pitch dataset.

---

## Security checklist

- HTTPS only: the load balancer redirects HTTP to HTTPS and uses a TLS 1.2/1.3 policy; `APP_URL` starts with `https://` so cookies are `Secure`.
- Secrets live in Secrets Manager (or a host `.env` that is never committed); `.env*` files are git-ignored and excluded from the Docker build context.
- Least privilege: the execution role can read only the two application secrets; the task role can only mount the EFS access point; the deploy role can only push to one repository, register task definitions, update one service and pass the two task roles.
- Network: the task accepts traffic only from the load balancer security group; EFS accepts NFS only from the task security group; the EFS policy denies unencrypted transport.
- Single server: only Caddy publishes ports (80/443); PostgreSQL sits on an internal Docker network with no published port and a generated password.
- The container runs as a non-root user; ECS Exec is disabled.
- Images are scanned on push; CI fails on high or critical advisories in production dependencies.
- Disbursements are simulated: no bank integration or payment credentials exist in any environment.
- Notifications: TLS is required to the SMTP relay (certificates verified); `SMTP_PASSWORD`, `WHATSAPP_TOKEN` and `WHATSAPP_APP_SECRET` are secrets. The WhatsApp webhook rejects any callback whose `X-Hub-Signature-256` does not match. Unsubscribe links are HMAC-signed per user and category, and a `GET` never changes anything. One-time links in account emails are redacted from the delivery log after sending.
