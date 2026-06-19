# IntelliQuote Operations Runbook

Runbook minimo para `staging` e `production` do piloto `single-tenant`.

Data: 2026-03-25

## Objetivo

Deixar o projeto com uma rotina repetivel de:

- validacao de ambiente
- build e testes
- deploy por container
- health checks
- smoke do fluxo principal
- backup e restore
- rollback operacional

## Artefactos Disponiveis

- `Dockerfile`
- `docker-compose.staging.yml`
- `docker-compose.production.yml`
- `.env.staging.example`
- `.env.production.example`
- `scripts/verify-env.js`
- `scripts/healthcheck.js`
- `scripts/smoke-local.js`
- `scripts/backup-database.ps1`
- `scripts/restore-database.ps1`
- `.github/workflows/ci.yml`
- `.github/workflows/release-artifact.yml`

## Ambientes

### Local

Uso:

- desenvolvimento e validacao operacional local

Arquivo esperado:

- `.env`

Comando minimo de validacao:

```bash
npm run verify:env:local
```

### Staging

Uso:

- homologacao funcional
- validacao de migracoes
- smoke antes de promover para producao

Arquivo esperado:

- `.env.staging`

Comando minimo de validacao:

```bash
npm run verify:env:staging
```

### Production

Uso:

- ambiente do piloto real

Arquivo esperado:

- `.env.production`

Comando minimo de validacao:

```bash
npm run verify:env:production
```

## Checklist de Pre-Deploy

Executar nesta ordem:

```bash
npm run prisma:generate
npm run build
npm test
```

Depois validar:

```bash
npm run verify:env:staging
```

ou

```bash
npm run verify:env:production
```

Nota operacional:

- `npm run prisma:seed` ficou idempotente e nao deve ser usado como mecanismo de reset da base;
- qualquer reset de ambiente deve ser tratado explicitamente fora do seed, com backup e janela controlada quando aplicavel.

## Deploy com Docker Compose

### Staging

1. Criar `.env.staging` a partir de `.env.staging.example`.
2. Validar as variaveis:

```bash
npm run verify:env:staging
```

3. Subir o ambiente:

```bash
docker compose -f docker-compose.staging.yml up -d --build
```

4. Validar readiness:

```bash
node ./scripts/healthcheck.js http://localhost:3001/health/ready
```

### Production

1. Criar `.env.production` a partir de `.env.production.example`.
2. Validar as variaveis:

```bash
npm run verify:env:production
```

3. Subir o ambiente:

```bash
docker compose -f docker-compose.production.yml up -d --build
```

4. Validar readiness:

```bash
node ./scripts/healthcheck.js http://localhost:3000/health/ready
```

## Health Checks

Endpoints disponiveis:

- `GET /health/live`
- `GET /health/ready`
- `GET /health`

Semantica:

- `/health/live`: processo Node e app HTTP de pe
- `/health/ready`: app pronta para receber trafego e com banco acessivel
- `/health`: alias operacional da readiness

## Smoke Operacional

Com o ambiente local a correr:

```bash
npm run smoke:local
```

O smoke valida:

- login
- criacao de fornecedores
- criacao de cotacao
- criacao de item
- criacao de propostas
- comparacao
- historico de comparacao
- audit log

Observacao:

- o smoke cria registos `SMOKE-*` na base apontada pelo ambiente atual

## Backup da Base

Premissas:

- `DIRECT_URL` precisa estar configurada
- `pg_dump` precisa estar no `PATH`

Backup no Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup-database.ps1
```

Backup com destino explicito:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup-database.ps1 -OutputPath .\backups\manual.dump
```

Recomendacao minima:

- gerar backup antes de cada deploy em producao
- guardar pelo menos o ultimo backup aprovado
- registar o nome do ficheiro usado no deploy

## Restore da Base

Premissas:

- confirmar o ambiente de destino
- garantir janela de manutencao quando necessario
- `pg_restore` precisa estar no `PATH`

Restore no Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\restore-database.ps1 -BackupPath .\backups\intelliquote-YYYYMMDD-HHMMSS.dump
```

## Rollback

Fluxo minimo:

1. parar o deploy atual
2. subir a imagem anterior
3. validar `/health/ready`
4. se houver impacto em dados, restaurar o ultimo dump aprovado
5. executar smoke funcional reduzido

## Monitoracao Minima Recomendada

- monitorar `GET /health/ready` a cada 1 minuto
- alertar em 2 falhas consecutivas
- acompanhar taxa de `401`, `403` e `5xx`
- acompanhar falhas no endpoint de comparacao
- acompanhar crescimento da base e uso de storage do banco

## Pipeline

### CI

Workflow:

- `.github/workflows/ci.yml`

Entrega:

- instala dependencias
- gera Prisma Client
- aplica migracoes em Postgres real
- executa `build`
- executa `test`

### Artefacto de Release

Workflow:

- `.github/workflows/release-artifact.yml`

Entrega:

- constroi a imagem Docker
- publica um `.tar.gz` como artefacto para promocao manual

## Limite Atual Deste Bloco

O projeto ficou `deploy-ready`, mas ainda nao ficou `deployado` num provedor remoto nesta rodada.

Ainda falta para fechar o go-live real:

- apontar dominio e TLS
- configurar host/registry
- criar segredo real no provedor
- ligar monitoracao externa
- executar o primeiro deploy em `staging`
