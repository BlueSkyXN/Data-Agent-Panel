#!/usr/bin/env python3
"""Static checker for the local HFS development standard."""

from __future__ import annotations

import argparse
import sys
import tomllib
from pathlib import Path
from typing import Any


ALLOWED_PATTERNS = {"A", "B"}
ALLOWED_RUNTIME_MODES = {
    "self-contained",
    "image-assembly",
    "source-fetch",
    "artifact-at-build-time",
    "artifact-at-runtime",
}
ALLOWED_SPACE_ROOT_MODES = {"repo-root", "flat-remap", "repack-with-subtree"}
ALLOWED_RELEASE_PIN_TYPES = {"git_ref", "image_ref", "artifact", "checksum", "package_version", "metadata"}
PATTERN_B_FORBIDDEN_ROOTS = {"apps", "runner-go", "scripts", "docs", "local", "data", "logs", "dist"}
PATTERN_B_FORBIDDEN_FILES = {".env", ".env.local"}


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


def first_frontmatter(text: str) -> str:
    if not text.startswith("---\n"):
        return ""
    end = text.find("\n---", 4)
    if end == -1:
        return ""
    return text[4:end]


def load_manifest(project_root: Path, manifest_path: Path | None) -> tuple[Path, dict[str, Any]]:
    candidates = [manifest_path] if manifest_path else [
        project_root / "hfs-dev.toml",
        project_root / "cloud" / "hfs" / "hfs-dev.toml",
    ]
    for candidate in candidates:
        if candidate and candidate.exists():
            with candidate.open("rb") as file:
                return candidate, tomllib.load(file)
    searched = ", ".join(str(path) for path in candidates if path)
    raise SystemExit(f"hfs-dev.toml not found; searched: {searched}")


def as_list(value: Any) -> list[str]:
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return value
    return []


def exported_hfs_dir(export_root: Path, space_root_mode: Any) -> Path:
    if space_root_mode == "repack-with-subtree":
        return export_root / "cloud" / "hfs"
    return export_root


def has_checksum_surface(surfaces: list[str]) -> bool:
    return any("SHA256" in item or "sha256" in item or "checksum" in item.lower() for item in surfaces)


def has_immutable_source_surface(surfaces: list[str]) -> bool:
    immutable_markers = ("<git-sha>", "<commit-sha>", "commit", "digest", "release", "stable", "@sha256:", "sha256:")
    return any(any(marker in item.lower() for marker in immutable_markers) for item in surfaces)


def has_git_sha_surface(surfaces: list[str]) -> bool:
    return any("<git-sha>" in item or "<commit-sha>" in item or "commit" in item.lower() for item in surfaces)


def has_digest_surface(surfaces: list[str]) -> bool:
    return any("digest" in item.lower() or "@sha256:" in item or "sha256:" in item for item in surfaces)


def release_pin_groups(manifest: dict[str, Any]) -> list[list[str]]:
    groups: list[list[str]] = []
    surfaces = as_list(manifest.get("release_pin_surfaces"))
    if surfaces:
        groups.append(surfaces)

    alternatives = manifest.get("release_pin_alternatives", [])
    if isinstance(alternatives, list):
        for group in alternatives:
            if isinstance(group, list) and all(isinstance(item, str) for item in group):
                groups.append(group)
    return groups


def check_release_pin(report: Report, manifest: dict[str, Any]) -> None:
    if manifest.get("schema_version") == 2:
        check_release_pin_v2(report, manifest)
        return

    runtime_mode = manifest.get("runtime_mode")
    groups = release_pin_groups(manifest)
    all_surfaces = [item for group in groups for item in group]
    report.check(manifest.get("release_pin_required") is True, "release_pin_required is true")
    report.check(bool(groups), "release pin groups are non-empty")
    floating_release_surfaces = [
        item
        for item in all_surfaces
        if "latest" in item or "HEAD" in item or "main" in item or "master" in item
    ]
    report.check(not floating_release_surfaces, "release pin surfaces do not use mutable refs", "; ".join(floating_release_surfaces))

    for index, group in enumerate(groups, start=1):
        label = f"release pin group {index}"
        if runtime_mode in {"artifact-at-runtime", "artifact-at-build-time"}:
            report.check(has_checksum_surface(group), f"{label} declares checksum surface")
            report.check(has_immutable_source_surface(group), f"{label} declares immutable artifact source")
        elif runtime_mode == "source-fetch":
            report.check(has_git_sha_surface(group), f"{label} declares git commit SHA surface")
        elif runtime_mode == "image-assembly":
            report.check(has_digest_surface(group), f"{label} declares image digest surface")
        elif runtime_mode == "self-contained":
            report.check(has_digest_surface(group), f"{label} declares base image digest surface")


def check_release_pin_v2(report: Report, manifest: dict[str, Any]) -> None:
    runtime_mode = manifest.get("runtime_mode")
    report.check(manifest.get("release_pin_required") is True, "release_pin_required is true")
    report.check("release_pin_surfaces" not in manifest, "v2 release pins use structured [[release_pins]]")

    release_pins = manifest.get("release_pins")
    report.check(isinstance(release_pins, list) and bool(release_pins), "release_pins are non-empty structured tables")
    if not isinstance(release_pins, list):
        return

    pins_by_name: dict[str, dict[str, Any]] = {}
    for index, pin in enumerate(release_pins, start=1):
        if not isinstance(pin, dict):
            report.check(False, f"release_pins[{index}] is a table")
            continue
        name = pin.get("name")
        pin_type = pin.get("type")
        report.check(isinstance(name, str) and bool(name), f"release_pins[{index}] has name")
        report.check(pin_type in ALLOWED_RELEASE_PIN_TYPES, f"release_pins[{index}] has valid type", str(pin_type))
        report.check(isinstance(pin.get("source"), str) and bool(pin.get("source")), f"release_pins[{index}] has source")
        if "required_for_release" in pin:
            report.check(isinstance(pin.get("required_for_release"), bool), f"release_pins[{index}].required_for_release is boolean")
        if "dev_mutable_default_allowed" in pin:
            report.check(isinstance(pin.get("dev_mutable_default_allowed"), bool), f"release_pins[{index}].dev_mutable_default_allowed is boolean")
        if isinstance(name, str) and name:
            report.check(name not in pins_by_name, f"release_pins name is unique: {name}")
            pins_by_name[name] = pin

    required_pins = [pin for pin in pins_by_name.values() if pin.get("required_for_release") is True]
    report.check(bool(required_pins), "release_pins include required release inputs")

    if runtime_mode == "source-fetch":
        report.check(
            any(pin.get("type") == "git_ref" and pin.get("release_requires_commit_sha") is True for pin in required_pins),
            "source-fetch release pin requires git commit SHA",
        )
    elif runtime_mode == "image-assembly":
        image_pins = [pin for pin in required_pins if pin.get("type") == "image_ref"]
        report.check(bool(image_pins), "image-assembly release pins include image refs")
        for pin in image_pins:
            report.check(pin.get("release_requires_digest") is True, f"{pin.get('name')} release requires image digest")
    elif runtime_mode in {"artifact-at-runtime", "artifact-at-build-time"}:
        report.check(
            any(pin.get("type") == "checksum" or pin.get("release_requires_checksum") is True for pin in required_pins),
            "artifact release pins include checksum requirement",
        )
    elif runtime_mode == "self-contained":
        report.check(
            any(pin.get("type") == "image_ref" and pin.get("release_requires_digest") is True for pin in required_pins),
            "self-contained release pins include base image digest",
        )


def check_export_root(report: Report, export_root: Path, manifest: dict[str, Any]) -> None:
    pattern = manifest.get("pattern")
    space_root_mode = manifest.get("space_root_mode")
    required_files = as_list(manifest.get("required_files"))
    target_hfs_dir = exported_hfs_dir(export_root, space_root_mode)

    report.check(export_root.exists(), "export_root exists", str(export_root))
    if not export_root.exists():
        return

    exported_readme = export_root / "README.md"
    exported_dockerfile = export_root / "Dockerfile"
    report.check(exported_readme.exists(), "export root README.md exists")
    report.check(exported_dockerfile.exists(), "export root Dockerfile exists")
    if exported_readme.exists():
        fm = first_frontmatter(exported_readme.read_text(encoding="utf-8"))
        report.check("sdk: docker" in fm, "export root README declares sdk: docker")
    if exported_dockerfile.exists():
        body = exported_dockerfile.read_text(encoding="utf-8")
        uses_cloud_prefix = "COPY cloud/hfs/" in body or "ADD cloud/hfs/" in body
        if space_root_mode == "repack-with-subtree":
            report.check(uses_cloud_prefix, "export root Dockerfile keeps cloud/hfs COPY prefix")
        if space_root_mode == "flat-remap":
            report.check(not uses_cloud_prefix, "export root Dockerfile does not use cloud/hfs COPY prefix")

    if pattern == "B":
        forbidden_roots = sorted(name for name in PATTERN_B_FORBIDDEN_ROOTS if (export_root / name).exists())
        report.check(not forbidden_roots, "Pattern B export excludes product root directories", ", ".join(forbidden_roots))
        forbidden_files = sorted(name for name in PATTERN_B_FORBIDDEN_FILES if (export_root / name).exists())
        report.check(not forbidden_files, "Pattern B export excludes private env files", ", ".join(forbidden_files))

    if space_root_mode == "repack-with-subtree":
        report.check((export_root / "cloud" / "hfs").is_dir(), "repack export includes cloud/hfs subtree")
    if space_root_mode == "flat-remap":
        report.check(not (export_root / "cloud" / "hfs").exists(), "flat-remap export does not retain cloud/hfs subtree")

    for rel_file in required_files:
        report.check((target_hfs_dir / rel_file).exists(), f"export required file exists: {rel_file}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Check static HFS standard alignment.")
    parser.add_argument("project_root", nargs="?", default=".", help="Project repository root")
    parser.add_argument("--manifest", type=Path, help="Explicit hfs-dev.toml path")
    parser.add_argument("--export-root", type=Path, help="Previously exported Hugging Face Space root to validate")
    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    manifest_path, manifest = load_manifest(project_root, args.manifest)
    report = Report()

    print(f"Manifest: {manifest_path}")
    pattern = manifest.get("pattern")
    runtime_mode = manifest.get("runtime_mode")
    space_root_mode = manifest.get("space_root_mode")
    hfs_dir = Path(str(manifest.get("hfs_dir", ".")))
    if not hfs_dir.is_absolute():
        hfs_dir = project_root / hfs_dir

    report.check(manifest.get("standard") == "hfs-dev", "standard is hfs-dev")
    report.check(manifest.get("schema_version") in {1, 2}, "schema_version is 1 or 2")
    report.check(pattern in ALLOWED_PATTERNS, "pattern is valid", str(pattern))
    report.check(runtime_mode in ALLOWED_RUNTIME_MODES, "runtime_mode is valid", str(runtime_mode))
    report.check(space_root_mode in ALLOWED_SPACE_ROOT_MODES, "space_root_mode is valid", str(space_root_mode))
    report.check(hfs_dir.exists(), "hfs_dir exists", str(hfs_dir))

    readme = hfs_dir / "README.md"
    dockerfile = hfs_dir / "Dockerfile"
    report.check(readme.exists(), "HFS README.md exists", str(readme))
    report.check(dockerfile.exists(), "HFS Dockerfile exists", str(dockerfile))

    if readme.exists():
        fm = first_frontmatter(readme.read_text(encoding="utf-8"))
        report.check("sdk: docker" in fm, "HFS README declares sdk: docker")
        public_port = manifest.get("public_port")
        if isinstance(public_port, int) and public_port != 7860:
            report.check(f"app_port: {public_port}" in fm, "HFS README app_port matches public_port")

    if dockerfile.exists():
        body = dockerfile.read_text(encoding="utf-8")
        uses_cloud_prefix = "COPY cloud/hfs/" in body or "ADD cloud/hfs/" in body
        if space_root_mode == "repack-with-subtree":
            report.check(uses_cloud_prefix, "repack-with-subtree keeps cloud/hfs COPY prefix")
        if space_root_mode == "flat-remap":
            report.check(not uses_cloud_prefix, "flat-remap does not use cloud/hfs COPY prefix")

    if pattern == "A":
        report.check(space_root_mode == "repo-root", "Pattern A uses repo-root space_root_mode")
        report.check(hfs_dir == project_root, "Pattern A hfs_dir is project root", str(hfs_dir))
    if pattern == "B":
        report.check(hfs_dir == project_root / "cloud" / "hfs", "Pattern B hfs_dir is cloud/hfs", str(hfs_dir))
        root_readme = project_root / "README.md"
        if root_readme.exists():
            root_fm = first_frontmatter(root_readme.read_text(encoding="utf-8"))
            report.check("sdk: docker" not in root_fm, "Pattern B product README is not HF Space metadata")
        source_excludes = set(as_list(manifest.get("source_excludes")))
        missing_excludes = sorted(PATTERN_B_FORBIDDEN_ROOTS - source_excludes)
        report.check(not missing_excludes, "Pattern B declares source_excludes", ", ".join(missing_excludes))

    check_release_pin(report, manifest)
    for rel_file in as_list(manifest.get("required_files")):
        report.check((hfs_dir / rel_file).exists(), f"required file exists: {rel_file}")

    if args.export_root:
        check_export_root(report, args.export_root.resolve(), manifest)

    if report.failures:
        print(f"\nFAIL {len(report.failures)} HFS alignment checks")
        return 1
    print("\nPASS HFS alignment manifest and static contract checks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
