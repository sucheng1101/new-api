"""Read-only proof that an exact Windows process holds the expected SQLite file."""

import argparse
from contextlib import closing
import ctypes
from ctypes import wintypes as w
import datetime
import json
import pathlib
import sqlite3


class UniqueProcess(ctypes.Structure):
    _fields_ = [("pid", w.DWORD), ("started", w.FILETIME)]


class ProcessInfo(ctypes.Structure):
    _fields_ = [
        ("process", UniqueProcess), ("name", w.WCHAR * 256),
        ("service", w.WCHAR * 64), ("kind", ctypes.c_int),
        ("status", w.ULONG), ("session", w.DWORD), ("restartable", w.BOOL),
    ]


def file_holders(path):
    rm = ctypes.WinDLL("Rstrtmgr")
    rm.RmStartSession.argtypes = [ctypes.POINTER(w.DWORD), w.DWORD, w.LPWSTR]
    rm.RmRegisterResources.argtypes = [
        w.DWORD, w.UINT, ctypes.POINTER(w.LPCWSTR), w.UINT,
        ctypes.c_void_p, w.UINT, ctypes.c_void_p,
    ]
    rm.RmGetList.argtypes = [
        w.DWORD, ctypes.POINTER(w.UINT), ctypes.POINTER(w.UINT),
        ctypes.POINTER(ProcessInfo), ctypes.POINTER(w.DWORD),
    ]
    rm.RmEndSession.argtypes = [w.DWORD]
    session, key = w.DWORD(), ctypes.create_unicode_buffer(33)
    rc = rm.RmStartSession(ctypes.byref(session), 0, key)
    if rc:
        raise RuntimeError(("RmStartSession", rc))
    try:
        resources = (w.LPCWSTR * 1)(str(path))
        rc = rm.RmRegisterResources(session, 1, resources, 0, None, 0, None)
        if rc:
            raise RuntimeError(("RmRegisterResources", rc))
        needed, count, reasons = w.UINT(), w.UINT(), w.DWORD()
        for _ in range(5):
            items = (ProcessInfo * count.value)() if count.value else None
            rc = rm.RmGetList(session, ctypes.byref(needed), ctypes.byref(count), items, ctypes.byref(reasons))
            if rc == 234:  # ERROR_MORE_DATA: the process list can grow between calls.
                count.value = needed.value
                continue
            if rc:
                raise RuntimeError(("RmGetList", rc))
            return [
                (items[i].process.pid,
                 (items[i].process.started.dwHighDateTime << 32) | items[i].process.started.dwLowDateTime)
                for i in range(count.value)
            ]
        raise RuntimeError("Database owner list kept changing")
    finally:
        rm.RmEndSession(session)


def inspect_database(database, pid, started):
    path = pathlib.Path(database).resolve(strict=True)
    with path.open("rb") as stream:
        if stream.read(16) != b"SQLite format 3\x00":
            raise RuntimeError("Expected a SQLite database header")
    holders = file_holders(path)
    if (pid, started) not in holders:
        raise RuntimeError("Expected PID and creation time do not hold the database")
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as db:
        counts = {
            table: db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]
            for table in ("users", "tokens", "channels", "options", "direct_ip_allowlists")
        }
        journal = db.execute("PRAGMA journal_mode").fetchone()[0]
    return {
        "engine": "sqlite", "database": str(path), "process_id": pid,
        # String avoids JSON/JavaScript integer precision loss for FILETIME.
        "process_started_filetime": str(started), "journal_mode": journal,
        "counts": counts, "method": "windows-restart-manager-pid-creation-time-and-sqlite-read-only",
        "verified_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True)
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--started", type=int, required=True)
    args = parser.parse_args()
    print(json.dumps(inspect_database(args.database, args.pid, args.started)))
