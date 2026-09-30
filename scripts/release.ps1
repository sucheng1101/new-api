[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$')]
    [string]$Version,
    [string]$Branch = 'feature/promotion-system',
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
if ($currentBranch -ne $Branch) {
    throw "Expected branch '$Branch', found '$currentBranch'."
}

$githubRemote = (git remote get-url github 2>$null).Trim()
if (-not $githubRemote) {
    throw "Project-owned GitHub remote 'github' is not configured."
}

if (-not (git remote get-url gitee 2>$null)) {
    Write-Warning "Project-owned Gitee remote is not configured; dual-remote push is unavailable."
}

if ($Build) {
    Write-Host 'Running backend tests...'
    & go test -count=1 ./...
    if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed.' }

    Push-Location (Join-Path $repoRoot 'web')
    try {
        Write-Host 'Building frontend...'
        & bun install
        if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
        & bun run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    }
    finally {
        Pop-Location
    }
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
    if (-not (git remote get-url gitee 2>$null)) {
        throw "Project-owned Gitee remote 'gitee' is required before pushing a release."
    }

    Invoke-Git @('push', 'github', "HEAD:refs/heads/$Branch")
    Invoke-Git @('push', 'gitee', "HEAD:refs/heads/$Branch")
    Invoke-Git @('push', 'github', $Version)
    Invoke-Git @('push', 'gitee', $Version)

    $localHead = (git rev-parse HEAD).Trim()
    $githubHead = (git ls-remote github "refs/heads/$Branch").Split("`t")[0]
    $giteeHead = (git ls-remote gitee "refs/heads/$Branch").Split("`t")[0]
    if ($githubHead -ne $localHead -or $giteeHead -ne $localHead) {
        throw 'Remote release branch hashes do not match local HEAD.'
    }
    Write-Host "Both release remotes point to $localHead."
}

Write-Host "Release preflight complete for $Version."
if (-not $CreateTag) {
    Write-Host 'No tag or remote was changed. Re-run with -CreateTag only after review.'
}
