[CmdletBinding()]
param(
  [string]$ComposeFile = '',
  [string]$ProjectName = 'newapi-dev',
  [string]$Owner = $env:CODEX_SESSION_ID,
  [string]$BackupRoot = '',
  [switch]$AllowUnavailableReleaseService
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($ComposeFile)) { $ComposeFile = Join-Path $root 'docker-compose.dev.yml' }
if ([string]::IsNullOrWhiteSpace($Owner)) { $Owner = 'local-runtime-owner' }
$runtime = Join-Path $root '.git\new-api-dev'
$lockPath = Join-Path $runtime 'runtime-lock.json'
$lockTtlMinutes = 30
$versionFile = Join-Path $root 'VERSION'
$version = (Get-Content -LiteralPath $versionFile -Raw -ErrorAction Stop).Trim()
if ([string]::IsNullOrWhiteSpace($version)) { throw "VERSION is empty: $versionFile" }
$versionSlug = ($version -replace '[^A-Za-z0-9_.-]', '-')
if ([string]::IsNullOrWhiteSpace($versionSlug)) { throw "VERSION is not usable in a Docker name: $version" }
$env:NEW_API_VERSION = $versionSlug
New-Item -ItemType Directory -Force $runtime | Out-Null
if (-not (Test-Path $ComposeFile)) { throw "Compose file not found: $ComposeFile" }

function Invoke-DockerCompose {
  param([string[]]$Arguments)
  & docker compose -p $ProjectName -f $ComposeFile @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed with exit code $LASTEXITCODE" }
}

function Read-RuntimeLock {
  if (-not (Test-Path -LiteralPath $lockPath)) { return $null }
  try { return Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json }
  catch { throw "Runtime lock is not valid JSON: $lockPath" }
}

function Get-ProjectNativeProcesses {
  $rootPattern = [regex]::Escape($root)
  $processes = @(Get-CimInstance Win32_Process)
  $matched = @($processes | Where-Object {
    $name = $_.Name.ToLowerInvariant()
    $cmd = [string]$_.CommandLine
    $exe = [string]$_.ExecutablePath
    if ($name -eq 'new-api.exe') {
      return ($exe -and $exe.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) -or
        ($cmd -match $rootPattern)
    }
    if ($name -eq 'go.exe') { return ($cmd -match $rootPattern -and $cmd -match '(?i)(go\s+run|main\.go|new-api)') }
    if ($name -in @('bun.exe','node.exe')) { return ($cmd -match $rootPattern) }
    return $false
  })
  # `go run` child binaries do not include the checkout path in their command line.
  # Attribute the process tree only when the listener, launcher, and project DSN
  # agree on this checkout's documented local runtime.
  $listenerPids = @(Get-NetTCPConnection -State Listen -LocalPort 5200 -ErrorAction SilentlyContinue | ForEach-Object OwningProcess)
  foreach ($listenerPid in $listenerPids) {
    $tree = @()
    $currentPid = [int]$listenerPid
    while ($currentPid -gt 0) {
      $node = $processes | Where-Object ProcessId -eq $currentPid | Select-Object -First 1
      if (-not $node) { break }
      $tree += $node
      if ([int]$node.ParentProcessId -eq $currentPid) { break }
      $currentPid = [int]$node.ParentProcessId
    }
    $treeText = ($tree | ForEach-Object { [string]$_.CommandLine }) -join "`n"
    if ($treeText -match '(?i)go\s+run\s+main\.go.*--port\s+5200' -and
        $treeText -match '(?i)new-api-local-dev|NODE_NAME.{0,10}new-api') {
      $matched += @($tree | Where-Object { $_.Name.ToLowerInvariant() -in @('main.exe','go.exe','powershell.exe','pwsh.exe') })
    }
  }
  return @($matched | Sort-Object ProcessId -Unique)
}

function Test-ProjectComposeActive {
  $rows = & docker compose -p $ProjectName -f $ComposeFile ps -q --status running new-api 2>$null
  return ($LASTEXITCODE -eq 0 -and @($rows).Count -gt 0)
}

function Test-ProjectPortPublished {
  param([int]$Port)
  $containerId = (& docker compose -p $ProjectName -f $ComposeFile ps -q --status running new-api 2>$null | Select-Object -First 1).ToString().Trim()
  if ([string]::IsNullOrWhiteSpace($containerId)) { return $false }
  $inspect = & docker inspect $containerId 2>$null | ConvertFrom-Json
  if (-not $inspect) { return $false }
  $bindings = $inspect[0].NetworkSettings.Ports."$Port/tcp"
  return (@($bindings).Count -gt 0)
}

function Test-SqliteFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  $item = Get-Item -LiteralPath $Path
  if ($item.Length -lt 4096) { return $false }
  $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
  try {
    $buffer = New-Object byte[] 16
    $read = $stream.Read($buffer, 0, $buffer.Length)
    $header = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $read)
    if ($header -ne ("SQLite format 3" + [char]0)) { return $false }
  } finally { $stream.Dispose() }
  $sqlite3 = Get-Command sqlite3 -ErrorAction SilentlyContinue
  if ($sqlite3) {
    $check = & $sqlite3.Source $Path 'PRAGMA integrity_check;' 2>$null
    return (($check | Select-Object -First 1).ToString().Trim() -eq 'ok')
  }
  return $true
}

function Get-LatestSqliteBackup {
  $roots = @()
  if (-not [string]::IsNullOrWhiteSpace($BackupRoot)) { $roots += (Resolve-Path -LiteralPath $BackupRoot -ErrorAction Stop).Path }
  $roots += (Join-Path $root 'formal-backups')
  $roots += (Join-Path $root 'backups')
  $target = [System.IO.Path]::GetFullPath((Join-Path $root 'data\one-api.db'))
  $runtimeBackupRoot = [System.IO.Path]::GetFullPath((Join-Path $root 'data\runtime-backups'))
  $candidates = @()
  foreach ($candidateRoot in ($roots | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $candidateRoot -PathType Container)) { continue }
    foreach ($pattern in @('*.db', '*.sqlite', '*.sqlite3')) {
      $candidates += Get-ChildItem -LiteralPath $candidateRoot -File -Filter $pattern -Recurse -ErrorAction SilentlyContinue
    }
  }
  # Root-level SQLite snapshots are also accepted, but never use the active data file,
  # runtime-preservation copies, or the acceptance fixture.
  foreach ($pattern in @('*.db', '*.sqlite', '*.sqlite3')) {
    $candidates += Get-ChildItem -LiteralPath $root -File -Filter $pattern -ErrorAction SilentlyContinue
  }
  $valid = $candidates |
    Sort-Object FullName -Unique |
    Where-Object {
      $candidatePath = [System.IO.Path]::GetFullPath($_.FullName)
      $candidatePath -ne $target -and
        -not $candidatePath.StartsWith($runtimeBackupRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase) -and
        $_.Name -notlike '*acceptance*' -and
        (Test-SqliteFile $_.FullName)
    } |
    Sort-Object LastWriteTimeUtc -Descending
  return $valid | Select-Object -First 1
}

function Test-MySqlHasApplicationData {
  $containerId = (& docker compose -p $ProjectName -f $ComposeFile ps -q mysql 2>$null).Trim()
  if ([string]::IsNullOrWhiteSpace($containerId)) { return $false }
  $tables = @(& docker exec -e MYSQL_PWD=123456 $containerId mysql -uroot -N -B -e "SELECT table_name FROM information_schema.tables WHERE table_schema = 'new-api-local-dev';" 2>$null)
  if ($LASTEXITCODE -ne 0) { return $false }
  foreach ($table in @('users', 'channels', 'options', 'setups')) {
    if ($tables -notcontains $table) { continue }
    $query = "SELECT COUNT(*) FROM ``new-api-local-dev``.``$table``;"
    $count = & docker exec -e MYSQL_PWD=123456 $containerId mysql -uroot -N -B -e $query 2>$null
    if ($LASTEXITCODE -ne 0) { continue }
    $parsed = 0
    if ([int]::TryParse(($count | Select-Object -First 1).ToString().Trim(), [ref]$parsed) -and $parsed -gt 0) { return $true }
  }
  return $false
}

function Stop-ApplicationForDatabaseSwitch {
  if (-not (Test-ProjectComposeActive)) { return }
  Write-Host "Stopping application container before switching the SQLite database."
  Invoke-DockerCompose @('stop', 'new-api')
  Start-Sleep -Milliseconds 750
  if (Test-ProjectComposeActive) { throw 'Application container is still running after database switch stop attempt.' }
}

function Preserve-CurrentDatabase {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  $preserveDir = Join-Path $root 'data\runtime-backups'
  New-Item -ItemType Directory -Force $preserveDir | Out-Null
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmssfff')
  $destination = Join-Path $preserveDir "one-api.db.before-restore-$stamp.db"
  Copy-Item -LiteralPath $Path -Destination $destination -Force
  if (-not (Test-Path -LiteralPath $destination -PathType Leaf)) { throw "Failed to preserve current database: $destination" }
  return $destination
}

function Resolve-LocalDatabasePlan {
  # Decide which database the local runtime will actually use WITHOUT changing
  # any state.  The backup gate uses this decision so the recorded backup
  # engine/instance always matches the database the application will run on.
  $dataDir = Join-Path $root 'data'
  $target = Join-Path $dataDir 'one-api.db'
  $backup = Get-LatestSqliteBackup
  $targetExists = Test-Path -LiteralPath $target -PathType Leaf
  $targetItem = if ($targetExists) { Get-Item -LiteralPath $target } else { $null }
  $targetValid = Test-SqliteFile $target
  $comparison = [ordered]@{
    current_path = $target
    current_exists = $targetExists
    current_valid = $targetValid
    current_last_write_utc = if ($targetItem) { $targetItem.LastWriteTimeUtc.ToString('o') } else { $null }
    latest_backup_path = if ($backup) { $backup.FullName } else { $null }
    latest_backup_last_write_utc = if ($backup) { $backup.LastWriteTimeUtc.ToString('o') } else { $null }
    decision = $null
  }

  $backupIsNewer = $false
  if ($backup -and $targetItem) { $backupIsNewer = $backup.LastWriteTimeUtc -gt $targetItem.LastWriteTimeUtc }
  $comparison.backup_newer = $backupIsNewer
  $shouldRestore = $backup -and (-not $targetValid -or -not $targetItem -or $backupIsNewer)

  if ($shouldRestore) {
    return [ordered]@{
      mode = 'sqlite'
      restore = $true
      target = $target
      snapshot = $backup
      target_exists = $targetExists
      target_valid = $targetValid
      instance = [System.IO.Path]::GetFullPath($target)
      comparison = $comparison
    }
  }

  if ($targetValid) {
    return [ordered]@{
      mode = 'sqlite'
      restore = $false
      target = $target
      snapshot = $null
      target_exists = $targetExists
      target_valid = $targetValid
      instance = [System.IO.Path]::GetFullPath($target)
      comparison = $comparison
    }
  }

  if ($targetExists) {
    $size = (Get-Item -LiteralPath $target).Length
    if ($size -gt 0) { throw "Local SQLite database exists but is not valid, and no usable newer backup is available: $target" }
  }
  if (Test-MySqlHasApplicationData) {
    return [ordered]@{
      mode = 'mysql'
      restore = $false
      target = $target
      snapshot = $null
      target_exists = $targetExists
      target_valid = $targetValid
      comparison = $comparison
    }
  }
  throw 'No valid SQLite backup was found and the local MySQL database is empty. Refusing to start a fresh database.'
}

function Apply-LocalDatabasePlan {
  param([Parameter(Mandatory = $true)]$Plan)
  $dataDir = Join-Path $root 'data'
  New-Item -ItemType Directory -Force $dataDir | Out-Null
  $comparison = $Plan.comparison

  if ($Plan.mode -eq 'mysql') {
    Remove-Item Env:NEW_API_SQL_DSN -ErrorAction SilentlyContinue
    $comparison.decision = 'use-existing-mysql'
    return [ordered]@{
      mode = 'mysql'
      source = 'new-api-local-dev'
      restored = $false
      preserved = $null
      comparison = $comparison
    }
  }

  if ($Plan.restore) {
    $preserved = $null
    if ($Plan.target_exists) {
      Stop-ApplicationForDatabaseSwitch
      $preserved = Preserve-CurrentDatabase -Path $Plan.target
    }
    Write-Host "Restoring latest valid local backup: $($Plan.snapshot.FullName)"
    Copy-Item -LiteralPath $Plan.snapshot.FullName -Destination $Plan.target -Force
    if (-not (Test-SqliteFile $Plan.target)) { throw "Restored SQLite backup failed validation: $Plan.target" }
    $env:NEW_API_SQL_DSN = 'local'
    $comparison.decision = if ($Plan.target_valid) { 'restore-newer-backup' } else { 'restore-available-backup' }
    return [ordered]@{
      mode = 'sqlite'
      source = $Plan.snapshot.FullName
      restored = $true
      preserved = $preserved
      comparison = $comparison
    }
  }

  $env:NEW_API_SQL_DSN = 'local'
  $comparison.decision = if ($Plan.snapshot) { 'keep-current-database' } else { 'keep-current-database-no-backup' }
  return [ordered]@{
    mode = 'sqlite'
    source = $Plan.target
    restored = $false
    preserved = $null
    comparison = $comparison
  }
}

function Assert-RuntimeOwnership {
  $existing = Read-RuntimeLock
  $native = @(Get-ProjectNativeProcesses)
  $composeActive = Test-ProjectComposeActive
  if (-not $existing -and $composeActive) {
    throw "Compose project '$ProjectName' is already active but has no runtime lock; inspect ownership before changing it."
  }
  if ($existing) {
    $sameOwner = ([string]$existing.runtime_owner -eq $Owner)
    $updated = $null
    try { $updated = [DateTime]::Parse([string]$existing.updated_at).ToUniversalTime() } catch {}
    $stale = (-not $updated) -or ((Get-Date).ToUniversalTime() - $updated).TotalMinutes -gt $lockTtlMinutes
    if (-not $sameOwner -and ($composeActive -or $native.Count -gt 0)) {
      throw "Runtime is owned by '$($existing.runtime_owner)' (mode=$($existing.runtime_mode), commit=$($existing.runtime_commit)); inspect before taking over."
    }
    if (-not $sameOwner -and -not $stale) {
      throw "Runtime lock is held by '$($existing.runtime_owner)' and is not stale yet."
    }
    if (-not $sameOwner -and $stale) {
      Write-Warning "Taking over stale runtime lock from '$($existing.runtime_owner)' ($($existing.updated_at))."
    }
  }
  if ($native.Count -gt 0) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort 5200 -ErrorAction SilentlyContinue
    $ownedIds = @($native | ForEach-Object ProcessId)
    foreach ($p in $native | Sort-Object ProcessId -Descending) {
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 750
    $remaining = @(Get-ProjectNativeProcesses)
    if ($remaining.Count -gt 0) { throw 'Project native process group still exists after stop attempt.' }
    if ($listener -and (Get-NetTCPConnection -State Listen -LocalPort 5200 -ErrorAction SilentlyContinue)) {
      throw "Port 5200 remains occupied after stopping owned native PIDs $($ownedIds -join ',')."
    }
  }
  if ($composeActive -and $existing -and ([string]$existing.runtime_owner -eq $Owner)) {
    return
  }
}

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker daemon is not available.' }
$commit = (& git -C $root rev-parse HEAD).Trim()
if ([string]::IsNullOrWhiteSpace($commit)) { throw 'Unable to resolve current Git commit.' }

# A database backup is a hard gate for every local runtime transition.  Resolve
# the database the runtime will actually use FIRST, then back up that exact
# engine/instance, so the recorded evidence can never describe a different
# database than the one the application runs on.  If the gate cannot produce a
# validated backup, do not stop processes or recreate containers.
$databasePlan = Resolve-LocalDatabasePlan
$backupMetadataPath = Join-Path $runtime 'database-backup-latest.json'
$backupScript = Join-Path $PSScriptRoot 'database-backup.ps1'
if (-not (Test-Path -LiteralPath $backupScript -PathType Leaf)) { throw "Database backup script not found: $backupScript" }
$backupArgs = @(
  '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $backupScript,
  '-ComposeFile', $ComposeFile,
  '-ProjectName', $ProjectName,
  '-MetadataPath', $backupMetadataPath,
  '-DatabaseMode', $databasePlan.mode
)
if ($databasePlan.mode -eq 'sqlite') {
  # When a snapshot is about to be restored, back up that snapshot because it
  # is the database the runtime will use; otherwise back up the live file.
  $sqliteBackupSource = if ($databasePlan.restore -and $databasePlan.snapshot) { $databasePlan.snapshot.FullName } else { $databasePlan.target }
  $backupArgs += @('-SqlitePath', $sqliteBackupSource)
}
Write-Host "Creating a validated $($databasePlan.mode) database backup before changing local runtime state."
& powershell.exe @backupArgs
if ($LASTEXITCODE -ne 0) { throw "Database backup gate failed with exit code $LASTEXITCODE. Runtime state was not changed." }
if (-not (Test-Path -LiteralPath $backupMetadataPath -PathType Leaf)) { throw "Database backup metadata was not created: $backupMetadataPath" }
$databaseBackup = Get-Content -LiteralPath $backupMetadataPath -Raw | ConvertFrom-Json
if ($databaseBackup.validation.status -ne 'passed' -or [string]::IsNullOrWhiteSpace([string]$databaseBackup.sha256) -or -not (Test-Path -LiteralPath ([string]$databaseBackup.backup_path) -PathType Leaf)) {
  throw "Database backup metadata failed validation: $backupMetadataPath"
}
$backupEngine = ([string]$databaseBackup.mode).Trim().ToLowerInvariant()
if ($backupEngine -ne $databasePlan.mode.ToLowerInvariant()) {
  throw "Database backup evidence engine '$backupEngine' does not match the runtime database engine '$($databasePlan.mode)'."
}
$backupItem = Get-Item -LiteralPath ([string]$databaseBackup.backup_path) -ErrorAction Stop
$backupHash = (Get-FileHash -LiteralPath $backupItem.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
if ($backupHash -ne ([string]$databaseBackup.sha256).ToLowerInvariant()) {
  throw "Database backup SHA-256 mismatch: $($backupItem.FullName)"
}
if ([int64]$backupItem.Length -ne [int64]$databaseBackup.size_bytes) {
  throw "Database backup size mismatch: $($backupItem.FullName)"
}

Assert-RuntimeOwnership

$listener = Get-NetTCPConnection -State Listen -LocalPort 5200 -ErrorAction SilentlyContinue
if ($listener -and -not (Test-ProjectPortPublished -Port 5200)) {
  $ownerProcess = Get-Process -Id $listener[0].OwningProcess -ErrorAction SilentlyContinue
  throw "Port 5200 is occupied by an unowned process PID $($listener[0].OwningProcess) ($($ownerProcess.ProcessName))."
}

$database = Apply-LocalDatabasePlan -Plan $databasePlan
if ($database.mode -ne $backupEngine) {
  throw "Runtime database engine '$($database.mode)' no longer matches the validated backup engine '$backupEngine'."
}
# The instance identity must survive `up --force-recreate`, which replaces the
# container id, so a server-backed engine is identified by its stable Compose
# project/service rather than a transient container id.
$databaseInstance = if ($database.mode -eq 'sqlite') {
  [string]$databasePlan.instance
} else {
  "$ProjectName/$($database.mode)"
}
$env:GIT_COMMIT = $commit
Invoke-DockerCompose @('config','-q')
Invoke-DockerCompose @('up','-d','--build','--force-recreate')
$lock = [ordered]@{
  runtime_mode = 'docker'
  runtime_owner = $Owner
  runtime_id = $ProjectName
  runtime_commit = $commit
  runtime_version = $version
  runtime_ports = @(5200,13306,16379,19000,19001)
  compose_file = $ComposeFile
  database_mode = $database.mode
  database_source = $database.source
  database_restored = $database.restored
  database_preserved = $database.preserved
  database_comparison = $database.comparison
  database_backup = [ordered]@{
    metadata_path = [System.IO.Path]::GetFullPath($backupMetadataPath)
    backup_path = [System.IO.Path]::GetFullPath([string]$databaseBackup.backup_path)
    engine = [string]$database.mode
    instance = $databaseInstance
    database_name = [string]$databaseBackup.database_name
    source = [string]$databaseBackup.source
    mode = [string]$database.mode
    verified = $true
    sha256 = $backupHash
    size_bytes = [int64]$backupItem.Length
    created_at_utc = [string]$databaseBackup.created_at_utc
    validation = $databaseBackup.validation
    rollback_path = [string]$databaseBackup.rollback_path
    restore_method = [string]$databaseBackup.restore_method
  }
  acceptance_status = 'pending'
  updated_at = (Get-Date).ToUniversalTime().ToString('o')
}
$lock | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $lockPath -Encoding UTF8
& (Join-Path $PSScriptRoot 'local-check.ps1') -ComposeFile $ComposeFile -ProjectName $ProjectName -ExpectedCommit $commit -Owner $Owner -AllowUnavailableReleaseService:$AllowUnavailableReleaseService
if ($LASTEXITCODE -ne 0) { throw 'Local Docker acceptance failed.' }
$lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
$lock | Add-Member -NotePropertyName acceptance_status -NotePropertyValue 'passed' -Force
$lock | Add-Member -NotePropertyName accepted_at -NotePropertyValue ((Get-Date).ToUniversalTime().ToString('o')) -Force
$lock | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $lockPath -Encoding UTF8
Write-Host "Docker runtime ready: $ProjectName @ $commit (version $version, database $($database.mode))"
