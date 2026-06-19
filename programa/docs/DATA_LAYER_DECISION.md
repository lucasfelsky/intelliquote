# Decisão de Camada de Dados — IntelliQuote

**Data:** 16/06/2026
**Status:** proposta para revisão (sem implementação ainda)
**Contexto:** o IntelliQuote roda hoje em Node.js + Express + Prisma + PostgreSQL (Supabase). O Portal COMEX roda em React/Vite + Firebase Hosting + Firestore. O objetivo deste documento é registrar a análise dos caminhos possíveis para mover o IntelliQuote para o Firebase, e o que isso significa na prática para o modelo relacional atual, a autenticação e a integração futura entre os dois produtos.

---

## 1. Resumo executivo

| | Hoje (Supabase + Postgres + JWT) | Caminho A — Firestore puro | Caminho B — Cloud SQL + Firebase Auth | Caminho C — Híbrido |
| --- | --- | --- | --- | --- |
| Banco | Postgres (Supabase) | Firestore (NoSQL) | Postgres (Cloud SQL) + Firestore opcional | Postgres (Supabase) + Firebase Auth |
| Auth | JWT próprio (cookie `HttpOnly`) | Firebase Auth | Firebase Auth | Firebase Auth |
| RBAC | Middleware Express `allowRoles` | Firestore Security Rules | Middleware Express | Middleware Express |
| Migração de schema | — | Reescrita total (modelos viram coleções) | Trocar `DATABASE_URL` | Trocar adaptador de auth |
| Esforço | — | 4–8 semanas | 2–3 dias | 3–5 dias |
| Risco | — | Alto | Baixo | Baixo |
| Integração com COMEX | Nenhuma | Alta (mesmo banco) | Média (auth compartilhada) | Alta (auth + dados compartilhados futuros) |
| Recomendação | Estado atual | Médio/longo prazo | Curto prazo | **Curto prazo (recomendado)** |

**Recomendação imediata:** **Caminho C (Híbrido)**. Mantém o Postgres atual, troca o JWT próprio por **Firebase Auth** no mesmo projeto do Portal COMEX, e deixa Firestore/Cloud SQL para uma fase posterior, quando a integração de domínio entre os dois produtos for discutida com calma.

---

## 2. O que muda em cada caminho

### 2.1. Caminho A — Firestore puro

#### Trade-offs
- ✅ Mesmo banco do Portal COMEX → dados compartilháveis nativamente.
- ✅ Free tier generoso, escala horizontal automática, listeners em tempo real (`onSnapshot`).
- ✅ Firebase Auth com redes sociais, MFA, custom claims.
- ❌ Modelo relacional do `schema.prisma` precisa ser reescrito como coleções e subcoleções.
- ❌ `JOIN` não existe: vira `where` + leitura em lote + denormalização quando necessário.
- ❌ `Decimal` (preços, câmbio, impostos) vira `number` (com risco de precisão) ou `string` parseada.
- ❌ `enum` (Incoterm, QuoteRequestStatus) precisa virar validação manual ou array de strings controladas.
- ❌ Auditoria: o "before/after" do `AuditLog` precisa virar triggers (`onWrite`) ou comparação de snapshots salvos no documento.
- ❌ Comparação ponderada: hoje roda em transação Postgres; no Firestore vira Cloud Function com leitura em lote das respostas + gravação atômica do resultado.
- ❌ RBAC precisa ser reescrito com **Firestore Security Rules** (DSL) — perde-se a flexibilidade do middleware Express, e regras compostas ficam verbosas.
- ❌ Testes: `supertest` + `vitest` continuam ok, mas o "banco em memória" do Firestore é o **emulator**, que precisa ser iniciado no CI.

#### Esboço de mapeamento Prisma → Firestore

| Tabela Prisma | Coleção Firestore | Observação |
| --- | --- | --- |
| `User` | `users/{uid}` | `uid` é o do Firebase Auth (string). `role` vira custom claim. |
| `Role` | (removida) | Roles viram custom claims + constantes no app. |
| `Session` | (removida) | Firebase Auth gerencia sessão via ID token + refresh token. |
| `PasswordResetToken` | (removida) | Firebase Auth tem `generatePasswordResetLink` nativo. |
| `Supplier` | `suppliers/{supplierId}` | ID numérico vira string (Firestore ID) ou mantém numérico em campo `legacyId`. |
| `SupplierContact` | `suppliers/{supplierId}/contacts/{contactId}` | Subcoleção. |
| `QuoteRequest` | `quoteRequests/{quoteRequestId}` | Auto-ID. |
| `QuoteRequestItem` | `quoteRequests/{quoteRequestId}/items/{itemId}` | Subcoleção. |
| `QuoteResponse` | `quoteRequests/{quoteRequestId}/responses/{responseId}` | Subcoleção. |
| `QuoteComparison` | `quoteRequests/{quoteRequestId}/comparisons/{comparisonId}` | Subcoleção. |
| `QuoteComparisonResult` | embutido em `QuoteComparison.results[]` | Lista de objetos dentro do documento. |
| `Attachment` | `attachments/{attachmentId}` + Storage | Metadados no Firestore, arquivo no Firebase Storage. |
| `AuditLog` | `auditLogs/{logId}` (raiz) | Sem FK forte: `actorUid` + `entityRef` desnormalizado. |
| `HelpArticle` | `helpArticles/{articleId}` (raiz) | Igual. |

#### Esboço de Security Rules (RBAC)

```js
// firestore.rules
match /databases/{database}/documents {
  function role() {
    return request.auth.token.role;
  }
  function isAdmin() { return role() == 'admin'; }
  function isGestor() { return role() == 'gestor' || isAdmin(); }

  match /suppliers/{supplierId} {
    allow read: if request.auth != null;
    allow write: if isAdmin() || role() == 'comprador';
  }
  match /quoteRequests/{quoteRequestId} {
    allow read: if request.auth != null;
    allow create, update: if isAdmin() || role() == 'comprador';
    allow delete: if isAdmin();
    match /responses/{responseId} {
      allow read, create, update: if request.auth != null;
      allow delete: if isAdmin();
    }
  }
  match /auditLogs/{logId} {
    allow read: if isGestor();
    allow write: if false; // só Cloud Functions gravam
  }
  match /users/{uid} {
    allow read, update: if request.auth.uid == uid || isAdmin();
    allow create, delete: if isAdmin();
  }
}
```

#### Passos da migração
1. Provisionar projeto Firebase (pode ser o mesmo do COMEX).
2. Habilitar Authentication (e-mail/senha), Firestore e Storage.
3. Definir custom claims no Auth (script Node para promover o admin seed).
4. Reescrever `prisma/schema.prisma` como `firestore-schema.md` (documento) e criar `firestore-seed.ts` com o seed inicial (usuários demo).
5. Trocar `@prisma/client` por `firebase-admin/firestore` em todos os `repositories/*` e `controllers/*`.
6. Reescrever `services/audit.ts` para usar Cloud Function `onWrite` em `quoteRequests` e `quoteResponses`.
7. Substituir o middleware `requireAuth` por validador de ID token do Firebase.
8. Migrar arquivos de anexo para Firebase Storage (URLs assinadas no Firestore).
9. Atualizar `package.json` scripts (substituir `prisma:generate` por `firestore:rules`).
10. Atualizar CI para iniciar Firestore Emulator.
11. Reescrever testes para usar `@firebase/rules-unit-testing` ou mockar o SDK admin.

### 2.2. Caminho B — Cloud SQL + Firebase Auth

#### Trade-offs
- ✅ Menor mudança possível no backend: troca o adapter, mantém Prisma, mantém Express, mantém testes.
- ✅ Postgres relacional continua sendo o melhor para o domínio do IntelliQuote (joins, transações, decimais exatos).
- ✅ Firebase Auth no mesmo projeto do COMEX → login unificado.
- ❌ Dois bancos diferentes: Firestore (COMEX) e Postgres (IntelliQuote). Se quiser dados **compartilhados em tempo real**, precisa sincronizar via Cloud Functions.
- ❌ Cloud SQL tem custo fixo (mínimo ~US$ 10/mês na instância `db-f1-micro`).
- ❌ Anexos continuam em disco local (ou S3) — não aproveita Firebase Storage.

#### Passos da migração
1. Provisionar Cloud SQL Postgres no projeto Firebase (ou subir Supabase → continuar Supabase e só trocar o adapter de auth).
2. Apontar `DATABASE_URL` e `DIRECT_URL` para a nova instância.
3. Rodar `prisma migrate deploy`.
4. Adicionar `firebase-admin` no backend.
5. Trocar o middleware `requireAuth` para validar o `Authorization: Bearer <idToken>` com `firebase-admin/auth.verifyIdToken`.
6. Adicionar endpoint `POST /api/v1/auth/session` que troca um ID token do Firebase por cookies `HttpOnly` (opcional, para manter a UX atual).
7. Mapear `role` do Firestore custom claim → variável local.
8. Atualizar `seed.ts` para criar usuários via `firebase-admin/auth.createUser` e setar custom claims.

### 2.3. Caminho C — Híbrido (recomendado)

#### Trade-offs
- ✅ Esforço mínimo (3–5 dias), risco mínimo.
- ✅ Login unificado com Portal COMEX já no curto prazo.
- ✅ Mantém o modelo relacional e os testes como estão.
- ✅ Custo praticamente igual ao atual (só adiciona o custo mínimo do Firebase Auth, que é gratuito).
- ❌ Anexos e dados do IntelliQuote continuam fora do Firebase (no Supabase Storage local, no futuro pode migrar para Firebase Storage).
- ❌ Integração em tempo real com o COMEX ainda não é nativa — precisa de Cloud Functions se virar requisito.

#### Passos da migração
1. Provisionar Firebase no mesmo projeto (ou usar o projeto já existente do COMEX).
2. Habilitar **apenas** Firebase Authentication (e-mail/senha).
3. Adicionar `firebase-admin` no backend IntelliQuote.
4. Trocar o middleware `requireAuth` para validar o `Authorization: Bearer <idToken>`.
5. Criar uma rotina de bootstrap: no primeiro login de cada usuário, criar/sincronizar o registro local em `users` com base nos custom claims do Firebase.
6. Atualizar o frontend para usar `signInWithEmailAndPassword` (SDK JS do Firebase) e enviar o ID token no header de cada requisição.
7. Manter o `PasswordResetToken` (porque o Supabase não compartilha com Firebase Auth), ou passar a usar o `sendPasswordResetEmail` do Firebase.

---

## 3. Análise de impacto por área do IntelliQuote

### 3.1. Autenticação
- Hoje: bcrypt + JWT (access 15 min + refresh 7 d) + cookie `HttpOnly`.
- Caminho A: Firebase Auth, ID token 1 h, refresh automático.
- Caminho B: Firebase Auth, ID token validado no backend Express.
- Caminho C: igual ao B, mas mantém o cookie `HttpOnly` para o frontend estático.

### 3.2. RBAC
- Hoje: middleware `allowRoles(['admin', 'comprador', 'gestor', 'viewer'])`.
- Caminho A: precisa migrar para Firestore Security Rules (ou manter middleware no backend consumindo custom claims).
- Caminhos B/C: middleware continua igual, lendo o role do custom claim do Firebase.

### 3.3. Auditoria
- Hoje: tabela `AuditLog` com snapshot `before`/`after` gravada em transação.
- Caminho A: vira Cloud Function `onWrite` no Firestore (latência maior) ou append em coleção `auditLogs` na própria operação.
- Caminhos B/C: inalterado.

### 3.4. Comparação ponderada
- Hoje: `prisma.$transaction` em `ComparisonController.compare` (atomicidade forte).
- Caminho A: Cloud Function + `runTransaction()` do Firestore (atomicidade local por documento; subcoleções exigem leitura em lote antes da escrita).
- Caminhos B/C: inalterado.

### 3.5. Anexos
- Hoje: arquivo em `./uploads/`, metadados em `Attachment`, download auditado.
- Caminho A: arquivo no Firebase Storage, URL assinada no Firestore, regra de Storage controla acesso.
- Caminhos B/C: inalterado (no curto prazo). Pode-se mover para Firebase Storage depois, mantendo a interface.

### 3.6. Recuperação de senha
- Hoje: tabela `PasswordResetToken`, rate limit, devToken em ambiente de desenvolvimento.
- Caminho A: `firebase/auth/sendPasswordResetEmail` nativo, com link hospedado.
- Caminhos B/C: opcional migrar para Firebase, ou manter o fluxo atual.

### 3.7. Testes
- Hoje: `vitest` + `supertest` + mock do Prisma.
- Caminho A: precisa do **Firestore Emulator** no CI.
- Caminhos B/C: inalterado.

### 3.8. Deploy / CI
- Hoje: Dockerfile + `docker-compose` + GitHub Actions.
- Caminho A: substituir docker-compose por `firebase deploy` (Hosting + Functions + Rules + Storage).
- Caminhos B/C: adicionar step para deploy de regras do Firebase Auth (apenas secrets).

### 3.9. Custos
- Hoje: Supabase free tier + Render/Railway free tier.
- Caminho A: Firestore free tier (1 GB armazenamento, 50 k leituras/dia, 20 k escritas/dia) → após escala, ~US$ 0.18/100 k leituras, ~US$ 0.18/100 k escritas.
- Caminho B: Cloud SQL `db-f1-micro` ~US$ 10/mês + Firebase Auth gratuito.
- Caminho C: praticamente zero de mudança (Firebase Auth é gratuito).

---

## 4. Critérios de escolha

A escolha deve ser feita depois de responder:

1. **Qual é o objetivo da integração com o Portal COMEX?**
   - Apenas login único → Caminho C.
   - Login único + dados de fornecedores compartilhados → Caminho A.
   - Login único + dashboard consolidado → Caminho A com Cloud Functions de agregação.
2. **Qual o orçamento mensal de infraestrutura?**
   - < US$ 25/mês → Caminho C.
   - Até US$ 100/mês → Caminho B ou A.
3. **Qual a tolerância a reescrita?**
   - Zero tolerância → Caminho C.
   - Moderada → Caminho B.
   - Alta → Caminho A.
4. **Quantos devs vão mexer no código?**
   - 1 dev, sem experiência em Firestore → Caminho C.
   - 1-2 devs com tempo para aprender → Caminho B.
   - Equipe com experiência em GCP/Firestore → Caminho A.

---

## 5. Roadmap sugerido

### Fase 0 — agora (Caminho C)
- [ ] Provisionar projeto Firebase (mesmo do COMEX).
- [ ] Habilitar Authentication (e-mail/senha).
- [ ] Trocar middleware de auth para validar Firebase ID token.
- [ ] Sincronizar usuários Supabase ↔ Firebase Auth.
- [ ] Atualizar frontend para usar `signInWithEmailAndPassword`.
- [ ] Manter Postgres/Prisma como está.
- **Entrega:** login unificado com Portal COMEX, zero mudança no domínio.

### Fase 1 — depois (avaliação)
- [ ] Medir uso de leitura/escrita no Firestore do COMEX e projetar o que o IntelliQuote geraria.
- [ ] Avaliar se vale a pena mover **anexos** para Firebase Storage (ganho de CDN + redução de custo de disco).
- [ ] Avaliar se vale mover **notificações** para Firestore (ganho de tempo real com o COMEX).

### Fase 2 — longo prazo (Caminho A, condicional)
- [ ] Só executar se a Fase 1 confirmar ganho de integração.
- [ ] Reescrever modelo relacional como coleções.
- [ ] Reescrever controllers para Firestore SDK.
- [ ] Migrar RBAC para Security Rules + custom claims.
- [ ] Atualizar CI com Firestore Emulator.

---

## 6. Conclusão

Para o curto prazo, **Caminho C** entrega 80% do valor (login unificado) com 20% do esforço, sem reescrita. É a evolução natural do IntelliQuote. O Firestore puro (Caminho A) é o destino final se a integração com o Portal COMEX virar um requisito de produto confirmado, mas só faz sentido depois que o modelo relacional estiver maduro e a equipe tiver tempo para reescrever os controllers. O Caminho B é o meio-termo para quem quer subir tudo no GCP/Cloud SQL mas manter Postgres.

A decisão final depende da resposta à pergunta 1 acima. Sugiro marcar uma conversa com o time do Portal COMEX para validar o escopo de integração antes de comprometer a migração.
