# Château de verre — implementation log

## 2026-07-16

- Created and stayed on `chateau-de-verre-v1`; production was not touched.
- Preserved the supplied reference byte-for-byte at `reference/approved-chateau-de-verre.html` and used it as the visual/interaction authority.
- Replaced the legacy product with the five Château de verre interfaces: authentication, principal/teacher dashboard, student dashboard, library/publication flow, and sandboxed activity viewer.
- Preserved Nuit parisienne as the alternative theme and verified responsive layouts at desktop, tablet, and 390 px phone widths without horizontal overflow.
- Replaced the legacy database design with a fresh 25-table normalized D1 schema and a single forward migration.
- Implemented principal, teacher, and student authorization; delegated permissions; secure sessions/CSRF; fail-closed peppered password hashing; rate limits; audit events; password changes and resets; and one-character student passwords.
- Implemented reviewed/direct HTML publication, immutable R2 versions, assignments to students/groups, autosave/resume, immutable submission snapshots, correction feedback, and “À refaire” resubmission.
- Implemented student-only CSV/JSON migration dry-run, collision reporting, idempotent import, optional teacher/group restoration, batch rollback, failed-row reports, and a staging-only CLI that rejects the production hostname.
- Removed all legacy product routes, private apps, mockups, wording, branding assets, starter database examples, and the obsolete second authentication helper.
- Added domain, product-contract, HTML-isolation, API integration, and visual acceptance coverage. Captures are stored under `tests/visual-current/`.

## Verification evidence

Final closing verification passed:

- `pnpm run lint`: 0 errors.
- `pnpm test`: 29/29 tests passed.
- `pnpm run build`: production-mode Vinext build passed; only `/`, `/api/file`, and `/api/portal` remain.
- Fresh local D1: the single migration applied successfully (82 commands including Wrangler bookkeeping).
- `pnpm run test:integration`: complete setup, accounts, permissions, reviewed and direct publication, assignment, autosave, submit lock, correction, redo/resubmit, preferences, and migration dry-run/import/idempotency/rollback workflow passed.
- Browser acceptance: desktop, tablet, and 390 px mobile passed in Château de verre and Nuit parisienne without horizontal overflow. Seven reference captures are stored in `tests/visual-current/`.

## Release state

- Production deployment: prohibited and not attempted.
- Private staging: implementation is ready; creating or updating the remote environment requires the configured hosting/GitHub/Cloudflare access described in the release boundary.
- Real student migration: blocked on the old student-account export. No legacy data has been read or changed.
- Production backup, DNS, and rollback rehearsal: documented but blocked on production access and explicit approval.
