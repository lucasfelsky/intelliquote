import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ForecastItemDemandaComercial } from '@/services/forecast';
import { readSource } from '../../test/rfCss';
import ForecastRelatorioCompras from './ForecastRelatorioCompras';
import ForecastRelatorioDemandaComercial from './ForecastRelatorioDemandaComercial';

// F13-D: relatorio de compras no mock v68. Markup minimo que o board pede (icones nos botoes de exportar e de lancar demanda, coluna "Saldo zera" em mono, "Cancelar" do
// pedido em vermelho, lupa na busca do modal fica no outro arquivo) e o CSS do par `F13-D` (so de tela: o papel do relatorio fica como esta).

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown, message?: string) {
      super(message ?? `HTTP ${status}`);
      this.status = status;
      this.body = body;
    }
  },
}));

import { api } from '@/api/client';
import { expandirSecoes } from '@/test/forecastSecoes';

const get = vi.mocked(api.get);

// Dados 100% sinteticos.
function item(over: Record<string, unknown> = {}) {
  return {
    linha: 3,
    n: 1,
    item: 'PRODUTO 001',
    codigos: ['C0001'],
    status: 'nao',
    demanda: -40,
    quantidadeSugerida: 40,
    embalagem: { usada: null, cadastradas: [], multiplas: false },
    quantidadeEmbalagens: null,
    quantidadeFinal: 40,
    naoFraciona: false,
    ruptura: { indiceMes: 1, anoMes: '2026-11', data: '2026-11-21', jaNaDataBase: false },
    dataLimite: '2026-10-22',
    vencida: false,
    leadTimeDias: 30,
    emAndamento: { chegadas: [], programacoes: [] },
    ...over,
  };
}

const relatorio = (over: Record<string, unknown> = {}) => ({
  quinzena: { id: 7, label: '10-2', baseDate: '2026-10-15', half: 2, origin: 'planilha', hoje: '2026-10-20' },
  totais: { itens: 1, fontes: 1, vencidas: 0, semEmbalagem: 1, multiplasEmbalagens: 0 },
  fora: { semLeadTime: 0, semConsumoSemFalta: 0 },
  grupos: [{ fonte: 'FONTE 001', leadTimeDias: 30, dataLimiteMaisUrgente: null, vencidas: 0, itens: [item()] }],
  demandaComercial: { itens: [], totais: { abertas: 0, sugeridoKg: 0 } },
  ...over,
});

function renderRelatorio(podeEditar: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ForecastRelatorioCompras snapshotId={7} podeEditar={podeEditar} />
    </QueryClientProvider>,
  );
}

const pedido = (over: Partial<ForecastItemDemandaComercial> = {}): ForecastItemDemandaComercial => ({
  id: 1,
  linha: 3,
  productId: 7,
  item: 'PRODUTO 001',
  fonte: 'FONTE 001',
  kg: 1600,
  necessidade: '2027-02-10',
  anoMes: '2027-02',
  motivo: 'MOTIVO SINTETICO',
  cliente: 'CLIENTE SINTETICO',
  solicitacaoId: null,
  situacao: 'alem-do-horizonte',
  programacaoDoMes: null,
  saldoLivre: 500,
  sugerido: 1100,
  noRelatorio: false,
  obs: '',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('F13-D: relatorio de compras (markup)', () => {
  it('Baixar XLSX, MACRO, Imprimir e Lancar demanda ganham icone (escondido do leitor de tela) e os nomes nao mudam', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio(true);
    const grupo = await screen.findByRole('group', { name: 'Exportar relatório' });
    for (const nome of ['Baixar XLSX', 'Baixar planilha MACRO (XLSX)', 'Imprimir / Salvar como PDF', 'Lançar demanda do comercial']) {
      const botao = within(grupo).getByRole('button', { name: nome });
      const svg = botao.querySelector('svg');
      expect(svg, nome).not.toBeNull();
      expect(svg?.getAttribute('aria-hidden'), nome).toBe('true');
    }
  });

  it('sem permissao de edicao nao ha botao de lancar demanda (e portanto nenhum icone dele)', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio(false);
    const grupo = await screen.findByRole('group', { name: 'Exportar relatório' });
    expect(within(grupo).queryByRole('button', { name: 'Lançar demanda do comercial' })).toBeNull();
    expect(grupo.querySelectorAll('svg')).toHaveLength(3);
  });

  it('resumo: a frase vira indicador (numero e rotulo aria-hidden, frase inteira para o leitor) e "Fora da lista de compra" abre e fecha', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio(false);
    const frase = await screen.findByText(/^[0-9]+ com data-limite vencida$/);
    const li = frase.closest('li');
    expect(li?.className).toContain('fcr-ind');
    expect(li?.querySelector('.fcr-ind__n')?.getAttribute('aria-hidden')).toBe('true');
    expect(li?.querySelector('.fcr-ind__k')?.textContent).toBe('com data-limite vencida');
    const botao = screen.getByRole('button', { name: 'Fora da lista de compra' });
    const bloco = document.getElementById('fcr-fora');
    expect(botao.getAttribute('aria-expanded')).toBe('false');
    expect(bloco?.hasAttribute('hidden')).toBe(true);
    fireEvent.click(botao);
    expect(botao.getAttribute('aria-expanded')).toBe('true');
    expect(bloco?.hasAttribute('hidden')).toBe(false);
  });

  it('cada faixa/fonte tem uma seta que recolhe e expande a tabela (aberta por padrao; aria-expanded)', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio(false);
    const seta = (await screen.findAllByRole('button', { name: /^Recolher / }))[0] as HTMLElement;
    expect(seta.getAttribute('aria-expanded')).toBe('true');
    const tabela = seta.closest('table') as HTMLElement;
    expect(tabela.querySelector('tbody')?.hasAttribute('hidden')).toBe(false);
    fireEvent.click(seta);
    expect(seta.getAttribute('aria-expanded')).toBe('false');
    expect(seta.getAttribute('aria-label')).toMatch(/^Expandir /);
    expect(tabela.querySelector('tbody')?.hasAttribute('hidden')).toBe(true);
    expect(tabela.querySelector('thead')?.hasAttribute('hidden')).toBe(true);
    fireEvent.click(seta);
    expect(tabela.querySelector('tbody')?.hasAttribute('hidden')).toBe(false);
  });

  it('Saldo zera e Ruptura ficam no card "Saldo e ruptura" do expansor: o mes leva a classe mono e a data da ruptura segue no texto', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio(false);
    const zera = await screen.findByText('nov/2026');
    expect(zera.className).toBe('fcr-mono');
    const card = zera.closest('.fcr-dc');
    expect(card).not.toBeNull();
    expect(card?.closest('.fcr-detalhes')).not.toBeNull();
    expect(screen.getByText('21/11/2026').closest('.fcr-dc')).toBe(card);
    expect(screen.queryByRole('columnheader', { name: 'Saldo zera' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Ruptura' })).toBeNull();
  });
});

describe('F13-D: Demanda do comercial (markup dos botoes de fechamento)', () => {
  const renderSecao = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const r = render(
      <QueryClientProvider client={client}>
        <ForecastRelatorioDemandaComercial
          dados={{ itens: [pedido()], totais: { abertas: 1, sugeridoKg: 1100 } }}
          podeEditar
          hoje="2026-10-20"
          onConcluido={() => undefined}
        />
      </QueryClientProvider>,
    );
    expandirSecoes();
    return r;
  };

  it('"Cancelar demanda" e o unico botao de acao em vermelho (ghost-button danger-button); os outros 3 seguem fantasma comum', () => {
    renderSecao();
    const acoes = screen.getByRole('group', { name: /Ações do pedido de PRODUTO 001/ });
    const botoes = within(acoes).getAllByRole('button');
    expect(botoes).toHaveLength(4);
    const vermelhos = botoes.filter((b) => b.classList.contains('danger-button'));
    expect(vermelhos).toHaveLength(1);
    expect(vermelhos[0]?.textContent).toMatch(/Cancelar/);
    for (const b of botoes) expect(b.classList.contains('ghost-button')).toBe(true);
  });

  it('abrir o fechamento continua abrindo o dialogo em portal com a raiz fc-portal (o clique nao mudou)', async () => {
    renderSecao();
    fireEvent.click(screen.getByRole('button', { name: /^Marcar comprada: pedido de PRODUTO 001/ }));
    await waitFor(() => expect(document.body.querySelector('dialog.fc-portal')).not.toBeNull());
    expect(document.body.querySelector('dialog.fc-portal')?.className).toContain('modal-dialog');
  });
});

describe('F13-D: CSS do par `F13-D` (so tela, papel intacto)', () => {
  const lf = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
  const par = lf.slice(lf.indexOf('/* -- F13-D >>> -- */'), lf.indexOf('/* -- <<< F13-D -- */'));
  const regra = (seletor: string) => {
    const i = par.indexOf(`${seletor} {`);
    expect(i, seletor).toBeGreaterThanOrEqual(0);
    return par.slice(i, par.indexOf('}', i));
  };

  it('o par existe, tem regras e nao tem nada fora de `@media screen` nem `@media print`', () => {
    expect(par.length).toBeGreaterThan(500);
    expect(par).not.toMatch(/@media\s+print/);
    // toda regra esta dentro de um @media screen: tirando os blocos @media screen sobra so comentario e espaco
    let resto = par;
    for (let guarda = 0; guarda < 20; guarda++) {
      const i = resto.indexOf('@media screen');
      if (i < 0) break;
      let fundo = 0;
      let fim = resto.indexOf('{', i);
      for (let k = fim; k < resto.length; k++) {
        if (resto[k] === '{') fundo++;
        else if (resto[k] === '}' && --fundo === 0) {
          fim = k;
          break;
        }
      }
      resto = resto.slice(0, i) + resto.slice(fim + 1);
    }
    expect(resto.replace(/\/\*[\s\S]*?\*\//g, '').trim()).toBe('');
  });

  it('cartao do resumo e das faixas: raio de cartao grande, sem sombra; cabecalho de coluna 10x12 sem espacamento de letras', () => {
    expect(regra('.fc-pagina .fcr-resumo')).toMatch(/border-radius: var\(--rf-radius-card-lg\)[\s\S]*box-shadow: none/);
    expect(regra('.fc-pagina .fcr-grupo')).toMatch(/border-radius: var\(--rf-radius-card-lg\)[\s\S]*box-shadow: none/);
    expect(regra('.fc-pagina .fcr-tabela thead th')).toMatch(/padding: 10px 12px[\s\S]*letter-spacing: normal/);
  });

  it('botao fantasma de tabela: 32 de altura, sem contorno (vence a compat Forecast F3 pela especificidade), 12/700', () => {
    const fantasma = regra('.fc-pagina .fcr-tabela .ghost-button');
    expect(fantasma).toMatch(/min-height: 32px/);
    expect(fantasma).toMatch(/border: 0;/);
    expect(fantasma).toMatch(/font-size: 12px; font-weight: 700/);
  });

  it('linha critica, sem estoque e vencida sem tom e sem faixa (o board nao pinta a linha inteira), nos 2 temas', () => {
    expect(par).toMatch(/\.fc-pagina \.fcr-linha--vencida th, \.fc-pagina \.fcr-linha--vencida td[\s\S]*?\{ background: var\(--rf-surface\); \}/);
    expect(par).toMatch(/:root\[data-theme="dark"\] \.fc-pagina \.fcr-linha--vencida th, :root\[data-theme="dark"\] \.fc-pagina \.fcr-linha--critico th \{ background: var\(--rf-surface\); \}/);
    expect(par).toMatch(/\.fc-pagina \.fcr-linha--vencida th, \.fc-pagina \.fcr-linha--sem-estoque th \{ border-left: 0; \}/);
  });

  it('modais de operacao: 700 so onde nao ha tabela de 7 colunas (Demanda e Meses; o fechamento, que e padrao, segue 560) e faixa do rodape nas Embalagens', () => {
    expect(par).toMatch(/\.fc-portal\.modal-dialog--wide:has\(\.fcd-form\), \.fc-pagina \.modal-dialog:has\(\.fca-tabela\) \{ max-width: 700px; \}/);
    // Embalagens (7 colunas) fica no tamanho largo da base (880): em 700 a tabela pedia 778 px para um corpo de 652 e rolava na horizontal
    expect(par).not.toMatch(/\.fc-portal\.modal-dialog--wide(?!:has)[^{]*\{[^}]*max-width: 700px/);
    expect(regra('.fc-portal .fce-tabela tbody th, .fc-portal .fce-tabela tbody td, .fc-pagina .fce-tabela tbody th, .fc-pagina .fce-tabela tbody td')).toMatch(/padding: 12px 8px/);
    expect(regra('.fc-portal .fce-origem, .fc-pagina .fce-origem')).toMatch(/white-space: normal/);
    expect(regra('.fc-portal .fce-modal .modal-actions:last-child')).toMatch(/margin: 6px -24px -20px; padding: 16px 24px; border-top: 1px solid var\(--rf-divider\); background: var\(--rf-surface-alt\)/);
  });

  it('guardas das regras so do harness: fechamento (p.fcd-produto volta a paragrafo), cabecalho recortado por clip-path e rotulos de coluna empilhados', () => {
    expect(regra('.fc-portal .fcd-form > p.fcd-produto')).toMatch(/display: block/);
    expect(par).toMatch(/clip-path: inset\(50%\)/);
    expect(par).toMatch(/content: attr\(data-rotulo\)/);
    expect(par).not.toMatch(/grid-row: 4/);
  });

  it('a tabela larga ganha folga de rolagem (scroll-padding) para o foco por teclado revelar o botao que ficou quase todo escondido', () => {
    expect(regra('.fc-pagina .fcr-scroll')).toMatch(/scroll-padding-inline: 16px/);
  });

  it('so var(--rf-*) no par (nenhuma cor literal nem token legado)', () => {
    for (const [, nome] of par.matchAll(/var\(\s*(--[\w-]+)/g)) expect((nome ?? '').startsWith('--rf-'), nome).toBe(true);
    expect(par).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|!important/);
  });
});
