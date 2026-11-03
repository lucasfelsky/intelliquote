import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Manual from './Manual';
import { normalizar as normalizarBusca } from './Manual/busca';
import { dataBr, GLOSSARIO, MANUAL_ATUALIZADO_EM, PERGUNTAS_FREQUENTES, RODAPE_DO_MANUAL } from './Manual/dados';

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
    await buscar('forwarder');
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

describe('Manual: capitulos 1 a 7 (M2)', () => {
  const texto = (container: HTMLElement, id: string) => container.querySelector(`#${id}`)?.textContent ?? '';

  it('matriz de perfis: 13 linhas x 5 perfis, cada celula com "Sim"/"Não" para leitor de tela (ou o selo ver/parcial)', () => {
    const { container } = renderManual();
    const tabela = container.querySelector('#perfis table') as HTMLTableElement;
    expect([...tabela.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['O que a pessoa pode fazer', 'Admin', 'Comprador', 'Gestor', 'Viewer', 'Comercial']);
    const linhas = [...tabela.querySelectorAll('tbody tr')];
    expect(linhas).toHaveLength(13);
    const celulas = (i: number) => [...(linhas[i]?.querySelectorAll('td') ?? [])].slice(1).map((td) => td.textContent?.replace('—', '').trim());
    for (const linha of linhas) expect(linha.querySelectorAll('td')).toHaveLength(6);
    // "Criar e editar cotacoes...": o gestor gera link novo e revoga links existentes = parcial (achado D8; o texto descreve o codigo atual)
    expect(celulas(1)).toEqual(['Sim', 'Sim', 'parcial', 'Não', 'Não']);
    expect(celulas(7)).toEqual(['Sim', 'Sim', 'ver', 'ver', 'Não']);
    expect(celulas(8)).toEqual(['Não', 'Não', 'Não', 'Não', 'Sim']);
    expect(celulas(9)).toEqual(['Sim', 'parcial', 'Sim', 'Não', 'Não']);
    expect(celulas(12)).toEqual(['Sim', 'Não', 'Não', 'Não', 'Não']);
    expect(tabela.querySelectorAll('.sr-only').length).toBeGreaterThan(40);
    expect(tabela.querySelectorAll('[aria-hidden="true"]:not(svg)').length).toBeGreaterThan(10);
    expect(texto(container, 'perfis')).toContain('o gestor, nas cotações, gera link novo e revoga links existentes');
  });

  it('tabelas e figuras que rolam na horizontal sao regioes focaveis com nome', () => {
    const { container } = renderManual();
    const regioes = [...container.querySelectorAll<HTMLElement>('.manual-rolagem')];
    expect(regioes.length).toBeGreaterThanOrEqual(3);
    for (const regiao of regioes) {
      expect(regiao.getAttribute('tabindex'), regiao.className).toBe('0');
      expect(regiao.getAttribute('role')).toBe('region');
      expect(regiao.getAttribute('aria-label')).toMatch(/^(Figura|Tabela): .+, role na horizontal$/);
    }
    expect(screen.getByRole('region', { name: 'Figura: fluxo completo de uma compra, role na horizontal' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Tabela: o que cada perfil pode fazer, role na horizontal' })).toBeTruthy();
  });

  it('swimlane: svg com role="img" e <title> (aria-labelledby), ids unicos na pagina e nada de <mark> dentro', () => {
    const { container } = renderManual();
    const svg = container.querySelector('#comece-aqui svg.manual-svg') as SVGElement;
    expect(svg.getAttribute('role')).toBe('img');
    const titulo = svg.querySelector('title');
    expect(titulo?.id).toBeTruthy();
    expect(svg.getAttribute('aria-labelledby')).toBe(titulo?.id);
    expect(titulo?.textContent).toContain('Fluxo completo: solicitação do Comercial');
    const ids = [...container.querySelectorAll('[id]')].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const marcador of svg.querySelectorAll('marker')) expect(marcador.id).toBeTruthy();
    expect(svg.textContent).toContain('lembretes seg–sex');
  });

  it('avisos: caixa propria (nunca .alert), role="note" com o tipo e icone aria-hidden', () => {
    const { container } = renderManual();
    expect(container.querySelectorAll('.alert')).toHaveLength(0);
    const avisos = [...container.querySelectorAll('.manual-aviso')];
    expect(avisos.length).toBeGreaterThanOrEqual(4);
    for (const aviso of avisos) {
      expect(aviso.getAttribute('role')).toBe('note');
      expect(['Dica', 'Atenção', 'Informação']).toContain(aviso.getAttribute('aria-label'));
      expect(aviso.querySelector('.manual-aviso__icone svg')?.getAttribute('aria-hidden')).toBe('true');
    }
    expect(container.querySelector('#comece-aqui .manual-aviso--info')?.textContent).toContain('Esqueceu a senha?');
    expect(container.querySelector('#itens .manual-aviso--dica')?.textContent).toContain('criada automaticamente');
  });

  it('Comece aqui: texto do codigo atual (perfil derivado, Sair e Tema no rodape do menu, sem "barra superior")', () => {
    const { container } = renderManual();
    const t = texto(container, 'comece-aqui');
    expect(t).toContain('com um perfil derivado do Portal (admin e viewer iguais; os demais entram como comprador; quem é da Área Comercial entra como comercial)');
    expect(t).toContain('Sair no rodapé do menu lateral');
    expect(t).toContain('O botão Tema, no rodapé do menu lateral, alterna Automático (segue o computador), Noturno e Claro.');
    expect(t).toContain('admin, gestor, comprador e viewer, conforme o caso');
    expect(t).not.toContain('barra superior');
    expect(t).not.toContain('Experimente aqui em cima');
    expect(container.querySelectorAll('#comece-aqui .manual-passos > li')).toHaveLength(3);
    expect(container.querySelectorAll('#comece-aqui .manual-mini')).toHaveLength(3);
  });

  it('Perfis e Overview: Comercial ve "só este capítulo"; taxa "50% ou mais"; sem "sempre em dólar"', () => {
    const { container } = renderManual();
    expect(texto(container, 'perfis')).toContain('vê a tela Solicitações e, no Manual, só este capítulo');
    const overview = texto(container, 'overview');
    expect(overview).toContain('Taxa de 50% ou mais ganha destaque.');
    expect(overview).not.toContain('sempre em dólar');
    expect(overview).not.toContain('acima de 50%');
    expect(container.querySelectorAll('#overview .manual-kpi')).toHaveLength(4);
    expect(container.querySelector('#overview .manual-exemplo')?.textContent).toBe('Exemplo fictício');
    expect(container.querySelector('#overview a')?.getAttribute('href')).toBe('#relatorios');
  });

  it('Solicitacoes: botoes com o rotulo real e icone plus (sem "+ "), item novo/desenvolvimento e atender sem preco', () => {
    const { container } = renderManual();
    const t = texto(container, 'solicitacoes');
    expect(t).toContain('Solicitar uma cotação');
    expect(t).not.toContain('Nova solicitação');
    expect(t).toContain('Item que não está no catálogo');
    expect(t).toContain('a solicitação passa a ser de desenvolvimento e o COMEX cadastra o item antes de cotar');
    expect(t).toContain('TDS, MSDS ou outro');
    expect(t).toContain('o admin pode marcar como atendida sem preço, com uma nota');
    expect(t).toContain('Exige um motivo de 3 a 500 caracteres');
    const primario = container.querySelector('#solicitacoes .manual-ui--primario');
    expect(primario?.textContent).toBe('Solicitar uma cotação');
    expect(primario?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('#solicitacoes .manual-passos > li')).toHaveLength(5);
    expect(container.querySelectorAll('#solicitacoes .manual-mini')).toHaveLength(4);
    expect(container.querySelectorAll('#solicitacoes .manual-fluxo')).toHaveLength(2);
  });

  it('nenhum rotulo de botao com "+ " no texto: o + e sempre o icone plus', () => {
    const { container } = renderManual();
    const rotulos = [...container.querySelectorAll('.manual-ui')];
    expect(rotulos.filter((r) => /^\+/.test(r.textContent ?? ''))).toEqual([]);
    for (const nome of ['Novo item', 'Novo fornecedor', 'Adicionar contato', 'Novo forwarder', 'Adicionar outro item']) {
      const rotulo = rotulos.find((e) => e.textContent === nome);
      expect(rotulo, nome).toBeDefined();
      expect(rotulo?.querySelector('svg'), nome).not.toBeNull();
    }
    expect(texto(container, 'fornecedores')).toContain('use o botão de expandir (ícone +) da linha');
  });

  it('Itens, Fornecedores e Forwarders: tabela de exemplo, passos da importacao, regua com 5 marcas e lista do forwarder', () => {
    const { container } = renderManual();
    expect([...container.querySelectorAll('#itens tbody tr')].map((tr) => tr.querySelector('td')?.textContent)).toEqual(['Ácido cítrico anidro', 'Benzoato de sódio']);
    expect(container.querySelectorAll('#itens .manual-passos > li')).toHaveLength(3);
    const regua = container.querySelector('#fornecedores .manual-regua');
    expect(regua?.getAttribute('role')).toBe('img');
    expect(regua?.getAttribute('aria-label')).toContain('D-30');
    expect(regua?.querySelectorAll('.manual-regua__marca')).toHaveLength(5);
    expect(regua?.querySelectorAll('.manual-regua__marca--vermelha')).toHaveLength(2);
    expect(container.querySelectorAll('#fornecedores .badge')).toHaveLength(2);
    expect(container.querySelectorAll('#forwarders li')).toHaveLength(3);
  });

  it('a busca destaca texto dentro de rotulos, minis, tabelas e legendas (componentes que recebem texto por prop tambem)', async () => {
    const { container } = renderManual();
    await buscar('marcar atendida');
    expect(container.querySelector('#solicitacoes .manual-ui mark.manual-marca')?.textContent?.toLowerCase()).toBe('marcar atendida');
    await buscar('resposta manual');
    expect(container.querySelector('#perfis td mark.manual-marca')?.textContent?.toLowerCase()).toBe('resposta manual');
    await buscar('quatro indicadores');
    expect(container.querySelector('#overview .manual-figura__legenda mark.manual-marca')).not.toBeNull();
    await buscar('mesma moeda');
    expect(container.querySelector('#solicitacoes .manual-mini mark.manual-marca')).not.toBeNull();
    expect(container.querySelectorAll('svg mark')).toHaveLength(0);
  });
});

describe('Manual: capitulos 8 a 10 (M3)', () => {
  const texto = (container: HTMLElement, id: string) => container.querySelector(`#${id}`)?.textContent ?? '';

  it('Criar uma cotacao: 4 passos, rotulos reais com icone plus, exemplo da cotacao e rotulos de INCOTERM do codigo atual', () => {
    const { container } = renderManual();
    expect(container.querySelectorAll('#criar-cotacao .manual-passos > li')).toHaveLength(4);
    const t = texto(container, 'criar-cotacao');
    for (const rotulo of ['Nova cotação', 'Adicionar item', 'Criar cotação', 'Agrupar por PO', 'Mover']) {
      expect([...container.querySelectorAll('#criar-cotacao .manual-ui')].map((e) => e.textContent), rotulo).toContain(rotulo);
    }
    expect([...container.querySelectorAll('#criar-cotacao .manual-ui')].filter((e) => e.querySelector('svg')).map((e) => e.textContent)).toEqual(['Nova cotação', 'Adicionar item']);
    expect(t).toContain('desmarque “Usar o INCOTERM da cotação” (ou “Usar os INCOTERMS da cotação”, quando a cotação aceita mais de um) ou “Usar o porto da cotação”');
    expect(t).not.toContain('Usar o(s) INCOTERM');
    expect(t).toContain('Apagar (só admin) remove a cotação com as respostas e os itens');
    expect(t).toContain('Reabrir (admin e gestor) desfaz a escolha da vencedora.');
    expect(t).not.toMatch(/\+ (Nova|Adicionar)/);
    const linhas = [...container.querySelectorAll('#criar-cotacao table tbody tr')].map((tr) => tr.querySelector('td')?.textContent);
    expect(linhas).toEqual(['Código', 'Incoterms aceitáveis', 'Embarque  para  destino', 'Moeda · prazo', 'Itens']);
    expect(container.querySelector('#criar-cotacao table tbody tr:nth-child(3) td:nth-child(2)')?.textContent).toBe('Shanghai  para  Porto de Santos');
    expect(container.querySelectorAll('#criar-cotacao table .badge')).toHaveLength(3);
    expect(container.querySelectorAll('#criar-cotacao table svg')).toHaveLength(2);
  });

  it('Criar uma cotacao: POs agrupadas (3 colunas), aviso de atencao e ciclo da cotacao em SVG com titulo', () => {
    const { container } = renderManual();
    const colunas = [...container.querySelectorAll('#criar-cotacao .manual-po')];
    expect(colunas.map((c) => c.querySelector('.manual-po__cabecalho span')?.textContent)).toEqual(['PO 1 · Acidulantes', 'PO 2 · Conservantes', 'Sem PO']);
    expect(colunas[2]?.className).toContain('manual-po--sem');
    expect(colunas[2]?.textContent).toContain('Arraste para uma PO ou use “Mover”.');
    expect(container.querySelector('#criar-cotacao .manual-aviso--atencao')?.textContent).toContain('Remover a penúltima PO desfaz o agrupamento.');
    const ciclo = container.querySelector('#criar-cotacao svg.manual-svg--ciclo') as SVGElement;
    expect(ciclo.getAttribute('role')).toBe('img');
    expect(ciclo.querySelector('title')?.id).toBe(ciclo.getAttribute('aria-labelledby'));
    expect(ciclo.textContent).toContain('Fechar ou Concluir');
    expect(screen.getByRole('region', { name: 'Figura: ciclo de status da cotação, role na horizontal' })).toBeTruthy();
    expect(container.querySelector('#criar-cotacao .manual-papeis')?.textContent).toBe('Quem faz:admincomprador');
  });

  it('Enviar: 4 passos, e-mail de exemplo (Para, Cc, Cc so no 1o e Assunto), links do portal e semana de lembretes', () => {
    const { container } = renderManual();
    expect(container.querySelectorAll('#envio .manual-passos > li')).toHaveLength(4);
    const email = container.querySelector('#envio dl.manual-email') as HTMLElement;
    expect([...email.querySelectorAll('dt')].map((e) => e.textContent)).toEqual(['Para', 'Cc', 'Cc', 'Assunto']);
    expect([...email.querySelectorAll('dd')].map((e) => e.querySelectorAll('.manual-email__endereco').length)).toEqual([1, 2, 1, 0]);
    expect(email.querySelector('.manual-email__endereco--principal')?.textContent).toBe('mei.chen@lianyun-chem.example');
    expect(email.querySelector('.manual-email__endereco--primeiro')?.textContent).toBe('comex@sqquimica.example');
    expect(email.textContent).toContain('Sourcing request COT-2026-0412 - Citric Acid Anhydrous');
    expect(email.textContent).toContain('Equipe COMEX + cópia fixa da empresa, só no 1º e-mail do envio');
    const t = texto(container, 'envio');
    expect(t).toContain('a tela sugere 7');
    expect(t).toContain('Gerar novo link');
    expect(t).toContain('desativa o anterior na hora');
    expect(t).toContain('cria links só para quem ainda não tem um ativo');
    expect(container.querySelectorAll('#envio p > .badge')).toHaveLength(3);
    const dias = [...container.querySelectorAll('#envio .manual-dia')];
    expect(dias.map((d) => d.querySelector('.manual-dia__nome')?.textContent)).toEqual(['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']);
    expect(dias.map((d) => d.querySelector('.manual-dia__hora')?.textContent)).toEqual(['04:00', '04:00', '04:00', '04:00', '04:00', '—', '—']);
    expect(container.querySelectorAll('#envio .manual-dia--folga')).toHaveLength(2);
    expect(t).toContain('Horário de Brasília. Quem tem várias cotações pendentes recebe um único e-mail com o resumo.');
    expect(container.querySelectorAll('#envio .manual-grade--2 li')).toHaveLength(6);
    expect(t).toContain('o link foi criado hoje ou aberto nas últimas 24 horas');
  });

  it('O que o fornecedor ve: tela do portal em ingles (so ilustracao), 5 observacoes e o aviso do Ctrl+F5', () => {
    const { container } = renderManual();
    const portal = container.querySelector('#portal .manual-portal') as HTMLElement;
    expect(portal.getAttribute('role')).toBe('group');
    expect(portal.getAttribute('aria-label')).toBe('Exemplo da tela do portal do fornecedor');
    expect(portal.querySelector('input, button, select')).toBeNull();
    expect(portal.querySelector('.manual-portal__barra')?.textContent).toBe('SQ Quimica · Supplier PortalSourcing request COT-2026-0412');
    expect([...portal.querySelectorAll('.manual-portal__campo')].map((c) => c.querySelector('span')?.textContent)).toEqual([
      'Currency',
      'Main incoterm',
      'Payment terms (days)',
      'Offer validity (days)',
      'FOB · USD / KG',
      'CFR · USD / KG',
      'CIF · USD / KG',
      'Lead time (days)',
      'Total price',
    ]);
    expect(portal.querySelector('.manual-portal__valor .badge')?.textContent).toBe('Main');
    expect(portal.textContent).toContain('41,250.00');
    expect([...portal.querySelectorAll('.manual-portal__marca')].map((m) => m.textContent)).toEqual(['Temporarily unavailable', 'Dangerous goods (DG)']);
    expect(container.querySelectorAll('#portal > ul > li, #portal ul.manual-lista > li')).toHaveLength(5);
    expect(container.querySelector('#portal .manual-aviso--info')?.textContent).toContain('This page was updated. Please reload it (Ctrl+F5)');
    expect(container.querySelector('#portal .manual-figura__legenda')?.textContent).toBe('Exemplo fictício Proposta da Lianyun Fine Chemicals: 1,62 × 20.000 + 1,77 × 5.000 (benzoato) = US$ 41.250.');
  });

  it('a busca por "lembrete" acha o capitulo Enviar, marca o texto e nunca marca dentro de SVG', async () => {
    const { container } = renderManual();
    await buscar('lembrete');
    const ids = visiveis(container).map((s) => s.id);
    expect(ids).toContain('envio');
    expect(container.querySelectorAll('#envio mark.manual-marca').length).toBeGreaterThan(1);
    expect(container.querySelector('.manual-busca__status')?.textContent).toBe(`${ids.length} ${ids.length === 1 ? 'capítulo encontrado' : 'capítulos encontrados'}`);
    expect(container.querySelectorAll('svg mark')).toHaveLength(0);
    await buscar('lembretes seg');
    expect(visiveis(container).map((s) => s.id)).toContain('comece-aqui');
    expect(container.querySelectorAll('svg mark')).toHaveLength(0);
  });

  it('a busca destaca dentro da tela do portal, do e-mail de exemplo e da PO agrupada (texto de dados.ts)', async () => {
    const { container } = renderManual();
    await buscar('main incoterm');
    expect(container.querySelector('#portal .manual-portal mark.manual-marca')?.textContent?.toLowerCase()).toBe('main incoterm');
    await buscar('mei.chen');
    expect(container.querySelector('#envio .manual-email mark.manual-marca')?.textContent).toBe('mei.chen');
    await buscar('conservantes');
    expect(container.querySelector('#criar-cotacao .manual-po mark.manual-marca')).not.toBeNull();
  });
});

describe('Manual: capitulos 11 a 13 (M4)', () => {
  const texto = (container: HTMLElement, id: string) => container.querySelector(`#${id}`)?.textContent ?? '';
  const chip = (container: HTMLElement, nome: string) => within(container.querySelector<HTMLElement>('#comparacao .manual-sim__chips')!).getByRole('button', { name: nome });
  const nomesDoRanking = (container: HTMLElement) => [...container.querySelectorAll('#comparacao .manual-sim__linha .manual-sim__nome')].map((n) => n.firstChild?.textContent);

  it('Respostas: tabela de 3 propostas com sinais, 4 minis com rotulos reais (Nova resposta com icone plus) e 2 avisos', () => {
    const { container } = renderManual();
    expect([...container.querySelectorAll('#respostas tbody tr')].map((tr) => tr.querySelector('strong')?.textContent)).toEqual(['Lianyun Fine Chemicals', 'Jinhai Industrial', 'Shenghua Trading']);
    expect(container.querySelectorAll('#respostas tbody .badge')).toHaveLength(5);
    expect(container.querySelectorAll('#respostas .manual-mini')).toHaveLength(4);
    const nova = [...container.querySelectorAll('#respostas .manual-ui')].find((e) => e.textContent === 'Nova resposta');
    expect(nova?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('#respostas .manual-aviso')).toHaveLength(2);
    expect(texto(container, 'respostas')).not.toContain('+ Nova resposta');
  });

  it('simulador: 4 chips com aria-pressed (Preco e Pagamento ligados), grupo rotulado e ranking da previa (Jinhai 1,92)', () => {
    const { container } = renderManual();
    const grupo = container.querySelector('#comparacao [role="group"]');
    expect(grupo?.getAttribute('aria-label')).toBe('Critérios da comparação');
    const chips = [...container.querySelectorAll<HTMLButtonElement>('#comparacao .manual-sim__chip')];
    expect(chips.map((c) => [c.textContent, c.getAttribute('aria-pressed')])).toEqual([
      ['Preço', 'true'],
      ['Condição de pagamento', 'true'],
      ['Incoterm', 'false'],
      ['Qualidade', 'false'],
    ]);
    expect(chips.every((c) => c.classList.contains('chip'))).toBe(true);
    expect(chips.map((c) => c.classList.contains('chip--active'))).toEqual([true, true, false, false]);
    expect(nomesDoRanking(container)).toEqual(['Jinhai Industrial', 'Lianyun Fine Chemicals', 'Nordmar Química', 'Qingdao Harbor Chem']);
    expect([...container.querySelectorAll('#comparacao .manual-sim__total')].map((t) => t.textContent)).toEqual(['1,92', '1,63', '1,48', '1,33']);
    expect(container.querySelector('#comparacao .manual-sim__selo')?.textContent).toBe('Vencedora');
    expect(container.querySelectorAll('#comparacao .manual-sim__selo')).toHaveLength(1);
  });

  it('simulador: so Preco ranqueia a Qingdao Harbor Chem em 1o; barra com role="img" e titulo "Score X de N"; eixo acompanha', () => {
    const { container } = renderManual();
    fireEvent.click(chip(container, 'Condição de pagamento'));
    expect(chip(container, 'Condição de pagamento').getAttribute('aria-pressed')).toBe('false');
    expect(nomesDoRanking(container)[0]).toBe('Qingdao Harbor Chem');
    const barra = container.querySelector('#comparacao .manual-sim__linha svg');
    expect(barra?.getAttribute('role')).toBe('img');
    expect(barra?.getAttribute('preserveAspectRatio')).toBe('none');
    const titulo = barra?.querySelector('title');
    expect(titulo?.textContent).toBe('Score 1,00 de 1');
    expect(barra?.getAttribute('aria-labelledby')).toBe(titulo?.id);
    const eixo = [...container.querySelectorAll('#comparacao .manual-sim__eixo > div > span')].map((s) => s.textContent);
    expect(eixo).toEqual(['0', '0,5', '1']);
    expect(container.querySelectorAll('#comparacao .manual-sim__linha svg rect')).toHaveLength(4);
  });

  it('simulador: largura das barras vem de atributos SVG (x/width), nunca de estilo inline', () => {
    const { container } = renderManual();
    const retangulos = [...container.querySelectorAll('#comparacao .manual-sim__linha:first-child svg rect')];
    expect(retangulos.map((r) => [r.getAttribute('x'), r.getAttribute('width')])).toEqual([
      ['0', '460'],
      ['460', '500'],
    ]);
    expect(container.querySelectorAll('#comparacao [style]')).toHaveLength(0);
  });

  it('simulador: 3o criterio bloqueado e o ultimo nao desliga, com a mensagem em aria-live="polite"', () => {
    const { container } = renderManual();
    const msg = container.querySelector('#comparacao .manual-sim__msg');
    expect(msg?.getAttribute('aria-live')).toBe('polite');
    expect(msg?.textContent).toBe('');
    fireEvent.click(chip(container, 'Incoterm'));
    expect(msg?.textContent).toBe('Selecione no máximo 2 critérios.');
    expect(chip(container, 'Incoterm').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip(container, 'Preço'));
    expect(msg?.textContent).toBe('');
    fireEvent.click(chip(container, 'Condição de pagamento'));
    expect(msg?.textContent).toBe('Selecione ao menos 1 critério.');
    expect(chip(container, 'Condição de pagamento').getAttribute('aria-pressed')).toBe('true');
    // trocar um por outro: desliga um e liga o outro
    fireEvent.click(chip(container, 'Qualidade'));
    expect(msg?.textContent).toBe('');
    expect(chip(container, 'Qualidade').getAttribute('aria-pressed')).toBe('true');
    expect(nomesDoRanking(container)[0]).toBe('Jinhai Industrial');
  });

  it('simulador: tabela de dados com estrela + media na Qualidade e "sem avaliacao"', () => {
    const { container } = renderManual();
    const linhas = [...container.querySelectorAll('#comparacao [aria-label="Tabela: propostas do simulador, role na horizontal"] tbody tr')];
    expect(linhas).toHaveLength(4);
    expect(linhas[0]?.textContent).toContain('Lianyun Fine Chemicals');
    expect(linhas[0]?.querySelector('td:last-child svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(linhas[0]?.querySelector('td:last-child')?.textContent).toBe('4,3 ');
    expect(linhas[3]?.querySelector('td:last-child')?.textContent).toBe('sem avaliação');
    expect(linhas[3]?.querySelector('td:nth-child(4)')?.textContent).toBe('CIF (nível 4)');
  });

  it('waterfall: 9 linhas, total R$ 326.181,42, gatilho de R$ 300.000 em texto e trilhos SVG decorativos', () => {
    const { container } = renderManual();
    const linhas = [...container.querySelectorAll('#comparacao .manual-wf__linha')];
    expect(linhas).toHaveLength(9);
    expect(linhas.filter((l) => l.classList.contains('manual-wf__linha--total')).map((l) => l.querySelector('.manual-wf__k')?.textContent)).toEqual(['CIF', 'Total landed']);
    expect(linhas[8]?.querySelector('.manual-wf__v')?.textContent).toBe('R$ 326.181,42');
    expect(linhas[1]?.querySelector('.manual-wf__v')?.textContent).toBe('+ R$ 18.500,00');
    expect(container.querySelectorAll('#comparacao .manual-wf__gatilho')).toHaveLength(1);
    expect(container.querySelector('#comparacao .manual-wf__gatilho')?.textContent).toBe('gatilho R$ 300.000');
    const trilhos = container.querySelectorAll('#comparacao .manual-wf__svg');
    expect(trilhos).toHaveLength(9);
    for (const t of trilhos) expect(t.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('#comparacao .manual-wf__marca-gatilho')).toHaveLength(1);
    expect(container.querySelector('#comparacao .manual-wf__marca-gatilho')?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
  });

  it('Comparacao: texto do codigo atual (quantidade diferente, falta de cambio na alcada e ranking que comeca so com Preco)', () => {
    const { container } = renderManual();
    const t = texto(container, 'comparacao');
    expect(t).toContain('item indisponível, item faltando, quantidade diferente ou alternativa de parceiro desatualizada');
    expect(t).toContain('ou quando falta o câmbio da proposta, só gestor ou admin podem adjudicar');
    expect(t).toContain('Na aba Comparações o ranking começa só com Preço.');
    expect(container.querySelectorAll('#comparacao h3')).toHaveLength(5);
    expect(container.querySelectorAll('#comparacao .manual-aviso--info')).toHaveLength(1);
  });

  it('Ordem de Compra: 5 passos; quem conclui a cotacao e admin ou gestor (o comprador recebe 403)', () => {
    const { container } = renderManual();
    const passos = [...container.querySelectorAll('#ordem-de-compra .manual-passos > li')];
    expect(passos).toHaveLength(5);
    expect(passos[4]?.textContent).toBe('Admin ou gestor clicam em Concluir cotação. A cotação fica Fechada.');
    expect(passos[3]?.textContent).toContain('Avaliar fornecedor');
    expect(passos[2]?.querySelector('a')?.getAttribute('href')).toBe('#administracao');
    expect(container.querySelector('#ordem-de-compra .manual-aviso--dica')).not.toBeNull();
    expect(container.querySelector('#ordem-de-compra .manual-ui--primario')?.textContent).toBe('Enviar Ordem de Compra');
  });

  it('a busca nao marca nada dentro do simulador nem do waterfall, mas marca o resto do capitulo', async () => {
    const { container } = renderManual();
    await buscar('qingdao');
    expect(container.querySelectorAll('#comparacao .manual-sim mark')).toHaveLength(0);
    expect(container.querySelector('#comparacao .manual-figura__legenda mark.manual-marca')).not.toBeNull();
    await buscar('landed');
    expect(container.querySelectorAll('#comparacao .manual-wf mark')).toHaveLength(0);
    expect(container.querySelector('#comparacao p mark.manual-marca')).not.toBeNull();
    expect(container.querySelectorAll('svg mark')).toHaveLength(0);
  });
});

describe('Manual: correcoes da revisao M1-M3 (r2)', () => {
  it('passos: cada passo tem UM span com o texto inteiro (no de texto, strong e pilulas juntos); o conteudo so empilha blocos', () => {
    const { container } = renderManual();
    const conteudos = [...container.querySelectorAll<HTMLElement>('.manual-passos__conteudo')];
    expect(conteudos.length).toBeGreaterThan(20);
    for (const conteudo of conteudos) {
      expect([...conteudo.children].map((f) => f.tagName), conteudo.textContent ?? '').toEqual(['SPAN']);
      const span = conteudo.firstElementChild as HTMLElement;
      // todo <strong> e toda pilula de botao do passo estao dentro do span (nada solto no flex)
      expect(conteudo.querySelectorAll(':scope > strong, :scope > .manual-ui')).toHaveLength(0);
      expect(span.textContent).toBe(conteudo.textContent);
    }
    // exemplo concreto: "Clique em [Entrar]" e uma frase so
    const passoEntrar = [...conteudos].find((c) => c.querySelector('.manual-ui')?.textContent === 'Entrar');
    expect(passoEntrar?.querySelector(':scope > span > .manual-ui')).not.toBeNull();
  });

  it('/manual#comparacao ao abrir: salto direto (behavior instant), sem a rolagem suave do CSS; o clique no indice segue suave', () => {
    renderManual('admin', '/manual#comparacao');
    const chamadas = scrollIntoView.mock.calls as unknown[][];
    const abertura = chamadas.find((_, i) => scrollIntoView.mock.contexts[i] instanceof HTMLElement && (scrollIntoView.mock.contexts[i] as HTMLElement).id === 'comparacao');
    expect(abertura?.[0]).toEqual({ block: 'start', behavior: 'instant' });
    scrollIntoView.mockClear();
    fireEvent.click(screen.getByRole('link', { name: /Enviar aos fornecedores/ }));
    expect((scrollIntoView.mock.calls as unknown[][]).at(-1)?.[0]).toEqual({ block: 'start' });
  });

  it('scrollspy no fim da pagina: o ultimo capitulo visivel vira o ativo (Administracao, Perguntas e Glossario nunca cruzam a faixa do topo)', () => {
    renderManual();
    const indice = screen.getByRole('navigation', { name: 'Capítulos do manual' });
    const ativos = () => [...indice.querySelectorAll('a[aria-current="location"]')].map((a) => a.getAttribute('href'));
    expect(ativos()).toEqual(['#comece-aqui']);
    const total = vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(5000);
    const alto = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 4000 });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(ativos()).toEqual(['#comece-aqui']);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 4200 });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(ativos()).toEqual(['#glossario']);
    total.mockRestore();
    alto.mockRestore();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });

  it('regua de avisos: figura que rola na horizontal (regiao focavel) para os rotulos nao se sobreporem no estreito', () => {
    const { container } = renderManual();
    const regiao = container.querySelector('#fornecedores .manual-rolagem');
    expect(regiao?.getAttribute('aria-label')).toBe('Figura: régua dos avisos de vencimento, role na horizontal');
    expect(regiao?.querySelector('.manual-regua')).not.toBeNull();
  });

  it('selo "Exemplo fictício" vem ANTES do texto na ordem de leitura, com um espaco entre os dois (o textContent le "Exemplo fictício Proposta...")', () => {
    const { container } = renderManual();
    const legenda = container.querySelector('#portal .manual-figura__legenda');
    expect(legenda?.firstElementChild?.className).toBe('manual-exemplo');
    expect(legenda?.firstElementChild?.nextSibling?.nodeValue).toBe(' ');
  });

  it('fim de semana da semana de lembretes: o travessao e aria-hidden e o leitor ouve "sem envio"', () => {
    const { container } = renderManual();
    const folgas = [...container.querySelectorAll('#envio .manual-dia--folga')];
    expect(folgas).toHaveLength(2);
    for (const dia of folgas) {
      expect(dia.querySelector('.manual-dia__hora')?.getAttribute('aria-hidden')).toBe('true');
      expect(dia.querySelector('.sr-only')?.textContent).toBe('sem envio');
    }
  });
});

describe('Manual: bloco "Para o COMEX" so para a equipe interna', () => {
  it.each(['admin', 'comprador', 'gestor', 'viewer'])('%s ve o bloco "Para o COMEX" com os 4 cartoes (Criar cotacao, Vincular, Marcar atendida, Recusar)', (role) => {
    const { container } = renderManual(role);
    expect(container.querySelector('#solicitacoes')?.textContent).toContain('Para o COMEX: atender o pedido');
    expect([...container.querySelectorAll('#solicitacoes .manual-mini__titulo')].map((t) => t.textContent)).toEqual(['Criar cotação', 'Vincular a cotação', 'Marcar atendida', 'Recusar']);
  });

  it('Comercial nao tem o bloco no DOM, mas ve o resto do capitulo (fluxo de status, passos de pedir cotacao e item fora do catalogo)', () => {
    const { container } = renderManual('comercial');
    const t = container.querySelector('#solicitacoes')?.textContent ?? '';
    expect(t).not.toContain('Para o COMEX');
    expect(t).not.toContain('Vincular a cotação');
    expect(t).not.toContain('Solicitação do comercial #N');
    expect(container.querySelectorAll('#solicitacoes .manual-mini')).toHaveLength(0);
    expect(container.querySelectorAll('#solicitacoes .manual-passos > li')).toHaveLength(5);
    expect(container.querySelectorAll('#solicitacoes .manual-fluxo')).toHaveLength(2);
    expect(t).toContain('Para o Comercial: pedir uma cotação');
    expect(t).toContain('Item que não está no catálogo');
  });

  it('a busca do Comercial nao acha o bloco (nem pelo texto dos cartoes) e o hash nao o revela', async () => {
    const { container } = renderManual('comercial');
    await buscar('vincular a cotação');
    expect(visiveis(container)).toHaveLength(0);
    expect(screen.getByText('Nada encontrado')).toBeTruthy();
    await buscar('preço-alvo só acompanha');
    expect(visiveis(container)).toHaveLength(0);
    cleanup();
    scrollIntoView.mockClear();
    const outro = renderManual('comercial', '/manual#vincular');
    expect(outro.container.querySelector('#vincular')).toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('Manual: capitulos 14 a 17 e rodape (M5)', () => {
  const texto = (container: HTMLElement, id: string) => container.querySelector(`#${id}`)?.textContent ?? '';
  const detalhes = (container: HTMLElement) => [...container.querySelectorAll<HTMLDetailsElement>('#perguntas details')];
  const abertos = (container: HTMLElement) => detalhes(container).filter((d) => d.open);

  it('Relatorios: 6 cartoes de indicadores e o rotulo Atualizar como pilula da interface', () => {
    const { container } = renderManual();
    expect([...container.querySelectorAll('#relatorios .manual-mini__titulo')].map((t) => t.textContent)).toEqual([
      'Resumo',
      'Economia estimada',
      'Lead-time médio',
      'Top fornecedores',
      'Taxa de adjudicação',
      'Engajamento de fornecedores',
    ]);
    expect(container.querySelector('#relatorios .manual-capitulo__lead .manual-ui')?.textContent).toBe('Atualizar');
    expect(container.querySelectorAll('#relatorios .manual-grade--3')).toHaveLength(1);
  });

  it('Administracao: 5 secoes, avisos de nova solicitacao com a copia automatica, 6 variaveis de template e rotulos reais', () => {
    const { container } = renderManual();
    expect([...container.querySelectorAll('#administracao h3')].map((h) => h.textContent)).toEqual(['Empresa', 'Usuários', 'Templates de e-mail', 'Auditoria', 'Minha conta']);
    expect(texto(container, 'administracao')).toContain('Vazio, vai para a equipe COMEX e para a cópia automática.');
    expect([...container.querySelectorAll('#administracao .manual-variaveis code')].map((c) => c.textContent)).toEqual([
      '{{requestCode}}',
      '{{productName}}',
      '{{supplierContactName}}',
      '{{portalLink}}',
      '{{expiresAt}}',
      '{{companyName}}',
    ]);
    expect([...container.querySelectorAll('#administracao .manual-ui')].map((r) => r.textContent)).toEqual(['Restaurar padrão', 'Ver diff']);
    expect(container.querySelectorAll('#administracao ul > li')).toHaveLength(5);
  });

  it('FAQ: 11 perguntas em <details> fechados, com resumo, icone plus/minus aria-hidden e resposta', () => {
    const { container } = renderManual();
    expect(detalhes(container)).toHaveLength(11);
    expect(PERGUNTAS_FREQUENTES).toHaveLength(11);
    expect(abertos(container)).toHaveLength(0);
    for (const d of detalhes(container)) {
      expect(d.querySelector('summary')?.textContent).not.toBe('');
      expect(d.querySelector('summary .manual-faq__icone')?.getAttribute('aria-hidden')).toBe('true');
      expect(d.querySelectorAll('summary svg')).toHaveLength(2);
      expect(d.querySelector('.manual-faq__resposta')?.textContent).not.toBe('');
    }
    expect(detalhes(container)[0]?.querySelector('summary')?.textContent).toBe('O fornecedor precisa de login para responder?');
  });

  it('FAQ: clicar no resumo abre e fecha a pergunta (estado do React, nao do navegador)', () => {
    const { container } = renderManual();
    const resumo = detalhes(container)[2]!.querySelector('summary')!;
    fireEvent.click(resumo);
    expect(detalhes(container)[2]!.open).toBe(true);
    fireEvent.click(resumo);
    expect(detalhes(container)[2]!.open).toBe(false);
  });

  it('FAQ: o termo da busca abre as perguntas que o contem e, ao limpar, tudo volta ao estado de antes (a aberta pelo leitor continua aberta)', async () => {
    const { container } = renderManual();
    fireEvent.click(detalhes(container)[8]!.querySelector('summary')!);
    expect(abertos(container)).toHaveLength(1);
    await buscar('senha');
    const esperadas = PERGUNTAS_FREQUENTES.filter((p) => normalizarBusca(`${p.pergunta} ${p.resposta}`).includes('senha')).map((p) => p.pergunta);
    expect(esperadas.length).toBeGreaterThanOrEqual(2);
    const abertas = abertos(container).map((d) => d.querySelector('summary')?.textContent);
    expect(abertas).toEqual(expect.arrayContaining([...esperadas, 'Dá para comparar propostas em moedas diferentes?']));
    expect(abertas).toHaveLength(esperadas.length + 1);
    expect(container.querySelector('#perguntas summary mark.manual-marca, #perguntas .manual-faq__resposta mark.manual-marca')).not.toBeNull();
    await buscar('');
    expect(abertos(container).map((d) => d.querySelector('summary')?.textContent)).toEqual(['Dá para comparar propostas em moedas diferentes?']);
  });

  it('FAQ: durante a busca o leitor ainda fecha a pergunta aberta pelo termo; trocar o termo devolve o controle ao termo', async () => {
    const { container } = renderManual();
    await buscar('esqueci a senha');
    expect(abertos(container)).toHaveLength(1);
    fireEvent.click(abertos(container)[0]!.querySelector('summary')!);
    expect(abertos(container)).toHaveLength(0);
    await buscar('esqueci a senha.');
    expect(abertos(container)).toHaveLength(1);
  });

  it('FAQ: termo que so existe em outro capitulo nao abre nenhuma pergunta', async () => {
    const { container } = renderManual();
    await buscar('importar planilha');
    expect(abertos(container)).toHaveLength(0);
    expect(container.querySelector('#perguntas')?.hasAttribute('hidden')).toBe(true);
  });

  it('comecar e terminar a busca nao remonta o capitulo: o criterio escolhido no simulador continua ligado', async () => {
    const { container } = renderManual();
    fireEvent.click(within(container.querySelector<HTMLElement>('#comparacao .manual-sim__chips')!).getByRole('button', { name: 'Condição de pagamento' }));
    const pressionados = () => [...container.querySelectorAll('#comparacao .manual-sim__chip')].map((c) => c.getAttribute('aria-pressed'));
    expect(pressionados()).toEqual(['true', 'false', 'false', 'false']);
    await buscar('landed');
    expect(pressionados()).toEqual(['true', 'false', 'false', 'false']);
    await buscar('');
    expect(pressionados()).toEqual(['true', 'false', 'false', 'false']);
  });

  it('Glossario: 13 termos em <dl> (dt/dd) e o lead time como media dos itens, arredondada', () => {
    const { container } = renderManual();
    expect(container.querySelectorAll('#glossario dl.manual-glossario > dt')).toHaveLength(13);
    expect(container.querySelectorAll('#glossario dl.manual-glossario > dd')).toHaveLength(13);
    expect([...container.querySelectorAll('#glossario dt')].map((d) => d.textContent)).toEqual(GLOSSARIO.map((t) => t.termo));
    expect(texto(container, 'glossario')).toContain('Na comparação vale a média dos itens, arredondada.');
    expect(texto(container, 'glossario')).not.toContain('o maior entre os itens');
  });

  it('a busca marca termo e definicao do glossario', async () => {
    const { container } = renderManual();
    await buscar('cif');
    expect(container.querySelector('#glossario dt mark.manual-marca')?.textContent?.toLowerCase()).toBe('cif');
    expect(container.querySelector('#glossario dd mark.manual-marca')).not.toBeNull();
  });

  it('rodape: "Manual do IntelliQuote · atualizado em 02/11/2026", data fixa (nao vem do relogio) e fora dos capitulos', () => {
    const { container } = renderManual();
    const rodape = container.querySelector('.manual-artigo > .manual-rodape');
    expect(rodape?.textContent).toBe('Manual do IntelliQuote · atualizado em 02/11/2026');
    expect(MANUAL_ATUALIZADO_EM).toBe('2026-11-02');
    expect(dataBr('2026-01-05')).toBe('05/01/2026');
    expect(rodape?.closest('section')).toBeNull();
  });

  it('rodape tambem para o Comercial', () => {
    const { container } = renderManual('comercial');
    expect(container.querySelector('.manual-rodape')?.textContent).toBe(RODAPE_DO_MANUAL);
  });
});

describe('Manual: impressao (M6)', () => {
  const detalhes = (container: HTMLElement) => [...container.querySelectorAll<HTMLDetailsElement>('#perguntas details')];

  it('beforeprint abre as 11 perguntas do FAQ e afterprint devolve cada uma ao estado de antes (a aberta pelo leitor continua aberta)', () => {
    const { container } = renderManual();
    fireEvent.click(detalhes(container)[3]!.querySelector('summary')!);
    expect(detalhes(container).filter((d) => d.open)).toHaveLength(1);
    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    expect(detalhes(container)).toHaveLength(11);
    expect(detalhes(container).every((d) => d.open)).toBe(true);
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(detalhes(container).filter((d) => d.open).map((d) => d.querySelector('summary')?.textContent)).toEqual(['O mais barato não ficou em primeiro. Está errado?']);
    // o estado do React segue valendo: um clique depois da impressao fecha e abre normalmente
    fireEvent.click(detalhes(container)[3]!.querySelector('summary')!);
    expect(detalhes(container).filter((d) => d.open)).toHaveLength(0);
    fireEvent.click(detalhes(container)[5]!.querySelector('summary')!);
    expect(detalhes(container)[5]!.open).toBe(true);
  });

  it('os listeners saem no desmonte: beforeprint depois de fechar a pagina nao mexe em nada', () => {
    const adicionar = vi.spyOn(window, 'addEventListener');
    const remover = vi.spyOn(window, 'removeEventListener');
    const { container, unmount } = renderManual();
    const registrados = adicionar.mock.calls.filter(([tipo]) => tipo === 'beforeprint' || tipo === 'afterprint').map(([tipo]) => tipo);
    expect(registrados).toEqual(['beforeprint', 'afterprint']);
    const detalhesAntes = detalhes(container);
    unmount();
    expect(remover.mock.calls.filter(([tipo]) => tipo === 'beforeprint' || tipo === 'afterprint').map(([tipo]) => tipo)).toEqual(['beforeprint', 'afterprint']);
    window.dispatchEvent(new Event('beforeprint'));
    expect(detalhesAntes.every((d) => !d.open)).toBe(true);
    adicionar.mockRestore();
    remover.mockRestore();
  });

  it('Comercial: nao ha FAQ, e beforeprint nao quebra', () => {
    const { container } = renderManual('comercial');
    expect(container.querySelectorAll('details')).toHaveLength(0);
    expect(() => window.dispatchEvent(new Event('beforeprint'))).not.toThrow();
  });
});

describe('Manual: correcoes da revisao M (r3)', () => {
  const texto = (container: HTMLElement, id: string) => container.querySelector(`#${id}`)?.textContent ?? '';

  it('hierarquia de titulos sem salto em nenhum capitulo (h2 > h3 > h4): Respostas e Relatorios abrem a grade com h3', () => {
    const { container } = renderManual();
    for (const secao of secoes(container)) {
      let anterior = 2;
      for (const h of secao.querySelectorAll('h2, h3, h4')) {
        const nivel = Number(h.tagName.slice(1));
        expect(nivel - anterior, `${secao.id}: ${h.tagName} "${h.textContent}" depois de h${anterior}`).toBeLessThanOrEqual(1);
        anterior = nivel;
      }
    }
    expect([...container.querySelectorAll('#respostas h3')].map((h) => h.textContent)).toEqual(['Responder', 'Histórico', 'Credit Support', 'Nova resposta']);
    expect(container.querySelectorAll('#relatorios h3')).toHaveLength(6);
    expect(container.querySelectorAll('#respostas h3.manual-mini__titulo')).toHaveLength(4);
    // a grade do Para o COMEX (sob um h3 da secao) segue com h4
    expect(container.querySelectorAll('#solicitacoes h4.manual-mini__titulo')).toHaveLength(4);
  });

  it('textos fieis ao codigo (D-M-05): Historico, Credit Support, "mesmo assim" e Engajamento de fornecedores', () => {
    const { container } = renderManual();
    expect(texto(container, 'respostas')).toContain('Uma linha por versão da proposta em que o preço mudou (pelo portal ou por edição manual)');
    expect(texto(container, 'respostas')).not.toContain('Todas as versões da proposta');
    expect(texto(container, 'glossario')).toContain('que cota preço e prazo próprios sobre a proposta do fornecedor');
    expect(texto(container, 'glossario')).not.toContain('revende');
    expect(texto(container, 'comparacao')).toContain('Se faltam itens ou a quantidade é diferente (e nenhum item está indisponível), você ainda pode usar');
    expect(texto(container, 'comparacao')).not.toContain('Se só faltam itens');
    expect([...container.querySelectorAll('#relatorios .manual-mini__titulo')].map((t) => t.textContent)).toContain('Engajamento de fornecedores');
  });

  describe('hash na abertura (idempotente e cancelavel)', () => {
    let resolverFontes: () => void = () => {};
    let fontesAntes: PropertyDescriptor | undefined;

    beforeEach(() => {
      fontesAntes = Object.getOwnPropertyDescriptor(document, 'fonts');
      const ready = new Promise<void>((resolve) => {
        resolverFontes = resolve;
      });
      Object.defineProperty(document, 'fonts', { configurable: true, value: { ready } });
    });

    afterEach(() => {
      if (fontesAntes) Object.defineProperty(document, 'fonts', fontesAntes);
      else delete (document as unknown as Record<string, unknown>).fonts;
    });

    const chamadasDo = (id: string) =>
      (scrollIntoView.mock.calls as unknown[][]).filter((_, i) => (scrollIntoView.mock.contexts[i] as HTMLElement | undefined)?.id === id).map((c) => c[0]);
    const liberarFontes = async () => {
      await act(async () => {
        resolverFontes();
        await Promise.resolve();
      });
    };

    it('abre direto (instant) e realinha UMA vez quando as fontes carregam; sob StrictMode (2 execucoes do efeito) o resultado e o mesmo', async () => {
      mockRole = 'admin';
      render(
        <StrictMode>
          <MemoryRouter initialEntries={['/manual#comparacao']}>
            <Manual />
          </MemoryRouter>
        </StrictMode>,
      );
      // nenhuma chamada suave: toda rolagem da abertura e instantanea
      expect(chamadasDo('comparacao').length).toBeGreaterThanOrEqual(1);
      for (const arg of chamadasDo('comparacao')) expect(arg).toEqual({ block: 'start', behavior: 'instant' });
      const antes = chamadasDo('comparacao').length;
      await liberarFontes();
      // o realinhamento da execucao que ficou valendo (a primeira foi cancelada pelo cleanup do StrictMode)
      expect(chamadasDo('comparacao').length).toBe(antes + 1);
      for (const arg of chamadasDo('comparacao')) expect(arg).toEqual({ block: 'start', behavior: 'instant' });
    });

    it.each(['wheel', 'touchstart', 'keydown', 'pointerdown'])('se o leitor agir antes das fontes (%s), NAO ha realinhamento: ninguem e puxado de volta', async (tipo) => {
      renderManual('admin', '/manual#itens');
      const antes = scrollIntoView.mock.calls.length;
      act(() => {
        window.dispatchEvent(new Event(tipo));
      });
      await liberarFontes();
      expect(scrollIntoView.mock.calls.length).toBe(antes);
    });

    it('clicar no indice antes das fontes tambem cancela; o clique segue suave e nao ha puxada depois', async () => {
      const { container } = renderManual('admin', '/manual#itens');
      fireEvent.pointerDown(screen.getByRole('link', { name: /Enviar aos fornecedores/ }));
      fireEvent.click(screen.getByRole('link', { name: /Enviar aos fornecedores/ }));
      const noEnvio = chamadasDo('envio');
      expect(noEnvio).toEqual([{ block: 'start' }]);
      await liberarFontes();
      expect(chamadasDo('itens')).toHaveLength(1);
      expect(scrollIntoView.mock.contexts.at(-1)).toBe(container.querySelector('#envio'));
    });
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
