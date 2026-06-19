# Setup script: Google Cloud SDK (gcloud)
# Adiciona `gcloud` ao PATH da sessao atual do PowerShell.
# Para tornar permanente, este comando ja foi gravado no seu $PROFILE.

$env:Path += ";$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin"

Write-Host "gcloud adicionado ao PATH desta sessao." -ForegroundColor Green
Write-Host ""
Write-Host "Proximos passos:" -ForegroundColor Cyan
Write-Host "  1. gcloud auth login             (abre o navegador para login Google)"
Write-Host "  2. gcloud config set project sq-comex-updates-3d22f"
Write-Host "  3. gcloud billing projects describe sq-comex-updates-3d22f"
Write-Host ""
Write-Host "Verificando versao instalada:" -ForegroundColor Cyan
gcloud --version
