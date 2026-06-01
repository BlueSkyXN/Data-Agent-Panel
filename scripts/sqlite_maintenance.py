#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
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

CHECKPOINT_MODES = {"none", "passive", "truncate"}
TRACE_DEPENDENT_TABLES = ("trace_steps", "sql_runs", "chart_specs", "tool_calls")


def _sqlite_readonly_uri(path: Path) -> str:
    uri_path = urllib.parse.quote(str(path.resolve()), safe="/")
    return f"file:{uri_path}?mode=ro"


def _file_size(path: Path) -> int:
    return path.stat().st_size if path.exists() else 0


def _stats(path: Path) -> dict[str, Any]:
    with sqlite3.connect(_sqlite_readonly_uri(path), uri=True) as con:
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA query_only = ON")
        page_count = con.execute("PRAGMA page_count").fetchone()[0]
        page_size = con.execute("PRAGMA page_size").fetchone()[0]
        return {
            "integrity_check": con.execute("PRAGMA integrity_check").fetchone()[0],
            "user_version": con.execute("PRAGMA user_version").fetchone()[0],
            "journal_mode": con.execute("PRAGMA journal_mode").fetchone()[0],
            "page_count": page_count,
            "page_size": page_size,
            "estimated_size_bytes": page_count * page_size,
            "file_size_bytes": _file_size(path),
            "wal_size_bytes": _file_size(Path(str(path) + "-wal")),
            "shm_size_bytes": _file_size(Path(str(path) + "-shm")),
        }


def copy_sqlite_snapshot(source: Path, destination: Path) -> bool:
    source = source.resolve()
    destination = destination.resolve()
    if not source.exists():
        return False
    if destination.exists():
        raise FileExistsError(f"SQLite snapshot destination already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(_sqlite_readonly_uri(source), uri=True) as src:
        src.execute("PRAGMA query_only = ON")
        with sqlite3.connect(str(destination)) as dst:
            src.backup(dst)
    return True


def _cutoff_iso(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _cutoff_hours_iso(hours: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _table_exists(con: sqlite3.Connection, table: str) -> bool:
    row = con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", [table]).fetchone()
    return row is not None


def _delete_count(con: sqlite3.Connection, table: str, where_sql: str, params: list[Any], *, dry_run: bool) -> dict[str, int]:
    count = int(con.execute(f"SELECT COUNT(*) AS c FROM {table} WHERE {where_sql}", params).fetchone()["c"])
    if not dry_run and count:
        con.execute(f"DELETE FROM {table} WHERE {where_sql}", params)
    return {"matched_rows": count, "deleted_rows": 0 if dry_run else count}


def prune_platform_runtime_data(
    path: Path,
    *,
    trace_retention_days: int = 0,
    audit_retention_days: int = 0,
    rate_limit_retention_hours: int = 24,
    operation_run_retention_days: int = 180,
    stale_operation_hours: int = 24,
    dry_run: bool = False,
) -> dict[str, Any]:
    path = path.resolve()
    if not path.exists():
        return {"status": "missing", "path": str(path)}
    actions: list[dict[str, Any]] = []
    started = time.time()
    with sqlite3.connect(str(path)) as con:
        con.row_factory = sqlite3.Row
        if rate_limit_retention_hours > 0 and _table_exists(con, "rate_limit_events"):
            cutoff_epoch = time.time() - rate_limit_retention_hours * 3600
            result = _delete_count(
                con,
                "rate_limit_events",
                "created_at_epoch <= ?",
                [cutoff_epoch],
                dry_run=dry_run,
            )
            actions.append(
                {
                    "name": "prune_rate_limit_events",
                    "status": "ok",
                    "retention_hours": rate_limit_retention_hours,
                    "cutoff_epoch": cutoff_epoch,
                    **result,
                }
            )
        if trace_retention_days > 0 and _table_exists(con, "traces"):
            cutoff = _cutoff_iso(trace_retention_days)
            con.execute("DROP TABLE IF EXISTS temp.prune_trace_ids")
            con.execute("CREATE TEMP TABLE prune_trace_ids(id TEXT PRIMARY KEY)")
            con.execute("INSERT INTO prune_trace_ids(id) SELECT id FROM traces WHERE created_at <= ?", [cutoff])
            trace_count = int(con.execute("SELECT COUNT(*) AS c FROM prune_trace_ids").fetchone()["c"])
            dependent_actions: list[dict[str, Any]] = []
            for table in TRACE_DEPENDENT_TABLES:
                if not _table_exists(con, table):
                    continue
                count = int(con.execute(f"SELECT COUNT(*) AS c FROM {table} WHERE trace_id IN (SELECT id FROM prune_trace_ids)").fetchone()["c"])
                if not dry_run and count:
                    con.execute(f"DELETE FROM {table} WHERE trace_id IN (SELECT id FROM prune_trace_ids)")
                dependent_actions.append({"table": table, "matched_rows": count, "deleted_rows": 0 if dry_run else count})
            if not dry_run and trace_count:
                con.execute("DELETE FROM traces WHERE id IN (SELECT id FROM prune_trace_ids)")
            actions.append(
                {
                    "name": "prune_traces",
                    "status": "ok",
                    "retention_days": trace_retention_days,
                    "cutoff": cutoff,
                    "matched_rows": trace_count,
                    "deleted_rows": 0 if dry_run else trace_count,
                    "dependents": dependent_actions,
                }
            )
        if audit_retention_days > 0 and _table_exists(con, "audit_logs"):
            cutoff = _cutoff_iso(audit_retention_days)
            result = _delete_count(
                con,
                "audit_logs",
                "created_at <= ?",
                [cutoff],
                dry_run=dry_run,
            )
            actions.append(
                {
                    "name": "prune_audit_logs",
                    "status": "ok",
                    "retention_days": audit_retention_days,
                    "cutoff": cutoff,
                    **result,
                }
            )
        if _table_exists(con, "platform_operation_runs"):
            if stale_operation_hours > 0:
                cutoff = _cutoff_hours_iso(stale_operation_hours)
                count = int(
                    con.execute(
                        "SELECT COUNT(*) AS c FROM platform_operation_runs WHERE status='running' AND started_at <= ?",
                        [cutoff],
                    ).fetchone()["c"]
                )
                if not dry_run and count:
                    con.execute(
                        "UPDATE platform_operation_runs SET status='stale', finished_at=COALESCE(finished_at, ?) WHERE status='running' AND started_at <= ?",
                        [datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"), cutoff],
                    )
                actions.append(
                    {
                        "name": "mark_stale_platform_operation_runs",
                        "status": "ok",
                        "stale_after_hours": stale_operation_hours,
                        "cutoff": cutoff,
                        "matched_rows": count,
                        "updated_rows": 0 if dry_run else count,
                    }
                )
            if operation_run_retention_days > 0:
                cutoff = _cutoff_iso(operation_run_retention_days)
                result = _delete_count(
                    con,
                    "platform_operation_runs",
                    "status!='running' AND finished_at IS NOT NULL AND finished_at <= ?",
                    [cutoff],
                    dry_run=dry_run,
                )
                actions.append(
                    {
                        "name": "prune_platform_operation_runs",
                        "status": "ok",
                        "retention_days": operation_run_retention_days,
                        "cutoff": cutoff,
                        **result,
                    }
                )
    if not actions:
        actions.append({"name": "runtime_retention", "status": "skipped"})
    return {
        "status": "ok",
        "path": str(path),
        "duration_ms": int((time.time() - started) * 1000),
        "dry_run": dry_run,
        "actions": actions,
    }


def maintain_database(
    label: str,
    path: Path,
    *,
    checkpoint_mode: str = "passive",
    optimize: bool = True,
    vacuum: bool = False,
    dry_run: bool = False,
) -> dict[str, Any]:
    path = path.resolve()
    if not path.exists():
        return {"label": label, "status": "missing", "path": str(path)}
    if checkpoint_mode not in CHECKPOINT_MODES:
        raise ValueError(f"Unsupported checkpoint mode: {checkpoint_mode}")
    started = time.time()
    before = _stats(path)
    actions: list[dict[str, Any]] = []
    if not dry_run:
        with sqlite3.connect(str(path)) as con:
            if optimize:
                con.execute("PRAGMA optimize")
                actions.append({"name": "optimize", "status": "ok"})
            if checkpoint_mode != "none":
                row = con.execute(f"PRAGMA wal_checkpoint({checkpoint_mode.upper()})").fetchone()
                actions.append(
                    {
                        "name": f"wal_checkpoint_{checkpoint_mode}",
                        "status": "ok",
                        "busy": row[0],
                        "log_frames": row[1],
                        "checkpointed_frames": row[2],
                    }
                )
            if vacuum:
                con.execute("VACUUM")
                actions.append({"name": "vacuum", "status": "ok"})
    else:
        actions.append({"name": "dry_run", "status": "ok"})
    after = _stats(path)
    status = "ok" if after["integrity_check"] == "ok" else "failed"
    return {
        "label": label,
        "status": status,
        "path": str(path),
        "duration_ms": int((time.time() - started) * 1000),
        "dry_run": dry_run,
        "actions": actions,
        "before": before,
        "after": after,
    }


def maintain_databases(
    platform_db: Path,
    business_db: Path,
    *,
    checkpoint_mode: str = "passive",
    optimize: bool = True,
    vacuum: bool = False,
    dry_run: bool = False,
    trace_retention_days: int = 0,
    audit_retention_days: int = 0,
    rate_limit_retention_hours: int = 24,
    operation_run_retention_days: int = 180,
    stale_operation_hours: int = 24,
) -> dict[str, Any]:
    runtime_retention = prune_platform_runtime_data(
        platform_db,
        trace_retention_days=trace_retention_days,
        audit_retention_days=audit_retention_days,
        rate_limit_retention_hours=rate_limit_retention_hours,
        operation_run_retention_days=operation_run_retention_days,
        stale_operation_hours=stale_operation_hours,
        dry_run=dry_run,
    )
    reports = {
        "platform": maintain_database(
            "platform",
            platform_db,
            checkpoint_mode=checkpoint_mode,
            optimize=optimize,
            vacuum=vacuum,
            dry_run=dry_run,
        ),
        "business": maintain_database(
            "business",
            business_db,
            checkpoint_mode=checkpoint_mode,
            optimize=optimize,
            vacuum=vacuum,
            dry_run=dry_run,
        ),
    }
    ok = all(item["status"] in {"ok", "missing"} for item in reports.values()) and reports["platform"]["status"] == "ok"
    if runtime_retention["status"] not in {"ok", "missing"}:
        ok = False
    return {
        "ok": ok,
        "checkpoint_mode": checkpoint_mode,
        "optimize": optimize,
        "vacuum": vacuum,
        "dry_run": dry_run,
        "runtime_retention": runtime_retention,
        "databases": reports,
    }


def build_parser() -> argparse.ArgumentParser:
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Run lightweight SQLite maintenance for Data Agent Panel runtime databases.")
    parser.add_argument("--platform-db", type=Path, default=settings.db_path, help="Platform SQLite database path.")
    parser.add_argument("--business-db", type=Path, default=settings.business_db_path, help="Business sample SQLite database path.")
    parser.add_argument("--checkpoint", choices=sorted(CHECKPOINT_MODES), default="passive", help="WAL checkpoint mode. Use truncate only during a quiet maintenance window.")
    parser.add_argument("--no-optimize", action="store_true", help="Skip PRAGMA optimize.")
    parser.add_argument("--vacuum", action="store_true", help="Run VACUUM after checkpoint. Use only with enough free disk and a quiet app.")
    parser.add_argument("--prune-rate-limits-hours", type=int, default=24, help="Delete rate_limit_events older than this many hours. 0 disables this cleanup.")
    parser.add_argument("--prune-traces-days", type=int, default=0, help="Delete traces and trace detail rows older than this many days. 0 disables trace pruning.")
    parser.add_argument("--prune-audit-days", type=int, default=0, help="Delete audit_logs older than this many days. 0 disables audit pruning.")
    parser.add_argument("--prune-operation-runs-days", type=int, default=180, help="Delete finished platform_operation_runs older than this many days. 0 disables this cleanup.")
    parser.add_argument("--mark-stale-operation-hours", type=int, default=24, help="Mark running platform_operation_runs older than this many hours as stale. 0 disables this check.")
    parser.add_argument("--dry-run", action="store_true", help="Only report SQLite stats; do not run optimize, checkpoint, or vacuum.")
    parser.add_argument("--copy-to-temp", action="store_true", help="Copy databases to a temp directory first and maintain the copies. Useful for validation.")
    parser.add_argument("--lock-path", type=Path, default=default_sqlite_ops_lock_path(settings.data_dir), help="Local lock file used to avoid overlapping SQLite backup and maintenance jobs.")
    parser.add_argument("--lock-timeout-seconds", type=float, default=30.0, help="Seconds to wait for the SQLite operation lock before failing.")
    parser.add_argument("--json", action="store_true", help="Print full JSON report instead of a short summary.")
    return parser


def _copy_for_validation(platform_db: Path, business_db: Path) -> tuple[Path, Path, Path]:
    tmp = Path("/tmp") / f"dap-sqlite-maintenance-{int(time.time() * 1000)}"
    tmp.mkdir(parents=True, exist_ok=False)
    platform_copy = tmp / "data_agent_platform.db"
    business_copy = tmp / "business_sample.db"
    copy_sqlite_snapshot(platform_db, platform_copy)
    copy_sqlite_snapshot(business_db, business_copy)
    return platform_copy, business_copy, tmp


def _lock_timeout_report(exc: SQLiteOpsLockTimeout) -> dict[str, Any]:
    return {
        "ok": False,
        "status": "lock_timeout",
        "lock_path": str(exc.lock_path),
        "timeout_seconds": exc.timeout_seconds,
        "holder": exc.holder,
    }


def _operation_start_detail(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "platform_db": str(args.platform_db),
        "business_db": str(args.business_db),
        "checkpoint": args.checkpoint,
        "optimize": not args.no_optimize,
        "vacuum": args.vacuum,
        "dry_run": args.dry_run,
        "copy_to_temp": args.copy_to_temp,
        "prune_rate_limits_hours": max(0, args.prune_rate_limits_hours),
        "prune_traces_days": max(0, args.prune_traces_days),
        "prune_audit_days": max(0, args.prune_audit_days),
        "prune_operation_runs_days": max(0, args.prune_operation_runs_days),
        "mark_stale_operation_hours": max(0, args.mark_stale_operation_hours),
    }


def _operation_finish_detail(report: dict[str, Any] | None = None, error: Exception | None = None) -> dict[str, Any]:
    if error is not None:
        return {"ok": False, "error": str(error)}
    report = report or {}
    databases = report.get("databases") or {}
    retention = report.get("runtime_retention") or {}
    return {
        "ok": bool(report.get("ok")),
        "checkpoint_mode": report.get("checkpoint_mode"),
        "dry_run": report.get("dry_run"),
        "vacuum": report.get("vacuum"),
        "runtime_retention_status": retention.get("status"),
        "database_statuses": {
            label: item.get("status")
            for label, item in databases.items()
            if isinstance(item, dict)
        },
        "temp_dir": report.get("temp_dir", ""),
    }


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    platform_db = args.platform_db
    business_db = args.business_db
    temp_dir: Path | None = None
    try:
        with sqlite_ops_lock(args.lock_path, operation="sqlite_maintenance", timeout_seconds=args.lock_timeout_seconds):
            operation_run_id = start_operation_run("sqlite_maintenance", _operation_start_detail(args))
            try:
                if args.copy_to_temp:
                    platform_db, business_db, temp_dir = _copy_for_validation(platform_db, business_db)
                report = maintain_databases(
                    platform_db,
                    business_db,
                    checkpoint_mode=args.checkpoint,
                    optimize=not args.no_optimize,
                    vacuum=args.vacuum,
                    dry_run=args.dry_run,
                    trace_retention_days=max(0, args.prune_traces_days),
                    audit_retention_days=max(0, args.prune_audit_days),
                    rate_limit_retention_hours=max(0, args.prune_rate_limits_hours),
                    operation_run_retention_days=max(0, args.prune_operation_runs_days),
                    stale_operation_hours=max(0, args.mark_stale_operation_hours),
                )
                if temp_dir:
                    report["temp_dir"] = str(temp_dir)
                if operation_run_id:
                    report["operation_run_id"] = operation_run_id
                finish_operation_run(operation_run_id, "ok" if report["ok"] else "failed", _operation_finish_detail(report))
            except Exception as exc:
                finish_operation_run(operation_run_id, "failed", _operation_finish_detail(error=exc))
                raise
    except SQLiteOpsLockTimeout as exc:
        report = _lock_timeout_report(exc)
        if args.json:
            print(json.dumps(report, ensure_ascii=False, indent=2))
        else:
            print(f"SQLite operation lock is held: {exc.lock_path}", file=sys.stderr)
            if exc.holder:
                holder = exc.holder.get("operation", "unknown")
                pid = exc.holder.get("pid", "unknown")
                acquired_at = exc.holder.get("acquired_at", "unknown")
                print(f"holder: {holder} pid={pid} acquired_at={acquired_at}", file=sys.stderr)
        return 75
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"SQLite maintenance: {'ok' if report['ok'] else 'failed'}")
        retention = report["runtime_retention"]
        print(f"runtime_retention: {retention['status']} {retention.get('path', '')}")
        for action in retention.get("actions", []):
            if "matched_rows" in action:
                print(f"  {action['name']}: {action['deleted_rows']}/{action['matched_rows']} rows")
        for label, item in report["databases"].items():
            print(f"{label}: {item['status']} {item.get('path', '')}")
            if item.get("status") == "ok":
                print(f"  wal {item['before']['wal_size_bytes']} -> {item['after']['wal_size_bytes']} bytes")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
