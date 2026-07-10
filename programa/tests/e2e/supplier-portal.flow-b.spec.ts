import { test, expect } from '@playwright/test'

/**
 * Fluxo B da Integracao end-to-end: disparo de cotacao + magic-link do
 * portal do fornecedor + resposta da cotacao.
 *
 * Cobre, contra a stack embedded (Postgres efemero + seed + backend real):
 *   1. admin dispara a cotacao seedada pra um SupplierContact (dispatch real,
 *      e-mail sai pelo ConsoleMailer no stdout do backend);
 *   2. um portal token e' emitido e o rawToken volta na API (mesmo
 *      SupplierPortalService.createToken do dispatch — o stdout do backend e'
 *      stdio:'inherit' no global-setup, entao o link do e-mail nao e'
 *      capturavel de dentro do spec; o endpoint portal-tokens e' o caminho
 *      documentado pra obter o raw);
 *   3. o fornecedor (sem auth, so o token) le a cotacao no portal publico e
 *      submete a resposta;
 *   4. revisao: segunda resposta com o mesmo token sobrescreve a atual (v2) e
 *      preserva a anterior (v1) no historico, enquanto o link nao expira.
 *
 * Roda apenas no harness embedded (npm run test:e2e:embedded). Sem
 * E2E_EMBEDDED (sem seed), fica skipped e a suite normal segue verde.
 *
 * Cuidado com o rate limit do portal publico (10 req/min por IP+UA e lockout
 * apos 5 tentativas 404 em 15 min): este spec faz poucas chamadas e roda num
 * unico test() serial pra ficar bem abaixo do teto.
 */

const ADMIN_EMAIL = 'admin@sqquimica.com' // prisma/seed.ts
const ADMIN_PASSWORD = 'admin123'
const SEEDED_REQUEST_CODE = 'QR-20260325-DEMO01' // seed.ts, status open, 2 itens

const seededTest = process.env.E2E_EMBEDDED ? test : test.skip

seededTest('Fluxo B: dispatch -> magic-link -> resposta do fornecedor -> revisao na segunda', async ({ request }) => {
  // --- 1. login admin (cookie jar do APIRequestContext segura a sessao) ---
  const login = await request.post('/api/v1/auth/login', {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })
  expect(login.status()).toBe(200)

  // --- 2. supplier ativo do seed + contato novo (o seed nao cria contatos) ---
  const suppliersRes = await request.get('/api/v1/suppliers')
  expect(suppliersRes.status()).toBe(200)
  const suppliers = await suppliersRes.json()
  const supplier = (Array.isArray(suppliers) ? suppliers : suppliers.data ?? []).find(
    (item: { status: string }) => item.status === 'active'
  )
  expect(supplier, 'seed deveria ter pelo menos 1 supplier ativo').toBeTruthy()

  // Dois contatos de proposito: o dispatch cria um token pro destinatario, e
  // o endpoint portal-tokens PULA contatos que ja tem token ativo
  // (DispatchController.generatePortalTokens, "alreadyActiveCount"). Entao o
  // contato A exercita o caminho do e-mail (dispatch) e o contato B o caminho
  // da resposta (portal-token com rawToken na API).
  const contactRes = await request.post('/api/v1/supplier-contacts', {
    data: {
      supplierId: supplier.id,
      name: 'Contato Fluxo B (dispatch)',
      email: 'fluxo-b-dispatch@example.com',
      isPrimary: true,
    },
  })
  expect(contactRes.status()).toBe(201)
  const contact = await contactRes.json()

  const responderRes = await request.post('/api/v1/supplier-contacts', {
    data: {
      supplierId: supplier.id,
      name: 'Contato Fluxo B (responde)',
      email: 'fluxo-b-responde@example.com',
    },
  })
  expect(responderRes.status()).toBe(201)
  const responderContact = await responderRes.json()

  // --- 3. cotacao seedada (open, 2 itens) ---
  const listRes = await request.get('/api/v1/quote-requests')
  expect(listRes.status()).toBe(200)
  const listBody = await listRes.json()
  const seededSummary = (Array.isArray(listBody) ? listBody : listBody.data ?? []).find(
    (item: { requestCode: string }) => item.requestCode === SEEDED_REQUEST_CODE
  )
  expect(seededSummary, `cotacao seedada ${SEEDED_REQUEST_CODE} nao encontrada`).toBeTruthy()

  const showRes = await request.get(`/api/v1/quote-requests/${seededSummary.id}`)
  expect(showRes.status()).toBe(200)
  const quoteRequest = await showRes.json()
  expect(quoteRequest.status).toBe('open')
  expect(quoteRequest.items.length).toBeGreaterThan(0)

  // --- 4. dispatch real (e-mail via ConsoleMailer; token do contato emitido) ---
  const dispatchRes = await request.post(`/api/v1/quote-requests/${quoteRequest.id}/dispatch`, {
    data: {
      recipientContactIds: [contact.id],
      subject: 'Cotacao Fluxo B (E2E)',
    },
  })
  expect(dispatchRes.status()).toBe(201)
  const dispatch = await dispatchRes.json()
  expect(dispatch.recipientsCount).toBe(1)
  expect(dispatch.sentCount).toBe(1)
  expect(dispatch.failedCount).toBe(0)

  // --- 5. rawToken via portal-tokens pro contato B (sem token ativo) ---
  const tokensRes = await request.post(`/api/v1/quote-requests/${quoteRequest.id}/portal-tokens`, {
    data: { supplierContactIds: [responderContact.id] },
  })
  expect(tokensRes.status()).toBe(201)
  const tokensBody = await tokensRes.json()
  expect(tokensBody.generatedCount).toBe(1)
  const rawToken: string = tokensBody.tokens?.[0]?.token?.token
  expect(rawToken, 'portal-tokens deveria retornar o rawToken').toBeTruthy()
  expect(rawToken.length).toBeGreaterThanOrEqual(16) // minimo aceito pelo portal

  // --- 6. fornecedor abre o magic-link (rota publica, sem auth) ---
  const portalView = await request.get(`/api/portal/${encodeURIComponent(rawToken)}`)
  expect(portalView.status()).toBe(200)
  const portalBody = await portalView.json()
  expect(portalBody.quoteRequest.requestCode).toBe(SEEDED_REQUEST_CODE)
  expect(portalBody.readOnly).toBe(false)
  expect(portalBody.alreadyResponded).toBe(false)
  expect(portalBody.quoteRequest.items.length).toBe(quoteRequest.items.length)

  // --- 7. fornecedor responde a cotacao ---
  const items = portalBody.quoteRequest.items.map(
    (item: { id: number; quantity?: number }) => ({
      quoteRequestItemId: item.id,
      unitPrice: 100,
      quantity: item.quantity ?? 1,
      totalPrice: 100 * (item.quantity ?? 1),
      leadTimeDays: 15,
    })
  )
  const totalPrice = items.reduce(
    (sum: number, item: { totalPrice: number }) => sum + item.totalPrice,
    0
  )

  const respond = await request.post(`/api/portal/${encodeURIComponent(rawToken)}/respond`, {
    data: {
      incoterm: 'FOB',
      paymentTermsDays: 30,
      totalPrice,
      validityDays: 30,
      notes: 'Resposta enviada pelo E2E do Fluxo B.',
      items,
    },
  })
  expect(respond.status()).toBe(201)
  const respondBody = await respond.json()
  expect(respondBody.submittedAt).toBeTruthy()
  expect(Number(respondBody.totalPrice)).toBe(totalPrice)

  // --- 8. token continua editavel: portal mostra a resposta atual (v1) ---
  const viewAfter = await request.get(`/api/portal/${encodeURIComponent(rawToken)}`)
  expect(viewAfter.status()).toBe(200)
  const viewAfterBody = await viewAfter.json()
  expect(viewAfterBody.alreadyResponded).toBe(true)
  // Nao e' mais read-only: o fornecedor pode revisar o preco ate o link expirar.
  expect(viewAfterBody.readOnly).toBe(false)
  expect(viewAfterBody.response?.version).toBe(1)
  expect(Array.isArray(viewAfterBody.history)).toBe(true)
  expect(viewAfterBody.history.length).toBe(0)

  // --- 9. fornecedor REVISA o preco (segunda resposta sobrescreve, guarda historico) ---
  const revisedItems = items.map((item: { quoteRequestItemId: number; quantity: number }) => ({
    quoteRequestItemId: item.quoteRequestItemId,
    unitPrice: 90,
    quantity: item.quantity,
    totalPrice: 90 * item.quantity,
    leadTimeDays: 10,
  }))
  const revisedTotal = revisedItems.reduce(
    (sum: number, item: { totalPrice: number }) => sum + item.totalPrice,
    0
  )
  const respondAgain = await request.post(`/api/portal/${encodeURIComponent(rawToken)}/respond`, {
    data: {
      incoterm: 'FOB',
      paymentTermsDays: 45,
      totalPrice: revisedTotal,
      validityDays: 30,
      notes: 'Preco revisado pelo E2E.',
      items: revisedItems,
    },
  })
  expect(respondAgain.status()).toBe(201)
  const respondAgainBody = await respondAgain.json()
  expect(respondAgainBody.revised).toBe(true)
  expect(respondAgainBody.version).toBe(2)
  expect(Number(respondAgainBody.totalPrice)).toBe(revisedTotal)

  // --- 10. portal mostra a versao 2 como atual e a v1 no historico ---
  const viewRevised = await request.get(`/api/portal/${encodeURIComponent(rawToken)}`)
  expect(viewRevised.status()).toBe(200)
  const viewRevisedBody = await viewRevised.json()
  expect(viewRevisedBody.response?.version).toBe(2)
  expect(Number(viewRevisedBody.response?.totalPrice)).toBe(revisedTotal)
  expect(viewRevisedBody.history.length).toBe(1)
  expect(viewRevisedBody.history[0].version).toBe(1)
  expect(Number(viewRevisedBody.history[0].totalPrice)).toBe(totalPrice)
})

seededTest('Fluxo B: token invalido leva 404 generico (anti-enumeration)', async ({ request }) => {
  const bogus = 'token-invalido-mas-com-mais-de-16-chars'
  const res = await request.get(`/api/portal/${bogus}`)
  expect(res.status()).toBe(404)
})
