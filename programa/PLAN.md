# PLAN: Importação em massa de fornecedores via planilha .xlsx (aba Fornecedores)
**Repo:** INTELLIQUOTE
**Worktree:** `Intelliquote\wt-fornecedores-import\programa` | branch `feat/fornecedores-import-planilha` (base `origin/main` 4a6f886). Worktree LIMPO no início (`git status --porcelain` vazio). NÃO tocar no checkout principal `Intelliquote\programa`.
**Escopo:** DENTRO: (a) backend com 3 endpoints novos (`GET /suppliers/import/template`, `POST /suppliers/import` = preview, `POST /suppliers/import/confirm`), parser puro de linha extraído em `src/utils/supplierImport.ts`, schemas Zod, 1 transação Prisma por linha (fornecedor + contato principal + famílias) com auditoria; (b) frontend com botão "Importar planilha" ao lado de "+ Novo fornecedor" abrindo modal de 3 passos (upload / preview / resultado) com link "Baixar modelo"; (c) testes (unit do parser, DB gated, web). FORA: migration/schema, índice único em `Supplier.name`, criação automática de família, alteração do import de catálogo, refatoração de `Itens.tsx`, deploy.

## Decisões já fechadas (NÃO reabrir)
- Colunas em ordem fixa, cabeçalho na linha 1: `Nome*`, `País`, `Website`, `Incoterms*`, `Prazo pagamento (dias)`, `Famílias`, `Tags`, `Observações`, `Contato nome`, `Contato e-mail`, `Contato telefone`, `Contato cargo`.
- Incoterms separados por `,`, validados contra o enum `Incoterm` (prisma/schema.prisma L22-34), ≥1. Prazo inteiro ≥0, default 30. Famílias separadas por `;`. Tags separadas por `,`.
- Contato: se nome OU e-mail preenchido, os dois são obrigatórios e o e-mail precisa ser válido. Criado como `SupplierContact` com `isPrimary=true`.
- Duplicado: nome igual (trim + case-insensitive) a fornecedor NÃO deletado existente -> linha rejeitada no preview com "já cadastrado". Duplicado dentro da própria planilha -> rejeita as linhas POSTERIORES. O confirm re-checa (race) e NUNCA sobrescreve.
- Família precisa existir (match case-insensitive, `isActive: true`). Família desconhecida -> rejeita a linha (NÃO cria; difere do PR #71 do catálogo).
- Status dos criados: `active`. Roles: `admin` + `comprador`.

## Decisões do planner (justificadas)
1. **Modelo .xlsx via endpoint GET que devolve JSON `{ fileName, contentBase64 }`**, gerado no backend com `exceljs` (já é dependência da raiz, `package.json` L33; NÃO existe no `web/package.json`). Motivos: (i) fonte única da lista de colunas (`SUPPLIER_IMPORT_COLUMNS`) compartilhada entre parser, validação de cabeçalho e modelo, sem drift; (ii) não adiciona ~1 MB de `exceljs` ao bundle web; (iii) `web/src/api/client.ts` (L145-160) lança erro em resposta não-JSON, então responder JSON com base64 reaproveita o client (auth, refresh 401, `buildUrl`) sem mudar nada nele. Arquivo estático em `web/public` foi descartado: binário não versionável pelo fluxo do dev e duplicaria a definição das colunas.
2. **Validação do cabeçalho no preview**: a ordem é fixa, então se a linha 1 não bater com `SUPPLIER_IMPORT_COLUMNS` (comparação normalizada: trim, lowercase, sem acento, sem `*`), o preview responde 400 "Cabeçalho da planilha não corresponde ao modelo. Baixe o modelo e tente novamente." Isso evita importar coluna trocada sem aviso.
3. **Contato parcial**: se só telefone/cargo estiverem preenchidos (sem nome e e-mail), a linha é rejeitada ("Contato: nome e e-mail são obrigatórios quando algum campo de contato é preenchido"). Isso evita perder dado sem aviso e mantém a regra do usuário (nome/e-mail -> ambos obrigatórios) intacta.
4. **Duplicado na planilha**: a 1ª ocorrência de um nome (normalizado) fica "reservada" mesmo que seja inválida por outro motivo; as posteriores são rejeitadas com "Fornecedor duplicado na planilha (linha N)". A regra fica determinística.
5. **Race no confirm**: dentro da transação da linha, `pg_advisory_xact_lock(hashtext(<nome normalizado>))` via `tx.$executeRaw` (tagged template, parametrizado) antes do `findFirst` de duplicado. Isso serializa imports concorrentes do mesmo nome. Não existe unique em `Supplier.name` e adicionar um exigiria migration (fora de escopo).
6. **Modal extraído para componente novo** e montado condicionalmente (`{isImportOpen && <SupplierImportModal … />}`) porque `Fornecedores.tsx` já tem 1013 linhas e `Fornecedores.test.tsx` L107 afirma `getDialogs(container).length === 2`. Com montagem condicional, o teste existente e os índices `dialogAt(0|1)` continuam válidos, e o estado do modal zera ao fechar.
7. **Um erro por linha com todos os motivos**: o parser acumula `reasons: string[]` e o controller devolve `reason = reasons.join('; ')`.

## Arquivos afetados
Backend (raiz `programa/`):
- `src/utils/supplierImport.ts` - **NOVO**. `SUPPLIER_IMPORT_COLUMNS` (12 labels), `SUPPLIER_IMPORT_MAX_ROWS = 500`, `normalizeSupplierName(s)` (trim + lowercase), `isSupplierImportHeaderValid(cells: string[])`, `parseSupplierRow(cells: string[], ctx)` PURO (sem prisma, sem exceljs). `ctx = { familiesByName: Map<string,{id,name}>, existingNames: Set<string>, seenNames: Map<string, number>, rowNumber: number }`. Retorna `{ ok: true, data }` ou `{ ok: false, name, reasons }`. Também `buildSupplierImportTemplate(): Promise<Buffer>` (exceljs: aba 1 "Fornecedores" só com o cabeçalho + aba 2 "Instruções" com o formato de cada coluna e a lista de Incoterms). `src/utils` NÃO está no inventário do `audit-vault`.
- `src/controllers/SupplierImportController.ts` - **NOVO**. `template`, `preview`, `confirm` (padrão de `src/controllers/CatalogItemImportController.ts`, com Zod + `handleControllerError` + `AuditLogService.log`, que o controller de catálogo não tem).
- `src/validators/domain.ts` - adicionar `supplierImportPreviewSchema`, `supplierImportRowSchema`, `supplierImportConfirmSchema` depois de `supplierUpdateSchema` (~L157), reaproveitando `requiredTrimmedStringField`, `nullableTrimmedStringField`, `incotermField`, `nonNegativeIntegerField`, `tagsField`, `familyIdsField`, `lowercasedEmailField` (todos confirmados no arquivo).
- `src/routes/SupplierRoutes.ts` - registrar as 3 rotas NO TOPO, ANTES de `GET /suppliers/:id` (senão `GET /suppliers/import/template` cai em `/:id` e responde 400 "ID do fornecedor invalido").
- `src/app.ts` - 1 linha junto da L59: `app.use('/api/v1/suppliers/import', express.json({ limit: '10mb' }));` antes do parser global de 1mb (L69).
- `tests/fixtures/expected-inventory.json` - adicionar `"SupplierImportController.ts"` em `backend.controllers` (ordem alfabética) e `"GET /suppliers/import/template"`, `"POST /suppliers/import"`, `"POST /suppliers/import/confirm"` em `backendRoutes` (ordem alfabética).
- `tests/audit-vault.test.ts` - L70: `backend routes = 94` -> `backend routes = 97`.
- `tests/supplier-import-parser.test.ts` - **NOVO**, sem DB.
- `tests/supplier-import-db.test.ts` - **NOVO**, gated `testDbSkip` como em `tests/catalog-item-import-db.test.ts`.

Frontend (`programa/web/`):
- `web/src/components/SupplierImportModal.tsx` - **NOVO**. Modal de 3 passos + "Baixar modelo". Usa `Modal` (`web/src/components/Modal.tsx`), `api` de `@/api/client`, `useMutation`/`useQueryClient`. Tem cópia local de `readFileAsBase64` (mesma implementação de `web/src/pages/Itens.tsx` L82-94; NÃO extrair util compartilhado, isso mexeria em `Itens.tsx`).
- `web/src/pages/Fornecedores.tsx` - só: import do componente, `useState` `isImportOpen`, botão `ghost-button` "Importar planilha" antes de "+ Novo fornecedor" (L473-475), e `{isImportOpen && <SupplierImportModal onClose={…} />}` DEPOIS do último `</Modal>` (L1001). Diff estimado ≤15 linhas.
- `web/src/pages/Fornecedores.test.tsx` - novo `describe` do fluxo de importação.

## Passos
1. **Parser puro** (`src/utils/supplierImport.ts`):
   - Cells: 12 strings já `trim()`adas, índice 0..11 na ordem das colunas.
   - Nome vazio -> "Nome é obrigatório". Normalizado já em `existingNames` -> "Fornecedor já cadastrado". Normalizado já em `seenNames` -> "Fornecedor duplicado na planilha (linha N)". Senão registra `seenNames.set(norm, rowNumber)` (mesmo que a linha falhe por outro motivo).
   - Incoterms: split `,`, trim, `toUpperCase`, descarta vazios, dedup. Vazio -> "Informe ao menos um Incoterm". Inválido -> "Incoterm inválido: X" (validar com `Object.values(Incoterm)` de `@prisma/client`).
   - Prazo: vazio -> 30. Senão `/^\d+$/` -> `Number`. Senão "Prazo de pagamento deve ser um número inteiro de dias".
   - Famílias: split `;`, trim, descarta vazios, dedup case-insensitive. Cada uma via `familiesByName.get(lower)`. Ausente -> "Família não encontrada: X". Saída `familyIds` + `familyNames` (grafia do banco).
   - Tags: split `,`, trim, descarta vazios (dedup/limites ficam com `tagsField` do Zod no passo 2, que aplica `max(40)` por tag e `max(20)` tags).
   - Contato: se qualquer uma das colunas 9-12 estiver preenchida -> nome e e-mail obrigatórios; e-mail validado com `z.string().email()` e salvo em lowercase. Falha -> "Contato: nome e e-mail são obrigatórios quando algum campo de contato é preenchido" / "E-mail do contato inválido". Sem nada preenchido -> `contact: null`.
   - Por fim, validar `data` com `supplierImportRowSchema.safeParse` (passo 2). Falha do Zod vira motivo legível, por exemplo "Tags: máximo 20, até 40 caracteres cada".
   - `isSupplierImportHeaderValid`: compara as 12 células normalizadas (NFD sem diacríticos, lowercase, sem `*`, trim) com `SUPPLIER_IMPORT_COLUMNS` normalizadas.
   - Verificação: `npx vitest run tests/supplier-import-parser.test.ts`.
2. **Zod** (`src/validators/domain.ts`):
   - `supplierImportRowSchema = z.object({ name, country: nullable, website: nullable, acceptedIncoterms: z.array(incotermField).min(1), paymentTermsDays: nonNegativeIntegerField, familyIds: z.array(positiveIntegerField).default([]), tags: tagsField, notes: nullable, contact: z.object({ name: requiredTrimmedStringField, email: lowercasedEmailField, phone: nullable.optional(), position: nullable.optional() }).nullable() })`.
   - `supplierImportPreviewSchema = z.object({ contentBase64: z.string().min(1) })`.
   - `supplierImportConfirmSchema = z.object({ rows: z.array(z.object({ row: positiveIntegerField, data: supplierImportRowSchema })).min(1).max(500) })`.
   - Verificação: `npm run build`.
3. **Controller** (`src/controllers/SupplierImportController.ts`):
   - `template`: `buildSupplierImportTemplate()` -> `200 { data: { fileName: 'modelo-importacao-fornecedores.xlsx', contentBase64 } }`.
   - `preview`: Zod no body (400 "Envie a planilha em contentBase64."). Carrega o buffer com `exceljs`, usa `worksheets[0]` (sem aba -> 400) e valida o cabeçalho (400, texto da Decisão 2). Carrega `prisma.itemFamily.findMany({ where: { isActive: true } })` num Map lower->{id,name} e `prisma.supplier.findMany({ where: { deletedAt: null }, select: { name: true } })` num Set normalizado. `eachRow`: pula a linha 1 e linhas sem `hasValues`. Acima de 500 linhas, 1 errorLine "Limite de 500 linhas excedido" e ignora o resto (mesmo padrão do catálogo). Cells via `row.getCell(n).text?.trim() ?? ''`. Resposta `200 { data: { validLines: [{ row, ...data, familyNames }], errorLines: [{ row, name, reason }] } }`. Erros via `handleControllerError`.
   - `confirm`: Zod `supplierImportConfirmSchema` (400). Para cada `{row, data}`, `prisma.$transaction(async (tx) => { … })`:
     1. `await tx.$executeRaw\`SELECT pg_advisory_xact_lock(hashtext(${normalizeSupplierName(data.name)}))\``
     2. `tx.supplier.findFirst({ where: { deletedAt: null, name: { equals: data.name.trim(), mode: 'insensitive' } }, select: { id: true } })`. Se achar, `throw new HttpError(409, 'Fornecedor já cadastrado')`.
     3. Se `familyIds.length`: `tx.itemFamily.count({ where: { id: { in: familyIds }, isActive: true } })` precisa ser igual a `familyIds.length`, senão `HttpError(400, 'Família inativa ou removida')`.
     4. `tx.supplier.create({ data: { name, website, country, notes, paymentTermsDays, acceptedIncoterms, tags, status: SupplierStatus.active, createdById: req.user?.id ?? null, families: { connect: familyIds.map(id => ({ id })) } }, include: { families: { select: { id: true, name: true } } } })`.
     5. `AuditLogService.log({ entityType: 'supplier', entityId, action: 'create', performedById, afterData: supplier, metadata: { source: 'spreadsheet_import', row } }, tx)`.
     6. Se `contact`: `tx.supplierContact.create({ data: { supplierId, name, email, phone, position, isPrimary: true } })` + `AuditLogService.log({ entityType: 'supplier_contact', action: 'create', afterData: contact, metadata: { supplierId, source: 'spreadsheet_import' } }, tx)` (mesmo `entityType` de `SupplierContactController` L110-117).
   - Erro na linha -> `errorLines.push({ row, name, reason })`, usando `handleControllerError(err).message`. Sucesso -> `successLines.push({ row, supplierId, name })`. Resposta `200 { data: { successLines, errorLines } }`. NUNCA `update`/`upsert` em `Supplier`.
4. **Rotas + body limit**: 3 rotas no topo de `src/routes/SupplierRoutes.ts` com `requireAuth, allowRoles(['admin', 'comprador'])`. Linha do limite de 10mb em `src/app.ts` junto da L59.
5. **Inventário do audit-vault**: atualizar `tests/fixtures/expected-inventory.json` e `tests/audit-vault.test.ts` L70 (94 -> 97). Verificação: `npm run audit:vault` sai 0 e `npx vitest run tests/audit-vault.test.ts` passa.
6. **Testes backend**:
   - `tests/supplier-import-parser.test.ts` (sem DB): linha válida completa; nome vazio; Incoterm inválido (`XYZ`); Incoterm vazio; prazo vazio = 30; prazo `abc`; família desconhecida; família com case diferente resolve id; já cadastrado (via `existingNames`); duplicado na planilha (2ª chamada com o mesmo `seenNames` cita a linha da 1ª); contato só com nome; e-mail inválido; só telefone preenchido rejeita; `isSupplierImportHeaderValid` aceita cabeçalho com e sem acento e rejeita colunas trocadas; `buildSupplierImportTemplate()` relido com exceljs tem a linha 1 igual a `SUPPLIER_IMPORT_COLUMNS`.
   - `tests/supplier-import-db.test.ts` (gated `RUN_DB_TESTS`, setup/cleanup igual a `tests/catalog-item-import-db.test.ts` L10-64 com `runId`): preview cobrindo nome faltando, Incoterm ruim, família desconhecida, duplicado com existente, duplicado na planilha, e-mail de contato ruim e 1 linha válida; preview com cabeçalho trocado -> 400; confirm cria fornecedor `active` + contato `isPrimary=true` + famílias vinculadas + 2 `auditLog` (`supplier` e `supplier_contact`); race: criar o fornecedor via `prisma.supplier.create` entre preview e confirm -> errorLine "já cadastrado", `count` com o nome continua 1 e o `updatedAt` do existente não muda; GET template -> 200 com `contentBase64`. O cleanup apaga `auditLog`, contatos, fornecedores e famílias com `runId`.
7. **Frontend - componente** (`web/src/components/SupplierImportModal.tsx`), props `{ onClose: () => void }`, `<Modal isOpen onClose={handleClose} title="Importar fornecedores" size="wide">`:
   - Upload: texto com as 12 colunas na ordem, botão-link "Baixar modelo" (`api.get('/v1/suppliers/import/template')` -> base64 -> `Uint8Array` -> `Blob` (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) -> `URL.createObjectURL` -> `<a download>` click -> `revokeObjectURL`), `<input type="file" accept=".xlsx">`, botões "Cancelar" e "Carregar e validar".
   - Preview: "Encontramos N fornecedores válidos e M linhas com erro.", lista "Linha X (Nome): motivo" com o título "Linhas com erro (serão ignoradas):", botões "Voltar" e "Confirmar importação" (desabilitado se N=0). O confirm envia `{ rows: validLines.map(({ row, familyNames, ...data }) => ({ row, data })) }`.
   - Resultado: "N fornecedores importados com sucesso." + "Erros ao salvar:" + botão "Concluir".
   - Após o confirm com sucesso: `qc.invalidateQueries({ queryKey: ['suppliers'] })` e `qc.invalidateQueries({ queryKey: ['supplier-contacts-bulk'] })`.
   - Erros via `ApiError`/`body.message` (mesma lógica de `messageOf` em `Fornecedores.tsx` L1006, copiada localmente).
   - Toda a copy em pt-BR com acentos.
8. **Frontend - página** (`web/src/pages/Fornecedores.tsx`): mudanças mínimas descritas em "Arquivos afetados".
9. **Teste web** (`web/src/pages/Fornecedores.test.tsx`), mocks existentes de `api`:
   - (a) clicar "Importar planilha" abre dialog com título "Importar fornecedores";
   - (b) selecionar um `File` .xlsx e clicar "Carregar e validar" chama `api.post('/v1/suppliers/import', { contentBase64: expect.any(String) })` e mostra contagem + "Linha 3";
   - (c) "Confirmar importação" chama `api.post('/v1/suppliers/import/confirm', { rows: [...] })` sem `familyNames` e mostra o resultado;
   - (d) "Baixar modelo" chama `api.get('/v1/suppliers/import/template')`, com `URL.createObjectURL`/`revokeObjectURL` stubados via `vi.fn` (não existem no jsdom).
   - O teste existente de L107 (`length === 2`) deve continuar passando SEM edição.
10. **Gates** (seção abaixo), rodados da raiz `programa/`.

## Critérios de aceite (cada um é um COMANDO, rodar da raiz `programa/`, um por linha)
- [ ] `npm run build` sai 0 (tsc backend)
- [ ] `npm test` sai 0 (inclui `tests/supplier-import-parser.test.ts` e `tests/audit-vault.test.ts`; os DB tests ficam skip sem `RUN_DB_TESTS`)
- [ ] `npx vitest run tests/supplier-import-parser.test.ts` sai 0
- [ ] `npm run audit:vault` sai 0 (saída contém `backend routes = 97`)
- [ ] `npm --prefix web run typecheck` sai 0
- [ ] `npm --prefix web test` sai 0
- [ ] `npm --prefix web run build` sai 0
- [ ] (Opcional, precisa de Postgres LOCAL de dev com `DATABASE_URL` local; nunca staging/prod) `$env:RUN_DB_TESTS='true'; npx vitest run tests/supplier-import-db.test.ts` sai 0
- [ ] `git diff --stat` + `git status --porcelain` tocam SOMENTE: `src/utils/supplierImport.ts`, `src/controllers/SupplierImportController.ts`, `src/validators/domain.ts`, `src/routes/SupplierRoutes.ts`, `src/app.ts`, `tests/fixtures/expected-inventory.json`, `tests/audit-vault.test.ts`, `tests/supplier-import-parser.test.ts`, `tests/supplier-import-db.test.ts`, `web/src/components/SupplierImportModal.tsx`, `web/src/pages/Fornecedores.tsx`, `web/src/pages/Fornecedores.test.tsx`, `PLAN.md` (e `REVIEW.md` do reviewer)
- Obs.: nenhum dos dois `package.json` tem script `lint`. O gate de lint equivale a `tsc` (`npm run build` na raiz, `typecheck` no web). Não inventar comando de lint.

## Riscos
- **Ordem de rotas**: `GET /suppliers/import/template` registrado depois de `GET /suppliers/:id` em `src/routes/SupplierRoutes.ts` quebra o download (400). Por isso as rotas vão no topo. O teste DB do template cobre isso.
- **Body limit**: sem a linha em `src/app.ts`, planilha > ~740 KB em base64 dá 413 antes do controller (mesmo motivo documentado em `src/app.ts` L61-65).
- **Audit-vault**: controller e rotas novos quebram `npm test` se `tests/fixtures/expected-inventory.json` e `tests/audit-vault.test.ts` L70 não forem atualizados juntos.
- **Arquivo > 900 linhas**: `web/src/pages/Fornecedores.tsx` (1013). Tocar nele é inevitável porque o botão fica no header dessa página. A mitigação é o modal em componente próprio e diff ≤15 linhas. O dev NÃO deve reformatar nem mover código existente.
- **Índices de dialog no teste**: `web/src/pages/Fornecedores.test.tsx` L107-125 depende de exatamente 2 `<dialog>` montados. Montar o modal de import sempre (sem condicional) quebra esse teste.
- **Soft-delete**: a checagem de duplicado filtra `deletedAt: null`, de propósito. Fornecedor soft-deletado com o mesmo nome NÃO bloqueia o import (mesma semântica da listagem em `SupplierController.buildSupplierWhere`).
- **Race com criação manual**: o advisory lock só serializa import contra import. `SupplierController.create` não pega o lock e continua podendo criar nome duplicado em paralelo. Isso é pré-existente e só um unique constraint (migration) fecharia. Fora de escopo, fica registrado.
- **Nome legado com espaço nas bordas**: o preview compara em JS com trim dos dois lados e o confirm usa `equals` insensitive no Postgres, sem trim do valor do banco. Na prática os nomes já são gravados trimados pelo Zod de `supplierCreateSchema`.
- **`cell.text` do exceljs**: e-mail/website convertidos em hyperlink pelo Excel retornam o texto exibido (ok). Telefone digitado como número muito longo pode vir em notação científica. As instruções do modelo pedem célula de texto.
- **Transação por linha**: timeout padrão de 5s do Prisma por linha é suficiente (≤6 queries). 500 linhas = 500 transações sequenciais, alguns segundos, aceitável e igual ao catálogo.
- Não toca dual schema `collectionWindows` (é do Portal COMEX), landed cost nem scoring. O único ponto sensível é soft-delete, tratado acima.

## Fora de escopo
- Migration, unique index em `Supplier.name`, qualquer mudança em `prisma/schema.prisma`.
- Criar família automaticamente (decisão explícita do usuário).
- Atualizar/mesclar fornecedor existente (upsert) em qualquer cenário.
- Mexer em `src/controllers/CatalogItemImportController.ts`, `web/src/pages/Itens.tsx` ou extrair `readFileAsBase64` para util compartilhado.
- Adicionar `exceljs` ao `web/package.json`.
- Gating de botão por role no frontend (a página hoje não faz isso para "+ Novo fornecedor"; o backend já bloqueia via `allowRoles`).
- Playwright/E2E.
- Deploy (ZONA VERMELHA, é do Lucas): o PR precisa das DUAS tags, `backend-v*` (Cloud Run) e `web-v*` (Hosting), criadas depois de `git fetch` + merge, conferindo o commit da tag. Nada disso entra no loop.
