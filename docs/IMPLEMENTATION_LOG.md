# Château de verre — implementation log

## 2026-07-16

- Created the isolated `chateau-de-verre-v1` branch.
- Confirmed the existing Cloudflare Worker, D1, and R2 bindings are viable infrastructure to retain.
- Began a greenfield replacement; legacy application behavior and schema are not migration inputs.
- Preserved the supplied approved HTML reference under `reference/`.
- Replaced the visible product surface with the five approved Château de verre interfaces.
- Added the Château de verre and Nuit parisienne themes, responsive layout, viewer tools, autosave feedback, submit locking copy, correction, and “À refaire” interactions.
- Added domain rules for password hashing, role permissions, publication modes, saved-work transitions, bridge payload validation, and student import validation.
- Added a student-only CSV/JSON dry-run importer with collision reporting and deterministic input fingerprints.
- Added the security, staging, backup, and rollback runbook.
- Verification: ESLint 0 errors; 6/6 unit tests passed; Vinext production build passed.
- Browser acceptance: login, student dashboard, viewer, teacher dashboard, and library inspected; no horizontal overflow at 390 px or 820 px.

## Environment state

- Production deployment: not attempted.
- Staging deployment: pending server workflow completion and Cloudflare/GitHub credentials.
- Student migration: pending export; importer will be implemented and tested with fixtures first.
- Backups and rollback: runbook pending; no production data has been touched.
