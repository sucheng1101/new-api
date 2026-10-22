[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'local-native-start.ps1'
$parseErrors = $null
$tokens = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
# Load only the utilities under test, never the actual backup/build/start workflow.
foreach ($name in @('Write-AtomicJson', 'Stop-NativeProcess', 'Install-NativeExecutable', 'Resolve-BuildCommit', 'Test-RuntimeOwner')) {
  $definition = $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false) |
    Where-Object { $_.Name -eq $name }
  if (-not $definition) { throw "Missing function: $name" }
  . ([scriptblock]::Create($definition.Extent.Text))
}

$fixture = Join-Path ([IO.Path]::GetTempPath()) ('newapi-native-test-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($fixture) | Out-Null
$lock = Join-Path $fixture 'lock.json'
$child = $null
$retainedHandle = $null
$exclusiveFile = $null
try {
  Write-AtomicJson $lock @{ runtime_pid = 1; description = 'initial' }
  if ((Get-Content -LiteralPath $lock -Raw | ConvertFrom-Json).runtime_pid -ne 1) { throw 'Initial lock write failed.' }
  Write-AtomicJson $lock @{ runtime_pid = 2; description = 'updated' }
  $updated = Get-Content -LiteralPath $lock -Raw | ConvertFrom-Json
  if ($updated.runtime_pid -ne 2 -or $updated.description -ne 'updated') { throw 'Atomic lock replacement failed.' }
  if (@(Get-ChildItem -LiteralPath $fixture -Filter '*.partial').Count) { throw 'Partial files were left behind.' }
  Write-Host 'PASS: initial lock and atomic replacement on Windows PowerShell'

  $candidate = Join-Path $fixture 'candidate.exe'
  $destination = Join-Path $fixture 'installed.exe'
  [IO.File]::WriteAllText($candidate, 'new executable')
  Install-NativeExecutable $candidate $destination
  if ([IO.File]::ReadAllText($destination) -ne 'new executable') { throw 'Initial executable installation failed.' }
  [IO.File]::WriteAllText($candidate, 'replacement executable')
  $exclusiveFile = [IO.File]::Open($destination, 'Open', 'Read', 'None')
  $rejected = $false
  try { Install-NativeExecutable $candidate $destination -Attempts 2 }
  catch { $rejected = $true }
  finally { $exclusiveFile.Dispose(); $exclusiveFile = $null }
  if (-not $rejected) { throw 'Installation should reject a locked executable.' }
  if ([IO.File]::ReadAllText($destination) -ne 'new executable') { throw 'A failed installation damaged the previous executable.' }
  if (@(Get-ChildItem -LiteralPath $fixture -Filter '*.partial').Count) { throw 'Failed installation left partial files.' }
  Install-NativeExecutable $candidate $destination
  if ([IO.File]::ReadAllText($destination) -ne 'replacement executable') { throw 'Executable replacement failed after unlocking.' }
  $rejected = $false
  try { Install-NativeExecutable $candidate $destination -Attempts 0 }
  catch { $rejected = $true }
  if (-not $rejected) { throw 'Invalid installation retry count was accepted.' }
  Write-Host 'PASS: executable installation, bounded lock failure, preservation, cleanup and unlocked replacement'

  $root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  $head = (& git -C $root rev-parse HEAD).Trim()
  if ((Resolve-BuildCommit ('v1.0.6-local.' + $head.Substring(0, 12))) -ne $head) { throw 'Build commit resolution failed.' }
  foreach ($version in @('v1.0.6', 'v1.0.6-local.invalid', ('v1.0.6-local.' + ('0' * 40)))) {
    if ($null -ne (Resolve-BuildCommit $version)) { throw 'Unresolvable build version was accepted.' }
  }
  Write-Host 'PASS: valid, missing and nonexistent build commits resolve without stderr exceptions'

  if (-not (Test-RuntimeOwner 'CLI-NA-RUNTIME-01' 'CLI-NA-RUNTIME-01' '')) { throw 'The current runtime owner was rejected.' }
  if (-not (Test-RuntimeOwner 'CLI-NA-RUNTIME-01' 'CODEX-NA-RUNTIME-01' 'CLI-NA-RUNTIME-01')) { throw 'An explicitly approved owner handoff was rejected.' }
  if (Test-RuntimeOwner 'OTHER-OWNER' 'CODEX-NA-RUNTIME-01' 'CLI-NA-RUNTIME-01') { throw 'A handoff from a different owner was accepted.' }
  if (Test-RuntimeOwner 'CLI-NA-RUNTIME-01' 'CODEX-NA-RUNTIME-01' '') { throw 'An owner change without handoff evidence was accepted.' }
  Write-Host 'PASS: runtime ownership requires an explicit matching handoff source'

  $child = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile', '-Command', 'Start-Sleep -Seconds 30') -WindowStyle Hidden -PassThru
  $retainedHandle = Get-Process -Id $child.Id -ErrorAction Stop
  $null = $retainedHandle.Handle
  Stop-NativeProcess $child
  $retainedHandle.Refresh()
  if (-not $child.HasExited -or -not $retainedHandle.HasExited) { throw 'The fixture process has not exited.' }
  Write-Host 'PASS: stop and await process exit with a retained Windows handle'
  Stop-NativeProcess $child
  Write-Host 'PASS: already exited process is accepted'
} finally {
  if ($exclusiveFile) { $exclusiveFile.Dispose() }
  if ($child) {
    $child.Refresh()
    if (-not $child.HasExited) { Stop-Process -InputObject $child -Force; $null = $child.WaitForExit(15000) }
    $child.Dispose()
  }
  if ($retainedHandle) { $retainedHandle.Dispose() }
  foreach ($file in @($lock, $candidate, $destination)) {
    if ($file -and (Test-Path -LiteralPath $file)) { Remove-Item -LiteralPath $file -Force }
  }
  [IO.Directory]::Delete($fixture, $false)
}
