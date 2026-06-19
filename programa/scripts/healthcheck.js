const targetUrl = process.argv[2] ?? 'http://localhost:3000/health/ready';

async function main() {
  const response = await fetch(targetUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || payload?.status !== 'ok') {
    const reason = payload?.status ?? response.statusText ?? 'unknown';
    throw new Error(`Healthcheck falhou para ${targetUrl}: ${reason}`);
  }

  console.log(
    JSON.stringify(
      {
        targetUrl,
        statusCode: response.status,
        status: payload.status,
        timestamp: payload.timestamp ?? null,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
