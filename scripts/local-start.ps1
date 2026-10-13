[CmdletBinding()]
param(
  [string]$ComposeFile = '',
  [string]$ProjectName = 'newapi-dev',
  [string]$Owner = $env:CODEX_SESSION_ID,
  [string]$BackupRoot = ''
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

function Test-SqliteFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  $item = Get-Item -LiteralPath $Path
  if ($item.Length -lt 4096) { return $false }
  $stream = [System.IO.File]::OpenRead($Path)
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
  $candidates = @()
  foreach ($candidateRoot in ($roots | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $candidateRoot -PathType Container)) { continue }
    $candidates += Get-ChildItem -LiteralPath $candidateRoot -File -Filter '*.db' -Recurse -ErrorAction SilentlyContinue
  }
  # Root-level SQLite snapshots are also accepted, but never use the acceptance fixture.
  $candidates += Get-ChildItem -LiteralPath $root -File -Filter '*.db' -ErrorAction SilentlyContinue
  $valid = $candidates |
    Where-Object { $_.Name -notlike '*acceptance*' -and (Test-SqliteFile $_.FullName) } |
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

function Initialize-LocalDatabase {
  $dataDir = Join-Path $root 'data'
  $target = Join-Path $dataDir 'one-api.db'
  New-Item -ItemType Directory -Force $dataDir | Out-Null
  if (Test-SqliteFile $target) {
    $env:NEW_API_SQL_DSN = 'local'
    return [ordered]@{ mode = 'sqlite'; source = $target; restored = $false }
  }
  if (Test-Path -LiteralPath $target -PathType Leaf) {
    $size = (Get-Item -LiteralPath $target).Length
    if ($size -gt 0) { throw "Local SQLite database exists but is not valid; refusing to overwrite: $target" }
  }
  if (Test-MySqlHasApplicationData) {
    Remove-Item Env:NEW_API_SQL_DSN -ErrorAction SilentlyContinue
    return [ordered]@{ mode = 'mysql'; source = 'new-api-local-dev'; restored = $false }
  }
  $backup = Get-LatestSqliteBackup
  if (-not $backup) {
    throw 'No valid SQLite backup was found and the local MySQL database is empty. Refusing to start a fresh database.'
  }
  Write-Host "Restoring latest valid local backup: $($backup.FullName)"
  Copy-Item -LiteralPath $backup.FullName -Destination $target -Force
  if (-not (Test-SqliteFile $target)) { throw "Restored SQLite backup failed validation: $target" }
  $env:NEW_API_SQL_DSN = 'local'
  return [ordered]@{ mode = 'sqlite'; source = $backup.FullName; restored = $true }
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

Assert-RuntimeOwnership

$listener = Get-NetTCPConnection -State Listen -LocalPort 5200 -ErrorAction SilentlyContinue
if ($listener) {
  $ownerProcess = Get-Process -Id $listener[0].OwningProcess -ErrorAction SilentlyContinue
  throw "Port 5200 is occupied by an unowned process PID $($listener[0].OwningProcess) ($($ownerProcess.ProcessName))."
}

$database = Initialize-LocalDatabase
$env:GIT_COMMIT = $commit
Invoke-DockerCompose @('config','-q')
Invoke-DockerCompose @('up','-d','--build','--force-recreate')
& (Join-Path $PSScriptRoot 'local-check.ps1') -ComposeFile $ComposeFile -ProjectName $ProjectName -ExpectedCommit $commit -Owner $Owner
if ($LASTEXITCODE -ne 0) { throw 'Local Docker acceptance failed.' }

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
  updated_at = (Get-Date).ToUniversalTime().ToString('o')
}
$lock | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $lockPath -Encoding UTF8
Write-Host "Docker runtime ready: $ProjectName @ $commit (version $version, database $($database.mode))"
