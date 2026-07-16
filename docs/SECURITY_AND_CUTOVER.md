# Security, staging, backup, and rollback controls

## Runtime controls

- Passwords use salted scrypt with an environment-held pepper; sessions use secure, HTTP-only, same-site cookies and CSRF tokens.
- Every protected mutation must re-check role and ownership on the server. UI visibility is never authorization.
- Uploads accept `.html` initially, enforce size and MIME limits, use generated R2 keys, and retain immutable versions.
- Activities are served from a cookie-free isolated origin when configured and embedded with `sandbox="allow-scripts allow-forms allow-downloads"` without `allow-same-origin`.
- The message bridge allowlists message names, checks `event.source`, validates payload shape, and caps payload size.
- Login and upload endpoints are rate-limited. Account, permission, publication, migration, and review actions produce audit events.
- Production requires HTTPS, restrictive CSP, `frame-ancestors`, `nosniff`, referrer policy, and no secrets in source control.

## Staging gates

1. Create a private staging Worker, D1 database, R2 bucket, and isolated activity host.
2. Apply migrations only to staging; seed non-production role fixtures.
3. Pass lint, type/build, unit, integration, E2E, visual, accessibility, and dependency checks.
4. Test principal, teacher, and student workflows on desktop, tablet, and phone.
5. Dry-run the real student export, import to staging, and verify a representative sample.

## Backup and rollback

Before cutover, record immutable exports of the old database, uploaded files, deployed Worker bundle, DNS records, and the new staging D1 database. Store checksums and restoration instructions outside the deployment account. Keep the legacy site private and deployable.

Rollback restores the previous Worker route and DNS record, verifies legacy login, then disables writes on the failed new environment. New-system records created after cutover are exported before rollback for reconciliation. No legacy system is deleted during the acceptance window.
