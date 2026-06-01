from __future__ import annotations

import time

from fastapi import HTTPException

from . import db


def check_rate_limit(key: str, limit: int, window_seconds: int = 60) -> None:
    if limit <= 0:
        return
    now = time.time()
    cutoff = now - window_seconds
    with db.connect() as con:
        con.execute("DELETE FROM rate_limit_events WHERE created_at_epoch <= ?", [cutoff])
        count = con.execute(
            "SELECT COUNT(*) AS c FROM rate_limit_events WHERE bucket_key=? AND created_at_epoch>?",
            [key, cutoff],
        ).fetchone()["c"]
        if count >= limit:
            raise HTTPException(status_code=429, detail="Rate limit exceeded")
        con.execute(
            "INSERT INTO rate_limit_events (id,bucket_key,created_at_epoch,created_at) VALUES (?,?,?,?)",
            [db.new_id("rl"), key, now, db.now()],
        )
