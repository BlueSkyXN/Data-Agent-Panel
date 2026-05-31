# database navigation card

SQLite schema source for platform metadata, RBAC, datasets, Trace/audit records, evaluation assets, reports, Codex tasks, and demo fixtures.
Read this card before modifying `database/schema.sql` or schema-related code in `apps/api/db.py`.
Key files: `database/schema.sql`, `apps/api/db.py`, `apps/api/security.py`, `apps/api/services/sql_guard.py`.

## Why this is high-risk

- Schema changes can affect auth, permissions, masking, audit, Trace replay, Codex task state, and existing demo/runtime databases.
- Runtime `.db` files under `data/` are ignored local artifacts and may contain generated handoffs or local test state.
- The app supports additive migrations for users running newer code over older demo DBs.

## Required before changes

- Inspect both `database/schema.sql` and `apps/api/db.py` migration/seed logic.
- Keep changes additive where possible: new tables/columns/indexes over destructive rewrites.
- Confirm any permission, masking, or audit schema change is reflected in API/security code.
- If demo seed behavior changes, check `DAP_DEMO_MODE` and `DAP_ALLOW_DEMO_SEED` semantics.

## Do not

- Do not manually edit or commit `data/*.db`.
- Do not drop or rename auth/RBAC/audit/Trace tables without an explicit migration plan.
- Do not seed real customer data, private account details, or production credentials.
- Do not weaken foreign key or readonly query assumptions to simplify tests.

## Validation

- Use root `python scripts/static_check.py`.
- DB/security behavior is covered in CI by smoke scripts after dependencies are installed, including `security_smoke_test.py`, `standalone_regression_test.py`, and `hardening_regression_test.py`.
