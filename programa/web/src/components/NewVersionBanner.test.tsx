import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import NewVersionBanner from './NewVersionBanner';

const MESSAGE = /nova versão do IntelliQuote/;

function mockDeployed(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    json: async () => {
      if (typeof body === 'string') throw new SyntaxError('Unexpected token <');
      return body;
    },
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// Volta para a aba: dispara a checagem (a primeira nunca cai no limite de 1/min).
function returnToTab() {
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

describe('NewVersionBanner', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('build "dev" (vite dev/vitest) nunca consulta o version.json', async () => {
    const fetchMock = mockDeployed({ buildId: 'outro' });
    const { queryByText } = render(<NewVersionBanner currentBuildId="dev" pollMs={10} />);
    returnToTab();
    await new Promise((r) => setTimeout(r, 40));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queryByText(MESSAGE)).toBeNull();
  });

  it('mesmo build publicado: consulta sem cache e nao avisa', async () => {
    const fetchMock = mockDeployed({ buildId: 'abc123' });
    const { queryByText } = render(<NewVersionBanner currentBuildId="abc123" />);
    returnToTab();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/^\/version\.json\?t=\d+$/);
    expect(init).toEqual({ cache: 'no-store' });
    expect(queryByText(MESSAGE)).toBeNull();
  });

  it('build novo publicado: mostra o aviso e "Recarregar" recarrega a pagina', async () => {
    mockDeployed({ buildId: 'novo456' });
    const reload = vi.fn();
    const { findByText, getByRole } = render(<NewVersionBanner currentBuildId="abc123" reload={reload} />);
    returnToTab();
    expect(await findByText(MESSAGE)).toBeTruthy();
    expect(getByRole('status').textContent).toMatch(MESSAGE);
    fireEvent.click(getByRole('button', { name: 'Recarregar' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('"Depois" esconde o aviso sem recarregar', async () => {
    mockDeployed({ buildId: 'novo456' });
    const reload = vi.fn();
    const { findByText, getByRole, queryByText } = render(
      <NewVersionBanner currentBuildId="abc123" reload={reload} />,
    );
    returnToTab();
    await findByText(MESSAGE);
    fireEvent.click(getByRole('button', { name: 'Depois' }));
    expect(queryByText(MESSAGE)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('checagem periodica detecta o deploy sem precisar voltar para a aba', async () => {
    const fetchMock = mockDeployed({ buildId: 'novo456' });
    const { findByText } = render(<NewVersionBanner currentBuildId="abc123" pollMs={20} />);
    expect(await findByText(MESSAGE)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalled();
  });

  it.each([
    ['index.html no lugar do JSON (deploy antigo sem version.json)', '<!doctype html>', true],
    ['HTTP de erro', { buildId: 'novo456' }, false],
    ['JSON sem buildId', { foo: 1 }, true],
  ])('%s: nao avisa', async (_label, body, ok) => {
    const fetchMock = mockDeployed(body, ok);
    const { queryByText } = render(<NewVersionBanner currentBuildId="abc123" />);
    returnToTab();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(queryByText(MESSAGE)).toBeNull();
  });

  it('falha de rede nao quebra nem avisa', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const { queryByText } = render(<NewVersionBanner currentBuildId="abc123" />);
    returnToTab();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(queryByText(MESSAGE)).toBeNull();
  });

  it('voltar varias vezes para a aba dentro de 1 minuto consulta uma vez so', async () => {
    const fetchMock = mockDeployed({ buildId: 'abc123' });
    render(<NewVersionBanner currentBuildId="abc123" />);
    returnToTab();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    returnToTab();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
