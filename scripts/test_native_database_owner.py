"""Windows database ownership checks using isolated SQLite fixtures only."""

from contextlib import closing
import ctypes
from ctypes import wintypes as w
import importlib.util
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "native_database_owner", Path(__file__).with_name("native-database-owner.py")
)
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)


@unittest.skipUnless(sys.platform == "win32", "Windows Restart Manager required")
class NativeDatabaseOwnerTests(unittest.TestCase):
    def setUp(self):
        self.fixture = tempfile.TemporaryDirectory(prefix="newapi-db-owner-test-")
        self.addCleanup(self.fixture.cleanup)
        self.database = Path(self.fixture.name, "fixture.db")
        with closing(sqlite3.connect(self.database)) as db:
            for table in ("users", "tokens", "channels", "options", "direct_ip_allowlists"):
                db.execute(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY)")
                db.execute(f"INSERT INTO {table} DEFAULT VALUES")
            db.commit()
        # Keep a real open file handle, independent of SQLite connection pooling.
        self.stream = self.database.open("rb")
        self.addCleanup(self.stream.close)
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.GetCurrentProcess.restype = w.HANDLE
        kernel.GetProcessTimes.argtypes = [w.HANDLE] + [ctypes.POINTER(w.FILETIME)] * 4
        created, exited, system, user = (w.FILETIME() for _ in range(4))
        if not kernel.GetProcessTimes(kernel.GetCurrentProcess(), ctypes.byref(created),
                                      ctypes.byref(exited), ctypes.byref(system), ctypes.byref(user)):
            raise ctypes.WinError(ctypes.get_last_error())
        self.started = (created.dwHighDateTime << 32) | created.dwLowDateTime

    def test_exact_process_and_creation_time(self):
        result = owner.inspect_database(self.database, os.getpid(), self.started)
        self.assertEqual(result["engine"], "sqlite")
        self.assertEqual(result["database"], str(self.database.resolve()))
        self.assertEqual(result["process_started_filetime"], str(self.started))
        self.assertEqual(result["counts"], dict.fromkeys(
            ("users", "tokens", "channels", "options", "direct_ip_allowlists"), 1))

    def test_wrong_process_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "PID and creation time"):
            owner.inspect_database(self.database, 0, self.started)

    def test_reused_pid_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "PID and creation time"):
            owner.inspect_database(self.database, os.getpid(), self.started + 1)

    def test_invalid_header_fails_before_owner_lookup(self):
        invalid = Path(self.fixture.name, "invalid.db")
        invalid.write_bytes(b"not a sqlite database")
        with patch.object(owner, "file_holders") as holders:
            with self.assertRaisesRegex(RuntimeError, "SQLite database header"):
                owner.inspect_database(invalid, os.getpid(), self.started)
            holders.assert_not_called()

    def test_missing_database_is_not_created(self):
        missing = Path(self.fixture.name, "missing.db")
        with self.assertRaises(FileNotFoundError):
            owner.inspect_database(missing, os.getpid(), self.started)
        self.assertFalse(missing.exists())

    def test_read_only_inspection_closes_connection(self):
        connect = sqlite3.connect
        connections = []

        def tracked(*args, **kwargs):
            connection = connect(*args, **kwargs)
            connections.append(connection)
            return connection

        with patch.object(owner.sqlite3, "connect", side_effect=tracked):
            owner.inspect_database(self.database, os.getpid(), self.started)
        self.assertEqual(len(connections), 1)
        with self.assertRaises(sqlite3.ProgrammingError):
            connections[0].execute("SELECT 1")


if __name__ == "__main__":
    unittest.main()
