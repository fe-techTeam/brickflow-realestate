# Deployment

BrickFlow ships as a single Docker image (Next.js standalone server, Prisma migrations and the demo seed). In its current form it stores data in **SQLite** and uploaded invoice PDFs on the **local file system**, so a deployment needs exactly one running container with a persistent volume mounted at `/app/data`.

This guide covers:

1. [Recommended demo topology on AWS](#1-recommended-demo-topology-aws-ecs-fargate) (ECS Fargate + ALB + EFS), with an infrastructure template and a GitHub Actions workflow.
2. [A simpler alternative](#2-simpler-alternative-single-ec2-or-lightsail-instance) on a single EC2 or Lightsail instance with Docker Compose.
3. [The production path](#3-production-path-postgresql-and-s3) (PostgreSQL + S3) for multi-instance and multi-tenant use.
4. [A note on Vercel](#4-vercel).

No AWS resources exist yet. Every command below is for the AWS account owner to run.

---

## Configuration

### Environment variables

| Variable | Required | Example / default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | `file:/app/data/brickflow.db` | SQLite file on the persistent volume. |
| `AUTH_SECRET` | Yes | — | Signs session tokens (HS256). At least 32 random characters: `openssl rand -base64 48`. Store in a secret manager, never in the repository. Rotating it signs everyone out. |
| `DEMO_PASSWORD` | Yes | `BrickFlow@2026` | Shared password the seed gives every demo account. Treat it as a secret on public deployments. |
| `STORAGE_DRIVER` | No | `local` | Only `local` is implemented today. |
| `STORAGE_DIR` | Yes | `/app/data/storage` | Uploaded and seeded invoice PDFs. Must be on the persistent volume. |
| `APP_URL` | Yes | `https://brickflow.example.com` | Public base URL. When it starts with `https://`, session cookies are marked `Secure`. |
| `SEED_ON_START` | No | `false` | `true` wipes and reseeds the demo data on every container start. The database is always seeded when it is empty. |
| `PORT` | No | `3000` | Port the server listens on. |
| `HOSTNAME` | No | `0.0.0.0` | Bind address of the standalone server; must be `0.0.0.0` in containers. |
| `NODE_ENV` | No | `production` | Set by the image. |
| `NEXT_TELEMETRY_DISABLED` | No | `1` | Disables Next.js telemetry. |

### Container behaviour

On start, `docker-entrypoint.sh`:

1. runs `prisma migrate deploy` (forward-only migrations) against `DATABASE_URL`;
2. runs the demo seed when `SEED_ON_START=true` or when the database has no users yet (first start);
3. starts the Next.js standalone server with `node server.js`.

The container runs as a non-root user (uid/gid `1001`) and declares a `HEALTHCHECK` on `GET /api/health`, which returns `{"status":"ok","db":"ok"}` after a `SELECT 1`, or HTTP 503 when the database is unreachable. The endpoint needs no authentication and exposes no configuration.

---

## 1. Recommended demo topology (AWS ECS Fargate)

```
                     Internet
                        |
              Route 53 (optional alias)
                        |
        +---------------v----------------+
        | Application Load Balancer      |  ACM certificate, TLS 1.2/1.3
        | :443 HTTPS   :80 -> 301 HTTPS  |  public subnets
        +---------------+----------------+
                        | :3000 (ALB security group only)
        +---------------v----------------+       +-------------------+
        | ECS service (Fargate)          |<------| ECR repository    |
        | desired count 1, container     |       | image:<commit sha>|
        | "brickflow", /api/health       |       +-------------------+
        |                                |<------  Secrets Manager:
        |   /app/data  (EFS access point)|         AUTH_SECRET, DEMO_PASSWORD
        +---------------+----------------+
                        | NFS :2049, TLS, IAM auth      CloudWatch Logs
        +---------------v----------------+       /ecs/<stack name>
        | EFS (encrypted, daily backups) |
        | brickflow.db + storage/        |
        +--------------------------------+
```

| Component | Choice |
| --- | --- |
| Compute | ECS on Fargate, one task (0.5 vCPU / 1 GB by default), x86_64. |
| Traffic | Internet-facing Application Load Balancer; HTTPS listener with an ACM certificate (`ELBSecurityPolicy-TLS13-1-2-2021-06`); HTTP redirects to HTTPS. Target group health check `GET /api/health`. |
| Image | Amazon ECR, scan on push, keeps the 20 most recent images. |
| Data | Amazon EFS (encrypted at rest and in transit, IAM authorisation) mounted at `/app/data` through an access point owned by uid/gid 1001. Holds the SQLite database and the uploaded PDFs. |
| Secrets | `AUTH_SECRET` and `DEMO_PASSWORD` in AWS Secrets Manager, injected by ECS at task start. |
| Logs | CloudWatch Logs group `/ecs/<stack name>`, 30-day retention by default. Container Insights on the cluster. |
| Deployments | Desired count **1**, minimum healthy 0 %, maximum 100 %, deployment circuit breaker with automatic rollback. |

**Why exactly one task.** SQLite supports a single writer and EFS file locking is not designed for several containers writing one database file. The service therefore never runs two tasks at once: a deployment stops the old task before the new one starts, which means roughly a minute of downtime per release. That is acceptable for a demo. Scaling out requires the [production path](#3-production-path-postgresql-and-s3).

### Files

| File | Purpose |
| --- | --- |
| `infra/aws/brickflow-ecs.yml` | CloudFormation template: ECR, ECS cluster/service/task definition, ALB + listeners + target group, EFS + mount targets + access point, security groups, IAM roles, log group, optional Route 53 record. |
| `.github/workflows/deploy-aws.yml` | Builds the image, pushes it to ECR and deploys a new task definition revision on every push to `main` (or on demand). |

### Template parameters

| Parameter | Description |
| --- | --- |
| `VpcId` | Target VPC. |
| `PublicSubnetIds` | Two or more public subnets (different AZs) for the load balancer. |
| `PrivateSubnetIds` | **Exactly two** subnets (different AZs) for the task and the two EFS mount targets. Private subnets need a NAT gateway or VPC endpoints for ECR (api + dkr), S3, CloudWatch Logs and Secrets Manager. For a cheaper demo, pass public subnets and set `AssignPublicIp=ENABLED`. |
| `AssignPublicIp` | `DISABLED` (default) or `ENABLED` (public task subnets without NAT). The task security group still only accepts traffic from the load balancer. |
| `DomainName` | Host name, e.g. `brickflow.example.com`. Also sets `APP_URL=https://<DomainName>`. |
| `CertificateArn` | Issued ACM certificate for `DomainName`, in the same Region. |
| `HostedZoneId` | Optional. When set, an alias `A` record for `DomainName` is created. |
| `RepositoryName` | ECR repository name (default `brickflow`). |
| `ImageTag` | Tag used by the stack's own task definition (default `latest`). |
| `DesiredCount` | `0` for the first deployment before an image exists, then `1`. |
| `Cpu` / `Memory` | Fargate size (default `512` / `1024`). |
| `SeedOnStart` | `"false"` (default) or `"true"` to reseed on every start. |
| `AuthSecretArn` / `DemoPasswordSecretArn` | Secrets Manager secret ARNs (plain-text secrets). |
| `LogRetentionDays` | CloudWatch Logs retention (default 30). |

The ECR repository and the EFS file system have `DeletionPolicy: Retain`, so deleting the stack never deletes images or data.

### First deployment

The examples use `ap-south-1` (Mumbai), the stack name `brickflow-demo` and the domain `brickflow.example.com`; substitute your own values.

1. **Create the secrets.**

   ```bash
   export AWS_REGION=ap-south-1
   aws secretsmanager create-secret --name brickflow/demo/auth-secret \
     --secret-string "$(openssl rand -base64 48)"
   aws secretsmanager create-secret --name brickflow/demo/demo-password \
     --secret-string 'BrickFlow@2026'
   ```

   Note the two `ARN` values in the output.

2. **Request the certificate** and complete DNS validation (add the CNAME record ACM shows, then wait until the status is `ISSUED`).

   ```bash
   aws acm request-certificate --domain-name brickflow.example.com --validation-method DNS
   aws acm describe-certificate --certificate-arn <certificate-arn> --query Certificate.Status
   ```

3. **Create the stack with no running task** (there is no image to run yet).

   ```bash
   aws cloudformation deploy \
     --stack-name brickflow-demo \
     --template-file infra/aws/brickflow-ecs.yml \
     --capabilities CAPABILITY_IAM \
     --parameter-overrides \
       VpcId=vpc-0123456789abcdef0 \
       PublicSubnetIds=subnet-aaaa,subnet-bbbb \
       PrivateSubnetIds=subnet-cccc,subnet-dddd \
       DomainName=brickflow.example.com \
       CertificateArn=<certificate-arn> \
       AuthSecretArn=<auth-secret-arn> \
       DemoPasswordSecretArn=<demo-password-secret-arn> \
       DesiredCount=0

   aws cloudformation describe-stacks --stack-name brickflow-demo --query 'Stacks[0].Outputs'
   ```

4. **Push the first image** to the `RepositoryUri` output.

   ```bash
   REPO_URI=<RepositoryUri output>
   aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO_URI%%/*}"
   docker build --platform linux/amd64 -t "$REPO_URI:latest" .
   docker push "$REPO_URI:latest"
   ```

5. **Start the service.** Unspecified parameters keep their previous values.

   ```bash
   aws cloudformation deploy --stack-name brickflow-demo \
     --template-file infra/aws/brickflow-ecs.yml --capabilities CAPABILITY_IAM \
     --parameter-overrides DesiredCount=1
   ```

   The first start finds an empty database, runs the migrations and seeds the demo data.

6. **DNS.** Without `HostedZoneId`, create a `CNAME` (or alias) record from `brickflow.example.com` to the `LoadBalancerDnsName` output.

7. **Verify.**

   ```bash
   curl -s https://brickflow.example.com/api/health    # {"status":"ok","db":"ok"}
   ```

   Then sign in at `https://brickflow.example.com/login` with a demo account from the README.

From now on, deploy through GitHub Actions. If you later update the stack itself, either pass `ImageTag=<deployed commit sha>` or leave it at `latest`; the workflow moves `latest` to every image it deploys, so both run the current release.

### Continuous deployment from GitHub (OIDC)

`.github/workflows/deploy-aws.yml` runs on every push to `main` and on manual dispatch. It assumes an IAM role through GitHub's OIDC provider (no long-lived AWS keys), builds the image, pushes it as `<commit sha>` and `latest`, downloads the service's current task definition, swaps the image and deploys the new revision, waiting for the service to become stable.

**If the variables below are not configured, the workflow skips every step, reports which variables are missing in the run summary, and succeeds.** Nothing is built or pushed.

1. **Create the OIDC identity provider** (once per account): IAM console → *Identity providers* → *Add provider* → OpenID Connect, provider URL `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`. Or:

   ```bash
   aws iam create-open-id-connect-provider \
     --url https://token.actions.githubusercontent.com \
     --client-id-list sts.amazonaws.com
   ```

2. **Create the deploy role** with this trust policy. The deploy job runs in the GitHub environment `demo`, so GitHub issues tokens whose subject is `repo:<owner>/<repo>:environment:demo`. Restrict the environment to the `main` branch in GitHub (*Settings → Environments → demo → Deployment branches and tags → Selected branches: `main`*), so only `main` can obtain credentials.

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": { "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com" },
         "Action": "sts:AssumeRoleWithWebIdentity",
         "Condition": {
           "StringEquals": {
             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
             "token.actions.githubusercontent.com:sub": "repo:fe-techTeam/brickflow-realestate:environment:demo"
           }
         }
       }
     ]
   }
   ```

   Permissions policy (replace the placeholders with the stack outputs):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "EcrLogin",
         "Effect": "Allow",
         "Action": "ecr:GetAuthorizationToken",
         "Resource": "*"
       },
       {
         "Sid": "EcrPush",
         "Effect": "Allow",
         "Action": [
           "ecr:BatchCheckLayerAvailability",
           "ecr:BatchGetImage",
           "ecr:GetDownloadUrlForLayer",
           "ecr:InitiateLayerUpload",
           "ecr:UploadLayerPart",
           "ecr:CompleteLayerUpload",
           "ecr:PutImage"
         ],
         "Resource": "arn:aws:ecr:<region>:<account-id>:repository/brickflow"
       },
       {
         "Sid": "EcsTaskDefinitions",
         "Effect": "Allow",
         "Action": ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"],
         "Resource": "*"
       },
       {
         "Sid": "EcsService",
         "Effect": "Allow",
         "Action": ["ecs:DescribeServices", "ecs:UpdateService"],
         "Resource": "arn:aws:ecs:<region>:<account-id>:service/brickflow-demo/brickflow-demo"
       },
       {
         "Sid": "PassTaskRoles",
         "Effect": "Allow",
         "Action": "iam:PassRole",
         "Resource": ["<TaskExecutionRoleArn output>", "<TaskRoleArn output>"],
         "Condition": { "StringEquals": { "iam:PassedToService": "ecs-tasks.amazonaws.com" } }
       }
     ]
   }
   ```

   `ecs:DescribeTaskDefinition` and `ecs:RegisterTaskDefinition` do not support resource-level permissions, hence `*`.

3. **Set the GitHub variables** (*Settings → Secrets and variables → Actions → Variables*, at repository level or on the `demo` environment). None of them is secret.

   | Variable | Value |
   | --- | --- |
   | `AWS_REGION` | e.g. `ap-south-1` |
   | `AWS_ROLE_ARN` | ARN of the deploy role |
   | `ECR_REPOSITORY` | Repository **name** (`RepositoryName` output, e.g. `brickflow`); the registry host comes from the ECR login step |
   | `ECS_CLUSTER` | `ClusterName` output |
   | `ECS_SERVICE` | `ServiceName` output |
   | `CONTAINER_NAME` | `brickflow` |

4. Run the workflow once from *Actions → Deploy to AWS → Run workflow* (branch `main`) to confirm the setup.

### Rollback

- **Automatic:** the deployment circuit breaker rolls back to the last healthy task definition when the new task fails its health checks.
- **Manual, previous revision:**

  ```bash
  aws ecs list-task-definitions --family-prefix brickflow-demo --sort DESC --max-items 5
  aws ecs update-service --cluster brickflow-demo --service brickflow-demo \
    --task-definition brickflow-demo:<previous revision>
  ```

- **Manual, by commit:** re-run the *Deploy to AWS* run of an earlier commit from the Actions tab, or revert the change on `main` through a pull request.
- **Database:** migrations are forward-only and run on container start. If a release applied a migration, older code may not work against the newer schema; restore the EFS backup taken before the release (see below). Take an on-demand backup before deploying a release that contains a migration.

### Backups

- The template enables the EFS **backup policy**, so AWS Backup takes daily automatic backups of the file system (database and PDFs) into the default EFS backup vault with 35-day retention. Adjust the plan in AWS Backup if you need different retention, cross-Region copies or on-demand backups.
- A backup taken while the app is writing is crash-consistent. For a guaranteed clean copy, set the desired count to 0, start an on-demand backup, then scale back to 1.
- **Restore:** in AWS Backup, restore the recovery point to the same file system (it lands in an `aws-backup-restore_<timestamp>` directory) or to a new one. Scale the service to 0, copy `brickflow.db` and `storage/` back into the access point's `/brickflow` directory (from a temporary instance or task that mounts the file system), then scale to 1.

### Resetting the demo data

Update the stack with `SeedOnStart=true`; the new task wipes and reseeds the data on start. Then update it again with `SeedOnStart=false` so later restarts keep the data. Each update rolls the single task, with about a minute of downtime.

```bash
aws cloudformation deploy --stack-name brickflow-demo --template-file infra/aws/brickflow-ecs.yml \
  --capabilities CAPABILITY_IAM --parameter-overrides SeedOnStart=true
aws cloudformation deploy --stack-name brickflow-demo --template-file infra/aws/brickflow-ecs.yml \
  --capabilities CAPABILITY_IAM --parameter-overrides SeedOnStart=false
```

### Cost notes

Rough monthly estimates for `ap-south-1` at demo traffic, in USD. Prices change; confirm with the [AWS Pricing Calculator](https://calculator.aws/).

| Item | Estimate |
| --- | --- |
| Fargate, 0.5 vCPU / 1 GB, always on | $15–20 |
| Application Load Balancer | $18–25 |
| EFS (a few MB) and its backups | < $1 |
| ECR storage (20 images) | < $1–2 |
| Secrets Manager (2 secrets) | $0.80 |
| CloudWatch Logs and Container Insights | a few dollars |
| NAT gateway (only with private task subnets) | $35+ plus data processing |
| Public IPv4 addresses (ALB, and the task when `AssignPublicIp=ENABLED`) | about $3.60 each |

For a short-lived demo, running the task in public subnets with `AssignPublicIp=ENABLED` avoids the NAT gateway, which would otherwise be the largest line item. Setting the desired count to 0 outside demo hours stops the Fargate charge; the load balancer still bills.

---

## 2. Simpler alternative: single EC2 or Lightsail instance

For the lowest cost and effort, run the same image with Docker Compose on one small instance (2 GB RAM recommended for building the image on the host).

1. Launch an Ubuntu instance; allow inbound 22 (your IP only), 80 and 443.
2. Install Docker Engine and the Compose plugin.
3. Clone the repository and create `.env` next to `docker-compose.yml`:

   ```bash
   AUTH_SECRET=<openssl rand -base64 48>
   DEMO_PASSWORD=BrickFlow@2026
   APP_URL=https://brickflow.example.com
   ```

4. `docker compose up -d --build`. Data lives in the named volume `brickflow-data`.
5. Terminate TLS with a reverse proxy on the host, for example Caddy (automatic Let's Encrypt certificates):

   ```
   brickflow.example.com {
       reverse_proxy 127.0.0.1:3000
   }
   ```

   Do not open port 3000 to the internet.
6. Back up with scheduled EBS snapshots (EC2, via Amazon Data Lifecycle Manager) or Lightsail automatic snapshots.
7. Upgrade with `git pull && docker compose up -d --build`.

---

## 3. Production path: PostgreSQL and S3

The demo topology is deliberately single-instance. For production use, and for the multi-tenant future of the platform, move state out of the container:

| Concern | Change |
| --- | --- |
| Database | Amazon RDS for PostgreSQL (or Aurora PostgreSQL). In `prisma/schema.prisma` set `provider = "postgresql"`; replace `@prisma/adapter-better-sqlite3` with `@prisma/adapter-pg` in `src/server/db.ts` and `prisma/seed.ts`; update `serverExternalPackages` in `next.config.ts`; create a fresh baseline migration for PostgreSQL (SQLite migrations do not carry over). Money is already `BigInt` paise, which maps to `bigint`. |
| File storage | Add an S3 implementation of the existing `StorageDriver` interface (`put` / `get` / `delete`) in `src/server/storage.ts`, selected with `STORAGE_DRIVER=s3` and a bucket name. Use a private, encrypted bucket with Block Public Access and access through the task role. Downloads keep going through the authorised `/api/documents/...` route. |
| Scaling | With no local state, the ECS service can run two or more tasks across AZs with rolling deployments (minimum healthy 100 %, maximum 200 %) and target-tracking auto scaling. EFS is no longer needed. |
| Migrations | Run `prisma migrate deploy` as a one-off task in the pipeline before updating the service, instead of on every container start. |
| Secrets | Database credentials from Secrets Manager (RDS-managed secret). |

This is the path toward multiple builders, financiers and channel-partner networks on one platform with proper tenancy, availability and backups (RDS automated backups and point-in-time recovery, S3 versioning).

---

## 4. Vercel

Vercel works only after the production-path changes: its serverless functions have an ephemeral, read-only file system, so SQLite and local PDF storage cannot persist there. Use a hosted PostgreSQL database (Neon / Vercel Postgres) with the `@prisma/adapter-pg` (or the Neon serverless adapter) and **Vercel Blob** as the storage driver. Set `AUTH_SECRET`, `DEMO_PASSWORD`, `APP_URL` and the database and Blob variables in the project settings, and run migrations and the seed from the build pipeline or a one-off job.

---

## Security checklist

- HTTPS only: the load balancer redirects HTTP to HTTPS and uses a TLS 1.2/1.3 policy; `APP_URL` starts with `https://` so cookies are `Secure`.
- Secrets live in Secrets Manager (or a host `.env` that is never committed); `.env*` files are git-ignored and excluded from the Docker build context.
- Least privilege: the execution role can read only the two application secrets; the task role can only mount the EFS access point; the deploy role can only push to one repository, register task definitions, update one service and pass the two task roles.
- Network: the task accepts traffic only from the load balancer security group; EFS accepts NFS only from the task security group; the EFS policy denies unencrypted transport.
- The container runs as a non-root user; ECS Exec is disabled.
- Images are scanned on push; CI fails on high or critical advisories in production dependencies.
- Disbursements are simulated: no bank integration or payment credentials exist in any environment.
