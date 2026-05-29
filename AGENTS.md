# AGENTS.md — Standalone Data Agent Platform

## Platform invariants
- Do not remove or bypass RBAC, SQL Guard, Trace, audit logging, rate limits, approval flows, or dataset masking.
- All generated SQL must remain read-only and pass `apps/api/services/sql_guard.py`.
- Any Codex task that can change code must require human approval before CLI/SDK dispatch.
- Preserve backward-compatible API responses unless a migration note is added.
- Keep demo mode isolated from production configuration.

## Validation commands
Run these after code changes when possible. 本仓库本地验证只做轻量静态检查；不要在本地安装外部依赖、跑 Docker build 或跑完整 smoke 套件，除非用户明确要求。依赖安装、应用 smoke、Docker build/run smoke 放在 GitHub Actions。

```bash
python scripts/static_check.py
```

复杂检查见 `.github/workflows/ci.yml`。

## Preferred change pattern
1. Inspect current implementation.
2. Make the smallest additive change.
3. Update tests and docs.
4. Summarize changed files, validation output, residual risks, and manual checks.
