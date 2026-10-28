import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppShell from './AppShell';
import { ADMIN_NAV, PRIMARY_NAV } from './navConfig';

const logout = vi.fn(async () => undefined);
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Admin Demo', email: 'a@exemplo.test', role: 'admin' }, logout }),
}));
vi.mock('@/services/commercialRequests', () => ({
  getCommercialRequestsPendingCount: vi.fn(async () => ({ count: 3 })),
}));

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/cotacoes']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/cotacoes" element={<section data-testid="pagina">pagina-cotacoes</section>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Ordem de tab sem navegador: elementos tabulaveis (tabIndex >= 0) em ordem de documento, como o foco os percorre.
function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('a[href], button, [tabindex]')).filter((el) => el.tabIndex >= 0);
}

beforeEach(() => {
  logout.mockClear();
});

describe('AppShell (F2)', () => {
  it('ordem de tab: links principais -> Administracao -> tema (so o marcado) -> Sair -> Minha conta -> conteudo', async () => {
    const { container } = renderShell();
    await screen.findByLabelText('3 pendentes');
    const nomes = tabbables(container).map((el) => {
      if (el.getAttribute('role') === 'radio') return `radio:${el.getAttribute('aria-label')}`;
      return (el.textContent ?? '')
        .replace(/\s+/g, ' ')
        .replace(/, Beta$/, '')
        .replace(/(Solicitações)\d+$/, '$1')
        .trim();
    });
    const principais = PRIMARY_NAV.map((i) => i.label);
    const admin = ADMIN_NAV.map((i) => i.label);
    expect(nomes.slice(0, principais.length)).toEqual(principais);
    expect(nomes.slice(principais.length, principais.length + admin.length)).toEqual(admin);
    expect(nomes.slice(principais.length + admin.length)).toEqual(['radio:Automático (segue o sistema)', 'Sair', 'Minha conta']);
    // roving: so 1 dos 3 radios e tabulavel
    expect(tabbables(container).filter((el) => el.getAttribute('role') === 'radio')).toHaveLength(1);
    // o conteudo vem depois de "Minha conta" no documento
    const conta = screen.getByRole('link', { name: 'Minha conta' });
    expect(conta.compareDocumentPosition(screen.getByTestId('pagina')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('contador "3 pendentes" no link Solicitacoes', async () => {
    renderShell();
    const contador = await screen.findByLabelText('3 pendentes');
    expect(screen.getByRole('link', { name: /Solicitações/ }).contains(contador)).toBe(true);
  });

  it('"Sair" chama logout', async () => {
    renderShell();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sair' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('a pagina do Outlet e filha DIRETA de main.app-shell__content (a entrada de pagina e so CSS, sem key)', () => {
    const { container } = renderShell();
    const main = container.querySelector('main.app-shell__content');
    expect(main).not.toBeNull();
    expect(screen.getByTestId('pagina').parentElement).toBe(main);
  });

  it('sidebar e topbar ficam fora do main (nao se movem na entrada)', () => {
    const { container } = renderShell();
    expect(container.querySelector('main .sidebar, main .topbar')).toBeNull();
    expect(container.querySelector('.app-shell > .sidebar')).not.toBeNull();
    expect(container.querySelector('.app-shell__main > .topbar')).not.toBeNull();
  });
});
