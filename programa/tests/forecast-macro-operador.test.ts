import { writeFileSync } from 'node:fs';
import exceljs from 'exceljs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
// conferir/calcular sao funcoes puras; o service que importa o Prisma nao e usado aqui.
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));

import { FORECAST_SHEETS } from '../src/constants/forecast';
import { PROJECAO_5O_MES_SOMA_CHEGADA, calcular, conferir } from '../src/utils/forecastEngine';
import { criterioLiteral, criterioLiteralIf, regrasCondicionais } from '../src/utils/forecastMacroLayout';
import { gerarXlsxForecastMacro } from '../src/utils/forecastMacroXlsx';
import { COLUNAS_CONFERIDAS, type Entradas, type Produto, type Quinzena } from '../src/utils/forecastTypes';
import { criarAvaliador } from './helpers/avaliadorFormulasXlsx';

// L81: codigo de produto que comeca com = < > e lido como OPERADOR pelo SUMIF/SUMIFS/COUNTIF do Excel (medido no Excel
// desktop). O gerador manda "="&ref nesses codigos. Amostra 100% sintetica (repo publico).
// L82: a coluna A do MACRO e o N numerico, nunca o codigo: o realce de duplicados nao tem o que escapar.
const MACRO = FORECAST_SHEETS.macro;
const HOJE = '2026-10-20';

const vazio = ['', '', '', '', '', ''];
const produto = (linha: number, codigos: string[]): Produto => ({
  linha,
  n: linha - 2,
  item: `PRODUTO ${900 + linha}`,
  codigos: [...codigos, ...vazio].slice(0, 7),
  historico: [10, 20, 30, 40, 50],
  analiseForecast: null,
  obs: '',
  fonte: 'FONTE 901',
  precoFechado: '',
  embalagem: '',
  naoFraciona: '',
  qtdAmostra: '',
  solicitarAmostra: '',
  status: 'nao',
});

// Operadores (linhas 3 a 7) e iscas (linhas 8 e 9) que o criterio sem o "=" casaria por engano.
const COD = ['=C9001', '<C9002', '>C9003', '=C9*04', '=', 'C9001', 'C9002', 'C9003', 'C9X04', 'C9104', 'D9999', 'A0001'];
const produtos = [
  produto(3, ['=C9001']),
  produto(4, ['<C9002']),
  produto(5, ['>C9003']),
  produto(6, ['=C9*04']),
  produto(7, ['=']),
  produto(8, ['C9001', 'C9002', 'C9003', 'C9X04']),
  produto(9, ['C9104', 'D9999', 'A0001']),
];
const lancamentos = (base: number) => COD.map((codigo, i) => ({ codigo, qtd: base * 2 ** i }));
const entradas: Entradas = {
  estoque: lancamentos(1),
  vendasMes: lancamentos(3),
  vendasAtual: lancamentos(1),
  vendasAnual: lancamentos(11),
  programacoes: COD.map((codigo, i) => ({ codigo, qtd: 2 ** i, mes: '11' })),
  chegadas: COD.map((codigo, i) => ({ codigo, qtd: 2 ** i, mes: '12' })),
  leadtime: [{ fonte: 'FONTE 901', total: 30 }],
  margem: COD.map((codigo, i) => ({ codigo, margem: (i + 1) / 100 })),
  clientesAtivos: COD.flatMap((codigo, i) => Array<string>(i + 1).fill(codigo)),
};
const quinzena: Quinzena = {
  id: '10-2',
  arquivo: '',
  dataBase: '2026-10-15',
  mesesConsumo: ['04', '05', '06', '07', '08', '09', '10 (ATUAL)'],
  mesesChegada: ['10', '11', '12', '01', '02'],
  mesesProgramacao: ['10', '11', '12', '01'],
  produtos,
  entradas,
  esperado: {},
};

const formulaDe = (ws: exceljs.Worksheet, ref: string): string =>
  ((ws.getCell(ref).value as { formula?: string } | null)?.formula ?? '');

let wb: exceljs.Workbook;
let ws: exceljs.Worksheet;

beforeAll(async () => {
  const buffer = await gerarXlsxForecastMacro({ quinzena, hoje: HOJE, half: 2, origin: 'planilha' });
  // QA manual no Excel (fora do loop): FORECAST_MACRO_OPERADOR_OUT=<caminho>.xlsx e recalc-macro-qa.ps1.
  if (process.env.FORECAST_MACRO_OPERADOR_OUT) writeFileSync(process.env.FORECAST_MACRO_OPERADOR_OUT, buffer);
  wb = new exceljs.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  ws = wb.getWorksheet(MACRO)!;
});

describe('L81 - codigo que comeca com = < > no XLSX MACRO', () => {
  it('a formula manda "="&ref so nos codigos com operador; VLOOKUP e codigo comum ficam como antes', () => {
    const u3 = formulaDe(ws, 'U3');
    expect(u3).toContain('SUMIF(ESTOQUE!A:A,"="&B3,ESTOQUE!E:E)');
    expect(u3).toContain('SUMIF(ESTOQUE!A:A,C3,ESTOQUE!E:E)'); // celula vazia continua referencia pura
    expect(formulaDe(ws, 'V3')).toContain(',"="&$B3,');
    expect(formulaDe(ws, 'AS3')).toContain("COUNTIF('CLIENTES ATIVOS'!$C$6:$C$100000,\"=\"&B3)");
    expect(formulaDe(ws, 'U6')).toContain('"="&SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(B6,"~","~~"),"*","~*"),"?","~?")');
    const ar3 = formulaDe(ws, 'AR3');
    expect(ar3).toContain('VLOOKUP(B3,MARGEM!');
    expect(ar3).not.toContain('"="&');
    expect(formulaDe(ws, 'U8')).not.toContain('"="&');
  });

  it('o avaliador (semantica do Excel) acha so o proprio codigo, nunca a isca', () => {
    const av = criarAvaliador(wb);
    expect([3, 4, 5, 6, 7, 8, 9].map((r) => av.valor(MACRO, `U${r}`))).toEqual([1, 2, 4, 8, 16, 480, 3584]);
    expect(av.valor(MACRO, 'AS3')).toBe(1);
    expect(av.valor(MACRO, 'AS6')).toBe(4);
    expect(av.valor(MACRO, 'AS8')).toBe(30);
  });

  it('paridade com o motor: as 196 celulas conferidas batem', () => {
    const av = criarAvaliador(wb);
    const esperado: Quinzena['esperado'] = {};
    quinzena.produtos.forEach((p, i) => {
      const linha: Record<string, number | string | null> = {};
      for (const col of COLUNAS_CONFERIDAS) {
        const v = av.valor(MACRO, `${col}${3 + i}`);
        linha[col] = typeof v === 'object' && v !== null ? null : v;
      }
      esperado[String(p.linha)] = linha;
    });
    const resultado = conferir(
      { ...quinzena, esperado },
      calcular(quinzena, { hoje: HOJE, quinzena: 2, somarChegada5oMes: PROJECAO_5O_MES_SOMA_CHEGADA }),
    );
    expect(resultado.celulas).toBe(196);
    expect(resultado.batem).toBe(196);
  });

  it('criterioLiteralIf: operador no inicio vira "="&ref; VLOOKUP (criterioLiteral) nao muda', () => {
    expect(criterioLiteralIf('B3', '=X')).toBe('"="&B3');
    expect(criterioLiteralIf('B3', '<X')).toBe('"="&B3');
    expect(criterioLiteralIf('B3', '>X')).toBe('"="&B3');
    expect(criterioLiteralIf('B3', '=X*1')).toBe('"="&SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(B3,"~","~~"),"*","~*"),"?","~?")');
    expect(criterioLiteralIf('B3', 'X=1')).toBe('B3');
    expect(criterioLiteralIf('B3', '')).toBe('B3');
    expect(criterioLiteral('B3', '=X')).toBe('B3');
  });
});

describe('L82 - coluna A do MACRO (documental)', () => {
  it('A e o N numerico e o realce de duplicados e um COUNTIF sobre numeros: nao ha codigo para escapar', () => {
    expect(typeof ws.getCell('A3').value).toBe('number');
    expect(regrasCondicionais(9)[0].formula).toBe('COUNTIF($A$3:$A$9,A3)>1');
  });
});
