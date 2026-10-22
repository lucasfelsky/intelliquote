import { describe, expect, it } from 'vitest';
import { ForecastLocalError, type ForecastDbcorpSlot, type ForecastRelatorioResumo } from '@/services/forecast';
import {
  avisosSemRedundancia,
  bytesDoCorpo,
  checarArquivos,
  checarCorpo,
  checarTamanhos,
  dataBaseValida,
  diasDaRegraFup,
  extensaoOk,
  faltando,
  kgEmAberto,
  lerCorpoDbcorp,
  lerCorpoPlanilha,
  mesAno,
  montarCorpoDbcorp,
  montarCorpoPlanilha,
  percentualSemData,
  prontidaoPendente,
  readFileAsBase64,
  rotuloDaQuinzena,
  rotuloDoMotivo,
  slotsSemLinhasUteis,
  SLOTS_DBCORP,
  tamanhoBase64,
  textoEntendiProntidao,
  totaisDeposito,
} from './forecastImport';

// Dados 100% sinteticos.
const MB = 1024 * 1024;
const arquivo = { fileName: 'teste.xlsx', contentBase64: 'AQID' };

function relatorio(usadas: number, over: Partial<ForecastRelatorioResumo> = {}): ForecastRelatorioResumo {
  return {
    fileName: 'teste.xlsx',
    lidas: 10,
    usadas,
    ignoradas: {},
    total: 100,
    avisos: [],
    erros: [],
    totalCasado: null,
    codigosSemProduto: null,
    ...over,
  };
}

describe('rotulo e data-base', () => {
  it('rotulo derivado: mes da data-base + quinzena', () => {
    expect(rotuloDaQuinzena('2026-10-15', 2)).toBe('10-2');
    expect(rotuloDaQuinzena('2027-01-05', 1)).toBe('01-1');
  });

  it('sem data valida ou sem quinzena o rotulo e vazio', () => {
    expect(rotuloDaQuinzena('', 1)).toBe('');
    expect(rotuloDaQuinzena('2026-13-01', 1)).toBe('');
    expect(rotuloDaQuinzena('2026-10-15', null)).toBe('');
  });

  it('dataBaseValida confere dias do mes e bissexto', () => {
    expect(dataBaseValida('2026-02-29')).toBe(false);
    expect(dataBaseValida('2028-02-29')).toBe(true);
    expect(dataBaseValida('2100-02-29')).toBe(false);
    expect(dataBaseValida('2026-13-01')).toBe(false);
    expect(dataBaseValida('2026-04-31')).toBe(false);
    expect(dataBaseValida('2026-12-15')).toBe(true);
    expect(dataBaseValida('')).toBe(false);
    expect(dataBaseValida('15/12/2026')).toBe(false);
  });

  it('mesAno', () => {
    expect(mesAno('2026-09')).toBe('09/2026');
    expect(mesAno(null)).toBe('—');
    expect(mesAno('lixo')).toBe('—');
  });
});

describe('slots obrigatorios', () => {
  const todos: Partial<Record<ForecastDbcorpSlot, unknown>> = {
    saldo: 1,
    vendasMes: 1,
    vendasAnual: 1,
    programacao: 1,
    fup: 1,
  };

  it('tem os 8 slots na ordem do backend', () => {
    expect(SLOTS_DBCORP.map((s) => s.id)).toEqual([
      'saldo',
      'vendasMes',
      'vendasAtual',
      'vendasAnual',
      'programacao',
      'fup',
      'clientesAtivos',
      'margem',
    ]);
  });

  it('1a quinzena: vendasAtual e opcional', () => {
    expect(faltando(todos, 1)).toEqual([]);
    expect(faltando({}, 1)).toEqual(['saldo', 'vendasMes', 'vendasAnual', 'programacao', 'fup']);
  });

  it('2a quinzena: vendasAtual e obrigatorio', () => {
    expect(faltando(todos, 2)).toEqual(['vendasAtual']);
    expect(faltando({ ...todos, vendasAtual: 1 }, 2)).toEqual([]);
  });
});

describe('limite de 10 MB', () => {
  it('tamanhoBase64', () => {
    expect([0, 1, 3, 4].map(tamanhoBase64)).toEqual([0, 4, 4, 8]);
  });

  it('extensaoOk', () => {
    expect(extensaoOk('A.XLSX')).toBe(true);
    expect(extensaoOk('a.xlsx')).toBe(true);
    expect(extensaoOk('a.xls')).toBe(false);
    expect(extensaoOk('a.xlsx.exe')).toBe(false);
  });

  it('um arquivo acima do limite por arquivo', () => {
    const msg = checarTamanhos([{ rotulo: 'SALDO', file: { name: 'saldo-teste.xlsx', size: 8 * MB } }]);
    expect(msg).toBe('O arquivo SALDO (saldo-teste.xlsx) passa do limite de 10 MB depois da codificação.');
  });

  it('dois arquivos que so juntos passam do total', () => {
    const msg = checarTamanhos([
      { rotulo: 'SALDO', file: { name: 'a.xlsx', size: 4 * MB } },
      { rotulo: 'FUP', file: { name: 'b.xlsx', size: 4 * MB } },
    ]);
    expect(msg).toBe(
      'Os arquivos somam 10,7 MB depois da codificação; o limite é 10 MB no total. Envie relatórios menores.',
    );
  });

  it('abaixo do limite devolve null', () => {
    expect(checarTamanhos([{ rotulo: 'SALDO', file: { name: 'a.xlsx', size: 1 * MB } }])).toBeNull();
    expect(checarTamanhos([])).toBeNull();
  });

  it('checarArquivos: extensao, vazio e limite, nesta ordem', () => {
    expect(checarArquivos([{ rotulo: 'SALDO', file: { name: 'a.xls', size: 0 } }])).toBe(
      'Envie o relatório SALDO em .xlsx.',
    );
    expect(checarArquivos([{ rotulo: '', file: { name: 'a.csv', size: 5 } }])).toBe('Envie a planilha em .xlsx.');
    expect(checarArquivos([{ rotulo: 'FUP', file: { name: 'vazio.xlsx', size: 0 } }])).toBe(
      'O arquivo vazio.xlsx está vazio.',
    );
    expect(checarArquivos([{ rotulo: 'FUP', file: { name: 'ok.xlsx', size: 10 } }])).toBeNull();
  });

  it('o corpo exato e medido em bytes UTF-8', () => {
    expect(bytesDoCorpo({ a: 'ç' })).toBe(new TextEncoder().encode('{"a":"ç"}').length);
    expect(checarCorpo({ a: 'x' })).toBeNull();
    expect(checarCorpo({ a: 'x'.repeat(10 * MB) })).toMatch(/^Os arquivos somam 10,0 MB/);
  });
});

describe('corpos', () => {
  it('planilha leva so os 4 campos do contrato', () => {
    expect(montarCorpoPlanilha('p.xlsx', 'AQID', '10-2', '2026-10-15')).toEqual({
      contentBase64: 'AQID',
      fileName: 'p.xlsx',
      label: '10-2',
      baseDate: '2026-10-15',
    });
  });

  it('DBCorp sem clientesAtivos/margem nao gera as chaves', () => {
    const corpo = montarCorpoDbcorp('10-1', '2026-10-05', {
      saldo: arquivo,
      vendasMes: arquivo,
      vendasAnual: arquivo,
      programacao: arquivo,
      fup: arquivo,
    });
    expect(Object.keys(corpo)).toEqual(['label', 'baseDate', 'files']);
    expect(Object.keys(corpo.files)).toEqual(['saldo', 'vendasMes', 'vendasAnual', 'programacao', 'fup']);
    expect('clientesAtivos' in corpo.files).toBe(false);
    expect('margem' in corpo.files).toBe(false);
    expect('vendasAtual' in corpo.files).toBe(false);
  });

  it('readFileAsBase64 devolve o base64 sem o prefixo data:', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'saldo-teste.xlsx');
    await expect(readFileAsBase64(file)).resolves.toBe('AQID');
  });
});

describe('slotsSemLinhasUteis (decidido pelos numeros)', () => {
  it('lista saldo, vendasAnual, vendasAtual e fup com usadas = 0; vendasMes nao entra', () => {
    const lista = slotsSemLinhasUteis({
      relatorios: {
        saldo: relatorio(0),
        vendasMes: relatorio(0),
        vendasAtual: relatorio(0),
        vendasAnual: relatorio(0),
        programacao: relatorio(5),
        fup: relatorio(0),
      },
    });
    expect(lista).toEqual(['saldo', 'vendasAtual', 'vendasAnual', 'fup']);
  });

  it('programacao, clientesAtivos e margem vazios tambem entram', () => {
    const lista = slotsSemLinhasUteis({
      relatorios: { programacao: relatorio(0), clientesAtivos: relatorio(0), margem: relatorio(0) },
    });
    expect(lista).toEqual(['programacao', 'clientesAtivos', 'margem']);
  });

  it('slot ausente e ignorado', () => {
    expect(slotsSemLinhasUteis({ relatorios: { saldo: relatorio(3) } })).toEqual([]);
    expect(slotsSemLinhasUteis({ relatorios: {} })).toEqual([]);
  });

  it('aviso "sem linhas" no texto, mas usadas > 0: nao trava', () => {
    const lista = slotsSemLinhasUteis({
      relatorios: { vendasAnual: relatorio(2, { avisos: ['Relatorio VENDAS anual sem linhas validas.'] }) },
    });
    expect(lista).toEqual([]);
  });
});

describe('leitura do resumo', () => {
  it('rotuloDoMotivo: conhecido com acento e desconhecido cru', () => {
    expect(rotuloDoMotivo('sem codigo')).toBe('sem código');
    expect(rotuloDoMotivo('quantidade nao numerica')).toBe('quantidade não numérica');
    expect(rotuloDoMotivo('deposito excluido')).toBe('depósito excluído');
    expect(rotuloDoMotivo('status concluido')).toBe('status concluído');
    expect(rotuloDoMotivo('sem data de faturamento valida')).toBe('sem data de faturamento válida');
    expect(rotuloDoMotivo('fora da janela (antes do mes base)')).toBe('fora da janela (antes do mês base)');
    expect(rotuloDoMotivo('outra empresa')).toBe('outra empresa');
    expect(rotuloDoMotivo('atracada aguardando liberacao')).toBe('atracada aguardando liberação');
    expect(rotuloDoMotivo('eta final preenchida')).toBe('ETA FINAL preenchida (já chegou)');
    expect(rotuloDoMotivo('prontidao nao reconhecida')).toBe('DATA PRONTIDÃO não reconhecida');
    expect(rotuloDoMotivo('motivo novo qualquer')).toBe('motivo novo qualquer');
  });

  it('totaisDeposito separa incluido e excluido', () => {
    expect(
      totaisDeposito([
        { incluido: true, saldo: 100 },
        { incluido: true, saldo: 50 },
        { incluido: false, saldo: 30 },
      ]),
    ).toEqual({ incluido: 150, excluido: 30 });
    expect(totaisDeposito([])).toEqual({ incluido: 0, excluido: 0 });
  });

  it('kgEmAberto soma so os status que entram', () => {
    expect(
      kgEmAberto([
        { incluido: true, kg: 1000 },
        { incluido: false, kg: 500 },
        { incluido: true, kg: 250 },
      ]),
    ).toBe(1250);
  });

  it('percentualSemData: inteiro; em aberto 0 = null', () => {
    expect(percentualSemData({ kg: 250 }, 1000)).toBe(25);
    expect(percentualSemData({ kg: 1 }, 3)).toBe(33);
    expect(percentualSemData({ kg: 250 }, 0)).toBeNull();
  });
});

describe('regra F3 do FUP no resumo', () => {
  const regra = { id: 'F3', etaPorEtdDias: 35, etaPorProntidaoDias: 40, excluiEtaFinal: true, statusExcluidos: ['X'] };

  it('diasDaRegraFup: dias do backend; backend antigo (sem regra) cai em 35/35', () => {
    expect(diasDaRegraFup(regra)).toEqual({ etd: 35, prontidao: 40 });
    expect(diasDaRegraFup(undefined)).toEqual({ etd: 35, prontidao: 35 });
  });

  it('prontidaoPendente: linhas e kg; ausente ou zero = null', () => {
    const detalhes: never[] = [];
    const com = relatorio(5, { prontidaoNaoReconhecida: { linhas: 2, kg: 840, detalhes, omitidos: 0 } });
    expect(prontidaoPendente({ relatorios: { fup: com } })).toEqual({ linhas: 2, kg: 840 });
    const zero = relatorio(5, { prontidaoNaoReconhecida: { linhas: 0, kg: 0, detalhes, omitidos: 0 } });
    expect(prontidaoPendente({ relatorios: { fup: zero } })).toBeNull();
    expect(prontidaoPendente({ relatorios: { fup: relatorio(5) } })).toBeNull();
    expect(prontidaoPendente({ relatorios: {} })).toBeNull();
  });
});

describe('leitura dos arquivos escolhidos', () => {
  const pequeno = (nome: string) => new File([new Uint8Array([1, 2, 3])], nome);

  it('lerCorpoPlanilha devolve o corpo do contrato', async () => {
    await expect(lerCorpoPlanilha(pequeno('p.xlsx'), '12-2', '2026-12-15')).resolves.toEqual({
      contentBase64: 'AQID',
      fileName: 'p.xlsx',
      label: '12-2',
      baseDate: '2026-12-15',
    });
  });

  it('lerCorpoPlanilha recusa extensao errada sem ler o arquivo', async () => {
    await expect(lerCorpoPlanilha(pequeno('p.csv'), '12-2', '2026-12-15')).rejects.toBeInstanceOf(ForecastLocalError);
  });

  it('lerCorpoDbcorp le so os slots escolhidos, na ordem do contrato', async () => {
    const corpo = await lerCorpoDbcorp({ fup: pequeno('fup.xlsx'), saldo: pequeno('saldo.xlsx') }, '12-1', '2026-12-05');
    expect(Object.keys(corpo.files)).toEqual(['saldo', 'fup']);
    expect(corpo.files.saldo).toEqual({ fileName: 'saldo.xlsx', contentBase64: 'AQID' });
  });

  it('lerCorpoDbcorp aponta o relatorio com extensao errada', async () => {
    await expect(lerCorpoDbcorp({ saldo: pequeno('saldo.xls') }, '12-1', '2026-12-05')).rejects.toThrow(
      'Envie o relatório SALDO em .xlsx.',
    );
  });
});

describe('ajustes do 3A (3B-2): em aberto sem ETA FINAL, singular e aviso unico', () => {
  const porStatus = [
    { incluido: true, kg: 1000 },
    { incluido: false, kg: 500 },
    { incluido: true, kg: 250 },
  ];

  it('kgEmAberto subtrai as linhas com ETA FINAL preenchida (excluidas pela F3)', () => {
    expect(kgEmAberto(porStatus, 400)).toBe(850);
    expect(kgEmAberto(porStatus, 0)).toBe(1250);
    // Sem o segundo argumento (backend antigo, sem `excluidas`): igual ao comportamento anterior.
    expect(kgEmAberto(porStatus)).toBe(1250);
  });

  it('kgEmAberto nunca fica negativo', () => {
    expect(kgEmAberto(porStatus, 5000)).toBe(0);
    expect(kgEmAberto([], 10)).toBe(0);
  });

  it('o % do em aberto usa o em aberto SEM as linhas com ETA FINAL', () => {
    // 250 kg sem data: 25% de 1000 (so as 600 de ETA FINAL fora do total de 1600).
    expect(percentualSemData({ kg: 250 }, kgEmAberto([{ incluido: true, kg: 1600 }], 600))).toBe(25);
    // Sem o ajuste seria 16%.
    expect(percentualSemData({ kg: 250 }, kgEmAberto([{ incluido: true, kg: 1600 }]))).toBe(16);
  });

  it('textoEntendiProntidao: 1 linha no singular, varias no plural', () => {
    const fmt = (n: number) => String(n);
    expect(textoEntendiProntidao({ linhas: 1, kg: 300 }, fmt)).toBe(
      'Entendi que 1 linha (300 kg) do FUP com DATA PRONTIDÃO não reconhecida fica fora das chegadas.',
    );
    expect(textoEntendiProntidao({ linhas: 4, kg: 300 }, fmt)).toBe(
      'Entendi que 4 linhas (300 kg) do FUP com DATA PRONTIDÃO não reconhecida ficam fora das chegadas.',
    );
  });

  it('avisosSemRedundancia: sem a coluna DATA PRONTIDAO o aviso de DATA PO ausente some', () => {
    const prontidao = 'FUP: coluna "DATA PRONTIDÃO" não encontrada - linhas sem ETA nem ETD ficam de fora.';
    const dataPo = 'FUP: coluna "DATA PO" não encontrada - o ano da DATA PRONTIDÃO usa a data base.';
    const outro = 'FUP: 2 linhas (100 kg) sem ETA (CHEGADA) usaram ETD (EMBARQUE) + 35 dias (ESTIMADA).';
    expect(avisosSemRedundancia([outro, prontidao, dataPo])).toEqual([outro, prontidao]);
    expect(avisosSemRedundancia([dataPo, prontidao])).toEqual([prontidao]);
    // So a DATA PO ausente (prontidao presente): o aviso continua, ele informa algo.
    expect(avisosSemRedundancia([outro, dataPo])).toEqual([outro, dataPo]);
    expect(avisosSemRedundancia([])).toEqual([]);
  });
});
