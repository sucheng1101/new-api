[CmdletBinding()]
param(
  [string]$ComposeFile = '',
  [string]$ProjectName = 'newapi-dev',
  [int]$Port = 5200,
  [int]$WaitSeconds = 60,
  [string]$ExpectedCommit = '',
  [string]$Owner = ''
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
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker daemon is not available.' }

$deadline = (Get-Date).AddSeconds($WaitSeconds)
$status = $null
do {
  try { $status = Invoke-RestMethod "http://127.0.0.1:$Port/api/status" -TimeoutSec 3; break }
  catch { Start-Sleep -Milliseconds 1000 }
} while ((Get-Date) -lt $deadline)
if (-not $status -or -not $status.success) { throw "Backend health check failed at http://127.0.0.1:$Port/api/status" }
$release = Invoke-RestMethod "http://127.0.0.1:$Port/api/status/latest-release" -TimeoutSec 10
if (-not $release.success) { throw "Release check failed: $($release.message)" }
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
Write-Host "Container: $containerName"
Write-Host "Container commit: $($labels.'com.newapi.runtime.commit')"
Write-Host 'Runtime mode: docker; native application mode: absent'
