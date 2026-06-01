#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

try:
    import fcntl
except ImportError:  # pragma: no cover - HFS/Linux and local macOS both provide fcntl.
    fcntl = None  # type: ignore[assignment]


LOCK_FILENAME = ".sqlite-ops.lock"
LOCK_POLL_SECONDS = 0.2


class SQLiteOpsLockTimeout(RuntimeError):
    def __init__(self, lock_path: Path, timeout_seconds: float, holder: dict[str, Any] | None = None):
        super().__init__(f"SQLite operation lock is held: {lock_path}")
        self.lock_path = lock_path
        self.timeout_seconds = timeout_seconds
        self.holder = holder or {}


def default_sqlite_ops_lock_path(data_dir: Path) -> Path:
    return data_dir / LOCK_FILENAME


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _read_holder(lock_file: Any) -> dict[str, Any]:
    try:
        lock_file.seek(0)
        text = lock_file.read(4096).strip()
        if not text:
            return {}
        loaded = json.loads(text)
        return loaded if isinstance(loaded, dict) else {}
    except Exception:
        return {}


@contextmanager
def sqlite_ops_lock(
    lock_path: Path,
    *,
    operation: str,
    timeout_seconds: float = 30.0,
) -> Iterator[dict[str, Any]]:
    if fcntl is None:
        raise RuntimeError("SQLite operation locking requires fcntl on this deployment target")
    lock_path = lock_path.resolve()
    timeout_seconds = max(0.0, timeout_seconds)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + timeout_seconds
    with lock_path.open("a+", encoding="utf-8") as lock_file:
        while True:
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError as exc:
                if time.monotonic() >= deadline:
                    raise SQLiteOpsLockTimeout(lock_path, timeout_seconds, _read_holder(lock_file)) from exc
                time.sleep(min(LOCK_POLL_SECONDS, max(0.0, deadline - time.monotonic())))
        metadata = {
            "operation": operation,
            "pid": os.getpid(),
            "acquired_at": _now(),
        }
        try:
            lock_file.seek(0)
            lock_file.truncate()
            lock_file.write(json.dumps(metadata, ensure_ascii=False, sort_keys=True) + "\n")
            lock_file.flush()
            os.fsync(lock_file.fileno())
            yield metadata
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
