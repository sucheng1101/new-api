# Windows-native runtime troubleshooting

- Problem: switching a verified build reports that the old process is still running after termination.
  Cause: Windows can retain an exited process object while another caller holds its handle. A successful `Get-Process` lookup alone does not establish liveness.
  Fix: retain the original process object, refresh and check `HasExited`, stop that object when needed, then use `WaitForExit` and check `HasExited` again.
  Verify: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-local-native-start.ps1` tests termination with a retained handle and accepts an already exited process.

- Problem: PowerShell 5.1 fails to replace an existing runtime record atomically with an invalid-path error.
  Cause: binding `$null` to the .NET `File.Replace` backup-path string parameter produces an empty string.
  Fix: use `[NullString]::Value` for an omitted backup path; write a sibling temporary file and remove it in `finally`.
  Verify: the same focused script tests initial creation, replacement of an existing record, and cleanup of partial files.

- Problem: a rollback restored service but its runtime record still points at the prior PID.
  Fix: hold the exclusive native-operation file lock and establish the exact executable, port owner, creation time, previous executable hash, health/version, and actual database file owner before repairing metadata. Windows Restart Manager can identify which process holds the SQLite file without changing the database.
  Prevent: rollback must record the restored PID and logs even if health fails. Record native executable/database recovery paths and explicit acceptance status; remove stale Docker recovery fields. Retain database backups and rollback executables.

- Problem: an executable overwrite can encounter a transient Windows file lock after the process exits.
  Fix: stage a sibling partial file and atomically replace/move it with bounded retries. Never truncate the installed executable; remove the partial file on success or failure. A retained process handle alone has not been established as the cause of the overwrite failure.
  Verify: `scripts/test-local-native-start.ps1` checks first installation, locked-file failure preserving old bytes, partial cleanup, replacement after unlocking, and retry-count validation.

- Decision: prove the live database rather than trusting a runtime-lock path or file extension.
  Verify: `scripts/native-database-owner.py` checks the SQLite header, Windows Restart Manager file holders against both PID and process creation FILETIME, then reads journal mode and business-table counts through a closed read-only connection. FILETIME is serialized as a string to preserve precision.
  Prevent: verify ownership before backup, immediately before switching, and after startup/rollback; fail closed on mismatch. Run `py -3 -B -m unittest discover -s scripts -p "test*.py"` for isolated fixture tests.

- Decision: runtime build identity comes from the observed local version suffix resolved to a real Git commit, not the checkout HEAD at inspection time.
  Prevent: on rollback, record the restored version's commit (or null if unresolved), new PID, creation time, executable hash, and database ownership. Never label an older executable as the current source commit.
