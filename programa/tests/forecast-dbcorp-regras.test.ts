import { describe, expect, it } from 'vitest';
import {
  FORECAST_DBCORP_ETA_POR_ETD_DIAS,
  FORECAST_DBCORP_ETA_POR_PRONTIDAO_DIAS,
  FORECAST_DBCORP_FUP_EXCLUI_ETA_FINAL,
  FORECAST_DBCORP_FUP_REGRA,
  FORECAST_DBCORP_FUP_STATUS_EXCLUIDOS,
  FORECAST_DBCORP_MAX_DETALHES,
} from '../src/constants/forecast';
import {
  PRAZO_CHEGADA_PADRAO,
  PRAZOS_CHEGADA_PADRAO,
  aplicarRegrasFup,
  comprasEmAbertoDoFup,
  mudancasDePrazo,
  parseProntidao,
  resolverPrazosChegada,
  resumirPrazosEstimativa,
  type DataDaCelula,
  type FupLinha,
  type PrazosChegadaFup,
} from '../src/utils/forecastDbcorpRegras';
import { somarDias } from '../src/utils/forecastMonths';

// Funcoes puras sobre linhas sinteticas (o repositorio e publico: nenhum dado real).
const BASE = '2026-11-15';

const vazia: DataDaCelula = { tipo: 'vazia' };
const data = (key: string): DataDaCelula => ({ tipo: 'data', key });

let contador = 0;
function linha(over: Partial<FupLinha> = {}): FupLinha {
  contador++;
  return {
    linha: contador + 1,
    status: 'EM TRANSITO',
    codigo: 'TST0001',
    kg: 100,
    dataPo: vazia,
    prontidao: '',
    etd: vazia,
    eta: vazia,
    etaFinal: vazia,
    ...over,
  };
}

const total = (r: ReturnType<typeof aplicarRegrasFup>) => Object.values(r.ignoradas).reduce((a, b) => a + b, 0);

describe('parseProntidao', () => {
  const p = (texto: string, dataPo: string | null = '2026-09-10', base = BASE) => parseProntidao(texto, dataPo, base);

  it("texto 'MON DDth' em ingles, com sufixo, hifen e caixa variados", () => {
    expect(p('SEP 30TH')).toEqual({ tipo: 'data', key: '2026-09-30' });
    expect(p('Sep 3rd')).toEqual({ tipo: 'data', key: '2026-09-03' });
    expect(p('SEPTEMBER 30TH')).toEqual({ tipo: 'data', key: '2026-09-30' });
    expect(p('JULY 4TH', '2026-06-20')).toEqual({ tipo: 'data', key: '2026-07-04' });
    expect(p('OCT - 15TH')).toEqual({ tipo: 'data', key: '2026-10-15' });
    expect(p('  sep   21st ')).toEqual({ tipo: 'data', key: '2026-09-21' });
  });

  it('meses em portugues e dia sem sufixo', () => {
    expect(p('out 1')).toEqual({ tipo: 'data', key: '2026-10-01' });
    expect(p('SET 12')).toEqual({ tipo: 'data', key: '2026-09-12' });
    expect(p('DEZ 5', '2026-11-20')).toEqual({ tipo: 'data', key: '2026-12-05' });
    expect(p('FEV 10', '2027-01-20')).toEqual({ tipo: 'data', key: '2027-02-10' });
  });

  it('date key e dd/mm/aaaa (celula de data / campo de data do gateway)', () => {
    expect(p('2026-10-05')).toEqual({ tipo: 'data', key: '2026-10-05' });
    expect(p('05/10/2026')).toEqual({ tipo: 'data', key: '2026-10-05' });
    expect(p('2026-02-30')).toEqual({ tipo: 'nao_reconhecida' });
  });

  it('vazio e so espacos = vazia', () => {
    expect(p('')).toEqual({ tipo: 'vazia' });
    expect(p('   ')).toEqual({ tipo: 'vazia' });
  });

  it('texto livre e dia invalido = nao reconhecida', () => {
    expect(p('ASAP')).toEqual({ tipo: 'nao_reconhecida' });
    expect(p('WITH PO 123-45')).toEqual({ tipo: 'nao_reconhecida' });
    expect(p('STANDBY')).toEqual({ tipo: 'nao_reconhecida' });
    expect(p('FEB 30TH')).toEqual({ tipo: 'nao_reconhecida' });
    expect(p('SEP 31ST')).toEqual({ tipo: 'nao_reconhecida' });
    expect(p('SEP 3X')).toEqual({ tipo: 'nao_reconhecida' });
  });

  it('ano: virada pela DATA PO e pela data base', () => {
    expect(p('JAN 20TH', '2026-12-10')).toEqual({ tipo: 'data', key: '2027-01-20' });
    expect(p('DEC 16TH', '2026-11-21')).toEqual({ tipo: 'data', key: '2026-12-16' });
    // 1 mes antes do mes do PO ainda e o mesmo ano; 2 meses antes, ano seguinte.
    expect(p('SEP 5TH', '2026-10-02')).toEqual({ tipo: 'data', key: '2026-09-05' });
    expect(p('AUG 5TH', '2026-10-02')).toEqual({ tipo: 'data', key: '2027-08-05' });
  });

  it('sem DATA PO (ou invalida) usa a data base', () => {
    expect(p('NOV 20TH', null, '2026-10-15')).toEqual({ tipo: 'data', key: '2026-11-20' });
    expect(p('JAN 20TH', null, '2026-12-15')).toEqual({ tipo: 'data', key: '2027-01-20' });
    expect(p('JAN 20TH', 'nao-e-data', '2026-12-15')).toEqual({ tipo: 'data', key: '2027-01-20' });
  });

  it('29 de fevereiro depende do ano inferido', () => {
    expect(p('FEB 29TH', '2027-12-20')).toEqual({ tipo: 'data', key: '2028-02-29' });
    expect(p('FEB 29TH', '2026-12-20')).toEqual({ tipo: 'nao_reconhecida' });
  });
});

describe('aplicarRegrasFup (regra F3)', () => {
  it('regra com os valores das constantes', () => {
    const r = aplicarRegrasFup([], BASE);
    expect(r.regra).toEqual({
      id: FORECAST_DBCORP_FUP_REGRA,
      etaPorEtdDias: FORECAST_DBCORP_ETA_POR_ETD_DIAS,
      etaPorProntidaoDias: FORECAST_DBCORP_ETA_POR_PRONTIDAO_DIAS,
      excluiEtaFinal: FORECAST_DBCORP_FUP_EXCLUI_ETA_FINAL,
      statusExcluidos: [...FORECAST_DBCORP_FUP_STATUS_EXCLUIDOS],
    });
    expect(r.regra.id).toBe('F3');
    expect(r.regra.etaPorProntidaoDias).toBe(35);
  });

  it('1. sem codigo e kg nao numerico', () => {
    const r = aplicarRegrasFup([linha({ codigo: '' }), linha({ kg: null }), linha({ kg: Number.NaN })], BASE);
    expect(r.linhas).toEqual([]);
    expect(r.ignoradas).toEqual({ 'sem codigo': 1, 'quantidade nao numerica': 2 });
    expect(r.porStatus).toEqual([]);
  });

  it('2. concluido (com ou sem acento)', () => {
    const r = aplicarRegrasFup(
      [linha({ status: 'CONCLUÍDO', eta: data('2026-11-20') }), linha({ status: 'concluido', eta: data('2026-11-20') })],
      BASE,
    );
    expect(r.linhas).toEqual([]);
    expect(r.ignoradas).toEqual({ 'status concluido': 2 });
    expect(r.porStatus).toEqual([{ status: 'CONCLUIDO', incluido: false, linhas: 2, kg: 200 }]);
  });

  it('3. ATRAC. AG. LIBERACAO fica de fora mesmo com ETA e ETA FINAL', () => {
    const r = aplicarRegrasFup(
      [
        linha({ status: 'ATRAC. AG. LIBERAÇÃO', kg: 200, eta: data('2026-11-20'), etaFinal: data('2026-11-10') }),
        linha({ status: 'Atrac. ag. liberacao', kg: 50, eta: data('2026-12-05') }),
      ],
      BASE,
    );
    expect(r.linhas).toEqual([]);
    expect(r.excluidas.atracadas).toEqual({ linhas: 2, kg: 250 });
    expect(r.excluidas.etaFinalPreenchida.linhas).toBe(0);
    expect(r.ignoradas).toEqual({ 'atracada aguardando liberacao': 2 });
    expect(r.porStatus).toEqual([{ status: 'ATRAC. AG. LIBERACAO', incluido: false, linhas: 2, kg: 250 }]);
    expect(r.avisos).toEqual([
      'FUP (regra F3): 2 linhas (250 kg) com status ATRAC. AG. LIBERAÇÃO ficaram de fora das chegadas (carga atracada; o estoque já pode contê-la).',
    ]);
  });

  it('4. ETA FINAL preenchida = ja chegou: sai, por status, e conta as com ETA FINAL depois da data base', () => {
    const r = aplicarRegrasFup(
      [
        linha({ status: 'EM TRANSITO', kg: 300, eta: data('2026-12-01'), etaFinal: data('2026-11-10') }),
        linha({ status: 'EM TRANSITO', kg: 100, etaFinal: data('2026-11-20') }), // depois da data base
        linha({ status: 'DESEMBARACO', kg: 40, etd: data('2026-10-01'), etaFinal: data('2026-11-01') }),
      ],
      BASE,
    );
    expect(r.linhas).toEqual([]);
    expect(r.excluidas.etaFinalPreenchida).toEqual({
      linhas: 3,
      kg: 440,
      porStatus: [
        { status: 'EM TRANSITO', linhas: 2, kg: 400 },
        { status: 'DESEMBARACO', linhas: 1, kg: 40 },
      ],
      depoisDaDataBase: { linhas: 1, kg: 100 },
    });
    expect(r.ignoradas).toEqual({ 'eta final preenchida': 3 });
    expect(r.porStatus.every((s) => s.incluido)).toBe(true);
    expect(r.avisos).toEqual([
      'FUP (regra F3): 3 linhas (440 kg) com ETA FINAL preenchida ficaram de fora das chegadas (já chegaram). Por status - EM TRANSITO: 2 (400 kg); DESEMBARACO: 1 (40 kg). Atenção: 1 com ETA FINAL depois da data base.',
    ]);
  });

  it('ETA FINAL com texto invalido e tratada como vazia (e conta data invalida)', () => {
    const r = aplicarRegrasFup(
      [linha({ kg: 70, eta: data('2026-12-10'), etaFinal: { tipo: 'invalida' } })],
      BASE,
    );
    expect(r.linhas).toEqual([{ codigo: 'TST0001', qtd: 70, mes: '12' }]);
    expect(r.avisos).toEqual(['FUP: 1 celula de data com texto invalido foram ignoradas.']);
  });

  it('5. ETA (CHEGADA) vale sem estimada', () => {
    const r = aplicarRegrasFup([linha({ kg: 90, eta: data('2026-12-10'), etd: data('2026-10-01') })], BASE);
    expect(r.linhas).toEqual([{ codigo: 'TST0001', qtd: 90, mes: '12' }]);
    expect('estimada' in r.linhas[0]).toBe(false);
    expect(r.estimadasPorEtd.linhas).toBe(0);
    expect(r.estimadasPorProntidao.linhas).toBe(0);
  });

  it('6. ETD + 35 dias, marcada estimada etd', () => {
    const r = aplicarRegrasFup([linha({ kg: 400, etd: data('2026-12-10'), prontidao: 'SEP 1ST' })], BASE);
    expect(somarDias('2026-12-10', 35)).toBe('2027-01-14');
    expect(r.linhas).toEqual([{ codigo: 'TST0001', qtd: 400, mes: '01', estimada: 'etd' }]);
    expect(r.estimadasPorEtd).toEqual({ linhas: 1, kg: 400 });
    expect(r.estimadasPorProntidao.linhas).toBe(0);
    expect(r.avisos).toEqual([
      'FUP: 1 linha (400 kg) sem ETA (CHEGADA) usaram ETD (EMBARQUE) + 35 dias (ESTIMADA).',
    ]);
  });

  it('7. DATA PRONTIDAO + 35 dias, marcada estimada prontidao', () => {
    const r = aplicarRegrasFup(
      [
        linha({ kg: 600, dataPo: data('2026-09-10'), prontidao: 'OCT 20TH' }), // 2026-10-20 + 35 = 2026-11-24
        linha({ kg: 50, prontidao: '2026-11-30' }), // celula de data: + 35 = 2027-01-04
      ],
      BASE,
    );
    expect(r.linhas).toEqual([
      { codigo: 'TST0001', qtd: 600, mes: '11', estimada: 'prontidao' },
      { codigo: 'TST0001', qtd: 50, mes: '01', estimada: 'prontidao' },
    ]);
    expect(r.estimadasPorProntidao).toEqual({ linhas: 2, kg: 650 });
    expect(r.estimadasPorEtd.linhas).toBe(0);
    expect(r.avisos).toEqual([
      'FUP: 2 linhas (650 kg) sem ETA (CHEGADA) nem ETD (EMBARQUE) usaram DATA PRONTIDÃO + 35 dias (ESTIMADA).',
    ]);
  });

  it('7. prontidao nao reconhecida fica fora, com detalhe; vazia cai em sem data', () => {
    const r = aplicarRegrasFup(
      [
        linha({ linha: 12, status: 'AG. PAGAMENTO (ANT)', codigo: 'TST0009', kg: 800, prontidao: 'ASAP' }),
        linha({ status: 'AG. PRONT. DA CARGA', kg: 30, prontidao: '' }),
      ],
      BASE,
    );
    expect(r.linhas).toEqual([]);
    expect(r.prontidaoNaoReconhecida).toEqual({
      linhas: 1,
      kg: 800,
      detalhes: [{ linha: 12, status: 'AG. PAGAMENTO (ANT)', codigo: 'TST0009', kg: 800, texto: 'ASAP' }],
      omitidos: 0,
    });
    expect(r.semData).toEqual({ linhas: 1, kg: 30, porStatus: [{ status: 'AG. PRONT. DA CARGA', linhas: 1, kg: 30 }] });
    expect(r.ignoradas).toEqual({ 'prontidao nao reconhecida': 1, 'sem data': 1 });
    expect(r.avisos).toEqual([
      'FUP: 1 linha (800 kg) com DATA PRONTIDÃO não reconhecida ficaram de fora das chegadas - confira na pré-visualização.',
      'FUP: 1 linha (30 kg) sem ETA (CHEGADA), ETD (EMBARQUE) nem DATA PRONTIDÃO ficaram de fora das chegadas. Por status - AG. PRONT. DA CARGA: 1 (30 kg).',
    ]);
  });

  it('detalhes limitados: 51 nao reconhecidas -> 50 + omitidos 1; texto longo e cortado', () => {
    const muitas = Array.from({ length: FORECAST_DBCORP_MAX_DETALHES + 1 }, (_, i) =>
      linha({ prontidao: i === 0 ? 'X'.repeat(200) : `STANDBY ${i}`, kg: 10 }),
    );
    const r = aplicarRegrasFup(muitas, BASE);
    expect(r.prontidaoNaoReconhecida.linhas).toBe(51);
    expect(r.prontidaoNaoReconhecida.kg).toBe(510);
    expect(r.prontidaoNaoReconhecida.detalhes).toHaveLength(50);
    expect(r.prontidaoNaoReconhecida.omitidos).toBe(1);
    expect(r.prontidaoNaoReconhecida.detalhes[0].texto).toHaveLength(80);
  });

  it('precedencia ATRAC > ETA FINAL > ETA > ETD > prontidao', () => {
    const todas = {
      eta: data('2026-12-10'),
      etd: data('2026-10-20'),
      dataPo: data('2026-09-10'),
      prontidao: 'SEP 30TH',
    };
    const r = aplicarRegrasFup(
      [
        linha({ ...todas, kg: 1, status: 'ATRAC. AG. LIBERAÇÃO', etaFinal: data('2026-11-01') }),
        linha({ ...todas, kg: 2, etaFinal: data('2026-11-01') }),
        linha({ ...todas, kg: 4 }),
        linha({ ...todas, kg: 8, eta: vazia }),
        linha({ ...todas, kg: 16, eta: vazia, etd: vazia }),
      ],
      BASE,
    );
    expect(r.excluidas.atracadas).toEqual({ linhas: 1, kg: 1 });
    expect(r.excluidas.etaFinalPreenchida.kg).toBe(2);
    expect(r.linhas).toEqual([
      { codigo: 'TST0001', qtd: 4, mes: '12' }, // ETA
      { codigo: 'TST0001', qtd: 8, mes: '11', estimada: 'etd' }, // ETD 2026-10-20 + 35 = 2026-11-24
      { codigo: 'TST0001', qtd: 16, mes: '11', estimada: 'prontidao' }, // 2026-09-30 + 35 = 2026-11-04
    ]);
  });

  it('8. janela: vencida entra no mes base; depois da janela fica de fora', () => {
    const r = aplicarRegrasFup(
      [
        linha({ kg: 600, eta: data('2026-09-10') }), // vencida
        linha({ kg: 910, eta: data('2027-03-31') }), // ultimo mes da janela
        linha({ kg: 900, eta: data('2027-04-01') }), // depois
        linha({ kg: 20, prontidao: 'OCT 20TH', dataPo: data('2026-09-10'), etd: vazia }), // 2026-11-24
      ],
      BASE,
    );
    expect(r.linhas.map((l) => [l.qtd, l.mes])).toEqual([
      [600, '11'],
      [910, '03'],
      [20, '11'],
    ]);
    expect(r.vencidasNoMesBase).toEqual({ linhas: 1, kg: 600 });
    expect(r.depoisDaJanela).toEqual({ linhas: 1, kg: 900 });
  });

  it('lidas = usadas + soma das ignoradas; total = soma das quantidades usadas', () => {
    const r = aplicarRegrasFup(
      [
        linha({ codigo: '' }),
        linha({ status: 'CONCLUÍDO' }),
        linha({ status: 'ATRAC. AG. LIBERAÇÃO' }),
        linha({ etaFinal: data('2026-11-01') }),
        linha({ eta: data('2026-12-01') }),
        linha({ prontidao: 'ASAP' }),
        linha({}),
        linha({ eta: data('2028-01-01') }),
      ],
      BASE,
    );
    expect(r.lidas).toBe(8);
    expect(r.usadas).toBe(1);
    expect(r.lidas).toBe(r.usadas + total(r));
    expect(r.total).toBe(100);
  });
});

describe('comprasEmAbertoDoFup (regra dos pendentes de cadastro)', () => {
  it('concluido (com ou sem acento) fica de fora; atracada, ETA FINAL, sem data e prontidao "ASAP" entram', () => {
    const r = comprasEmAbertoDoFup([
      linha({ codigo: 'TST0001', status: 'CONCLUÍDO', kg: 100 }),
      linha({ codigo: 'TST0001', status: 'concluido', kg: 110 }),
      linha({ codigo: 'TST0001', status: 'ATRAC. AG. LIBERAÇÃO', kg: 200, eta: data('2026-12-05') }),
      linha({ codigo: 'TST0001', kg: 300, etaFinal: data('2026-11-01') }),
      linha({ codigo: 'TST0002', status: 'AG. PAGAMENTO (ANT)', kg: 700 }),
      linha({ codigo: 'TST0003', status: 'AG. PAGAMENTO (ANT)', kg: 40, prontidao: 'ASAP' }),
      linha({ codigo: 'TST0004', kg: 900, eta: data('2028-01-01') }), // depois da janela
    ]);
    expect(r).toEqual([
      { codigo: 'TST0001', qtd: 500 },
      { codigo: 'TST0002', qtd: 700 },
      { codigo: 'TST0003', qtd: 40 },
      { codigo: 'TST0004', qtd: 900 },
    ]);
  });

  it('soma por codigo e ignora linha sem codigo ou com kg nao numerico', () => {
    const r = comprasEmAbertoDoFup([
      linha({ codigo: 'TST0001', kg: 0.1 }),
      linha({ codigo: 'TST0001', kg: 0.2 }),
      linha({ codigo: '', kg: 50 }),
      linha({ codigo: 'TST0002', kg: null }),
      linha({ codigo: 'TST0003', kg: Number.NaN }),
    ]);
    expect(r).toEqual([{ codigo: 'TST0001', qtd: 0.3 }]);
  });

  it('nao depende das datas: as linhas que a F3 deixa de fora das chegadas contam como compra em aberto', () => {
    const linhas = [
      linha({ codigo: 'TST0001', status: 'ATRAC. AG. LIBERAÇÃO', kg: 10 }),
      linha({ codigo: 'TST0001', kg: 20 }), // sem nenhuma data
      linha({ codigo: 'TST0001', kg: 40, eta: data('2026-12-01') }),
    ];
    expect(aplicarRegrasFup(linhas, BASE).linhas.reduce((s, c) => s + c.qtd, 0)).toBe(40);
    expect(comprasEmAbertoDoFup(linhas)).toEqual([{ codigo: 'TST0001', qtd: 70 }]);
  });

  it('nao muta as linhas e devolve [] sem linhas', () => {
    const linhas = [linha({ codigo: 'TST0001', kg: 5 })];
    const copia = JSON.parse(JSON.stringify(linhas));
    comprasEmAbertoDoFup(linhas);
    expect(linhas).toEqual(copia);
    expect(comprasEmAbertoDoFup([])).toEqual([]);
  });
});

describe('prazo das chegadas estimadas por fonte (PR 5A)', () => {
  // Fonte 1: codigos TSTA*; fonte 2: TSTB*; TSTX = sem fonte. Prazos ja resolvidos: fonte 1 = 20/10, fonte 2 = 50/60.
  const prazos = (porFonte: Array<[number, { prontidaoDias: number; etdDias: number }]>): PrazosChegadaFup => ({
    padrao: PRAZO_CHEGADA_PADRAO,
    fonteDoCodigo: new Map([
      ['TSTA1', 1],
      ['TSTA2', 1],
      ['TSTB1', 2],
    ]),
    porFonte: new Map(porFonte),
  });
  const FONTES = prazos([
    [1, { prontidaoDias: 20, etdDias: 10 }],
    [2, { prontidaoDias: 50, etdDias: 60 }],
  ]);

  it('PRONTIDAO: fonte A 20 dias, fonte B 50 dias, sem fonte 35', () => {
    const r = aplicarRegrasFup(
      [
        linha({ codigo: 'TSTA1', kg: 100, prontidao: '2026-10-20' }), // +20 = 2026-11-09
        linha({ codigo: 'TSTB1', kg: 200, prontidao: '2026-10-20' }), // +50 = 2026-12-09
        linha({ codigo: 'TSTX1', kg: 400, prontidao: '2026-10-20' }), // sem fonte: +35 = 2026-11-24
      ],
      BASE,
      FONTES,
    );
    expect(somarDias('2026-10-20', 20)).toBe('2026-11-09');
    expect(somarDias('2026-10-20', 50)).toBe('2026-12-09');
    expect(r.linhas).toEqual([
      { codigo: 'TSTA1', qtd: 100, mes: '11', estimada: 'prontidao' },
      { codigo: 'TSTB1', qtd: 200, mes: '12', estimada: 'prontidao' },
      { codigo: 'TSTX1', qtd: 400, mes: '11', estimada: 'prontidao' },
    ]);
    expect(r.estimadasPorProntidao).toEqual({ linhas: 3, kg: 700 });
    expect(r.estimadasPorFonte).toEqual([
      { fonteId: 1, prontidao: { linhas: 1, kg: 100 }, etd: { linhas: 0, kg: 0 } },
      { fonteId: 2, prontidao: { linhas: 1, kg: 200 }, etd: { linhas: 0, kg: 0 } },
      { fonteId: null, prontidao: { linhas: 1, kg: 400 }, etd: { linhas: 0, kg: 0 } },
    ]);
    // 1 so aviso de estimadas (nao duplica) e cita as 2 fontes com prazo proprio.
    expect(r.avisos).toEqual([
      'FUP: 3 linhas (700 kg) sem ETA (CHEGADA) nem ETD (EMBARQUE) usaram DATA PRONTIDÃO + prazo da fonte (padrão 35 dias; 2 fontes com prazo próprio) (ESTIMADA).',
    ]);
    expect(r.regra.etaPorProntidaoDias).toBe(35);
    expect(r.regra.etaPorEtdDias).toBe(35);
    expect(r.regra.prazoPorFonte).toBe(true);
  });

  it('ETD tambem por fonte; o aviso cita o prazo da fonte (plural e singular)', () => {
    const linhas = [
      linha({ codigo: 'TSTA1', kg: 100, etd: data('2026-12-01') }), // +10 = 2026-12-11
      linha({ codigo: 'TSTB1', kg: 200, etd: data('2026-12-01') }), // +60 = 2027-01-30
      linha({ codigo: 'TSTX1', kg: 400, etd: data('2026-12-01') }), // sem fonte: +35 = 2027-01-05
    ];
    const r = aplicarRegrasFup(linhas, BASE, FONTES);
    expect(r.linhas.map((l) => [l.codigo, l.mes, l.estimada])).toEqual([
      ['TSTA1', '12', 'etd'],
      ['TSTB1', '01', 'etd'],
      ['TSTX1', '01', 'etd'],
    ]);
    expect(r.estimadasPorEtd).toEqual({ linhas: 3, kg: 700 });
    expect(r.avisos).toEqual([
      'FUP: 3 linhas (700 kg) sem ETA (CHEGADA) usaram ETD (EMBARQUE) + prazo da fonte (padrão 35 dias; 2 fontes com prazo próprio) (ESTIMADA).',
    ]);
    const so1 = aplicarRegrasFup(linhas, BASE, prazos([[2, { prontidaoDias: 35, etdDias: 60 }]]));
    expect(so1.avisos).toEqual([
      'FUP: 3 linhas (700 kg) sem ETA (CHEGADA) usaram ETD (EMBARQUE) + prazo da fonte (padrão 35 dias; 1 fonte com prazo próprio) (ESTIMADA).',
    ]);
  });

  it('prazo 0: a chegada e a propria DATA PRONTIDAO / ETD', () => {
    const r = aplicarRegrasFup(
      [
        linha({ codigo: 'TSTA1', kg: 100, prontidao: '2026-11-20' }),
        linha({ codigo: 'TSTA1', kg: 50, etd: data('2026-12-05') }),
      ],
      BASE,
      prazos([[1, { prontidaoDias: 0, etdDias: 0 }]]),
    );
    expect(r.linhas).toEqual([
      { codigo: 'TSTA1', qtd: 100, mes: '11', estimada: 'prontidao' },
      { codigo: 'TSTA1', qtd: 50, mes: '12', estimada: 'etd' },
    ]);
  });

  it('prazo que empurra para depois da janela: a linha sai do calculo, mas continua contada na fonte', () => {
    const r = aplicarRegrasFup(
      [linha({ codigo: 'TSTA1', kg: 300, prontidao: '2026-10-20' })], // +365 = 2027-10-20 > janela (ate 2027-03)
      BASE,
      prazos([[1, { prontidaoDias: 365, etdDias: 35 }]]),
    );
    expect(r.linhas).toEqual([]);
    expect(r.depoisDaJanela).toEqual({ linhas: 1, kg: 300 });
    expect(r.estimadasPorProntidao).toEqual({ linhas: 0, kg: 0 });
    // O conjunto da tabela nao depende dos dias: a fonte continua la, com a linha.
    expect(r.estimadasPorFonte).toEqual([
      { fonteId: 1, prontidao: { linhas: 1, kg: 300 }, etd: { linhas: 0, kg: 0 } },
    ]);
  });

  it('linha com ETA nao depende do prazo: nao entra em estimadasPorFonte', () => {
    const r = aplicarRegrasFup([linha({ codigo: 'TSTA1', kg: 10, eta: data('2026-12-10') })], BASE, FONTES);
    expect(r.estimadasPorFonte).toEqual([]);
    expect(r.linhas).toEqual([{ codigo: 'TSTA1', qtd: 10, mes: '12' }]);
  });

  it('todas as fontes no padrao: aviso e regra iguais ao de hoje (so ganha prazoPorFonte)', () => {
    const linhas = [
      linha({ codigo: 'TSTA1', kg: 100, prontidao: '2026-10-20' }),
      linha({ codigo: 'TSTB1', kg: 50, etd: data('2026-12-10') }),
    ];
    const padrao = aplicarRegrasFup(linhas, BASE);
    const r = aplicarRegrasFup(
      linhas,
      BASE,
      prazos([
        [1, PRAZO_CHEGADA_PADRAO],
        [2, PRAZO_CHEGADA_PADRAO],
      ]),
    );
    expect(r.avisos).toEqual(padrao.avisos);
    expect(r.linhas).toEqual(padrao.linhas);
    expect(r.regra).toEqual({ ...padrao.regra, prazoPorFonte: true });
  });

  it('sem o 3o argumento (ou com o padrao exportado) o resultado e o de hoje: 35 para todos', () => {
    const linhas = [
      linha({ codigo: 'TSTA1', kg: 100, prontidao: '2026-10-20' }),
      linha({ codigo: 'TSTB1', kg: 50, etd: data('2026-12-10') }),
      linha({ codigo: 'TSTX1', kg: 5, eta: data('2026-12-10') }),
    ];
    const a = aplicarRegrasFup(linhas, BASE);
    const b = aplicarRegrasFup(linhas, BASE, PRAZOS_CHEGADA_PADRAO);
    expect(b).toEqual(a);
    expect(a.regra.prazoPorFonte).toBeUndefined();
    expect(a.linhas[0]).toEqual({ codigo: 'TSTA1', qtd: 100, mes: '11', estimada: 'prontidao' });
    expect(PRAZOS_CHEGADA_PADRAO.padrao).toEqual({ prontidaoDias: 35, etdDias: 35 });
  });

  it('nao muta as linhas nem os prazos', () => {
    const linhas = [linha({ codigo: 'TSTA1', kg: 100, prontidao: '2026-10-20' })];
    const copia = JSON.parse(JSON.stringify(linhas));
    aplicarRegrasFup(linhas, BASE, FONTES);
    expect(linhas).toEqual(copia);
    expect([...FONTES.porFonte.keys()]).toEqual([1, 2]);
  });
});

describe('resolverPrazosChegada (precedencia digitado > salvo > padrao)', () => {
  const padrao = { prontidaoDias: 35, etdDias: 35 };

  it('por fonte e por coluna', () => {
    const r = resolverPrazosChegada({
      padrao,
      salvos: [
        { sourceId: 1, prontidaoDias: null, etdDias: null }, // nada salvo: padrao
        { sourceId: 2, prontidaoDias: 50, etdDias: null }, // so prontidao salva
        { sourceId: 3, prontidaoDias: 40, etdDias: 45 }, // tudo salvo
      ],
      editados: [{ sourceId: 3, prontidaoDias: 20, etdDias: 0 }], // digitado vence
    });
    expect(r.get(1)).toEqual({ prontidaoDias: 35, etdDias: 35 });
    expect(r.get(2)).toEqual({ prontidaoDias: 50, etdDias: 35 });
    expect(r.get(3)).toEqual({ prontidaoDias: 20, etdDias: 0 });
  });

  it('editado sem salvo correspondente entra com o digitado; sem nada devolve vazio', () => {
    expect(
      resolverPrazosChegada({ padrao, salvos: [], editados: [{ sourceId: 9, prontidaoDias: 1, etdDias: 2 }] }).get(9),
    ).toEqual({ prontidaoDias: 1, etdDias: 2 });
    expect(resolverPrazosChegada({ padrao, salvos: [], editados: [] }).size).toBe(0);
  });
});

describe('mudancasDePrazo e resumirPrazosEstimativa', () => {
  const padrao = { prontidaoDias: 35, etdDias: 35 };
  const fontes = [
    { sourceId: 1, nome: 'FONTE 001', salvo: { prontidaoDias: null, etdDias: null } },
    { sourceId: 2, nome: 'FONTE 002', salvo: { prontidaoDias: 50, etdDias: null } },
    { sourceId: 3, nome: 'FONTE 003', salvo: { prontidaoDias: 40, etdDias: 45 } },
  ];

  it('so as fontes pedidas cujo valor usado difere de salvo ?? padrao; so a coluna que mudou', () => {
    const porFonte = new Map([
      [1, { prontidaoDias: 35, etdDias: 35 }], // igual ao padrao: nada
      [2, { prontidaoDias: 50, etdDias: 20 }], // so ETD mudou
      [3, { prontidaoDias: 35, etdDias: 45 }], // 40 -> 35: volta ao padrao mas DIFERE do salvo
    ]);
    expect(mudancasDePrazo({ padrao, fontes, porFonte, sourceIds: [1, 2, 3] })).toEqual([
      { sourceId: 2, arrivalFromEtdDays: 20 },
      { sourceId: 3, arrivalFromReadinessDays: 35 },
    ]);
    // fonte fora do corpo nao e gravada, mesmo que difira
    expect(mudancasDePrazo({ padrao, fontes, porFonte, sourceIds: [2] })).toEqual([
      { sourceId: 2, arrivalFromEtdDays: 20 },
    ]);
    expect(mudancasDePrazo({ padrao, fontes, porFonte, sourceIds: [] })).toEqual([]);
  });

  it('resumo: so fontes com linha estimada, ordem kg desc, sem fonte somado, usado x salvo', () => {
    const porFonte = new Map([
      [1, { prontidaoDias: 35, etdDias: 35 }],
      [2, { prontidaoDias: 60, etdDias: 35 }],
      [3, { prontidaoDias: 40, etdDias: 45 }],
    ]);
    const zero = { linhas: 0, kg: 0 };
    const r = resumirPrazosEstimativa({
      padrao,
      fontes,
      porFonte,
      estimadasPorFonte: [
        { fonteId: 1, prontidao: { linhas: 1, kg: 100 }, etd: zero },
        { fonteId: 2, prontidao: { linhas: 2, kg: 500 }, etd: { linhas: 1, kg: 50 } },
        { fonteId: null, prontidao: { linhas: 1, kg: 7 }, etd: zero },
        { fonteId: 99, prontidao: zero, etd: { linhas: 1, kg: 3 } }, // fonte desconhecida cai em "sem fonte"
      ],
      padroesAlterados: 1,
    });
    expect(r.fontes.map((f) => f.sourceId)).toEqual([2, 1]); // 3 nao tem linha estimada: fora
    expect(r.fontes[0]).toEqual({
      sourceId: 2,
      nome: 'FONTE 002',
      salvo: { prontidaoDias: 50, etdDias: null },
      usado: { prontidaoDias: 60, etdDias: 35 },
      prontidao: { linhas: 2, kg: 500 },
      etd: { linhas: 1, kg: 50 },
    });
    expect(r.semFonte).toEqual({ prontidao: { linhas: 1, kg: 7 }, etd: { linhas: 1, kg: 3 } });
    expect(r.padrao).toEqual(padrao);
    expect(r.padroesAlterados).toBe(1);
  });
});
