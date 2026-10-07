[CmdletBinding()]
param([int]$Port = 5200)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtime = Join-Path $root '.git\new-api-dev'
New-Item -ItemType Directory -Force $runtime | Out-Null
$processes = Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(new-api|go)(\.exe)?$' -and $_.CommandLine -like "*$root*" }
foreach ($p in $processes) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 500
$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($listener) {
  $owner = Get-Process -Id $listener[0].OwningProcess -ErrorAction SilentlyContinue
  $isProject = $owner -and $owner.ProcessName -eq 'new-api'
  if ($isProject) { Stop-Process -Id $owner.Id -Force; Start-Sleep -Milliseconds 500 }
  else { throw "Port $Port is occupied by PID $($listener[0].OwningProcess), not a project process." }
}
$log = Join-Path $runtime 'local-start.log'
$err = Join-Path $runtime 'local-start.err.log'
Start-Process go -ArgumentList 'run','.' -WorkingDirectory $root -RedirectStandardOutput $log -RedirectStandardError $err | Out-Null
& (Join-Path $PSScriptRoot 'local-check.ps1') -Port $Port -WaitSeconds 30
