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
