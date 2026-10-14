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
  if ([string]::IsNullOrWhiteSpace([string]$evidence.mode)) {
    throw 'Runtime lock database_backup must identify the database mode.'
  }
  if ($metadata.mode -and $evidence.mode -and ([string]$metadata.mode).ToLowerInvariant() -ne ([string]$evidence.mode).ToLowerInvariant()) {
    throw 'Database backup mode does not match runtime lock evidence.'
  }
  return [ordered]@{
    metadata_path = $metadataPath
    backup_path = $backupPath
    mode = [string]$evidence.mode
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
Write-Host "Database backup: $($databaseBackup.backup_path) (SHA-256 verified; validation $($databaseBackup.validation_status))"
