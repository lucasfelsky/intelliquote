import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComparisonResult, ExcludedComparisonResponse, QuoteResponse } from '@/services/quoteResponses';
import { ComparacaoPorItem } from './ComparacaoPorItem';
import type { ItemDaCotacao } from './comparacaoPorItemHelpers';

vi.mock('@/services/quoteResponses', () => ({
  listQuoteResponses: vi.fn(),
  messageOf: (e: unknown) => String(e),
}));

import { listQuoteResponses } from '@/services/quoteResponses';

// Dados ficticios. 3 itens; A (vencedora) e B ranqueadas diretas; uma alternativa via parceiro (Credit Support) ocupa a posicao 2;
// C fica fora do ranking (item faltando + item indisponivel).
const itens: ItemDaCotacao[] = [
  { id: 1, itemCode: 'AC-01', productName: 'Ácido cítrico', description: 'Pó, saco 25 kg', quantity: 20000, unit: 'KG', targetPrice: 0.78 },
  { id: 2, itemCode: null, productName: 'Sulfato de zinco', description: null, quantity: 15000, unit: 'KG', targetPrice: null },
  { id: 3, itemCode: null, productName: 'Tripolifosfato', description: null, quantity: 25000, unit: 'KG', targetPrice: 0.98 },
];

type Preco = number | null | 'NA' | { p: number; q: number };

function resposta(id: number, precos: Preco[], extra: Partial<QuoteResponse> = {}): QuoteResponse {
  return {
    id,
    quoteRequestId: 99,
    supplierId: 100 + id,
    offeredPrice: 0,
    currency: 'USD',
    exchangeRate: null,
    freightCost: 0,
    insuranceCost: 0,
    otherFees: 0,
    importDuty: 0,
    ipi: 0,
    pis: 0,
    cofins: 0,
    offeredIncoterm: 'FOB',
    paymentTermsDays: 30,
    leadTimeDays: null,
    notes: null,
    isWinner: false,
    totalLandedCost: 0,
    submittedAt: '',
    version: 1,
    createdAt: '',
    updatedAt: '',
    items: precos.flatMap((v, i) => {
      if (v === null) return [];
      const item = itens[i]!;
      const p = typeof v === 'object' ? v.p : v === 'NA' ? 0 : v;
      const q = typeof v === 'object' ? v.q : v === 'NA' ? 0 : item.quantity;
      return [
        {
          id: id * 10 + i,
          quoteResponseId: id,
          quoteRequestItemId: item.id,
          unitPrice: p,
          quantity: q,
          totalPrice: p * q,
          leadTimeDays: null,
          notes: null,
          isUnavailable: v === 'NA',
        },
      ];
    }),
    ...extra,
  };
}

function resultado(id: number, nome: string, total: number, extra: Partial<ComparisonResult> = {}): ComparisonResult {
  return {
    quoteResponseId: id,
    supplierId: 100 + id,
    supplier: { id: 100 + id, name: nome },
    currency: 'USD',
    offeredPrice: total,
    offeredIncoterm: 'FOB',
    paymentTermsDays: 30,
    exchangeRate: null,
    freightCost: 0,
    insuranceCost: 0,
    otherFees: 0,
    importDutyRate: 0,
    ipiRate: 0,
    pisRate: 0,
    cofinsRate: 0,
    cifValue: 0,
    importDutyAmount: 0,
    ipiAmount: 0,
    pisCofinsAmount: 0,
    totalLandedCost: 0,
    priceScore: 0,
    paymentTermsScore: 0,
    incotermScore: 0,
    qualityScore: 0,
    totalScore: 0,
    isWinner: false,
    leadTimeDays: 40,
    ...extra,
  };
}

const A = resultado(1, 'Alfa Química', 53300, { isWinner: true, leadTimeDays: 45 });
const Bparceiro = resultado(2, 'Beta Trading', 53600, {
  creditSupportRequestId: 7,
  creditPartner: { id: 7, name: 'Parceiro Fin' },
});
const B = resultado(2, 'Beta Trading', 53550, { offeredIncoterm: 'CIF', paymentTermsDays: 45, leadTimeDays: 50 });
const C: ExcludedComparisonResponse = {
  quoteResponseId: 3,
  supplierId: 103,
  supplier: { id: 103, name: 'Gama Industrial' },
  creditSupportRequestId: null,
  creditPartner: null,
  reason: 'partial',
  unavailableItems: [],
};

function respostasPadrao(): QuoteResponse[] {
  const r3 = resposta(3, [0.79, 'NA', null], { offeredIncoterm: 'EXW', paymentTermsDays: 60, leadTimeDays: 33 });
  r3.items![0]!.leadTimeDays = 38;
  return [
    resposta(1, [0.76, 0.89, 0.99]),
    resposta(2, [{ p: 0.77, q: 40000 }, 0.91, 0.98], { offeredIncoterm: 'CIF', paymentTermsDays: 45 }),
    r3,
    // outra cotacao: nao pode entrar
    resposta(50, [0.01, 0.01, 0.01], { quoteRequestId: 5 }),
  ];
}

interface Opcoes {
  itensProp?: ItemDaCotacao[];
  ranked?: ComparisonResult[];
  excluded?: ExcludedComparisonResponse[];
  excludedWinnerKey?: string | null;
  winnerBadgeLabel?: string;
  requestCurrency?: string;
}

function renderMatriz(o: Opcoes = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ComparacaoPorItem
        quoteRequestId={99}
        items={o.itensProp ?? itens}
        requestCurrency={o.requestCurrency ?? 'USD'}
        rankedResults={o.ranked ?? [A, Bparceiro, B]}
        excludedResponses={o.excluded ?? [C]}
        excludedWinnerKey={o.excludedWinnerKey ?? null}
        winnerBadgeLabel={o.winnerBadgeLabel ?? 'Vencedora'}
      />
    </QueryClientProvider>,
  );
}

const REGIAO = { name: 'Matriz de preço unitário por item e fornecedor' };

// Celulas da linha do item (td das colunas de fornecedor, na ordem das colunas).
function celulasDaLinha(container: HTMLElement, nomeDoItem: string): HTMLElement[] {
  const th = Array.from(container.querySelectorAll('tbody th')).find((el) => el.textContent?.includes(nomeDoItem));
  if (!th) throw new Error(`linha ${nomeDoItem} nao encontrada`);
  return Array.from(th.closest('tr')!.querySelectorAll('td.cmp-pi__col-forn')) as HTMLElement[];
}

function linhaDoRodape(container: HTMLElement, rotulo: string): HTMLElement[] {
  const th = Array.from(container.querySelectorAll('tfoot th')).find((el) => el.textContent?.startsWith(rotulo));
  if (!th) throw new Error(`rodape ${rotulo} nao encontrado`);
  return Array.from(th.closest('tr')!.querySelectorAll('td.cmp-pi__col-forn')) as HTMLElement[];
}

describe('ComparacaoPorItem', () => {
  beforeEach(() => {
    vi.mocked(listQuoteResponses).mockReset().mockResolvedValue(respostasPadrao());
  });

  it('(a) cabecalhos na ordem do ranking com posicao, "Vencedora" e a fora do ranking por ultimo em cinza', async () => {
    const { findByRole } = renderMatriz();
    const regiao = await findByRole('region', REGIAO);
    const cabecalhos = Array.from(regiao.querySelectorAll('thead th.cmp-pi__col-forn')) as HTMLElement[];
    expect(cabecalhos.map((th) => th.querySelector('.cmp-pi__cab-nome')?.textContent)).toEqual(['Alfa Química', 'Beta Trading', 'Gama Industrial']);
    // A posicao e a do Ranking: a alternativa via parceiro ocupa o 2, entao a direta de Beta e a 3.
    expect(cabecalhos[0]?.querySelector('.cmp-pi__posicao')?.textContent).toBe('1');
    expect(cabecalhos[0]?.querySelector('.cmp-pi__posicao')?.className).toContain('cmp-pi__posicao--vencedora');
    expect(cabecalhos[0]?.querySelector('.cmp-winner-badge')?.textContent).toBe('Vencedora');
    expect(cabecalhos[1]?.querySelector('.cmp-pi__posicao')?.textContent).toBe('3');
    expect(cabecalhos[1]?.querySelector('.cmp-pi__posicao')?.className).not.toContain('--vencedora');
    expect(cabecalhos[1]?.querySelector('.cmp-winner-badge')).toBeNull();
    expect(cabecalhos[2]?.className).toContain('cmp-pi__col--fora');
    expect(cabecalhos[2]?.querySelector('.cmp-pi__posicao')).toBeNull();
    expect(within(cabecalhos[2] as HTMLElement).getByText('Fora do ranking')).toBeTruthy();
    expect(regiao.querySelectorAll('tbody td.cmp-pi__col--fora')).toHaveLength(3);
    // as 3 colunas de fornecedor + item, qtd e alvo
    expect(regiao.querySelectorAll('thead th')).toHaveLength(6);
  });

  it('(a) usa o rotulo recebido: "Vencedora (escolha manual)" na coluna da escolha manual fora do ranking', async () => {
    const { findByRole } = renderMatriz({
      ranked: [{ ...A, isWinner: false }, B],
      excludedWinnerKey: '3:0',
      winnerBadgeLabel: 'Vencedora (escolha manual)',
    });
    const regiao = await findByRole('region', REGIAO);
    const cabecalhos = Array.from(regiao.querySelectorAll('thead th.cmp-pi__col-forn')) as HTMLElement[];
    const gama = cabecalhos[2] as HTMLElement;
    expect(gama.textContent).toContain('Vencedora (escolha manual)');
    expect(gama.textContent).toContain('Fora do ranking');
    expect(cabecalhos.filter((th) => th.querySelector('.cmp-winner-badge'))).toHaveLength(1);
  });

  it('(b) alternativa via parceiro nao vira coluna e a nota aparece', async () => {
    const { findByRole, getByText } = renderMatriz();
    const regiao = await findByRole('region', REGIAO);
    expect(regiao.querySelectorAll('thead th.cmp-pi__col-forn')).toHaveLength(3);
    expect(getByText('Alternativas via parceiro (Credit Support) aparecem só no Ranking.')).toBeTruthy();
  });

  it('(b) sem alternativa via parceiro a nota nao aparece', async () => {
    const { findByRole, queryByText } = renderMatriz({ ranked: [A, B] });
    await findByRole('region', REGIAO);
    expect(queryByText(/Alternativas via parceiro/)).toBeNull();
  });

  it('linhas: item com nome, subtitulo, quantidade com unidade em minusculas e preco-alvo (ou "—")', async () => {
    const { findByRole } = renderMatriz();
    const regiao = await findByRole('region', REGIAO);
    const linhas = Array.from(regiao.querySelectorAll('tbody tr')) as HTMLElement[];
    expect(linhas).toHaveLength(3);
    const primeira = linhas[0] as HTMLElement;
    expect(primeira.querySelector('th[scope="row"] .cmp-pi__item-nome')?.textContent).toBe('Ácido cítrico');
    expect(primeira.querySelector('.cmp-pi__item-sub')?.textContent).toBe('AC-01 · Pó, saco 25 kg');
    expect(primeira.querySelector('td.cmp-pi__col-qtd')?.textContent).toBe('20.000 kg');
    expect(primeira.querySelector('td.cmp-pi__col-alvo')?.textContent).toBe('0,78');
    expect((linhas[1] as HTMLElement).querySelector('.cmp-pi__item-sub')).toBeNull();
    expect((linhas[1] as HTMLElement).querySelector('td.cmp-pi__col-alvo')?.textContent).toBe('—');
  });

  it('(c) unitario com 2 casas, menor da linha destacado com o texto "menor" e as demais com a diferenca %', async () => {
    const { findByRole, container } = renderMatriz();
    await findByRole('region', REGIAO);
    const l1 = celulasDaLinha(container, 'Ácido cítrico');
    expect(l1[0]?.querySelector('.cmp-pi__px-valor')?.textContent).toBe('0,76');
    expect(l1[0]?.querySelector('.cmp-pi__px')?.className).toContain('cmp-pi__px--menor');
    expect(l1[0]?.querySelector('.cmp-pi__px-delta')?.textContent).toBe('menor');
    expect(l1[1]?.querySelector('.cmp-pi__px')?.className).not.toContain('cmp-pi__px--menor');
    expect(l1[1]?.querySelector('.cmp-pi__px-delta')?.textContent).toBe('+1,3%');
    expect(l1[2]?.querySelector('.cmp-pi__px-delta')?.textContent).toBe('+3,9%');
    // item 3: o menor e o da Beta (0,98), nao o da vencedora
    const l3 = celulasDaLinha(container, 'Tripolifosfato');
    expect(l3[1]?.querySelector('.cmp-pi__px')?.className).toContain('cmp-pi__px--menor');
    expect(l3[0]?.querySelector('.cmp-pi__px-delta')?.textContent).toBe('+1,0%');
    // a resposta de outra cotacao (0,01) nunca entra
    expect(container.textContent).not.toContain('0,01');
  });

  it('(d) empate no menor: as duas empatadas recebem "menor" e destaque', async () => {
    vi.mocked(listQuoteResponses).mockResolvedValue([
      resposta(1, [0.77, 0.89, 0.99]),
      resposta(2, [0.77, 0.91, 0.98]),
      resposta(3, [0.79, 0.9, null]),
    ]);
    const { findByRole, container } = renderMatriz();
    await findByRole('region', REGIAO);
    const l1 = celulasDaLinha(container, 'Ácido cítrico');
    expect(l1[0]?.querySelector('.cmp-pi__px--menor')).not.toBeNull();
    expect(l1[1]?.querySelector('.cmp-pi__px--menor')).not.toBeNull();
    expect(l1[2]?.querySelector('.cmp-pi__px--menor')).toBeNull();
    expect(l1.filter((td) => td.textContent?.includes('menor'))).toHaveLength(2);
  });

  it('(e) item nao cotado mostra "—" (aria-hidden) com "Não cotou" para leitor de tela e title', async () => {
    const { findByRole, container } = renderMatriz();
    await findByRole('region', REGIAO);
    const l3 = celulasDaLinha(container, 'Tripolifosfato');
    const nada = l3[2]?.querySelector('.cmp-pi__px-nada') as HTMLElement;
    expect(nada.getAttribute('title')).toBe('Este fornecedor não cotou o item');
    expect(nada.querySelector('[aria-hidden="true"]')?.textContent).toBe('—');
    expect(nada.querySelector('.sr-only')?.textContent).toBe('Não cotou');
  });

  it('(f) item temporariamente indisponivel vira o selo "Indisponível"', async () => {
    const { findByRole, container } = renderMatriz();
    await findByRole('region', REGIAO);
    const l2 = celulasDaLinha(container, 'Sulfato de zinco');
    const selo = l2[2]?.querySelector('.badge.badge--warning') as HTMLElement;
    expect(selo.textContent).toBe('Indisponível');
    expect(selo.getAttribute('title')).toBe('Item temporariamente indisponível neste fornecedor');
  });

  it('(g) quantidade cotada diferente da pedida: selo "Qtd N" com o title do total', async () => {
    const { findByRole, container } = renderMatriz();
    await findByRole('region', REGIAO);
    const l1 = celulasDaLinha(container, 'Ácido cítrico');
    const aviso = l1[1]?.querySelector('.cmp-pi__px-aviso') as HTMLElement;
    expect(aviso.textContent).toBe('Qtd 40.000');
    expect(aviso.getAttribute('title')).toBe('Cotou 40.000 kg; pedido 20.000 kg. O total usa o unitário × quantidade pedida.');
    expect(aviso.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(l1[0]?.querySelector('.cmp-pi__px-aviso')).toBeNull();
  });

  it('(h) rodape: total igual ao do Ranking (2 casas), "menor total", "incompleta", incoterm e pagamento, lead time e "Menor preço em N de M"', async () => {
    const { findByRole, container } = renderMatriz();
    await findByRole('region', REGIAO);
    const total = linhaDoRodape(container, 'Total dos itens (US$)');
    expect(total[0]?.querySelector('.cmp-pi__total')?.textContent).toBe('53.300,00');
    expect(total[0]?.querySelector('.cmp-pi__total')?.className).toContain('cmp-pi__total--menor');
    expect(total[0]?.querySelector('.cmp-pi__total-sub')?.textContent).toBe('menor total');
    expect(total[1]?.querySelector('.cmp-pi__total')?.textContent).toBe('53.550,00');
    expect(total[1]?.querySelector('.cmp-pi__total')?.className).not.toContain('--menor');
    expect(total[1]?.querySelector('.cmp-pi__total-sub')?.textContent).toBe('+0,5%');
    expect(total[2]?.querySelector('.cmp-pi__total-sub')?.textContent).toBe('incompleta');
    expect(total[2]?.textContent).toContain('—');
    expect(total[2]?.querySelector('.sr-only')?.textContent).toBe('Sem total');

    const incoterm = linhaDoRodape(container, 'Incoterm · pagamento');
    expect(incoterm[0]?.querySelector('.chip.chip--static.cmp-incoterm')?.textContent).toBe('FOB');
    expect(incoterm[0]?.querySelector('.cmp-pi__pagamento')?.textContent).toBe('30 dias');
    expect(incoterm[1]?.textContent).toContain('CIF');
    expect(incoterm[1]?.textContent).toContain('45 dias');
    // fora do ranking: incoterm e pagamento da resposta
    expect(incoterm[2]?.textContent).toContain('EXW');
    expect(incoterm[2]?.textContent).toContain('60 dias');

    const lead = linhaDoRodape(container, 'Lead time');
    expect(lead.map((td) => td.textContent)).toEqual(['45 dias', '50 dias', '38 dias']);

    const menores = linhaDoRodape(container, 'Menor preço em');
    expect(menores.map((td) => td.textContent)).toEqual(['2 de 3', '1 de 3', '0 de 3']);
  });

  it('(i) switch "Destacar menor preço" desligado tira o destaque (mantem "menor"); "Mostrar diferença" desligado some com os "+x,x%"', async () => {
    const { findByRole, container, getByRole } = renderMatriz();
    await findByRole('region', REGIAO);
    const destacar = getByRole('switch', { name: 'Destacar menor preço' }) as HTMLInputElement;
    const diferenca = getByRole('switch', { name: 'Mostrar diferença vs. menor' }) as HTMLInputElement;
    expect(destacar.checked).toBe(true);
    expect(diferenca.checked).toBe(true);
    expect(container.querySelectorAll('.cmp-pi__px--menor').length).toBeGreaterThan(0);
    expect(container.querySelector('.cmp-pi__total--menor')).not.toBeNull();

    fireEvent.click(destacar);
    expect(destacar.checked).toBe(false);
    expect(container.querySelector('.cmp-pi__px--menor')).toBeNull();
    expect(container.querySelector('.cmp-pi__total--menor')).toBeNull();
    expect(container.textContent).toContain('menor total');
    expect(Array.from(container.querySelectorAll('.cmp-pi__px-delta')).some((el) => el.textContent === 'menor')).toBe(true);
    expect(Array.from(container.querySelectorAll('.cmp-pi__px-delta')).some((el) => el.textContent?.startsWith('+'))).toBe(true);

    fireEvent.click(diferenca);
    expect(Array.from(container.querySelectorAll('.cmp-pi__px-delta')).some((el) => el.textContent?.startsWith('+'))).toBe(false);
    expect(Array.from(container.querySelectorAll('.cmp-pi__px-delta')).some((el) => el.textContent === 'menor')).toBe(true);
  });

  it('(j) faixa: soma do menor de cada item, % abaixo da vencedora e fornecedores distintos', async () => {
    const { findByRole, container } = renderMatriz();
    await findByRole('region', REGIAO);
    const faixa = container.querySelector('.cmp-pi__insight') as HTMLElement;
    expect(faixa.getAttribute('role')).toBe('status');
    expect(faixa.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(faixa.textContent).toContain('Comprando o menor preço de cada item, o total seria US$ 53.050,00');
    expect(faixa.textContent).toContain('(0,5% abaixo da vencedora, US$ 53.300,00)');
    expect(faixa.textContent).toContain('dividido entre 2 fornecedores. Informativo: não entra no ranking.');
  });

  it('(j) um fornecedor so: texto no singular; sem vencedora ranqueada: sem o trecho entre parenteses', async () => {
    vi.mocked(listQuoteResponses).mockResolvedValue([
      resposta(1, [0.76, 0.89, 0.98]),
      resposta(2, [0.77, 0.91, 0.99]),
    ]);
    const { findByRole, container } = renderMatriz({ ranked: [{ ...A, isWinner: false }, B], excluded: [] });
    await findByRole('region', REGIAO);
    const faixa = container.querySelector('.cmp-pi__insight') as HTMLElement;
    expect(faixa.textContent).toContain('o total seria US$ 53.050,00, dividido entre 1 fornecedor.');
    expect(faixa.textContent).not.toContain('fornecedores');
    expect(faixa.textContent).not.toContain('abaixo da vencedora');
  });

  it('(j) item sem preco em nenhuma coluna: "Nenhuma proposta cotou" com os nomes', async () => {
    vi.mocked(listQuoteResponses).mockResolvedValue([
      resposta(1, [0.76, 0.89, null]),
      resposta(2, [0.77, 0.91, null]),
      resposta(3, [0.79, 'NA', null]),
    ]);
    const { findByRole, container } = renderMatriz();
    await findByRole('region', REGIAO);
    const faixa = container.querySelector('.cmp-pi__insight') as HTMLElement;
    expect(faixa.textContent).toContain('Nenhuma proposta cotou: Tripolifosfato.');
    expect(faixa.textContent).toContain('não dá para somar o menor preço de cada item');
    expect(faixa.textContent).not.toContain('Comprando');
  });

  it('(j) vencedora ja no menor preco de todos os itens: mensagem propria', async () => {
    vi.mocked(listQuoteResponses).mockResolvedValue([
      resposta(1, [0.7, 0.8, 0.9]),
      resposta(2, [0.77, 0.91, 0.98]),
      resposta(3, [0.79, 'NA', null]),
    ]);
    const { findByRole, container } = renderMatriz({ ranked: [{ ...A, offeredPrice: 0.7 * 20000 + 0.8 * 15000 + 0.9 * 25000 }, B] });
    await findByRole('region', REGIAO);
    const faixa = container.querySelector('.cmp-pi__insight') as HTMLElement;
    expect(faixa.textContent).toContain('A vencedora já tem o menor preço em todos os itens. Informativo: não entra no ranking.');
  });

  it('(j) economia real minima (< 0,05%): nao diz que a vencedora ja tem o menor preco; diz "menos de 0,1%"', async () => {
    vi.mocked(listQuoteResponses).mockResolvedValue([
      resposta(1, [0.7, 0.8, 0.9]),
      resposta(2, [0.77, 0.91, 0.98]),
      resposta(3, [0.79, 'NA', null]),
    ]);
    const { findByRole, container } = renderMatriz({ ranked: [{ ...A, offeredPrice: 0.7 * 20000 + 0.8 * 15000 + 0.9 * 25000 + 2 }, B] });
    await findByRole('region', REGIAO);
    const faixa = container.querySelector('.cmp-pi__insight') as HTMLElement;
    expect(faixa.textContent).not.toContain('A vencedora já tem o menor preço');
    expect(faixa.textContent).toContain('menos de 0,1% abaixo da vencedora');
  });

  it('(k) coluna em outra moeda: selo "Moeda BRL", sem destaque nem diferenca, e a legenda avisa', async () => {
    vi.mocked(listQuoteResponses).mockResolvedValue([
      resposta(1, [0.76, 0.89, 0.99]),
      resposta(2, [0.1, 0.1, 0.1], { currency: 'BRL' }),
      resposta(3, [0.79, 0.9, null]),
    ]);
    const { findByRole, container } = renderMatriz({ ranked: [A, B] });
    const regiao = await findByRole('region', REGIAO);
    const cabecalhos = Array.from(regiao.querySelectorAll('thead th.cmp-pi__col-forn')) as HTMLElement[];
    expect(within(cabecalhos[1] as HTMLElement).getByText('Moeda BRL').className).toContain('badge--muted');
    expect(cabecalhos[0]?.textContent).not.toContain('Moeda');
    const l1 = celulasDaLinha(container, 'Ácido cítrico');
    expect(l1[1]?.querySelector('.cmp-pi__px-valor')?.textContent).toBe('0,10');
    expect(l1[1]?.querySelector('.cmp-pi__px--menor')).toBeNull();
    expect(l1[1]?.querySelector('.cmp-pi__px-delta')).toBeNull();
    // o menor da linha continua sendo o da vencedora (em USD), nao o 0,10 de BRL
    expect(l1[0]?.querySelector('.cmp-pi__px--menor')).not.toBeNull();
    expect(linhaDoRodape(container, 'Menor preço em')[1]?.textContent).toBe('—');
    expect(container.querySelector('.cmp-pi__legenda')?.textContent).toContain('Colunas em outra moeda não entram no destaque.');
  });

  it('o cabecalho do preco-alvo cita a moeda da cotacao quando difere da dos precos', async () => {
    const { findByRole } = renderMatriz({ requestCurrency: 'EUR' });
    const regiao = await findByRole('region', REGIAO);
    expect(within(regiao).getByText('Preço-alvo (EUR)')).toBeTruthy();
  });

  it('(l) regiao rolavel com tabindex 0, papel e nome', async () => {
    const { findByRole } = renderMatriz();
    const regiao = await findByRole('region', REGIAO);
    expect(regiao.getAttribute('tabindex')).toBe('0');
    expect(regiao.className).toContain('cmp-pi__rolagem');
    expect(regiao.querySelector('table.cmp-pi__matriz')).not.toBeNull();
  });

  it('(m) nenhum estilo inline no DOM', async () => {
    const { findByRole, container } = renderMatriz();
    await findByRole('region', REGIAO);
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('(n) erro ao carregar os precos: role=alert com "Tentar novamente", que refaz a busca', async () => {
    vi.mocked(listQuoteResponses).mockRejectedValueOnce(new Error('[falha]'));
    const { findByRole, getByRole } = renderMatriz();
    const alerta = await findByRole('alert');
    expect(alerta.textContent).toContain('Não foi possível carregar os preços por item.');
    expect(alerta.textContent).toContain('[falha]');
    fireEvent.click(getByRole('button', { name: 'Tentar novamente' }));
    await findByRole('region', REGIAO);
    expect(listQuoteResponses).toHaveBeenCalledTimes(2);
  });

  it('carregando: status com "Carregando preços por item…"', async () => {
    vi.mocked(listQuoteResponses).mockReturnValue(new Promise(() => {}));
    const { getByRole } = renderMatriz();
    await waitFor(() => expect(getByRole('status').textContent).toContain('Carregando preços por item…'));
  });

  it('sem itens: estado vazio "Sem itens nesta cotação." e nenhuma chamada', async () => {
    const { findByText, container } = renderMatriz({ itensProp: [] });
    await findByText('Sem itens nesta cotação.');
    expect(container.querySelector('.cmp-empty')).not.toBeNull();
    expect(listQuoteResponses).not.toHaveBeenCalled();
  });

  it('resposta fora do cache: a coluna existe e todas as celulas ficam em "—"', async () => {
    vi.mocked(listQuoteResponses).mockResolvedValue([resposta(1, [0.76, 0.89, 0.99])]);
    const { findByRole, container } = renderMatriz({ ranked: [A], excluded: [C] });
    await findByRole('region', REGIAO);
    const l1 = celulasDaLinha(container, 'Ácido cítrico');
    expect(l1[0]?.querySelector('.cmp-pi__px-valor')?.textContent).toBe('0,76');
    expect(l1[1]?.querySelector('.cmp-pi__px-nada')).not.toBeNull();
    expect(celulasDaLinha(container, 'Tripolifosfato')[1]?.querySelector('.cmp-pi__px-nada')).not.toBeNull();
    // 1 coluna na moeda de referencia: sem faixa
    expect(container.querySelector('.cmp-pi__insight')).toBeNull();
  });

  it('so alternativas via parceiro: sem colunas, estado vazio e a nota do parceiro', async () => {
    const { findByText } = renderMatriz({ ranked: [Bparceiro], excluded: [] });
    await findByText('Nenhuma proposta direta para mostrar por item.');
    await findByText('Alternativas via parceiro (Credit Support) aparecem só no Ranking.');
  });
});
