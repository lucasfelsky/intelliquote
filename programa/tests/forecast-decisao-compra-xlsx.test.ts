import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import exceljs from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
// O arquivo importa utilitarios que podem tocar o Prisma por import transitivo; aqui so ha funcoes puras.
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));

import { FORECAST_SHEETS } from '../src/constants/forecast';
import {
  anexarDecisoesAoRelatorio,
  itemDaListaDeCompra,
  paraDecisaoCompraData,
  produtosComDecisao,
  type DecisaoCompraData,
} from '../src/utils/forecastDecisaoCompra';
import { COLUNAS_DECISAO_XLSX, celulasDaDecisao } from '../src/utils/forecastDecisaoCompraXlsx';
import { gerarXlsxForecastMacro } from '../src/utils/forecastMacroXlsx';
import { montarRelatorioCompras, type LinhaParaRelatorio } from '../src/utils/forecastRelatorioCompras';
import {
  ABA_POR_URGENCIA,
  ABA_RELATORIO,
  COLUNAS_POR_URGENCIA_XLSX,
  COLUNAS_RELATORIO_XLSX,
  STATUS_ROTULO_XLSX,
  celulasDoItem,
  gerarXlsxRelatorioCompras,
} from '../src/utils/forecastRelatorioComprasXlsx';
import { parseForecastWorkbook } from '../src/utils/forecastWorkbook';
import type { Quinzena } from '../src/utils/forecastTypes';

// Repo PUBLICO: so dados sinteticos e a fixture anonimizada.
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8'),
) as Quinzena;

const BASE = '2026-10-15';
const HOJE = '2026-10-20';

const decisao = (over: Partial<DecisaoCompraData> = {}): DecisaoCompraData => ({
  productId: 1,
  quantidadeKg: 1500,
  status: 'cotando',
  observacao: null,
  sugeridaKg: 1000,
  demandaKg: -800,
  decididaPorId: 7,
  criadaEm: '2026-10-26T12:00:00.000Z',
  atualizadaEm: '2026-10-26T13:00:00.000Z',
  ...over,
});

function linha(
  parcial: Partial<LinhaParaRelatorio> & Pick<LinhaParaRelatorio, 'linha' | 'item' | 'fonte'>,
): LinhaParaRelatorio {
  return {
    codigos: [`C${String(parcial.linha).padStart(4, '0')}`],
    status: 'nao',
    Q: 60,
    AG: 60,
    U: 0,
    AN: -100,
    AQ: 30,
    projecao: [40, -20, -80, -140, -200, -260],
    chegadas: [0, 0, 0, 0, 0],
    programacoes: [0, 0, 0, 0],
    ...parcial,
  };
}

const relatorio = () =>
  montarRelatorioCompras(
    { id: 1, label: '10-2', baseDate: BASE, half: 2, origin: 'planilha', hoje: HOJE, linhas: [
      linha({ linha: 1, item: 'PRODUTO 001', fonte: 'FONTE 001', productId: 11, AN: -450 }),
      linha({ linha: 2, item: 'PRODUTO 002', fonte: 'FONTE 001', productId: 12, AN: -50, status: 'po' }),
      linha({ linha: 3, item: 'PRODUTO 003', fonte: 'FONTE 002', productId: 13, AN: -30 }),
    ] },
    [],
  );

const itensDe = (r: ReturnType<typeof relatorio>) => r.grupos.flatMap((g) => g.itens);

describe('paraDecisaoCompraData', () => {
  it('converte Decimal em numero e datas em ISO', () => {
    const d = paraDecisaoCompraData({
      productId: 3,
      quantityKg: { toString: () => '12.5', valueOf: () => 12.5 },
      status: 'po',
      note: 'N',
      suggestedKg: '10',
      demandKg: '-4.25',
      decidedById: null,
      createdAt: new Date('2026-10-26T12:00:00.000Z'),
      updatedAt: new Date('2026-10-26T13:00:00.000Z'),
    });
    expect(d).toEqual({
      productId: 3,
      quantidadeKg: 12.5,
      status: 'po',
      observacao: 'N',
      sugeridaKg: 10,
      demandaKg: -4.25,
      decididaPorId: null,
      criadaEm: '2026-10-26T12:00:00.000Z',
      atualizadaEm: '2026-10-26T13:00:00.000Z',
    });
  });
});

describe('itemDaListaDeCompra', () => {
  it('acha o item da lista pelo productId e devolve null fora dela', () => {
    const r = relatorio();
    expect(itemDaListaDeCompra(r, 12)?.item).toBe('PRODUTO 002');
    expect(itemDaListaDeCompra(r, 999)).toBeNull();
  });
});

describe('produtosComDecisao', () => {
  const produtos = [
    { linha: 3, productId: 11, analiseForecast: 500 as number | null },
    { linha: 4, productId: 12, analiseForecast: null as number | null },
    { linha: 5, productId: 13, analiseForecast: 900 as number | null },
    { linha: 6, analiseForecast: 70 as number | null },
  ];

  it('a decisao vence o analiseForecast congelado; 0 conta; sem decisao mantem', () => {
    const mapa = new Map([
      [11, decisao({ productId: 11, quantidadeKg: 1234.5 })],
      [12, decisao({ productId: 12, quantidadeKg: 0 })],
    ]);
    const out = produtosComDecisao(produtos, mapa);
    expect(out.map((p) => p.analiseForecast)).toEqual([1234.5, 0, 900, 70]);
  });

  it('nao muta a entrada', () => {
    const copia = JSON.parse(JSON.stringify(produtos));
    const out = produtosComDecisao(produtos, new Map([[11, decisao({ productId: 11, quantidadeKg: 1 })]]));
    expect(produtos).toEqual(copia);
    expect(out).not.toBe(produtos);
    expect(out[0]).not.toBe(produtos[0]);
  });
});

describe('anexarDecisoesAoRelatorio', () => {
  it('so os itens da lista de compra ganham decisao (null sem decisao); nao muta o relatorio', () => {
    const r = relatorio();
    const antes = JSON.stringify(r);
    const out = anexarDecisoesAoRelatorio(r, new Map([[12, decisao({ productId: 12 })]]));
    expect(JSON.stringify(r)).toBe(antes);
    const itens = itensDe(out);
    expect(itens.map((i) => [i.item, i.decisao?.productId ?? null])).toEqual(
      itensDe(r).map((i) => [i.item, i.productId === 12 ? 12 : null]),
    );
    expect(itens.every((i) => i.decisao === null || i.decisao?.productId === i.productId)).toBe(true);
    expect(out.semConsumo).toBe(r.semConsumo);
    expect(out.sobDemanda).toBe(r.sobDemanda);
  });

  it('a linha de grupo de equivalencia recebe a decisao do productId do PRINCIPAL (o da linha)', () => {
    const r = relatorio();
    const principal = itensDe(r).find((i) => i.productId === 11)!;
    principal.grupo = {
      nome: 'GRUPO SINTETICO',
      observacao: null,
      membros: [],
    } as unknown as NonNullable<typeof principal.grupo>;
    const out = anexarDecisoesAoRelatorio(r, new Map([[11, decisao({ productId: 11, quantidadeKg: 42 })]]));
    expect(itensDe(out).find((i) => i.productId === 11)?.decisao?.quantidadeKg).toBe(42);
  });
});

describe('celulasDaDecisao', () => {
  it('sem decisao: 3 celulas vazias', () => {
    expect(celulasDaDecisao(null, STATUS_ROTULO_XLSX)).toEqual(['', '', '']);
    expect(celulasDaDecisao(undefined, STATUS_ROTULO_XLSX)).toEqual(['', '', '']);
  });

  it('com decisao: quantidade numerica (0 continua 0), rotulo do status e observacao', () => {
    expect(celulasDaDecisao(decisao({ observacao: 'OBS' }), STATUS_ROTULO_XLSX)).toEqual([1500, 'Cotando', 'OBS']);
    expect(celulasDaDecisao(decisao({ quantidadeKg: 0, status: 'po' }), STATUS_ROTULO_XLSX)).toEqual([
      0,
      'PO enviada',
      '',
    ]);
    // Status desconhecido cai no proprio valor.
    expect(celulasDaDecisao(decisao({ status: 'xx' as never }), {})).toEqual([1500, 'xx', '']);
  });
});

describe('XLSX do relatorio de compras com decisoes', () => {
  const ESPERADO_FINAL = ['Grupo de equivalência', 'Qtd. decidida (kg)', 'Status da decisão', 'Obs. da decisão', 'Observação'];

  it('o cabecalho termina com as 3 colunas novas antes da Observacao (por fonte e Por urgencia)', async () => {
    expect([...COLUNAS_DECISAO_XLSX]).toEqual(['Qtd. decidida (kg)', 'Status da decisão', 'Obs. da decisão']);
    expect(COLUNAS_RELATORIO_XLSX.slice(-5)).toEqual(ESPERADO_FINAL);
    expect(COLUNAS_POR_URGENCIA_XLSX.slice(-5)).toEqual(ESPERADO_FINAL);
    expect(COLUNAS_RELATORIO_XLSX).toHaveLength(23);
    expect(COLUNAS_POR_URGENCIA_XLSX).toHaveLength(24);

    const r = anexarDecisoesAoRelatorio(relatorio(), new Map([[12, decisao({ productId: 12 })]]));
    const wb = new exceljs.Workbook();
    await wb.xlsx.load((await gerarXlsxRelatorioCompras(r)) as unknown as ArrayBuffer);
    const cabecalhoDe = (ws: exceljs.Worksheet, n: number, linhaCab: number) =>
      Array.from({ length: n }, (_, i) => String(ws.getRow(linhaCab).getCell(i + 1).value ?? '')).slice(-5);
    expect(cabecalhoDe(wb.getWorksheet(ABA_POR_URGENCIA)!, COLUNAS_POR_URGENCIA_XLSX.length, 1)).toEqual(ESPERADO_FINAL);
    // Aba por fonte: a linha do cabecalho e a que tem 'Item' na coluna A.
    const ws = wb.getWorksheet(ABA_RELATORIO)!;
    let cab = 0;
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      if (!cab && String(row.getCell(1).value ?? '') === 'Item') cab = n;
    });
    expect(cab).toBeGreaterThan(0);
    expect(cabecalhoDe(ws, COLUNAS_RELATORIO_XLSX.length, cab)).toEqual(ESPERADO_FINAL);
  });

  it('o item decidido preenche as 3 colunas (numFmt 0.0); o sem decisao fica vazio', async () => {
    const r = anexarDecisoesAoRelatorio(
      relatorio(),
      new Map([
        [12, decisao({ productId: 12, quantidadeKg: 0, status: 'po', observacao: 'OBS SINTETICA' })],
        [11, decisao({ productId: 11, quantidadeKg: 1234.5, status: 'confirmado' })],
      ]),
    );
    const wb = new exceljs.Workbook();
    await wb.xlsx.load((await gerarXlsxRelatorioCompras(r)) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet(ABA_POR_URGENCIA)!;
    const col = (nome: string) => COLUNAS_POR_URGENCIA_XLSX.indexOf(nome as never) + 1;
    const porItem = new Map<string, number>();
    ws.eachRow((row, n) => porItem.set(String(row.getCell(1).value), n));
    const celula = (item: string, nome: string) => ws.getRow(porItem.get(item)!).getCell(col(nome));

    expect(celula('PRODUTO 001', 'Qtd. decidida (kg)').value).toBe(1234.5);
    expect(celula('PRODUTO 001', 'Qtd. decidida (kg)').numFmt).toBe('0.0');
    expect(celula('PRODUTO 001', 'Status da decisão').value).toBe('Confirmado, aguarda PO');
    // 0 e uma decisao: a celula traz o numero 0, nao fica vazia.
    expect(celula('PRODUTO 002', 'Qtd. decidida (kg)').value).toBe(0);
    expect(celula('PRODUTO 002', 'Obs. da decisão').value).toBe('OBS SINTETICA');
    expect(celula('PRODUTO 003', 'Qtd. decidida (kg)').value ?? '').toBe('');
    expect(celula('PRODUTO 003', 'Status da decisão').value ?? '').toBe('');
    expect(celula('PRODUTO 003', 'Obs. da decisão').value ?? '').toBe('');
  });

  it.each(['=', '+', '-', '@'])('observacao da decisao iniciada por "%s" continua TEXTO', async (prefixo) => {
    const obs = `${prefixo}OBS SINTETICA`;
    const r = anexarDecisoesAoRelatorio(relatorio(), new Map([[12, decisao({ productId: 12, observacao: obs })]]));
    const wb = new exceljs.Workbook();
    await wb.xlsx.load((await gerarXlsxRelatorioCompras(r)) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet(ABA_POR_URGENCIA)!;
    let achou = false;
    ws.eachRow((row) => {
      if (String(row.getCell(1).value) !== 'PRODUTO 002') return;
      const v = row.getCell(COLUNAS_POR_URGENCIA_XLSX.indexOf('Obs. da decisão' as never) + 1).value;
      expect(typeof v).toBe('string');
      expect(v).toBe(obs);
      achou = true;
    });
    expect(achou).toBe(true);
  });

  it('celulasDoItem devolve 23 valores com as 3 da decisao antes da Observacao', () => {
    const r = anexarDecisoesAoRelatorio(relatorio(), new Map([[12, decisao({ productId: 12, observacao: 'X' })]]));
    const item = itensDe(r).find((i) => i.productId === 12)!;
    const c = celulasDoItem(item, 15);
    expect(c).toHaveLength(COLUNAS_RELATORIO_XLSX.length);
    expect(c.slice(-4)).toEqual([1500, 'Cotando', 'X', item.obs]);
  });
});

describe('XLSX MACRO: so a coluna AO muda', () => {
  // Cadastro sintetico: ids nas linhas 3..6 da fixture (a fixture anonimizada nao traz productId).
  const comIds: Quinzena = {
    ...fixture,
    produtos: fixture.produtos.map((p, i) => (i < 4 ? { ...p, productId: 100 + i } : p)),
  };
  const comAnaliseCongelada = comIds.produtos.findIndex((p) => p.analiseForecast !== null);

  it('com e sem decisoes: todas as celulas de todas as abas iguais, exceto AO da aba FORECAST (MACRO)', async () => {
    // O produto com analiseForecast congelado tambem recebe um id e NAO tem decisao: mantem o valor da planilha.
    const quinzena: Quinzena = {
      ...comIds,
      produtos: comIds.produtos.map((p, i) => (i === comAnaliseCongelada ? { ...p, productId: 200 } : p)),
    };
    const mapa = new Map<number, DecisaoCompraData>([
      [100, decisao({ productId: 100, quantidadeKg: 1234.5 })],
      [101, decisao({ productId: 101, quantidadeKg: 0 })],
    ]);
    const entrada = { hoje: HOJE, half: 2 as const, origin: 'planilha' };
    const sem = await gerarXlsxForecastMacro({ ...entrada, quinzena });
    const com = await gerarXlsxForecastMacro({ ...entrada, quinzena: { ...quinzena, produtos: produtosComDecisao(quinzena.produtos, mapa) } });

    const abrir = async (b: Buffer) => {
      const wb = new exceljs.Workbook();
      await wb.xlsx.load(b as unknown as Parameters<typeof wb.xlsx.load>[0]);
      return wb;
    };
    const [wsSem, wsCom] = [await abrir(sem), await abrir(com)];
    expect(wsCom.worksheets.map((w) => w.name)).toEqual(wsSem.worksheets.map((w) => w.name));

    const diferentes: string[] = [];
    for (const a of wsSem.worksheets) {
      const b = wsCom.getWorksheet(a.name)!;
      expect(b.rowCount).toBe(a.rowCount);
      expect(b.columnCount).toBe(a.columnCount);
      a.eachRow({ includeEmpty: true }, (row, r) => {
        row.eachCell({ includeEmpty: true }, (cell, c) => {
          const outra = b.getRow(r).getCell(c);
          if (JSON.stringify(cell.value) !== JSON.stringify(outra.value)) diferentes.push(`${a.name}!${cell.address}`);
        });
      });
    }
    const linhaDe = (idx: number) => quinzena.produtos[idx].linha;
    expect(diferentes.sort()).toEqual(
      [`${FORECAST_SHEETS.macro}!AO${linhaDe(0)}`, `${FORECAST_SHEETS.macro}!AO${linhaDe(1)}`].sort(),
    );

    const macro = wsCom.getWorksheet(FORECAST_SHEETS.macro)!;
    expect(macro.getCell(`AO${linhaDe(0)}`).value).toBe(1234.5);
    expect(macro.getCell(`AO${linhaDe(1)}`).value).toBe(0);
    // Sem decisao: continua o analiseForecast congelado da planilha.
    expect(macro.getCell(`AO${linhaDe(comAnaliseCongelada)}`).value).toBe(quinzena.produtos[comAnaliseCongelada].analiseForecast);
  }, 60_000);

  it('round-trip: reimportar o arquivo devolve a decisao como analiseForecast', async () => {
    const mapa = new Map<number, DecisaoCompraData>([
      [100, decisao({ productId: 100, quantidadeKg: 1234.5 })],
      [101, decisao({ productId: 101, quantidadeKg: 0 })],
    ]);
    const buffer = await gerarXlsxForecastMacro({
      hoje: HOJE,
      half: 2,
      origin: 'planilha',
      quinzena: { ...comIds, produtos: produtosComDecisao(comIds.produtos, mapa) },
    });
    const r = await parseForecastWorkbook(buffer, { label: '10-2', baseDate: BASE });
    expect(r.erros).toEqual([]);
    expect(r.quinzena.produtos[0].analiseForecast).toBe(1234.5);
    expect(r.quinzena.produtos[1].analiseForecast).toBe(0);
    expect(r.quinzena.produtos[2].analiseForecast).toBe(fixture.produtos[2].analiseForecast);
  }, 60_000);
});
