[CmdletBinding()]
param(
  [string]$ComposeFile = '',
  [string]$ProjectName = 'newapi-dev',
  [ValidateSet('auto', 'sqlite', 'mysql', 'postgresql')]
  [string]$DatabaseMode = 'auto',
  [string]$SqlitePath = '',
  [string]$BackupRoot = '',
  [string]$MetadataPath = ''
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($ComposeFile)) {
  $ComposeFile = Join-Path $root 'docker-compose.dev.yml'
}
if ([string]::IsNullOrWhiteSpace($SqlitePath)) {
  $SqlitePath = Join-Path $root 'data\one-api.db'
}
if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
  $BackupRoot = Join-Path $root 'data\runtime-backups\database'
}
if (-not (Test-Path -LiteralPath $ComposeFile -PathType Leaf)) {
  throw "Compose file not found: $ComposeFile"
}

function Get-RunningContainerId {
  param([string]$Service)
  try {
    $rows = @(& docker compose -p $ProjectName -f $ComposeFile ps -q --status running $Service 2>$null)
  } catch {
    return $null
  }
  if ($LASTEXITCODE -ne 0) { return $null }
  $id = (($rows | Select-Object -First 1) | Out-String).Trim()
  if ([string]::IsNullOrWhiteSpace($id)) { return $null }
  return $id
}

function Get-ContainerEnvironment {
  param([string]$ContainerId)
  $inspect = @(& docker inspect $ContainerId 2>$null | ConvertFrom-Json)
  if ($LASTEXITCODE -ne 0 -or $inspect.Count -eq 0) {
    throw "Unable to inspect database container: $ContainerId"
  }
  $map = @{}
  foreach ($entry in @($inspect[0].Config.Env)) {
    $parts = ([string]$entry).Split('=', 2)
    if ($parts.Count -eq 2) { $map[$parts[0]] = $parts[1] }
  }
  return $map
}

function Get-ApplicationSqlDsn {
  $appId = Get-RunningContainerId -Service 'new-api'
  if ($appId) {
    try {
      $appEnvironment = Get-ContainerEnvironment -ContainerId $appId
      if ($appEnvironment.ContainsKey('SQL_DSN') -and $appEnvironment.SQL_DSN) {
        return [string]$appEnvironment.SQL_DSN
      }
    } catch {
      # Compose config below remains the authoritative fallback when inspect is unavailable.
    }
  }
  try {
    $config = @(& docker compose -p $ProjectName -f $ComposeFile config --format json 2>$null | ConvertFrom-Json)
    if ($LASTEXITCODE -eq 0 -and $config.Count -gt 0) {
      $environment = $config[0].services.'new-api'.environment
      if ($environment -and $environment.SQL_DSN) { return [string]$environment.SQL_DSN }
    }
  } catch {
    # An absent or older Compose JSON renderer must not prevent SQLite-only use.
  }
  if ($env:NEW_API_SQL_DSN) { return [string]$env:NEW_API_SQL_DSN }
  return $null
}

function Test-SqliteBackup {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  $item = Get-Item -LiteralPath $Path
  if ($item.Length -lt 4096) { return $false }
  $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
  try {
    $buffer = New-Object byte[] 16
    $read = $stream.Read($buffer, 0, $buffer.Length)
    $header = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $read)
    if ($header -ne ("SQLite format 3" + [char]0)) { return $false }
  } finally {
    $stream.Dispose()
  }
  $sqlite3 = Get-Command sqlite3 -ErrorAction SilentlyContinue
  if ($sqlite3) {
    $check = & $sqlite3.Source $Path 'PRAGMA integrity_check;' 2>$null
    return (($check | Select-Object -First 1).ToString().Trim() -eq 'ok')
  }
  return $true
}

function Get-TableCount {
  param(
    [string]$ContainerId,
    [string]$Mode,
    [string]$DatabaseName,
    [string]$Password,
    [string]$User = ''
  )
  $safeName = $DatabaseName.Replace("'", "''")
  if ($Mode -eq 'mysql') {
    $execArgs = @('exec')
    if ($null -ne $Password) { $execArgs += @('-e', "MYSQL_PWD=$Password") }
    $execArgs += @($ContainerId, 'mysql', '--protocol=socket', '-uroot', '-N', '-B', '-e', "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$safeName';")
  } else {
    $execArgs = @('exec')
    if ($null -ne $Password) { $execArgs += @('-e', "PGPASSWORD=$Password") }
    $execArgs += @($ContainerId, 'psql', '-U', $User, '-d', $DatabaseName, '-t', '-A', '-c', "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';")
  }
  $value = (& docker @execArgs 2>$null | Select-Object -First 1).ToString().Trim()
  $parsed = 0
  if ([int]::TryParse($value, [ref]$parsed)) { return $parsed }
  return $null
}

function Invoke-MySqlBackup {
  param(
    [string]$ContainerId,
    [hashtable]$Environment,
    [string]$OutputPath
  )
  $databaseName = if ($Environment.ContainsKey('MYSQL_DATABASE') -and $Environment.MYSQL_DATABASE) { [string]$Environment.MYSQL_DATABASE } else { 'new-api-local-dev' }
  $password = $null
  if ($Environment.ContainsKey('MYSQL_ROOT_PASSWORD')) { $password = [string]$Environment.MYSQL_ROOT_PASSWORD }
  elseif ($Environment.ContainsKey('MYSQL_PASSWORD')) { $password = [string]$Environment.MYSQL_PASSWORD }
  elseif ($env:MYSQL_PWD) { $password = [string]$env:MYSQL_PWD }
  $tempPath = "$OutputPath.partial"
  $stderrPath = "$OutputPath.stderr"
  Remove-Item -LiteralPath $tempPath, $stderrPath -Force -ErrorAction SilentlyContinue
  $execArgs = @('exec')
  if ($null -ne $password) { $execArgs += @('-e', "MYSQL_PWD=$password") }
  $execArgs += @(
    $ContainerId, 'mysqldump', '--protocol=socket', '-uroot',
    '--single-transaction', '--routines', '--events', '--triggers', '--hex-blob',
    '--databases', $databaseName
  )
  & docker @execArgs 1> $tempPath 2> $stderrPath
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    $errorText = if (Test-Path -LiteralPath $stderrPath) { (Get-Content -LiteralPath $stderrPath -Raw).Trim() } else { '' }
    Remove-Item -LiteralPath $tempPath, $stderrPath -Force -ErrorAction SilentlyContinue
    throw "mysqldump failed with exit code ${exitCode}: $errorText"
  }
  if (-not (Test-Path -LiteralPath $tempPath) -or (Get-Item -LiteralPath $tempPath).Length -lt 256) {
    Remove-Item -LiteralPath $tempPath, $stderrPath -Force -ErrorAction SilentlyContinue
    throw 'mysqldump produced an empty or truncated dump.'
  }
  if (-not (Select-String -LiteralPath $tempPath -Pattern 'CREATE TABLE' -Quiet)) {
    Remove-Item -LiteralPath $tempPath, $stderrPath -Force -ErrorAction SilentlyContinue
    throw 'mysqldump output does not contain CREATE TABLE statements.'
  }
  Move-Item -LiteralPath $tempPath -Destination $OutputPath -Force
  Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
  return [ordered]@{
    database_name = $databaseName
    table_count = Get-TableCount -ContainerId $ContainerId -Mode 'mysql' -DatabaseName $databaseName -Password $password
    validation = [ordered]@{ status = 'passed'; method = 'mysqldump'; content_check = 'CREATE TABLE found' }
  }
}

function Invoke-PostgresBackup {
  param(
    [string]$ContainerId,
    [hashtable]$Environment,
    [string]$OutputPath
  )
  $databaseName = if ($Environment.ContainsKey('POSTGRES_DB') -and $Environment.POSTGRES_DB) { [string]$Environment.POSTGRES_DB } else { 'postgres' }
  $user = if ($Environment.ContainsKey('POSTGRES_USER') -and $Environment.POSTGRES_USER) { [string]$Environment.POSTGRES_USER } else { 'postgres' }
  $password = if ($Environment.ContainsKey('POSTGRES_PASSWORD')) { [string]$Environment.POSTGRES_PASSWORD } elseif ($env:PGPASSWORD) { [string]$env:PGPASSWORD } else { $null }
  $tempPath = "$OutputPath.partial"
  $stderrPath = "$OutputPath.stderr"
  Remove-Item -LiteralPath $tempPath, $stderrPath -Force -ErrorAction SilentlyContinue
  $execArgs = @('exec')
  if ($null -ne $password) { $execArgs += @('-e', "PGPASSWORD=$password") }
  $execArgs += @($ContainerId, 'pg_dump', '--format=plain', '--no-owner', '--no-privileges', '-U', $user, '-d', $databaseName)
  & docker @execArgs 1> $tempPath 2> $stderrPath
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    $errorText = if (Test-Path -LiteralPath $stderrPath) { (Get-Content -LiteralPath $stderrPath -Raw).Trim() } else { '' }
    Remove-Item -LiteralPath $tempPath, $stderrPath -Force -ErrorAction SilentlyContinue
    throw "pg_dump failed with exit code ${exitCode}: $errorText"
  }
  if (-not (Test-Path -LiteralPath $tempPath) -or (Get-Item -LiteralPath $tempPath).Length -lt 256) {
    Remove-Item -LiteralPath $tempPath, $stderrPath -Force -ErrorAction SilentlyContinue
    throw 'pg_dump produced an empty or truncated dump.'
  }
  if (-not (Select-String -LiteralPath $tempPath -Pattern 'CREATE TABLE' -Quiet)) {
    Remove-Item -LiteralPath $tempPath, $stderrPath -Force -ErrorAction SilentlyContinue
    throw 'pg_dump output does not contain CREATE TABLE statements.'
  }
  Move-Item -LiteralPath $tempPath -Destination $OutputPath -Force
  Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
  return [ordered]@{
    database_name = $databaseName
    table_count = Get-TableCount -ContainerId $ContainerId -Mode 'postgresql' -DatabaseName $databaseName -Password $password -User $user
    validation = [ordered]@{ status = 'passed'; method = 'pg_dump'; content_check = 'CREATE TABLE found' }
  }
}

function Invoke-SqliteBackup {
  param([string]$SourcePath, [string]$OutputPath)
  if (-not (Test-SqliteBackup -Path $SourcePath)) {
    throw "SQLite database is missing or failed validation: $SourcePath"
  }
  $tempPath = "$OutputPath.partial"
  Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
  $sqlite3 = Get-Command sqlite3 -ErrorAction SilentlyContinue
  if ($sqlite3) {
    $escapedTemp = $tempPath.Replace("'", "''")
    & $sqlite3.Source $SourcePath ".backup '$escapedTemp'" 2>$null
    if ($LASTEXITCODE -ne 0) {
      Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
      throw "sqlite3 online backup failed with exit code $LASTEXITCODE."
    }
  } else {
    Copy-Item -LiteralPath $SourcePath -Destination $tempPath -Force
  }
  if (-not (Test-SqliteBackup -Path $tempPath)) {
    Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
    throw 'SQLite backup failed post-copy validation.'
  }
  Move-Item -LiteralPath $tempPath -Destination $OutputPath -Force
  return [ordered]@{
    database_name = [System.IO.Path]::GetFileName($SourcePath)
    table_count = $null
    validation = [ordered]@{ status = 'passed'; method = if ($sqlite3) { 'sqlite3-integrity-check' } else { 'sqlite-header-check' }; integrity_check = if ($sqlite3) { 'ok' } else { 'not-run-sqlite3-unavailable' } }
  }
}

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker daemon is not available.' }
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null

$mysqlId = Get-RunningContainerId -Service 'mysql'
$postgresId = Get-RunningContainerId -Service 'postgres'
$mode = $DatabaseMode
if ($mode -eq 'auto') {
  $dsn = Get-ApplicationSqlDsn
  if ($dsn -match '(?i)(tcp\([^)]*mysql|mysql://|@mysql[:/])') { $mode = 'mysql' }
  elseif ($dsn -match '(?i)(postgres(?:ql)?://|@postgres(?:ql)?[:/]|host=postgres)') { $mode = 'postgresql' }
  elseif ($dsn -match '(?i)^(local|sqlite|file:|.*\.db(?:\?|$))') { $mode = 'sqlite' }
  elseif ($dsn) { throw "Unsupported application SQL_DSN engine; refusing to guess a database backup target: $($dsn -replace '(?i)(://|:)[^@/]+@', '$1[REDACTED]@')" }
  elseif (Test-Path -LiteralPath $SqlitePath -PathType Leaf) { $mode = 'sqlite' }
  else { throw 'Application SQL_DSN was not detected and no SQLite database exists; refusing to guess a MySQL/PostgreSQL target.' }
}
if ($mode -eq 'mysql' -and -not $mysqlId) { throw 'MySQL backup requested but no running Compose mysql container was found.' }
if ($mode -eq 'postgresql' -and -not $postgresId) { throw 'PostgreSQL backup requested but no running Compose postgres container was found.' }

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmssfff')
$extension = if ($mode -eq 'sqlite') { '.db' } else { '.sql' }
$backupPath = [System.IO.Path]::GetFullPath((Join-Path $BackupRoot "database-$stamp-$mode$extension"))
$defaultMetadataPath = "$backupPath.json"
$metadataPathFinal = if ([string]::IsNullOrWhiteSpace($MetadataPath)) { $defaultMetadataPath } else { [System.IO.Path]::GetFullPath($MetadataPath) }
New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($metadataPathFinal)) | Out-Null

$details = $null
$source = $null
$containerId = $null
switch ($mode) {
  'mysql' {
    $containerId = $mysqlId
    $envMap = Get-ContainerEnvironment -ContainerId $containerId
    $details = Invoke-MySqlBackup -ContainerId $containerId -Environment $envMap -OutputPath $backupPath
    $source = "docker-compose:$ProjectName/mysql"
  }
  'postgresql' {
    $containerId = $postgresId
    $envMap = Get-ContainerEnvironment -ContainerId $containerId
    $details = Invoke-PostgresBackup -ContainerId $containerId -Environment $envMap -OutputPath $backupPath
    $source = "docker-compose:$ProjectName/postgres"
  }
  'sqlite' {
    $details = Invoke-SqliteBackup -SourcePath $SqlitePath -OutputPath $backupPath
    $source = [System.IO.Path]::GetFullPath($SqlitePath)
  }
}

$item = Get-Item -LiteralPath $backupPath
$hash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash.ToLowerInvariant()
$metadata = [ordered]@{
  schema_version = 1
  mode = $mode
  source = $source
  project_name = $ProjectName
  compose_file = [System.IO.Path]::GetFullPath($ComposeFile)
  container_id = $containerId
  database_name = $details.database_name
  table_count = $details.table_count
  backup_path = $backupPath
  sha256 = $hash
  size_bytes = [int64]$item.Length
  created_at_utc = (Get-Date).ToUniversalTime().ToString('o')
  validation = $details.validation
  rollback_path = $backupPath
  restore_method = switch ($mode) {
    'mysql' { 'docker exec MYSQL_PWD=... mysql --database <database_name> < backup_path' }
    'postgresql' { 'docker exec PGPASSWORD=... psql/pg_restore using backup_path' }
    'sqlite' { 'stop application, preserve current file, then replace SQLite database with backup_path' }
  }
}
$metadataPartial = "$metadataPathFinal.partial"
Remove-Item -LiteralPath $metadataPartial -Force -ErrorAction SilentlyContinue
$metadata | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $metadataPartial -Encoding UTF8
Move-Item -LiteralPath $metadataPartial -Destination $metadataPathFinal -Force
Write-Output ($metadata | ConvertTo-Json -Depth 8 -Compress)
Write-Host "Database backup created: $backupPath"
Write-Host "Database backup metadata: $metadataPathFinal"
