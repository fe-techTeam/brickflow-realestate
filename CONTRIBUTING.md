# Contributing

## Branching model

| Branch | Purpose | Updated by |
| --- | --- | --- |
| `main` | Production. Only changes when a release goes live on the production domain. | Pull request **from `develop` only** |
| `develop` | Integration branch and default base for all work. | Pull requests from `feature/*`, `fix/*`, `chore/*` |
| `feature/<short-name>` | New functionality | Developers |
| `fix/<short-name>` | Bug fixes | Developers |
| `chore/<short-name>` | Tooling, dependencies, docs | Developers |

Rules (enforced by branch protection and the `branch-policy` workflow):

1. Never commit or push directly to `main` or `develop`.
2. Branch from the latest `develop`: `git switch develop && git pull && git switch -c feature/<name>`.
3. Open a pull request into `develop`. CI (lint, type-check, tests, dependency audit, build) must pass before merging.
4. Releases: open a pull request from `develop` into `main` only when promoting to production. Pull requests into `main` from any other branch fail the policy check.
5. Use squash merges into `develop`; use a merge commit for `develop` → `main` releases so history is preserved.

## Commit messages

Conventional commits: `feat(scope): …`, `fix(scope): …`, `chore: …`, `docs: …`, `test: …`, `refactor: …`.

## Before opening a pull request

```bash
npm run lint
npm run typecheck
npm test
npm audit --omit=dev --audit-level=high
npm run build
```

## Dependencies

- Pin exact versions (`.npmrc` sets `save-exact=true`) and commit `package-lock.json`.
- Vet new packages (maintenance, adoption, exact name, licence) and check advisories before adding them.
- CI fails on high or critical advisories in production dependencies. Fix by upgrading; suppress only when no fix exists and the issue is demonstrably not exploitable, with a written justification in the commit.

See [docs/CONVENTIONS.md](docs/CONVENTIONS.md) for code conventions.
