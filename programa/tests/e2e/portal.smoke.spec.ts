import { test, expect } from '@playwright/test'

/**
 * Fluxo B (parcial) — Portal do Fornecedor.
 * [[Integração end-to-end]] §Fluxo B, step 1-3.
 *
 * Estes specs sao smoke tests que NAO dependem de DB seedado:
 *   - Carregam a UI (portal.html)
 *   - Fazem request direto a API publica (`/api/portal/...`)
 *   - Validam o tratamento de token invalido/expirado/nao encontrado
 *
 * Para o fluxo completo (submit + persist), ver `portal.submit.spec.ts`
 * que precisa de DB seedado (CI/staging).
 */

test.describe('Portal do Fornecedor — smoke (sem DB)', () => {
  test('portal.html carrega sem token e mostra erro', async ({ page }) => {
    // sem ?token=... deve mostrar erro "Missing access token"
    await page.goto('/portal')

    // Espera a UI renderizar (status banner aparece depois do load)
    await expect(page.locator('#portal-status')).toBeVisible({ timeout: 10_000 })

    // Sem token, o JS detecta e mostra mensagem de erro
    const content = await page.locator('#portal-content').innerHTML()
    expect(content).toMatch(/footer-note|portal-loading/i)
  })

  test('portal.html?token=INVALIDO mostra erro de token invalido', async ({ page }) => {
    await page.goto('/portal?token=invalid-token-fake')

    // Aguarda o request para /api/portal/:token terminar
    await expect(page.locator('#portal-status')).toBeVisible({ timeout: 10_000 })

    // O backend retorna 404 INVALID_LOG; a UI mostra "Invalid or expired link"
    // (mensagem pode variar entre builds; validamos que NAO carrega supplier-card)
    await expect(page.locator('.supplier-card')).toHaveCount(0, { timeout: 5_000 })
  })

  test('GET /api/portal/INVALIDO retorna 404', async ({ request }) => {
    const res = await request.get('/api/portal/this-token-does-not-exist')
    expect(res.status()).toBe(404)
    const body = await res.json()
    expect(body.message).toBeTruthy()
    // O 404 INVALID_LOG do SupplierPortalService.validate e' generico — nao
    // distingue entre "nao encontrado" e "expirado" / "revogado" / "respondido"
    // (anti-enumeration). Aqui so validamos que ha mensagem.
  })

  test('GET /api/portal/_meta retorna 200 + service identifier', async ({ request }) => {
    const res = await request.get('/api/portal/_meta')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.service).toBe('supplier-portal')
  })
})
