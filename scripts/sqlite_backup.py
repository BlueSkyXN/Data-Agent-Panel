#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
import sys
import tempfile
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from apps.api.config import get_settings  # noqa: E402
from scripts.sqlite_ops_lock import (  # noqa: E402
    SQLiteOpsLockTimeout,
    default_sqlite_ops_lock_path,
    sqlite_ops_lock,
)
from scripts.sqlite_ops_history import finish_operation_run, start_operation_run  # noqa: E402

MANIFEST_NAME = "manifest.json"
MANIFEST_KIND = "data-agent-panel-sqlite-backup"
BACKUP_FILENAMES = {
    "platform": "data_agent_platform.db",
    "business": "business_sample.db",
}


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _sqlite_readonly_uri(path: Path) -> str:
    uri_path = urllib.parse.quote(str(path.resolve()), safe="/")
    return f"file:{uri_path}?mode=ro"


def _connect_readonly(path: Path) -> sqlite3.Connection:
    con = sqlite3.connect(_sqlite_readonly_uri(path), uri=True)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA query_only = ON")
    return con


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _db_stats(path: Path) -> dict[str, Any]:
    with _connect_readonly(path) as con:
        integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
        return {
            "integrity_check": integrity,
            "user_version": con.execute("PRAGMA user_version").fetchone()[0],
            "journal_mode": con.execute("PRAGMA journal_mode").fetchone()[0],
            "page_count": con.execute("PRAGMA page_count").fetchone()[0],
            "page_size": con.execute("PRAGMA page_size").fetchone()[0],
        }


def backup_database(label: str, source: Path, destination: Path) -> dict[str, Any]:
    source = source.resolve()
    destination = destination.resolve()
    if not source.exists():
        return {"label": label, "status": "missing", "source_path": str(source)}
    if destination.exists():
        raise FileExistsError(f"Backup destination already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    started = time.time()
    with _connect_readonly(source) as src:
        with sqlite3.connect(str(destination)) as dst:
            src.backup(dst)
    stats = _db_stats(destination)
    if stats["integrity_check"] != "ok":
        raise RuntimeError(f"Backup integrity check failed for {destination}: {stats['integrity_check']}")
    size = destination.stat().st_size
    return {
        "label": label,
        "status": "ok",
        "source_path": str(source),
        "backup_path": str(destination),
        "size_bytes": size,
        "sha256": _sha256_file(destination),
        "duration_ms": int((time.time() - started) * 1000),
        **stats,
    }


def verify_backup_dir(backup_dir: Path) -> dict[str, Any]:
    backup_dir = backup_dir.resolve()
    manifest_path = backup_dir / MANIFEST_NAME
    if not manifest_path.exists():
        raise FileNotFoundError(f"Backup manifest does not exist: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("kind") != MANIFEST_KIND:
        raise ValueError(f"Unsupported backup manifest kind: {manifest.get('kind')!r}")
    checks: dict[str, Any] = {}
    ok = True
    databases = manifest.get("databases") or {}
    for label, filename in BACKUP_FILENAMES.items():
        record = databases.get(label)
        if not record:
            checks[label] = {"status": "missing_manifest_record"}
            ok = False
            continue
        if record.get("status") == "missing":
            checks[label] = {"status": "source_missing_at_backup_time"}
            continue
        path = backup_dir / filename
        if not path.exists():
            checks[label] = {"status": "missing_backup_file", "path": str(path)}
            ok = False
            continue
        stats = _db_stats(path)
        size = path.stat().st_size
        sha256 = _sha256_file(path)
        size_matches = record.get("size_bytes") in {None, size}
        sha256_matches = record.get("sha256") in {None, sha256}
        user_version_matches = record.get("user_version") in {None, stats["user_version"]}
        check_ok = stats["integrity_check"] == "ok" and size_matches and sha256_matches and user_version_matches
        ok = ok and check_ok
        checks[label] = {
            "status": "ok" if check_ok else "failed",
            "path": str(path),
            "size_bytes": size,
            "sha256": sha256,
            "size_matches_manifest": size_matches,
            "sha256_matches_manifest": sha256_matches,
            "user_version_matches_manifest": user_version_matches,
            **stats,
        }
    return {
        "ok": ok,
        "kind": MANIFEST_KIND,
        "backup_dir": str(backup_dir),
        "manifest_path": str(manifest_path),
        "checks": checks,
    }


def rehearse_restore(backup_dir: Path, rehearsal_dir: Path | None = None) -> dict[str, Any]:
    verification = verify_backup_dir(backup_dir)
    if not verification["ok"]:
        return {"ok": False, "stage": "verify_backup", "verification": verification}
    cleanup = False
    if rehearsal_dir is None:
        rehearsal_dir = Path(tempfile.mkdtemp(prefix="dap-sqlite-restore-rehearsal-"))
        cleanup = True
    else:
        rehearsal_dir = rehearsal_dir.resolve()
        if rehearsal_dir.exists():
            raise FileExistsError(f"Restore rehearsal directory already exists: {rehearsal_dir}")
        rehearsal_dir.mkdir(parents=True, exist_ok=False)
    backup_dir = backup_dir.resolve()
    platform_copy = rehearsal_dir / BACKUP_FILENAMES["platform"]
    business_copy = rehearsal_dir / BACKUP_FILENAMES["business"]
    shutil.copy2(backup_dir / BACKUP_FILENAMES["platform"], platform_copy)
    if (backup_dir / BACKUP_FILENAMES["business"]).exists():
        shutil.copy2(backup_dir / BACKUP_FILENAMES["business"], business_copy)

    from apps.api import db as app_db  # noqa: PLC0415

    checks: dict[str, Any] = {}
    ok = True
    with app_db.connect_readonly(platform_copy) as con:
        platform_integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
        platform_user_version = con.execute("PRAGMA user_version").fetchone()[0]
        table_names = {row["name"] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        required_tables = {"users", "roles", "user_roles", "role_permissions", "platform_metadata", "audit_logs"}
        missing_tables = sorted(required_tables - table_names)
        user_count = con.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"] if "users" in table_names else 0
        admin_count = 0
        if not missing_tables:
            admin_count = con.execute(
                """
                SELECT COUNT(*) AS c
                FROM users u
                JOIN user_roles ur ON ur.user_id=u.id
                JOIN roles r ON r.id=ur.role_id
                WHERE r.name='admin' AND u.status='active'
                """
            ).fetchone()["c"]
        schema_matches = platform_user_version == app_db.SCHEMA_VERSION
        platform_ok = platform_integrity == "ok" and not missing_tables and schema_matches and user_count > 0 and admin_count > 0
        ok = ok and platform_ok
        checks["platform"] = {
            "status": "ok" if platform_ok else "failed",
            "path": str(platform_copy),
            "integrity_check": platform_integrity,
            "user_version": platform_user_version,
            "expected_user_version": app_db.SCHEMA_VERSION,
            "schema_version_matches": schema_matches,
            "missing_required_tables": missing_tables,
            "user_count": user_count,
            "active_admin_count": admin_count,
        }
    if business_copy.exists():
        with app_db.connect_readonly(business_copy) as con:
            business_integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
            table_names = {row["name"] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
            required_tables = {"sales_orders", "support_tickets"}
            missing_tables = sorted(required_tables - table_names)
            sales_count = con.execute("SELECT COUNT(*) AS c FROM sales_orders").fetchone()["c"] if "sales_orders" in table_names else 0
            business_ok = business_integrity == "ok" and not missing_tables and sales_count > 0
            ok = ok and business_ok
            checks["business"] = {
                "status": "ok" if business_ok else "failed",
                "path": str(business_copy),
                "integrity_check": business_integrity,
                "missing_required_tables": missing_tables,
                "sales_order_count": sales_count,
            }
    else:
        checks["business"] = {"status": "missing", "path": str(business_copy)}
    return {
        "ok": ok,
        "stage": "restore_rehearsal",
        "backup_dir": str(backup_dir),
        "rehearsal_dir": str(rehearsal_dir),
        "cleanup_recommended": cleanup,
        "verification": verification,
        "checks": checks,
    }


def _safe_backup_dirs(output_dir: Path) -> list[Path]:
    out: list[Path] = []
    if not output_dir.exists():
        return out
    for child in output_dir.iterdir():
        manifest_path = child / MANIFEST_NAME
        if not child.is_dir() or not manifest_path.exists():
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if manifest.get("kind") == MANIFEST_KIND:
            out.append(child)
    return sorted(out, key=lambda path: path.stat().st_mtime, reverse=True)


def apply_retention(output_dir: Path, retention_count: int = 0, retention_days: int = 0) -> list[str]:
    removed: list[str] = []
    backups = _safe_backup_dirs(output_dir)
    keep: set[Path] = set()
    if retention_count > 0:
        keep.update(backups[:retention_count])
    cutoff = time.time() - retention_days * 86400 if retention_days > 0 else None
    for backup_dir in backups:
        if backup_dir in keep:
            continue
        if cutoff is not None and backup_dir.stat().st_mtime >= cutoff:
            continue
        if retention_count <= 0 and cutoff is None:
            continue
        shutil.rmtree(backup_dir)
        removed.append(str(backup_dir))
    return removed


def backup_databases(
    platform_db: Path,
    business_db: Path,
    output_dir: Path,
    *,
    name: str | None = None,
    retention_count: int = 0,
    retention_days: int = 0,
) -> dict[str, Any]:
    if not platform_db.exists():
        raise FileNotFoundError(f"Platform database does not exist: {platform_db}")
    created_at = _now()
    backup_name = name or created_at.replace(":", "").replace("-", "").replace("Z", "Z")
    target_dir = (output_dir / backup_name).resolve()
    if target_dir.exists():
        raise FileExistsError(f"Backup directory already exists: {target_dir}")
    target_dir.mkdir(parents=True, exist_ok=False)
    manifest: dict[str, Any] = {
        "kind": MANIFEST_KIND,
        "created_at": created_at,
        "backup_dir": str(target_dir),
        "databases": {},
    }
    manifest["databases"]["platform"] = backup_database("platform", platform_db, target_dir / "data_agent_platform.db")
    manifest["databases"]["business"] = backup_database("business", business_db, target_dir / "business_sample.db")
    manifest["retention_removed"] = []
    manifest_path = target_dir / MANIFEST_NAME
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    manifest["retention_removed"] = apply_retention(output_dir.resolve(), retention_count=retention_count, retention_days=retention_days)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    manifest["manifest_path"] = str(manifest_path)
    return manifest


def build_parser() -> argparse.ArgumentParser:
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Create consistent SQLite backups for Data Agent Panel runtime databases.")
    parser.add_argument("--platform-db", type=Path, default=settings.db_path, help="Platform SQLite database path.")
    parser.add_argument("--business-db", type=Path, default=settings.business_db_path, help="Business sample SQLite database path.")
    parser.add_argument("--output-dir", type=Path, default=settings.data_dir / "backups", help="Directory that will contain timestamped backup folders.")
    parser.add_argument("--name", default="", help="Optional backup folder name. Defaults to a UTC timestamp.")
    parser.add_argument("--retention-count", type=int, default=0, help="Keep at most this many backup folders created by this script. 0 disables count retention.")
    parser.add_argument("--retention-days", type=int, default=0, help="Delete backup folders older than this many days. 0 disables age retention.")
    parser.add_argument("--verify-dir", type=Path, help="Verify an existing backup directory and do not create a new backup.")
    parser.add_argument("--rehearse-restore-dir", type=Path, help="Copy an existing backup into a temporary restore location and validate it with the current backend schema.")
    parser.add_argument("--rehearsal-output-dir", type=Path, help="Optional empty directory to receive restore rehearsal copies.")
    parser.add_argument("--lock-path", type=Path, default=default_sqlite_ops_lock_path(settings.data_dir), help="Local lock file used to avoid overlapping SQLite backup and maintenance jobs.")
    parser.add_argument("--lock-timeout-seconds", type=float, default=30.0, help="Seconds to wait for the SQLite operation lock before failing.")
    parser.add_argument("--json", action="store_true", help="Print full manifest JSON instead of a short summary.")
    return parser


def _print_lock_timeout(exc: SQLiteOpsLockTimeout, *, json_output: bool) -> None:
    report = {
        "ok": False,
        "status": "lock_timeout",
        "lock_path": str(exc.lock_path),
        "timeout_seconds": exc.timeout_seconds,
        "holder": exc.holder,
    }
    if json_output:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return
    print(f"SQLite operation lock is held: {exc.lock_path}", file=sys.stderr)
    if exc.holder:
        holder = exc.holder.get("operation", "unknown")
        pid = exc.holder.get("pid", "unknown")
        acquired_at = exc.holder.get("acquired_at", "unknown")
        print(f"holder: {holder} pid={pid} acquired_at={acquired_at}", file=sys.stderr)


def _operation_mode(args: argparse.Namespace) -> str:
    if args.verify_dir:
        return "verify"
    if args.rehearse_restore_dir:
        return "restore_rehearsal"
    return "backup"


def _operation_start_detail(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "mode": _operation_mode(args),
        "platform_db": str(args.platform_db),
        "business_db": str(args.business_db),
        "output_dir": str(args.output_dir),
        "verify_dir": str(args.verify_dir) if args.verify_dir else "",
        "rehearse_restore_dir": str(args.rehearse_restore_dir) if args.rehearse_restore_dir else "",
    }


def _operation_finish_detail(mode: str, report: dict[str, Any] | None = None, error: Exception | None = None) -> dict[str, Any]:
    detail: dict[str, Any] = {"mode": mode}
    if error is not None:
        detail.update({"ok": False, "error": str(error)})
        return detail
    report = report or {}
    detail["ok"] = bool(report.get("ok", True))
    if mode == "backup":
        detail["backup_dir"] = report.get("backup_dir", "")
        detail["manifest_path"] = report.get("manifest_path", "")
        detail["retention_removed_count"] = len(report.get("retention_removed") or [])
        detail["database_statuses"] = {
            label: record.get("status")
            for label, record in (report.get("databases") or {}).items()
            if isinstance(record, dict)
        }
    elif mode == "verify":
        detail["backup_dir"] = report.get("backup_dir", "")
        detail["check_statuses"] = {
            label: check.get("status")
            for label, check in (report.get("checks") or {}).items()
            if isinstance(check, dict)
        }
    else:
        detail["backup_dir"] = report.get("backup_dir", "")
        detail["rehearsal_dir"] = report.get("rehearsal_dir", "")
        detail["check_statuses"] = {
            label: check.get("status")
            for label, check in (report.get("checks") or {}).items()
            if isinstance(check, dict)
        }
    return detail


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        with sqlite_ops_lock(args.lock_path, operation="sqlite_backup", timeout_seconds=args.lock_timeout_seconds):
            mode = _operation_mode(args)
            operation_run_id = start_operation_run("sqlite_backup", _operation_start_detail(args))
            if args.verify_dir:
                try:
                    report = verify_backup_dir(args.verify_dir)
                    if operation_run_id:
                        report["operation_run_id"] = operation_run_id
                    finish_operation_run(operation_run_id, "ok" if report["ok"] else "failed", _operation_finish_detail(mode, report))
                except Exception as exc:
                    finish_operation_run(operation_run_id, "failed", _operation_finish_detail(mode, error=exc))
                    raise
                if args.json:
                    print(json.dumps(report, ensure_ascii=False, indent=2))
                else:
                    print(f"Backup verification: {'ok' if report['ok'] else 'failed'} {report['backup_dir']}")
                    for label, check in report["checks"].items():
                        print(f"{label}: {check['status']} {check.get('path', '')}")
                return 0 if report["ok"] else 1
            if args.rehearse_restore_dir:
                try:
                    report = rehearse_restore(args.rehearse_restore_dir, args.rehearsal_output_dir)
                    if operation_run_id:
                        report["operation_run_id"] = operation_run_id
                    finish_operation_run(operation_run_id, "ok" if report["ok"] else "failed", _operation_finish_detail(mode, report))
                except Exception as exc:
                    finish_operation_run(operation_run_id, "failed", _operation_finish_detail(mode, error=exc))
                    raise
                if args.json:
                    print(json.dumps(report, ensure_ascii=False, indent=2))
                else:
                    print(f"Restore rehearsal: {'ok' if report['ok'] else 'failed'} {report['backup_dir']}")
                    print(f"Rehearsal dir: {report['rehearsal_dir']}")
                    for label, check in report["checks"].items():
                        print(f"{label}: {check['status']} {check.get('path', '')}")
                return 0 if report["ok"] else 1
            try:
                manifest = backup_databases(
                    args.platform_db,
                    args.business_db,
                    args.output_dir,
                    name=args.name or None,
                    retention_count=max(0, args.retention_count),
                    retention_days=max(0, args.retention_days),
                )
                if operation_run_id:
                    manifest["operation_run_id"] = operation_run_id
                finish_operation_run(operation_run_id, "ok", _operation_finish_detail(mode, manifest))
            except Exception as exc:
                finish_operation_run(operation_run_id, "failed", _operation_finish_detail(mode, error=exc))
                raise
    except SQLiteOpsLockTimeout as exc:
        _print_lock_timeout(exc, json_output=args.json)
        return 75
    if args.json:
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
        return 0
    print(f"Backup manifest: {manifest['manifest_path']}")
    for label, record in manifest["databases"].items():
        print(f"{label}: {record['status']} {record.get('backup_path', record.get('source_path', ''))}")
    if manifest["retention_removed"]:
        print("Retention removed:")
        for path in manifest["retention_removed"]:
            print(f"- {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
