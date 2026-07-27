#!/usr/bin/env python3
"""Export the minimal, provenance-bound Hugging Face Space wrapper.

The exporter never copies product source. Callers must provide full immutable
source and wrapper commits plus an immutable base-image digest. A release export
uses only wrapper inputs that exactly match ``--wrapper-ref``; it refuses dirty
or untracked wrapper inputs rather than claiming provenance for local changes.
The destination must be absent or empty so an export never deletes an existing
directory.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "cloud" / "hfs"
SOURCE_REPOSITORY = "https://github.com/BlueSkyXN/Data-Agent-Panel.git"
SHA = re.compile(r"^[0-9a-f]{40}$")
IMAGE = re.compile(r"^[A-Za-z0-9._/:+-]+@sha256:[0-9a-f]{64}$")
ALLOWED_OUTPUTS = {
    ".dockerignore",
    "BUILD_SOURCE.json",
    "Dockerfile",
    "README.md",
    "entrypoint.sh",
    "hfs-dev.toml",
}
FORBIDDEN_OUTPUTS = {
    ".env",
    ".env.local",
    "apps",
    "data",
    "database",
    "docs",
    "local",
    "logs",
    "scripts",
}
WRAPPER_INPUTS = (
    "cloud/hfs",
    "hfs-dev.toml",
    "hfs-dev.candidate.toml",
    "scripts/export_hfs_space_bundle.py",
)


def require_sha(value: str, label: str) -> str:
    if not SHA.fullmatch(value):
        raise SystemExit(f"{label} must be a lowercase 40-character Git commit SHA")
    return value


def require_image_digest(value: str) -> str:
    if not IMAGE.fullmatch(value):
        raise SystemExit("--base-image must be an image reference pinned with @sha256:<64 lowercase hex characters>")
    return value


def git_result(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(ROOT), *args],
        check=False,
        capture_output=True,
        text=True,
    )


def require_commit(value: str, label: str) -> None:
    result = git_result("cat-file", "-e", f"{value}^{{commit}}")
    if result.returncode:
        raise SystemExit(f"{label} is not an object available as a Git commit in this checkout")


def require_canonical_source_commit(source_ref: str) -> None:
    result = git_result("merge-base", "--is-ancestor", source_ref, "origin/main")
    if result.returncode == 1:
        raise SystemExit("--source-ref must be an immutable commit reachable from origin/main")
    if result.returncode:
        raise SystemExit("unable to verify --source-ref against origin/main")


def require_wrapper_inputs_at_ref(wrapper_ref: str) -> None:
    status = git_result("status", "--porcelain=v1", "--untracked-files=all", "--", *WRAPPER_INPUTS)
    if status.returncode:
        raise SystemExit("unable to inspect wrapper input status")
    if status.stdout.strip():
        raise SystemExit(
            "wrapper inputs have uncommitted or untracked changes; commit them before exporting a provenance-bound bundle"
        )

    diff = git_result("diff", "--quiet", wrapper_ref, "--", *WRAPPER_INPUTS)
    if diff.returncode == 0:
        return
    if diff.returncode == 1:
        raise SystemExit("wrapper inputs do not match --wrapper-ref; refusing to misstate wrapper provenance")
    raise SystemExit("unable to compare wrapper inputs with --wrapper-ref")


def read_template(name: str) -> str:
    path = WRAPPER / name
    if not path.is_file():
        raise SystemExit(f"missing wrapper template: {path}")
    return path.read_text(encoding="utf-8")


def write_text(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8", newline="\n")


def verify_output(
    output: Path,
    source_ref: str,
    wrapper_ref: str,
    base_image: str,
    manifest: Path,
) -> None:
    names = {path.name for path in output.iterdir()}
    if names != ALLOWED_OUTPUTS:
        raise SystemExit(f"unexpected exported bundle contents: {sorted(names)}")
    forbidden = sorted(name for name in FORBIDDEN_OUTPUTS if (output / name).exists())
    if forbidden:
        raise SystemExit(f"export contains forbidden product/private paths: {forbidden}")

    dockerfile = (output / "Dockerfile").read_text(encoding="utf-8")
    for value in (SOURCE_REPOSITORY, source_ref, base_image):
        if value not in dockerfile:
            raise SystemExit(f"exported Dockerfile is missing injected provenance value: {value}")
    for placeholder in ("@DAP_SOURCE_REPOSITORY@", "@DAP_SOURCE_REF@", "@PYTHON_BASE_IMAGE@"):
        if placeholder in dockerfile:
            raise SystemExit("exported Dockerfile still contains an unresolved provenance placeholder")
    if "COPY ." in dockerfile or "ADD ." in dockerfile:
        raise SystemExit("exported Dockerfile must not copy the wrapper context wholesale")

    provenance = json.loads((output / "BUILD_SOURCE.json").read_text(encoding="utf-8"))
    expected = {
        "source_repository": SOURCE_REPOSITORY,
        "source_ref": source_ref,
        "wrapper_repository": SOURCE_REPOSITORY,
        "wrapper_ref": wrapper_ref,
        "base_image": base_image,
    }
    for key, value in expected.items():
        if provenance.get(key) != value:
            raise SystemExit(f"BUILD_SOURCE.json {key} does not match the export input")
    exported_manifest = (output / "hfs-dev.toml").read_bytes()
    if exported_manifest != manifest.read_bytes():
        raise SystemExit("exported hfs-dev.toml does not match --manifest")


def export_bundle(args: argparse.Namespace) -> None:
    source_ref = require_sha(args.source_ref, "--source-ref")
    wrapper_ref = require_sha(args.wrapper_ref, "--wrapper-ref")
    base_image = require_image_digest(args.base_image)
    require_commit(source_ref, "--source-ref")
    require_commit(wrapper_ref, "--wrapper-ref")
    if args.require_origin_main:
        require_canonical_source_commit(source_ref)
    require_wrapper_inputs_at_ref(wrapper_ref)
    manifest = args.manifest.resolve()
    if manifest not in {ROOT / "hfs-dev.toml", ROOT / "hfs-dev.candidate.toml"}:
        raise SystemExit("--manifest must select hfs-dev.toml or hfs-dev.candidate.toml")
    if not manifest.is_file():
        raise SystemExit(f"selected manifest does not exist: {manifest}")
    output = args.output.resolve()

    try:
        output.relative_to(ROOT)
    except ValueError:
        pass
    else:
        raise SystemExit("--output must be outside the repository to avoid exporting generated files into source")
    if output.exists():
        if not output.is_dir() or any(output.iterdir()):
            raise SystemExit("--output already contains files; refusing to delete or overwrite a bundle")
    else:
        output.mkdir(parents=True)

    dockerfile = read_template("Dockerfile")
    dockerfile = (
        dockerfile.replace("@DAP_SOURCE_REPOSITORY@", SOURCE_REPOSITORY)
        .replace("@DAP_SOURCE_REF@", source_ref)
        .replace("@PYTHON_BASE_IMAGE@", base_image)
    )

    write_text(output / "Dockerfile", dockerfile)
    write_text(output / "README.md", read_template("README.md"))
    shutil.copyfile(WRAPPER / "entrypoint.sh", output / "entrypoint.sh")
    shutil.copyfile(WRAPPER / ".dockerignore", output / ".dockerignore")
    shutil.copyfile(manifest, output / "hfs-dev.toml")
    provenance = {
        "schema_version": 1,
        "source_repository": SOURCE_REPOSITORY,
        "source_ref": source_ref,
        "wrapper_repository": SOURCE_REPOSITORY,
        "wrapper_ref": wrapper_ref,
        "base_image": base_image,
        "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }
    write_text(output / "BUILD_SOURCE.json", json.dumps(provenance, indent=2, sort_keys=True) + "\n")
    verify_output(output, source_ref, wrapper_ref, base_image, manifest)
    print(f"Exported HFS wrapper bundle: {output}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path, help="new or empty directory outside the repository")
    parser.add_argument("--source-ref", required=True, help="full immutable product source commit")
    parser.add_argument("--wrapper-ref", required=True, help="full immutable wrapper source commit")
    parser.add_argument("--base-image", required=True, help="base image pinned by digest")
    parser.add_argument(
        "--manifest",
        required=True,
        type=Path,
        help="explicit production or candidate HFS manifest",
    )
    parser.add_argument(
        "--require-origin-main",
        action="store_true",
        help="require the source commit to be reachable from origin/main for publication",
    )
    args = parser.parse_args()
    export_bundle(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
