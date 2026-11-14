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

## Integracao Pipedrive (IQ Indent)

Escopo: o IQ Indent le o funil do Pipedrive (SO leitura; o cliente HTTP so faz `GET`) e cria/atualiza solicitacoes
a partir dos negocios da coluna de origem. Caminho principal: job periodico do Cloud Scheduler
(`POST /api/internal/jobs/indent-pipedrive-sweep`, OIDC) + botao "Sincronizar agora" na tela "Integracao Pipedrive".
O webhook do Pipedrive e uma etapa opcional separada (nao ativar enquanto nao existir): o polling funciona sozinho.

Convencoes dos comandos: projeto `sq-comex-updates-3d22f`; comandos do Secret Manager e `gh` rodam no Git Bash;
os demais rodam no Git Bash ou PowerShell, um comando por bloco (PowerShell 5.1 nao tem `&&`). Placeholders
`<...>` sao preenchidos por quem executa. Nenhum valor real de token, chave de campo ou id de usuario entra neste
repositorio (publico) nem no log do GitHub Actions.

### Onde fica cada configuracao

| Item | Onde | Como muda |
|---|---|---|
| `PIPEDRIVE_API_TOKEN`, `PIPEDRIVE_WEBHOOK_USER`, `PIPEDRIVE_WEBHOOK_PASSWORD` | Secret Manager (referenciados com `:latest` em `SECRET_REFS` do workflow `deploy-intelliquote-api.yml`, em `deploy-cloudrun.ps1` e em `deploy-secrets.yaml`) | `gcloud secrets versions add` + nova revisao |
| `PIPEDRIVE_DOMAIN`, `PIPEDRIVE_PIPELINE_ID`, `PIPEDRIVE_STAGE_ID`, `PIPEDRIVE_STAGE_NAME` | `programa/deploy-env-vars.yaml` (o `--env-vars-file` sobrescreve todas as envs a cada deploy) | commit + deploy |
| `PIPEDRIVE_ORG_CNPJ_FIELD_KEY` (obrigatoria), `PIPEDRIVE_DEAL_TYPE_FIELD_KEY`, `PIPEDRIVE_COMEX_USER_ID`, `PIPEDRIVE_SYNC_SINCE` (opcionais) | GitHub Variables do repositorio com o mesmo nome; o workflow as anexa ao arquivo de envs sem imprimir o valor | `gh variable set` + novo deploy |
| Funil, coluna (id + nome) e prazo interno | banco (`IndentIntegrationConfig`); o env so semeia a linha inicial na 1a leitura | tela "Integracao Pipedrive" (admin) |

Sem as envs novas o backend sobe normalmente com a integracao desligada (`configured=false`): o boot nunca chama o
Pipedrive, `/health*` e o smoke do deploy nao dependem dele, o job responde `200 {"skipped":"not_configured"}` e o
botao "Sincronizar agora" responde 409. Env em formato invalido tambem nao derruba o boot: o log
"Configuracao do Pipedrive invalida ou incompleta" lista so os NOMES das envs com problema.
Formatos: chaves de campo = 40 caracteres hexadecimais minusculos; `PIPEDRIVE_COMEX_USER_ID` = inteiro positivo;
`PIPEDRIVE_SYNC_SINCE` = `YYYY-MM-DD`. Valor fora do formato nas GitHub Variables e omitido pelo workflow com um
`::warning::` (so o nome da variavel) e o deploy segue.

### Pre-condicoes (antes de publicar o backend com estas referencias)

Se um segredo referenciado nao existir, nao tiver versao ativa ou a service account do Cloud Run nao puder le-lo, o
`gcloud run deploy` falha. Conferir, para cada um dos tres segredos:

```bash
gcloud secrets versions list PIPEDRIVE_API_TOKEN --project=sq-comex-updates-3d22f --filter="state=ENABLED" --limit=1
```

```bash
gcloud secrets get-iam-policy PIPEDRIVE_API_TOKEN --project=sq-comex-updates-3d22f
```

A politica deve listar `roles/secretmanager.secretAccessor` para a service account de runtime do Cloud Run
(`705697815580-compute@developer.gserviceaccount.com`). Repetir com `PIPEDRIVE_WEBHOOK_USER` e
`PIPEDRIVE_WEBHOOK_PASSWORD`.

Tambem conferir antes da ativacao: (1) a usuaria dona do token ve no Pipedrive os mesmos negocios que um admin ve na
coluna de origem (visibilidade, risco abaixo); (2) a migration do IQ Indent roda no deploy do backend (o `CMD` da
imagem executa `prisma migrate deploy` antes de subir o servidor).

### Ativacao, passo a passo (ordem; tudo por humano)

1. Definir as GitHub Variables (valores reais colados por quem ativa; nunca commitar):

```bash
gh variable set PIPEDRIVE_ORG_CNPJ_FIELD_KEY --repo lucasfelsky/intelliquote --body "<CHAVE_HASH_CNPJ_40_HEX>"
```

```bash
gh variable set PIPEDRIVE_DEAL_TYPE_FIELD_KEY --repo lucasfelsky/intelliquote --body "<CHAVE_HASH_TIPO_NEGOCIO_40_HEX>"
```

```bash
gh variable set PIPEDRIVE_COMEX_USER_ID --repo lucasfelsky/intelliquote --body "<ID_USUARIO_COMPRAS>"
```

```bash
gh variable set PIPEDRIVE_SYNC_SINCE --repo lucasfelsky/intelliquote --body "<DATA_ATIVACAO_MENOS_14_DIAS>"
```

   `PIPEDRIVE_SYNC_SINCE` = data de ativacao menos 14 dias (formato `YYYY-MM-DD`). Negocios que entraram na coluna antes
   dessa data e ainda nao tem espelho nao viram solicitacao (evento `ignored_before_cutoff`); sem a variavel, a 1a carga
   importa todos os negocios abertos da coluna. Calculo no PowerShell: `(Get-Date).AddDays(-14).ToString('yyyy-MM-dd')`.
   `PIPEDRIVE_DEAL_TYPE_FIELD_KEY` e `PIPEDRIVE_COMEX_USER_ID` sao opcionais.
2. Merge dos PRs da integracao e tags `backend-v*` e `web-v*` (fluxo normal de deploy, com o gate "CI verde na main").
   A migration roda no deploy do backend. No log do passo "Deploy no Cloud Run" devem aparecer as linhas
   "Pipedrive: <NOME> incluida no deploy." para as variaveis definidas (o valor nunca aparece).
3. Verificar o boot: `gcloud run services logs read <SERVICO_CLOUD_RUN> --project=sq-comex-updates-3d22f --region=<REGIAO_CLOUD_RUN> --limit=50`
   e procurar "Configuracao do Pipedrive invalida ou incompleta". Se aparecer, corrigir os nomes de env listados e
   publicar de novo (o servico segue de pe, com a integracao desligada).
4. Admin abre "Integracao Pipedrive", confere funil, coluna de origem e prazo interno e clica "Sincronizar agora"
   (1a carga, respeitando `PIPEDRIVE_SYNC_SINCE`). Conferir a fila de vinculo e 2-3 solicitacoes contra o Pipedrive.
5. So depois da tela no ar (web publicado) criar o job do Scheduler (secao seguinte).
6. Conferir a 1a execucao agendada e acompanhar na tela ("ha N min", novos, erros, tokens restantes) durante a
   primeira semana.

### Cloud Scheduler (job a cada 10 min, 07h-19h, seg-sex, America/Sao_Paulo)

Mesma regiao e mesmos parametros OIDC dos jobs internos existentes (PTAX, lembretes, documentos). Descobrir a regiao
e a URL do servico:

```bash
gcloud scheduler jobs list --project=sq-comex-updates-3d22f
```

```bash
gcloud run services describe <SERVICO_CLOUD_RUN> --project=sq-comex-updates-3d22f --region=<REGIAO_CLOUD_RUN> --format="value(status.url)"
```

Criar o job (service account e audience sao os de `INTERNAL_JOBS_INVOKER_EMAIL` e `INTERNAL_JOBS_OIDC_AUDIENCE` em
`deploy-env-vars.yaml`):

```bash
gcloud scheduler jobs create http iq-indent-pipedrive-sweep --project=sq-comex-updates-3d22f --location=<REGIAO_DO_SCHEDULER> --schedule="*/10 7-19 * * 1-5" --time-zone="America/Sao_Paulo" --uri="<URL_DO_CLOUD_RUN>/api/internal/jobs/indent-pipedrive-sweep" --http-method=POST --oidc-service-account-email=iq-jobs-scheduler@sq-comex-updates-3d22f.iam.gserviceaccount.com --oidc-token-audience=intelliquote-internal-jobs --attempt-deadline=280s --max-retry-attempts=1
```

Racional: o prazo interno e de 2 dias uteis, entao 10 min de atraso e irrelevante; o job tem orcamento de 240 s e o
`--attempt-deadline` de 280 s cobre o servico (`--timeout=300`). Execucao manual de teste (uma vez):

```bash
gcloud scheduler jobs run iq-indent-pipedrive-sweep --project=sq-comex-updates-3d22f --location=<REGIAO_DO_SCHEDULER>
```

Respostas do job: `200` com `{outcome, processed, created, errors, missed, durationMs}` ou `{"skipped":"not_configured"}`;
`503` quando outra execucao segura o claim (`in_progress`) ou o Pipedrive esta fora (o Scheduler repete 1 vez);
`500` em falha inesperada. Estados "de negocio" (token recusado, limite, coluna que nao confere) voltam `200`: repetir
nao resolve, o estado aparece na tela.

### Conferencia e diagnostico

- Tela "Integracao Pipedrive": conexao, "ultima sincronizacao", negocios novos, erros, tokens diarios restantes e fila de
  vinculo. A tela le o ultimo estado gravado; nao chama o Pipedrive.
- Logs da varredura (`msg` "Pipedrive: ..."; so ids e contadores, nunca token, CNPJ, nota ou nome):

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="<SERVICO_CLOUD_RUN>" AND jsonPayload.msg:"Pipedrive"' --project=sq-comex-updates-3d22f --freshness=1h --limit=30 --format="value(timestamp,jsonPayload.msg)"
```

### O que fazer em cada estado da conexao

- `not_configured` ("Integracao nao configurada"): faltam envs ou estao invalidas. Conferir a secao "Onde fica cada
  configuracao" e o log de boot (nomes das envs com problema); corrigir e publicar de novo.
- `auth_failed` ("Falha de autenticacao"): o Pipedrive recusou o token (trocado, revogado, usuaria sem acesso ou que
  saiu da empresa). A integracao para; solicitacoes lancadas a mao seguem normais. Gerar novo token (ver "Troca do
  token") e publicar nova revisao. Enquanto isso o job continua tentando a cada 10 min sem efeito colateral; para
  silenciar, pausar o job (ver "Desligar").
- `rate_limited` ("Limite de chamadas atingido"): o Pipedrive respondeu 429; a varredura para e a proxima execucao
  retoma sozinha. Se for recorrente, algo mais esta consumindo a conta ou o intervalo esta curto: espacar o job, por
  exemplo `gcloud scheduler jobs update http iq-indent-pipedrive-sweep --project=sq-comex-updates-3d22f --location=<REGIAO_DO_SCHEDULER> --schedule="*/20 7-19 * * 1-5"`.
- `budget_low` ("Orcamento diario quase no fim"): o restante diario de tokens da CONTA do Pipedrive (compartilhado com
  outras integracoes da empresa) caiu abaixo de 10% do limite. A varredura para e volta sozinha quando o restante
  voltar a 10% ou mais. Evitar "Sincronizar agora" repetido, identificar quem mais consome o orcamento e, se for
  recorrente, espacar o job como acima.
- `config_mismatch` ("Funil ou coluna nao conferem"): o id da coluna nao pertence mais ao funil salvo ou o nome da
  coluna mudou no Pipedrive (renomeada, recriada, movida). Nada e processado ate corrigir. Admin abre a tela e
  escolhe o funil e a coluna corretos (salvar grava o nome atual vindo do Pipedrive; se a coluna certa ja aparece
  selecionada, escolha outra e volte). Funil e coluna dessa tela valem sobre as envs depois da 1a leitura.
- `error`: o Pipedrive nao respondeu como esperado (5xx, rede, timeout); transitorio, a proxima execucao tenta de novo.
  Persistindo, olhar os logs acima.
- "Sincronizacao em andamento" (`in_progress`): outra varredura segura o claim (expira em 5 min); aguardar.

### Troca do token

O token e pessoal (permissoes da usuaria dona). Nova versao do segredo (digitar o token no prompt; nunca em arquivo,
historico ou chat; o app faz `trim`):

```bash
read -rs -p "token: " NOVO_TOKEN; echo; printf '%s' "$NOVO_TOKEN" | gcloud secrets versions add PIPEDRIVE_API_TOKEN --project=sq-comex-updates-3d22f --data-file=-; unset NOVO_TOKEN
```

O Cloud Run resolve `:latest` ao criar a revisao: para valer, publicar uma nova revisao (nova tag `backend-v*`, ou o
workflow "Deploy backend (Cloud Run)" por `workflow_dispatch`); instancias antigas seguem com o token antigo ate
serem substituidas. Depois de confirmar na tela que a conexao voltou ("Sincronizar agora"), desabilitar a versao
antiga (listar com `gcloud secrets versions list PIPEDRIVE_API_TOKEN --project=sq-comex-updates-3d22f`):

```bash
gcloud secrets versions disable <VERSAO_ANTIGA> --secret=PIPEDRIVE_API_TOKEN --project=sq-comex-updates-3d22f
```

### Alterar uma env

Variaveis do GitHub ou `deploy-env-vars.yaml` so valem num novo deploy do backend. Funil, coluna e prazo, depois da 1a
leitura, mudam so pela tela (as envs nao sobrescrevem o banco). `PIPEDRIVE_SYNC_SINCE` so afeta negocios sem espelho.

### Desligar a integracao

1. Parar a consulta automatica (reversivel; o botao "Sincronizar agora" continua disponivel):

```bash
gcloud scheduler jobs pause iq-indent-pipedrive-sweep --project=sq-comex-updates-3d22f --location=<REGIAO_DO_SCHEDULER>
```

   Religar com `gcloud scheduler jobs resume iq-indent-pipedrive-sweep --project=sq-comex-updates-3d22f --location=<REGIAO_DO_SCHEDULER>`.
2. Desligar tambem o botao: remover a variavel obrigatoria e publicar de novo; a integracao volta a `configured=false`
   ("Integracao nao configurada").

```bash
gh variable delete PIPEDRIVE_ORG_CNPJ_FIELD_KEY --repo lucasfelsky/intelliquote
```

3. Revogar o acesso (token comprometido ou usuaria saindo): desabilitar a versao do segredo
   (`gcloud secrets versions disable <VERSAO> --secret=PIPEDRIVE_API_TOKEN --project=sq-comex-updates-3d22f`) e/ou
   revogar o token na conta do Pipedrive; a tela passa a `auth_failed`.

Nada disso apaga dados: espelhos de negocios, solicitacoes ja criadas e a fila de vinculo permanecem.

### Riscos conhecidos

- Token pessoal de usuaria NAO admin: nao existe token so de leitura; ele tem as permissoes da dona. Mitigacao: o
  cliente do IQ so envia `GET` (teste "somente GET" + guarda estatica), entao a integracao nao altera nada no CRM. Se ela sair, perder acesso ou trocar o token, a integracao para em `auth_failed`.
- Visibilidade: o token so enxerga o que a usuaria dona enxerga. Negocios com visibilidade restrita de outros
  vendedores podem nao aparecer na varredura, em silencio. Antes da ativacao, comparar o total da coluna de origem
  visto pelo token com o visto por um admin; se divergir, ajustar o grupo de visibilidade da usuaria no Pipedrive.
- Orcamento diario de chamadas e da CONTA, compartilhado: a varredura para com `budget_low` abaixo de 10% e a tela mostra
  o restante.
- Rotacao: o token nunca e impresso em log, erro, resposta ou auditoria; nunca colar o valor em PR, issue, chat ou
  arquivo do repositorio.
- `PIPEDRIVE_WEBHOOK_USER` e `PIPEDRIVE_WEBHOOK_PASSWORD` ja ficam montados no Cloud Run, mas nenhum codigo os usa ate
  o webhook opcional existir.

## Limite Atual Deste Bloco

O projeto ficou `deploy-ready`, mas ainda nao ficou `deployado` num provedor remoto nesta rodada.

Ainda falta para fechar o go-live real:

- apontar dominio e TLS
- configurar host/registry
- criar segredo real no provedor
- ligar monitoracao externa
- executar o primeiro deploy em `staging`
