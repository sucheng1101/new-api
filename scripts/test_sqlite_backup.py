import importlib.util
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "sqlite_backup", Path(__file__).with_name("sqlite-backup.py")
)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class SQLiteBackupTests(unittest.TestCase):
    def test_snapshot_includes_live_wal_rows(self):
        with tempfile.TemporaryDirectory() as folder:
            source, target = Path(folder) / "live.db", Path(folder) / "backup.db"
            with closing(sqlite3.connect(source)) as db:
                db.execute("PRAGMA journal_mode=WAL")
                db.execute("PRAGMA wal_autocheckpoint=0")
                db.execute("CREATE TABLE entries (value TEXT)")
                db.execute("INSERT INTO entries VALUES ('committed in WAL')")
                db.commit()
                self.assertTrue(Path(str(source) + "-wal").stat().st_size > 0)
                self.assertEqual(helper.backup(source, target)["integrity_check"], "ok")
                with closing(sqlite3.connect(target)) as snapshot:
                    self.assertEqual(snapshot.execute("SELECT value FROM entries").fetchall(),
                                     [("committed in WAL",)])

    def test_corrupt_database_never_publishes_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            source, target = Path(folder) / "bad.db", Path(folder) / "backup.db"
            source.write_bytes(b"SQLite format 3\0" + b"broken" * 1000)
            with self.assertRaises(sqlite3.Error):
                helper.backup(source, target)
            self.assertFalse(target.exists())
            self.assertEqual(list(Path(folder).glob("*.partial")), [])

    def test_existing_backup_is_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            source, target = Path(folder) / "live.db", Path(folder) / "backup.db"
            with closing(sqlite3.connect(source)) as db:
                db.execute("CREATE TABLE entries (id INTEGER)")
            target.write_bytes(b"previous backup")
            with self.assertRaises(ValueError):
                helper.backup(source, target)
            self.assertEqual(target.read_bytes(), b"previous backup")

    def test_missing_source_is_not_created(self):
        with tempfile.TemporaryDirectory() as folder:
            source, target = Path(folder) / "missing.db", Path(folder) / "backup.db"
            with self.assertRaises(FileNotFoundError):
                helper.backup(source, target)
            self.assertFalse(source.exists())


if __name__ == "__main__":
    unittest.main()
