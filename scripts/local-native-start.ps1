[CmdletBinding()]
param(
  [string]$Owner = 'CLI-NA-RUNTIME-01',
  [ValidateSet(5200)][int]$Port = 5200,
  [string]$SqlitePath = '',
  [string]$BackupRoot = '',
  [string]$MetadataPath = '',
  [string]$LogDir = '',
  [string]$BunPath = 'bun'
)

# Canonical Windows-native runtime. Never operates Docker or another project's process.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $SqlitePath) { $SqlitePath = Join-Path $root 'data\one-api.db' }
if (-not $BackupRoot) { $BackupRoot = Join-Path $root 'data\runtime-backups\database' }
if (-not $LogDir) { $LogDir = Join-Path $root 'logs' }
$SqlitePath = (Resolve-Path -LiteralPath $SqlitePath -ErrorAction Stop).Path
$runtime = (& git -C $root rev-parse --path-format=absolute --git-path new-api-dev).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Git runtime directory lookup failed.' }
if (-not $MetadataPath) { $MetadataPath = Join-Path $runtime 'database-backup-latest.json' }
$lockPath = Join-Path $runtime 'runtime-lock.json'
$exePath = Join-Path $root 'new-api.exe'
New-Item -ItemType Directory -Force -Path $runtime, $LogDir | Out-Null

function Write-AtomicJson($Path, $Value) {
  $temporary = "$Path.$([guid]::NewGuid().ToString('N')).partial"
  try {
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
    # PowerShell 5.1 binds $null to an empty string for this .NET string argument.
    if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary, $Path, [NullString]::Value) }
    else { [IO.File]::Move($temporary, $Path) }
  } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
}

function Stop-NativeProcess($Process) {
  # Hold the original process handle: Windows may retain its PID after exit while
  # another caller still has a handle open. Get-Process alone is not a liveness check.
  $Process.Refresh()
  if (-not $Process.HasExited) {
    Stop-Process -InputObject $Process -Force -ErrorAction Stop
    if (-not $Process.WaitForExit(15000)) { throw 'Native process did not exit within 15 seconds.' }
  }
  $Process.Refresh()
  if (-not $Process.HasExited) { throw 'Native process is still running.' }
}

function Install-NativeExecutable($Source, $Destination, [ValidateRange(1, 120)][int]$Attempts = 30) {
  # A failed overwrite must never truncate the previous executable. Stage on the
  # destination volume, then retry the atomic rename for transient Windows locks.
  $temporary = "$Destination.$([guid]::NewGuid().ToString('N')).partial"
  try {
    [IO.File]::Copy($Source, $temporary, $false)
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
      try {
        if (Test-Path -LiteralPath $Destination) { [IO.File]::Replace($temporary, $Destination, [NullString]::Value) }
        else { [IO.File]::Move($temporary, $Destination) }
        return
      } catch {
        if ($attempt -eq $Attempts) { throw }
        Start-Sleep -Milliseconds 250
      }
    }
  } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
}

function Resolve-BuildCommit($Version) {
  if ($Version -match '-local\.([0-9a-f]{12,40})$') {
    $resolved = & git -C $root rev-parse --verify --quiet "$($Matches[1])^{commit}" 2>$null
    if ($LASTEXITCODE -eq 0) { return $resolved.Trim() }
  }
  return $null
}

function Assert-LiveDatabase($Process) {
  $Process.Refresh()
  if ($Process.HasExited) { throw 'Runtime exited before database ownership verification.' }
  $python = Get-Command py -ErrorAction SilentlyContinue
  $pythonArgs = @('-3')
  if (-not $python) { $python = Get-Command python -ErrorAction Stop; $pythonArgs = @() }
  $started = $Process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()
  $result = & $python.Source @pythonArgs (Join-Path $PSScriptRoot 'native-database-owner.py') --database $SqlitePath --pid $Process.Id --started $started
  if ($LASTEXITCODE -ne 0) { throw 'Actual runtime database ownership/engine verification failed.' }
  $evidence = $result | ConvertFrom-Json
  if ($evidence.engine -ne 'sqlite' -or $evidence.database -ne $SqlitePath -or
      $evidence.process_id -ne $Process.Id -or $evidence.process_started_filetime -ne $started) {
    throw 'Database owner evidence differs from the expected native process.'
  }
  return $evidence
}

function Assert-Ownership {
  $existing = $null
  if (Test-Path -LiteralPath $lockPath) { $existing = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json }
  $native = @(Get-CimInstance Win32_Process -Filter "Name='new-api.exe'" | Where-Object { $_.ExecutablePath -eq $exePath })
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  if ($existing) {
    if ($existing.runtime_mode -ne 'windows-native' -or $existing.runtime_owner -ne $Owner) {
      throw 'Runtime mode/owner differs from this operation. Inspect the existing lock before takeover.'
    }
    if ($existing.database_engine -ne 'sqlite' -or $existing.database_instance -ne $SqlitePath -or $existing.runtime_exe -ne $exePath) {
      throw 'Runtime engine, database instance, or executable differs from the locked instance.'
    }
  }
  if ($native.Count -gt 1) { throw 'Multiple project executables exist; inspect ownership first.' }
  foreach ($process in $native) {
    if (-not $existing -or $process.ProcessId -ne $existing.runtime_pid) { throw 'Executable PID is not owned by the runtime lock.' }
    $live = Get-Process -Id $process.ProcessId -ErrorAction Stop
    if ($existing.runtime_process_started_filetime -and
        $existing.runtime_process_started_filetime -ne $live.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()) {
      throw 'Runtime PID creation time differs from the lock; possible PID reuse.'
    }
    if ($existing.runtime_exe_sha256 -and
        $existing.runtime_exe_sha256 -ne (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash) {
      throw 'Runtime executable hash differs from the lock.'
    }
  }
  foreach ($listener in $listeners) {
    if (-not $existing -or $listener.OwningProcess -ne $existing.runtime_pid -or $native.Count -ne 1) {
      throw "Port $Port is occupied by an unrelated or unverified process."
    }
  }
  return $existing
}

function Assert-Backup($Evidence) {
  if ($Evidence.mode -ne 'sqlite' -or $Evidence.source -ne $SqlitePath -or
      $Evidence.validation.status -ne 'passed' -or $Evidence.validation.integrity_check -ne 'ok' -or
      $Evidence.validation.method -ne 'sqlite-online-backup-integrity-check' -or
      $Evidence.rollback_path -ne $Evidence.backup_path) { throw 'Backup evidence does not match the runtime database or integrity requirements.' }
  $age = ([DateTime]::UtcNow - [DateTime]::Parse($Evidence.created_at_utc).ToUniversalTime()).TotalMinutes
  if ($age -lt -1 -or $age -gt 30) { throw 'Backup evidence is stale or dated in the future.' }
  $item = Get-Item -LiteralPath $Evidence.backup_path -ErrorAction Stop
  if ($item.Length -lt 4096 -or $item.Length -ne $Evidence.size_bytes -or
      (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash -ne $Evidence.sha256) {
    throw 'Backup size or SHA-256 verification failed.'
  }
}

function Assert-BuildSource($Commit) {
  $current = (& git -C $root rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $current -ne $Commit) { throw 'Git HEAD changed during the runtime operation.' }
  & git -C $root diff --quiet HEAD -- . ':(exclude)skills/**' ':(exclude)AGENTS.md' ':(exclude).codex/**'
  if ($LASTEXITCODE -ne 0) { throw 'Tracked build inputs differ from the recorded commit. Save the scoped changes before rebuilding.' }
}

function Start-Native($Version) {
  $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmssfff')
  $stdout = Join-Path $LogDir "native-$stamp.out.log"
  $stderr = Join-Path $LogDir "native-$stamp.err.log"
  $previous = @{}
  $settings = @{ PORT = [string]$Port; SQL_DSN = 'local'; LOG_SQL_DSN = 'local'; SQLITE_PATH = $SqlitePath; VERSION = $Version }
  try {
    foreach ($key in $settings.Keys) {
      $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
      [Environment]::SetEnvironmentVariable($key, $settings[$key], 'Process')
    }
    $process = Start-Process -FilePath $exePath -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    return @{ process = $process; stdout = $stdout; stderr = $stderr }
  } finally {
    foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
  }
}

function Wait-Healthy($Process, $Version) {
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $Process.Refresh()
    if ($Process.HasExited) { throw 'Native application exited during startup; inspect its log.' }
    try {
      $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/status" -TimeoutSec 3
      $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
      if ($response.success -and $response.data.version -eq $Version -and $listeners.Count -gt 0 -and
          @($listeners | Where-Object { $_.OwningProcess -ne $Process.Id }).Count -eq 0) { return }
    } catch { }
    Start-Sleep -Milliseconds 1000
  }
  throw 'Native health/version/port-owner verification timed out.'
}

# Serialize local operations; this handle is released on every success or failure.
$operationHandle = [IO.File]::Open((Join-Path $runtime 'native-operation.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
$buildPath = Join-Path $runtime "build-$([guid]::NewGuid().ToString('N')).exe"
$started = $null
$switchAttempted = $false
$stopRequested = $false
$rollbackExe = $null
$oldVersion = $null
$oldRuntimePresent = $false
$oldBuildCommit = $null
try {
  $existing = Assert-Ownership
  $commit = (& git -C $root rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Git commit lookup failed.' }
  $version = "$(Get-Content -LiteralPath (Join-Path $root 'VERSION') -Raw)".Trim() + '-local.' + $commit.Substring(0, 12)
  $bun = Get-Command $BunPath -ErrorAction Stop
  $go = Get-Command go -ErrorAction Stop
  Assert-BuildSource $commit
  if ($existing -and (Get-Process -Id $existing.runtime_pid -ErrorAction SilentlyContinue)) {
    $null = Assert-LiveDatabase (Get-Process -Id $existing.runtime_pid -ErrorAction Stop)
    $oldVersion = (Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/status" -TimeoutSec 5).data.version
    $oldBuildCommit = Resolve-BuildCommit $oldVersion
    $oldRuntimePresent = $true
  }

  # Snapshot the exact live instance before any rebuild or runtime state change.
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'database-backup.ps1') -DatabaseMode sqlite -SqlitePath $SqlitePath -BackupRoot $BackupRoot -MetadataPath $MetadataPath
  if ($LASTEXITCODE -ne 0) { throw 'Database backup gate failed; existing runtime is preserved.' }
  $backup = Get-Content -LiteralPath $MetadataPath -Raw | ConvertFrom-Json
  Assert-Backup $backup

  Push-Location (Join-Path $root 'web')
  try {
    & $bun.Source run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed; existing runtime is preserved.' }
  } finally { Pop-Location }
  Push-Location $root
  try {
    & $go.Source build -ldflags "-X github.com/QuantumNous/new-api/common.Version=$version" -o $buildPath .
    if ($LASTEXITCODE -ne 0) { throw 'Backend build failed; existing runtime is preserved.' }
  } finally { Pop-Location }
  $html = Get-Content -LiteralPath (Join-Path $root 'web\dist\index.html') -Raw
  $asset = [regex]::Match($html, 'src="(/assets/index-[^"]+\.js)"').Groups[1].Value
  if (-not $asset) { throw 'Frontend entry asset identity is missing.' }
  $assetHash = (Get-FileHash -LiteralPath (Join-Path $root "web\dist$asset") -Algorithm SHA256).Hash.ToLowerInvariant()
  # Recheck ownership and freshness immediately before switching, after a long build.
  $null = Assert-Ownership
  if ($oldRuntimePresent) { $null = Assert-LiveDatabase (Get-Process -Id $existing.runtime_pid -ErrorAction Stop) }
  Assert-BuildSource $commit
  Assert-Backup $backup
  if (Test-Path -LiteralPath $exePath) {
    $rollbackExe = Join-Path $runtime ('rollback-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmssfff') + '.exe')
    Copy-Item -LiteralPath $exePath -Destination $rollbackExe
  }
  if ($existing) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($existing.runtime_pid)"
    if ($process -and $process.ExecutablePath -eq $exePath) {
      $stopRequested = $true
      Stop-NativeProcess (Get-Process -Id $existing.runtime_pid -ErrorAction Stop)
    }
  }
  if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw 'Port remains occupied; stopping the switch.' }
  $switchAttempted = $true
  Install-NativeExecutable $buildPath $exePath
  $started = Start-Native $version
  Wait-Healthy $started.process $version
  $databaseOwner = Assert-LiveDatabase $started.process
  $liveHtml = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/" -TimeoutSec 10).Content
  if (-not $liveHtml.Contains($asset)) { throw 'Running frontend differs from the freshly built frontend.' }
  $liveAsset = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port$asset" -Headers @{ 'Accept-Encoding' = 'identity' } -TimeoutSec 30
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { $liveAssetHash = [BitConverter]::ToString($hasher.ComputeHash($liveAsset.RawContentStream.ToArray())).Replace('-', '').ToLowerInvariant() }
  finally { $hasher.Dispose() }
  if ($liveAssetHash -ne $assetHash) { throw 'Served frontend SHA-256 differs from the built frontend.' }
  $lock = [ordered]@{
    runtime_mode = 'windows-native'; runtime_owner = $Owner; runtime_id = 'newapi-native'
    runtime_commit = $commit; runtime_build_commit = $commit; runtime_version = $version; runtime_ports = @($Port)
    runtime_pid = $started.process.Id; runtime_exe = $exePath
    runtime_process_started_filetime = $databaseOwner.process_started_filetime
    runtime_exe_sha256 = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash.ToLowerInvariant()
    frontend_asset = $asset; frontend_sha256 = $assetHash; served_frontend_sha256 = $liveAssetHash
    database_mode = 'sqlite'; database_engine = 'sqlite'; database_source = $SqlitePath; database_instance = $SqlitePath
    database_backup = $backup
    database_owner = $databaseOwner
    rollback = @{ method = 'Windows-native executable rollback; database restore is separate and requires stopping the app and preserving its current DB/WAL/SHM first'; executable = $rollbackExe; database = $backup.backup_path }
    logs = @{ stdout = $started.stdout; stderr = $started.stderr }
    acceptance_status = 'runtime-health-and-build-passed'; updated_at = [DateTime]::UtcNow.ToString('o')
  }
  Write-AtomicJson $lockPath $lock
  Write-Host "Windows-native runtime ready: PID $($started.process.Id), port $Port, version $version, database $SqlitePath"
} catch {
  $failure = $_
  if ($switchAttempted -or $stopRequested) {
    try {
      if ($started) {
        Stop-NativeProcess $started.process
      }
      $previousProcess = if ($existing) { Get-CimInstance Win32_Process -Filter "ProcessId=$($existing.runtime_pid)" }
      if ($previousProcess -and $previousProcess.ExecutablePath -eq $exePath) {
        Write-Warning 'Previous process is still running; its executable and runtime lock are preserved.'
      } elseif ($rollbackExe) {
        if (-not (Test-Path -LiteralPath $exePath) -or
            (Get-FileHash -LiteralPath $rollbackExe -Algorithm SHA256).Hash -ne
            (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash) {
          Install-NativeExecutable $rollbackExe $exePath
        }
        if ($oldRuntimePresent) {
          $restored = Start-Native $oldVersion
          $restoreHealthy = $false
          $restoredDatabase = $null
          try {
            Wait-Healthy $restored.process $oldVersion
            $restoredDatabase = Assert-LiveDatabase $restored.process
            $restoreHealthy = $true
          } finally {
            # Keep the new rollback PID/logs discoverable even if its health check fails.
            $existing | Add-Member -Force -NotePropertyMembers @{
              runtime_pid = $restored.process.Id
              runtime_commit = $oldBuildCommit
              runtime_build_commit = $oldBuildCommit
              runtime_version = $oldVersion
              runtime_process_started_filetime = $restored.process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()
              runtime_exe_sha256 = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash.ToLowerInvariant()
              logs = @{ stdout = $restored.stdout; stderr = $restored.stderr }
              database_backup = $backup
              database_owner = $restoredDatabase
              rollback = @{ method = 'Windows-native executable rollback; preserve DB/WAL/SHM before a separate database restore'; executable = $rollbackExe; database = $backup.backup_path }
              acceptance_status = if ($restoreHealthy) { 'previous-native-runtime-restored' } else { 'previous-native-runtime-health-failed' }
              updated_at = [DateTime]::UtcNow.ToString('o')
            }
            $existing.PSObject.Properties.Remove('compose_file')
            $existing.PSObject.Properties.Remove('accepted_at')
            $existing.PSObject.Properties.Remove('runtime_commit_note')
            Write-AtomicJson $lockPath $existing
          }
          Write-Warning 'New build failed acceptance; previous Windows-native executable is running again.'
        } else { Write-Warning 'Previous executable restored; the earlier idle runtime remains idle.' }
      } else { Write-Warning 'Startup failed without a previous executable; database backup and startup logs are preserved.' }
    } catch {
      Write-Warning "Automatic executable rollback failed: $($_.Exception.Message). Preserve database files and use the recorded native executable/database backup."
    }
  }
  throw $failure
} finally {
  if (Test-Path -LiteralPath $buildPath) { Remove-Item -LiteralPath $buildPath -Force }
  $operationHandle.Dispose()
}
