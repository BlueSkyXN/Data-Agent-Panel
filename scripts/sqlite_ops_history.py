#!/usr/bin/env python3
from __future__ import annotations

from typing import Any

from apps.api import db


def start_operation_run(operation: str, detail: dict[str, Any] | None = None) -> str | None:
    try:
        return db.start_sqlite_operation_run(operation, detail)
    except Exception:
        return None


def finish_operation_run(run_id: str | None, status: str, detail: dict[str, Any] | None = None) -> None:
    if not run_id:
        return
    try:
        db.finish_sqlite_operation_run(run_id, status, detail)
    except Exception:
        return
