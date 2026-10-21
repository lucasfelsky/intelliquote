import { describe, expect, it } from 'vitest';
import type { ForecastLinha, ForecastMonths, ForecastSnapshotDetail } from '@/services/forecast';
import {
  alertaProjecao,
  casaBusca,
  colunasDoPainel,
  contabil,
  contabil1,
  contarPorFiltro,
  d1,
  dataBr,
  descreverDivergencia,
  dMmm,
  FILTROS,
  inteiroBr,
  mesesDaProjecao,
  nomeDoMes,
  normalizarBusca,
  passosDaMemoria,
  risco,
  textoAA,
  textoDoSelo,
  vendaAcimaDaMedia,
} from './forecastPainel';

// Dados 100% sinteticos.
function linha(over: Partial<ForecastLinha> = {}): ForecastLinha {
  return {
    linha: 3,
    O: 100,
    P: 50,
    Q: 100,
    R: 90,
    S: 80,
    T: 10,
    U: 500,
    chegadas: [0, 0, 0, 0, 0],
    AA: 5,
    programacoes: [0, 0, 0, 0],
    AG: 100,
    projecao: [400, 300, 200, 100, 50, 20],
    AN: 200,
    AQ: 30,
    AP: '2026-11-20',
    AR: 0,
    AS: 0,
    item: 'PRODUTO A',
    codigos: ['C0001', 'C0002'],
    fonte: 'FONTE 1',
    status: 'nao',
    analiseForecast: null,
    productId: null,
    n: 1,
    historico: [10, 20, 30, 40, 50],
    obs: '',
    precoFixo: false,
    ...over,
  };
}

const MONTHS: ForecastMonths = {
  consumo: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7 (ATUAL)'],
  chegada: ['B1', 'B2', 'B3', 'B4', 'B5'],
  programacao: ['C1', 'C2', 'C3', 'C4'],
};

const IDS_PADRAO = [
  'h3', 'h4', 'O', 'P', 'Q', 'R', 'S', 'T', 'U',
  'V', 'W', 'X', 'Y', 'Z', 'AA',
  'AC', 'AD', 'AE', 'AF',
  'AN', 'analiseForecast', 'AP', 'precoFixo', 'fonte', 'obs',
];

describe('formatos', () => {
  it('contabil: inteiro pt-BR, zero e nulo viram "-"', () => {
    expect(contabil(null)).toBe('-');
    expect(contabil(0)).toBe('-');
    expect(contabil(0.4)).toBe('-');
    expect(contabil(-0.4)).toBe('-');
    expect(contabil(1468.3)).toBe('1.468');
    expect(contabil(-1522.2)).toBe('-1.522');
  });

  it('contabil1: 1 casa pt-BR, zero e nulo viram "-"', () => {
    expect(contabil1(null)).toBe('-');
    expect(contabil1(0)).toBe('-');
    expect(contabil1(-1522.2)).toBe('-1.522,2');
    expect(contabil1(12.34)).toBe('12,3');
  });

  it('d1: 1 casa com virgula, sem milhar; nulo = #N/D', () => {
    expect(d1(null)).toBe('#N/D');
    expect(d1(1468.3)).toBe('1468,3');
    expect(d1(0)).toBe('0,0');
    expect(d1(-5.25)).toBe('-5,3');
  });

  it('inteiroBr usa o sinal tipografico e "—" para ausente', () => {
    expect(inteiroBr(-1234.4)).toBe('−1.234');
    expect(inteiroBr(0)).toBe('0');
    expect(inteiroBr(undefined)).toBe('—');
  });

  it('datas saem do texto, sem fuso', () => {
    expect(dMmm('2027-01-19')).toBe('19-jan');
    expect(dMmm(null)).toBe('#N/D');
    expect(dataBr('2026-10-15')).toBe('15/10/2026');
    expect(dataBr('2026-10-15T00:00:00.000Z')).toBe('15/10/2026');
    expect(dataBr(null)).toBe('#N/D');
    expect(dataBr('lixo')).toBe('#N/D');
  });

  it('textoAA: numero em 1 casa, texto como veio', () => {
    expect(textoAA(5)).toBe('5,0');
    expect(textoAA('0')).toBe('0');
  });
});

describe('meses', () => {
  it('mesesDaProjecao: 6 rotulos mmm/aaaa e virada de ano', () => {
    expect(mesesDaProjecao('2026-10-15')).toEqual(['out/2026', 'nov/2026', 'dez/2026', 'jan/2027', 'fev/2027', 'mar/2027']);
    expect(mesesDaProjecao('2026-12-01')).toEqual(['dez/2026', 'jan/2027', 'fev/2027', 'mar/2027', 'abr/2027', 'mai/2027']);
  });

  it('nomeDoMes: por extenso, com deslocamento', () => {
    expect(nomeDoMes('2026-10-15', 0)).toBe('outubro');
    expect(nomeDoMes('2026-10-15', 3)).toBe('janeiro');
    expect(nomeDoMes('2026-11-15', 4)).toBe('março');
    expect(nomeDoMes('lixo', 0)).toBe('');
  });
});

describe('colunasDoPainel', () => {
  it('lista exata do painel (sem as ocultas) e nenhuma coluna proibida', () => {
    const ids = colunasDoPainel(MONTHS, { ocultas: false }).map((c) => c.id);
    expect(ids).toEqual(IDS_PADRAO);
    for (const proibida of ['AG', 'AH', 'AI', 'AJ', 'AK', 'AL', 'AM', 'AQ', 'AR', 'AS']) {
      expect(ids).not.toContain(proibida);
    }
  });

  it('com ocultas: EMB.1-7 logo no inicio e os 3 meses mais antigos antes do 4o', () => {
    const colunas = colunasDoPainel(MONTHS, { ocultas: true });
    expect(colunas.map((c) => c.id)).toEqual(['cod', 'h0', 'h1', 'h2', ...IDS_PADRAO]);
    expect(colunas[0]?.rotulo).toBe('EMB.1–7');
  });

  it('rotulos dos meses vem de months (nunca fixos)', () => {
    const colunas = colunasDoPainel(MONTHS, { ocultas: true });
    const rotulo = (id: string) => colunas.find((c) => c.id === id)?.rotulo;
    expect(['h0', 'h1', 'h2', 'h3', 'h4', 'O', 'P'].map(rotulo)).toEqual(MONTHS.consumo);
    expect(['V', 'W', 'X', 'Y', 'Z'].map(rotulo)).toEqual(MONTHS.chegada);
    expect(['AC', 'AD', 'AE', 'AF'].map(rotulo)).toEqual(MONTHS.programacao);
  });

  it('textos das celulas seguem os formatos da planilha', () => {
    const colunas = colunasDoPainel(MONTHS, { ocultas: true });
    const texto = (id: string, l: ForecastLinha) => colunas.find((c) => c.id === id)?.texto(l);
    const l = linha({
      historico: [1, 2, 3, 1468, 0],
      Q: 1468.3,
      AN: -1522.2,
      AP: null,
      AA: '0',
      precoFixo: true,
      obs: 'Obs. de teste',
    });
    expect(texto('cod', l)).toBe('C0001 · C0002');
    expect(texto('h3', l)).toBe('1.468');
    expect(texto('h4', l)).toBe('-');
    expect(texto('Q', l)).toBe('1468,3');
    expect(texto('AN', l)).toBe('-1.522,2');
    expect(texto('AN', linha({ AN: null }))).toBe('#N/D');
    expect(texto('AP', l)).toBe('#N/D');
    expect(texto('AA', l)).toBe('0');
    expect(texto('precoFixo', l)).toBe('Fixo');
    expect(texto('precoFixo', linha({ precoFixo: false }))).toBe('');
    expect(texto('obs', l)).toBe('Obs. de teste');
  });

  it('backend antigo (sem historico/obs/precoFixo) nao quebra', () => {
    const semNovos = linha();
    delete semNovos.historico;
    delete semNovos.obs;
    delete semNovos.precoFixo;
    delete semNovos.n;
    const colunas = colunasDoPainel(MONTHS, { ocultas: true });
    const textos = colunas.map((c) => c.texto(semNovos));
    expect(textos.every((t) => typeof t === 'string')).toBe(true);
    expect(colunas.find((c) => c.id === 'h3')?.texto(semNovos)).toBe('-');
    expect(colunas.find((c) => c.id === 'obs')?.texto(semNovos)).toBe('');
  });

  it('alertas de celula: P > Q e DEMANDA <= 0', () => {
    const colunas = colunasDoPainel(MONTHS, { ocultas: false });
    const col = (id: string) => colunas.find((c) => c.id === id);
    expect(col('P')?.classe?.(linha({ P: 101, Q: 100 }))).toBe('fc-cell--acima-media');
    expect(col('P')?.classe?.(linha({ P: 100, Q: 100 }))).toBe('');
    expect(col('AN')?.destaque?.(linha({ AN: 0 }))).toBe('fc-pill--falta');
    expect(col('AN')?.destaque?.(linha({ AN: -3 }))).toBe('fc-pill--falta');
    expect(col('AN')?.destaque?.(linha({ AN: 1 }))).toBe('');
    expect(col('AN')?.destaque?.(linha({ AN: null }))).toBe('');
  });

  it('colunaPlanilha so nas colunas que o motor calcula', () => {
    const colunas = colunasDoPainel(MONTHS, { ocultas: true });
    const comLetra = colunas.filter((c) => c.colunaPlanilha).map((c) => c.colunaPlanilha);
    expect(comLetra).toEqual(['O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AC', 'AD', 'AE', 'AF', 'AN']);
  });
});

describe('vendaAcimaDaMedia e alertaProjecao', () => {
  it('vendaAcimaDaMedia: P > Q estrito', () => {
    expect(vendaAcimaDaMedia({ P: 11, Q: 10 })).toBe(true);
    expect(vendaAcimaDaMedia({ P: 10, Q: 10 })).toBe(false);
  });

  it('alertaProjecao: < Q falta, < 3Q atencao, regra exata sem guarda de Q > 0', () => {
    expect(alertaProjecao(99, 100)).toBe('falta');
    expect(alertaProjecao(100, 100)).toBe('atencao');
    expect(alertaProjecao(299, 100)).toBe('atencao');
    expect(alertaProjecao(300, 100)).toBeNull();
    expect(alertaProjecao(-1, 0)).toBe('falta');
    expect(alertaProjecao(0, 0)).toBeNull();
  });
});

describe('filtros e busca', () => {
  const linhas = [
    linha({ linha: 1, AN: -5, Q: 10, projecao: [5, 5, 5, 5, 5, 5], status: 'nao' }),
    linha({ linha: 2, AN: 0, Q: 0, projecao: [-1, -1, 5, 5, 5, 5], status: 'cotando' }),
    linha({ linha: 3, AN: null, Q: 10, projecao: [5, 5, 5, -2, 5, 5], status: 'po' }),
    linha({ linha: 4, AN: 40, Q: 10, projecao: [5, 5, 5, 5, -2, -2], status: 'nao' }),
  ];

  it('contagens sobre a quinzena inteira (Q = 0 fica fora de "Demanda <= 0" e de "Falta ate")', () => {
    expect(contarPorFiltro(linhas)).toEqual({ todos: 4, demanda: 1, falta: 1, andamento: 2 });
  });

  it('rotulo do filtro de falta acompanha o mes da base', () => {
    const falta = FILTROS.find((f) => f.id === 'falta');
    expect(falta?.rotulo('2026-10-15')).toBe('Falta até janeiro');
    expect(falta?.rotulo('2026-11-02')).toBe('Falta até fevereiro');
  });

  it('busca sem acento e sem caixa por item, codigo e fonte', () => {
    const l = linha({ item: 'Produto Ácido', codigos: ['C0099', ''], fonte: 'Fonte Çá' });
    expect(normalizarBusca('  Áçaí ')).toBe('ACAI');
    expect(casaBusca(l, 'acido')).toBe(true);
    expect(casaBusca(l, 'ÁCIDO')).toBe(true);
    expect(casaBusca(l, 'c0099')).toBe(true);
    expect(casaBusca(l, 'fonte ca')).toBe(true);
    expect(casaBusca(l, 'inexistente')).toBe(false);
    expect(casaBusca(l, '   ')).toBe(true);
  });
});

describe('risco', () => {
  it('sem falta: ok ate o ultimo mes da projecao', () => {
    expect(risco(linha(), '2026-10-15')).toEqual({ tom: 'ok', texto: 'Sem falta projetada até mar/2027.' });
  });

  it('com falta e sem AP: aviso (nao afirma "sem falta")', () => {
    const r = risco(linha({ projecao: [10, 5, -1, -2, -3, -4], AP: null }), '2026-10-15');
    expect(r.tom).toBe('aviso');
    expect(r.texto).toBe('Falta em dez/2026. Fonte sem lead time: não dá para saber se uma PO nova chega a tempo.');
  });

  it('falta antes da chegada: erro', () => {
    const r = risco(linha({ projecao: [10, -1, -2, -3, -4, -5], AP: '2027-01-19' }), '2026-10-15');
    expect(r).toEqual({ tom: 'erro', texto: 'Falta em nov/2026, antes de uma compra nova chegar (19/01/2027).' });
  });

  it('falta no mes da chegada ou depois: aviso "a tempo"', () => {
    const r = risco(linha({ projecao: [10, 5, 3, -3, -4, -5], AP: '2026-12-10' }), '2026-10-15');
    expect(r).toEqual({ tom: 'aviso', texto: 'Falta em jan/2027. Uma PO feita hoje chega em 10/12/2026, a tempo.' });
  });
});

describe('textoDoSelo', () => {
  const conf = (over: object = {}) => ({
    celulas: 1540,
    batem: 1540,
    porColuna: {},
    totalDivergencias: 0,
    divergencias: [],
    ...over,
  });
  const detail = (over: Partial<Pick<ForecastSnapshotDetail, 'conferencia' | 'half'>>) => ({
    conferencia: conf(),
    half: 2,
    ...over,
  });

  it('dbcorp (sem conferencia)', () => {
    const selo = textoDoSelo(detail({ conferencia: null }));
    expect(selo.tom).toBe('neutro');
    expect(selo.titulo).toBe('Quinzena gerada dos relatórios DBCorp — sem planilha para conferir.');
  });

  it('planilha identica', () => {
    expect(textoDoSelo(detail({}))).toEqual({
      tom: 'ok',
      titulo: 'Cálculo idêntico ao da planilha',
      detalhe: '1.540 de 1.540 células batem',
    });
  });

  it('planilha divergente, com e sem "primeiras N"', () => {
    const sem = textoDoSelo(
      detail({ conferencia: conf({ batem: 1538, totalDivergencias: 2, divergencias: [{}, {}] }) }),
    );
    expect(sem.tom).toBe('erro');
    expect(sem.titulo).toBe('Há diferenças com a planilha');
    expect(sem.detalhe).toBe('1.538 de 1.540 células batem · 2 divergem');

    const divergencias = Array.from({ length: 50 }, () => ({}));
    const com = textoDoSelo(
      detail({ conferencia: conf({ batem: 1440, totalDivergencias: 100, divergencias }) }),
    );
    expect(com.detalhe).toBe('1.440 de 1.540 células batem · 100 divergem (as primeiras 50 estão marcadas na grade)');
  });

  it('1a quinzena (half 1): rotulo da regra da planilha e nota; nunca "identico"', () => {
    const selo = textoDoSelo(detail({ half: 1 }));
    expect(selo.titulo).toBe('Conferência motor × planilha (regra da planilha, 2ª quinzena)');
    expect(selo.titulo).not.toMatch(/idêntico/);
    expect(selo.detalhe).toBe('1.540 de 1.540 células batem');
    expect(selo.nota).toBe(
      'Nesta 1ª quinzena o consumo do mês (AG) usa a média trimestral; a conferência usa a regra da planilha.',
    );
    const ruim = textoDoSelo(detail({ half: 1, conferencia: conf({ batem: 1500, totalDivergencias: 40, divergencias: [] }) }));
    expect(ruim.tom).toBe('erro');
    expect(ruim.nota).toBeDefined();
  });

  it('descreverDivergencia mostra planilha x motor', () => {
    expect(descreverDivergencia({ esperado: 12.5, calculado: null })).toBe('Planilha: 12,5 · motor: (vazio)');
    expect(descreverDivergencia({ esperado: '#N/D', calculado: 3 })).toBe('Planilha: #N/D · motor: 3');
  });
});

describe('passosDaMemoria', () => {
  it('6 passos com as contas da planilha (2a quinzena)', () => {
    const l = linha({
      historico: [0, 0, 0, 300, 600],
      O: 900,
      P: 120,
      Q: 600,
      AG: 600,
      U: 1000,
      chegadas: [100, 0, 0, 0, 0],
      programacoes: [50, 0, 0, 0],
      projecao: [450, 300, 100, -100, -300, -500],
      T: 20,
      AQ: 30,
      AN: -250,
    });
    const passos = passosDaMemoria(l, 2, '2026-10-15');
    expect(passos.map((p) => p.titulo)).toEqual([
      'Média trimestral',
      'Consumo do mês atual',
      'Final de outubro',
      'Meses seguintes',
      'Segurança',
      'Demanda',
    ]);
    expect(passos[0]?.conta).toBe('(300 + 600 + 900) ÷ 3');
    expect(passos[0]?.resultado).toBe('600,0');
    expect(passos[1]?.conta).toBe('maior entre a média (600,0) e a venda até o dia 15 (120)');
    expect(passos[2]?.conta).toBe('1.000 estoque + 100 chegadas − 50 programações − 600,0');
    expect(passos[2]?.resultado).toBe('450');
    expect(passos[2]?.tom).toBe('falta');
    expect(passos[3]?.meses?.map((m) => [m.rotulo, m.valor, m.tom])).toEqual([
      ['nov/2026', '300', 'falta'],
      ['dez/2026', '100', 'falta'],
      ['jan/2027', '−100', 'falta'],
      ['fev/2027', '−300', 'falta'],
      ['mar/2027', '−500', 'falta'],
    ]);
    expect(passos[4]?.conta).toBe('600,0 ÷ 30 × 30 dias de lead time');
    expect(passos[5]?.resultado).toBe('-250,0');
    expect(passos[5]?.tom).toBe('neg');
  });

  it('1a quinzena e fonte sem lead time mudam o texto', () => {
    const passos = passosDaMemoria(linha({ AQ: null, T: null, AN: null }), 1, '2026-10-15');
    expect(passos[1]?.conta).toBe('1ª quinzena: igual à média trimestral (100,0)');
    expect(passos[4]?.conta).toBe('fonte sem lead time cadastrado');
    expect(passos[4]?.resultado).toBe('#N/D');
    expect(passos[5]?.resultado).toBe('#N/D');
  });

  it('meses da projecao: ambar abaixo de 3x a media, sem alerta acima', () => {
    const passos = passosDaMemoria(linha({ Q: 100, projecao: [1000, 250, 300, 400, 50, 0] }), 2, '2026-10-15');
    expect(passos[2]?.tom).toBeNull();
    expect(passos[3]?.meses?.map((m) => m.tom)).toEqual(['atencao', null, null, 'falta', 'falta']);
  });
});
