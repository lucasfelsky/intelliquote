---
title: IntelliQuote - Agrupamento de itens por PO
tags: [intelliquote, cotacao, purchase-order, backend, frontend, migration]
sistema: IntelliQuote
branch: feat/po-agrupamento
commit: 5103c71
migration: 20261006120000_quote_request_purchase_orders
status: implementado, pendente de merge e de migration em staging/producao
data: 2026-10-07
fontes: commit 5103c71 (schema.prisma, migration.sql, QuotePurchaseOrderRoutes.ts, QuotePurchaseOrderController.ts, QuotePurchaseOrderService.ts, QuoteRequestItemRoutes.ts, QuoteRequestItemController.ts, validators/domain.ts, web/services/purchaseOrders.ts, CotacaoTabs/ItensTab.tsx, testes)
---

Nota de referencia do agrupamento de itens de uma cotacao (QuoteRequest) em POs (Purchase Orders) na aba **Itens** do IntelliQuote. Conteudo extraido do commit `5103c71` da branch `feat/po-agrupamento`. PLAN.md e REVIEW.md nao existem no repositorio; a mensagem do commit, o diff e os testes sao a fonte unica desta nota.

## PO de agrupamento (QuoteRequestPurchaseOrder)

A PO de agrupamento e um **rotulo ordenado dentro de uma cotacao** que organiza os itens em blocos. Nao gera documento, nao dispara e-mail e nao altera precos. Serve apenas para o comprador separar os itens (por exemplo, por embarque ou por centro de custo) e manter esse agrupamento salvo no banco.

Modelo Prisma `QuoteRequestPurchaseOrder` (tabela `"QuoteRequestPurchaseOrder"`):

| Campo | Tipo | Observacao |
|---|---|---|
| `id` | Int, autoincrement | chave primaria |
| `quoteRequestId` | Int | FK para `QuoteRequest`, `ON DELETE CASCADE` |
| `label` | String | rotulo exibido; 1 a 60 caracteres apos trim; default `PO {position}` |
| `position` | Int | ordem de exibicao, sempre normalizada para 1..N |
| `createdAt` / `updatedAt` | DateTime | padrao do projeto |

Alteracao em `QuoteRequestItem`:

| Campo | Tipo | Observacao |
|---|---|---|
| `purchaseOrderId` | Int?, nullable | FK para `QuoteRequestPurchaseOrder`, `ON DELETE SET NULL`; indice `QuoteRequestItem_purchaseOrderId_idx` |

Indices criados: `QuoteRequestPurchaseOrder_quoteRequestId_position_idx` e `QuoteRequestItem_purchaseOrderId_idx`.

Regras gerais do dominio:

- `QuoteRequest.purchaseOrders` passa a ser retornado em `GET /api/v1/quote-requests/:id`, ordenado por `position asc` (include adicionado em `QuoteRequestController`).
- Item com `purchaseOrderId = null` pertence ao grupo **"Sem PO"**.
- Toda escrita de PO exige cotacao com `status = open`. Cotacao `closed` responde **400**; cotacao com `deletedAt` preenchido responde **404**.
- Perfis autorizados a escrever: `admin` e `comprador` (`allowRoles`). `viewer` recebe **403** (coberto em teste de rota).
- Cada operacao roda em `prisma.$transaction` e grava `AuditLog` com `entityType = 'quote_request_purchase_order'` (acoes `create`, `rename`, `reorder`, `delete`) ou `entityType = 'quote_request_item'` com `action = 'move_po'`.
- Na interface, ao criar a **primeira** PO da cotacao a aba Itens envia `adoptUnassigned: true`, de modo que todos os itens existentes migram para essa PO. POs seguintes nascem vazias.

## Regras de realocacao ao excluir

Implementadas em `QuotePurchaseOrderService.resolveReallocationTarget` e `deletePurchaseOrderWithReallocation`. **Itens nunca sao apagados** ao excluir uma PO; apenas o `purchaseOrderId` deles muda.

Ordem de decisao para a PO excluida, considerando apenas as POs da mesma cotacao:

1. **Anterior**: existe PO com `position` menor? Os itens vao para a de maior `position` abaixo da excluida.
2. **Proxima**: a excluida e a primeira (nenhuma anterior)? Os itens vao para a de menor `position` acima dela.
3. **"Sem PO"**: a excluida e a unica da cotacao? Os itens ficam com `purchaseOrderId = null`.

Apos a exclusao, `normalizePositions` reatribui `position` como 1..N contiguos (ordenacao por `position asc, id asc`).

Exemplo com tres POs (positions 1, 2, 3), validado no teste de banco `critical-fixes-db.test.ts`:

| Acao | Destino dos itens | Positions restantes |
|---|---|---|
| Excluir PO 1 (primeira) | PO 2 (proxima) | PO 2 vira 1, PO 3 vira 2 |
| Excluir PO 3 (ultima) | PO 2 (anterior) | PO 2 vira 1 |
| Excluir PO 2 (unica) | `null` ("Sem PO") | nenhuma PO; itens preservados |

A confirmacao em `ItensTab.tsx` reproduz a mesma regra na mensagem exibida ao usuario, informando o nome da PO de destino ou "Sem PO".

## Endpoints R1-R6 com payloads

Todas as rotas ficam sob o prefixo `/api/v1`, exigem sessao autenticada (`requireAuth`) e perfil `admin` ou `comprador`. A numeracao R1-R5 segue o arquivo de teste `quote-purchase-order-routes.test.ts`; R6 e a extensao da rota de criacao de item.

Erros de validacao retornam `400` com `{ "message": "..." }`.

### R1 - Criar PO

`POST /api/v1/quote-requests/:quoteRequestId/purchase-orders`

Payload (ambos os campos opcionais; corpo vazio `{}` e aceito):

```json
{
  "label": "Embarque Shanghai",
  "adoptUnassigned": true
}
```

- `label`: string 1..60 apos trim; omitido ou vazio gera `PO {position}`.
- `adoptUnassigned`: default `false`; quando `true`, todos os itens da cotacao com `purchaseOrderId = null` passam para a PO criada.
- A nova PO recebe `position = (maior position atual) + 1`.

Resposta `201`:

```json
{
  "purchaseOrder": {
    "id": 10,
    "quoteRequestId": 7,
    "label": "Embarque Shanghai",
    "position": 1,
    "createdAt": "2026-10-07T11:00:00.000Z",
    "updatedAt": "2026-10-07T11:00:00.000Z"
  },
  "movedItemIds": [101, 102]
}
```

### R2 - Renomear PO

`PATCH /api/v1/quote-request-purchase-orders/:id`

```json
{ "label": "Embarque Ningbo" }
```

- `label` obrigatorio, 1..60 apos trim; vazio retorna `400`.
- Resposta `200` com o objeto da PO atualizado (mesmo formato de `purchaseOrder` acima).

### R3 - Reordenar POs

`PUT /api/v1/quote-requests/:quoteRequestId/purchase-orders/order`

```json
{ "orderedIds": [12, 10, 11] }
```

- `orderedIds` deve conter **exatamente** todos os ids de PO da cotacao, sem repeticao; caso contrario `400` com a mensagem "A lista de POs deve conter exatamente todas as POs da cotacao, sem repeticao.".
- As `position` sao reatribuidas 1..N na ordem informada.
- Resposta `200` com array das POs na nova ordem.

### R4 - Excluir PO (com realocacao)

`DELETE /api/v1/quote-request-purchase-orders/:id`

Sem corpo. Aplica as regras da secao anterior. Resposta `200`:

```json
{
  "deletedId": 10,
  "reassignedToPurchaseOrderId": 11,
  "movedItemIds": [101, 102]
}
```

`reassignedToPurchaseOrderId` vem `null` quando os itens foram para "Sem PO".

### R5 - Mover item entre POs

`PATCH /api/v1/quote-request-items/:id/purchase-order`

```json
{ "purchaseOrderId": 11 }
```

ou, para enviar o item para "Sem PO":

```json
{ "purchaseOrderId": null }
```

- `purchaseOrderId` obrigatorio: inteiro positivo ou `null`.
- PO inexistente retorna `404`; PO de outra cotacao retorna `400` ("A PO informada nao pertence a cotacao do item.").
- Item inexistente retorna `404`; cotacao fechada retorna `400`.
- Resposta `200` com o item atualizado (inclui `quoteRequest` e `catalogItem`).

### R6 - Criar item ja vinculado a uma PO

`POST /api/v1/quote-requests/:quoteRequestId/items` (rota existente, campo novo)

```json
{
  "catalogItemId": 55,
  "quantity": 44000,
  "unit": "KG",
  "purchaseOrderId": 11
}
```

- `purchaseOrderId` e opcional; quando informado precisa ser inteiro positivo e pertencer a mesma cotacao, senao `400` ("A PO informada nao pertence a esta cotacao.").
- Os demais campos seguem a validacao ja existente do item (`productName` ou `catalogItemId`, `quantity`, `unit`, `desiredIncoterm`, `destinationPort`, `targetPrice`, `notes`).
- Na interface, o botao "+ Item nesta PO" preenche esse campo automaticamente; "+ Adicionar item" no cabecalho cria o item em "Sem PO".

Cliente web correspondente: `programa/web/src/services/purchaseOrders.ts` (`createPurchaseOrder`, `renamePurchaseOrder`, `reorderPurchaseOrders`, `deletePurchaseOrder`, `moveItemToPurchaseOrder`).

## Cotacoes antigas (itens sem PO)

A migration e **aditiva e sem backfill**: nenhuma PO e criada para cotacoes existentes e todos os itens antigos permanecem com `purchaseOrderId = null`.

Comportamento resultante:

- **Cotacao sem nenhuma PO** (`purchaseOrders = []`): a aba Itens renderiza a tabela unica anterior, sem cabecalhos de grupo, sem select "Mover para PO" e sem drag and drop. O unico elemento novo e o botao "+ Adicionar PO".
- **Primeira PO criada em cotacao antiga**: a interface envia `adoptUnassigned: true`, portanto os itens existentes passam todos para a nova PO e a tela muda para o modo agrupado.
- **Cotacao com POs e itens sem PO**: aparece o grupo "Sem PO" ao final, com os itens cujo `purchaseOrderId` e `null` ou aponta para uma PO que nao esta mais na lista.
- **Cotacao `closed`**: a aba fica somente leitura (sem botoes de PO, sem select, sem drag and drop); a API tambem recusa escrita com `400`.
- Nenhum endpoint existente mudou de contrato: `purchaseOrders` e `purchaseOrderId` sao campos adicionais na resposta de `GET /api/v1/quote-requests/:id`.

## Fora de escopo

O commit `5103c71` nao altera `programa/src/mailer`, o portal do fornecedor nem a comparacao. Em consequencia:

- **E-mail de envio (dispatch)**: a tabela de itens enviada ao fornecedor continua plana, sem separacao por PO. Reagrupar POs apos o envio nao reenvia nem altera e-mails ja disparados; a aba Itens exibe esse aviso quando a cotacao ja tem respostas ou envio.
- **Portal do fornecedor**: o formulario de resposta lista os itens sem agrupamento e nao recebe `purchaseOrderId`.
- **Comparacao de propostas** (`QuoteComparison` / `QuoteComparisonResult`): o ranking nao considera PO.
- **Template `quote_po` (Ordem de Compra ao fornecedor)**: o e-mail disparado por `POST /api/v1/quote-responses/:id/purchase-order` e o template `EmailTemplate.key = 'quote_po'` sao um conceito distinto (ordem de compra enviada ao vencedor) e nao foram tocados. A PO de agrupamento desta nota nao gera esse e-mail.
- Nao ha backfill, nao ha PO default e nao ha regra de negocio nova em `QuoteRequest` alem do include de `purchaseOrders`.

## Checklist da migration 20261006120000

Migration: `programa/prisma/migrations/20261006120000_quote_request_purchase_orders/migration.sql`. Conteudo: `CREATE TABLE "QuoteRequestPurchaseOrder"`, dois `CREATE INDEX`, `ALTER TABLE "QuoteRequestItem" ADD COLUMN "purchaseOrderId" INTEGER` e a FK `ON DELETE SET NULL`. Nao ha `UPDATE`, `DELETE` nem alteracao de colunas existentes, portanto e segura para aplicar com a aplicacao no ar.

A aplicacao em staging e producao e **responsabilidade do usuario**; nenhum agente executa migration. O container do backend roda `npx prisma migrate deploy` antes de iniciar o servidor (CMD do `programa/Dockerfile`), portanto a migration e aplicada automaticamente no primeiro deploy da imagem que contiver a pasta.

Antes do deploy:

- [ ] Branch `feat/po-agrupamento` revisada e mergeada em `main` (PR aprovado).
- [ ] `npm test --prefix programa` verde, incluindo o drift detector com `prisma models = 29`, `prisma migrations = 37` e `backend routes = 103` (`audit-vault.test.ts` e `fixtures/expected-inventory.json`).
- [ ] `node scripts/test-critical-local.mjs` verde em Postgres isolado (cobre o cenario de exclusao com realocacao).
- [ ] Backup logico do banco do ambiente (dump) antes do deploy.
- [ ] `npx prisma migrate status` no ambiente mostra apenas `20261006120000_quote_request_purchase_orders` como pendente.

Staging:

- [ ] Deploy da imagem; confirmar nos logs do container a linha de `migrate deploy` aplicando `20261006120000_quote_request_purchase_orders`.
- [ ] `npx prisma migrate status` sem pendencias.
- [ ] Verificar no banco: tabela `"QuoteRequestPurchaseOrder"` existe; coluna `"QuoteRequestItem"."purchaseOrderId"` existe e esta `NULL` em todos os itens antigos.
- [ ] Abrir uma cotacao antiga: aba Itens mostra a tabela unica (modo legado).
- [ ] Criar PO, renomear, reordenar, mover item (select e arrastar), excluir PO e confirmar a realocacao descrita nesta nota.
- [ ] Conferir `AuditLog` com `entityType = 'quote_request_purchase_order'` e `action = 'move_po'`.
- [ ] Enviar uma cotacao agrupada ao fornecedor e confirmar que o e-mail e o portal seguem sem agrupamento (comportamento esperado).

Producao:

- [ ] Janela de deploy comunicada a equipe COMEX.
- [ ] Backup logico atualizado imediatamente antes do deploy.
- [ ] Deploy da mesma imagem validada em staging; confirmar `migrate deploy` nos logs.
- [ ] `npx prisma migrate status` sem pendencias.
- [ ] Smoke: abrir cotacao antiga (modo legado) e criar/excluir uma PO em cotacao de teste.

Rollback: a migration nao destroi dados. Se for necessario reverter, remover a FK, a coluna `purchaseOrderId` e a tabela `QuoteRequestPurchaseOrder` descarta apenas os agrupamentos; itens e cotacoes permanecem intactos. Voltar a imagem anterior sem reverter o banco tambem funciona, pois a aplicacao antiga ignora a coluna nova.
