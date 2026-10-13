[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$')]
    [string]$Version,
    [string]$Branch = '',
    [string]$RuntimeOwner = $env:CODEX_SESSION_ID,
    [switch]$Build,
    [switch]$CreateTag,
    [switch]$Push
)

$ErrorActionPreference = 'Stop'
$repoRoot = (git rev-parse --show-toplevel).Trim()
Set-Location $repoRoot

function Invoke-Git {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

if ((git status --porcelain)) {
    throw 'Working tree must be clean before preparing a release.'
}

$currentBranch = (git branch --show-current).Trim()
if ([string]::IsNullOrWhiteSpace($Branch)) { $Branch = $currentBranch }
if ($currentBranch -ne $Branch) {
    throw "Expected branch '$Branch', found '$currentBranch'."
}

$githubRemote = (git remote get-url github 2>$null).Trim()
if (-not $githubRemote) {
    throw "Project-owned GitHub remote 'github' is not configured."
}

if ($Build) {
    if ([string]::IsNullOrWhiteSpace($RuntimeOwner)) {
        throw '-Build requires -RuntimeOwner or CODEX_SESSION_ID so Docker runtime ownership remains explicit.'
    }
    Write-Host 'Running Docker build and local acceptance checks...'
    $localStart = Join-Path $repoRoot 'scripts\local-start.ps1'
    & powershell -NoProfile -ExecutionPolicy Bypass -File $localStart -Owner $RuntimeOwner
    if ($LASTEXITCODE -ne 0) { throw 'Docker build or local acceptance checks failed.' }

    Write-Host 'Running backend tests inside Docker...'
    & docker run --rm -v "${repoRoot}:/src" -w /src golang:1.26.1-alpine /usr/local/go/bin/go test -count=1 ./...
    if ($LASTEXITCODE -ne 0) { throw 'Docker backend tests failed.' }
}

if (git tag --list $Version) {
    throw "Tag '$Version' already exists locally; choose a new release version."
}

if ($CreateTag) {
    Invoke-Git @('tag', '-a', $Version, '-m', "Release $Version")
    Write-Host "Created local tag $Version."
}

if ($Push) {
    if (-not $CreateTag) {
        throw '-Push requires -CreateTag so the branch and tag are published together.'
    }
    Invoke-Git @('push', 'github', "HEAD:refs/heads/$Branch")
    Invoke-Git @('push', 'github', $Version)

    $localHead = (git rev-parse HEAD).Trim()
    $githubHead = (git ls-remote github "refs/heads/$Branch").Split("`t")[0]
    if ($githubHead -ne $localHead) {
        throw 'GitHub release branch hash does not match local HEAD.'
    }
    Write-Host "GitHub release branch points to $localHead."
}

Write-Host "Release preflight complete for $Version."
if (-not $CreateTag) {
    Write-Host 'No tag or remote was changed. Re-run with -CreateTag only after review.'
}
