# Provisionar o servico Cloud Run do IntelliQuote API
#
# Pre-requisitos:
#   1. gcloud config set project sq-comex-updates-3d22f
#   2. Artifact Registry ja criado (nome: intelliquote, regiao: southamerica-east1)
#   3. Cloud SQL ja criado (instancia: intelliquote-db, db: intelliquote, regiao: southamerica-east1)
#   4. Secrets ja criados no Secret Manager: SMTP_PASS, DATABASE_URL, DIRECT_URL,
#      JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, FIREBASE_SERVICE_ACCOUNT_JSON
#
# Conexao com o banco: IP publico (host=35.247.254.177) - configurado no DATABASE_URL/DIRECT_URL
#
# Uso: powershell -ExecutionPolicy Bypass -File .\deploy-cloudrun.ps1

$ErrorActionPreference = "Continue"

# Garante que o gcloud esteja no PATH desta sessao
$gcloudBin = Join-Path $env:LOCALAPPDATA "Google\Cloud SDK\google-cloud-sdk\bin"
if (Test-Path $gcloudBin) {
  if (($env:Path -split ';') -notcontains $gcloudBin) {
    $env:Path = "$env:Path;$gcloudBin"
  }
}
$userBin = Join-Path $env:LOCALAPPDATA "bin"
if (Test-Path $userBin) {
  if (($env:Path -split ';') -notcontains $userBin) {
    $env:Path = "$env:Path;$userBin"
  }
}

$PROJECT_ID   = "sq-comex-updates-3d22f"
$REGION       = "southamerica-east1"
$SERVICE      = "intelliquote-api"
$REPOSITORY   = "intelliquote"
$IMAGE        = "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${SERVICE}:latest"
$GCLOUD       = Join-Path $gcloudBin "gcloud.cmd"

# Quando executado a partir de um diretorio diferente (ex: raiz do monorepo),
# o `--config programa/cloudbuild.yaml` precisa do caminho absoluto.
$BUILD_CONFIG = $PSScriptRoot
if (-not (Test-Path (Join-Path $BUILD_CONFIG 'cloudbuild.yaml'))) {
  $BUILD_CONFIG = Join-Path (Get-Location) 'programa'
}
if (-not (Test-Path (Join-Path $BUILD_CONFIG 'cloudbuild.yaml'))) {
  Write-Host "ERRO: cloudbuild.yaml nao encontrado em $BUILD_CONFIG" -ForegroundColor Red
  exit 1
}
$ENV_FILE = Join-Path $BUILD_CONFIG 'deploy-env-merged.yaml'

if (-not (Test-Path $ENV_FILE)) {
  $ENV_FILE = Join-Path $BUILD_CONFIG 'deploy-env.yaml'
}
if (-not (Test-Path $ENV_FILE)) {
  Write-Host "ERRO: deploy-env*.yaml nao encontrado em $BUILD_CONFIG" -ForegroundColor Red
  exit 1
}

$BACKEND_BUILD_TAG = "2026-06-19-r45-portal-response-id-link-fix"

Write-Host ">>> Subindo build + push + deploy do $SERVICE em $REGION" -ForegroundColor Cyan

# Permite origens de produção (subdomínio custom e Firebase Hosting) + dev.
$ALLOWED_CORS = "https://intelliquote.portal-comex.com,https://intelliquote.web.app,https://intelliquote--intelliquote-5qf1ezu3.web.app,http://localhost:3000,http://127.0.0.1:3000"

# 1) Build + push via Cloud Build
& $GCLOUD builds submit `
  --config (Join-Path $BUILD_CONFIG 'cloudbuild.yaml') `
  --substitutions="_REGION=$REGION,_SERVICE=$SERVICE,_REPOSITORY=$REPOSITORY" `
  --project $PROJECT_ID 2>&1 | Tee-Object -FilePath "$env:TEMP\cloudbuild.log"

if ($LASTEXITCODE -ne 0) { Write-Host "ERRO no cloud build (exit=$LASTEXITCODE)" -ForegroundColor Red; exit 1 }

# 2) Deploy no Cloud Run
Write-Host ">>> Deploy no Cloud Run" -ForegroundColor Cyan
& $GCLOUD run deploy $SERVICE `
  --image $IMAGE `
  --region $REGION `
  --platform managed `
  --allow-unauthenticated `
  --port 8080 `
  --memory 512Mi `
  --cpu 1 `
  --min-instances 0 `
  --max-instances 4 `
  --timeout 60 `
  --concurrency 80 `
  --update-env-vars "BACKEND_BUILD_TAG=$BACKEND_BUILD_TAG" `
  --set-secrets "SMTP_PASS=SMTP_PASS:latest,SMTP_HOST=SMTP_HOST:latest,SMTP_USER=SMTP_USER:latest,SMTP_PORT=SMTP_PORT:latest,SMTP_FROM=SMTP_FROM:latest,DATABASE_URL=DATABASE_URL:latest,DIRECT_URL=DIRECT_URL:latest,JWT_ACCESS_SECRET=JWT_ACCESS_SECRET:latest,JWT_REFRESH_SECRET=JWT_REFRESH_SECRET:latest,FIREBASE_SERVICE_ACCOUNT_JSON=FIREBASE_SERVICE_ACCOUNT_JSON:latest" `
  --project $PROJECT_ID 2>&1 | Tee-Object -FilePath "$env:TEMP\cloudrun-deploy.log" -Append

if ($LASTEXITCODE -ne 0) { Write-Host "ERRO no deploy do Cloud Run (exit=$LASTEXITCODE)" -ForegroundColor Red; exit 1 }

# 3) Mostrar URL do servico
$URL = & $GCLOUD run services describe $SERVICE --region $REGION --project $PROJECT_ID --format="value(status.url)" 2>&1
Write-Host ""
Write-Host ">>> Deploy concluido: $URL" -ForegroundColor Green
Write-Host "    Health check:  $URL/health/ready"
Write-Host "    Health (live): $URL/health/live"
