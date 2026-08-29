param(
  [Parameter(Mandatory=$true)][string]$BackupPath,
  [Parameter(Mandatory=$true)][string]$TargetDatabaseUrl,
  [Parameter(Mandatory=$true)][string]$TargetBucket,
  [switch]$ConfirmRestore,
  [string]$DatabaseUser = ($env:POSTGRES_USER ?? "threadbeacon"),
  [string]$DatabasePassword = ($env:POSTGRES_PASSWORD ?? "threadbeacon-development-only"),
  [string]$S3Endpoint = ($env:THREADBEACON_S3_ENDPOINT ?? "http://127.0.0.1:9000"),
  [string]$S3AccessKey = ($env:THREADBEACON_S3_ACCESS_KEY ?? "threadbeacon"),
  [string]$S3SecretKey = ($env:THREADBEACON_S3_SECRET_KEY ?? "threadbeacon-development-secret"),
  [string]$PgBin = "",
  [string]$McPath = "mc"
)
$ErrorActionPreference = "Stop"
if (-not $ConfirmRestore) { throw "恢复会覆盖目标数据库和 Bucket；请显式传入 -ConfirmRestore" }
if (-not $TargetDatabaseUrl.StartsWith("jdbc:postgresql://")) { throw "TargetDatabaseUrl 必须是 jdbc:postgresql:// URL" }
$source = [IO.Path]::GetFullPath($BackupPath); $manifestPath = Join-Path $source "manifest.json"; if (-not (Test-Path -LiteralPath $manifestPath)) { throw "备份缺少 manifest.json" }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json; if ($manifest.formatVersion -ne 1) { throw "不支持的备份格式" }
foreach ($item in $manifest.checksums) { $file=Join-Path $source $item.path; if (-not (Test-Path -LiteralPath $file)) { throw "备份文件缺失：$($item.path)" }; if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256) { throw "备份校验失败：$($item.path)" } }
if (-not $PgBin) { $PgBin = Join-Path $env:LOCALAPPDATA "ThreadBeacon/dev-runtime/tools/pgsql/bin" }
$pgRestore = Join-Path $PgBin "pg_restore.exe"; if (-not (Test-Path -LiteralPath $pgRestore)) { $pgRestore = "pg_restore" }
$connection = $TargetDatabaseUrl.Substring(5); $env:PGPASSWORD = $DatabasePassword
try { & $pgRestore --clean --if-exists --no-owner --no-privileges --username=$DatabaseUser --dbname=$connection (Join-Path $source "postgres.dump"); if ($LASTEXITCODE) { throw "pg_restore 失败：$LASTEXITCODE" } }
finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
$alias = "tb-restore-$PID"
try {
  & $McPath alias set $alias $S3Endpoint $S3AccessKey $S3SecretKey --api S3v4 | Out-Null; if ($LASTEXITCODE) { throw "MinIO alias 配置失败" }
  & $McPath mb --ignore-existing "$alias/$TargetBucket" | Out-Null
  & $McPath mirror --overwrite --remove (Join-Path $source "objects") "$alias/$TargetBucket"; if ($LASTEXITCODE) { throw "MinIO restore 失败：$LASTEXITCODE" }
} finally { & $McPath alias remove $alias 2>$null | Out-Null }
Write-Output "restore completed: $connection + $TargetBucket"
