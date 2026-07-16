# Château de verre — security, staging, backup, and rollback

This runbook is a release gate. Nothing here authorizes a deployment to `monfrench.com`.

## Implemented runtime controls

- Passwords are stored as salted PBKDF2-SHA-256 hashes (210,000 iterations) with a required server-side `PASSWORD_PEPPER`. Plaintext passwords and generated migration passwords are never persisted.
- Sessions use random opaque tokens, hashed session identifiers in D1, `HttpOnly`, `Secure` (HTTPS), `SameSite=Strict` cookies, expiration, revocation, and a separate double-submit CSRF token.
- Every protected mutation repeats role and ownership checks on the server. The interface is not an authorization boundary.
- Principal-only account, permission, publication-review, and migration actions are audited. Login and upload endpoints are rate-limited.
- HTML uploads are size-, extension-, and MIME-checked, written under generated immutable R2 keys, and published through an explicit review or direct-publication permission.
- Activity HTML is delivered by `/api/file` only after role/assignment checks, with a restrictive CSP, `nosniff`, no referrer, and an iframe sandbox that omits `allow-same-origin`. A separate cookie-free activity origin is recommended for production defense in depth but is not claimed by the current same-origin staging build.
- The bridge verifies `event.source`, requires the sandboxed opaque origin, allowlists message types, validates state payloads, and caps payload size. Student submissions snapshot immutable state and lock ordinary saves until a teacher chooses “À refaire”.

## Private staging gates

1. Create dedicated staging Worker/Sites deployment, D1 database, and R2 bucket. Do not bind production resources.
2. Set unique staging `TEACHER_SETUP_CODE` and `PASSWORD_PEPPER` secrets. Apply only `drizzle/0000_lovely_ravenous.sql` to a fresh staging D1 database.
3. Create non-production principal, teacher, and student fixtures. Verify principal-only permissions, teacher ownership, student assignment scoping, password reset, logout, CSRF rejection, rate limits, and upload validation.
4. Run lint, unit/domain/security tests, production build, the clean-D1 API integration scenario, and desktop/tablet/mobile visual checks in both Château de verre and Nuit parisienne.
5. Run the real legacy student export through staging dry-run. Resolve every collision and failed row, import once, repeat to prove idempotency, sample-check teacher/group relations, then roll back the rehearsal batch and verify its accounts are gone.
6. Confirm the only migrated records are student identities and optional teacher/group relationships. Compare counts and identifiers; verify no legacy activities, assignments, messages, progress, or files exist in the new database.

## Backup inventory before cutover

Create immutable, timestamped exports of:

- the legacy account database and a separate student-only migration export;
- legacy uploaded files/object inventory;
- the currently deployed Worker bundle and configuration;
- Cloudflare routes, DNS records, D1/R2 binding names, and secret-name inventory (never secret values);
- the accepted staging D1 database and R2 object manifest;
- migration dry-run/import reports and SHA-256 checksums for every artifact.

Store at least one copy outside the deployment account. Record the operator, timestamp, checksum, storage location, and tested restore command for each artifact.

## Cutover and rollback

Cutover requires explicit approval after all staging gates and backups are signed off. Freeze legacy writes, take final exports, run one final student-only dry-run, import the approved batch, deploy the accepted immutable build, then change the production route/DNS. Verify principal, teacher, and student login plus one upload/assignment/save/submit/review cycle before reopening access.

Rollback restores the previous Worker route and DNS record, verifies legacy login, and disables writes on the failed new environment. Export all new-system records created after cutover for reconciliation before rollback. Do not delete either environment or any backup during the acceptance window.

## External approval boundary

The branch may prepare and test these controls, but it must stop before using production credentials, DNS access, Cloudflare/GitHub secrets, the real legacy export, or an irreversible production action unless those inputs and approvals are explicitly supplied.
