# MonFrench — Château de verre

Château de verre is the greenfield MonFrench replacement: a private French-learning portal for a principal teacher, delegated teachers, and students. The supplied reference at `reference/approved-chateau-de-verre.html` is the authoritative visual and interaction baseline; Nuit parisienne remains the alternative theme.

Only student identity accounts may be migrated from the legacy system. Legacy activities, assignments, messages, progress, files, wording, features, and database records are deliberately outside this architecture.

## Runtime

- Vinext/React application on Cloudflare Workers
- D1 normalized relational store; fresh migration in `drizzle/`
- R2 immutable HTML activity versions
- Server-side role and ownership checks, PBKDF2-SHA-256 password hashes with an environment pepper, secure sessions, CSRF validation, rate limits, and audit events
- Sandboxed HTML viewer without `allow-same-origin`

Node.js 22.13 or newer is required.

```bash
pnpm install
pnpm run dev
pnpm run lint
pnpm test
pnpm run build
```

Local D1/R2 development uses `wrangler.local.jsonc`. Copy `.dev.vars.example` to `.dev.vars` and replace both values before the first setup. Never commit `.dev.vars`.

The API integration scenario expects a fresh local database and a server at `http://localhost:3001`:

```bash
pnpm run test:integration
```

## Student-account migration

The migration tool accepts CSV or JSON and defaults to a local, non-mutating validation report:

```bash
pnpm run migration:students -- students.json --report=student-import-report.json
```

For a collision-aware staging dry run, set `MONFRENCH_STAGING_URL`, `MONFRENCH_SESSION_COOKIE`, and `MONFRENCH_CSRF_TOKEN`, then run the same command. Add `--apply` only after reviewing the dry-run report. Roll back an imported batch with `--rollback=<run_id>`. The tool refuses `monfrench.com` and `www.monfrench.com`.

## Release boundary

Production deployment is intentionally blocked until private staging passes the acceptance suite, the real student export is dry-run and rehearsed, backups/checksums exist, rollback is verified, and explicit approval is given for the irreversible cutover. See `docs/SECURITY_AND_CUTOVER.md` and `docs/IMPLEMENTATION_LOG.md`.
