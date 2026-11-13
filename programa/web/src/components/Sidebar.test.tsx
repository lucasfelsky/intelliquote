import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from './Sidebar';
import { ADMIN_NAV, COMEX_ROLES, INDENT_NAV, PRIMARY_NAV, filterNavByRole, type NavItem } from './navConfig';

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
    expect(links).toHaveLength(15);
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

  it('rodape (F2b): botao de tema -> Sair -> assinatura, nessa ordem (sem rotulo de versao); Sair chama onLogout', () => {
    const onLogout = vi.fn();
    const { container } = renderAt('admin', '/', onLogout);
    const footer = container.querySelector('.sidebar__footer');
    expect(footer).not.toBeNull();
    const tema = screen.getByRole('button', { name: 'Tema: automático — alternar tema' });
    const sair = screen.getByRole('button', { name: 'Sair' });
    const assinatura = container.querySelector('.sidebar__signature');
    expect(tema.className).toBe('sidebar__theme');
    expect(screen.queryByRole('radiogroup')).toBeNull();
    for (const el of [tema, sair, assinatura]) expect(footer?.contains(el ?? null)).toBe(true);
    const antes = (a: Element | null, b: Element | null) => !!(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(antes(tema, sair)).toBe(true);
    expect(antes(sair, assinatura)).toBe(true);
    fireEvent.click(sair);
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.sidebar__version')).toBeNull();
    expect(screen.queryByText('v0.1 · Build local')).toBeNull();
    expect(footer?.lastElementChild).toBe(assinatura);
  });

  it('assinatura "SQ Química": role="img" com o svg aria-hidden e nenhum descendente focavel; sem link nem botao', () => {
    const { container } = renderAt('admin', '/');
    const assinatura = container.querySelector('.sidebar__signature');
    expect(assinatura).not.toBeNull();
    const logo = screen.getByRole('img', { name: 'SQ Química' });
    expect(assinatura?.contains(logo)).toBe(true);
    expect(logo.className).toContain('sq-logo--dark');
    expect(logo.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(logo.querySelector('svg')?.getAttribute('width')).toBe('32');
    expect(assinatura?.querySelectorAll('a, button, [tabindex]')).toHaveLength(0);
    expect(logo.textContent).toBe('sqquímica');
  });

  it('sem onLogout o clique em Sair nao quebra', () => {
    renderAt('admin', '/');
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Sair' }))).not.toThrow();
  });

  it('comercial: so Solicitacoes e Manual, sem Administracao e sem contador; rodape completo (tema, Sair, assinatura; sem versao)', () => {
    const { container } = renderAt('comercial', '/solicitacoes');
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(['Solicitações', 'Manual']);
    expect(container.querySelector('.sidebar__group')).toBeNull();
    expect(screen.queryByText('Administração')).toBeNull();
    expect(container.querySelector('.sidebar__badge')).toBeNull();
    expect(screen.getByRole('button', { name: 'Tema: automático — alternar tema' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sair' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'SQ Química' })).toBeTruthy();
    expect(container.querySelector('.sidebar__version')).toBeNull();
    expect(screen.queryByText('v0.1 · Build local')).toBeNull();
  });

  it('contador: aria-label "N pendentes" e so em Solicitacoes (>0)', () => {
    const { container } = renderAt('admin', '/', undefined, { '/solicitacoes': 3 });
    const contadores = container.querySelectorAll('.sidebar__badge');
    expect(contadores).toHaveLength(1);
    expect(contadores[0]?.getAttribute('aria-label')).toBe('3 pendentes');
    expect(contadores[0]?.textContent).toBe('3');
  });
});

// ---------- Variante Indent (abordagem A: props opcionais; sem elas o markup e o do IQ, ver Sidebar.regressao.test.tsx) ----------
const VOLTAR: NavItem = { to: '/', label: 'Voltar ao IntelliQuote', icon: 'arrow-left', end: true };

function renderIndent(path = '/indent/catalogo', extra: { colapsada?: boolean; onLogout?: () => void } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar
        items={filterNavByRole(INDENT_NAV, 'admin')}
        variant="indent"
        brandTag="Indent"
        backLink={VOLTAR}
        sectionTitle="Indent"
        navLabel="Indent"
        onAlternar={() => {}}
        {...extra}
      />
    </MemoryRouter>,
  );
}

describe('Sidebar - variante Indent', () => {
  it('marca com o selo "Indent" abaixo do nome (so na variante) e classe sidebar--indent no aside', () => {
    const { container } = renderIndent();
    const texto = container.querySelector('.sidebar__brand .sidebar__brand-text');
    expect(texto).not.toBeNull();
    expect(texto?.querySelector('.sidebar__brand-name')?.textContent).toBe('IntelliQuote');
    expect(texto?.querySelector('.sidebar__brand-tag')?.textContent).toBe('Indent');
    expect(texto?.lastElementChild?.className).toBe('sidebar__brand-tag');
    expect(container.querySelector('aside')?.className).toBe('sidebar sidebar--indent');
  });

  it('"Voltar ao IntelliQuote" leva a / numa navegacao propria "Voltar", antes da navegacao principal', () => {
    const { container } = renderIndent();
    const voltar = container.querySelector('nav[aria-label="Voltar"]');
    expect(voltar?.className).toBe('sidebar__nav sidebar__nav--voltar');
    const link = screen.getByRole('link', { name: 'Voltar ao IntelliQuote' });
    expect(link.getAttribute('href')).toBe('/');
    expect(voltar?.contains(link)).toBe(true);
    expect(link.querySelector('svg.sidebar__icon')).not.toBeNull();
    const principal = container.querySelector('#sidebar-nav');
    expect(voltar && principal && voltar.compareDocumentPosition(principal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // em /indent/* o Voltar nunca fica ativo (end em "/")
    expect(link.hasAttribute('aria-current')).toBe(false);
  });

  it('titulo de secao "Indent" e navegacao principal rotulada "Indent" com so os 3 links do INDENT_NAV', () => {
    const { container } = renderIndent();
    const nav = container.querySelector('#sidebar-nav');
    expect(nav?.getAttribute('aria-label')).toBe('Indent');
    expect(nav?.querySelector('.sidebar__group > .sidebar__group-title')?.textContent).toBe('Indent');
    const links = Array.from(nav?.querySelectorAll('a') ?? []);
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Catálogo', '/indent/catalogo'],
      ['Fornecedores', '/indent/fornecedores'],
      ['Clientes', '/indent/clientes'],
    ]);
    const todos = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
    expect(todos).toHaveLength(4);
    expect(todos.some((h) => /solicitacoes|cotacoes|integracao/.test(h ?? ''))).toBe(false);
    expect(container.querySelector('.sidebar__badge')).toBeNull();
    expect(screen.queryByText(/Administração/)).toBeNull();
  });

  it('a pagina atual fica marcada com aria-current="page"', () => {
    renderIndent('/indent/clientes');
    const atuais = screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page');
    expect(atuais.map((l) => l.textContent)).toEqual(['Clientes']);
  });

  it('rodape (tema -> Sair -> assinatura) identico ao da sidebar padrao, e Sair chama onLogout', () => {
    const onLogout = vi.fn();
    const indent = renderIndent('/indent/catalogo', { onLogout });
    const rodapeIndent = indent.container.querySelector('.sidebar__footer') as HTMLElement;
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
    const semEstilo = (el: HTMLElement) => {
      const clone = el.cloneNode(true) as HTMLElement;
      clone.removeAttribute('style'); // --k (cascata) depende do numero de itens
      return clone.outerHTML;
    };
    const indentHtml = semEstilo(rodapeIndent);
    indent.unmount();
    const padrao = renderAt('admin', '/cotacoes', () => {});
    expect(semEstilo(padrao.container.querySelector('.sidebar__footer') as HTMLElement)).toBe(indentHtml);
  });

  it('recolhida: o Voltar herda a dica ao apontar (so icone na tela, texto no DOM)', () => {
    const { container } = renderIndent('/indent/catalogo', { colapsada: true });
    const link = screen.getByRole('link', { name: 'Voltar ao IntelliQuote' });
    fireEvent.mouseEnter(link.closest('li') as HTMLElement);
    expect(container.querySelector('.sidebar__dica')?.textContent).toBe('Voltar ao IntelliQuote');
    expect(container.querySelector('.sidebar--colapsada.sidebar--indent')).not.toBeNull();
  });

  it('sidebar padrao (sem as props): sem selo, sem navegacao "Voltar", sem classe da variante, rotulo "Navegação principal" e 15 links', () => {
    const { container } = renderAt('admin', '/cotacoes');
    expect(container.querySelector('.sidebar__brand-tag')).toBeNull();
    expect(container.querySelector('.sidebar__brand-text')).toBeNull();
    expect(container.querySelector('nav[aria-label="Voltar"]')).toBeNull();
    expect(container.querySelector('.sidebar--indent')).toBeNull();
    expect(container.querySelector('#sidebar-nav')?.getAttribute('aria-label')).toBe('Navegação principal');
    expect(container.querySelectorAll('.sidebar__link')).toHaveLength(15);
    expect(container.querySelectorAll('#sidebar-nav .sidebar__group-title')).toHaveLength(1); // so Administração
  });
});
