# apps/api navigation card

FastAPI backend for auth/RBAC, settings, routers, services, SQL Guard, Trace, audit logging, Codex dispatch, and HF ops endpoints.
Read this card before modifying `main.py`, `config.py`, `db.py`, `security.py`, `routers/`, or `services/`.
Key files: `security.py`, `services/sql_guard.py`, `services/trace_service.py`, `services/codex_service.py`, `services/codex_runtime.py`.

## Local invariants

- RBAC and dataset access flow through `security.py`; do not bypass permission helpers.
- SQL execution must stay read-only through `services/sql_guard.py`, table-scope checks, masking, and readonly DB connections.
- Analysis, SQL, Codex, data quality, panel, and approval workflows must retain Trace steps and audit records.
- Code-changing Codex tasks default to human approval; CLI/SDK/http modes must not silently execute when disabled or unconfigured.
- `DAP_` settings and diagnostics must stay redacted; API responses stay backward-compatible unless a migration note is added.

## Local rules

- Router payload changes usually require `schemas.py` and relevant docs/tests.
- Config/security changes must consider HF/production secrets, ops token, CORS, demo seed, rate limits, and external agent allowlists.
- Schema evolution should be additive and coordinated with `database/schema.sql` plus `db.migrate_platform_schema()`.

## Do not

- Do not construct SQL by skipping SQL Guard or masking logic.
- Do not write secrets, bearer tokens, ops tokens, or private endpoints into logs, audit detail, Trace steps, or API responses.
- Do not make `mock` Codex mode execute code.
- Do not turn production/HF warnings into silent acceptance for insecure defaults.

## Validation

- Use root `python scripts/static_check.py` or `python3 scripts/static_check.py`.
- For security/config/db changes, run `python scripts/hardening_regression_test.py` after runtime deps are available; CI also runs it.
