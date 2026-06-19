# Provisionamento de recursos GCP para o IntelliQuote
# Tudo o que precisa ser criado UMA UNICA VEZ antes do primeiro deploy.
# Rodar com: powershell -ExecutionPolicy Bypass -File .\setup-gcp.ps1
#
# Parametros opcionais:
#   -FirebaseSaPath <caminho>  -> caminho do JSON do Firebase Service Account
#                                  (default: ~/Downloads/sq-comex-updates-3d22f-firebase-adminsdk-*.json)

[CmdletBinding()]
param(
  [string]$FirebaseSaPath = (Get-ChildItem -Path "$env:USERPROFILE\Downloads" -Filter "sq-comex-updates-3d22f-firebase-adminsdk-*.json" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName)
)

$ErrorActionPreference = "Continue"

# Garante que o gcloud esteja no PATH desta sessao
$gcloudBin = Join-Path $env:LOCALAPPDATA "Google\Cloud SDK\google-cloud-sdk\bin"
if (Test-Path $gcloudBin) {
  if (($env:Path -split ';') -notcontains $gcloudBin) {
    $env:Path = "$env:Path;$gcloudBin"
  }
} else {
  Write-Host "ERRO: Google Cloud SDK nao encontrado em $gcloudBin" -ForegroundColor Red
  exit 1
}

# Garante tambem que o python3.exe do usuario esteja no PATH
$userBin = Join-Path $env:LOCALAPPDATA "bin"
if (Test-Path $userBin) {
  if (($env:Path -split ';') -notcontains $userBin) {
    $env:Path = "$env:Path;$userBin"
  }
}

$PROJECT_ID   = "sq-comex-updates-3d22f"
$REGION       = "southamerica-east1"
$REPOSITORY   = "intelliquote"
$SQL_INSTANCE = "intelliquote-db"
$SQL_DATABASE = "intelliquote"
$SQL_USER     = "intelliquote_app"

function Step($msg) { Write-Host ""; Write-Host ">>> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    [WARN] $msg" -ForegroundColor Yellow }

# -------------------------------------------------------------------
# 1) APIs necessarias
# -------------------------------------------------------------------
Step "Habilitando APIs (run, sqladmin, artifactregistry, secretmanager, cloudbuild)"
gcloud services enable run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com --project $PROJECT_ID 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "ERRO ao habilitar APIs" -ForegroundColor Red; exit 1 }
Ok "APIs habilitadas"

# -------------------------------------------------------------------
# 2) Artifact Registry
# -------------------------------------------------------------------
Step "Verificando Artifact Registry '$REPOSITORY' em $REGION"
gcloud artifacts repositories describe $REPOSITORY --location=$REGION --project $PROJECT_ID 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
  Ok "Artifact Registry ja existe, pulando."
} else {
  gcloud artifacts repositories create $REPOSITORY --repository-format=docker --location=$REGION --description="Imagens Docker do IntelliQuote API" --project $PROJECT_ID 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host "ERRO ao criar Artifact Registry" -ForegroundColor Red; exit 1 }
  Ok "Artifact Registry criado."
}

# -------------------------------------------------------------------
# 3) Senha aleatoria
# -------------------------------------------------------------------
Step "Gerando senha aleatoria para o usuario '$SQL_USER' do Postgres"
$pgPassword = -join ((33..126) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
Ok "senha gerada"

# -------------------------------------------------------------------
# 4) Cloud SQL Postgres
# -------------------------------------------------------------------
Step "Verificando Cloud SQL '$SQL_INSTANCE' (Postgres 15, db-f1-micro)"
gcloud sql instances describe $SQL_INSTANCE --project $PROJECT_ID 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
  Ok "Cloud SQL ja existe, pulando criacao."
} else {
  Write-Host "    Criando instancia (pode levar 3-5 min)..."
  gcloud sql instances create $SQL_INSTANCE --database-version=POSTGRES_15 --tier=db-f1-micro --region=$REGION --root-password="$pgPassword" --availability-type=zonal --project $PROJECT_ID 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host "ERRO ao criar Cloud SQL" -ForegroundColor Red; exit 1 }
  Ok "Cloud SQL criado."
}

Step "Liberando IP 0.0.0.0/0 para acesso do Cloud Run via IP publico"
gcloud sql instances patch $SQL_INSTANCE --assign-ip --authorized-networks=0.0.0.0/0 --project $PROJECT_ID 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Warn "Falha ao liberar IP publico; ajuste manualmente." } else { Ok "IP publico liberado." }

# -------------------------------------------------------------------
# 5) Database + usuario
# -------------------------------------------------------------------
Step "Verificando database '$SQL_DATABASE'"
gcloud sql databases describe $SQL_DATABASE --instance=$SQL_INSTANCE --project $PROJECT_ID 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
  Ok "Database ja existe, pulando."
} else {
  gcloud sql databases create $SQL_DATABASE --instance=$SQL_INSTANCE --project $PROJECT_ID 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host "ERRO ao criar database" -ForegroundColor Red; exit 1 }
  Ok "Database criado."
}

Step "Verificando usuario '$SQL_USER'"
gcloud sql users describe $SQL_USER --instance=$SQL_INSTANCE --project $PROJECT_ID 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
  gcloud sql users set-password $SQL_USER --instance=$SQL_INSTANCE --password="$pgPassword" --project $PROJECT_ID 2>&1 | Out-Null
  Ok "Usuario ja existia, senha redefinida."
} else {
  gcloud sql users create $SQL_USER --instance=$SQL_INSTANCE --password="$pgPassword" --project $PROJECT_ID 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host "ERRO ao criar usuario" -ForegroundColor Red; exit 1 }
  Ok "Usuario criado."
}

# -------------------------------------------------------------------
# 6) IP privado
# -------------------------------------------------------------------
Step "Habilitando IP publico + authorized networks"
# removido: setup-gcp agora usa IP publico + authorized-networks

# -------------------------------------------------------------------
# 7) Secrets no Secret Manager
# -------------------------------------------------------------------
Step "Gravando secrets no Secret Manager"

function Ensure-Secret($name, $value) {
  gcloud secrets describe $name --project $PROJECT_ID 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    gcloud secrets create $name --replication-policy=automatic --project $PROJECT_ID 2>&1 | Out-Null
  }
  $value | gcloud secrets versions add $name --data-file=- --project $PROJECT_ID 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host "    ERRO ao atualizar secret $name" -ForegroundColor Red; return $false }
  Ok "$name atualizado."
  return $true
}

# Firebase Service Account
if ($FirebaseSaPath -and (Test-Path $FirebaseSaPath)) {
  Ensure-Secret "FIREBASE_SERVICE_ACCOUNT_JSON" (Get-Content -Raw -Path $FirebaseSaPath) | Out-Null
} else {
  Warn "Firebase SA JSON nao encontrado (FirebaseSaPath='$FirebaseSaPath')."
  Warn "Baixe em Firebase Console -> Project Settings -> Service Accounts -> Generate new private key"
  Warn "Depois rode com: -FirebaseSaPath 'C:\caminho\para\arquivo.json'"
}

# Conexao com o Cloud SQL via IP publico (host publico resolvido por DNS)
$pgHost = $null
Write-Host "    Aguardando SQL instance responder..."
for ($i = 0; $i -lt 30; $i++) {
  $pgHost = gcloud sql instances describe $SQL_INSTANCE --project $PROJECT_ID --format="value(ipAddresses[0].ipAddress)" 2>&1 | ForEach-Object { $_.Trim() }
  if ($pgHost -and $pgHost -ne "None") { break }
  Start-Sleep -Seconds 5
}
if (-not $pgHost -or $pgHost -eq "None") {
  Write-Host "ERRO: nao consegui obter IP publico da instancia" -ForegroundColor Red
  exit 1
}
$databaseUrl = "postgresql://${SQL_USER}:${pgPassword}@${pgHost}:5432/intelliquote?schema=public"
$directUrl   = "postgresql://${SQL_USER}:${pgPassword}@${pgHost}:5432/intelliquote?schema=public"
Ok "URL do banco: host=$pgHost"

$jwtAccess  = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 64 | ForEach-Object { [char]$_ })
$jwtRefresh = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 64 | ForEach-Object { [char]$_ })

Ensure-Secret "DATABASE_URL"       $databaseUrl    | Out-Null
Ensure-Secret "DIRECT_URL"         $directUrl      | Out-Null
Ensure-Secret "JWT_ACCESS_SECRET"  $jwtAccess      | Out-Null
Ensure-Secret "JWT_REFRESH_SECRET" $jwtRefresh     | Out-Null

# -------------------------------------------------------------------
# 8) Permissoes para Cloud Run / Cloud Build lerem secrets
# -------------------------------------------------------------------
Step "Concedendo acesso aos secrets para os service accounts"
$PROJECT_NUMBER = gcloud projects describe $PROJECT_ID --format="value(projectNumber)" 2>&1
if ($LASTEXITCODE -ne 0) { Warn "Nao consegui obter project number." }
else {
  $cloudRunSa     = "${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
  $cloudBuildSa   = "${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
  foreach ($sa in @($cloudRunSa, $cloudBuildSa)) {
    gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$sa" --role="roles/secretmanager.secretAccessor" --quiet 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Ok "permissao concedida a $sa" }
    else { Warn "falha ao dar permissao a $sa" }
  }
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  Recursos GCP provisionados com sucesso." -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "ULTIMO PASSO - gravar a senha SMTP do Brevo:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  No PowerShell, cole a senha do Brevo (a mesma que esta no .env do IntelliQuote):" -ForegroundColor Yellow
Write-Host ""
Write-Host "    'xsmtpsib-...-SUA-SENHA-AQUI' | gcloud secrets versions add SMTP_PASS --data-file=- --project $PROJECT_ID" -ForegroundColor Yellow
Write-Host ""
Write-Host "  (Se o secret ainda nao existir, primeiro: gcloud secrets create SMTP_PASS --replication-policy=automatic --project $PROJECT_ID)" -ForegroundColor Yellow
Write-Host ""
