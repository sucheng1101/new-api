[CmdletBinding()]
param(
  [string]$ComposeFile = '',
  [string]$ProjectName = 'newapi-dev',
  [int]$Port = 5200,
  [int]$WaitSeconds = 60,
  [string]$ExpectedCommit = '',
  [string]$Owner = '',
  [switch]$AllowUnavailableReleaseService
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($ComposeFile)) { $ComposeFile = Join-Path $root 'docker-compose.dev.yml' }
$version = (Get-Content -LiteralPath (Join-Path $root 'VERSION') -Raw -ErrorAction Stop).Trim()
$versionSlug = ($version -replace '[^A-Za-z0-9_.-]', '-')
$env:NEW_API_VERSION = $versionSlug
function Invoke-DockerComposeText {
  param([string[]]$Arguments)
  $output = & docker compose -p $ProjectName -f $ComposeFile @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw (($output | Out-String).Trim()) }
  return $output
}

function Resolve-ProjectPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  if ([System.IO.Path]::IsPathRooted($Path)) {
    return [System.IO.Path]::GetFullPath($Path)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $root $Path))
}

function Get-DatabaseEngineFromDsn {
  param([string]$Dsn)
  if ([string]::IsNullOrWhiteSpace($Dsn)) { return $null }
  if ($Dsn -match '(?i)(tcp\([^)]*mysql|mysql://|@mysql[:/]|@tcp\(|@unix\()') { return 'mysql' }
  if ($Dsn -match '(?i)(postgres(?:ql)?://|@postgres(?:ql)?[:/]|host=postgres)') { return 'postgresql' }
  if ($Dsn -match '(?i)^(local|sqlite|file:|.*\.db(?:\?|$))') { return 'sqlite' }
  return 'unknown'
}

function Get-DatabaseNameFromDsn {
  param([string]$Dsn, [string]$Engine)
  if ([string]::IsNullOrWhiteSpace($Dsn) -or $Engine -notin @('mysql', 'postgresql')) { return $null }
  if ($Dsn -match '(?i)/([^/?]+)(?:\?|$)') { return $matches[1] }
  return $null
}

function Get-ContainerSqlDsn {
  param([object]$Inspect)
  foreach ($entry in @($Inspect[0].Config.Env)) {
    if ([string]$entry -like 'SQL_DSN=*') { return ([string]$entry).Substring('SQL_DSN='.Length) }
  }
  return $null
}

function Assert-DatabaseBackupEvidence {
  # The runtime lock is written by local-start only after a database backup has
  # completed.  Acceptance must verify the evidence rather than trusting the
  # running container, so a direct compose rebuild cannot silently skip it.
  $lockPath = Join-Path $root '.git\new-api-dev\runtime-lock.json'
  if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) {
    throw "Runtime lock is missing database-backup evidence: $lockPath"
  }
  try {
    $lock = Get-Content -LiteralPath $lockPath -Raw -ErrorAction Stop | ConvertFrom-Json
  } catch {
    throw "Runtime lock is not valid JSON: $lockPath"
  }
  if (-not $lock.database_backup) {
    throw "Runtime lock has no database_backup record; run local-start.ps1 before acceptance."
  }
  $evidence = $lock.database_backup
  $metadataPathValue = [string]$evidence.metadata_path
  $backupPathValue = [string]$evidence.backup_path
  if ([string]::IsNullOrWhiteSpace($metadataPathValue) -or [string]::IsNullOrWhiteSpace($backupPathValue)) {
    throw 'Runtime lock database_backup must include metadata_path and backup_path.'
  }
  $metadataPath = Resolve-ProjectPath $metadataPathValue
  $backupPath = Resolve-ProjectPath $backupPathValue
  if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) {
    throw "Database backup metadata is missing: $metadataPath"
  }
  if (-not (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
    throw "Database backup file is missing: $backupPath"
  }
  try {
    $metadata = Get-Content -LiteralPath $metadataPath -Raw -ErrorAction Stop | ConvertFrom-Json
  } catch {
    throw "Database backup metadata is not valid JSON: $metadataPath"
  }
  $metadataBackupPath = [string]$metadata.backup_path
  if (-not [string]::IsNullOrWhiteSpace($metadataBackupPath) -and
      (Resolve-ProjectPath $metadataBackupPath) -ne $backupPath) {
    throw 'Database backup metadata path does not match runtime lock evidence.'
  }
  $expectedHash = ([string]$evidence.sha256).Trim().ToLowerInvariant()
  if ($expectedHash -notmatch '^[0-9a-f]{64}$') {
    throw 'Runtime lock database_backup must contain a SHA-256 hash.'
  }
  $actualHash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $expectedHash) {
    throw "Database backup SHA-256 mismatch: $backupPath"
  }
  $metadataHash = ([string]$metadata.sha256).Trim().ToLowerInvariant()
  if ($metadataHash -and $metadataHash -ne $actualHash) {
    throw 'Database backup metadata SHA-256 does not match the backup file.'
  }
  $expectedSizeText = ([string]$evidence.size_bytes).Trim()
  [long]$expectedSize = 0
  if (-not [long]::TryParse($expectedSizeText, [ref]$expectedSize) -or $expectedSize -le 0) {
    throw 'Runtime lock database_backup must contain a positive size_bytes value.'
  }
  $actualSize = (Get-Item -LiteralPath $backupPath).Length
  if ($actualSize -ne $expectedSize) {
    throw "Database backup size mismatch: expected $expectedSize bytes, found $actualSize bytes."
  }
  if ($metadata.size_bytes -and [int64]$metadata.size_bytes -ne $actualSize) {
    throw 'Database backup metadata size_bytes does not match the backup file.'
  }
  $validation = $metadata.validation
  if (-not $validation -or ([string]$validation.status).ToLowerInvariant() -ne 'passed') {
    throw 'Database backup validation status is not passed.'
  }
  $engineValue = if (-not [string]::IsNullOrWhiteSpace([string]$evidence.engine)) { [string]$evidence.engine } else { [string]$evidence.mode }
  if ([string]::IsNullOrWhiteSpace($engineValue)) {
    throw 'Runtime lock database_backup must identify the database engine.'
  }
  $engineValue = $engineValue.ToLowerInvariant()
  if ($metadata.mode -and ([string]$metadata.mode).ToLowerInvariant() -ne $engineValue) {
    throw 'Database backup mode does not match runtime lock evidence.'
  }
  $instanceValue = [string]$evidence.instance
  if ([string]::IsNullOrWhiteSpace($instanceValue)) {
    $instanceValue = if ($engineValue -eq 'sqlite') { [string]$metadata.source } else { [string]$metadata.container_id }
  }
  if ([string]::IsNullOrWhiteSpace($instanceValue)) {
    throw 'Runtime lock database_backup must identify the database instance.'
  }
  $databaseNameValue = [string]$evidence.database_name
  if ([string]::IsNullOrWhiteSpace($databaseNameValue) -and $metadata.database_name) {
    $databaseNameValue = [string]$metadata.database_name
  }
  $evidenceSource = [string]$evidence.source
  $metadataSource = [string]$metadata.source
  if (-not [string]::IsNullOrWhiteSpace($evidenceSource) -and
      -not [string]::IsNullOrWhiteSpace($metadataSource) -and
      $evidenceSource -ne $metadataSource) {
    throw 'Database backup source does not match runtime lock evidence.'
  }
  return [ordered]@{
    metadata_path = $metadataPath
    backup_path = $backupPath
    mode = $engineValue
    engine = $engineValue
    instance = $instanceValue
    database_name = $databaseNameValue
    source = $metadataSource
    sha256 = $actualHash
    size_bytes = $actualSize
    validation_status = [string]$validation.status
  }
}

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker daemon is not available.' }

$databaseBackup = Assert-DatabaseBackupEvidence

$deadline = (Get-Date).AddSeconds($WaitSeconds)
$status = $null
do {
  try { $status = Invoke-RestMethod "http://127.0.0.1:$Port/api/status" -TimeoutSec 3; break }
  catch { Start-Sleep -Milliseconds 1000 }
} while ((Get-Date) -lt $deadline)
if (-not $status -or -not $status.success) { throw "Backend health check failed at http://127.0.0.1:$Port/api/status" }
$release = Invoke-RestMethod "http://127.0.0.1:$Port/api/status/latest-release" -TimeoutSec 10
$releaseCheck = 'passed'
if (-not $release.success) {
  if ($AllowUnavailableReleaseService -and $release.message -match '(?i)temporarily unavailable|rate-limited') {
    $releaseCheck = 'unavailable-allowed'
    Write-Warning "Release service check is unavailable or rate-limited; continuing because AllowUnavailableReleaseService was supplied."
  } else {
    throw "Release check failed: $($release.message)"
  }
}
$page = Invoke-WebRequest "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 10
if ($page.StatusCode -ne 200) { throw "Frontend check failed with HTTP $($page.StatusCode)" }

$ps = Invoke-DockerComposeText @('ps','--all')
$containerId = (Invoke-DockerComposeText @('ps','-q','new-api') | Select-Object -First 1).ToString().Trim()
if ([string]::IsNullOrWhiteSpace($containerId)) { throw 'Application container is not present in the Compose project.' }
$inspect = & docker inspect $containerId | ConvertFrom-Json
if (-not $inspect) { throw 'Unable to inspect application container.' }
$labels = $inspect[0].Config.Labels
$containerName = [string]$inspect[0].Name
if ($containerName -notmatch "new-api-$([regex]::Escape($versionSlug))-app$") { throw "Application container name does not include VERSION ${versionSlug}: $containerName" }
if ($labels.'com.newapi.runtime.mode' -ne 'docker') { throw 'Application container runtime label is missing.' }
if ($ExpectedCommit -and $labels.'com.newapi.runtime.commit' -ne $ExpectedCommit) { throw "Container commit label does not match workspace commit $ExpectedCommit." }
if ($labels.'com.newapi.runtime.version' -ne $versionSlug) { throw "Container version label does not match VERSION ${versionSlug}." }

# The backup evidence must describe the database the running application
# actually uses; a direct compose rebuild or a prior engine switch must not be
# able to leave acceptance pointing at a different engine or instance.
$runtimeDsn = Get-ContainerSqlDsn -Inspect $inspect
$runtimeEngine = Get-DatabaseEngineFromDsn -Dsn $runtimeDsn
if ([string]::IsNullOrWhiteSpace($runtimeEngine) -or $runtimeEngine -eq 'unknown') {
  throw 'Unable to determine the running application database engine from the container SQL_DSN.'
}
if ($runtimeEngine -ne ([string]$databaseBackup.engine).ToLowerInvariant()) {
  throw "Database backup evidence engine '$($databaseBackup.engine)' does not match the running database engine '$runtimeEngine'."
}
$runtimeLockPath = Join-Path $root '.git\new-api-dev\runtime-lock.json'
$runtimeLock = Get-Content -LiteralPath $runtimeLockPath -Raw | ConvertFrom-Json
if (-not [string]::IsNullOrWhiteSpace([string]$runtimeLock.database_mode) -and
    ([string]$runtimeLock.database_mode).ToLowerInvariant() -ne $runtimeEngine) {
  throw "Runtime lock database_mode '$($runtimeLock.database_mode)' does not match the running database engine '$runtimeEngine'."
}
$lockDatabaseSource = [string]$runtimeLock.database_source
if ([string]::IsNullOrWhiteSpace($lockDatabaseSource)) {
  throw 'Runtime lock must record database_source.'
}
if (-not [string]::IsNullOrWhiteSpace([string]$databaseBackup.source)) {
  if ($runtimeEngine -eq 'sqlite') {
    $lockSourcePath = Resolve-ProjectPath $lockDatabaseSource
    $evidenceSourcePath = Resolve-ProjectPath ([string]$databaseBackup.source)
    if ($lockSourcePath -ne $evidenceSourcePath) {
      throw "Runtime lock database_source '$lockSourcePath' does not match the database backup source '$evidenceSourcePath'."
    }
  } elseif ($databaseBackup.database_name -and
      $lockDatabaseSource.ToLowerInvariant() -ne ([string]$databaseBackup.database_name).ToLowerInvariant()) {
    throw "Runtime lock database_source '$lockDatabaseSource' does not match the backed-up database '$($databaseBackup.database_name)'."
  }
}
if ($runtimeEngine -eq 'sqlite') {
  $expectedSqlite = [System.IO.Path]::GetFullPath((Join-Path $root 'data\one-api.db'))
  $instancePath = Resolve-ProjectPath ([string]$databaseBackup.instance)
  if ($instancePath -ne $expectedSqlite) {
    throw "Database backup instance '$instancePath' does not match the running SQLite database '$expectedSqlite'."
  }
} else {
  $serviceName = if ($runtimeEngine -eq 'postgresql') { 'postgres' } else { $runtimeEngine }
  $dbContainerId = (Invoke-DockerComposeText @('ps','-q',$serviceName) | Select-Object -First 1).ToString().Trim()
  if ([string]::IsNullOrWhiteSpace($dbContainerId)) {
    throw "Running $runtimeEngine container for Compose project '$ProjectName' was not found."
  }
  $stableInstance = "$ProjectName/$runtimeEngine"
  $evidenceInstance = [string]$databaseBackup.instance
  if ($evidenceInstance -ne $stableInstance -and $evidenceInstance -ne $dbContainerId) {
    throw "Database backup instance '$evidenceInstance' does not match the running $runtimeEngine instance '$stableInstance'."
  }
  $runtimeDatabaseName = Get-DatabaseNameFromDsn -Dsn $runtimeDsn -Engine $runtimeEngine
  if ($runtimeDatabaseName -and $databaseBackup.database_name -and
      $runtimeDatabaseName.ToLowerInvariant() -ne ([string]$databaseBackup.database_name).ToLowerInvariant()) {
    throw "Database backup database_name '$($databaseBackup.database_name)' does not match the running database '$runtimeDatabaseName'."
  }
}

$rootPattern = [regex]::Escape($root)
$nativeProcesses = @(Get-CimInstance Win32_Process | Where-Object {
  $name = $_.Name.ToLowerInvariant(); $cmd = [string]$_.CommandLine; $exe = [string]$_.ExecutablePath
  if ($name -eq 'new-api.exe') { return (($exe -and $exe.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) -or ($cmd -match $rootPattern)) }
  if ($name -eq 'go.exe') { return ($cmd -match $rootPattern -and $cmd -match '(?i)(go\s+run|main\.go|new-api)') }
  if ($name -in @('bun.exe','node.exe')) { return ($cmd -match $rootPattern) }
  return $false
})
if ($nativeProcesses) { throw "Native project processes are also running: $($nativeProcesses.ProcessId -join ',')." }

Write-Host "Docker project is healthy: http://127.0.0.1:$Port"
Write-Host "Version: $($status.data.version); Latest release: $($release.data.release.tag_name)"
Write-Host "Release service check: $releaseCheck"
Write-Host "Container: $containerName"
Write-Host "Container commit: $($labels.'com.newapi.runtime.commit')"
Write-Host 'Runtime mode: docker; native application mode: absent'
Write-Host "Running database: $runtimeEngine ($($databaseBackup.instance))"
Write-Host "Database backup: $($databaseBackup.backup_path) (engine $($databaseBackup.engine); SHA-256 verified; validation $($databaseBackup.validation_status))"
