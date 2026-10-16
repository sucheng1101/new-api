"""Create and verify consistent SQLite snapshots using only the standard library."""

import argparse
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import sys
import time
import uuid


def verify(path, timeout=300):
    path = Path(path).resolve(strict=True)
    deadline = time.monotonic() + timeout
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=5)) as db:
        db.set_progress_handler(lambda: int(time.monotonic() > deadline), 10000)
        rows = db.execute("PRAGMA integrity_check").fetchall()
        if rows != [("ok",)]:
            raise ValueError("SQLite integrity check failed")
        count = db.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
        ).fetchone()[0]
    return {"status": "passed", "method": "sqlite-online-backup-integrity-check",
            "integrity_check": "ok", "table_count": count}


def backup(source, destination, timeout=300):
    source = Path(source).resolve(strict=True)
    destination = Path(destination).resolve()
    if source == destination or destination.exists():
        raise ValueError("Backup destination must be a new file")
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(destination.name + "." + uuid.uuid4().hex + ".partial")
    deadline = time.monotonic() + timeout

    def progress(status, remaining, total):
        if time.monotonic() > deadline:
            raise TimeoutError("SQLite snapshot timed out")

    try:
        with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True, timeout=5)) as src:
            with closing(sqlite3.connect(partial, timeout=5)) as dst:
                src.backup(dst, pages=256, progress=progress, sleep=0.05)
        validation = verify(partial, max(0.01, deadline - time.monotonic()))
        # On Windows rename fails if another writer created destination meanwhile.
        # Use a hard link on POSIX for the same no-overwrite guarantee.
        if os.name == "nt":
            partial.rename(destination)
        else:
            os.link(partial, destination)
            partial.unlink()
        return validation
    finally:
        partial.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["backup", "verify"])
    parser.add_argument("--source", required=True)
    parser.add_argument("--destination")
    parser.add_argument("--timeout", type=float, default=300)
    args = parser.parse_args()
    try:
        if args.command == "backup":
            if not args.destination:
                parser.error("backup requires --destination")
            result = backup(args.source, args.destination, args.timeout)
        else:
            result = verify(args.source, args.timeout)
        print(json.dumps(result))
    except (OSError, sqlite3.Error, ValueError, TimeoutError) as error:
        print("SQLite validation failed: " + type(error).__name__, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
