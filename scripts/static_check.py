#!/usr/bin/env python3
from __future__ import annotations

import compileall
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run(cmd: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    print("$", " ".join(cmd))
    return subprocess.run(cmd, cwd=ROOT, text=True, check=check)


def tracked_files() -> list[str]:
    proc = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
    return [item.decode("utf-8") for item in proc.stdout.split(b"\0") if item]


def check_tracked_boundaries() -> None:
    forbidden_prefixes = ("local/", "data/", "logs/", ".DS_Store")
    leaked = []
    for path in tracked_files():
        if path == ".env.example":
            continue
        if path.startswith(".env") or path.startswith(forbidden_prefixes):
            leaked.append(path)
    if leaked:
        raise SystemExit("Forbidden tracked files:\n" + "\n".join(leaked))


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
    check_python_compile()
    check_shell_scripts()
    check_javascript()
    run([sys.executable, "scripts/check_hfs_alignment.py", "."])
    print("Static checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
