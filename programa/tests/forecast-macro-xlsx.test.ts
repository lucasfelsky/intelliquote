import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import exceljs from 'exceljs';
// O exceljs ja traz o jszip: usado so para ler o XML cru que o leitor do exceljs descarta (calcPr, erro em data, formato).
import JSZip from 'jszip';
import { beforeAll, describe, expect, it, vi } from 'vitest';
// conferenciaDaQuinzena vive em um service que importa o Prisma; aqui so a funcao pura e usada.
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));

import { FORECAST_SHEETS, FORECAST_STATUS_COLORS } from '../src/constants/forecast';
import { calcular, conferir, type OpcoesCalculo } from '../src/utils/forecastEngine';
import {
  COLUNAS_MACRO,
  COLUNAS_OCULTAS,
  LARGURAS,
  colunasDaMedia,
  formulaDaColuna,
  referenciaAba,
  rotuloMesSeguinte,
} from '../src/utils/forecastMacroLayout';
import {
  PARAGRAFOS_REGRAS_MACRO,
  clientesDosProdutos,
  gerarXlsxForecastMacro,
  margemUsada,
  nomeArquivoForecastMacro,
  type EntradaForecastMacro,
} from '../src/utils/forecastMacroXlsx';
import { parseForecastWorkbook } from '../src/utils/forecastWorkbook';
import { conferenciaDaQuinzena } from '../src/services/ForecastSnapshotService';
import { COLUNAS_CONFERIDAS, type Entradas, type Produto, type Quinzena } from '../src/utils/forecastTypes';
import { criarAvaliador } from './helpers/avaliadorFormulasXlsx';

// Fixture ANONIMIZADA (repo publico): scripts/forecast-anonymize-fixture.mjs. Nenhum dado real neste arquivo.
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8'),
) as Quinzena;

const HOJE = '2026-10-20';
const MACRO = FORECAST_SHEETS.macro;
const SERIE_BASE = Date.UTC(1899, 11, 30);

// Marcas sinteticas de mes atipico em 4 linhas da fixture: so M, so P (mes atual), todas do trimestre, J e O.
const MARCAS: ReadonlyMap<number, ReadonlySet<number>> = new Map([
  [3, new Set([3])],
  [4, new Set([6])],
  [5, new Set([3, 4, 5])],
  [6, new Set([0, 5])],
]);

const OPCOES_A: EntradaForecastMacro = {
  quinzena: fixture,
  hoje: HOJE,
  half: 2,
  origin: 'planilha',
  mesesForaDaMedia: MARCAS,
};
const OPCOES_B: EntradaForecastMacro = {
  quinzena: fixture,
  hoje: HOJE,
  half: 1,
  origin: 'planilha',
  somarChegada5oMes: false,
};
const OPCOES_SEM_MARCAS: EntradaForecastMacro = { quinzena: fixture, hoje: HOJE, half: 2, origin: 'planilha' };

const opcoesDoMotor = (e: EntradaForecastMacro): OpcoesCalculo => ({
  hoje: e.hoje,
  quinzena: e.half,
  somarChegada5oMes: e.somarChegada5oMes,
  mesesForaDaMedia: e.mesesForaDaMedia,
});

async function carregar(buffer: Buffer): Promise<exceljs.Workbook> {
  const wb = new exceljs.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return wb;
}

async function xmlDoArquivo(buffer: Buffer, entrada: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file(entrada)!.async('string');
}

const formulaDe =(ws: exceljs.Worksheet, ref: string): string | undefined =>
  (ws.getCell(ref).value as { formula?: string } | null)?.formula;

// Valor de cada coluna conferida avaliado PELA FORMULA do arquivo (resultado em cache ignorado).
function esperadoPelasFormulas(wb: exceljs.Workbook, q: Quinzena): Quinzena['esperado'] {
  const av = criarAvaliador(wb);
  const esperado: Quinzena['esperado'] = {};
  q.produtos.forEach((p, i) => {
    const r = 3 + i;
    const linha: Record<string, number | string | null> = {};
    for (const col of COLUNAS_CONFERIDAS) {
      const v = av.valor(MACRO, `${col}${r}`);
      linha[col] = typeof v === 'object' && v !== null ? null : v;
    }
    esperado[String(p.linha)] = linha;
  });
  return esperado;
}

const serieParaChave = (serie: number): string => {
  const d = new Date(SERIE_BASE + serie * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

function paridade(wb: exceljs.Workbook, q: Quinzena, e: EntradaForecastMacro) {
  const calculadas = calcular(q, opcoesDoMotor(e));
  const resultado = conferir({ ...q, esperado: esperadoPelasFormulas(wb, q) }, calculadas);
  // AP (data de chegada) nao esta nas colunas conferidas: confere a parte.
  const av = criarAvaliador(wb);
  const aps = calculadas.map((l, i) => {
    const v = av.valor(MACRO, `AP${3 + i}`);
    return { esperado: l.AP, formula: typeof v === 'number' ? serieParaChave(v) : null };
  });
  return { resultado, aps };
}

let bufferA: Buffer;
let wbA: exceljs.Workbook;
let bufferB: Buffer;
let wbB: exceljs.Workbook;

beforeAll(async () => {
  bufferA = await gerarXlsxForecastMacro(OPCOES_A);
  wbA = await carregar(bufferA);
  bufferB = await gerarXlsxForecastMacro(OPCOES_B);
  wbB = await carregar(bufferB);
  if (process.env.FORECAST_MACRO_OUT) writeFileSync(process.env.FORECAST_MACRO_OUT, bufferA);
}, 120_000);

// ---- 4.1 Avaliador de formulas (so de teste) ----
describe('avaliador de formulas do teste', () => {
  async function planilhaSintetica(montar: (wb: exceljs.Workbook) => void) {
    const wb = new exceljs.Workbook();
    montar(wb);
    return criarAvaliador(await carregar(Buffer.from(await wb.xlsx.writeBuffer())));
  }

  it('SUMIF ignora maiusculas e minusculas', async () => {
    const av = await planilhaSintetica((wb) => {
      const d = wb.addWorksheet('D');
      ['abc', 'ABC', 'x'].forEach((t, i) => {
        d.getCell(`A${i + 1}`).value = t;
        d.getCell(`B${i + 1}`).value = i + 1;
      });
      wb.addWorksheet('S').getCell('A1').value = { formula: 'SUMIF(D!A:A,"Abc",D!B:B)', result: 0 };
    });
    expect(av.valor('S', 'A1')).toBe(3);
  });

  it('criterio vazio nao soma texto: so celula com numero 0', async () => {
    const av = await planilhaSintetica((wb) => {
      const d = wb.addWorksheet('D');
      d.getCell('A1').value = 'abc';
      d.getCell('B1').value = 5;
      d.getCell('A2').value = 0;
      d.getCell('B2').value = 7;
      d.getCell('A3').value = '0';
      d.getCell('B3').value = 11;
      const s = wb.addWorksheet('S');
      s.getCell('A1').value = { formula: 'SUMIF(D!A:A,E1,D!B:B)', result: 0 };
    });
    expect(av.valor('S', 'A1')).toBe(7);
  });

  it('VLOOKUP nao achado vira erro e IFERROR cai no fallback; celula de retorno vazia vale 0', async () => {
    const av = await planilhaSintetica((wb) => {
      const d = wb.addWorksheet('D');
      d.getCell('A1').value = 'K1';
      d.getCell('B1').value = 9;
      d.getCell('A2').value = 'K2';
      const s = wb.addWorksheet('S');
      s.getCell('A1').value = { formula: 'VLOOKUP("zz",D!A:B,2,0)', result: 0 };
      s.getCell('A2').value = { formula: 'IFERROR(VLOOKUP("zz",D!A:B,2,0),IFERROR(VLOOKUP("k1",D!A:B,2,0),""))', result: 0 };
      s.getCell('A3').value = { formula: 'VLOOKUP("K2",D!A:B,2,0)', result: 1 };
      s.getCell('A4').value = { formula: 'VLOOKUP(E1,D!A:B,2,0)', result: 1 };
    });
    expect(av.valor('S', 'A1')).toEqual({ erro: '#N/A' });
    expect(av.valor('S', 'A2')).toBe(9);
    expect(av.valor('S', 'A3')).toBe(0);
    expect(av.valor('S', 'A4')).toEqual({ erro: '#N/A' });
  });

  it('DATE devolve o numero de serie; divisao por zero e texto na conta viram erro', async () => {
    const av = await planilhaSintetica((wb) => {
      const s = wb.addWorksheet('S');
      s.getCell('A1').value = { formula: 'DATE(2026,10,20)+91', result: 0 };
      s.getCell('A2').value = { formula: '1/0', result: 0 };
      s.getCell('A3').value = { formula: '"a"+1', result: 0 };
      s.getCell('A4').value = { formula: 'IF(1<2,"sim","nao")', result: 0 };
    });
    expect(av.valor('S', 'A1')).toBe(46315 + 91);
    expect(av.valor('S', 'A2')).toEqual({ erro: '#DIV/0!' });
    expect(av.valor('S', 'A3')).toEqual({ erro: '#VALUE!' });
    expect(av.valor('S', 'A4')).toBe('sim');
  });

  it('funcao fora do subconjunto e curinga lancam (falha alto)', async () => {
    const av = await planilhaSintetica((wb) => {
      const d = wb.addWorksheet('D');
      d.getCell('A1').value = 'C1';
      d.getCell('B1').value = 1;
      const s = wb.addWorksheet('S');
      s.getCell('A1').value = { formula: 'TODAY()+1', result: 0 };
      s.getCell('A2').value = { formula: 'SUMIF(D!A:A,"C*",D!B:B)', result: 0 };
      s.getCell('A3').value = { formula: 'LET(x,1,x)', result: 0 };
    });
    expect(() => av.valor('S', 'A1')).toThrow('Funcao nao suportada: TODAY');
    expect(() => av.valor('S', 'A2')).toThrow(/curinga/);
    expect(() => av.valor('S', 'A3')).toThrow();
  });
});

// ---- 4.2 Paridade das formulas com o motor (criterio central) ----
describe('paridade formula x motor: 9.464 celulas por cenario', () => {
  it('(a) 2a quinzena, regra AL do Comex e 4 linhas com mes atipico marcado', () => {
    const { resultado, aps } = paridade(wbA, fixture, OPCOES_A);
    expect(resultado.divergencias.slice(0, 5)).toEqual([]);
    expect(resultado.celulas).toBe(9464);
    expect(resultado.batem).toBe(9464);
    expect(aps.filter((a) => a.esperado !== a.formula)).toEqual([]);
    expect(aps.some((a) => a.esperado === null)).toBe(false);
  });

  it('(b) 1a quinzena e regra da planilha na AL (sem somar a chegada do 5o mes)', () => {
    const { resultado, aps } = paridade(wbB, fixture, OPCOES_B);
    expect(resultado.divergencias.slice(0, 5)).toEqual([]);
    expect(resultado.celulas).toBe(9464);
    expect(resultado.batem).toBe(9464);
    expect(aps.filter((a) => a.esperado !== a.formula)).toEqual([]);
  });
});

// ---- 4.3 Round-trip pelo importador ----
describe('round-trip pelo importador (resultado em cache)', () => {
  const normalizaX = (v: string) => (v.trim().toUpperCase() === 'X' ? 'X' : '');

  it('o arquivo reimporta sem erros nem avisos e devolve a quinzena congelada', async () => {
    const r = await parseForecastWorkbook(bufferA, { label: '10-2', baseDate: '2026-10-15' });
    expect(r.erros).toEqual([]);
    expect(r.avisos).toEqual([]);
    const q = r.quinzena;
    expect(q.produtos).toHaveLength(338);
    expect(q.produtos).toEqual(
      fixture.produtos.map((p) => ({ ...p, precoFechado: normalizaX(p.precoFechado), naoFraciona: normalizaX(p.naoFraciona) })),
    );
    expect(q.mesesConsumo).toEqual(fixture.mesesConsumo);
    expect(q.mesesChegada).toEqual(fixture.mesesChegada);
    expect(q.mesesProgramacao).toEqual(fixture.mesesProgramacao);
    const e = q.entradas;
    expect(e.estoque).toEqual(fixture.entradas.estoque);
    expect(e.vendasMes).toEqual(fixture.entradas.vendasMes);
    expect(e.vendasAtual).toEqual(fixture.entradas.vendasAtual);
    expect(e.vendasAnual).toEqual(fixture.entradas.vendasAnual);
    expect(e.programacoes).toEqual(fixture.entradas.programacoes);
    expect(e.chegadas).toEqual(fixture.entradas.chegadas);
    expect(e.leadtime).toEqual(fixture.entradas.leadtime);
    expect(e.margem).toEqual(margemUsada(fixture));
    expect(e.clientesAtivos).toEqual(clientesDosProdutos(fixture));

    // O cache do arquivo e o motor COM as marcas: confere 9.464 de 9.464.
    const c = conferir(q, calcular(fixture, opcoesDoMotor(OPCOES_A)));
    expect(c.divergencias.slice(0, 5)).toEqual([]);
    expect(c.celulas).toBe(9464);
    expect(c.batem).toBe(9464);

    // Conferencia da planilha (sem marcas e sem a regra AL do Comex): so acusa as linhas marcadas e AL/AM.
    const planilha = conferenciaDaQuinzena(q, HOJE);
    expect(planilha.celulas).toBe(9464);
    expect(planilha.batem).toBeLessThan(planilha.celulas);
    const todas = conferir(q, calcular(q, { hoje: HOJE, quinzena: 2, somarChegada5oMes: false })).divergencias;
    expect(todas.length).toBeGreaterThan(0);
    expect(todas.filter((d) => !MARCAS.has(d.linha) && d.coluna !== 'AL' && d.coluna !== 'AM')).toEqual([]);
  });

  it('arquivo sem marcas: a conferencia da planilha so acusa AL e AM (2 + 2 celulas)', async () => {
    const buffer = await gerarXlsxForecastMacro(OPCOES_SEM_MARCAS);
    const r = await parseForecastWorkbook(buffer, { label: '10-2', baseDate: '2026-10-15' });
    expect(r.erros).toEqual([]);
    expect(r.avisos).toEqual([]);
    const c = conferenciaDaQuinzena(r.quinzena, HOJE);
    expect(c.celulas).toBe(9464);
    expect(c.batem).toBe(9460);
    expect(c.porColuna.AL.celulas - c.porColuna.AL.batem).toBe(2);
    expect(c.porColuna.AM.celulas - c.porColuna.AM.batem).toBe(2);
    expect(c.totalDivergencias).toBe(4);
  });
});

// ---- 4.4 Texto das formulas ----
describe('texto das formulas', () => {
  const ws = () => wbA.getWorksheet(MACRO)!;
  const ultima = 2 + fixture.produtos.length;
  const termos = (r: number, montar: (ref: string) => string, ancora = '') =>
    `SUM(${['B', 'C', 'D', 'E', 'F', 'G', 'H'].map((c) => montar(`${ancora}${c}${r}`)).join(',')})`;

  it('linha 3 e ultima linha batem a tabela do plano', () => {
    for (const r of [3, ultima]) {
      const w = ws();
      expect(formulaDe(w, `O${r}`)).toBe(
        termos(r, (ref) => `SUMIF('VENDAS MENSAL'!B:B,${ref},'VENDAS MENSAL'!D:D)`),
      );
      expect(formulaDe(w, `P${r}`)).toBe(
        termos(r, (ref) => `SUMIF('VENDAS ATUAL (DIA 15)'!B:B,${ref},'VENDAS ATUAL (DIA 15)'!D:D)`),
      );
      expect(formulaDe(w, `S${r}`)).toBe(
        `(${termos(r, (ref) => `SUMIF('VENDAS ANUAL'!B:B,${ref},'VENDAS ANUAL'!D:D)`)})/11`,
      );
      expect(formulaDe(w, `U${r}`)).toBe(termos(r, (ref) => `SUMIF(ESTOQUE!A:A,${ref},ESTOQUE!E:E)`));
      expect(formulaDe(w, `V${r}`)).toBe(
        termos(r, (ref) => `SUMIFS(CHEGADAS!$L:$L,CHEGADAS!$E:$E,${ref},CHEGADAS!$Z:$Z,V$2)`, '$'),
      );
      expect(formulaDe(w, `AF${r}`)).toBe(
        termos(
          r,
          (ref) => `SUMIFS('PROGRAMAÇÕES'!$D:$D,'PROGRAMAÇÕES'!$A:$A,${ref},'PROGRAMAÇÕES'!$I:$I,AF$2)`,
          '$',
        ),
      );
      expect(formulaDe(w, `T${r}`)).toBe(`Q${r}/30*AQ${r}`);
      expect(formulaDe(w, `AA${r}`)).toBe(`IF(Q${r}=0,"0",SUM(U${r}:Z${r})/Q${r})`);
      expect(formulaDe(w, `AH${r}`)).toBe(`U${r}+V${r}-AC${r}-AG${r}`);
      expect(formulaDe(w, `AI${r}`)).toBe(`AH${r}+W${r}-Q${r}-AD${r}`);
      expect(formulaDe(w, `AJ${r}`)).toBe(`AI${r}+X${r}-Q${r}-AE${r}`);
      expect(formulaDe(w, `AK${r}`)).toBe(`AJ${r}+Y${r}-Q${r}-AF${r}`);
      expect(formulaDe(w, `AL${r}`)).toBe(`AK${r}+Z${r}-Q${r}`);
      expect(formulaDe(w, `AM${r}`)).toBe(`AL${r}-Q${r}`);
      expect(formulaDe(w, `AN${r}`)).toBe(`(SUM(U${r}:Z${r})-T${r})-Q${r}-(SUM(AC${r}:AF${r}))`);
      expect(formulaDe(w, `AP${r}`)).toBe(`DATE(2026,10,20)+AQ${r}`);
      expect(formulaDe(w, `AQ${r}`)).toBe(`VLOOKUP(AU${r},LEADTIME!A:G,7,0)`);
      expect(formulaDe(w, `AS${r}`)).toBe(
        ['B', 'C', 'D', 'E', 'F', 'G', 'H'].map((c) => `COUNTIF('CLIENTES ATIVOS'!$C$6:$C$100000,${c}${r})`).join('+'),
      );
      const ar = formulaDe(w, `AR${r}`)!;
      expect(ar.startsWith(`IFERROR(VLOOKUP(B${r},MARGEM!$A$2:$B$413,2,0),IFERROR(VLOOKUP(C${r},`)).toBe(true);
      expect(ar.endsWith(`IFERROR(VLOOKUP(H${r},MARGEM!$A$2:$B$413,2,0),"")))))))`)).toBe(true);
      expect(ar.match(/IFERROR\(/g)).toHaveLength(7);
    }
  });

  it('sem marca: Q, R e AG sao as da planilha; AG compara com P na 2a quinzena', () => {
    const w = ws();
    const r = 7; // linha 7 do arquivo = produto sem marca
    expect(formulaDe(w, `Q${r}`)).toBe(`(M${r}+N${r}+O${r})/3`);
    expect(formulaDe(w, `R${r}`)).toBe(`(J${r}+K${r}+L${r}+M${r}+N${r}+O${r})/6`);
    expect(formulaDe(w, `AG${r}`)).toBe(`IF(Q${r}<P${r},P${r},Q${r})`);
  });

  it('meses marcados saem das medias; mes atual marcado deixa AG na media', () => {
    const w = ws();
    expect(formulaDe(w, 'Q3')).toBe('(N3+O3)/2'); // marca no indice 3 (M)
    expect(formulaDe(w, 'R3')).toBe('(J3+K3+L3+N3+O3)/5');
    expect(formulaDe(w, 'AG3')).toBe('IF(Q3<P3,P3,Q3)');
    expect(formulaDe(w, 'AG4')).toBe('Q4'); // marca no indice 6 (P)
    expect(formulaDe(w, 'Q4')).toBe('(M4+N4+O4)/3');
    expect(formulaDe(w, 'Q5')).toBe('(M5+N5+O5)/3'); // todo o trimestre marcado: formula da planilha
    expect(formulaDe(w, 'R5')).toBe('(J5+K5+L5)/3');
    expect(formulaDe(w, 'Q6')).toBe('(M6+N6)/2'); // marcas em J e O
    expect(formulaDe(w, 'R6')).toBe('(K6+L6+M6+N6)/4');
  });

  it('1a quinzena e regra da planilha na AL', () => {
    const w = wbB.getWorksheet(MACRO)!;
    expect(formulaDe(w, 'AG3')).toBe('Q3');
    expect(formulaDe(w, 'AG9')).toBe('Q9');
    expect(formulaDe(w, 'AL3')).toBe('AK3-Q3');
  });

  it('nenhuma formula do arquivo usa funcao fora do padrao do PO.COMP.01', () => {
    for (const wb of [wbA, wbB]) {
      for (const ws of wb.worksheets) {
        ws.eachRow((row) =>
          row.eachCell((cell) => {
            const f = (cell.value as { formula?: string } | null)?.formula;
            if (f) expect(f).not.toMatch(/TODAY\(|LET\(|XLOOKUP|_xlfn/);
          }),
        );
      }
    }
  });

  it('funcoes do layout: media, nome de aba e mes seguinte', () => {
    expect(colunasDaMedia(['M', 'N', 'O'], 3, new Set([3]))).toEqual(['N', 'O']);
    expect(colunasDaMedia(['M', 'N', 'O'], 3, new Set([3, 4, 5]))).toEqual(['M', 'N', 'O']);
    expect(colunasDaMedia(['M', 'N', 'O'], 3, new Set([6, 0]))).toEqual(['M', 'N', 'O']);
    expect(referenciaAba('ESTOQUE')).toBe('ESTOQUE');
    expect(referenciaAba('VENDAS MENSAL')).toBe("'VENDAS MENSAL'");
    expect(referenciaAba('PROGRAMAÇÕES')).toBe("'PROGRAMAÇÕES'");
    expect(rotuloMesSeguinte('02')).toBe('03');
    expect(rotuloMesSeguinte('12')).toBe('01');
    expect(
      formulaDaColuna('AL', 3, { half: 2, somarChegada5oMes: false, hoje: HOJE, ultimaLinhaMargem: 413 }),
    ).toBe('AK3-Q3');
  });
});

// ---- 4.5 Layout ----
describe('layout da aba FORECAST (MACRO)', () => {
  const ws = () => wbA.getWorksheet(MACRO)!;

  it('ordem das 11 abas, VENDAS ANUAL oculta e Regras por ultimo', () => {
    expect(wbA.worksheets.map((w) => w.name)).toEqual([
      MACRO,
      'ESTOQUE',
      'VENDAS MENSAL',
      'VENDAS ATUAL (DIA 15)',
      'VENDAS ANUAL',
      'PROGRAMAÇÕES',
      'CHEGADAS',
      'LEADTIME',
      'MARGEM',
      'CLIENTES ATIVOS',
      'Regras',
    ]);
    expect(wbA.getWorksheet('VENDAS ANUAL')!.state).toBe('hidden');
    expect(wbA.getWorksheet('VENDAS MENSAL')!.state).toBe('visible');
  });

  it('mesclagens da linha 1 e da LEADTIME', () => {
    expect([...ws().model.merges].sort()).toEqual(['AC1:AF1', 'AG1:AM1', 'AN1:AZ1', 'J1:P1', 'T1:U1', 'V1:Z1']);
    expect([...wbA.getWorksheet('LEADTIME')!.model.merges].sort()).toEqual(['A1:A2', 'B1:G1']);
  });

  it('colunas ocultas: exatamente B-H, J, K, L e AG; larguras de A a AZ', () => {
    const ocultas = COLUNAS_MACRO.filter((c) => ws().getColumn(c).hidden);
    expect(ocultas).toEqual(['B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'AG']);
    expect([...COLUNAS_OCULTAS]).toEqual(ocultas);
    expect(COLUNAS_MACRO).toHaveLength(52);
    // Largura igual a padrao do exceljs (9, coluna AM) nao e gravada por coluna: vale a padrao da aba (9).
    const largura = (c: string) => ws().getColumn(c).width ?? ws().properties.defaultColWidth;
    for (const c of COLUNAS_MACRO) expect(largura(c)).toBeCloseTo(LARGURAS[c], 2);
    expect(ws().getColumn('I').width).toBeCloseTo(32.66, 2);
    expect(ws().getColumn('AB').width).toBeCloseTo(1.66, 2);
    expect(ws().getColumn('AT').width).toBeCloseTo(42.44, 2);
  });

  it('congelamento em J3, zoom 90, filtro A2:AZ340 e A4 retrato', async () => {
    const v = ws().views[0] as unknown as Record<string, unknown>;
    expect(v.state).toBe('frozen');
    expect(v.xSplit).toBe(9);
    expect(v.ySplit).toBe(2);
    expect(v.topLeftCell).toBe('J3');
    expect(v.zoomScale).toBe(90);
    expect(await xmlDoArquivo(bufferA, 'xl/worksheets/sheet1.xml')).toContain('<autoFilter ref="A2:AZ340"/>');
    expect(ws().pageSetup.paperSize).toBe(9);
    expect(ws().pageSetup.orientation).toBe('portrait');
    expect(ws().getRow(1).height).toBeCloseTo(16.2, 1);
  });

  it('faixas e cabecalhos da linha 1 e 2', () => {
    const w = ws();
    expect(w.getCell('B1').value).toBe('CÓD. SQ');
    expect(w.getCell('J1').value).toBe('CONSUMO');
    expect(w.getCell('T1').value).toBe('ESTOQUE');
    expect(w.getCell('V1').value).toBe('CHEGADAS');
    expect(w.getCell('AC1').value).toBe('PROGRAMAÇÕES');
    expect(w.getCell('AG1').value).toBe('FINAL');
    expect(w.getCell('AN1').value).toBe('COMPRAS');
    expect((w.getCell('J1').fill as exceljs.FillPattern).fgColor?.argb).toBe('FFFF0000');
    expect((w.getCell('T1').fill as exceljs.FillPattern).fgColor?.argb).toBe('FFFFFF00');
    expect((w.getCell('Q1').fill as exceljs.FillPattern).fgColor?.argb).toBe('FF00CC99');
    expect(w.getCell('Q1').font.color?.argb).toBe('FFFFFFFF');
    expect(w.getCell('J1').font.color?.argb).toBe('FF000000');
    expect(w.getCell('J1').font.name).toBe('Bookman Old Style');
    expect(['J', 'K', 'L', 'M', 'N', 'O', 'P'].map((c) => w.getCell(`${c}2`).value)).toEqual(fixture.mesesConsumo);
    expect(['V', 'W', 'X', 'Y', 'Z'].map((c) => w.getCell(`${c}2`).value)).toEqual(fixture.mesesChegada);
    expect(w.getCell('AL2').value).toBe('02');
    expect(w.getCell('AM2').value).toBe('03');
    expect(w.getCell('AN2').value).toBe('DEMANDA');
    expect(w.getCell('AZ2').value).toBe('SOLICITAR AMOSTRA COM PROXIMA COMPRA?');
    expect((w.getCell('T2').fill as exceljs.FillPattern).fgColor?.argb).toBe('FFFFC000');
    expect((w.getCell('AC2').fill as exceljs.FillPattern).fgColor?.argb).toBe('FFFFFF00');
    expect(formulaDe(w, 'AC2')).toBe('V2');
    expect(formulaDe(w, 'AK2')).toBe('AF2');
  });

  it('formato numerico por coluna e fundo do item por status', () => {
    const w = ws();
    // O leitor do exceljs descarta a barra invertida do formato (o XML a traz: ver o teste de formatos no XML).
    const fmt = (c: string) => w.getCell(`${c}3`).numFmt.replace(/\\/g, '');
    expect(fmt('J')).toBe('_-* #,##0_-;-* #,##0_-;_-* "-"??_-;_-@_-');
    expect(fmt('Q')).toBe('0.0');
    expect(fmt('AG')).toBe('0.00');
    expect(fmt('AH')).toBe('0');
    expect(fmt('AN')).toBe('_-* #,##0.0_-;-* #,##0.0_-;_-* "-"?_-;_-@_-');
    expect(fmt('AP')).toBe('d-mmm');
    expect(fmt('AR')).toBe('0.0%');
    const porStatus = new Map(Object.entries(FORECAST_STATUS_COLORS).map(([cor, status]) => [status as string, cor]));
    fixture.produtos.forEach((p, i) => {
      const fill = w.getCell(`I${3 + i}`).fill as exceljs.FillPattern | undefined;
      const argb = fill?.type === 'pattern' ? fill.fgColor?.argb : undefined;
      expect(argb).toBe(porStatus.get(p.status));
    });
    expect((w.getCell('T3').fill as exceljs.FillPattern).fgColor?.argb).toBe('FFEEECE1');
    expect((w.getCell('AB3').fill as exceljs.FillPattern).fgColor?.argb).toBe('FFFFC000');
  });

  it('formatacao condicional: alerta sempre pela media trimestral ($Q), uma regra por faixa', () => {
    const cfs = ws().conditionalFormattings as unknown as Array<{
      ref: string;
      rules: Array<{ type: string; formulae: string[] }>;
    }>;
    const refs = cfs.map((c) => c.ref).sort();
    expect(refs).toEqual(['A3:A340', 'AH3:AM340', 'AH3:AM340', 'AN3:AN340', 'P3:P340'].sort());
    const formulas = cfs.flatMap((c) => c.rules.map((r) => r.formulae[0]));
    expect(cfs.every((c) => c.rules.every((r) => r.type === 'expression'))).toBe(true);
    expect(formulas).toContain('AH3<$Q3');
    expect(formulas).toContain('AH3<$Q3*3');
    expect(formulas).toContain('P3>$Q3');
    expect(formulas).toContain('COUNTIF($A$3:$A$340,A3)>1');
    expect(formulas).toContain('AND(ISNUMBER(AN3),AN3<=0)');
    for (const f of formulas) expect(f).not.toMatch(/(?<![$A-Z])Q\d/);
  });

  it('formatos no XML com a barra do PO.COMP.01 e recalculo ao abrir', async () => {
    const estilos = await xmlDoArquivo(bufferA, 'xl/styles.xml');
    expect(estilos).toContain('formatCode="_-* #,##0_-;\\-* #,##0_-;_-* &quot;-&quot;??_-;_-@_-"');
    expect(estilos).toContain('formatCode="_-* #,##0.0_-;\\-* #,##0.0_-;_-* &quot;-&quot;?_-;_-@_-"');
    expect(await xmlDoArquivo(bufferA, 'xl/workbook.xml')).toMatch(/<calcPr[^>]*fullCalcOnLoad="1"/);
  });

  it('nao grava preco fechado nem nome de cliente', () => {
    const av = ws().getColumn('AV');
    const valores: unknown[] = [];
    av.eachCell((c, r) => {
      if (r >= 3 && c.value !== null) valores.push(c.value);
    });
    expect(valores.every((v) => v === 'X')).toBe(true);
    expect(valores.length).toBe(fixture.produtos.filter((p) => p.precoFechado.trim().toUpperCase() === 'X').length);
  });

  it('aba Regras traz os paragrafos fixos', () => {
    const regras = wbA.getWorksheet('Regras')!;
    expect(regras.getColumn('A').width).toBe(120);
    const textos: string[] = [];
    regras.eachRow((row) => textos.push(String(row.getCell('A').value)));
    const esperado = PARAGRAFOS_REGRAS_MACRO({
      label: '10-2',
      origin: 'planilha',
      dataBase: '2026-10-15',
      hoje: HOJE,
      somarChegada5oMes: true,
      produtosComMarca: MARCAS.size,
    });
    expect(textos).toEqual(esperado);
    expect(textos[0]).toContain('quinzena 10-2 (planilha), data-base 15/10/2026, calculada em 20/10/2026');
    expect(textos.some((t) => t.startsWith('4 produto(s) com mês de venda atípico'))).toBe(true);
    expect(textos.at(-2)).toBe(
      'Cor da célula do item: verde = PO enviada; laranja = Confirmado, aguarda PO; amarelo = Cotando; azul = Só atualização de preço; sem cor = Cotação não enviada.',
    );
    const dbcorp = PARAGRAFOS_REGRAS_MACRO({
      label: '10-1',
      origin: 'dbcorp',
      dataBase: '2026-10-01',
      hoje: HOJE,
      somarChegada5oMes: false,
      produtosComMarca: 0,
    });
    expect(dbcorp[0]).toContain('(relatórios DBCorp)');
    expect(dbcorp.some((t) => t.includes('A projeção do 5º mês'))).toBe(false);
    expect(dbcorp.some((t) => t.includes('atípico'))).toBe(false);
  });
});

// ---- 4.6 Sinteticos (nenhum dado real) ----
describe('casos sinteticos', () => {
  const produto = (linha: number, extra: Partial<Produto> = {}): Produto => ({
    linha,
    n: linha - 2,
    item: `PRODUTO ${900 + linha}`,
    codigos: ['C9001', '', '', '', '', '', ''],
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
    ...extra,
  });
  const entradas = (extra: Partial<Entradas> = {}): Entradas => ({
    estoque: [{ codigo: 'C9001', qtd: 100 }],
    vendasMes: [{ codigo: 'C9001', qtd: 60 }],
    vendasAtual: [{ codigo: 'C9001', qtd: 15 }],
    vendasAnual: [{ codigo: 'C9001', qtd: 900 }],
    programacoes: [{ codigo: 'C9001', qtd: 10, mes: '10' }],
    chegadas: [{ codigo: 'C9001', qtd: 20, mes: '11' }],
    leadtime: [{ fonte: 'FONTE 901', total: 30 }],
    margem: [{ codigo: 'C9001', margem: 0.25 }],
    clientesAtivos: ['C9001', 'c9001', 'C9999'],
    ...extra,
  });
  const quinzena = (produtos: Produto[], ent: Entradas = entradas(), extra: Partial<Quinzena> = {}): Quinzena => ({
    id: '10-2',
    arquivo: '',
    dataBase: '2026-10-15',
    mesesConsumo: ['04', '05', '06', '07', '08', '09', '10 (ATUAL)'],
    mesesChegada: ['10', '11', '12', '01', '02'],
    mesesProgramacao: ['10', '11', '12', '01'],
    produtos,
    entradas: ent,
    esperado: {},
    ...extra,
  });
  const gerar = async (q: Quinzena, extra: Partial<EntradaForecastMacro> = {}) => {
    const e: EntradaForecastMacro = { quinzena: q, hoje: HOJE, half: 2, origin: 'planilha', ...extra };
    const buffer = await gerarXlsxForecastMacro(e);
    return { e, buffer, wb: await carregar(buffer) };
  };

  it('fonte fora da LEADTIME: T, AN, AP e AQ com erro em cache, formula #N/A e null na reimportacao', async () => {
    const q = quinzena([produto(3, { fonte: 'FONTE 999' })]);
    const { e, buffer, wb } = await gerar(q);
    const ws = wb.getWorksheet(MACRO)!;
    for (const col of ['T', 'AN', 'AQ']) {
      expect((ws.getCell(`${col}3`).value as { result?: unknown }).result).toEqual({ error: '#N/A' });
    }
    // AP tem formato de data: o leitor do exceljs converte o erro em data invalida; o XML traz o erro.
    expect(await xmlDoArquivo(buffer, 'xl/worksheets/sheet1.xml')).toMatch(/<c r="AP3"[^>]*t="e"><f>[^<]*<\/f><v>#N\/A<\/v>/);
    const p = paridade(wb, q, e);
    expect(p.resultado.batem).toBe(p.resultado.celulas);
    expect(p.aps[0]).toEqual({ esperado: null, formula: null });
    const r = await parseForecastWorkbook(buffer, { label: '10-2', baseDate: '2026-10-15' });
    for (const col of ['T', 'AN', 'AQ']) expect(r.quinzena.esperado['3'][col]).toBeNull();
    expect(r.avisos.some((a) => a.includes('FONTE 999'))).toBe(true);
  });

  it('Q = 0: AA vira o texto "0" (cache e formula)', async () => {
    const q = quinzena([produto(3, { codigos: ['C9005', '', '', '', '', '', ''], historico: [0, 0, 0, 0, 0] })]);
    const { e, wb } = await gerar(q);
    const av = criarAvaliador(wb);
    expect(av.valor(MACRO, 'Q3')).toBe(0);
    expect(av.valor(MACRO, 'AA3')).toBe('0');
    expect(calcular(q, opcoesDoMotor(e))[0].AA).toBe('0');
    const p = paridade(wb, q, e);
    expect(p.resultado.batem).toBe(p.resultado.celulas);
  });

  it('codigo so em G e H, status preco, margem sem cadastro e margem duplicada', async () => {
    const q = quinzena(
      [
        produto(3, { codigos: ['', '', '', '', '', 'C9002', 'C9003'], status: 'preco' }),
        produto(4, { codigos: ['C9007', '', '', '', '', '', ''], status: 'confirmado' }),
      ],
      entradas({
        estoque: [
          { codigo: 'C9002', qtd: 5 },
          { codigo: 'C9003', qtd: 7 },
        ],
        margem: [
          { codigo: 'C9003', margem: 0.1 },
          { codigo: 'c9003', margem: 0.9 },
          { codigo: 'C9500', margem: 0.5 },
        ],
      }),
    );
    const { e, buffer, wb } = await gerar(q);
    const ws = wb.getWorksheet(MACRO)!;
    expect(((ws.getCell('I3').fill as exceljs.FillPattern).fgColor as exceljs.Color).argb).toBe('FF00B0F0');
    expect(((ws.getCell('I4').fill as exceljs.FillPattern).fgColor as exceljs.Color).argb).toBe('FFFFC000');
    const av = criarAvaliador(wb);
    expect(av.valor(MACRO, 'U3')).toBe(12);
    expect(av.valor(MACRO, 'AR3')).toBe(0.1); // so a 1a ocorrencia de C9003
    expect(av.valor(MACRO, 'AR4')).toBe('');
    expect(margemUsada(q)).toEqual([{ codigo: 'C9003', margem: 0.1 }]);
    const p = paridade(wb, q, e);
    expect(p.resultado.batem).toBe(p.resultado.celulas);
    const r = await parseForecastWorkbook(buffer, { label: '10-2', baseDate: '2026-10-15' });
    expect(r.quinzena.produtos[0].status).toBe('preco');
    expect(r.quinzena.produtos[1].status).toBe('confirmado');
    expect(r.quinzena.entradas.margem).toEqual([{ codigo: 'C9003', margem: 0.1 }]);
    const margem = wb.getWorksheet('MARGEM')!;
    expect(margem.rowCount).toBe(2);
  });

  it('preco fechado: so o X sai (sem caixa); texto qualquer vira celula vazia; naoFraciona idem', async () => {
    const q = quinzena([
      produto(3, { precoFechado: 'x', naoFraciona: ' X ' }),
      produto(4, { precoFechado: 'R$ 10', naoFraciona: 'sim', codigos: ['C9004', '', '', '', '', '', ''] }),
    ]);
    const { wb } = await gerar(q);
    const ws = wb.getWorksheet(MACRO)!;
    expect(ws.getCell('AV3').value).toBe('X');
    expect(ws.getCell('AX3').value).toBe('X');
    expect(ws.getCell('AV4').value).toBeNull();
    expect(ws.getCell('AX4').value).toBeNull();
  });

  it('programacao diferente da chegada: AC2.. vira texto sem formula; AH2.. segue AC2..', async () => {
    const q = quinzena([produto(3)], entradas(), { mesesProgramacao: ['11', '12', '01', '02'] });
    const { wb } = await gerar(q);
    const ws = wb.getWorksheet(MACRO)!;
    expect(ws.getCell('AC2').value).toBe('11');
    expect(formulaDe(ws, 'AH2')).toBe('AC2');
    expect(criarAvaliador(wb).valor(MACRO, 'AH2')).toBe('11');
  });

  it('codigos com 6 posicoes: lanca; hoje invalido: lanca', async () => {
    const seis = quinzena([produto(3, { codigos: ['C9001', '', '', '', '', ''] })]);
    await expect(gerarXlsxForecastMacro({ quinzena: seis, hoje: HOJE, half: 2, origin: 'planilha' })).rejects.toThrow(
      'Produto com codigos fora do padrao de 7 posicoes (linha 3).',
    );
    await expect(
      gerarXlsxForecastMacro({ quinzena: quinzena([produto(3)]), hoje: '2026-13-01', half: 2, origin: 'planilha' }),
    ).rejects.toThrow('Data invalida');
  });

  it('nome do arquivo e sanitizado', () => {
    expect(nomeArquivoForecastMacro({ label: '10-2', hoje: '2026-10-20' })).toBe('forecast-macro-10-2-2026-10-20.xlsx');
    expect(nomeArquivoForecastMacro({ label: '../x', hoje: '2026-10-20' })).toBe('forecast-macro----x-2026-10-20.xlsx');
  });

  it('clientes ativos: so os codigos dos produtos, na ordem original', () => {
    const q = quinzena([produto(3)]);
    expect(clientesDosProdutos(q)).toEqual(['C9001', 'c9001']);
  });
});

// ---- 4.7 Opcional, so local: arquivo recalculado pelo Excel ----
describe('Excel desktop (so local, fora do CI)', () => {
  it.skipIf(!process.env.FORECAST_MACRO_EXCEL)('arquivo recalculado pelo Excel bate com o motor', async () => {
    const buffer = readFileSync(process.env.FORECAST_MACRO_EXCEL as string);
    const r = await parseForecastWorkbook(buffer, { label: '10-2', baseDate: '2026-10-15' });
    const c = conferir(r.quinzena, calcular(fixture, opcoesDoMotor(OPCOES_A)));
    expect(c.divergencias.slice(0, 5)).toEqual([]);
    expect(c.celulas).toBe(9464);
    expect(c.batem).toBe(9464);
  });
});
