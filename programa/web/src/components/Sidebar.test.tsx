import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from './Sidebar';
import { ADMIN_NAV, COMEX_ROLES, PRIMARY_NAV, filterNavByRole } from './navConfig';

function renderSidebar(role: string, badges?: Record<string, number>) {
  return render(
    <MemoryRouter>
      <Sidebar
        items={filterNavByRole(PRIMARY_NAV, role)}
        adminItems={filterNavByRole(ADMIN_NAV, role)}
        adminHeader
        badges={badges}
      />
    </MemoryRouter>,
  );
}

const FORECAST_BETA = /^forecast,\s*beta$/i;

describe('Sidebar - selo (tag)', () => {
  it('comprador: o link Forecast tem nome acessivel "Forecast, Beta" e os vizinhos nao tem selo', () => {
    const { container } = renderSidebar('comprador');
    const link = screen.getByRole('link', { name: FORECAST_BETA });
    expect(link.getAttribute('href')?.endsWith('/forecast')).toBe(true);

    const tags = container.querySelectorAll('.sidebar__tag');
    expect(tags).toHaveLength(1);
    expect(link.contains(tags[0] ?? null)).toBe(true);
    expect(tags[0]?.textContent).toContain('Beta');

    expect(screen.getByRole('link', { name: 'Fornecedores' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Forwarders' })).toBeTruthy();
  });

  it.each(COMEX_ROLES)('%s (COMEX) ve o link Forecast com selo', (role) => {
    renderSidebar(role);
    expect(screen.getByRole('link', { name: FORECAST_BETA })).toBeTruthy();
  });

  it('comercial: nenhum selo e nenhum link Forecast', () => {
    const { container } = renderSidebar('comercial');
    expect(container.querySelectorAll('.sidebar__tag')).toHaveLength(0);
    expect(screen.queryAllByRole('link', { name: /forecast/i })).toHaveLength(0);
  });

  it('o contador de pendentes continua em Solicitações e o Forecast nao ganha contador', () => {
    renderSidebar('comprador', { '/solicitacoes': 2 });
    const solicitacoes = screen.getByRole('link', { name: /Solicitações/ });
    const contador = solicitacoes.querySelector('.sidebar__badge');
    expect(contador).not.toBeNull();
    expect(contador?.getAttribute('aria-label')).toBe('2 pendentes');

    const forecast = screen.getByRole('link', { name: FORECAST_BETA });
    expect(forecast.querySelector('.sidebar__badge')).toBeNull();
  });
});

const GLYPHS = /[\u2190-\u21FF\u2300-\u23FF\u25A0-\u27BF\u2B00-\u2BFF\u{1F300}-\u{1FAFF}]/u;

function renderAt(role: string, path: string, onLogout?: () => void, badges?: Record<string, number>) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar
        items={filterNavByRole(PRIMARY_NAV, role)}
        adminItems={filterNavByRole(ADMIN_NAV, role)}
        adminHeader
        badges={badges}
        onLogout={onLogout}
      />
    </MemoryRouter>,
  );
}

describe('Sidebar - marca e estrutura (F2, mock v68)', () => {
  it('sem "Portal COMEX", sem <img> (marca em SVG) e o nome e "IntelliQuote"', () => {
    const { container } = renderAt('admin', '/cotacoes');
    expect(screen.queryByText(/Portal COMEX/)).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.sidebar__brand-name')?.textContent).toBe('IntelliQuote');
    expect(container.querySelector('.sidebar__brand .brand-mark')).not.toBeNull();
  });

  it('aria-current="page" so no link da rota atual (Overview e "end": nao marca em /cotacoes)', () => {
    renderAt('admin', '/cotacoes');
    const atuais = screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page');
    expect(atuais.map((l) => l.textContent)).toEqual(['Cotações']);
    expect(screen.getByRole('link', { name: 'Overview' }).hasAttribute('aria-current')).toBe(false);
  });

  it('em / so o Overview fica ativo', () => {
    renderAt('admin', '/');
    const atuais = screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page');
    expect(atuais.map((l) => l.textContent)).toEqual(['Overview']);
  });

  it('todo svg da sidebar e decorativo (aria-hidden)', () => {
    const { container } = renderAt('admin', '/');
    const svgs = Array.from(container.querySelectorAll('.sidebar svg'));
    expect(svgs.length).toBeGreaterThan(14);
    for (const svg of svgs) expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('um icone SVG por item de navegacao e nenhum glifo unicode no texto', () => {
    const { container } = renderAt('admin', '/');
    const links = container.querySelectorAll('.sidebar__link');
    expect(links).toHaveLength(14);
    for (const link of Array.from(links)) {
      expect(link.querySelectorAll('svg.sidebar__icon'), link.textContent ?? '').toHaveLength(1);
    }
    expect(container.textContent ?? '').not.toMatch(GLYPHS);
  });

  it('rotulo "Administracao" (caixa alta por CSS) antes dos 4 itens de admin', () => {
    const { container } = renderAt('admin', '/');
    expect(container.querySelector('.sidebar__group-title')?.textContent).toBe('Administração');
    expect(container.querySelectorAll('.sidebar__group .sidebar__link')).toHaveLength(4);
  });

  it('rodape: radiogroup do tema (variante navy) ANTES do botao Sair; Sair chama onLogout; versao presente', () => {
    const onLogout = vi.fn();
    const { container } = renderAt('admin', '/', onLogout);
    const footer = container.querySelector('.sidebar__footer');
    expect(footer).not.toBeNull();
    const grupo = screen.getByRole('radiogroup', { name: 'Tema da interface' });
    const sair = screen.getByRole('button', { name: 'Sair' });
    expect(footer?.contains(grupo)).toBe(true);
    expect(footer?.contains(sair)).toBe(true);
    expect(grupo.className).toContain('theme-toggle--navy');
    expect(grupo.compareDocumentPosition(sair) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(sair);
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.sidebar__version')?.textContent).toBe('v0.1 · Build local');
  });

  it('sem onLogout o clique em Sair nao quebra', () => {
    renderAt('admin', '/');
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Sair' }))).not.toThrow();
  });

  it('comercial: so Solicitacoes, sem Administracao e sem contador; rodape (tema + Sair) presente', () => {
    const { container } = renderAt('comercial', '/solicitacoes');
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(['Solicitações']);
    expect(container.querySelector('.sidebar__group')).toBeNull();
    expect(screen.queryByText('Administração')).toBeNull();
    expect(container.querySelector('.sidebar__badge')).toBeNull();
    expect(screen.getByRole('radiogroup', { name: 'Tema da interface' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sair' })).toBeTruthy();
  });

  it('contador: aria-label "N pendentes" e so em Solicitacoes (>0)', () => {
    const { container } = renderAt('admin', '/', undefined, { '/solicitacoes': 3 });
    const contadores = container.querySelectorAll('.sidebar__badge');
    expect(contadores).toHaveLength(1);
    expect(contadores[0]?.getAttribute('aria-label')).toBe('3 pendentes');
    expect(contadores[0]?.textContent).toBe('3');
  });
});
