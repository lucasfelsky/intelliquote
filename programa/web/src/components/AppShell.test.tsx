import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppShell, { CHAVE_SIDEBAR_COLAPSADA } from './AppShell';
import { getIndentRequestsNewCount } from '@/services/indentRequests';
import { ADMIN_NAV, PRIMARY_NAV } from './navConfig';

const logout = vi.fn(async () => undefined);
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Admin Demo', email: 'a@exemplo.test', role: 'admin' }, logout }),
}));
vi.mock('@/services/commercialRequests', () => ({
  getCommercialRequestsPendingCount: vi.fn(async () => ({ count: 3 })),
}));
vi.mock('@/services/indentRequests', () => ({
  getIndentRequestsNewCount: vi.fn(async () => ({ count: 2 })),
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
  vi.mocked(getIndentRequestsNewCount).mockClear();
  localStorage.clear();
});

describe('AppShell (F2)', () => {
  it('ordem de tab: links principais -> Administracao -> botao de tema -> Sair -> Minha conta -> conteudo (a assinatura nao e tabulavel)', async () => {
    const { container } = renderShell();
    await screen.findByLabelText('3 pendentes');
    const nomes = tabbables(container).map((el) => {
      if (el.tagName === 'BUTTON' && el.hasAttribute('aria-label')) return el.getAttribute('aria-label');
      return (el.textContent ?? '')
        .replace(/\s+/g, ' ')
        .replace(/, Beta$/, '')
        .replace(/(Solicitações)\d+$/, '$1')
        .trim();
    });
    const principais = PRIMARY_NAV.map((i) => i.label);
    const admin = ADMIN_NAV.map((i) => i.label);
    // o botao de recolher o menu abre a ordem (fica na marca, acima dos links)
    expect(nomes[0]).toBe('Recolher menu lateral');
    expect(nomes.slice(1, 1 + principais.length)).toEqual(principais);
    expect(nomes.slice(1 + principais.length, 1 + principais.length + admin.length)).toEqual(admin);
    expect(nomes.slice(1 + principais.length + admin.length)).toEqual(['Tema: automático — alternar tema', 'Sair', 'Minha conta']);
    // botao unico de tema (sem radios) e a assinatura "SQ Química" fora da ordem de tab
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(0);
    const assinatura = container.querySelector('.sidebar__signature');
    expect(assinatura).not.toBeNull();
    expect(tabbables(container).some((el) => assinatura?.contains(el))).toBe(false);
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

describe('AppShell: sidebar recolhivel', () => {
  it('abre expandida; o botao recolhe (so icones), mantem o nome dos links para o leitor de tela e grava a escolha', async () => {
    const { container } = renderShell();
    await screen.findByLabelText('3 pendentes');
    const botao = screen.getByRole('button', { name: 'Recolher menu lateral' });
    expect(botao.getAttribute('aria-expanded')).toBe('true');
    expect(botao.getAttribute('aria-controls')).toBe('sidebar-nav');
    expect(container.querySelector('.sidebar--colapsada')).toBeNull();

    fireEvent.click(botao);
    expect(container.querySelector('.app-shell.app-shell--colapsada > .sidebar.sidebar--colapsada')).not.toBeNull();
    const aberto = screen.getByRole('button', { name: 'Expandir menu lateral' });
    expect(aberto.getAttribute('aria-expanded')).toBe('false');
    // o texto fica no DOM (some so da tela, por opacidade); cada link segue com nome e ganha a dica ao apontar
    const link = screen.getByRole('link', { name: /^Cotações/ });
    expect(link.getAttribute('title')).toBeNull();
    expect(container.querySelector('.sidebar__dica')).toBeNull();
    fireEvent.mouseEnter(link.closest('li') as HTMLElement);
    expect(container.querySelector('.sidebar__dica')?.textContent).toBe('Cotações');
    fireEvent.mouseLeave(link.closest('li') as HTMLElement);
    expect(container.querySelector('.sidebar__dica')).toBeNull();
    // foco abre a dica; Esc a dispensa (WCAG 1.4.13) e blur tambem
    fireEvent.focus(link);
    expect(container.querySelector('.sidebar__dica')?.textContent).toBe('Cotações');
    fireEvent.keyDown(link, { key: 'Escape' });
    expect(container.querySelector('.sidebar__dica')).toBeNull();
    fireEvent.focus(link);
    fireEvent.blur(link);
    expect(container.querySelector('.sidebar__dica')).toBeNull();
    expect(localStorage.getItem(CHAVE_SIDEBAR_COLAPSADA)).toBe('1');
  });

  it('lembra a escolha ao recarregar e expandir de novo apaga a chave', async () => {
    localStorage.setItem(CHAVE_SIDEBAR_COLAPSADA, '1');
    const { container } = renderShell();
    await screen.findByLabelText('3 pendentes');
    expect(container.querySelector('.sidebar--colapsada')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expandir menu lateral' }));
    expect(container.querySelector('.sidebar--colapsada')).toBeNull();
    expect(localStorage.getItem(CHAVE_SIDEBAR_COLAPSADA)).toBeNull();
    // expandida: sem dica
    fireEvent.mouseEnter(screen.getByRole('link', { name: /^Cotações/ }).closest('li') as HTMLElement);
    expect(container.querySelector('.sidebar__dica')).toBeNull();
  });

  it('storage bloqueado (modo privado) nao quebra: abre expandida e o botao ainda recolhe', async () => {
    const leitura = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    const escrita = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    try {
      const { container } = renderShell();
      await screen.findByLabelText('3 pendentes');
      expect(container.querySelector('.sidebar--colapsada')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Recolher menu lateral' }));
      expect(container.querySelector('.sidebar--colapsada')).not.toBeNull();
    } finally {
      leitura.mockRestore();
      escrita.mockRestore();
    }
  });
});

// ---------- Variante Indent por rota ----------
function renderShellEm(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/cotacoes" element={<section data-testid="pagina">pagina-cotacoes</section>} />
            <Route path="/indent/catalogo" element={<section data-testid="pagina">pagina-indent</section>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AppShell: variante Indent (sidebar por rota)', () => {
  it('em /indent/catalogo: sidebar do Indent (selo, Voltar, Solicitacoes + 3 links), classe app-shell--indent, sem Administracao e com o contador de novas so em Solicitacoes', async () => {
    const { container } = renderShellEm('/indent/catalogo');
    expect(container.querySelector('.app-shell.app-shell--indent > .sidebar.sidebar--indent')).not.toBeNull();
    expect(container.querySelector('.sidebar__brand-tag')?.textContent).toBe('Indent');
    expect(screen.getByRole('link', { name: 'Voltar ao IntelliQuote' }).getAttribute('href')).toBe('/');
    const principal = container.querySelector('#sidebar-nav');
    expect(principal?.getAttribute('aria-label')).toBe('Indent');
    expect(Array.from(principal?.querySelectorAll('a') ?? []).map((a) => (a.textContent ?? '').replace(/(Solicitações)\d+$/, '$1'))).toEqual([
      'Solicitações',
      'Catálogo',
      'Fornecedores',
      'Clientes',
    ]);
    expect(container.querySelectorAll('.sidebar__group-title')).toHaveLength(1);
    expect(screen.queryByText('Administração')).toBeNull();
    // contador de solicitacoes NOVAS do Indent (so no link Solicitacoes); o de pendentes do IQ nao aparece
    expect(await screen.findByLabelText('2 pendentes')).toBeTruthy();
    expect(container.querySelectorAll('.sidebar__badge')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /^Solicitações/ }).querySelector('.sidebar__badge')).not.toBeNull();
    expect(screen.queryByLabelText('3 pendentes')).toBeNull();
    // topbar e a do IQ (sem mudanca) e a pagina continua filha direta do main
    expect(container.querySelector('.app-shell__main > .topbar')).not.toBeNull();
    expect(screen.getByTestId('pagina').parentElement).toBe(container.querySelector('main.app-shell__content'));
  });

  it('em /cotacoes nada muda: sidebar padrao do IQ, sem classes nem selo do Indent', async () => {
    const { container } = renderShellEm('/cotacoes');
    await screen.findByLabelText('3 pendentes');
    expect(container.querySelector('.app-shell--indent')).toBeNull();
    expect(container.querySelector('.sidebar--indent')).toBeNull();
    expect(container.querySelector('.sidebar__brand-tag')).toBeNull();
    expect(container.querySelector('nav[aria-label="Voltar"]')).toBeNull();
    expect(container.querySelector('#sidebar-nav')?.getAttribute('aria-label')).toBe('Navegação principal');
    expect(screen.getByRole('link', { name: 'Indent' }).getAttribute('href')).toBe('/indent');
    // fora do Indent o contador de novas nem e consultado
    expect(getIndentRequestsNewCount).not.toHaveBeenCalled();
  });

  it('a escolha de recolher vale para as duas variantes (mesma chave)', () => {
    localStorage.setItem(CHAVE_SIDEBAR_COLAPSADA, '1');
    const { container } = renderShellEm('/indent/catalogo');
    expect(container.querySelector('.app-shell--indent.app-shell--colapsada > .sidebar--indent.sidebar--colapsada')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expandir menu lateral' }));
    expect(container.querySelector('.sidebar--colapsada')).toBeNull();
    expect(localStorage.getItem(CHAVE_SIDEBAR_COLAPSADA)).toBeNull();
  });
});
