[CmdletBinding()]
param([int]$Port = 5200, [int]$WaitSeconds = 5)
$ErrorActionPreference = 'Stop'
$base = "http://127.0.0.1:$Port"
$deadline = (Get-Date).AddSeconds($WaitSeconds)
do {
  try { $status = Invoke-RestMethod "$base/api/status" -TimeoutSec 3; break } catch { Start-Sleep -Milliseconds 500 }
} while ((Get-Date) -lt $deadline)
if (-not $status) { throw "Backend health check failed at $base/api/status" }
$release = Invoke-RestMethod "$base/api/status/latest-release" -TimeoutSec 10
if (-not $release.success) { throw "Release check failed: $($release.message)" }
$page = Invoke-WebRequest "$base/" -UseBasicParsing -TimeoutSec 10
if ($page.StatusCode -ne 200) { throw "Frontend check failed with HTTP $($page.StatusCode)" }
Write-Host "Local project is healthy: $base"
Write-Host "Version: $($status.data.version); Latest release: $($release.data.release.tag_name)"
