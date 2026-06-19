param(
  [Parameter(Mandatory = $true)]
  [string]$BackupPath
)

$ErrorActionPreference = "Stop"

if (-not $env:DIRECT_URL) {
  throw "DIRECT_URL precisa estar definida para executar o restore."
}

if (-not (Test-Path $BackupPath)) {
  throw "O ficheiro de backup informado nao existe: $BackupPath"
}

$pgRestore = Get-Command pg_restore -ErrorAction SilentlyContinue

if (-not $pgRestore) {
  throw "pg_restore nao foi encontrado no PATH. Instale o cliente PostgreSQL antes de executar este script."
}

Write-Warning "O restore vai sobrescrever objetos existentes na base apontada por DIRECT_URL."
Write-Warning "Confirme manualmente que esta a operar no ambiente correto antes de continuar."

& $pgRestore.Source --clean --if-exists --no-owner --dbname "$env:DIRECT_URL" "$BackupPath"

Write-Host "Restore concluido com sucesso a partir de $BackupPath"
