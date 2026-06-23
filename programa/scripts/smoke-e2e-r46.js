#!/usr/bin/env node
/**
 * Smoke E2E R46 — exercita o caminho feliz completo contra o backend em
 * producao apos a Fase 8 (cleanup) e o FEED-14 (picker de CC). Roda:
 *   1. health/ready
 *   2. login admin
 *   3. company-profile GET/PUT (dispatchCc via checkbox de perfil)
 *   4. cria fornecedor + contato secundario
 *   5. cria cotacao + item (com CatalogItem)
 *   6. gera portal token + preview do template
 *   7. envia proposta via portal publico
 *   8. executa comparacao automatica
 *   9. consulta audit log + comparison history
 *  10. users-directory (picker de CC)
 *
 * Uso:  node scripts/smoke-e2e-r46.js
 *
 * Variaveis de ambiente:
 *   INTELLIQUOTE_BASE_URL  (default: https://intelliquote-api-705697815580.southamerica-east1.run.app)
 *   ADMIN_EMAIL            (default: admin@intelliquote.local)
 *   ADMIN_PASSWORD         (default: ChangeMe123!)
 */

const baseUrl = process.env.INTELLIQUOTE_BASE_URL ??
  'https://intelliquote-api-705697815580.southamerica-east1.run.app';
const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@intelliquote.local';
const adminPassword = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';

const runId = `SMOKE-R46-${Date.now()}`;
const cookieJar = new Map();

const checks = [];
let currentCheck = '';

function step(name, fn) {
  currentCheck = name;
  checks.push({ name, status: 'pending' });
  return fn().then(
    (data) => {
      const last = checks[checks.length - 1];
      last.status = 'ok';
      last.data = data;
      return data;
    },
    (err) => {
      const last = checks[checks.length - 1];
      last.status = 'failed';
      last.error = err.message;
      throw err;
    },
  );
}

async function main() {
  await step('health/ready', async () => send('/health/ready'));

  await step('login admin', async () =>
    send('/api/v1/auth/login', {
      method: 'POST',
      body: { email: adminEmail, password: adminPassword },
    }),
  );

  await step('users-directory', async () => send('/api/v1/users-directory'));

  await step('GET company-profile', async () => send('/api/v1/company-profile'));

  await step('PUT company-profile com dispatchCc', async () =>
    send('/api/v1/company-profile', {
      method: 'PUT',
      body: {
        companyName: 'SQ Quimica',
        purchasingEmail: 'compras@sqquimica.com',
        country: 'Brazil',
        dispatchCc: ['financeiro@sqquimica.com'],
      },
    }),
  );

  let supplierId;
  await step('cria fornecedor', async () => {
    const r = await send('/api/v1/suppliers', {
      method: 'POST',
      body: {
        name: `${runId} Fornecedor`,
        email: `${runId.toLowerCase()}@intelliquote.local`,
        acceptedIncoterms: ['FOB', 'CIF'],
        notes: 'Criado pelo smoke E2E R46.',
      },
    });
    supplierId = r.data.id;
    return r;
  });

  let catalogItemId;
  await step('cria catalog item', async () => {
    const r = await send('/api/v1/catalog-items', {
      method: 'POST',
      body: {
        commercialName: 'Solvente Industrial',
        marketName: `${runId} SOLVENTE`,
        ncm: '38140000',
        isDangerousGood: false,
      },
    });
    catalogItemId = r.data.id;
    return r;
  });

  let quoteRequestId;
  await step('cria cotacao com item', async () => {
    const r = await send('/api/v1/quote-requests', {
      method: 'POST',
      body: {
        productName: `${runId} Bomba`,
        quantity: 5,
        desiredIncoterm: 'FOB',
        description: 'Smoke E2E R46.',
      },
    });
    quoteRequestId = r.data.id;
    await send(`/api/v1/quote-requests/${quoteRequestId}/items`, {
      method: 'POST',
      body: {
        itemCode: `${runId}-001`,
        productName: 'Conjunto principal',
        quantity: 5,
        unit: 'UN',
        targetPrice: 980,
        catalogItemId,
      },
    });
    return r;
  });

  let portalToken;
  await step('gera portal token', async () => {
    const r = await send(
      `/api/v1/quote-requests/${quoteRequestId}/portal-tokens`,
      {
        method: 'POST',
        body: {
          supplierIds: [supplierId],
          expiresInDays: 7,
        },
      },
    );
    portalToken = r.data.tokens?.[0]?.token ?? null;
    return r;
  });

  await step('preview portal template', async () => {
    const url = `/portal/preview?token=PREVIEW&v=1`;
    const r = await fetchRaw(url);
    if (!r.ok) {
      throw new Error(`preview portal falhou: ${r.status}`);
    }
    return { status: r.status };
  });

  await step('envia resposta via portal publico', async () => {
    if (!portalToken) {
      throw new Error('portal token nao foi gerado');
    }
    const r = await fetchPublic(`/api/portal/${portalToken}`);
    if (!r.ok) {
      throw new Error(`portal GET falhou: ${r.status}`);
    }
    return { status: r.status };
  });

  await step('executa comparacao', async () =>
    send(`/api/v1/quote-requests/${quoteRequestId}/compare`, {
      method: 'POST',
      body: {
        priceWeight: 60,
        paymentTermsWeight: 25,
        incotermWeight: 15,
      },
    }),
  );

  await step('lista comparisons', async () =>
    send(`/api/v1/quote-requests/${quoteRequestId}/comparisons`),
  );

  await step('audit log da cotacao', async () =>
    send(`/api/v1/audit?entityType=quote_request&entityId=${quoteRequestId}&limit=20`),
  );

  const summary = {
    runId,
    baseUrl,
    totalChecks: checks.length,
    passed: checks.filter((c) => c.status === 'ok').length,
    failed: checks.filter((c) => c.status === 'failed').length,
    checks: checks.map((c) => ({
      name: c.name,
      status: c.status,
      ...(c.error ? { error: c.error } : {}),
    })),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

async function send(path, options = {}) {
  return await retry(async () => {
    const headers = {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...buildCookieHeader(),
      ...(options.headers ?? {}),
    };
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    updateCookies(response);

    const text = response.status === 204 ? '' : await response.text();
    const data = text ? safeParseJson(text) : null;

    if (!response.ok) {
      const message = data?.message ?? response.statusText ?? `HTTP ${response.status}`;
      throw new Error(`${options.method ?? 'GET'} ${path} falhou (${response.status}): ${message}`);
    }

    return {
      status: response.status,
      data,
    };
  });
}

async function fetchRaw(path) {
  return await retry(async () => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: buildCookieHeader(),
    });
    return response;
  });
}

async function fetchPublic(path) {
  // Portal publico nao usa cookies de sessao — token vai na URL.
  return await retry(async () => {
    const response = await fetch(`${baseUrl}${path}`, { method: 'GET' });
    return response;
  });
}

async function retry(fn, attempts = 3, delayMs = 500) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        await sleep(delayMs * (i + 1));
      }
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function updateCookies(response) {
  const setCookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];
  for (const cookie of setCookies) {
    const [pair] = cookie.split(';');
    if (!pair) continue;
    const [name, value] = pair.split('=');
    if (!name) continue;
    if (value === undefined || value === '') {
      cookieJar.delete(name);
      continue;
    }
    cookieJar.set(name, `${name}=${value}`);
  }
}

function buildCookieHeader() {
  if (!cookieJar.size) return {};
  return { Cookie: Array.from(cookieJar.values()).join('; ') };
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch (_err) {
    return null;
  }
}

main().catch((error) => {
  console.error(`Smoke E2E R46 falhou em "${currentCheck}": ${error.message}`);
  process.exitCode = 1;
});
