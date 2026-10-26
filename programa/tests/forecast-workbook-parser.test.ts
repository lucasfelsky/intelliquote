import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import exceljs from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { FORECAST_SHEETS, FORECAST_STATUS_COLORS } from '../src/constants/forecast';
import { calcular, conferir } from '../src/utils/forecastEngine';
import type { Entradas, Produto, Quinzena } from '../src/utils/forecastTypes';
import { COLUNAS_CONFERIDAS } from '../src/utils/forecastTypes';
import { parseForecastWorkbook } from '../src/utils/forecastWorkbook';
import { findHeaderColumn, mesComoTexto, normalizeHeader, valor } from '../src/utils/forecastXlsx';

// Fixture ANONIMIZADA (repo publico): scripts/forecast-anonymize-fixture.mjs.
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8'),
) as Quinzena;

const LABEL = '10-2';
const BASE_DATE = '2026-10-15';
const HOJE = '2026-10-20';

const COLUNAS_CODIGO = ['B', 'C', 'D', 'E', 'F', 'G', 'H'];
const COLUNAS_HISTORICO = ['J', 'K', 'L', 'M', 'N'];

interface BuildOptions {
  omitSheets?: string[];
  // Escreve a coluna MES das abas PROGRAMACOES/CHEGADAS como data de serie (como o Excel/exceljs leem).
  mesComoData?: boolean;
  // Linhas extras na FORECAST (MACRO), sem formula em Q.
  linhaSemFormula?: { item: string };
  // Cor (ARGB) do item, por linha da planilha.
  cores?: Record<number, string>;
}

// Monta em memoria uma planilha no layout da PO.COMP.01 a partir de uma quinzena (anonimizada).
async function buildWorkbook(q: Quinzena, options: BuildOptions = {}): Promise<Buffer> {
  const wb = new exceljs.Workbook();
  const sheet = (name: string) => (options.omitSheets?.includes(name) ? null : wb.addWorksheet(name));
  const serie = (mes: string) => new Date(Date.UTC(1899, 11, 30) + Number(mes) * 86400000);
  const mesCell = (mes: string) => (options.mesComoData ? serie(mes) : mes);

  const macro = sheet(FORECAST_SHEETS.macro);
  if (macro) {
    ['J', 'K', 'L', 'M', 'N', 'O', 'P'].forEach((col, i) => (macro.getCell(`${col}2`).value = q.mesesConsumo[i]));
    ['V', 'W', 'X', 'Y', 'Z'].forEach((col, i) => (macro.getCell(`${col}2`).value = q.mesesChegada[i]));
    ['AC', 'AD', 'AE', 'AF'].forEach((col, i) => (macro.getCell(`${col}2`).value = q.mesesProgramacao[i]));
    for (const p of q.produtos) {
      const r = p.linha;
      const set = (col: string, value: string | number | null) => {
        if (value !== null && value !== '') macro.getCell(`${col}${r}`).value = value;
      };
      set('A', p.n);
      COLUNAS_CODIGO.forEach((col, i) => set(col, p.codigos[i]));
      set('I', p.item);
      COLUNAS_HISTORICO.forEach((col, i) => set(col, p.historico[i]));
      set('AO', p.analiseForecast);
      set('AT', p.obs);
      set('AU', p.fonte);
      set('AV', p.precoFechado);
      set('AW', p.embalagem);
      set('AX', p.naoFraciona);
      set('AY', p.qtdAmostra);
      set('AZ', p.solicitarAmostra);
      const argb =
        options.cores?.[r] ??
        Object.entries(FORECAST_STATUS_COLORS).find(([, status]) => status === p.status)?.[0];
      if (argb) {
        macro.getCell(`I${r}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
      }
      const esperado = q.esperado[String(r)] ?? {};
      for (const col of COLUNAS_CONFERIDAS) {
        const value = esperado[col];
        if (value === null || value === undefined || value === '') continue;
        macro.getCell(`${col}${r}`).value = { formula: '1+0', result: value };
      }
    }
    if (options.linhaSemFormula) {
      const r = Math.max(...q.produtos.map((p) => p.linha)) + 1;
      macro.getCell(`I${r}`).value = options.linhaSemFormula.item;
      macro.getCell(`Q${r}`).value = 123;
    }
  }

  const lancamentos = (name: string, start: number, colCod: string, colQtd: string, lista: Entradas['estoque']) => {
    const ws = sheet(name);
    if (!ws) return;
    lista.forEach(({ codigo, qtd }, i) => {
      ws.getCell(`${colCod}${start + i}`).value = codigo;
      ws.getCell(`${colQtd}${start + i}`).value = qtd;
    });
  };
  const lancamentosMes = (
    name: string,
    start: number,
    colCod: string,
    colQtd: string,
    colMes: string,
    lista: Entradas['chegadas'],
  ) => {
    const ws = sheet(name);
    if (!ws) return;
    lista.forEach(({ codigo, qtd, mes }, i) => {
      ws.getCell(`${colCod}${start + i}`).value = codigo;
      ws.getCell(`${colQtd}${start + i}`).value = qtd;
      const cell = ws.getCell(`${colMes}${start + i}`);
      cell.value = mesCell(mes);
      if (options.mesComoData) cell.numFmt = 'dd/mm/yyyy';
    });
  };
  const e = q.entradas;
  lancamentos(FORECAST_SHEETS.estoque, 7, 'A', 'E', e.estoque);
  lancamentos(FORECAST_SHEETS.vendasMes, 6, 'B', 'D', e.vendasMes);
  lancamentos(FORECAST_SHEETS.vendasAtual, 6, 'B', 'D', e.vendasAtual);
  lancamentos(FORECAST_SHEETS.vendasAnual, 6, 'B', 'D', e.vendasAnual);
  lancamentosMes(FORECAST_SHEETS.programacoes, 7, 'A', 'D', 'I', e.programacoes);
  lancamentosMes(FORECAST_SHEETS.chegadas, 2, 'E', 'L', 'Z', e.chegadas);

  const leadtime = sheet(FORECAST_SHEETS.leadtime);
  if (leadtime) {
    e.leadtime.forEach(({ fonte, total }, i) => {
      const r = 3 + i;
      leadtime.getCell(`A${r}`).value = fonte;
      // Componentes B..F: o total fica todo em B (o parser le cada coluna; so a soma importa aqui).
      leadtime.getCell(`B${r}`).value = total ?? 0;
      for (const col of ['C', 'D', 'E', 'F']) leadtime.getCell(`${col}${r}`).value = 0;
      // G = SUM(B:F): o exceljs nao grava o resultado quando ele e 0.
      leadtime.getCell(`G${r}`).value = { formula: `SUM(B${r}:F${r})`, result: total ?? 0 };
    });
  }
  const margem = sheet(FORECAST_SHEETS.margem);
  if (margem) {
    e.margem.forEach(({ codigo, margem: m }, i) => {
      margem.getCell(`A${2 + i}`).value = codigo;
      if (m !== null) margem.getCell(`B${2 + i}`).value = m;
    });
  }
  const clientes = sheet(FORECAST_SHEETS.clientesAtivos);
  if (clientes) {
    e.clientesAtivos.forEach((codigo, i) => (clientes.getCell(`C${6 + i}`).value = codigo));
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Quinzena pequena (3 produtos e entradas filtradas) para os casos que nao precisam do volume todo.
function smallQuinzena(): Quinzena {
  const produtos = fixture.produtos.slice(0, 3).map((p) => ({ ...p }));
  const codigos = new Set(produtos.flatMap((p) => p.codigos.filter(Boolean)));
  const fontes = new Set(produtos.map((p) => p.fonte));
  const e = fixture.entradas;
  const doProduto = <T extends { codigo: string }>(lista: T[]) => lista.filter((l) => codigos.has(l.codigo));
  return {
    ...fixture,
    produtos,
    entradas: {
      estoque: doProduto(e.estoque),
      vendasMes: doProduto(e.vendasMes),
      vendasAtual: doProduto(e.vendasAtual),
      vendasAnual: doProduto(e.vendasAnual),
      programacoes: doProduto(e.programacoes),
      chegadas: doProduto(e.chegadas),
      leadtime: e.leadtime.filter((l) => fontes.has(l.fonte)),
      margem: e.margem.filter((m) => codigos.has(m.codigo)),
      clientesAtivos: e.clientesAtivos.filter((c) => codigos.has(c)),
    },
    esperado: Object.fromEntries(produtos.map((p) => [String(p.linha), fixture.esperado[String(p.linha)]])),
  };
}

const parse = (buffer: Buffer, label = LABEL, baseDate = BASE_DATE) =>
  parseForecastWorkbook(buffer, { label, baseDate, fileName: 'teste.xlsx' });

describe('parseForecastWorkbook - planilha montada a partir da fixture anonimizada', () => {
  let completo: Awaited<ReturnType<typeof parse>>;

  beforeAll(async () => {
    completo = await parse(await buildWorkbook(fixture));
  }, 60_000);

  it('le cadastro, entradas e meses sem erros nem avisos', () => {
    expect(completo.erros).toEqual([]);
    expect(completo.avisos).toEqual([]);
    expect(completo.quinzena.id).toBe(LABEL);
    expect(completo.quinzena.dataBase).toBe(BASE_DATE);
    expect(completo.quinzena.arquivo).toBe('teste.xlsx');
    expect(completo.quinzena.mesesConsumo).toEqual(fixture.mesesConsumo);
    expect(completo.quinzena.mesesChegada).toEqual(fixture.mesesChegada);
    expect(completo.quinzena.mesesProgramacao).toEqual(fixture.mesesProgramacao);
    expect(completo.quinzena.produtos).toEqual(fixture.produtos);
    expect(completo.quinzena.entradas).toEqual(fixture.entradas);
  });

  it('o motor sobre o que o parser leu bate com todas as celulas do Excel (9.464)', () => {
    const linhas = calcular(completo.quinzena, { hoje: HOJE, somarChegada5oMes: false });
    const r = conferir(completo.quinzena, linhas);
    expect(r.divergencias.slice(0, 5)).toEqual([]);
    expect(r.celulas).toBe(9464);
    expect(r.batem).toBe(9464);
  });

  it('le as fontes da LEADTIME com os componentes e o total', () => {
    expect(completo.fontes).toHaveLength(fixture.entradas.leadtime.length);
    const primeira = fixture.entradas.leadtime[0];
    expect(completo.fontes[0]).toEqual({
      name: primeira.fonte,
      normalizedName: primeira.fonte.toUpperCase(),
      readinessDays: primeira.total,
      holidaysDays: 0,
      shippingDays: 0,
      transitDays: 0,
      clearanceDays: 0,
      total: primeira.total,
    });
  });

  it('o mes da VENDAS MENSAL vem do cabecalho O2 (09 na quinzena 10-2 = 2026-09)', () => {
    expect(completo.vendasMensal.yearMonth).toBe('2026-09');
    expect(completo.vendasMensal.linhas).toEqual(fixture.entradas.vendasMes);
  });
});

describe('parseForecastWorkbook - casos pontuais', () => {
  it('resultado de formula igual a 0 volta como 0 (o exceljs o descarta)', async () => {
    const q = smallQuinzena();
    const zerado = { ...q, esperado: { ...q.esperado, [String(q.produtos[0].linha)]: { ...q.esperado[String(q.produtos[0].linha)], U: 0, V: 0 } } };
    const parsed = await parse(await buildWorkbook(zerado));
    const esperado = parsed.quinzena.esperado[String(q.produtos[0].linha)];
    expect(esperado.U).toBe(0);
    expect(esperado.V).toBe(0);
    // O total da LEADTIME (formula SUM) tambem sobrevive ao zero.
    const q0 = { ...q, entradas: { ...q.entradas, leadtime: q.entradas.leadtime.map((l, i) => (i === 0 ? { ...l, total: 0 } : l)) } };
    const parsed0 = await parse(await buildWorkbook(q0));
    expect(parsed0.fontes[0].total).toBe(0);
    expect(parsed0.quinzena.entradas.leadtime[0].total).toBe(0);
  });

  it('valor() trata formula sem resultado como 0, erro como null e texto rico juntado', () => {
    const cell = (value: unknown) => ({ value }) as unknown as exceljs.Cell;
    expect(valor(cell({ formula: 'A1-A1' }))).toBe(0);
    expect(valor(cell({ sharedFormula: 'Q3' }))).toBe(0);
    expect(valor(cell({ formula: 'X', result: 7 }))).toBe(7);
    expect(valor(cell({ formula: 'X', result: { error: '#N/D' } }))).toBeNull();
    expect(valor(cell({ error: '#REF!' }))).toBeNull();
    expect(valor(cell({ richText: [{ text: 'AB' }, { text: 'C' }] }))).toBe('ABC');
    expect(valor(cell(new Date(Date.UTC(2026, 9, 5))))).toBe('2026-10-05');
    expect(valor(cell(null))).toBeNull();
  });

  it('Observacao (coluna AT) acima de 1.000 caracteres e erro; com 1.000 passa', async () => {
    const comObs = (tamanho: number): Quinzena => {
      const q = smallQuinzena();
      q.produtos[0] = { ...q.produtos[0], obs: 'X'.repeat(tamanho) };
      return q;
    };
    const longa = await parse(await buildWorkbook(comObs(1001)));
    expect(longa.erros.some((e) => /Observacao \(coluna AT\) da linha \d+ tem 1001 caracteres \(limite de 1000\)/.test(e))).toBe(true);
    const limite = await parse(await buildWorkbook(comObs(1000)));
    expect(limite.erros.some((e) => e.includes('Observacao'))).toBe(false);
  });

  it('coluna MES lida como data de serie volta para o texto MM', async () => {
    const q = smallQuinzena();
    expect(q.entradas.chegadas.length).toBeGreaterThan(0);
    const parsed = await parse(await buildWorkbook(q, { mesComoData: true }));
    expect(parsed.quinzena.entradas.programacoes).toEqual(q.entradas.programacoes);
    expect(parsed.quinzena.entradas.chegadas).toEqual(q.entradas.chegadas);
    expect(mesComoTexto('1900-01-09')).toBe('10');
    expect(mesComoTexto(10)).toBe('10');
    expect(mesComoTexto(1)).toBe('01');
    expect(mesComoTexto('11')).toBe('11');
    expect(mesComoTexto(null)).toBe('');
  });

  it('ignora a linha da FORECAST (MACRO) sem formula em Q', async () => {
    const q = smallQuinzena();
    const parsed = await parse(await buildWorkbook(q, { linhaSemFormula: { item: 'ITEM SEM CALCULO' } }));
    expect(parsed.erros).toEqual([]);
    expect(parsed.quinzena.produtos).toHaveLength(3);
    expect(parsed.quinzena.produtos.some((p) => p.item === 'ITEM SEM CALCULO')).toBe(false);
  });

  it('traduz a cor do item para o status (4 cores) e usa "nao" sem cor conhecida', async () => {
    const q = smallQuinzena();
    const [a, b, c] = q.produtos;
    const parsed = await parse(
      await buildWorkbook(q, {
        cores: { [a.linha]: 'FF00B0F0', [b.linha]: 'FF00B050', [c.linha]: 'FF123456' },
      }),
    );
    expect(parsed.quinzena.produtos.map((p) => p.status)).toEqual(['preco', 'po', 'nao']);
  });

  it('aba ausente e erro que bloqueia', async () => {
    const parsed = await parse(await buildWorkbook(smallQuinzena(), { omitSheets: [FORECAST_SHEETS.leadtime] }));
    expect(parsed.erros).toEqual([`Aba "${FORECAST_SHEETS.leadtime}" nao encontrada.`]);
    expect(parsed.quinzena.produtos).toEqual([]);
  });

  it('codigo em 2 produtos e produto duplicado bloqueiam', async () => {
    const q = smallQuinzena();
    const [a, b] = q.produtos;
    const repetido: Quinzena = {
      ...q,
      produtos: [a, { ...b, codigos: [a.codigos[0].toLowerCase(), ...b.codigos.slice(1)] }, { ...q.produtos[2], item: a.item.toLowerCase() }],
    };
    const parsed = await parse(await buildWorkbook(repetido));
    expect(parsed.erros.some((e) => /Codigo .* em 2 produtos/.test(e))).toBe(true);
    expect(parsed.erros.some((e) => /Produto duplicado/.test(e))).toBe(true);
  });

  it('codigo repetido dentro do mesmo produto bloqueia', async () => {
    const q = smallQuinzena();
    const [a] = q.produtos;
    const repetido: Quinzena = { ...q, produtos: [{ ...a, codigos: [a.codigos[0], a.codigos[0], '', '', '', '', ''] }] };
    const parsed = await parse(await buildWorkbook(repetido));
    expect(parsed.erros.some((e) => /repetido no mesmo produto/.test(e))).toBe(true);
  });

  it('mais de 500 produtos bloqueia', async () => {
    const base = smallQuinzena();
    const modelo: Produto = base.produtos[0];
    const produtos = Array.from({ length: 501 }, (_, i) => ({
      ...modelo,
      linha: 3 + i,
      item: `PRODUTO SINTETICO ${i}`,
      codigos: [`S${i}`, '', '', '', '', '', ''],
    }));
    const parsed = await parse(
      await buildWorkbook({
        ...base,
        produtos,
        esperado: Object.fromEntries(produtos.map((p) => [String(p.linha), { Q: 1 }])),
      }),
    );
    expect(parsed.erros.some((e) => /501 produtos/.test(e))).toBe(true);
  }, 30_000);

  it('rotulo da quinzena e data base invalidos bloqueiam', async () => {
    const buffer = await buildWorkbook(smallQuinzena());
    const rotulo = await parse(buffer, '10-3');
    expect(rotulo.erros.some((e) => /Rotulo da quinzena invalido/.test(e))).toBe(true);
    const data = await parse(buffer, LABEL, '2026-02-30');
    expect(data.erros.some((e) => /Data base invalida/.test(e))).toBe(true);
  });

  it('fonte de produto ausente na LEADTIME e aviso (nao erro)', async () => {
    const q = smallQuinzena();
    const parsed = await parse(
      await buildWorkbook({ ...q, entradas: { ...q.entradas, leadtime: q.entradas.leadtime.filter((l) => l.fonte !== q.produtos[0].fonte) } }),
    );
    expect(parsed.erros).toEqual([]);
    expect(parsed.avisos.some((a) => a.includes(q.produtos[0].fonte) && /LEADTIME/.test(a))).toBe(true);
  });

  it('avisa quando o mes da VENDAS MENSAL difere do mes anterior a data base', async () => {
    const parsed = await parse(await buildWorkbook(smallQuinzena()), LABEL, '2026-11-15');
    expect(parsed.erros).toEqual([]);
    expect(parsed.vendasMensal.yearMonth).toBe('2026-09');
    expect(parsed.avisos.some((a) => /2026-09/.test(a) && /2026-10/.test(a))).toBe(true);
  });

  it('arquivo que nao e xlsx vira 400', async () => {
    await expect(parse(Buffer.from('isto nao e uma planilha'))).rejects.toMatchObject({ status: 400 });
  });
});

describe('forecastXlsx - cabecalho normalizado', () => {
  it('normalizeHeader remove acento, espacos nas pontas e caixa', () => {
    expect(normalizeHeader('  Código Item ')).toBe('codigo item');
    expect(normalizeHeader('QTD - KGS')).toBe('qtd - kgs');
  });

  it('findHeaderColumn acha a coluna pelo cabecalho normalizado', () => {
    const ws = new exceljs.Workbook().addWorksheet('X');
    ws.getRow(1).values = ['Descrição', 'Código Item', 'Quantidade '];
    expect(findHeaderColumn(ws.getRow(1), ['codigo item'])).toBe(2);
    expect(findHeaderColumn(ws.getRow(1), ['QUANTIDADE'])).toBe(3);
    expect(findHeaderColumn(ws.getRow(1), ['inexistente'])).toBeNull();
  });
});

// Prova de fidelidade do porte (arquivos reais ficam FORA do repo; so na maquina do Comex).
describe('parseForecastWorkbook - arquivo real x JSON do prototipo', () => {
  it.skipIf(!process.env.FORECAST_XLSX || !process.env.FORECAST_JSON)(
    'reproduz produtos, entradas, esperado e meses do JSON gerado pelo importador do prototipo',
    async () => {
      const real = JSON.parse(readFileSync(process.env.FORECAST_JSON as string, 'utf8')) as Quinzena;
      const parsed = await parseForecastWorkbook(readFileSync(process.env.FORECAST_XLSX as string), {
        label: real.id,
        baseDate: real.dataBase,
      });
      expect(parsed.erros).toEqual([]);
      expect(parsed.quinzena.produtos).toEqual(real.produtos);
      expect(parsed.quinzena.entradas).toEqual(real.entradas);
      expect(parsed.quinzena.esperado).toEqual(real.esperado);
      expect(parsed.quinzena.mesesConsumo).toEqual(real.mesesConsumo);
      expect(parsed.quinzena.mesesChegada).toEqual(real.mesesChegada);
      expect(parsed.quinzena.mesesProgramacao).toEqual(real.mesesProgramacao);
      // E o motor sobre o que foi lido bate com o Excel.
      const r = conferir(
        parsed.quinzena,
        calcular(parsed.quinzena, { hoje: '2026-10-20', somarChegada5oMes: false }),
      );
      expect(r.batem).toBe(r.celulas);
    },
    60_000,
  );
});
