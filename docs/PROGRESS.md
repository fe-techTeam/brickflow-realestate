# Delivery progress

Living checklist of the build. Each change lands on `develop` through its own pull request; `main` receives releases from `develop` only.

| Phase | Pull requests | Scope | Status |
| --- | --- | --- | --- |
| 1 | #1, #2 | Next.js + Prisma foundation, design system, auth/RBAC, service layer, schema, seed; financier organisation-scope fix | Done |
| 2 | #3, #4, #5, #6 | Super Admin, Builder, Veefin Finance and Channel Partner workspaces | Done |
| 3 | #7, #10 | Automated tests (unit, service integration, e2e), CI, Docker, deployment guide; per-checkout test storage | Done |
| 4 | #8, #9, #11, #12, #13 | Visual redesign of the shell, sign-in and all four workspaces | Done |
| 5 | #14 | Selectable demo datasets (`standard`, `chandak`) | Done |
| 6 | #15, #16, #17 | Palette and dark glass theme; production interface copy; unused files removed | Done |
| 7 | #18, #19 | PostgreSQL; single-server Docker Compose stack (Caddy HTTPS, nightly backups, demo reset); demo environment documented | Done |
| 8 | — | Demo environment live at https://brickflow.firsteconomy.com (see `docs/DEPLOYMENT.md`, section 5) | Done |

## Next

Planned work is tracked in the product roadmap. The first candidates are:

- settlement status evaluated in the Asia/Kolkata calendar instead of UTC;
- early-payment pricing on the amount the builder actually remits (net of TDS) and as an annual rate × days;
- production hardening: CSP, login rate limiting, password reset and MFA, uptime alerts.
