import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import exceljs from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  FORECAST_DBCORP_DEPOSITOS_EXCLUIDOS,
  FORECAST_DBCORP_SEM_DEPOSITO,
} from '../src/constants/forecast';
import {
  dateKeyDaCelula,
  normalizeDbcorpText,
  parseClientesAtivos,
  parseFup,
  parseMargem,
  parseProgramacao,
  parseSaldo,
  parseVendas,
  type ResumoRelatorio,
} from '../src/utils/forecastDbcorp';

// Workbooks gerados em memoria com os MESMOS cabecalhos dos relatorios e dados sinteticos
// (o repositorio e publico: nenhum nome, codigo ou quantidade real).

const BASE = '2026-11-15';

type Cell = string | number | Date | null;

async function xlsx(
  headers: string[],
  rows: Cell[][],
  options: { headerRow?: number; sheetName?: string } = {},
): Promise<Buffer> {
  const headerRow = options.headerRow ?? 1;
  const workbook = new exceljs.Workbook();
  const ws = workbook.addWorksheet(options.sheetName ?? 'Sheet');
  for (let r = 1; r < headerRow; r++) ws.getCell(r, 1).value = `titulo do relatorio ${r}`;
  headers.forEach((h, i) => (ws.getCell(headerRow, i + 1).value = h));
  rows.forEach((row, ri) =>
    row.forEach((value, ci) => {
      if (value !== null) ws.getCell(headerRow + 1 + ri, ci + 1).value = value;
    }),
  );
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const d = (key: string): Date => {
  const [y, m, day] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
};

const ignoradasTotal = (r: ResumoRelatorio) => Object.values(r.ignoradas).reduce((a, b) => a + b, 0);

const SALDO_HEADERS = [
  'Código',
  'Descrição',
  'Depósito',
  'Unidade',
  'Saldo Físico Disponível',
  'Saldo Ped. Venda',
  'Saldo Final',
  'Empresa',
];

function saldoRow(codigo: string, deposito: string | null, saldo: number | string, empresa = 'SQ QUIMICA'): Cell[] {
  return [codigo, `Produto ${codigo}`, deposito, 'KG', saldo, 0, saldo, empresa];
}

describe('normalizeDbcorpText / dateKeyDaCelula', () => {
  it('normaliza acento, espacos e caixa', () => {
    expect(normalizeDbcorpText('  Correção   de  estoque ')).toBe('CORRECAO DE ESTOQUE');
    expect(normalizeDbcorpText('Separação')).toBe('SEPARACAO');
  });

  it('data: date key, dd/mm/aaaa, vazio e invalida', () => {
    expect(dateKeyDaCelula('2026-12-05')).toEqual({ tipo: 'data', key: '2026-12-05' });
    expect(dateKeyDaCelula(' 05/12/2026 ')).toEqual({ tipo: 'data', key: '2026-12-05' });
    expect(dateKeyDaCelula('5/1/2027')).toEqual({ tipo: 'data', key: '2027-01-05' });
    expect(dateKeyDaCelula(null)).toEqual({ tipo: 'vazia' });
    expect(dateKeyDaCelula(' ')).toEqual({ tipo: 'vazia' });
    expect(dateKeyDaCelula('31/02/2026')).toEqual({ tipo: 'invalida' });
    expect(dateKeyDaCelula('a definir')).toEqual({ tipo: 'invalida' });
    expect(dateKeyDaCelula(45000)).toEqual({ tipo: 'invalida' });
  });
});

describe('parseSaldo', () => {
  it('so a empresa da regra; exclui os depositos da nota (grafias, acento e caixa); vazio entra', async () => {
    const rows: Cell[][] = [
      saldoRow('tst0001 ', 'DEPOSITO TESTE', 100),
      saldoRow('TST0002', ' ', 20), // deposito so com espaco
      saldoRow('TST0003', null, 5), // deposito ausente
      saldoRow('TST0004', 'laboratorio - amostra', 10),
      saldoRow('TST0004', 'LAB - AMOSTRA', 11),
      saldoRow('TST0004', 'Separacao', 12),
      saldoRow('TST0004', 'SEPARAÇÃO', 13),
      saldoRow('TST0004', 'Correção', 14),
      saldoRow('TST0004', 'qualidade sul', 15),
      saldoRow('TST0005', 'DEPOSITO TESTE', 1000, 'OUTRA EMPRESA'),
      saldoRow('TST0006', 'DEPOSITO TESTE', 'n/d'), // quantidade nao numerica
      saldoRow('', 'DEPOSITO TESTE', 7), // sem codigo
    ];
    const r = await parseSaldo(await xlsx(SALDO_HEADERS, rows));

    expect(r.erros).toEqual([]);
    expect(r.linhas).toEqual([
      { codigo: 'TST0001', qtd: 100 },
      { codigo: 'TST0002', qtd: 20 },
      { codigo: 'TST0003', qtd: 5 },
    ]);
    expect(r.usadas).toBe(3);
    expect(r.total).toBe(125);
    expect(r.ignoradas).toEqual({
      'deposito excluido': 6,
      'outra empresa': 1,
      'quantidade nao numerica': 1,
      'sem codigo': 1,
    });
    expect(r.lidas).toBe(r.usadas + ignoradasTotal(r));

    const incluidos = r.porDeposito.filter((x) => x.incluido);
    expect(incluidos.map((x) => [x.deposito, x.saldo])).toEqual([
      ['DEPOSITO TESTE', 100],
      [FORECAST_DBCORP_SEM_DEPOSITO, 25],
    ]);
    const excluidos = r.porDeposito.filter((x) => !x.incluido);
    expect(excluidos.map((x) => x.deposito).sort()).toEqual(
      ['CORRECAO', 'LAB - AMOSTRA', 'LABORATORIO - AMOSTRA', 'QUALIDADE SUL', 'SEPARACAO'].sort(),
    );
    expect(excluidos.find((x) => x.deposito === 'SEPARACAO')).toMatchObject({ linhas: 2, saldo: 25 });
    // Soma de porDeposito = total da empresa (incluidos + excluidos).
    const somaDepositos = r.porDeposito.reduce((acc, x) => acc + x.saldo, 0);
    expect(somaDepositos).toBe(125 + 10 + 11 + 12 + 13 + 14 + 15);
    expect(r.outrasEmpresas).toEqual([{ empresa: 'OUTRA EMPRESA', linhas: 1, saldo: 1000 }]);
  });

  it('cada deposito da constante e excluido', async () => {
    const rows = FORECAST_DBCORP_DEPOSITOS_EXCLUIDOS.map((deposito, i) => saldoRow(`TST${i}`, deposito, 1));
    rows.push(saldoRow('TSTOK', 'DEPOSITO TESTE', 3));
    const r = await parseSaldo(await xlsx(SALDO_HEADERS, rows));
    expect(r.linhas).toEqual([{ codigo: 'TSTOK', qtd: 3 }]);
    expect(r.ignoradas['deposito excluido']).toBe(FORECAST_DBCORP_DEPOSITOS_EXCLUIDOS.length);
  });

  it('cabecalho na linha 1 e na linha 5 funcionam', async () => {
    const rows = [saldoRow('TST0001', 'DEPOSITO TESTE', 8)];
    const na1 = await parseSaldo(await xlsx(SALDO_HEADERS, rows, { headerRow: 1 }));
    const na5 = await parseSaldo(await xlsx(SALDO_HEADERS, rows, { headerRow: 5, sheetName: 'Itens' }));
    expect(na1.linhas).toEqual([{ codigo: 'TST0001', qtd: 8 }]);
    expect(na5.linhas).toEqual(na1.linhas);
    expect(na5.erros).toEqual([]);
  });

  it('coluna obrigatoria ausente -> erro com o nome da coluna', async () => {
    const headers = SALDO_HEADERS.filter((h) => h !== 'Saldo Físico Disponível');
    const r = await parseSaldo(await xlsx(headers, [['TST0001', 'x', 'DEPOSITO TESTE', 'KG', 0, 0, 'SQ QUIMICA']]));
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0]).toMatch(/SALDO/);
    expect(r.erros[0]).toContain('"Saldo Físico Disponível"');
    expect(r.linhas).toEqual([]);
  });

  it('arquivo que nao e xlsx -> 400', async () => {
    await expect(parseSaldo(Buffer.from('isto nao e um xlsx'))).rejects.toMatchObject({ status: 400 });
  });
});

describe('parseVendas', () => {
  const HEADERS = ['Descr. Item', 'Item', 'Unid. Medida', 'Quantidade ', 'Empresa'];

  it('cabecalho com espaco no fim; rodape e linhas invalidas ignorados e contados', async () => {
    const r = await parseVendas(
      await xlsx(HEADERS, [
        ['Produto A', 'tst0001', 'KG', 40, 'SQ QUIMICA'],
        ['Produto A', 'TST0001', 'KG', 20, 'SQ QUIMICA'],
        ['Produto B', 'TST0002', 'KG', 'n/d', 'SQ QUIMICA'],
        [null, null, null, 'Soma = 1.234,00', null],
      ]),
      'vendasMes',
    );
    expect(r.erros).toEqual([]);
    expect(r.linhas).toEqual([
      { codigo: 'TST0001', qtd: 40 },
      { codigo: 'TST0001', qtd: 20 },
    ]);
    expect(r.usadas).toBe(2);
    expect(r.total).toBe(60);
    expect(r.ignoradas).toEqual({ 'quantidade nao numerica': 1, 'sem codigo': 1 });
    expect(r.empresas).toEqual(['SQ QUIMICA']);
    expect(r.avisos).toEqual([]);
  });

  it('mais de uma empresa -> aviso (sem filtro, tudo soma)', async () => {
    const r = await parseVendas(
      await xlsx(HEADERS, [
        ['P', 'TST0001', 'KG', 10, 'SQ QUIMICA'],
        ['P', 'TST0001', 'KG', 5, 'OUTRA EMPRESA'],
      ]),
      'vendasAnual',
    );
    expect(r.total).toBe(15);
    expect(r.empresas).toEqual(['OUTRA EMPRESA', 'SQ QUIMICA']);
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toMatch(/mais de uma empresa/);
  });

  it('slot do mes anterior sem linhas validas -> erro; os demais slots so avisam', async () => {
    const vazio = await xlsx(HEADERS, [[null, null, null, 'Soma = 0,00', null]]);
    const mes = await parseVendas(vazio, 'vendasMes');
    expect(mes.usadas).toBe(0);
    expect(mes.erros).toEqual(['Relatorio de vendas do mes anterior sem linhas validas.']);
    const atual = await parseVendas(vazio, 'vendasAtual');
    expect(atual.erros).toEqual([]);
    expect(atual.avisos).toHaveLength(1);
  });

  it('coluna ausente -> erro com relatorio e coluna', async () => {
    const r = await parseVendas(await xlsx(['Item', 'Empresa'], [['TST0001', 'SQ QUIMICA']]), 'vendasAtual');
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0]).toContain('"Quantidade"');
    expect(r.erros[0]).toMatch(/mes atual/);
  });
});

describe('parseProgramacao', () => {
  const HEADERS = ['Orçamento', 'Cliente/Prospect', 'Status', 'Data Faturamento', 'Cód. Item', 'Qtde.'];
  const row = (status: string, data: Cell, codigo: string, qtd: number): Cell[] => [1, 'Cliente teste', status, data, codigo, qtd];

  it('so Pendente, com a janela de 4 meses por YYYY-MM', async () => {
    const r = await parseProgramacao(
      await xlsx(HEADERS, [
        row('Pendente', d('2026-11-20'), 'tst0001', 10), // mes base
        row('pendente', d('2027-02-10'), 'TST0001', 20), // ultimo mes da janela
        row('Pendente', d('2026-10-30'), 'TST0001', 30), // antes
        row('Pendente', d('2027-03-01'), 'TST0001', 40), // depois
        row('Pendente', d('2027-11-20'), 'TST0001', 50), // 12 meses a frente: mesmo MM do mes base
        row('Aprovado', d('2026-11-20'), 'TST0001', 60),
        row('Reprovado', d('2026-11-21'), 'TST0001', 70),
        row('Pendente', null, 'TST0001', 80), // sem data
        row('Pendente', 'sem previsao', 'TST0001', 90), // texto invalido
      ]),
      BASE,
    );
    expect(r.erros).toEqual([]);
    expect(r.linhas).toEqual([
      { codigo: 'TST0001', qtd: 10, mes: '11' },
      { codigo: 'TST0001', qtd: 20, mes: '02' },
    ]);
    expect(r.foraDaJanela).toEqual({ antes: 1, depois: 2 });
    expect(r.ignoradas).toEqual({
      'status diferente de Pendente': 2,
      'fora da janela (antes do mes base)': 1,
      'fora da janela (depois dos 4 meses)': 2,
      'sem data de faturamento valida': 2,
    });
    expect(r.lidas).toBe(r.usadas + ignoradasTotal(r));
    expect(r.porStatus.find((s) => s.status === 'APROVADO')).toMatchObject({ incluido: false, linhas: 1, qtd: 60 });
    expect(r.porStatus.find((s) => s.status === 'PENDENTE')).toMatchObject({ incluido: true, linhas: 7 });
    expect(r.avisos.join(' ')).toMatch(/antes do mes base/);
  });

  it('coluna ausente -> erro', async () => {
    const r = await parseProgramacao(await xlsx(['Status', 'Cód. Item', 'Qtde.'], [['Pendente', 'TST0001', 1]]), BASE);
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0]).toContain('"Data Faturamento"');
  });
});

describe('parseFup', () => {
  const HEADERS = [
    'STATUS',
    'EXPORTADOR',
    'PO',
    'CÓD. SQ',
    'QTD - KGS',
    'ETD (EMBARQUE)',
    'ETA (CHEGADA)',
    'ETA FINAL',
    'STATUS NF',
    'DATA PO',
    'DATA PRONTIDÃO',
  ];
  const row = (
    status: string,
    codigo: string,
    kg: number,
    etd: Cell,
    eta: Cell,
    etaFinal: Cell,
    dataPo: Cell = null,
    prontidao: Cell = null,
  ): Cell[] => [status, 'Exportador teste', 'PO-1', codigo, kg, etd, eta, etaFinal, null, dataPo, prontidao];
  const vazio = ' ';

  it('regra F3: ATRAC e ETA FINAL ficam fora; ETA > ETD + 35 > DATA PRONTIDAO + 35; sem data fora', async () => {
    const r = await parseFup(
      await xlsx(HEADERS, [
        row('CONCLUÍDO', 'TST0001', 100, vazio, d('2026-11-20'), vazio),
        row('CONCLUIDO', 'TST0001', 110, vazio, d('2026-11-20'), vazio),
        row('ATRAC. AG. LIBERAÇÃO', 'tst0001', 200, vazio, d('2026-12-05'), vazio), // F3: fica fora
        row('EM TRANSITO', 'TST0001', 300, d('2026-10-01'), d('2026-12-01'), d('2026-11-10')), // ETA FINAL: ja chegou
        row('EM TRANSITO', 'TST0001', 310, vazio, vazio, d('2026-12-20')), // ETA FINAL depois da data base
        row('AG. EMBARQUE', 'TST0001', 400, d('2026-12-10'), vazio, vazio), // 2026-12-10 + 35 = 2027-01-14
        row('AG. EMBARQUE', 'TST0001', 500, d('2026-12-30'), vazio, vazio), // vira o ano: 2027-02-03
        row('AG. EMBARQUE', 'TST0001', 510, d('2026-11-30'), vazio, vazio), // vira o mes: 2027-01-04
        row('EM TRANSITO', 'TST0001', 600, vazio, d('2026-09-10'), vazio), // vencida -> mes base
        row('AG. PAGAMENTO (ANT)', 'TST0002', 700, vazio, vazio, vazio),
        row('AG. PRONT. DA CARGA', 'TST0002', 800, vazio, vazio, vazio),
        row('AG. PAGAMENTO (ANT)', 'TST0003', 50, null, null, null),
        row('EM TRANSITO', 'TST0001', 900, vazio, d('2027-04-01'), vazio), // depois da janela de 5 meses
        row('EM TRANSITO', 'TST0001', 910, vazio, d('2027-03-31'), vazio), // ultimo mes da janela
        row('EM TRANSITO', 'TST0001', 920, vazio, '25/12/2026', vazio), // texto dd/mm/aaaa
        row('EM TRANSITO', 'TST0001', 930, d('2026-12-02'), 'a definir', vazio), // texto invalido cai para a ETD
      ]),
      BASE,
    );
    expect(r.erros).toEqual([]);
    expect(r.linhas).toEqual([
      { codigo: 'TST0001', qtd: 400, mes: '01', estimada: 'etd' },
      { codigo: 'TST0001', qtd: 500, mes: '02', estimada: 'etd' },
      { codigo: 'TST0001', qtd: 510, mes: '01', estimada: 'etd' },
      { codigo: 'TST0001', qtd: 600, mes: '11' },
      { codigo: 'TST0001', qtd: 910, mes: '03' },
      { codigo: 'TST0001', qtd: 920, mes: '12' },
      { codigo: 'TST0001', qtd: 930, mes: '01', estimada: 'etd' }, // ETD 2026-12-02 + 35 = 2027-01-06
    ]);
    expect(r.estimadasPorEtd).toEqual({ linhas: 4, kg: 400 + 500 + 510 + 930 });
    expect(r.estimadasPorProntidao).toEqual({ linhas: 0, kg: 0 });
    expect(r.vencidasNoMesBase).toEqual({ linhas: 1, kg: 600 });
    expect(r.depoisDaJanela).toEqual({ linhas: 1, kg: 900 });
    expect(r.excluidas.atracadas).toEqual({ linhas: 1, kg: 200 });
    expect(r.excluidas.etaFinalPreenchida).toMatchObject({
      linhas: 2,
      kg: 610,
      depoisDaDataBase: { linhas: 1, kg: 310 },
    });
    expect(r.excluidas.etaFinalPreenchida.porStatus).toEqual([{ status: 'EM TRANSITO', linhas: 2, kg: 610 }]);
    expect(r.semData.linhas).toBe(3);
    expect(r.semData.kg).toBe(1550);
    expect(r.semData.porStatus).toEqual(
      [
        { status: 'AG. PAGAMENTO (ANT)', linhas: 2, kg: 750 },
        { status: 'AG. PRONT. DA CARGA', linhas: 1, kg: 800 },
      ].sort((a, b) => b.kg - a.kg),
    );
    expect(r.ignoradas).toEqual({
      'status concluido': 2,
      'atracada aguardando liberacao': 1,
      'eta final preenchida': 2,
      'sem data': 3,
      'depois da janela': 1,
    });
    expect(r.lidas).toBe(r.usadas + ignoradasTotal(r));
    expect(r.porStatus.find((s) => s.status === 'CONCLUIDO')).toMatchObject({ incluido: false, linhas: 2, kg: 210 });
    expect(r.porStatus.find((s) => s.status === 'ATRAC. AG. LIBERACAO')).toMatchObject({ incluido: false, linhas: 1 });
    expect(r.regra).toMatchObject({ id: 'F3', etaPorEtdDias: 35, etaPorProntidaoDias: 35, excluiEtaFinal: true });

    const avisos = r.avisos.join('\n');
    expect(avisos).toMatch(/\(regra F3\): 1 linha \(200 kg\) com status ATRAC\. AG\. LIBERAÇÃO ficaram de fora/);
    expect(avisos).toMatch(
      /\(regra F3\): 2 linhas \(610 kg\) com ETA FINAL preenchida ficaram de fora .*Atenção: 1 com ETA FINAL depois da data base/,
    );
    expect(avisos).toMatch(/3 linhas .*sem ETA \(CHEGADA\), ETD \(EMBARQUE\) nem DATA PRONTIDÃO/);
    expect(avisos).toContain('AG. PRONT. DA CARGA: 1');
    expect(avisos).toMatch(/anterior ao mes base entraram no mes base/);
    expect(avisos).toMatch(/ETD \(EMBARQUE\) \+ 35 dias \(ESTIMADA\)/);
    expect(avisos).toMatch(/depois da janela de 5 meses/);
    expect(avisos).toMatch(/texto invalido/);
  });

  it("DATA PRONTIDAO 'MON DDth' com ETD vazia entra como ESTIMADA (ano pela DATA PO)", async () => {
    const r = await parseFup(
      await xlsx(HEADERS, [
        row('AG. PRONT. DA CARGA', 'TST0001', 100, vazio, vazio, vazio, d('2026-10-05'), 'OCT 20TH'), // 2026-11-24
        row('AG. PRONT. DA CARGA', 'TST0001', 200, null, null, null, d('2026-11-21'), 'Dec 16th'), // 2027-01-20
        row('AG. PRONT. DA CARGA', 'TST0001', 300, null, null, null, d('2026-12-10'), 'JAN 20TH'), // 2027-02-24
        row('AG. PRONT. DA CARGA', 'TST0001', 400, d('2026-12-01'), null, null, null, 'OCT 20TH'), // ETD vence a prontidao
      ]),
      BASE,
    );
    expect(r.erros).toEqual([]);
    expect(r.linhas).toEqual([
      { codigo: 'TST0001', qtd: 100, mes: '11', estimada: 'prontidao' },
      { codigo: 'TST0001', qtd: 200, mes: '01', estimada: 'prontidao' },
      { codigo: 'TST0001', qtd: 300, mes: '02', estimada: 'prontidao' },
      { codigo: 'TST0001', qtd: 400, mes: '01', estimada: 'etd' },
    ]);
    expect(r.estimadasPorProntidao).toEqual({ linhas: 3, kg: 600 });
    expect(r.estimadasPorEtd).toEqual({ linhas: 1, kg: 400 });
    expect(r.avisos.join('\n')).toContain('usaram DATA PRONTIDÃO + 35 dias (ESTIMADA)');
  });

  it('comprasEmAberto: toda linha nao concluida com codigo e kg, somada por codigo (alem das chegadas da F3)', async () => {
    const r = await parseFup(
      await xlsx(HEADERS, [
        row('CONCLUÍDO', 'TST0001', 100, vazio, d('2026-11-20'), vazio),
        row('ATRAC. AG. LIBERAÇÃO', 'tst0001', 200, vazio, d('2026-12-05'), vazio),
        row('EM TRANSITO', 'TST0001', 300, d('2026-10-01'), d('2026-12-01'), d('2026-11-10')), // ETA FINAL
        row('EM TRANSITO', 'TST0001', 400, vazio, d('2026-12-10'), vazio), // chegada normal
        row('AG. PAGAMENTO (ANT)', 'TST0002', 700, vazio, vazio, vazio), // sem data
        row('AG. PAGAMENTO (ANT)', 'TST0003', 40, vazio, vazio, vazio, null, 'ASAP'),
        row('EM TRANSITO', 'TST0004', 900, vazio, d('2027-04-01'), vazio), // depois da janela
      ]),
      BASE,
    );
    expect(r.erros).toEqual([]);
    expect(r.comprasEmAberto).toEqual([
      { codigo: 'TST0001', qtd: 900 },
      { codigo: 'TST0002', qtd: 700 },
      { codigo: 'TST0003', qtd: 40 },
      { codigo: 'TST0004', qtd: 900 },
    ]);
    // As chegadas da F3 nao mudam: so a linha com ETA aceita entra.
    expect(r.linhas).toEqual([{ codigo: 'TST0001', qtd: 400, mes: '12' }]);
  });

  it('DATA PRONTIDAO como celula de data', async () => {
    const r = await parseFup(
      await xlsx(HEADERS, [row('AG. PRONT. DA CARGA', 'TST0001', 100, vazio, vazio, vazio, null, d('2026-11-30'))]),
      BASE,
    );
    expect(r.linhas).toEqual([{ codigo: 'TST0001', qtd: 100, mes: '01', estimada: 'prontidao' }]); // 2027-01-04
  });

  it('prontidao nao reconhecida: fica fora e o detalhe traz a linha da planilha', async () => {
    const r = await parseFup(
      await xlsx(HEADERS, [
        row('EM TRANSITO', 'TST0001', 100, vazio, d('2026-12-10'), vazio),
        row('AG. PAGAMENTO (ANT)', 'tst0007', 800, vazio, vazio, vazio, d('2026-10-01'), 'ASAP'),
        row('AG. PAGAMENTO (ANT)', 'TST0008', 40, vazio, vazio, vazio, null, 'WITH PO 123-45'),
        row('AG. EMBARQUE', 'TST0009', 5, vazio, vazio, vazio, null, null),
      ]),
      BASE,
    );
    expect(r.prontidaoNaoReconhecida.linhas).toBe(2);
    expect(r.prontidaoNaoReconhecida.kg).toBe(840);
    expect(r.prontidaoNaoReconhecida.omitidos).toBe(0);
    expect(r.prontidaoNaoReconhecida.detalhes).toEqual([
      { linha: 3, status: 'AG. PAGAMENTO (ANT)', codigo: 'TST0007', kg: 800, texto: 'ASAP' },
      { linha: 4, status: 'AG. PAGAMENTO (ANT)', codigo: 'TST0008', kg: 40, texto: 'WITH PO 123-45' },
    ]);
    expect(r.semData).toMatchObject({ linhas: 1, kg: 5 });
    expect(r.ignoradas).toEqual({ 'prontidao nao reconhecida': 2, 'sem data': 1 });
    expect(r.lidas).toBe(r.usadas + ignoradasTotal(r));
    expect(r.avisos.join('\n')).toMatch(/2 linhas \(840 kg\) com DATA PRONTIDÃO não reconhecida ficaram de fora/);
  });

  it('cabecalho sem DATA PO e DATA PRONTIDAO: linhas sem ETA nem ETD ficam sem data, com aviso', async () => {
    const r = await parseFup(
      await xlsx(
        HEADERS.slice(0, 9),
        [
          row('EM TRANSITO', 'TST0001', 100, vazio, d('2026-12-10'), vazio),
          row('AG. PRONT. DA CARGA', 'TST0001', 200, vazio, vazio, vazio, null, 'OCT 20TH'),
        ].map((c) => c.slice(0, 9)),
      ),
      BASE,
    );
    expect(r.erros).toEqual([]);
    expect(r.linhas).toEqual([{ codigo: 'TST0001', qtd: 100, mes: '12' }]);
    expect(r.semData).toMatchObject({ linhas: 1, kg: 200 });
    expect(r.prontidaoNaoReconhecida.linhas).toBe(0);
    expect(r.avisos).toContain('FUP: coluna "DATA PRONTIDÃO" não encontrada - linhas sem ETA nem ETD ficam de fora.');
    expect(r.avisos).toContain('FUP: coluna "DATA PO" não encontrada - o ano da DATA PRONTIDÃO usa a data base.');
  });

  it('cabecalho so sem DATA PO: a prontidao usa a data base para o ano', async () => {
    const r = await parseFup(
      await xlsx(
        HEADERS.filter((h) => h !== 'DATA PO'),
        [['AG. PRONT. DA CARGA', 'Exportador teste', 'PO-1', 'TST0001', 100, vazio, vazio, vazio, null, 'DEC 16TH']],
      ),
      BASE,
    );
    expect(r.linhas).toEqual([{ codigo: 'TST0001', qtd: 100, mes: '01', estimada: 'prontidao' }]); // 2026-12-16 + 35
    expect(r.avisos).toContain('FUP: coluna "DATA PO" não encontrada - o ano da DATA PRONTIDÃO usa a data base.');
    expect(r.avisos.join('\n')).not.toContain('coluna "DATA PRONTIDÃO"');
  });

  it('coluna obrigatoria ausente -> erro com o nome da coluna', async () => {
    const r = await parseFup(await xlsx(HEADERS.filter((h) => h !== 'ETA FINAL'), []), BASE);
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0]).toContain('"ETA FINAL"');
    expect(r.erros[0]).toMatch(/FUP/);
    expect(r.linhas).toEqual([]);
    expect(r.comprasEmAberto).toEqual([]);
    expect(r.regra.id).toBe('F3');
  });
});

describe('parseClientesAtivos / parseMargem', () => {
  it('clientes ativos: cabecalho na linha 5, uma linha por cliente', async () => {
    const r = await parseClientesAtivos(
      await xlsx(
        ['Empresa', 'Cliente', 'Código Item', 'Nome Item'],
        [
          ['SQ QUIMICA', 'Cliente 1', 'tst0001', 'Produto A'],
          ['SQ QUIMICA', 'Cliente 2', 'TST0001', 'Produto A'],
          ['SQ QUIMICA', 'Cliente 3', 'TST0002', 'Produto B'],
        ],
        { headerRow: 5 },
      ),
    );
    expect(r.erros).toEqual([]);
    expect(r.linhas).toEqual(['TST0001', 'TST0001', 'TST0002']);
  });

  it('clientes ativos sem a coluna -> erro', async () => {
    const r = await parseClientesAtivos(await xlsx(['Empresa', 'Cliente'], []));
    expect(r.erros[0]).toContain('"Código Item"');
  });

  it('margem por posicao: B nao numerico vira null', async () => {
    const r = await parseMargem(
      await xlsx(
        ['DIRETO', 'MARGEM'],
        [
          ['tst0001', 0.25],
          ['TST0002', 'n/d'],
          ['TST0003', null],
          [null, 0.5],
        ],
      ),
    );
    expect(r.erros).toEqual([]);
    expect(r.linhas).toEqual([
      { codigo: 'TST0001', margem: 0.25 },
      { codigo: 'TST0002', margem: null },
      { codigo: 'TST0003', margem: null },
    ]);
    expect(r.ignoradas).toEqual({ 'sem codigo': 1 });
  });
});

// Opcional (maquina do Lucas): le os relatorios reais de uma pasta local e afirma SO estrutura.
const realDir = process.env.FORECAST_DBCORP_DIR;
// Data base proxima dos relatorios de exemplo (a PROGRAMACAO pendente cai na janela de 4 meses).
const REAL_BASE = '2026-10-15';
describe('relatorios reais (opcional, FORECAST_DBCORP_DIR)', () => {
  const ler = (nome: string) => readFileSync(join(realDir ?? '', nome));

  it.skipIf(!realDir)(
    'le SALDO, VENDAS, PROGRAMACAO e FUP sem erros e com linhas usadas',
    async () => {
      const saldo = await parseSaldo(ler('SALDO.xlsx'));
      const vendas = await parseVendas(ler('QUANTIDADE_PEDIDO_VENDA.xlsx'), 'vendasMes');
      const programacao = await parseProgramacao(ler('PROGRAMAÇÃO.xlsx'), REAL_BASE);
      const fup = await parseFup(ler('FUP.xlsx'), REAL_BASE);

      for (const r of [saldo, vendas, programacao, fup]) {
        expect(r.erros).toEqual([]);
        expect(r.usadas).toBeGreaterThan(0);
        expect(r.lidas).toBe(r.usadas + ignoradasTotal(r));
      }
      // So estrutura da regra F3 (nenhum numero real): a prontidao estima chegadas e atracadas nao entram.
      expect(fup.estimadasPorProntidao.linhas).toBeGreaterThan(0);
      const atracada = fup.porStatus.find((x) => x.status === 'ATRAC. AG. LIBERACAO');
      if (atracada) expect(atracada.incluido).toBe(false);
      const incluido = saldo.porDeposito.filter((x) => x.incluido).reduce((a, x) => a + x.saldo, 0);
      const excluido = saldo.porDeposito.filter((x) => !x.incluido).reduce((a, x) => a + x.saldo, 0);
      const total = saldo.porDeposito.reduce((a, x) => a + x.saldo, 0);
      expect(Math.abs(incluido - saldo.total)).toBeLessThan(1e-3);
      expect(Math.abs(incluido + excluido - total)).toBeLessThan(1e-3);
    },
    60_000,
  );
});
