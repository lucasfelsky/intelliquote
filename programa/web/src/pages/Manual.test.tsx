import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Manual from './Manual';

// Fase M (Manual de uso): estrutura, indice, busca e ancoras. O CSS e conferido por telaM.test.ts e pelo harness.

let mockRole = 'admin';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Maria', email: 'maria@exemplo.invalid', role: mockRole } }),
}));

const IDS = [
  'comece-aqui',
  'perfis',
  'overview',
  'solicitacoes',
  'itens',
  'fornecedores',
  'forwarders',
  'criar-cotacao',
  'envio',
  'portal',
  'respostas',
  'comparacao',
  'ordem-de-compra',
  'relatorios',
  'administracao',
  'perguntas',
  'glossario',
];
const GRUPOS = ['Comece aqui', 'Cadastros e pedidos', 'O ciclo da cotação', 'Acompanhamento', 'Administração', 'Referência'];
// Glifos que viram Icon (nada de caractere decorativo no texto): check, x, menos, estrela, seta, sol, lua, meio-disco.
const GLIFOS = /[✓✕−★→☀☾◐]/;

const scrollIntoView = vi.fn(function (this: Element) {
  return this.id;
});

type Chamada = (entradas: Array<{ isIntersecting: boolean; target: Element }>) => void;
let observadores: Array<{ chamada: Chamada; alvos: Element[] }> = [];

class ObservadorFalso {
  readonly alvos: Element[] = [];
  constructor(readonly chamada: Chamada) {
    observadores.push(this);
  }
  observe(alvo: Element) {
    this.alvos.push(alvo);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function renderManual(role = 'admin', url = '/manual') {
  mockRole = role;
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Manual />
    </MemoryRouter>,
  );
}

const secoes = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('section[data-manual-capitulo]')];
const visiveis = (container: HTMLElement) => secoes(container).filter((s) => !s.hidden);
async function buscar(valor: string) {
  fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar no manual' }), { target: { value: valor } });
  // o termo so vale 180 ms depois da ultima digitacao
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 230));
  });
}

beforeEach(() => {
  scrollIntoView.mockClear();
  observadores = [];
  Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView'];
  vi.stubGlobal('IntersectionObserver', ObservadorFalso);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Manual: estrutura da pagina', () => {
  it.each(['admin', 'comprador', 'gestor', 'viewer'])('%s ve os 17 capitulos na ordem da previa, com os ids das ancoras', (role) => {
    const { container } = renderManual(role);
    expect(secoes(container).map((s) => s.id)).toEqual(IDS);
    expect(visiveis(container)).toHaveLength(17);
  });

  it('h1 unico "Manual do IntelliQuote", um h2 por capitulo e a pagina nao cria outro <main> (o shell ja tem)', () => {
    const { container } = renderManual();
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]?.textContent).toBe('Manual do IntelliQuote');
    expect(container.querySelectorAll('h2')).toHaveLength(17);
    expect(container.querySelectorAll('main')).toHaveLength(0);
    for (const secao of secoes(container)) {
      const titulo = secao.querySelector('h2');
      expect(secao.getAttribute('aria-labelledby'), secao.id).toBe(titulo?.id);
      expect(titulo?.getAttribute('tabindex'), secao.id).toBe('-1');
    }
  });

  it('cabecalho: eyebrow "Suporte", campo de busca rotulado e regiao aria-live polite', () => {
    const { container } = renderManual();
    expect(container.querySelector('.eyebrow')?.textContent).toBe('Suporte');
    expect(screen.getByRole('searchbox', { name: 'Buscar no manual' })).toBeTruthy();
    expect(screen.getByRole('search')).toBeTruthy();
    expect(container.querySelector('.manual-busca__status')?.getAttribute('aria-live')).toBe('polite');
  });

  it('kicker: o grupo e, no ciclo da cotacao, "etapa N de 6"', () => {
    const { container } = renderManual();
    const kicker = (id: string) => container.querySelector(`#${id} .manual-capitulo__kicker`)?.textContent;
    expect(kicker('perfis')).toBe('Comece aqui');
    expect(kicker('forwarders')).toBe('Cadastros e pedidos');
    expect(kicker('criar-cotacao')).toBe('O ciclo da cotação · etapa 1 de 6');
    expect(kicker('ordem-de-compra')).toBe('O ciclo da cotação · etapa 6 de 6');
    expect(kicker('glossario')).toBe('Referência');
  });

  it('"Quem faz" so nos capitulos que a previa marca (Criar uma cotacao e Enviar aos fornecedores): admin e comprador', () => {
    const { container } = renderManual();
    for (const id of ['criar-cotacao', 'envio']) {
      const papeis = container.querySelector(`#${id} .manual-papeis`);
      expect([...(papeis?.querySelectorAll('.badge') ?? [])].map((b) => b.textContent)).toEqual(['admin', 'comprador']);
    }
    expect(container.querySelectorAll('.manual-papeis').length).toBeGreaterThanOrEqual(2);
  });

  it('nenhum style inline e nenhum glifo decorativo no texto', () => {
    const { container } = renderManual();
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
    expect(GLIFOS.test(container.textContent ?? '')).toBe(false);
  });
});

describe('Manual: indice e seletor de capitulo', () => {
  it('indice: 6 grupos e 17 links na ordem; os numeros 1 a 6 so no ciclo da cotacao', () => {
    const { container } = renderManual();
    const indice = screen.getByRole('navigation', { name: 'Capítulos do manual' });
    expect([...indice.querySelectorAll('.manual-indice__grupo')].map((g) => g.textContent)).toEqual(GRUPOS);
    const links = [...indice.querySelectorAll<HTMLAnchorElement>('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(IDS.map((id) => `#${id}`));
    expect([...container.querySelectorAll('.manual-indice__n')].map((n) => n.textContent).filter(Boolean)).toEqual(['1', '2', '3', '4', '5', '6']);
    for (const lista of indice.querySelectorAll('ul')) {
      const rotulo = document.getElementById(lista.getAttribute('aria-labelledby') ?? '');
      expect(rotulo?.className).toBe('manual-indice__grupo');
    }
  });

  it('o primeiro capitulo comeca ativo (aria-current="location") e o scrollspy troca o ativo', () => {
    renderManual();
    const indice = screen.getByRole('navigation', { name: 'Capítulos do manual' });
    const ativos = () => [...indice.querySelectorAll('a[aria-current="location"]')].map((a) => a.getAttribute('href'));
    expect(ativos()).toEqual(['#comece-aqui']);
    expect(observadores).toHaveLength(1);
    const alvo = observadores[0]?.alvos.find((a) => a.id === 'comparacao');
    expect(alvo).toBeDefined();
    act(() => observadores[0]?.chamada([{ isIntersecting: true, target: alvo as Element }]));
    expect(ativos()).toEqual(['#comparacao']);
    expect(indice.querySelector('a[aria-current="location"]')?.className).toContain('manual-indice__link--ativo');
    expect((screen.getByLabelText('Ir para o capítulo') as HTMLSelectElement).value).toBe('comparacao');
  });

  it('observa os 17 capitulos com a faixa da previa (-15% 0 -75% 0); sem IntersectionObserver a pagina funciona igual', () => {
    renderManual();
    expect(observadores[0]?.alvos).toHaveLength(17);
    cleanup();
    vi.unstubAllGlobals();
    expect(() => renderManual()).not.toThrow();
  });

  it('clicar num link do indice rola ate o capitulo, leva o foco ao titulo e marca o link ativo', () => {
    const { container } = renderManual();
    fireEvent.click(screen.getByRole('link', { name: /Enviar aos fornecedores/ }));
    expect(scrollIntoView).toHaveBeenCalled();
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(container.querySelector('#envio'));
    expect(document.activeElement).toBe(container.querySelector('#envio-titulo'));
    expect(screen.getByRole('link', { name: /Enviar aos fornecedores/ }).getAttribute('aria-current')).toBe('location');
  });

  it('seletor de capitulo: rotulo, 6 optgroup e 17 opcoes (com o numero da etapa no ciclo)', () => {
    const { container } = renderManual();
    const select = screen.getByLabelText('Ir para o capítulo') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect([...select.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(GRUPOS);
    expect([...select.options].map((o) => o.value)).toEqual(IDS);
    expect(select.options[7]?.textContent).toBe('1. Criar uma cotação');
    expect(select.options[0]?.textContent).toBe('O que é o IntelliQuote');
    fireEvent.change(select, { target: { value: 'portal' } });
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(container.querySelector('#portal'));
  });

  it('/manual#comparacao rola ate o capitulo ao abrir; hash que nao e capitulo nao rola', () => {
    const { container } = renderManual('admin', '/manual#comparacao');
    expect(scrollIntoView.mock.contexts).toContain(container.querySelector('#comparacao'));
    cleanup();
    scrollIntoView.mockClear();
    renderManual('admin', '/manual#nao-existe');
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('Manual: busca com destaque e contador', () => {
  it('termo de 1 letra nao filtra nada e nao limpa o status', async () => {
    const { container } = renderManual();
    await buscar('a');
    expect(visiveis(container)).toHaveLength(17);
    expect(container.querySelector('.manual-busca__status')?.textContent).toBe('');
    expect(container.querySelectorAll('mark')).toHaveLength(0);
  });

  it('termo com ocorrencia: status "N capitulos encontrados", marca no texto e o indice acompanha os capitulos visiveis', async () => {
    const { container } = renderManual();
    await buscar('fornecedor');
    const n = visiveis(container).length;
    expect(n).toBeGreaterThan(1);
    expect(n).toBeLessThan(17);
    expect(container.querySelector('.manual-busca__status')?.textContent).toBe(`${n} capítulos encontrados`);
    expect(container.querySelectorAll('mark.manual-marca').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('svg mark')).toHaveLength(0);
    const indice = screen.getByRole('navigation', { name: 'Capítulos do manual' });
    const ids = visiveis(container).map((s) => s.id);
    expect([...indice.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(ids.map((id) => `#${id}`));
    expect((screen.getByLabelText('Ir para o capítulo') as HTMLSelectElement).options).toHaveLength(n);
    for (const oculto of secoes(container).filter((s) => s.hidden)) expect(oculto.querySelector('mark')).toBeNull();
  });

  it('a busca ignora acento e caixa: "SOLICITACOES" acha e marca "Solicitações"', async () => {
    const { container } = renderManual();
    await buscar('SOLICITACOES');
    expect(visiveis(container).map((s) => s.id)).toContain('solicitacoes');
    const marca = container.querySelector('#solicitacoes mark.manual-marca');
    expect(marca?.textContent?.toLowerCase()).toBe('solicitações');
  });

  it('um capitulo so: "1 capítulo encontrado" (singular) e o indice fica com 1 link', async () => {
    const { container } = renderManual();
    await buscar('etapa 6 de 6');
    expect(visiveis(container).map((s) => s.id)).toEqual(['ordem-de-compra']);
    expect(container.querySelector('.manual-busca__status')?.textContent).toBe('1 capítulo encontrado');
    expect(screen.getByRole('navigation', { name: 'Capítulos do manual' }).querySelectorAll('a')).toHaveLength(1);
  });

  it('sem resultado: "Nada encontrado" com role="status", status vazio e todos os capitulos ocultos (continuam no DOM)', async () => {
    const { container } = renderManual();
    await buscar('xyzw');
    expect(visiveis(container)).toHaveLength(0);
    expect(secoes(container)).toHaveLength(17);
    const vazio = screen.getByText('Nada encontrado').closest('[role="status"]') as HTMLElement;
    expect(vazio).toBeTruthy();
    expect(within(vazio).getByText('Tente outra palavra, como “link”, “PO” ou “aprovação”.')).toBeTruthy();
    expect(container.querySelector('.manual-busca__status')?.textContent).toBe('');
    expect(screen.queryByRole('navigation', { name: 'Capítulos do manual' })).toBeNull();
  });

  it('limpar o campo devolve os 17 capitulos, tira as marcas e o cartao de vazio', async () => {
    const { container } = renderManual();
    await buscar('xyzw');
    await buscar('');
    await waitFor(() => expect(visiveis(container)).toHaveLength(17));
    expect(container.querySelectorAll('mark')).toHaveLength(0);
    expect(screen.queryByText('Nada encontrado')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Capítulos do manual' })).toBeTruthy();
  });

  it('o termo so vale depois de 180 ms: antes disso nada muda', async () => {
    const { container } = renderManual();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar no manual' }), { target: { value: 'xyzw' } });
    expect(visiveis(container)).toHaveLength(17);
    await waitFor(() => expect(visiveis(container)).toHaveLength(0));
  });
});

describe('Manual: perfil Comercial', () => {
  it('ve SO o capitulo Solicitacoes: sem indice, sem seletor e sem texto de outro capitulo', () => {
    const { container } = renderManual('comercial');
    expect(secoes(container).map((s) => s.id)).toEqual(['solicitacoes']);
    expect(screen.queryByRole('navigation', { name: 'Capítulos do manual' })).toBeNull();
    expect(screen.queryByLabelText('Ir para o capítulo')).toBeNull();
    expect(container.querySelector('.manual-layout--unico')).not.toBeNull();
    expect(container.textContent).not.toContain('Perfis e permissões');
    expect(container.textContent).not.toContain('Enviar aos fornecedores');
    expect(screen.getByRole('heading', { level: 2, name: 'Solicitações do Comercial' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('searchbox', { name: 'Buscar no manual' })).toBeTruthy();
    expect(observadores).toHaveLength(0);
  });

  it('a busca do Comercial nao acha os outros 16 capitulos', async () => {
    const { container } = renderManual('comercial');
    await buscar('Fornecedores e documentos');
    expect(visiveis(container).map((s) => s.id).filter((id) => id !== 'solicitacoes')).toEqual([]);
    await buscar('perfis e permissões');
    expect(visiveis(container)).toHaveLength(0);
    expect(screen.getByText('Nada encontrado')).toBeTruthy();
  });

  it('/manual#perfis para o Comercial nao rola (o capitulo nao existe para ele)', () => {
    renderManual('comercial', '/manual#perfis');
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
