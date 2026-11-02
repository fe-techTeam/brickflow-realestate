# Delivery progress

Living checklist of the build. Each phase lands on `develop` through its own pull request.

| Phase | Branch | Scope | Status |
| --- | --- | --- | --- |
| 1 | `feature/foundation` | Next.js 16 + Prisma 7 setup, design system, auth/RBAC, full service layer, schema, seed, shell, login, docs | Done |
| 2a | `feature/partner-portal` | Channel partner workspace (overview, invoices, upload + extraction, offers, transactions, disbursements, documents, profile) | Pending |
| 2b | `feature/builder-portal` | Builder workspace (overview, partners, projects, approvals, approved, financed, settlements, reports) | Pending |
| 2c | `feature/finance-portal` | Veefin workspace (overview, builders, partners, programmes, requests, disbursements, transactions, reports) | Pending |
| 2d | `feature/admin-portal` | Super admin workspace (dashboard, organisations, users, builders, partners, financing configuration, transactions, audit, settings) | Pending |
| 3 | `chore/quality-and-delivery` | Automated tests (unit, service integration, e2e), CI, Docker, AWS deployment, README | Pending |
| 4 | — | Integrated end-to-end verification on `develop` | Pending |
