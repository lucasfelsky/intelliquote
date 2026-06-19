const baseUrl = process.env.INTELLIQUOTE_BASE_URL ?? 'http://localhost:3000';
const loginEmail = process.env.ADMIN_SEED_EMAIL ?? 'admin@intelliquote.local';
const loginPassword = process.env.ADMIN_SEED_PASSWORD ?? 'ChangeMe123!';
const runId = `SMOKE-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;

const cookieJar = new Map();

async function main() {
  const live = await send('/health/live');
  const ready = await send('/health/ready');

  await send('/api/v1/auth/login', {
    method: 'POST',
    body: {
      email: loginEmail,
      password: loginPassword,
    },
  });

  const supplierA = await send('/api/v1/suppliers', {
    method: 'POST',
    body: {
      name: `${runId} Alpha`,
      email: `${runId.toLowerCase()}-alpha@intelliquote.local`,
      acceptedIncoterms: ['FOB', 'CIF'],
      notes: 'Criado pelo smoke local.',
    },
  });
  const supplierB = await send('/api/v1/suppliers', {
    method: 'POST',
    body: {
      name: `${runId} Beta`,
      email: `${runId.toLowerCase()}-beta@intelliquote.local`,
      acceptedIncoterms: ['FOB', 'CIF'],
      notes: 'Criado pelo smoke local.',
    },
  });

  const quoteRequest = await send('/api/v1/quote-requests', {
    method: 'POST',
    body: {
      productName: `${runId} Bomba Centrifuga`,
      quantity: 12,
      desiredIncoterm: 'FOB',
      description: 'Cotacao gerada pelo smoke local.',
    },
  });

  const item = await send(`/api/v1/quote-requests/${quoteRequest.data.id}/items`, {
    method: 'POST',
    body: {
      itemCode: `${runId}-001`,
      productName: 'Conjunto principal',
      quantity: 12,
      unit: 'UN',
      targetPrice: 980,
    },
  });

  const quoteResponseA = await send('/api/v1/quote-responses', {
    method: 'POST',
    body: {
      quoteRequestId: quoteRequest.data.id,
      supplierId: supplierA.data.id,
      offeredPrice: 950,
      currency: 'USD',
      exchangeRate: 5.4,
      offeredIncoterm: 'FOB',
      paymentTermsDays: 15,
      notes: 'Oferta A do smoke local.',
    },
  });
  const quoteResponseB = await send('/api/v1/quote-responses', {
    method: 'POST',
    body: {
      quoteRequestId: quoteRequest.data.id,
      supplierId: supplierB.data.id,
      offeredPrice: 990,
      currency: 'USD',
      exchangeRate: 5.4,
      offeredIncoterm: 'CIF',
      paymentTermsDays: 30,
      notes: 'Oferta B do smoke local.',
    },
  });

  const comparison = await send(`/api/v1/quote-requests/${quoteRequest.data.id}/compare`, {
    method: 'POST',
    body: {
      priceWeight: 60,
      paymentTermsWeight: 25,
      incotermWeight: 15,
    },
  });
  const comparisonHistory = await send(
    `/api/v1/quote-requests/${quoteRequest.data.id}/comparisons`,
  );
  const auditLogs = await send(
    `/api/v1/audit?entityType=quote_request&entityId=${quoteRequest.data.id}&limit=20`,
  );

  const winner = comparison.data.find((entry) => entry.isWinner);
  const compareLog = auditLogs.data.find((entry) => entry.action === 'compare');

  console.log(
    JSON.stringify(
      {
        baseUrl,
        runId,
        liveStatus: live.status,
        readyStatus: ready.status,
        supplierIds: [supplierA.data.id, supplierB.data.id],
        quoteRequestId: quoteRequest.data.id,
        quoteRequestItemId: item.data.id,
        quoteResponseIds: [quoteResponseA.data.id, quoteResponseB.data.id],
        compareStatus: comparison.status,
        winnerSupplierId: winner?.supplierId ?? null,
        comparisonHistoryCount: comparisonHistory.data.comparisons?.length ?? 0,
        auditActions: auditLogs.data.map((entry) => entry.action),
        compareLogFound: Boolean(compareLog),
      },
      null,
      2,
    ),
  );
}

async function send(path, options = {}) {
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
    const message = data?.message ?? response.statusText ?? 'Falha no smoke local.';
    throw new Error(
      `${options.method ?? 'GET'} ${path} falhou com ${response.status}: ${message}`,
    );
  }

  return {
    status: response.status,
    data,
  };
}

function updateCookies(response) {
  const setCookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];

  for (const cookie of setCookies) {
    const [pair] = cookie.split(';');

    if (!pair) {
      continue;
    }

    const [name, value] = pair.split('=');

    if (!name) {
      continue;
    }

    if (value === undefined || value === '') {
      cookieJar.delete(name);
      continue;
    }

    cookieJar.set(name, `${name}=${value}`);
  }
}

function buildCookieHeader() {
  if (!cookieJar.size) {
    return {};
  }

  return {
    Cookie: Array.from(cookieJar.values()).join('; '),
  };
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

main().catch((error) => {
  console.error(`Smoke local falhou: ${error.message}`);
  process.exitCode = 1;
});
