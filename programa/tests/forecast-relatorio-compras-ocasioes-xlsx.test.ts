import exceljs from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { OcasiaoLeadTime } from '../src/utils/forecastOcasioes';
import {
  montarRelatorioCompras,
  type ItemRelatorioCompras,
  type LinhaParaRelatorio,
  type RelatorioCompras,
} from '../src/utils/forecastRelatorioCompras';
import {
  anexarOcasioesAoRelatorio,
  type ContextoOcasioes,
  type FonteDoCadastro,
} from '../src/utils/forecastRelatorioComprasOcasioes';
import {
  AVISO_ANTES_DE_HOJE_XLSX,
  AVISO_COMPONENTES_AUSENTES_XLSX,
  COLUNAS_OCASIOES_XLSX,
  LARGURAS_OCASIOES_XLSX,
  NOTA_OSCILOU_XLSX,
  PARAGRAFO_OCASIOES_XLSX,
  ROTULO_ETAPA_OCASIAO_XLSX,
  TEXTO_OCASIOES_INDISPONIVEIS_XLSX,
  celulasDeOcasioes,
  comColunasDeOcasioes,
  comParagrafoDeOcasioes,
  linhasDoResumoDeOcasioes,
  resumoFontesSemPais,
  resumoOcasioes,
  resumoOcasioesAntesDeHoje,
  resumoSemFonteCadastrada,
  textoOcasiaoDaLista,
} from '../src/utils/forecastRelatorioComprasOcasioesXlsx';
import {
  ABA_POR_URGENCIA,
  ABA_REGRAS,
  ABA_RELATORIO,
  COLUNAS_POR_URGENCIA_XLSX,
  COLUNAS_RELATORIO_XLSX,
  gerarXlsxRelatorioCompras,
  linhasDoResumo,
  paragrafosDeRegras,
} from '../src/utils/forecastRelatorioComprasXlsx';
import {
  APOIO_OCASIOES,
  AVISO_ANTES_DE_HOJE,
  AVISO_COMPONENTES_AUSENTES,
  NOTA_OSCILOU,
  PARAGRAFO_OCASIOES,
  ROTULO_ETAPA_OCASIAO,
  TEXTO_OCASIOES_INDISPONIVEIS,
  resumoFontesSemPais as resumoFontesSemPaisWeb,
  resumoOcasioes as resumoOcasioesWeb,
  resumoOcasioesAntesDeHoje as resumoOcasioesAntesDeHojeWeb,
  resumoSemFonteCadastrada as resumoSemFonteCadastradaWeb,
  textoOcasiaoDaLista as textoOcasiaoDaListaWeb,
} from '../web/src/pages/Forecast/forecastOcasioesRelatorio';

// Repo PUBLICO: so dados sinteticos (FONTE 001, OCASIAO 001, PRODUTO 001, paises XA..XZ).
const BASE = '2026-10-15';
const HOJE = '2026-10-20';
const N_COLUNAS = COLUNAS_RELATORIO_XLSX.length;
const N_COLUNAS_URGENCIA = COLUNAS_POR_URGENCIA_XLSX.length;
const N_NOVAS = COLUNAS_OCASIOES_XLSX.length;

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

const ocasiao = (over: Partial<OcasiaoLeadTime> & Pick<OcasiaoLeadTime, 'id'>): OcasiaoLeadTime => ({
  escopo: 'global',
  countryCode: null,
  sourceId: null,
  inicio: '2026-11-01',
  fim: '2026-11-05',
  recorrencia: 'nenhuma',
  etapa: 'total',
  efeito: 'dias',
  valor: 5,
  ativa: true,
  ...over,
});

const fonteCad = (over: Partial<FonteDoCadastro> = {}): FonteDoCadastro => ({
  id: 1,
  countryCode: 'XA',
  ativa: true,
  readinessDays: 10,
  shippingDays: 5,
  transitDays: 10,
  clearanceDays: 5,
  ...over,
});

// FONTE 001: PRODUTO 001 (cruza, antes de hoje) e PRODUTO 002 (AQ 90, normal ja vencida). FONTE 002: etapa nula
// (componentes ausentes). FONTE 003: fora do cadastro. FONTE 004: sem pais (conta em fontesSemPais).
const linhas = [
  linha({ linha: 1, item: 'PRODUTO 001', fonte: 'FONTE 001' }),
  linha({ linha: 2, item: 'PRODUTO 002', fonte: 'FONTE 001', AQ: 90, AN: -20 }),
  linha({ linha: 3, item: 'PRODUTO 003', fonte: 'FONTE 002' }),
  linha({ linha: 4, item: 'PRODUTO 004', fonte: 'FONTE 003' }),
  linha({ linha: 5, item: 'PRODUTO 005', fonte: 'FONTE 004' }),
];
const base = montarRelatorioCompras(
  { id: 1, label: '10-2', baseDate: BASE, half: 2, origin: 'planilha', hoje: HOJE, linhas },
  [],
);
const contexto: ContextoOcasioes = {
  ocasioes: [ocasiao({ id: 1 }), ocasiao({ id: 2, escopo: 'pais', countryCode: 'XB', etapa: 'prontidao' })],
  nomes: new Map([
    [1, 'OCASIAO 001'],
    [2, 'OCASIAO 002'],
  ]),
  fontes: new Map<string, FonteDoCadastro>([
    ['FONTE 001', fonteCad({ id: 1 })],
    ['FONTE 002', fonteCad({ id: 2, shippingDays: null })],
    ['FONTE 004', fonteCad({ id: 4, countryCode: null })],
  ]),
};
const comOcasioes = anexarOcasioesAoRelatorio(base, contexto);

const itensDe = (r: RelatorioCompras) => r.grupos.flatMap((g) => g.itens);
const porLinha = (r: RelatorioCompras, n: number): ItemRelatorioCompras => itensDe(r).find((i) => i.linha === n)!;

function semBlocos<T>(valor: T): T {
  if (Array.isArray(valor)) return valor.map(semBlocos) as unknown as T;
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>)
        .filter(([chave]) => chave !== 'ocasioes')
        .map(([chave, v]) => [chave, semBlocos(v)]),
    ) as T;
  }
  return valor;
}

async function carregar(r: RelatorioCompras): Promise<exceljs.Workbook> {
  const wb = new exceljs.Workbook();
  await wb.xlsx.load((await gerarXlsxRelatorioCompras(r)) as unknown as ArrayBuffer);
  return wb;
}

// Nome, larguras, mesclagens e valores de todas as linhas, por aba (o arquivo nunca e byte a byte igual: exceljs grava a data).
function conteudoDoXlsx(wb: exceljs.Workbook) {
  return wb.worksheets.map((ws) => {
    const linhasDaAba: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
      linhasDaAba.push((row.values as unknown[]).slice(1).map((v) => v ?? ''));
    });
    return {
      nome: ws.name,
      larguras: ws.columns.map((c) => c.width),
      mesclagens: [...((ws.model as unknown as { merges?: string[] }).merges ?? [])].sort(),
      linhas: linhasDaAba,
    };
  });
}

// 1 -> A ... 26 -> Z, 27 -> AA (ate 52 colunas; o arquivo recarregado devolve o autofiltro como texto 'A1:AA1').
const letraDaColuna = (n: number): string => (n > 26 ? String.fromCharCode(64 + Math.floor((n - 1) / 26)) : '') + String.fromCharCode(65 + ((n - 1) % 26));

const valor = (ws: exceljs.Worksheet, linhaDaAba: number, coluna: number): string | number =>
  (ws.getRow(linhaDaAba).getCell(coluna).value ?? '') as string | number;

// Posicao (1-based) das linhas de item da aba por fonte: resumo, 1 linha em branco e, por grupo, faixa + cabecalho + itens + branco.
function linhasDeItens(r: RelatorioCompras): Map<number, number> {
  const mapa = new Map<number, number>();
  let cursor = linhasDoResumo(r).length + linhasDoResumoDeOcasioes(r).length + 2;
  for (const g of r.grupos) {
    cursor += 2;
    for (const item of g.itens) {
      mapa.set(item.linha, cursor);
      cursor += 1;
    }
    cursor += 1;
  }
  return mapa;
}

describe('XLSX do relatorio sem ocasiao ativa (igual a hoje)', () => {
  it('conteudo identico, sem coluna, linha ou aba nova', async () => {
    const a = conteudoDoXlsx(await carregar(base));
    const b = conteudoDoXlsx(await carregar(semBlocos(comOcasioes)));
    expect(b).toStrictEqual(a);
    expect(comColunasDeOcasioes(base)).toBe(false);
    expect(comColunasDeOcasioes(semBlocos(comOcasioes))).toBe(false);
  });

  it('cabecalhos exatamente os de hoje nas abas do relatorio e por urgencia', async () => {
    const wb = await carregar(base);
    const porFonte = wb.getWorksheet(ABA_RELATORIO)!;
    const linhaDoCabecalho = linhasDoResumo(base).length + 3;
    expect(Array.from({ length: N_COLUNAS + N_NOVAS }, (_, i) => valor(porFonte, linhaDoCabecalho, i + 1))).toStrictEqual([
      ...COLUNAS_RELATORIO_XLSX,
      ...COLUNAS_OCASIOES_XLSX.map(() => ''),
    ]);
    const urgencia = wb.getWorksheet(ABA_POR_URGENCIA)!;
    expect(Array.from({ length: N_COLUNAS_URGENCIA + N_NOVAS }, (_, i) => valor(urgencia, 1, i + 1))).toStrictEqual([
      ...COLUNAS_POR_URGENCIA_XLSX,
      ...COLUNAS_OCASIOES_XLSX.map(() => ''),
    ]);
    expect(linhasDoResumoDeOcasioes(base)).toStrictEqual([]);
    expect(comParagrafoDeOcasioes(['a', 'b'], base)).toStrictEqual(['a', 'b']);
  });
});

describe('XLSX com ocasiao ativa e item sem lead time', () => {
  it('o item sem lead time continua fora das abas de itens e as colunas novas seguem alinhadas', async () => {
    const comSemLeadTime = montarRelatorioCompras(
      { id: 1, label: '10-2', baseDate: BASE, half: 2, origin: 'planilha', hoje: HOJE, linhas: [...linhas, linha({ linha: 6, item: 'PRODUTO 006', fonte: 'FONTE 001', AN: null, AQ: null })] },
      [],
    );
    expect(comSemLeadTime.fora.semLeadTime).toBe(1);
    const r = anexarOcasioesAoRelatorio(comSemLeadTime, contexto);
    expect(itensDe(r).some((i) => i.item === 'PRODUTO 006')).toBe(false);
    expect(semBlocos(r)).toStrictEqual(semBlocos(comSemLeadTime));

    const wb = await carregar(r);
    const porFonte = wb.getWorksheet(ABA_RELATORIO)!;
    const urgencia = wb.getWorksheet(ABA_POR_URGENCIA)!;
    const nomes = (ws: exceljs.Worksheet) => {
      const achados: string[] = [];
      ws.eachRow((row) => row.eachCell((c) => typeof c.value === 'string' && c.value.startsWith('PRODUTO') && achados.push(c.value)));
      return achados;
    };
    expect(nomes(porFonte)).not.toContain('PRODUTO 006');
    expect(nomes(urgencia)).not.toContain('PRODUTO 006');
    expect(urgencia.rowCount).toBe(itensDe(r).length + 1);
    const linhasItens = linhasDeItens(r);
    for (const item of itensDe(r)) {
      const nas = Array.from({ length: N_NOVAS }, (_, i) => valor(porFonte, linhasItens.get(item.linha)!, N_COLUNAS + 1 + i));
      expect(nas).toStrictEqual(celulasDeOcasioes(item));
    }
  });
});

describe('XLSX do relatorio com ocasiao ativa', () => {
  it('as 3 colunas entram no fim das duas abas, na ordem; item sem bloco = 3 celulas vazias', async () => {
    expect(comColunasDeOcasioes(comOcasioes)).toBe(true);
    const wb = await carregar(comOcasioes);
    const linhasItens = linhasDeItens(comOcasioes);

    const porFonte = wb.getWorksheet(ABA_RELATORIO)!;
    const cabecalho = linhasItens.get(base.grupos[0].itens[0].linha)! - 1;
    expect(Array.from({ length: N_NOVAS }, (_, i) => valor(porFonte, cabecalho, N_COLUNAS + 1 + i))).toStrictEqual([
      ...COLUNAS_OCASIOES_XLSX,
    ]);
    expect(valor(porFonte, cabecalho, N_COLUNAS)).toBe('Observação');

    const urgencia = wb.getWorksheet(ABA_POR_URGENCIA)!;
    expect(Array.from({ length: N_NOVAS }, (_, i) => valor(urgencia, 1, N_COLUNAS_URGENCIA + 1 + i))).toStrictEqual([
      ...COLUNAS_OCASIOES_XLSX,
    ]);
    expect(valor(urgencia, 1, N_COLUNAS_URGENCIA)).toBe('Observação');

    for (const item of itensDe(comOcasioes)) {
      const esperado = celulasDeOcasioes(item);
      const nasPorFonte = Array.from({ length: N_NOVAS }, (_, i) => valor(porFonte, linhasItens.get(item.linha)!, N_COLUNAS + 1 + i));
      expect(nasPorFonte).toStrictEqual(esperado);
    }
    // Por urgencia: a ordem das linhas e a de posicaoUrgencia.
    const ordenados = [...itensDe(comOcasioes)].sort((a, b) => a.posicaoUrgencia - b.posicaoUrgencia);
    ordenados.forEach((item, i) => {
      const nasPorUrgencia = Array.from({ length: N_NOVAS }, (_, k) => valor(urgencia, i + 2, N_COLUNAS_URGENCIA + 1 + k));
      expect(nasPorUrgencia).toStrictEqual(celulasDeOcasioes(item));
    });
    expect(celulasDeOcasioes(porLinha(comOcasioes, 4))).toStrictEqual(['', '', '']);
  });

  it('celulas do item com bloco: numero, dd/mm/aaaa e linhas das ocasioes com os avisos', () => {
    const afetado = porLinha(comOcasioes, 1);
    expect(afetado.ocasioes?.antesDeHoje).toBe(true);
    expect(celulasDeOcasioes(afetado)).toStrictEqual([
      35,
      '17/10/2026',
      ['OCASIAO 001 · +5 d (Lead time inteiro)', AVISO_ANTES_DE_HOJE_XLSX].join('\n'),
    ]);
    // Normal ja vencida: sem o aviso de antes de hoje.
    expect(celulasDeOcasioes(porLinha(comOcasioes, 2))[2]).toBe('OCASIAO 001 · +5 d (Lead time inteiro)');
    // Componentes ausentes e oscilacao entram depois do aviso de antes de hoje.
    const completo = {
      ...afetado,
      ocasioes: { ...afetado.ocasioes!, componentesAusentes: true as const, oscilou: true as const },
    };
    expect(celulasDeOcasioes(completo)[2]).toBe(
      [
        'OCASIAO 001 · +5 d (Lead time inteiro)',
        AVISO_ANTES_DE_HOJE_XLSX,
        AVISO_COMPONENTES_AUSENTES_XLSX,
        NOTA_OSCILOU_XLSX,
      ].join('\n'),
    );
    expect(celulasDeOcasioes(porLinha(comOcasioes, 3))[2]).toContain(AVISO_COMPONENTES_AUSENTES_XLSX);
  });

  it('formatacao: numFmt 0, quebra de linha e vermelho so com antes de hoje', async () => {
    const wb = await carregar(comOcasioes);
    const porFonte = wb.getWorksheet(ABA_RELATORIO)!;
    const linhasItens = linhasDeItens(comOcasioes);
    const celula = (n: number, k: number) => porFonte.getRow(linhasItens.get(n)!).getCell(N_COLUNAS + k);

    expect(celula(1, 1).numFmt).toBe('0');
    expect(celula(1, 3).alignment).toMatchObject({ wrapText: true, vertical: 'top' });
    expect(celula(1, 2).font).toMatchObject({ bold: true, color: { argb: 'FFB91C1C' } });
    // Normal vencida (sem antes de hoje) e item sem bloco: sem vermelho.
    expect(celula(2, 2).font?.color?.argb).toBeUndefined();
    expect(celula(4, 2).font?.color?.argb).toBeUndefined();

    const urgencia = wb.getWorksheet(ABA_POR_URGENCIA)!;
    const linhaDoAfetado = [...itensDe(comOcasioes)].sort((a, b) => a.posicaoUrgencia - b.posicaoUrgencia).findIndex((i) => i.linha === 1) + 2;
    expect(urgencia.getRow(linhaDoAfetado).getCell(N_COLUNAS_URGENCIA + 1).numFmt).toBe('0');
    expect(urgencia.getRow(linhaDoAfetado).getCell(N_COLUNAS_URGENCIA + 2).font).toMatchObject({ color: { argb: 'FFB91C1C' } });
  });

  it('larguras das colunas novas e autofiltro da aba por urgencia cobrem as novas colunas', async () => {
    const wb = await carregar(comOcasioes);
    const conteudo = conteudoDoXlsx(wb);
    for (const nome of [ABA_RELATORIO, ABA_POR_URGENCIA]) {
      expect(conteudo.find((a) => a.nome === nome)!.larguras.slice(-N_NOVAS)).toStrictEqual(LARGURAS_OCASIOES_XLSX);
    }
    expect(wb.getWorksheet(ABA_POR_URGENCIA)!.autoFilter).toBe(`A1:${letraDaColuna(N_COLUNAS_URGENCIA + N_NOVAS)}1`);
  });

  it('colunas antigas inalteradas e faixa mesclada com a largura de antes', async () => {
    const a = await carregar(base);
    const b = await carregar(comOcasioes);
    const k = linhasDoResumoDeOcasioes(comOcasioes).length;
    expect(k).toBeGreaterThan(0);

    const aFonte = a.getWorksheet(ABA_RELATORIO)!;
    const bFonte = b.getWorksheet(ABA_RELATORIO)!;
    for (let l = linhasDoResumo(base).length + 2; l <= aFonte.rowCount; l += 1) {
      for (let c = 1; c <= N_COLUNAS; c += 1) {
        expect(valor(bFonte, l + k, c)).toStrictEqual(valor(aFonte, l, c));
      }
    }
    const mesclagens = (ws: exceljs.Worksheet) =>
      [...((ws.model as unknown as { merges?: string[] }).merges ?? [])].map((m) => m.replace(/\d+/g, ''));
    expect(mesclagens(bFonte)).toStrictEqual(mesclagens(aFonte));

    const aUrg = a.getWorksheet(ABA_POR_URGENCIA)!;
    const bUrg = b.getWorksheet(ABA_POR_URGENCIA)!;
    for (let l = 1; l <= aUrg.rowCount; l += 1) {
      for (let c = 1; c <= N_COLUNAS_URGENCIA; c += 1) {
        expect(valor(bUrg, l, c)).toStrictEqual(valor(aUrg, l, c));
      }
    }
  });

  it('linhas do resumo e paragrafo das Regras imediatamente antes do ultimo', async () => {
    expect(linhasDoResumoDeOcasioes(comOcasioes)).toStrictEqual([
      resumoOcasioes(4),
      resumoOcasioesAntesDeHoje(3),
      resumoSemFonteCadastrada(1),
      resumoFontesSemPais(1),
    ]);
    const wb = await carregar(comOcasioes);
    const porFonte = wb.getWorksheet(ABA_RELATORIO)!;
    const n = linhasDoResumo(comOcasioes).length;
    expect(valor(porFonte, n + 1, 1)).toBe(resumoOcasioes(4));

    const regras = wb.getWorksheet(ABA_REGRAS)!;
    const textos = Array.from({ length: regras.rowCount }, (_, i) => valor(regras, i + 1, 1));
    const ultimo = textos.length - 1;
    expect(textos[ultimo]).toBe('Arquivo gerado do mesmo relatório exibido na tela (quinzena calculada).');
    expect(textos[ultimo - 1]).toBe(PARAGRAFO_OCASIOES_XLSX);
    expect(textos).toStrictEqual(comParagrafoDeOcasioes(paragrafosDeRegras(comOcasioes.urgencia.diasCritico, false, false, false, false), comOcasioes));
  });
});

describe('XLSX com a leitura das ocasioes indisponivel', () => {
  it('so a linha de aviso no resumo; sem colunas novas e sem paragrafo', async () => {
    const ind = anexarOcasioesAoRelatorio(base, { indisponivel: true });
    expect(comColunasDeOcasioes(ind)).toBe(false);
    expect(linhasDoResumoDeOcasioes(ind)).toStrictEqual([TEXTO_OCASIOES_INDISPONIVEIS_XLSX]);

    const wb = await carregar(ind);
    const ws = wb.getWorksheet(ABA_RELATORIO)!;
    expect(valor(ws, linhasDoResumo(ind).length + 1, 1)).toBe(TEXTO_OCASIOES_INDISPONIVEIS_XLSX);
    expect(ws.columnCount).toBeLessThanOrEqual(N_COLUNAS);
    const regras = wb.getWorksheet(ABA_REGRAS)!;
    const textos = Array.from({ length: regras.rowCount }, (_, i) => valor(regras, i + 1, 1));
    expect(textos).not.toContain(PARAGRAFO_OCASIOES_XLSX);
  });
});

describe('paridade de textos tela x XLSX', () => {
  it('rotulos de etapa e texto da ocasiao na lista', () => {
    expect(ROTULO_ETAPA_OCASIAO_XLSX).toStrictEqual(ROTULO_ETAPA_OCASIAO);
    for (const etapa of Object.keys(ROTULO_ETAPA_OCASIAO) as Array<keyof typeof ROTULO_ETAPA_OCASIAO>) {
      for (const dias of [0, 1, 7]) {
        const o = { nome: 'OCASIAO 001', dias, etapa };
        expect(textoOcasiaoDaLista(o)).toBe(textoOcasiaoDaListaWeb(o));
      }
    }
  });

  it('avisos, nota e paragrafo', () => {
    expect(AVISO_ANTES_DE_HOJE_XLSX).toBe(AVISO_ANTES_DE_HOJE);
    expect(AVISO_COMPONENTES_AUSENTES_XLSX).toBe(AVISO_COMPONENTES_AUSENTES);
    expect(NOTA_OSCILOU_XLSX).toBe(NOTA_OSCILOU);
    expect(TEXTO_OCASIOES_INDISPONIVEIS_XLSX).toBe(TEXTO_OCASIOES_INDISPONIVEIS);
    expect(PARAGRAFO_OCASIOES_XLSX).toBe(PARAGRAFO_OCASIOES);
    expect(APOIO_OCASIOES).not.toBe(PARAGRAFO_OCASIOES);
  });

  it('textos do resumo (0, 1 e n)', () => {
    for (const n of [0, 1, 2, 12]) {
      expect(resumoOcasioes(n)).toBe(resumoOcasioesWeb(n));
      expect(resumoOcasioesAntesDeHoje(n)).toBe(resumoOcasioesAntesDeHojeWeb(n));
      expect(resumoSemFonteCadastrada(n)).toBe(resumoSemFonteCadastradaWeb(n));
      expect(resumoFontesSemPais(n)).toBe(resumoFontesSemPaisWeb(n));
    }
  });
});
