param(
  [string]$Destination = (Join-Path $PWD ("backups/threadbeacon-" + (Get-Date -Format "yyyyMMdd-HHmmss"))),
  [string]$DatabaseUrl = ($env:DATABASE_URL ?? "jdbc:postgresql://127.0.0.1:5432/threadbeacon"),
  [string]$DatabaseUser = ($env:POSTGRES_USER ?? "threadbeacon"),
  [string]$DatabasePassword = ($env:POSTGRES_PASSWORD ?? "threadbeacon-development-only"),
  [string]$S3Endpoint = ($env:THREADBEACON_S3_ENDPOINT ?? "http://127.0.0.1:9000"),
  [string]$S3AccessKey = ($env:THREADBEACON_S3_ACCESS_KEY ?? "threadbeacon"),
  [string]$S3SecretKey = ($env:THREADBEACON_S3_SECRET_KEY ?? "threadbeacon-development-secret"),
  [string]$Bucket = ($env:THREADBEACON_S3_BUCKET ?? "threadbeacon-reports"),
  [string]$PgBin = "",
  [string]$McPath = "mc"
)
$ErrorActionPreference = "Stop"
if (-not $DatabaseUrl.StartsWith("jdbc:postgresql://")) { throw "DatabaseUrl 必须是 jdbc:postgresql:// URL" }
if (-not $PgBin) { $PgBin = Join-Path $env:LOCALAPPDATA "ThreadBeacon/dev-runtime/tools/pgsql/bin" }
$pgDump = Join-Path $PgBin "pg_dump.exe"; if (-not (Test-Path -LiteralPath $pgDump)) { $pgDump = "pg_dump" }
$target = [IO.Path]::GetFullPath($Destination); New-Item -ItemType Directory -Force -Path $target | Out-Null
$objects = Join-Path $target "objects"; New-Item -ItemType Directory -Force -Path $objects | Out-Null
$dump = Join-Path $target "postgres.dump"; $connection = $DatabaseUrl.Substring(5)
$env:PGPASSWORD = $DatabasePassword
try { & $pgDump --format=custom --no-owner --no-privileges --username=$DatabaseUser --file=$dump $connection; if ($LASTEXITCODE) { throw "pg_dump 失败：$LASTEXITCODE" } }
finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
$alias = "tb-backup-$PID"
try {
  & $McPath alias set $alias $S3Endpoint $S3AccessKey $S3SecretKey --api S3v4 | Out-Null; if ($LASTEXITCODE) { throw "MinIO alias 配置失败" }
  & $McPath mirror --overwrite "$alias/$Bucket" $objects; if ($LASTEXITCODE) { throw "MinIO mirror 失败：$LASTEXITCODE" }
} finally { & $McPath alias remove $alias 2>$null | Out-Null }
$checksums = Get-ChildItem -LiteralPath $target -File -Recurse | Where-Object Name -ne "manifest.json" | ForEach-Object { @{ path = [IO.Path]::GetRelativePath($target,$_.FullName).Replace("\","/"); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); bytes = $_.Length } }
@{ formatVersion=1; createdAt=(Get-Date).ToUniversalTime().ToString("o"); database=$connection; bucket=$Bucket; checksums=$checksums } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $target "manifest.json") -Encoding utf8
Write-Output $target
