# Château de verre — implementation roadmap

## Guardrails

- Work only on `chateau-de-verre-v1`.
- Treat `reference/approved-chateau-de-verre.html` as the visual and interaction master.
- Reuse hosting infrastructure only; replace legacy product code and data design.
- Migrate student identity records only. Never migrate legacy content or progress.
- Do not deploy to `monfrench.com` before staging acceptance, backups, migration validation, and rollback approval.

## Milestones

1. Preserve the approved reference and document architecture and cutover controls.
2. Replace the database with a normalized Château de verre schema and forward-only migration.
3. Implement secure authentication, authorization, preferences, and principal-managed accounts.
4. Implement library publication, upload review modes, assignments, the sandboxed activity viewer, autosave, submission locking, correction, and “À refaire”.
5. Add an idempotent student-only CSV/JSON migration tool with dry-run, collision reporting, batch rollback, and failed-row export.
6. Rebuild the five primary interfaces to match the approved reference across desktop, tablet, and mobile.
7. Add unit, integration, end-to-end, visual, accessibility, and security checks; run the complete verification suite.
8. Prepare private staging, migration rehearsal, backup inventory, rollback runbook, and acceptance checklist.
9. Stop for the required staging/production secrets, student export, DNS access, or irreversible cutover approval.

## Acceptance evidence

Record commands and results in `docs/IMPLEMENTATION_LOG.md`. Production remains explicitly incomplete until `monfrench.com` is verified after an approved cutover.
