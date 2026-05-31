# apps/web/static navigation card

Static Web 工作台，由 FastAPI 直接服务；没有 bundler、framework build、package script 或 frontend dependency install step。
Read this card before modifying UI markup, CSS, browser-side API calls, Trace drawers, Codex 运行台, dataops, audit, or responsive behavior.
Key files: `index.html`, `styles.css`, `app.js`, `favicon.svg`; supporting map: `docs/ui-function-map.md`.

## Local invariants

- Keep the UI aligned with backend security surfaces: RBAC, SQL Guard, Trace, audit, approval flow, Codex handoff/dispatch state.
- Preserve the static deployment model. Do not add a build step, package manager, CDN dependency, or generated asset pipeline unless the user asks for a frontend migration.
- API calls should continue to use the shared `api()` path and bearer token flow; do not hard-code demo credentials or ops tokens.
- Trace buttons/drawers are part of the auditability contract. Do not remove evidence access while changing layouts.
- Responsive behavior must keep controls readable on desktop and mobile without overlapping text or hiding primary actions.

## Local rules

- When changing `app.js`, keep functions small enough to inspect and prefer existing renderer/helper patterns.
- When changing `styles.css`, reuse existing tokens and layout conventions before adding new global styles.
- Match UI copy to the platform domain; avoid marketing-only pages that replace the actual workbench.

## Do not

- Do not make frontend-only checks the source of truth for permissions; backend RBAC remains authoritative.
- Do not store tokens in new persistent browser storage unless the existing auth flow already does so.
- Do not hide error or approval states just to simplify UI.

## Validation

- `node --check apps/web/static/app.js` for JS changes.
- Root `python scripts/static_check.py` runs the JS syntax check too when `node` is installed.
