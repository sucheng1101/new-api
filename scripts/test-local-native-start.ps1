[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'local-native-start.ps1'
$parseErrors = $null
$tokens = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
# Load only the utilities under test, never the actual backup/build/start workflow.
foreach ($name in @('Write-AtomicJson', 'Stop-NativeProcess')) {
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
try {
  Write-AtomicJson $lock @{ runtime_pid = 1; description = 'initial' }
  if ((Get-Content -LiteralPath $lock -Raw | ConvertFrom-Json).runtime_pid -ne 1) { throw 'Initial lock write failed.' }
  Write-AtomicJson $lock @{ runtime_pid = 2; description = 'updated' }
  $updated = Get-Content -LiteralPath $lock -Raw | ConvertFrom-Json
  if ($updated.runtime_pid -ne 2 -or $updated.description -ne 'updated') { throw 'Atomic lock replacement failed.' }
  if (@(Get-ChildItem -LiteralPath $fixture -Filter '*.partial').Count) { throw 'Partial files were left behind.' }
  Write-Host 'PASS: initial lock and atomic replacement on Windows PowerShell'

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
  if ($child) {
    $child.Refresh()
    if (-not $child.HasExited) { Stop-Process -InputObject $child -Force; $null = $child.WaitForExit(15000) }
    $child.Dispose()
  }
  if ($retainedHandle) { $retainedHandle.Dispose() }
  if (Test-Path -LiteralPath $lock) { Remove-Item -LiteralPath $lock -Force }
  [IO.Directory]::Delete($fixture, $false)
}
