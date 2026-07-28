#!/usr/bin/env python3
"""Validate this repository's HFS v2 source-lane semantic and bundle contracts."""

from __future__ import annotations

import argparse
import json
import re
import sys
import tomllib
from pathlib import Path
from typing import Any


SHA = re.compile(r"^[0-9a-f]{40}$")
IMAGE = re.compile(r"^[A-Za-z0-9._/:+-]+@sha256:[0-9a-f]{64}$")
ENV_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
SOURCE_REPOSITORY = "https://github.com/BlueSkyXN/Data-Agent-Panel.git"
EXPECTED_MANIFEST = {
    "standard": "2.0",
    "project": "data-agent-panel",
    "space": "BlueSkyXN/Data-Agent-Panel-HFS",
    "sovereignty": "sovereign",
    "lane": "source",
    "version_source": "commit",
}
EXPECTED_BUNDLE_FILES = {".dockerignore", "BUILD_SOURCE.json", "Dockerfile", "README.md", "entrypoint.sh", "hfs-dev.toml"}
FORBIDDEN_BUNDLE_PATHS = {".env", ".env.local", "apps", "data", "database", "docs", "local", "logs", "scripts"}


class Report:
    def __init__(self) -> None:
        self.failures: list[str] = []

    def check(self, condition: bool, label: str, detail: str = "") -> None:
        if condition:
            print(f"PASS {label}")
            return
        message = f"{label}: {detail}" if detail else label
        print(f"FAIL {message}")
        self.failures.append(message)


def first_frontmatter(text: str) -> dict[str, str]:
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---", 4)
    if end == -1:
        return {}
    values: dict[str, str] = {}
    for line in text[4:end].splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            values[key.strip()] = value.strip()
    return values


def key_list(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) and ENV_KEY.fullmatch(item) for item in value)


def check_manifest(report: Report, root: Path) -> None:
    manifest_path = root / "hfs-dev.toml"
    report.check(manifest_path.is_file(), "hfs-dev.toml exists")
    if not manifest_path.is_file():
        return
    manifest = tomllib.loads(manifest_path.read_text(encoding="utf-8"))
    allowed_keys = set(EXPECTED_MANIFEST) | {"local_only", "secrets", "variables"}
    report.check(set(manifest) == allowed_keys, "manifest is a minimal HFS semantic registry", str(sorted(set(manifest) - allowed_keys)))
    for key, value in EXPECTED_MANIFEST.items():
        report.check(manifest.get(key) == value, f"manifest {key} is {value!r}", repr(manifest.get(key)))
    for key in ("local_only", "secrets", "variables"):
        report.check(key_list(manifest.get(key)), f"manifest {key} contains only environment key names")
    if all(key_list(manifest.get(key)) for key in ("local_only", "secrets", "variables")):
        local_only = set(manifest["local_only"])
        secrets = set(manifest["secrets"])
        variables = set(manifest["variables"])
        report.check(not (local_only & (secrets | variables)), "local-only credentials are not Space settings")
        report.check(not (secrets & variables), "Secret and Variable names do not overlap")


def check_wrapper(report: Report, root: Path) -> None:
    wrapper = root / "cloud" / "hfs"
    report.check(wrapper.is_dir(), "cloud/hfs wrapper exists")
    if not wrapper.is_dir():
        return
    for name in ("README.md", "Dockerfile", "entrypoint.sh", ".dockerignore"):
        report.check((wrapper / name).is_file(), f"wrapper file exists: {name}")
    readme = wrapper / "README.md"
    if readme.is_file():
        frontmatter = first_frontmatter(readme.read_text(encoding="utf-8"))
        report.check(frontmatter.get("sdk") == "docker", "wrapper README declares sdk: docker")
        report.check(frontmatter.get("app_port") == "7860", "wrapper README declares app_port 7860")
    dockerfile = wrapper / "Dockerfile"
    if dockerfile.is_file():
        body = dockerfile.read_text(encoding="utf-8")
        report.check("git checkout --detach" in body and "git rev-parse HEAD" in body, "wrapper verifies checked-out source commit")
        report.check("@PYTHON_BASE_IMAGE@" in body and "@DAP_SOURCE_REF@" in body, "template requires injected immutable build inputs")
        report.check("@DAP_SOURCE_REPOSITORY@" in body and "ARG DAP_SOURCE_REPOSITORY" not in body, "template does not expose a mutable source repository argument")
        report.check("COPY ." not in body and "ADD ." not in body, "wrapper does not copy its Space context wholesale")


def check_export_root(report: Report, export_root: Path) -> None:
    report.check(export_root.is_dir(), "export_root exists", str(export_root))
    if not export_root.is_dir():
        return
    names = {path.name for path in export_root.iterdir()}
    report.check(names == EXPECTED_BUNDLE_FILES, "export has only the thin wrapper allowlist", str(sorted(names)))
    leaked = sorted(name for name in FORBIDDEN_BUNDLE_PATHS if (export_root / name).exists())
    report.check(not leaked, "export excludes product and private paths", ", ".join(leaked))

    readme = export_root / "README.md"
    if readme.is_file():
        frontmatter = first_frontmatter(readme.read_text(encoding="utf-8"))
        report.check(frontmatter.get("sdk") == "docker", "export README declares sdk: docker")
        report.check(frontmatter.get("app_port") == "7860", "export README declares app_port 7860")

    dockerfile = export_root / "Dockerfile"
    provenance_path = export_root / "BUILD_SOURCE.json"
    if dockerfile.is_file() and provenance_path.is_file():
        body = dockerfile.read_text(encoding="utf-8")
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        source_ref = provenance.get("source_ref")
        wrapper_ref = provenance.get("wrapper_ref")
        base_image = provenance.get("base_image")
        report.check(provenance.get("source_repository") == SOURCE_REPOSITORY, "provenance records the canonical source repository")
        report.check(provenance.get("wrapper_repository") == SOURCE_REPOSITORY, "provenance does not read wrapper repository from a credential-bearing remote URL")
        report.check(isinstance(source_ref, str) and bool(SHA.fullmatch(source_ref)), "provenance source_ref is an immutable commit")
        report.check(isinstance(wrapper_ref, str) and bool(SHA.fullmatch(wrapper_ref)), "provenance wrapper_ref is an immutable commit")
        report.check(isinstance(base_image, str) and bool(IMAGE.fullmatch(base_image)), "provenance base_image is immutable by digest")
        if isinstance(source_ref, str):
            report.check(source_ref in body, "exported Dockerfile contains the provenance source commit")
        if isinstance(base_image, str):
            report.check(base_image in body, "exported Dockerfile contains the provenance base digest")
        report.check(SOURCE_REPOSITORY in body, "exported Dockerfile contains the canonical source repository")
        report.check("@DAP_SOURCE_REPOSITORY@" not in body and "@DAP_SOURCE_REF@" not in body and "@PYTHON_BASE_IMAGE@" not in body, "exported Dockerfile has no unresolved provenance placeholders")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project_root", nargs="?", default=".", help="project repository root")
    parser.add_argument("--export-root", type=Path, help="previously exported Hugging Face Space root to validate")
    args = parser.parse_args()

    root = Path(args.project_root).resolve()
    report = Report()
    check_manifest(report, root)
    check_wrapper(report, root)
    if args.export_root:
        check_export_root(report, args.export_root.resolve())

    if report.failures:
        print(f"\nFAIL {len(report.failures)} HFS alignment checks")
        return 1
    print("\nPASS HFS v2 source-lane semantic and wrapper contracts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
