[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$')]
    [string]$Tag,
    [string]$InstallPath = '.\bin\new-api.exe',
    [string]$Source = 'github',
    [string]$AssetName = '',
    [switch]$StopProcess
)

$ErrorActionPreference = 'Stop'
$project = 'sucheng1101/new-api'
$sourceBase = switch ($Source.ToLowerInvariant()) {
    'github' { "https://github.com/$project/releases/download/$Tag" }
    'gitee' { "https://gitee.com/$project/releases/download/$Tag" }
    default { throw "Unsupported release source '$Source'. Use github or gitee." }
}

$resolvedInstallPath = [System.IO.Path]::GetFullPath($InstallPath)
$installDir = Split-Path -Parent $resolvedInstallPath
$backupDir = Join-Path $installDir 'backups'
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "new-api-update-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $installDir, $backupDir, $tempDir | Out-Null

try {
    $manifestPath = Join-Path $tempDir 'release-manifest.json'
    Invoke-WebRequest -UseBasicParsing -Uri "$sourceBase/release-manifest.json" -OutFile $manifestPath
    $manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json
    if ($manifest.tag -ne $Tag) {
        throw "Release manifest tag '$($manifest.tag)' does not match '$Tag'."
    }

    if (-not $AssetName) {
        $AssetName = "new-api-$Tag.exe"
    }
    $asset = @($manifest.assets) | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
    if (-not $asset) {
        throw "Asset '$AssetName' is not listed in the release manifest."
    }

    $downloadPath = Join-Path $tempDir $AssetName
    Invoke-WebRequest -UseBasicParsing -Uri "$sourceBase/$AssetName" -OutFile $downloadPath
    $actualHash = (Get-FileHash -Algorithm SHA256 -Path $downloadPath).Hash.ToLowerInvariant()
    if ($actualHash -ne $asset.sha256.ToLowerInvariant()) {
        throw "SHA-256 mismatch for '$AssetName'."
    }

    $backupPath = $null
    if (Test-Path $resolvedInstallPath) {
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $backupPath = Join-Path $backupDir "new-api-$stamp.exe"
        Copy-Item -LiteralPath $resolvedInstallPath -Destination $backupPath
    }

    if ($StopProcess) {
        Get-Process -Name 'new-api' -ErrorAction SilentlyContinue | Stop-Process -Force
    }
    Copy-Item -LiteralPath $downloadPath -Destination $resolvedInstallPath -Force

    $reportedVersion = (& $resolvedInstallPath --version 2>$null | Select-Object -First 1).Trim()
    if ($reportedVersion -ne $Tag) {
        if ($backupPath) { Copy-Item -LiteralPath $backupPath -Destination $resolvedInstallPath -Force }
        throw "Installed binary reports '$reportedVersion', expected '$Tag'."
    }

    Write-Host "Updated $resolvedInstallPath to $Tag."
    if ($backupPath) { Write-Host "Rollback backup: $backupPath" }
}
finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
