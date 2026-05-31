# services/codex_sdk_bridge navigation card

Optional private Node ESM bridge for `@openai/codex-sdk`; it is not required for the default Python/FastAPI platform runtime.
Read this card before changing `package.json`, `run_task.mjs`, SDK invocation, or task dispatch assumptions.
Key files: `package.json`, `run_task.mjs`, plus backend integration notes in `apps/api/services/codex_service.py` and `docs/codex-runtime.md`.

## Local invariants

- Keep this package optional. The main app must continue to run without `npm install` in this directory.
- `package.json` stays `private: true`; do not make this package publishable as part of routine changes.
- SDK execution must respect platform approval and handoff semantics from the backend.
- Do not introduce dependencies into the repo root; this bridge owns its own Node dependency surface.

## Local rules

- If changing script names, update callers/docs that mention the script.
- Keep ESM syntax compatible with the Node version used in CI (`actions/setup-node` currently sets Node 22).
- Treat SDK credentials, endpoints, profiles, and model selections as runtime config, not committed defaults.

## Do not

- Do not commit `node_modules/`, generated SDK caches, tokens, or local Codex session data.
- Do not make bridge failure break the default Python app startup path.
- Do not bypass backend approval checks by dispatching directly from the frontend or docs examples.

## Validation

- `node --check services/codex_sdk_bridge/run_task.mjs`.
- `npm run run-task` requires dependencies and configured SDK/runtime context; do not run by default.
