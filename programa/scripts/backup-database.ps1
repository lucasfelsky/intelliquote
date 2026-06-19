param(
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

if (-not $env:DIRECT_URL) {
  throw "DIRECT_URL precisa estar definida para executar o backup."
}

$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue

if (-not $pgDump) {
  throw "pg_dump nao foi encontrado no PATH. Instale o cliente PostgreSQL antes de executar este script."
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupDir = Join-Path (Get-Location) "backups"

  if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir | Out-Null
  }

  $OutputPath = Join-Path $backupDir "intelliquote-$timestamp.dump"
}

& $pgDump.Source --format=custom --file "$OutputPath" "$env:DIRECT_URL"

Write-Host "Backup criado com sucesso em $OutputPath"
