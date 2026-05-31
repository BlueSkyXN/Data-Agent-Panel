#!/usr/bin/env python3
from __future__ import annotations

import compileall
import re
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_TRACKED_SUFFIXES = (".key", ".pem", ".p12", ".pfx", ".secret")
BINARY_SUFFIXES = {
    ".db",
    ".ico",
    ".jpg",
    ".jpeg",
    ".pdf",
    ".png",
    ".pyc",
    ".sqlite",
    ".webp",
}


def run(cmd: list[str], *, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess[str]:
    print("$", " ".join(cmd))
    return subprocess.run(cmd, cwd=ROOT, text=True, check=check, capture_output=capture)


def tracked_files() -> list[str]:
    proc = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
    return [item.decode("utf-8") for item in proc.stdout.split(b"\0") if item]


def changed_or_untracked_files() -> list[Path]:
    paths: list[str] = []
    for cmd in (
        ["git", "diff", "--name-only", "--diff-filter=ACMR", "-z"],
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
        ["git", "ls-files", "--others", "--exclude-standard", "-z"],
    ):
        proc = subprocess.run(cmd, cwd=ROOT, check=True, capture_output=True)
        paths.extend(item.decode("utf-8") for item in proc.stdout.split(b"\0") if item)
    unique = []
    seen: set[str] = set()
    for rel in paths:
        if rel not in seen:
            seen.add(rel)
            path = ROOT / rel
            if path.is_file():
                unique.append(path)
    return unique


def check_tracked_boundaries() -> None:
    forbidden_prefixes = ("local/", "data/", "logs/", ".DS_Store")
    leaked = []
    for path in tracked_files():
        if path == ".env.example":
            continue
        if path.startswith(".env") or path.startswith(forbidden_prefixes) or path.lower().endswith(FORBIDDEN_TRACKED_SUFFIXES):
            leaked.append(path)
    if leaked:
        raise SystemExit("Forbidden tracked files:\n" + "\n".join(leaked))


def check_git_diff_whitespace() -> None:
    run(["git", "diff", "--check"])


def check_changed_file_trailing_whitespace() -> None:
    failures: list[str] = []
    pattern = re.compile(rb"[ \t\r]+$")
    for path in changed_or_untracked_files():
        if path.suffix.lower() in BINARY_SUFFIXES:
            continue
        try:
            data = path.read_bytes()
        except OSError as exc:
            raise SystemExit(f"Unable to read {path.relative_to(ROOT)}: {exc}") from exc
        if b"\0" in data:
            continue
        for number, line in enumerate(data.splitlines(), start=1):
            if pattern.search(line):
                failures.append(f"{path.relative_to(ROOT)}:{number}: trailing whitespace")
    if failures:
        raise SystemExit("Trailing whitespace found:\n" + "\n".join(failures))


def read_frontmatter(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---", 4)
    if end == -1:
        return {}
    values: dict[str, str] = {}
    for line in text[4:end].splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        values[key.strip()] = value.strip()
    return values


def check_file_contains(path: Path, expected: str) -> None:
    if expected not in path.read_text(encoding="utf-8"):
        raise SystemExit(f"{path.relative_to(ROOT)} must contain {expected!r}")


def check_file_absent(path: Path, forbidden: str) -> None:
    if forbidden in path.read_text(encoding="utf-8"):
        raise SystemExit(f"{path.relative_to(ROOT)} must not contain {forbidden!r}")


def check_hfs_contract() -> None:
    manifest = tomllib.loads((ROOT / "hfs-dev.toml").read_text(encoding="utf-8"))
    expected = {
        "schema_version": 2,
        "standard": "hfs-dev",
        "pattern": "A",
        "runtime_mode": "self-contained",
        "space_root_mode": "repo-root",
        "hfs_dir": ".",
        "public_port": 7860,
        "canonical_health_endpoint": "/_ops/healthz",
        "release_pin_required": True,
    }
    for key, value in expected.items():
        if manifest.get(key) != value:
            raise SystemExit(f"hfs-dev.toml {key} must be {value!r}, got {manifest.get(key)!r}")

    frontmatter = read_frontmatter(ROOT / "README.md")
    if frontmatter.get("sdk") != "docker":
        raise SystemExit("README.md frontmatter must set sdk: docker")
    if frontmatter.get("app_port") != str(manifest["public_port"]):
        raise SystemExit("README.md app_port must match hfs-dev.toml public_port")

    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    if "ARG PYTHON_BASE_IMAGE=" not in dockerfile or "FROM ${PYTHON_BASE_IMAGE}" not in dockerfile:
        raise SystemExit("Dockerfile must expose and use PYTHON_BASE_IMAGE build arg")
    if f"EXPOSE {manifest['public_port']}" not in dockerfile:
        raise SystemExit("Dockerfile EXPOSE must match public_port")
    if "/api/health/live" not in dockerfile:
        raise SystemExit("Dockerfile healthcheck must cover /api/health/live")

    for rel_path in manifest.get("required_files", []):
        if not isinstance(rel_path, str) or not (ROOT / rel_path).exists():
            raise SystemExit(f"hfs-dev.toml required file is missing: {rel_path!r}")

    source_excludes = manifest.get("source_excludes", [])
    for expected_item in ("*.secret", "*.key", "*.pem", "*.p12", "*.pfx"):
        if expected_item not in source_excludes:
            raise SystemExit(f"hfs-dev.toml source_excludes must include {expected_item}")

    gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
    for expected_item in ("*.secret", "*.key", "*.pem", "*.p12", "*.pfx"):
        if expected_item not in gitignore:
            raise SystemExit(f".gitignore must exclude {expected_item}")

    dockerignore = (ROOT / ".dockerignore").read_text(encoding="utf-8")
    for expected_item in ("local", "data", ".env.local", "logs", "*.secret", "*.key", "*.pem", "*.p12", "*.pfx"):
        if expected_item not in dockerignore:
            raise SystemExit(f".dockerignore must exclude {expected_item}")

    workflow = (ROOT / ".github" / "workflows" / "sync-hf-space.yml").read_text(encoding="utf-8")
    for expected_item in ("--exclude \"*.secret\"", "--exclude \"*.key\"", "--exclude \"*.pem\"", "--exclude \"*.p12\"", "--exclude \"*.pfx\""):
        if expected_item not in workflow:
            raise SystemExit(f".github/workflows/sync-hf-space.yml must include {expected_item}")

    if (ROOT / "cloud" / "hfs" / "README.md").exists() or (ROOT / "cloud" / "hfs" / "Dockerfile").exists():
        raise SystemExit("Pattern A repo must keep Space root at repo root, not cloud/hfs/")

    smoke = ROOT / "scripts" / "hf_space_smoke.sh"
    for expected_item in ("/_ops/healthz", "/_ops/persistence", "/_ops/errors", "/_ops/metrics", "/api/health/live", "Authorization: Bearer", "X-Ops-Token", "X-DAP-Token", "SMOKE_USERNAME", "SMOKE_PASSWORD", "ops cookie migration"):
        check_file_contains(smoke, expected_item)
    check_file_contains(smoke, "frame-ancestors")
    check_file_absent(smoke, "$(request_headers)")
    check_file_absent(smoke, "mapfile")

    entrypoint = ROOT / "hf_entrypoint.sh"
    check_file_contains(entrypoint, "DAP_SECRET_KEY")
    check_file_contains(entrypoint, "dap_secret_key")

    hf_router = ROOT / "apps" / "api" / "routers" / "hf_space.py"
    check_file_contains(hf_router, "X-Forwarded-Proto")
    check_file_absent(hf_router, 'secure=bool(os.getenv("SPACE_HOST"))')


def check_python_compile() -> None:
    ok = compileall.compile_dir(ROOT / "apps", quiet=1)
    ok = compileall.compile_dir(ROOT / "scripts", quiet=1) and ok
    if not ok:
        raise SystemExit("Python compile check failed")


def check_shell_scripts() -> None:
    for script in sorted((ROOT / "scripts").glob("*.sh")) + [ROOT / "hf_entrypoint.sh", ROOT / "run_dev.sh"]:
        run(["bash", "-n", str(script.relative_to(ROOT))])


def check_javascript() -> None:
    node = shutil.which("node")
    if not node:
        print("SKIP node --check; node is not installed")
        return
    run([node, "--check", "apps/web/static/app.js"])
    run([node, "--check", "services/codex_sdk_bridge/run_task.mjs"])


def main() -> int:
    check_tracked_boundaries()
    check_git_diff_whitespace()
    check_changed_file_trailing_whitespace()
    check_hfs_contract()
    check_python_compile()
    check_shell_scripts()
    check_javascript()
    run([sys.executable, "scripts/check_hfs_alignment.py", "."])
    print("Static checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
