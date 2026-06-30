# IntelliQuote

MVP de uma aplicacao web B2B para gestao e comparacao de cotacoes internacionais, desenvolvido no contexto de um projeto universitario e agora evoluindo para um piloto interno.

## Objetivo

O IntelliQuote substitui processos manuais baseados em folhas de calculo e trocas de e-mails. O sistema permite:

- registar fornecedores
- criar pedidos de cotacao
- registar propostas recebidas
- comparar propostas com um algoritmo ponderado
- destacar automaticamente a proposta vencedora

## Stack Tecnologica

- `Node.js`
- `TypeScript`
- `Express`
- `Prisma ORM`
- `Supabase Postgres`
- frontend web estatico servido pelo proprio backend

## Funcionalidades do MVP

- CRUD de fornecedores
- CRUD de cotacoes
- CRUD de propostas
- comparacao automatica de propostas por cotacao
- fecho automatico da cotacao apos comparacao
- historico auditavel de comparacoes por cotacao
- auditoria operacional para create/update/delete/close/reopen/compare
- destaque visual da proposta vencedora
- filtros e paginacao local no frontend
- exportacao da comparacao em `CSV`
- autenticacao real por `email + password`, com sessao por cookies `HttpOnly`
- graficos simples para apoio a apresentacao

## Funcionalidades do Piloto (feedback dos usuarios)

- contatos secundarios por fornecedor (com flag "principal" exclusiva por fornecedor)
- anexos (PDF/planilha/imagem ate 5MB) em cotacoes, propostas e fornecedores, com download auditado
- recuperacao de senha com token de uso unico (1h) e listagem administrativa
- relatorios gerenciais (visao geral, economia estimada, lead time medio, top fornecedores, taxa de adjudicacao)
- central de ajuda in-app com artigos por modulo
- onboarding em 3 passos para novos utilizadores (visivel ate ser dispensado)
- wizard de 4 etapas para registo de propostas
- campos extras em fornecedores (pais, status, notas) e em cotacoes (codigo, moeda, prazo, descricao)

## Configuracao do Supabase

1. Criar um projeto no Supabase.
2. No dashboard, abrir `Connect`.
3. Copiar:
   - a ligacao `Session pooler` para `DATABASE_URL`
   - a ligacao `Direct connection` para `DIRECT_URL`

Exemplo:

```env
DATABASE_URL="postgresql://postgres.PROJECT_REF:SUA_SENHA@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
DIRECT_URL="postgresql://postgres:SUA_SENHA@db.PROJECT_REF.supabase.co:5432/postgres"
PORT=3000
JWT_ACCESS_SECRET="substitua-por-um-segredo-forte-de-acesso"
JWT_REFRESH_SECRET="substitua-por-um-segredo-forte-de-refresh"
JWT_ACCESS_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"
COOKIE_SECURE="false"
CORS_ORIGINS="http://localhost:3000,http://127.0.0.1:3000"
AUTH_RATE_LIMIT_WINDOW_MS="900000"
AUTH_RATE_LIMIT_MAX="20"
ADMIN_SEED_NAME="Administrador IntelliQuote"
ADMIN_SEED_EMAIL="admin@intelliquote.local"
ADMIN_SEED_PASSWORD="ChangeMe123!"
```

Observacao:

- em ambiente local, se as variaveis `JWT_*` e `ADMIN_SEED_*` nao forem definidas, o projeto usa defaults seguros para desenvolvimento
- antes de qualquer uso real em producao, substitua todos os segredos e credenciais seedadas

## Instalacao

```bash
npm install
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run prisma:seed
npm run dev
```

Observacao sobre `prisma:seed`:

- o seed passou a ser idempotente e deixa de apagar dados existentes;
- se a cotacao demo ja tiver historico de comparacao, o seed preserva esse historico e nao reescreve as propostas relacionadas.

## Testes

```bash
npm test
npm run smoke:local
npm run healthcheck:local
```

Validacao de ambiente local:

```bash
npm run verify:env:local
```

Observacao sobre `smoke:local`:

- exige a aplicacao ja a correr em `http://localhost:3000`, salvo se `INTELLIQUOTE_BASE_URL` for definido
- cria registos com prefixo `SMOKE-` na base configurada para validar o fluxo completo

## Operacao e Deploy

Artefactos adicionados para `staging` e `production`:

- `Dockerfile`
- `docker-compose.staging.yml`
- `docker-compose.production.yml`
- `.env.staging.example`
- `.env.production.example`
- `.github/workflows/ci.yml`
- `.github/workflows/release-artifact.yml`

Runbook operacional:

- [docs/OPERATIONS_RUNBOOK.md](/C:/Users/User/OneDrive%20-%20SQ%20Quimica/%C3%81rea%20de%20Trabalho/Intelliquote/docs/OPERATIONS_RUNBOOK.md)

## Acesso

- aplicacao web: `http://localhost:3000`
- health check: `http://localhost:3000/health`
- liveness: `http://localhost:3000/health/live`
- readiness: `http://localhost:3000/health/ready`

Credenciais locais do seed padrao, caso as variaveis `ADMIN_SEED_*` nao sejam definidas:

- utilizador: `admin@intelliquote.local`
- palavra-passe: `ChangeMe123!`

## Endpoints

- `GET /health`
- `GET /health/live`
- `GET /health/ready`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `GET /api/v1/audit`
- `GET /api/v1/suppliers`
- `POST /api/v1/suppliers`
- `GET /api/v1/suppliers/:id`
- `PUT /api/v1/suppliers/:id`
- `DELETE /api/v1/suppliers/:id`
- `GET /api/v1/quote-requests`
- `POST /api/v1/quote-requests`
- `GET /api/v1/quote-requests/:id`
- `PUT /api/v1/quote-requests/:id`
- `DELETE /api/v1/quote-requests/:id`
- `POST /api/v1/quote-requests/:id/close`
- `POST /api/v1/quote-requests/:id/reopen`
- `GET /api/v1/quote-request-items`
- `POST /api/v1/quote-requests/:quoteRequestId/items`
- `PUT /api/v1/quote-request-items/:id`
- `DELETE /api/v1/quote-request-items/:id`
- `GET /api/v1/quote-responses`
- `POST /api/v1/quote-responses`
- `GET /api/v1/quote-responses/:id`
- `PUT /api/v1/quote-responses/:id`
- `DELETE /api/v1/quote-responses/:id`
- `POST /api/v1/quote-requests/:quoteRequestId/compare`
- `GET /api/v1/quote-requests/:quoteRequestId/comparisons`
- `GET /api/v1/supplier-contacts`
- `POST /api/v1/supplier-contacts`
- `PUT /api/v1/supplier-contacts/:id`
- `DELETE /api/v1/supplier-contacts/:id`
- `GET /api/v1/attachments`
- `POST /api/v1/attachments`
- `GET /api/v1/attachments/:id/download`
- `DELETE /api/v1/attachments/:id`
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`
- `GET /api/v1/auth/password-recovery/tokens` (admin)
- `GET /api/v1/reports/summary`
- `GET /api/v1/reports/savings`
- `GET /api/v1/reports/lead-time`
- `GET /api/v1/reports/top-suppliers`
- `GET /api/v1/reports/award-rate`
- `GET /api/v1/help/articles`

## Guia Rapido para Demonstracao

1. Entrar com as credenciais do utilizador seedado no ambiente.
2. Mostrar metricas e graficos iniciais.
3. Abrir fornecedores, cotacoes e propostas ja semeadas.
4. Executar a comparacao de uma cotacao.
5. Mostrar a proposta vencedora no comparador e na tabela de cotacoes.
6. Exportar o resultado em `CSV`.

## CI

GitHub Actions em `.github/workflows/ci.yml` (raiz do monorepo). Roda em push/PR para `main`, `develop`, `feat/**` e `fix/**`.

Dois jobs:

1. **unit-and-build** — `npm ci` → prisma generate → `npm test` (Vitest, 87 casos + 1 skip) → `npm run build` (tsc) → `npm run build` no `web/`.
2. **e2e** — depende de `unit-and-build`. Sobe **Postgres 16** + **MailHog** como services, roda `prisma migrate deploy` + `prisma:seed`, instala Chromium do Playwright, executa `npm run test:e2e` (8 smoke tests + 2 skipped). Upload de `playwright-report/` em caso de falha (retention 7 dias).

### Secrets necessarios (uma vez)

Em **Settings → Secrets and variables → Actions**:

| Secret | Origem | Usado em |
|---|---|---|
| `FIREBASE_TOKEN` | `firebase login:ci` | (futuro deploy; ainda nao usado no CI) |

Para gerar: `npx firebase login:ci` em uma workstation local; copie o token impresso.

### Rodar local

```bash
npm test                 # unit (rapido, ~14s)
npm run test:e2e         # E2E (sobe dev se nao estiver up)
PLAYWRIGHT_BASE_URL=https://intelliquote-staging...run.app npm run test:e2e
```

