# IntelliQuote — Mapa de Dependencias entre Fases

> Documento vivo. Atualizado em 2026-06-23 para refletir o estado do codigo
> apos a Fase 5.D (migracao do frontend para React/Vite hospedado no
> Firebase Hosting) e a Fase 8 (cleanup de `public/index.html` legacy).

Este mapa mostra, em ordem, o caminho minimo de dependencias para colocar
o IntelliQuote em producao SaaS multi-tenant. Cada fase descreve **o que
foi entregue**, **o que desbloqueia** e **o que ainda depende dela**.

---

## Visao geral

```
Fase 0   →   Fase 1   →   Fase 2   →   Fase 3   →   Fase 4
  ↓           ↓           ↓           ↓           ↓
auth        suppliers   cotacoes    propostas   comparacao
HTTP        CRUD        +itens      +portal     +auditoria
                         +anexos     fornecedor  +relatorios
                                     +email

       ↓
Fase 5.A (cotacao → status workflow)
   ↓
Fase 5.B (taxas PTAX + fornecedores via BCB)
   ↓
Fase 5.C (template de e-mail editavel)
   ↓
Fase 5.D (frontend React/Vite + Firebase Hosting)   ← ATUAL
   ↓
Fase 6 (auditoria completa + auditoria de downloads)
   ↓
Fase 7 (rate-limit + politicas de seguranca)
   ↓
Fase 8 (cleanup `public/index.html` legacy)        ← ATUAL
   ↓
P0 multi-tenant (isolamento por empresa/workspace)
```

---

## Detalhamento por fase

### Fase 0 — Auth HTTP basico

- **Entregou:** login/logout, sessao via cookie httpOnly, middleware
  `requireAuth` + `allowRoles(['admin','comprador','gestor','viewer'])`.
- **Desbloqueia:** tudo que precisa identificar o usuario.
- **Depende de:** nada.
- **Arquivos-chave:** `src/middlewares/auth.ts`, `src/routes/AuthRoutes.ts`,
  `src/controllers/AuthController.ts`, `src/services/SessionService.ts`.

### Fase 1 — Fornecedores (CRUD)

- **Entregou:** `/api/v1/suppliers` (POST/GET/PUT/DELETE) com
  `acceptedIncoterms`, contatos secundarios, validacao por `taxId`,
  soft-delete com vinculo a `QuoteResponse`.
- **Desbloqueia:** Fase 2 (cotacoes precisam de destinatarios).
- **Depende de:** Fase 0.
- **Arquivos-chave:** `src/controllers/SupplierController.ts`,
  `src/controllers/SupplierContactController.ts`,
  `src/routes/SupplierRoutes.ts`.

### Fase 2 — Cotacoes + itens + anexos

- **Entregou:** `QuoteRequest`, `QuoteRequestItem`, `Attachment`,
  fluxo de criacao com NCM, quantidade, unidade, Incoterm desejado,
  moeda, prazo, multi-item com `CatalogItem` opcional.
- **Desbloqueia:** Fase 3 (fornecedor recebe cotacao).
- **Depende de:** Fase 1 (destinatarios existem).
- **Arquivos-chave:** `src/controllers/QuoteRequestController.ts`,
  `src/controllers/QuoteRequestItemController.ts`,
  `src/controllers/AttachmentController.ts`,
  `src/controllers/CatalogItemController.ts`,
  `src/routes/QuoteRequestRoutes.ts`,
  `src/routes/CatalogItemRoutes.ts`.

### Fase 3 — Propostas + portal do fornecedor + email

- **Entregou:** `QuoteResponse`, portal publico
  (`/portal?token=...`) sem autenticacao, geracao de link magico,
  envio de e-mail com template HTML, edicao posterior da resposta.
- **Desbloqueia:** Fase 4 (precisa de propostas para comparar).
- **Depende de:** Fase 2.
- **Arquivos-chave:** `src/controllers/QuoteResponseController.ts`,
  `src/controllers/DispatchController.ts`,
  `src/services/SupplierPortalService.ts`,
  `src/routes/PortalRoutes.ts`,
  `public/portal.html`.

### Fase 4 — Comparacao + auditoria + relatorios

- **Entregou:** `QuoteComparison` (selecao automatica por menor preco,
  empate por lead-time), `AuditLog` (create/update/delete com snapshot
  before/after), `/api/v1/audit` filtrado por entityType+entityId,
  `/api/v1/reports/*` (CSV/JSON).
- **Desbloqueia:** Fase 5.A (workflow de status).
- **Depende de:** Fase 3.
- **Arquivos-chave:** `src/controllers/ComparisonController.ts`,
  `src/services/QuoteComparisonService.ts`,
  `src/services/AuditLogService.ts`,
  `src/routes/AuditRoutes.ts`,
  `src/routes/ReportRoutes.ts`.

### Fase 5.A — Workflow de status (open/closed)

- **Entregou:** `QuoteRequestStatus` enum (`open`/`closed`),
  endpoint `POST /api/v1/quote-requests/:id/close` para vencedor,
  bloqueio de novas respostas apos fechamento, exportacao de relatorio
  consolidado.
- **Desbloqueia:** Fase 5.B.
- **Depende de:** Fase 4.

### Fase 5.B — Taxas PTAX + base de fornecedores via BCB

- **Entregou:** `ExchangeRateService` consultando a API Olinda do
  Banco Central do Brasil para USD/EUR/JPY/GBP/CHF/CNY, cron job
  diario, fallback gracioso por moeda, campo `ExchangeRateSnapshot`
  por cotacao.
- **Desbloqueia:** Fase 5.C.
- **Depende de:** Fase 5.A.
- **Arquivos-chave:** `src/services/ExchangeRateService.ts`,
  `src/routes/ExchangeRateRoutes.ts`,
  `prisma/migrations/*exchange_rate*`.

### Fase 5.C — Template de e-mail editavel

- **Entregou:** `EmailTemplate` com chave/locale/assunto/corpo HTML
  editaveis, endpoint `/api/v1/email-templates` (admin), preview
  publico `/portal/preview`, revisao institucional sem precisar deploy.
- **Desbloqueia:** Fase 5.D.
- **Depende de:** Fase 5.B.
- **Arquivos-chave:** `src/controllers/EmailTemplateController.ts`,
  `src/routes/EmailTemplateRoutes.ts`,
  `src/services/EmailTemplateService.ts`,
  `prisma/migrations/*email_template*`.

### Fase 5.D — Frontend React/Vite + Firebase Hosting

- **Entregou:** SPA em `programa/web/` (React 18 + TanStack Router/Query),
  build estatico copiado para
  `Portal COMEX/sq-comex-updates/hosting-intelliquote/` via
  `scripts/copy-to-firebase-hosting.mjs`, configuracao Firebase em
  `Portal COMEX/sq-comex-updates/firebase.intelliquote.json`,
  LoginGate via link magico portal-comex, AuthProvider + axios client
  com cookies httpOnly, deploy via `firebase deploy --only hosting:intelliquote`.
- **Desbloqueia:** Fase 6.
- **Depende de:** Fase 5.C.
- **Arquivos-chave:** `programa/web/src/*`,
  `Portal COMEX/sq-comex-updates/firebase.intelliquote.json`,
  `programa/web/scripts/copy-to-firebase-hosting.mjs`.

### Fase 6 — Auditoria completa + auditoria de downloads

- **Entregou:** `AuditLog` ja gravando (Fase 4) agora com diff visual
  no painel admin, tracking de downloads de anexos, motivo de mudanca
  obrigatorio em updates criticos.
- **Desbloqueia:** Fase 7.
- **Depende de:** Fase 5.D.

### Fase 7 — Rate-limit + politicas de seguranca

- **Entregou:** `helmet` + `cors` ja configurados (Fase 0),
  `express-rate-limit` no portal publico, deteccao de brute-force em
  `/auth/login`, headers HSTS, CSP estrita.
- **Desbloqueia:** Fase 8.
- **Depende de:** Fase 6.

### Fase 8 — Cleanup `public/index.html` legacy

- **Entregou:** Remocao definitiva de `programa/public/index.html`,
  `programa/public/app.js`, `programa/public/styles.css`,
  `programa/public/styles.legacy.css`. Rota raiz `/` no backend
  agora responde `404` JSON explicando o redirecionamento. SPA
  React e a unica fonte de UI; portal do fornecedor continua em
  `public/portal.html`.
- **Desbloqueia:** P0 multi-tenant.
- **Depende de:** Fase 7.
- **Arquivos-chave:** `programa/src/app.ts`,
  `programa/scripts/copy-web.js`,
  `programa/Dockerfile`.

---

## Backlog P0 (multi-tenant)

Apos a Fase 8, o IntelliQuote esta pronto para piloto single-tenant.
Para virar SaaS multi-tenant, os proximos itens sao:

| ID | Item | Depende de | Esforco |
|---|---|---|---|
| MT-1 | Schema `Workspace` + `WorkspaceMember` + tenantId em todas as tabelas | Fase 8 | ~3 semanas |
| MT-2 | Middleware de isolamento por tenant em todas as queries | MT-1 | ~2 semanas |
| MT-3 | Billing + checkout (Stripe) com limite por plano | MT-2 | ~2 semanas |
| MT-4 | Onboarding self-service + dominio customizado | MT-3 | ~2 semanas |
| MT-5 | SSO (SAML/OIDC) para planos enterprise | MT-3 | ~2 semanas |
| MT-6 | LGPD: exportacao/anonimizacao de dados por workspace | MT-2 | ~1 semana |
| MT-7 | Audit log multi-tenant com retencao configuravel | MT-2 | ~1 semana |

---

## Como ler este documento

- **Setas horizontais** sao a sequencia minima (Fase N depende da N-1).
- **Setas verticais** sao itens que ficam em paralelo mas precisam da
  fase "pai" estavel.
- Cada fase tem testes (`tests/*.test.ts`) e migrations Prisma
  (`prisma/migrations/*`) garantindo que o codigo que depende dela
  nao regrida silenciosamente.

Ultima revisao: 2026-06-23.
