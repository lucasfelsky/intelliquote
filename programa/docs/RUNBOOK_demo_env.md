# Runbook — Ambiente de demonstração (IntelliQuote)

Objetivo: uma instância isolada pra avaliador/possível usuário testar TUDO, com **login único**, **dados fictícios**, **e-mails que não saem de verdade** e **reset automático noturno** — sem tocar nos dados reais da SQ.

Estratégia: **mesma imagem/código**. A instância demo é o backend com `DEMO_MODE=true` apontando pro schema `demo` (mesmo Supabase), e um web separado apontando pra esse backend.

> Pré-requisito: o PR1 (núcleo `DEMO_MODE`) já mergeado e a imagem backend com ele publicada.

---

## 1. Banco — schema `demo` no MESMO Supabase
No SQL editor do Supabase (projeto atual), rode UMA vez:
```sql
CREATE SCHEMA IF NOT EXISTS demo;
```
A `DATABASE_URL`/`DIRECT_URL` da instância demo vai apontar pra esse schema (passo 2). O Prisma `migrate deploy` (que roda no boot) cria as tabelas dentro de `demo`, isolado do `public` (dados reais).

> Observação: o app usa `?schema=` na connection string pra escolher o schema. Confirme que a URL demo tem `...&schema=demo` (e a `DIRECT_URL` idem). O usuário do Postgres precisa de permissão pra criar objetos no schema `demo`.

## 2. Backend demo — 2ª instância Cloud Run
Suba um serviço novo (ex.: `intelliquote-api-demo`) usando A MESMA IMAGEM do backend de produção (o CMD já roda `prisma migrate deploy` no boot). Variáveis de ambiente:
```
DEMO_MODE=true
MAILER_PROVIDER=console          # redundante: DEMO_MODE já força console, mas deixa explícito
DATABASE_URL=<supabase pooler url>?schema=demo&pgbouncer=true
DIRECT_URL=<supabase direct url>?schema=demo
DEMO_RESET_TOKEN=<gere um token forte, ex.: openssl rand -hex 32>
DEMO_USER_PASSWORD=<senha do login único de demo>
ADMIN_SEED_PASSWORD=<fallback da senha do usuário demo, se DEMO_USER_PASSWORD vazio>
# + os mesmos segredos de auth/JWT que o backend usa (chaves de token etc.) — pode reusar ou gerar próprios
```
Depois do 1º deploy, semeie os dados demo uma vez (Cloud Run Job ou local apontando pra URL demo):
```
npm run prisma:seed-demo
```
(ou deixe o 1º reset semear — ver passo 4.)

## 3. Web demo — 2º site no Firebase Hosting
Crie um site/target novo (ex.: `intelliquote-demo`) e faça o build do web apontando pro backend demo:
```
VITE_API_URL=<url do intelliquote-api-demo>   # confirme o nome exato da env de API do web
```
Deploy do web nesse target. (Opcional: subdomínio tipo `demo.intelliquote.<dominio>`.)

## 4. Reset automático — Cloud Scheduler noturno
Crie um job do Cloud Scheduler (ex.: todo dia 04:00) com target HTTP:
```
Método: POST
URL:    <url do intelliquote-api-demo>/admin/demo/reset
Header: x-demo-reset-token: <o mesmo DEMO_RESET_TOKEN do passo 2>
```
O endpoint só responde se `DEMO_MODE=true` E o token bater (senão 404/401). Ele apaga os dados de aplicação do schema `demo` e re-semeia — o avaliador sempre pega uma base limpa no dia seguinte.

> Teste manual do reset (uma vez, pra validar): `curl -X POST <url>/admin/demo/reset -H "x-demo-reset-token: <token>"` → deve voltar `{ ok: true, reseeded: {...} }`. No backend de PRODUÇÃO o mesmo curl deve dar **404** (prova do isolamento).

## 5. Login único (entregar ao avaliador)
```
URL:   <url do web demo>
E-mail: demo@intelliquote.demo      # confirme no prisma/seed-demo.ts
Senha:  <DEMO_USER_PASSWORD do passo 2>
```

---

## Garantias de isolamento (por que é seguro)
- **Dados**: schema `demo` ≠ `public`. Nenhuma query da instância demo alcança os dados reais.
- **E-mail**: `DEMO_MODE` força `ConsoleMailer` — dispatch/PO/reply viram log, não saem pra fornecedor real.
- **Reset**: destrutivo, mas só roda com `DEMO_MODE=true` + token; em prod é 404. E mesmo se chamado, só toca o schema `demo`.
- **Imagem única**: subir o `DEMO_MODE` na prod normal é inócuo (flag default false).

## Custos/observações
- Mesmo projeto Supabase (sem projeto novo) — schema demo compartilha a instância; custo marginal.
- 2 recursos novos que podem gerar custo: o serviço Cloud Run demo (escala a zero quando ocioso) e o job do Scheduler (irrisório).
- Pendente pós-PR1: **PR2** adiciona o banner "Ambiente de demonstração" no web (lê um flag do backend), pra o avaliador saber que é sandbox.
