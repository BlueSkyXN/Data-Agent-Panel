# scripts navigation card

Validation, smoke, HFS, installer, and runtime helper scripts used by local checks, GitHub Actions, and Hugging Face deployment workflows.
Read this card before modifying any `scripts/*.py`, `scripts/*.sh`, `scripts/*.ps1`, `hf_entrypoint.sh`, or script command embedded in CI.
Key files: `static_check.py`, `check_hfs_alignment.py`, `hf_space_smoke.sh`, `hardening_regression_test.py`, `run_hf_local.sh`.

## Why this is high-risk

- `scripts/static_check.py` is the default local gate and is also used by CI and HF sync.
- Smoke scripts encode security, HF ops-token, iframe, and Codex mock/runtime expectations.
- Shell scripts may run in CI, Docker, local zsh/bash environments, or Hugging Face containers.

## Required before changes

- Check `.github/workflows/ci.yml` and `.github/workflows/sync-hf-space.yml` for callers before changing script arguments or output contracts.
- Keep scripts non-interactive and avoid network/Docker requirements in the default static gate.
- Preserve `local/`, `data/`, `logs/`, `.env*`, and secret/key excludes in HFS-related checks.
- Prefer `python3` compatibility for local notes, but keep CI commands aligned with the workflow's configured Python.

## Do not

- Do not remove hardening/HFS assertions from `static_check.py` without replacing them with an equivalent gate.
- Do not print secrets, ops tokens, bearer tokens, cookies, or private endpoint URLs.
- Do not introduce `mapfile` or bash-only assumptions into scripts intended for portable shell contexts unless the shebang and CI usage require bash.
- Do not make installer scripts run automatically from validation scripts.

## Validation

- `python scripts/static_check.py` is the primary gate.
- For shell-only edits, also run `bash -n <script>` when possible; `static_check.py` already syntax-checks tracked shell scripts.
