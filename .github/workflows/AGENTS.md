# .github/workflows navigation card

GitHub Actions workflows for static checks, app smoke, Docker smoke, and manual Hugging Face Space sync.
Read this card before editing any workflow YAML in this directory.
Key files: `ci.yml`, `sync-hf-space.yml`.

## Why this is high-risk

- CI is the authoritative place for dependency install, full app smoke, Docker build/run smoke, and HF sync validation.
- `sync-hf-space.yml` uploads only a provenance-bound thin wrapper after rejecting a non-thin remote Space tree; it never deletes or replaces a full Space tree.
- Workflow excludes prevent local data, logs, ignored exports, and secrets from being uploaded.

## Required before changes

- Keep `python scripts/static_check.py` in CI before heavier smoke or HF upload steps.
- Preserve Python 3.11 and Node availability unless there is a deliberate runtime migration.
- For HF sync changes, verify `hfs-dev.toml`, `cloud/hfs/`, `scripts/export_hfs_space_bundle.py`, `hf_entrypoint.sh`, and `scripts/hf_space_smoke.sh` still align; root Dockerfile is a local/CI product image.
- Treat `HF_TOKEN` and Space secrets as external state; do not echo them.

## Do not

- Do not remove upload excludes for `.git/**`, `.github/**`, `.env*`, `local/**`, `data/**`, `logs/**`, `node_modules/**`, or secret/key file patterns.
- Do not move Docker/HF smoke requirements into the default local validation path.
- Do not turn manual `workflow_dispatch` Space sync into an automatic deploy without user approval.

## Validation

- Run root `python scripts/static_check.py` after workflow edits.
- Actual Actions, Docker, and HF sync behavior remains remote-only unless the user explicitly asks for live validation.
