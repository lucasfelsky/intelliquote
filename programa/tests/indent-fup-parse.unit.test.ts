// Leitura da FUP Indent (fixture SINTETICA gerada por codigo; nenhum dado real).
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  HEADERS,
  LINHAS_SINTETICAS,
  SENTINELAS_COLUNAS_33_36,
  esperadoPorMes,
  montarFupSintetica,
} from './helpers/indentFupFixture';
import { type FupArquivo, chaveCabecalho, lerDash, lerFupDeWorkbook, lerVendas } from '../src/utils/indentFupParse';

// spec n (1-based, como em LINHAS_SINTETICAS) -> indice em `linhas`.
const idx = (n: number): number => n - 1;

describe('leitura da aba de vendas', () => {
  let fup: FupArquivo;
  beforeAll(async () => {
    fup = lerFupDeWorkbook(await montarFupSintetica());
  });

  it('le todas as linhas e ignora a linha totalmente vazia', () => {
    expect(fup.colunasAusentes).toEqual([]);
    expect(fup.linhas).toHaveLength(LINHAS_SINTETICAS.length);
    expect(fup.linhasVaziasIgnoradas).toBe(1);
    expect(fup.linhas[0].linha).toBe(2);
  });

  it('acha colunas por cabecalho, inclusive com quebra de linha', () => {
    const l = fup.linhas[0];
    expect(l.precoFornecedor).toBe(1.5);
    expect(l.precoCliente).toBe(2);
    expect(l.quantidade).toBe(1000);
    expect(l.origem).toBe('CHINA (SHANGHAI)');
    expect(chaveCabecalho('PREÇO (USD)\nFORNECE.')).toBe('preco (usd) fornece.');
  });

  it('nunca le as colunas 33-36 (comissao/representante)', () => {
    const json = JSON.stringify([fup.linhas, fup.perfil]);
    for (const s of SENTINELAS_COLUNAS_33_36) expect(json).not.toContain(s);
    expect(fup.perfil.map((p) => p.coluna).every((c) => c <= 32)).toBe(true);
    expect(HEADERS).toHaveLength(36);
  });

  it('le a coluna sem nome (29) como `extra`', async () => {
    const wb = await montarFupSintetica({ specs: [{ ...LINHAS_SINTETICAS[0], extra: 'NOTA LIVRE' }] });
    const lida = lerFupDeWorkbook(wb);
    expect(lida.linhas[0].extra).toBe('NOTA LIVRE');
    expect(fup.perfil.find((p) => p.campo === 'extra')?.vazios).toBe(LINHAS_SINTETICAS.length);
  });

  it('formula sem resultado gravado vale 0 e e sinalizada; valor fixo e formula com resultado normais', () => {
    const semResultado = fup.linhas[idx(28)];
    expect(semResultado.comissaoSubtotal).toBe(0);
    expect(semResultado.formulaSemResultado).toContain('comissaoSubtotal');
    expect(fup.linhas[0].subtotal).toBe(2000);
    expect(fup.linhas[0].formulaSemResultado).toEqual([]);
    const perfilComissao = fup.perfil.find((p) => p.campo === 'comissaoSubtotal');
    expect(perfilComissao?.formulasSemResultado).toBe(1);
    expect(fup.perfil.find((p) => p.campo === 'subtotal')?.formulasSemResultado).toBe(0);
  });

  it('guarda o texto da formula do SUBTOTAL (J*I = preco do fornecedor)', () => {
    expect(fup.linhas[0].subtotalFormula).toMatch(/^I\d+\*K\d+$/);
    expect(fup.linhas[idx(29)].subtotalFormula).toMatch(/^J\d+\*I\d+$/);
    expect(fup.linhas[idx(11)].subtotalFormula).toBeNull();
  });

  it('texto rico vira texto simples', () => {
    expect(fup.linhas[idx(43)].produto).toBe('PRODUTO R-800');
  });

  it('datas do exceljs sao lidas pelas partes UTC (31/12 e 01/01 nao deslizam)', () => {
    expect(fup.linhas[idx(19)].dataPo).toBe('2024-12-31');
    expect(fup.linhas[idx(20)].dataPo).toBe('2025-01-01');
    expect(fup.linhas[0].etd).toBe('2024-02-01');
  });

  it('datas em texto continuam texto (a normalizacao decide)', () => {
    expect(fup.linhas[idx(21)].eta).toBe('31/11/24');
    expect(fup.linhas[idx(22)].eta).toBe('-');
    expect(fup.linhas[idx(24)].dueDate).toBe('18//01/26');
  });

  it('perfil de colunas: total e vazios', () => {
    const ncm = fup.perfil.find((p) => p.campo === 'ncm');
    expect(ncm?.total).toBe(LINHAS_SINTETICAS.length);
    expect(ncm?.vazios).toBe(0);
    expect(fup.perfil.find((p) => p.campo === 'importador')?.cabecalho).toBe('IMPORTADOR');
    expect(fup.perfil.find((p) => p.campo === 'precoFornecedor')?.cabecalho).toBe('PREÇO (USD) FORNECE.');
  });

  it('cabecalho obrigatorio ausente: falha com a lista, sem ler linhas', () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('INDENT SALES');
    ws.addRow(['FORNECEDOR', 'PO', 'DATA PO']);
    const lida = lerVendas(ws);
    expect(lida.linhas).toEqual([]);
    expect(lida.colunasAusentes).toEqual(expect.arrayContaining(['cliente', 'produtos', 'qtd - kgs']));
    expect(lerFupDeWorkbook(new ExcelJS.Workbook()).colunasAusentes).toEqual(['aba INDENT SALES']);
  });
});

describe('leitura do DASH por rotulos', () => {
  it('le anos, meses e Total Geral', async () => {
    const wb = await montarFupSintetica();
    const esperado = esperadoPorMes();
    const dash = lerFupDeWorkbook(wb).dash;
    expect(dash).not.toBeNull();
    expect(dash?.anos).toEqual([2024, 2025]);
    const marco = esperado['2024-03'];
    expect(dash?.meses['2024-03'].faturamento).toBeCloseTo(marco.faturamento, 6);
    expect(dash?.meses['2024-03'].volume).toBeCloseTo(marco.volume, 6);
    expect(dash?.meses['2024-03'].comissao).toBeCloseTo(marco.comissao, 6);
    expect(Object.keys(dash?.meses ?? {})).toHaveLength(24);
    expect(dash?.totais['2025'].volume).toBeGreaterThan(0);
  });

  it('nao depende de celula fixa: grid deslocado e ano sem repeticao (celula mesclada)', () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('DASH');
    // Deslocado 3 linhas para baixo e 2 colunas para a direita; o ano so na 1a coluna do grupo.
    ws.getCell(8, 4).value = 2030;
    ws.getCell(9, 3).value = 'MESES';
    ['COMISSÃO', 'FATURAMENTO', 'VOLUME'].forEach((m, j) => {
      ws.getCell(9, 4 + j).value = m;
    });
    ws.getCell(10, 3).value = 'fev';
    ws.getCell(10, 4).value = 1.5;
    ws.getCell(10, 5).value = 20;
    ws.getCell(10, 6).value = 300;
    ws.getCell(11, 3).value = 'Total Geral';
    ws.getCell(11, 4).value = 1.5;
    ws.getCell(11, 5).value = 20;
    ws.getCell(11, 6).value = 300;
    const dash = lerDash(ws);
    expect(dash?.anos).toEqual([2030]);
    expect(dash?.meses['2030-02']).toEqual({ comissao: 1.5, faturamento: 20, volume: 300 });
    expect(dash?.totais['2030']).toEqual({ comissao: 1.5, faturamento: 20, volume: 300 });
  });

  it('sem linha de metricas: null', () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('DASH').getCell(1, 1).value = 'nada';
    expect(lerDash(wb.getWorksheet('DASH') as ExcelJS.Worksheet)).toBeNull();
  });
});
