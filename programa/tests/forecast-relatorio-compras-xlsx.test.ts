import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import exceljs from 'exceljs';
import { describe, expect, it } from 'vitest';
import { calcular } from '../src/utils/forecastEngine';
import {
  URGENCIAS,
  itensNaOrdemDeUrgencia,
  montarRelatorioCompras,
  opcoesDePallet,
  type EmbalagemCadastrada,
  type LinhaParaRelatorio,
  type QuinzenaParaRelatorio,
  type RelatorioCompras,
} from '../src/utils/forecastRelatorioCompras';
import {
  ABA_POR_URGENCIA,
  ABA_REGRAS,
  ABA_RELATORIO,
  ABA_SEM_CONSUMO,
  ABA_SOB_DEMANDA,
  COLUNAS_POR_URGENCIA_XLSX,
  COLUNAS_RELATORIO_XLSX,
  COLUNAS_SEM_CONSUMO_XLSX,
  COLUNAS_SOB_DEMANDA_XLSX,
  PARAGRAFO_EMBALAGEM_XLSX,
  STATUS_ROTULO_XLSX,
  URGENCIAS_XLSX,
  celulasDoItem,
  celulasDoItemSobDemanda,
  contarComMesesForaDaMedia,
  dataBr,
  gerarXlsxRelatorioCompras,
  inteiroBr,
  kgBr,
  linhasDoResumo,
  mesAbrev,
  nomeArquivoRelatorioCompras,
  paragrafoMesesForaDaMedia,
  paragrafoSemConsumo,
  paragrafoSobDemanda,
  paragrafoUrgencia,
  paragrafosDeRegras,
  resumoDeUrgencia,
  resumoMesesForaDaMedia,
  resumoSemConsumo,
  resumoSobDemanda,
  rotuloUrgencia,
  textoMesesForaDaMedia,
  textoMotivoSobDemanda,
  textoMotivos,
  textoOpcaoDeEmbalagem,
  textoPallet,
  tituloDoGrupo,
} from '../src/utils/forecastRelatorioComprasXlsx';
import type { Quinzena } from '../src/utils/forecastTypes';
import {
  STATUS_ROTULO,
  dataBr as dataBrWeb,
  inteiroBr as inteiroBrWeb,
  kgBr as kgBrWeb,
  mesAbrevDoAnoMes,
} from '../web/src/pages/Forecast/forecastPainel';
import {
  URGENCIAS as URGENCIAS_WEB,
  paragrafoSemConsumo as paragrafoSemConsumoWeb,
  paragrafoUrgencia as paragrafoUrgenciaWeb,
  resumoDeUrgencia as resumoDeUrgenciaWeb,
  resumoSemConsumo as resumoSemConsumoWeb,
  rotuloUrgencia as rotuloUrgenciaWeb,
  textoMotivos as textoMotivosWeb,
} from '../web/src/pages/Forecast/forecastRelatorioUrgencia';
import {
  PARAGRAFO_EMBALAGEM,
  contarComMesesForaDaMedia as contarComMesesForaDaMediaWeb,
  opcoesOutrasComPallet,
  palletDoDestaque,
  paragrafoMesesForaDaMedia as paragrafoMesesForaDaMediaWeb,
  paragrafoSobDemanda as paragrafoSobDemandaWeb,
  resumoMesesForaDaMedia as resumoMesesForaDaMediaWeb,
  resumoSobDemanda as resumoSobDemandaWeb,
  textoMediaSem as textoMediaSemWeb,
  textoMesesForaDaMedia as textoMesesForaDaMediaWeb,
  textoMotivoSobDemanda as textoMotivoSobDemandaWeb,
  textoOpcaoDeEmbalagem as textoOpcaoDeEmbalagemWeb,
  textoPallet as textoPalletWeb,
} from '../web/src/pages/Forecast/forecastRelatorioTextos';

// Repo PUBLICO: so dados sinteticos (FONTE 001, PRODUTO 001, C0001) e a fixture anonimizada.
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8'),
) as Quinzena;

const BASE = '2026-10-15';
const HOJE = '2026-10-20';
const N_COLUNAS = COLUNAS_RELATORIO_XLSX.length;
const COL = (nome: (typeof COLUNAS_RELATORIO_XLSX)[number]) => COLUNAS_RELATORIO_XLSX.indexOf(nome) + 1;

async function carregar(buffer: Buffer): Promise<exceljs.Workbook> {
  const wb = new exceljs.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

function valorDaCelula(ws: exceljs.Worksheet, linha: number, coluna: number): string | number {
  const v = ws.getRow(linha).getCell(coluna).value;
  return (v ?? '') as string | number;
}

function linhaComoArray(ws: exceljs.Worksheet, linha: number): Array<string | number> {
  return Array.from({ length: N_COLUNAS }, (_, i) => valorDaCelula(ws, linha, i + 1));
}

function linhaComoArrayN(ws: exceljs.Worksheet, linha: number, n: number): Array<string | number> {
  return Array.from({ length: n }, (_, i) => valorDaCelula(ws, linha, i + 1));
}

// Percorre a aba na ordem do relatorio: resumo, 1 linha em branco e, por grupo, faixa + cabecalho + itens + branco.
function mapearLinhas(r: RelatorioCompras) {
  const resumo = linhasDoResumo(r).length;
  let cursor = resumo + 2;
  const grupos = r.grupos.map((g) => {
    const faixa = cursor;
    const cabecalho = cursor + 1;
    const primeiroItem = cursor + 2;
    cursor = primeiroItem + g.itens.length + 1;
    return { g, faixa, cabecalho, primeiroItem };
  });
  return { resumo, grupos };
}

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

function quinzena(linhas: LinhaParaRelatorio[]): QuinzenaParaRelatorio {
  return { id: 1, label: '10-2', baseDate: BASE, half: 2, origin: 'planilha', hoje: HOJE, linhas };
}

const EMBALAGENS: EmbalagemCadastrada[] = [
  { codigo: 'C0002', quantidade: 200 },
  { codigo: 'C0003', quantidade: 25 },
];

const sintetico = montarRelatorioCompras(
  quinzena([
    // Duas embalagens (usada C0002 = 200 kg), no prazo, com chegada e programacao.
    linha({
      linha: 1,
      item: 'PRODUTO 001',
      fonte: 'FONTE 001',
      codigos: ['C0001', 'C0002', 'C0003'],
      AN: -450,
      obs: '  OBS SINTETICA 001  ',
      status: 'cotando',
      chegadas: [0, 0, 1200, 0, 0],
      programacoes: [0, 300, 0, 0],
    }),
    // Vencida, sem embalagem, nao fraciona.
    linha({
      linha: 2,
      item: 'PRODUTO 002',
      fonte: 'FONTE 001',
      codigos: ['C0004'],
      AN: -50,
      AG: 80,
      projecao: [-40, -100, -160, -220, -280, -340],
      // Texto que comeca com "=" tem de continuar texto na planilha (nunca virar formula).
      obs: '=OBS SINTETICA 002',
      naoFraciona: true,
      status: 'po',
    }),
    // Sem ruptura em 6 meses.
    linha({
      linha: 3,
      item: 'PRODUTO 003',
      fonte: 'FONTE 002',
      codigos: ['C0005'],
      AN: 0,
      Q: 10,
      AG: 10,
      projecao: [5, 5, 5, 5, 5, 5],
      status: 'preco',
    }),
    // Ja na data-base (vencida por consequencia).
    linha({
      linha: 4,
      item: 'PRODUTO 004',
      fonte: 'FONTE 003',
      codigos: ['C0006'],
      AN: -30,
      AG: 80,
      projecao: [-100, -160, -220, -280, -340, -400],
      status: 'confirmado',
    }),
  ]),
  EMBALAGENS,
);

describe('gerarXlsxRelatorioCompras (sintetico)', () => {
  const itens = sintetico.grupos.flatMap((g) => g.itens);
  const porNome = (nome: string) => itens.find((i) => i.item === nome)!;
  const abrir = async () => carregar(await gerarXlsxRelatorioCompras(sintetico));

  it('cobre os casos pedidos (premissa do teste)', () => {
    expect(sintetico.totais.itens).toBe(4);
    expect(porNome('PRODUTO 001').embalagem.multiplas).toBe(true);
    expect(porNome('PRODUTO 001').vencida).toBe(false);
    expect(porNome('PRODUTO 002').vencida).toBe(true);
    expect(porNome('PRODUTO 003').ruptura).toBeNull();
    expect(porNome('PRODUTO 004').ruptura?.jaNaDataBase).toBe(true);
    expect(sintetico.totais.vencidas).toBe(2);
    expect(['PRODUTO 001', 'PRODUTO 002', 'PRODUTO 003', 'PRODUTO 004'].map((n) => porNome(n).urgencia)).toEqual([
      'no-prazo',
      'critico',
      'no-prazo',
      'sem-estoque',
    ]);
    expect(['PRODUTO 001', 'PRODUTO 002', 'PRODUTO 003', 'PRODUTO 004'].map((n) => porNome(n).diasAteRuptura)).toEqual([
      32, 3, null, -5,
    ]);
  });

  it('tem as quatro abas, na ordem', async () => {
    const wb = await abrir();
    expect(wb.worksheets.map((w) => w.name)).toEqual([ABA_RELATORIO, ABA_POR_URGENCIA, ABA_SEM_CONSUMO, ABA_REGRAS]);
  });

  it('resumo, faixas, cabecalho e linhas de item seguem o relatorio na mesma ordem', async () => {
    const wb = await abrir();
    const ws = wb.getWorksheet(ABA_RELATORIO)!;
    const { resumo, grupos } = mapearLinhas(sintetico);
    linhasDoResumo(sintetico).forEach((texto, i) => {
      expect(valorDaCelula(ws, i + 1, 1)).toBe(texto);
    });
    expect(ws.getRow(1).getCell(1).font?.bold).toBe(true);
    expect(ws.getRow(1).getCell(1).font?.size).toBe(14);
    expect(valorDaCelula(ws, resumo + 1, 1)).toBe('');
    for (const { g, faixa, cabecalho, primeiroItem } of grupos) {
      expect(valorDaCelula(ws, faixa, 1)).toBe(tituloDoGrupo(g, sintetico.urgencia.diasCritico));
      expect(ws.getRow(faixa).getCell(1).font?.bold).toBe(true);
      expect(linhaComoArray(ws, cabecalho)).toEqual([...COLUNAS_RELATORIO_XLSX]);
      g.itens.forEach((item, i) => {
        expect(linhaComoArray(ws, primeiroItem + i)).toEqual(celulasDoItem(item, sintetico.urgencia.diasCritico));
      });
    }
  });

  it('textos exatos dos casos', async () => {
    const wb = await abrir();
    const ws = wb.getWorksheet(ABA_RELATORIO)!;
    const { grupos } = mapearLinhas(sintetico);
    const linhaDe = (nome: string) => {
      for (const { g, primeiroItem } of grupos) {
        const i = g.itens.findIndex((x) => x.item === nome);
        if (i >= 0) return primeiroItem + i;
      }
      throw new Error(nome);
    };
    const cel = (nome: string, col: (typeof COLUNAS_RELATORIO_XLSX)[number]) => valorDaCelula(ws, linhaDe(nome), COL(col));

    // 450 / 200 kg = 3 embalagens (C0002 e a primeira cadastrada dos codigos).
    expect(cel('PRODUTO 001', 'Embalagem')).toBe('3 × 200 kg (código C0002)');
    expect(cel('PRODUTO 001', 'Arredondamento')).toBe('Arredondado pela embalagem do código C0002');
    // 450 / 25 kg = 18 embalagens = 450 kg (a embalagem em destaque nao se repete aqui).
    expect(cel('PRODUTO 001', 'Outras embalagens')).toBe('18 × 25 kg (código C0003) = 450 kg');
    expect(cel('PRODUTO 001', 'Observação')).toBe('OBS SINTETICA 001');
    expect(cel('PRODUTO 002', 'Observação')).toBe('=OBS SINTETICA 002');
    expect(cel('PRODUTO 003', 'Observação')).toBe('');
    expect(cel('PRODUTO 001', 'Códigos')).toBe('C0001 · C0002 · C0003');
    expect(cel('PRODUTO 001', 'Status')).toBe('Cotando');
    expect(cel('PRODUTO 001', 'Em andamento')).toBe('Chegada dez/2026: 1.200\nProgramação nov/2026: 300');
    expect(cel('PRODUTO 001', 'Qtd. final')).toBe(600);

    expect(cel('PRODUTO 002', 'Embalagem')).toBe('Embalagem não cadastrada');
    expect(cel('PRODUTO 002', 'Não fraciona')).toBe('Não fraciona');
    expect(cel('PRODUTO 001', 'Não fraciona')).toBe('');
    expect(cel('PRODUTO 002', 'Arredondamento')).toBe('');
    expect(cel('PRODUTO 002', 'Outras embalagens')).toBe('');
    expect(cel('PRODUTO 002', 'Em andamento')).toBe('—');

    expect(cel('PRODUTO 003', 'Ruptura')).toBe('sem ruptura em 6 meses');
    expect(cel('PRODUTO 003', 'Saldo zera')).toBe('—');
    expect(cel('PRODUTO 003', 'Data-limite')).toBe('—');
    expect(cel('PRODUTO 004', 'Ruptura')).toBe('já na data-base');
    expect(cel('PRODUTO 004', 'Saldo zera')).toBe('out/2026');

    for (const item of itens) {
      expect(cel(item.item, 'Vencida')).toBe(item.vencida ? 'Vencida' : '');
    }
    expect(['PRODUTO 001', 'PRODUTO 002', 'PRODUTO 003', 'PRODUTO 004'].map((n) => cel(n, 'Urgência'))).toEqual([
      'No prazo',
      'Ruptura em até 15 dias',
      'No prazo',
      'Sem estoque agora',
    ]);
    expect(['PRODUTO 001', 'PRODUTO 002', 'PRODUTO 003', 'PRODUTO 004'].map((n) => cel(n, 'Dias até a ruptura'))).toEqual([
      32, 3, '—', -5,
    ]);
    expect(itens.filter((i) => i.vencida).map((i) => i.item).sort()).toEqual(['PRODUTO 002', 'PRODUTO 004']);
  });

  it('quantidades sao numeros iguais ao objeto, com 1 casa, e os destaques estao aplicados', async () => {
    const wb = await abrir();
    const ws = wb.getWorksheet(ABA_RELATORIO)!;
    const { grupos } = mapearLinhas(sintetico);
    for (const { g, primeiroItem } of grupos) {
      g.itens.forEach((item, i) => {
        const row = ws.getRow(primeiroItem + i);
        const esperados: Array<[(typeof COLUNAS_RELATORIO_XLSX)[number], number]> = [
          ['Demanda', item.demanda],
          ['Qtd. sugerida', item.quantidadeSugerida],
          ['Qtd. final', item.quantidadeFinal],
        ];
        for (const [coluna, valor] of esperados) {
          const cell = row.getCell(COL(coluna));
          expect(typeof cell.value).toBe('number');
          expect(cell.value).toBe(valor);
          expect(cell.numFmt).toBe('0.0');
        }
        expect(row.getCell(COL('Qtd. final')).font?.bold).toBe(true);
        const emb = row.getCell(COL('Embalagem')).font;
        if (item.embalagem.usada) {
          expect(emb?.bold).toBe(true);
        } else {
          expect(emb?.italic).toBe(true);
        }
        expect(row.getCell(COL('Não fraciona')).font?.bold).toBe(item.naoFraciona ? true : undefined);
        // fundo so nas 2 faixas criticas (todas as celulas da linha); Vencida em negrito sse vencida
        const fill = row.getCell(1).fill as exceljs.FillPattern | undefined;
        const critica = item.urgencia === 'sem-estoque' || item.urgencia === 'critico';
        expect(fill?.fgColor?.argb).toBe(critica ? 'FFFDF1EC' : undefined);
        const ultima = row.getCell(N_COLUNAS).fill as exceljs.FillPattern | undefined;
        expect(ultima?.fgColor?.argb).toBe(critica ? 'FFFDF1EC' : undefined);
        expect(row.getCell(COL('Vencida')).font?.bold).toBe(item.vencida ? true : undefined);
        expect(row.getCell(COL('Urgência')).font?.bold).toBe(true);
        const dias = row.getCell(COL('Dias até a ruptura'));
        if (item.diasAteRuptura !== null) {
          expect(typeof dias.value).toBe('number');
          expect(dias.numFmt).toBe('0');
        }
        for (const nome of ['Item', 'Urgência', 'Códigos', 'Status', 'Embalagem', 'Arredondamento', 'Outras embalagens', 'Ruptura', 'Em andamento', 'Observação'] as const) {
          expect(row.getCell(COL(nome)).alignment?.wrapText, nome).toBe(true);
          expect(row.getCell(COL(nome)).alignment?.vertical, nome).toBe('top');
        }
      });
    }
  });

  it('kg de embalagem fracionado sai com ate 3 casas, sem virar inteiro', async () => {
    const r = montarRelatorioCompras(
      quinzena([
        linha({ linha: 7, item: 'PRODUTO 007', fonte: 'FONTE 007', codigos: ['C0007', 'C0008', 'C0009'], AN: -3 }),
      ]),
      [
        { codigo: 'C0007', quantidade: 0.5 },
        { codigo: 'C0008', quantidade: 2.125 },
        { codigo: 'C0009', quantidade: 1250.5 },
      ],
    );
    const ws = (await carregar(await gerarXlsxRelatorioCompras(r))).getWorksheet(ABA_RELATORIO)!;
    const n = mapearLinhas(r).grupos[0].primeiroItem;
    expect(valorDaCelula(ws, n, COL('Embalagem'))).toBe('6 × 0,5 kg (código C0007)');
    // Uma linha por opcao nao destacada, com a quantidade arredondada para cada uma.
    expect(valorDaCelula(ws, n, COL('Outras embalagens'))).toBe(
      '2 × 2,125 kg (código C0008) = 4,25 kg\n1 × 1.250,5 kg (código C0009) = 1.250,5 kg',
    );
    expect(valorDaCelula(ws, n, COL('Qtd. final'))).toBe(3);
  });

  it('configura a pagina em paisagem, ajustada a largura', async () => {
    const wb = await abrir();
    const ws = wb.getWorksheet(ABA_RELATORIO)!;
    expect(ws.pageSetup.orientation).toBe('landscape');
    expect(ws.pageSetup.fitToPage).toBe(true);
    expect(ws.pageSetup.fitToWidth).toBe(1);
    expect(ws.pageSetup.fitToHeight).toBe(0);
  });

  it('aba Regras traz os paragrafos da tela (inclusive urgencia e sem consumo) e a nota de origem', async () => {
    const wb = await abrir();
    const ws = wb.getWorksheet(ABA_REGRAS)!;
    expect(ws.rowCount).toBe(6);
    const textos = [1, 2, 3, 4, 5, 6].map((n) => String(valorDaCelula(ws, n, 1)));
    expect(textos[0]).toContain('O saldo zera no primeiro mês');
    expect(textos[1]).toContain('Data-limite do pedido = ruptura − lead time da fonte');
    expect(textos[2]).toBe(PARAGRAFO_EMBALAGEM_XLSX);
    expect(textos[2]).toContain('Quantidade sugerida = demanda em módulo.');
    expect(textos[3]).toBe(paragrafoUrgencia(15));
    expect(textos[3]).toMatch(/^Urgência: "Sem estoque agora"/);
    expect(textos[4]).toBe(paragrafoSemConsumo());
    expect(textos[4]).toMatch(/^Atenção: sem consumo =/);
    expect(textos[5]).toBe('Arquivo gerado do mesmo relatório exibido na tela (quinzena calculada).');
  });

  it('resumo da 1a aba traz as linhas de urgencia e de sem consumo nos lugares certos', () => {
    const linhas = linhasDoResumo(sintetico);
    const i = linhas.indexOf('2 com data-limite vencida');
    expect(i).toBeGreaterThan(0);
    expect(linhas[i + 1]).toBe(
      'Urgência: 1 sem estoque agora · 1 com ruptura em até 15 dias · 0 atrasados · 2 no prazo',
    );
    const fora = linhas.findIndex((l) => l.startsWith('Fora do relatório:'));
    expect(linhas[fora + 1]).toBe(
      'Sem consumo: 0 em atenção (com estoque ou programação, fora da lista de compra) · 0 sem estoque nem programação',
    );
  });

  it('titulo da faixa do grupo: no maximo 1 contagem critica, antes das vencidas', () => {
    const titulos = sintetico.grupos.map((g) => tituloDoGrupo(g, 15));
    expect(titulos).toEqual([
      'FONTE 003 · lead time 30 dias · mais urgente 15/09/2026 · 1 sem estoque agora · 1 vencida',
      'FONTE 001 · lead time 30 dias · mais urgente 23/09/2026 · 1 com ruptura em até 15 dias · 1 vencida',
      'FONTE 002 · lead time 30 dias · sem data-limite',
    ]);
    expect(tituloDoGrupo(sintetico.grupos[1], 0)).toBe(
      'FONTE 001 · lead time 30 dias · mais urgente 23/09/2026 · 1 vencida',
    );
  });

  it('aba Por urgencia: lista unica na ordem de posicaoUrgencia, com fonte, filtro e cabecalho congelado', async () => {
    const ws = (await abrir()).getWorksheet(ABA_POR_URGENCIA)!;
    expect(COLUNAS_POR_URGENCIA_XLSX).toHaveLength(20);
    expect(linhaComoArrayN(ws, 1, 20)).toEqual([...COLUNAS_POR_URGENCIA_XLSX]);
    const lista = itensNaOrdemDeUrgencia(sintetico);
    expect(lista.map((x) => x.item.item)).toEqual(['PRODUTO 004', 'PRODUTO 002', 'PRODUTO 001', 'PRODUTO 003']);
    expect(ws.rowCount).toBe(1 + lista.length);
    lista.forEach(({ item, fonte }, i) => {
      const c = celulasDoItem(item, 15);
      expect(linhaComoArrayN(ws, i + 2, 20)).toEqual([c[0], c[1], fonte, ...c.slice(2)]);
    });
    expect(ws.autoFilter).toBeTruthy();
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(ws.pageSetup.orientation).toBe('landscape');
    const colDias = COLUNAS_POR_URGENCIA_XLSX.indexOf('Dias até a ruptura') + 1;
    expect(valorDaCelula(ws, 2, colDias)).toBe(-5);
    // destaque: as 2 primeiras (criticas) tem fundo; as 2 ultimas nao
    const fundo = (linha: number) => (ws.getRow(linha).getCell(1).fill as exceljs.FillPattern | undefined)?.fgColor?.argb;
    expect([2, 3, 4, 5].map(fundo)).toEqual(['FFFDF1EC', 'FFFDF1EC', undefined, undefined]);
  });

  it('aba Por urgencia sem itens: cabecalho e aviso', async () => {
    const vazio = montarRelatorioCompras(quinzena([]), []);
    const ws = (await carregar(await gerarXlsxRelatorioCompras(vazio))).getWorksheet(ABA_POR_URGENCIA)!;
    expect(linhaComoArrayN(ws, 1, 20)).toEqual([...COLUNAS_POR_URGENCIA_XLSX]);
    expect(valorDaCelula(ws, 2, 1)).toBe('Nenhum item com demanda ≤ 0 nesta quinzena.');
  });

  it('aba Atencao sem consumo: motivos, quantidades e vazio', async () => {
    const r = montarRelatorioCompras(
      quinzena([
        linha({ linha: 1, item: 'PRODUTO 001', fonte: 'FONTE 001', codigos: ['C0001'], Q: 0, AG: 0, U: 10, AN: 10 }),
        linha({
          linha: 2,
          item: 'PRODUTO 002',
          fonte: 'FONTE 002',
          codigos: ['C0002', 'C0003'],
          status: 'cotando',
          obs: 'OBS SINTETICA 002',
          Q: 0,
          AG: 0,
          U: 20,
          AN: 15,
          programacoes: [0, 300, 0, 0],
          chegadas: [0, 0, 1200, 0, 0],
        }),
        linha({ linha: 3, item: 'PRODUTO 003', fonte: 'FONTE 009', codigos: ['C0004'], Q: 0, AG: 0, U: 5, AQ: null, AN: null }),
        linha({ linha: 4, item: 'PRODUTO 004', fonte: 'FONTE 004', Q: 0, AG: 0, U: 0, AN: 0 }),
      ]),
      [],
    );
    const ws = (await carregar(await gerarXlsxRelatorioCompras(r))).getWorksheet(ABA_SEM_CONSUMO)!;
    const n = COLUNAS_SEM_CONSUMO_XLSX.length;
    expect(COLUNAS_SEM_CONSUMO_XLSX).toEqual([
      'Item', 'Códigos', 'Fonte', 'Status', 'Motivo', 'Estoque', 'Programado', 'Programações', 'Chegadas',
      'Meses fora da média', 'Observação',
    ]);
    expect(linhaComoArrayN(ws, 1, n)).toEqual([...COLUNAS_SEM_CONSUMO_XLSX]);
    expect(ws.rowCount).toBe(4);
    expect(linhaComoArrayN(ws, 2, n)).toEqual([
      'PRODUTO 002',
      'C0002 · C0003',
      'FONTE 002',
      'Cotando',
      'tem programação · tem estoque',
      20,
      300,
      'Programação nov/2026: 300',
      'Chegada dez/2026: 1.200',
      '',
      'OBS SINTETICA 002',
    ]);
    expect(linhaComoArrayN(ws, 3, n)).toEqual([
      'PRODUTO 001', 'C0001', 'FONTE 001', 'Cotação não enviada', 'tem estoque', 10, 0, '—', '—', '', '',
    ]);
    expect(valorDaCelula(ws, 4, 3)).toBe('FONTE 009 (sem lead time)');
    expect(ws.getRow(2).getCell(6).numFmt).toBe('0.0');
    expect(ws.getRow(2).getCell(8).alignment?.wrapText).toBe(true);
    expect(ws.getRow(2).getCell(10).alignment?.wrapText).toBe(true);
    expect(ws.autoFilter).toBeTruthy();
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect((ws.getRow(2).getCell(1).fill as exceljs.FillPattern | undefined)?.fgColor?.argb).toBeUndefined();

    const vazio = montarRelatorioCompras(quinzena([]), []);
    const wsVazia = (await carregar(await gerarXlsxRelatorioCompras(vazio))).getWorksheet(ABA_SEM_CONSUMO)!;
    expect(linhaComoArrayN(wsVazia, 1, n)).toEqual([...COLUNAS_SEM_CONSUMO_XLSX]);
    expect(valorDaCelula(wsVazia, 2, 1)).toBe('Nenhum item sem consumo com estoque ou programação.');
  });

  it('nome de item que parece formula continua texto', async () => {
    const r = montarRelatorioCompras(
      quinzena([linha({ linha: 9, item: '=SOMA(A1)', fonte: 'FONTE 009', AN: -10 })]),
      [],
    );
    const ws = (await carregar(await gerarXlsxRelatorioCompras(r))).getWorksheet(ABA_RELATORIO)!;
    const cell = ws.getRow(mapearLinhas(r).grupos[0].primeiroItem).getCell(1);
    expect(cell.value).toBe('=SOMA(A1)');
    expect(cell.type).toBe(exceljs.ValueType.String);
  });
});

describe('Observacao e embalagens por opcao (PR 5B)', () => {
  it('Observação e sempre a ULTIMA coluna das 3 abas (nenhuma posicao existente muda)', () => {
    expect(COLUNAS_RELATORIO_XLSX.at(-1)).toBe('Observação');
    expect(COLUNAS_POR_URGENCIA_XLSX.at(-1)).toBe('Observação');
    expect(COLUNAS_SEM_CONSUMO_XLSX.at(-1)).toBe('Observação');
    expect(COLUNAS_RELATORIO_XLSX.slice(0, 17)).toEqual([
      'Item', 'Urgência', 'Códigos', 'Não fraciona', 'Status', 'Demanda', 'Qtd. sugerida', 'Embalagem', 'Arredondamento',
      'Outras embalagens', 'Qtd. final', 'Saldo zera', 'Ruptura', 'Dias até a ruptura', 'Data-limite', 'Vencida', 'Em andamento',
    ]);
  });

  it.each(['=', '+', '-', '@'])('obs que comeca com "%s" continua TEXTO nas 3 abas', async (prefixo) => {
    const obs = `${prefixo}OBS SINTETICA`;
    const r = montarRelatorioCompras(
      quinzena([
        linha({ linha: 1, item: 'PRODUTO 001', fonte: 'FONTE 001', AN: -10, obs }),
        linha({ linha: 2, item: 'PRODUTO 002', fonte: 'FONTE 001', Q: 0, AG: 0, U: 10, AN: 10, obs }),
      ]),
      [],
    );
    const wb = await carregar(await gerarXlsxRelatorioCompras(r));
    const celulas = [
      wb.getWorksheet(ABA_RELATORIO)!.getRow(mapearLinhas(r).grupos[0].primeiroItem).getCell(COL('Observação')),
      wb.getWorksheet(ABA_POR_URGENCIA)!.getRow(2).getCell(COLUNAS_POR_URGENCIA_XLSX.length),
      wb.getWorksheet(ABA_SEM_CONSUMO)!.getRow(2).getCell(COLUNAS_SEM_CONSUMO_XLSX.length),
    ];
    for (const cell of celulas) {
      expect(cell.value).toBe(obs);
      expect(cell.type).toBe(exceljs.ValueType.String);
    }
  });

  it('item sem obs: celula Observação vazia (backend sem o campo vira texto vazio)', () => {
    const r = montarRelatorioCompras(quinzena([linha({ linha: 1, item: 'PRODUTO 001', fonte: 'FONTE 001', AN: -10 })]), []);
    const item = r.grupos[0].itens[0];
    expect(item.obs).toBe('');
    expect(celulasDoItem(item, 15).at(-1)).toBe('');
  });

  it('uma so embalagem: Outras embalagens vazia; sem embalagem: nada novo', () => {
    const r = montarRelatorioCompras(
      quinzena([
        linha({ linha: 1, item: 'PRODUTO 001', fonte: 'FONTE 001', codigos: ['C0002'], AN: -450 }),
        linha({ linha: 2, item: 'PRODUTO 002', fonte: 'FONTE 001', codigos: ['C0004'], AN: -50 }),
      ]),
      EMBALAGENS,
    );
    const [a, b] = ['PRODUTO 001', 'PRODUTO 002'].map((n) => r.grupos[0].itens.find((i) => i.item === n)!);
    const col = (nome: (typeof COLUNAS_RELATORIO_XLSX)[number]) => COLUNAS_RELATORIO_XLSX.indexOf(nome);
    expect(celulasDoItem(a, 15)[col('Outras embalagens')]).toBe('');
    expect(celulasDoItem(b, 15)[col('Outras embalagens')]).toBe('');
    expect(celulasDoItem(b, 15)[col('Embalagem')]).toBe('Embalagem não cadastrada');
  });
});

describe('gerarXlsxRelatorioCompras (vazio)', () => {
  it('sem grupos avisa que nao ha itens', async () => {
    const vazio = montarRelatorioCompras(quinzena([]), []);
    expect(vazio.grupos).toEqual([]);
    const ws = (await carregar(await gerarXlsxRelatorioCompras(vazio))).getWorksheet(ABA_RELATORIO)!;
    const textos: string[] = [];
    ws.eachRow((row) => textos.push(String(row.getCell(1).value ?? '')));
    expect(textos).toContain('Nenhum item com demanda ≤ 0 nesta quinzena.');
    expect(textos.slice(0, linhasDoResumo(vazio).length)).toEqual(linhasDoResumo(vazio));
  });
});

describe('gerarXlsxRelatorioCompras (fixture anonimizada, hoje 2026-10-20)', () => {
  const calculadas = calcular(fixture, { hoje: HOJE, quinzena: 2 });
  const produtoPorLinha = new Map(fixture.produtos.map((p) => [p.linha, p]));
  const linhas: LinhaParaRelatorio[] = calculadas.map((c) => {
    const p = produtoPorLinha.get(c.linha)!;
    return {
      ...c,
      n: p.n,
      item: p.item,
      codigos: p.codigos.filter((x) => x !== ''),
      fonte: p.fonte,
      status: p.status,
      naoFraciona: p.naoFraciona.trim().toUpperCase() === 'X',
    };
  });
  const r = montarRelatorioCompras(
    { id: 7, label: fixture.id, baseDate: fixture.dataBase, half: 2, origin: 'planilha', hoje: HOJE, linhas },
    [],
  );

  it('45 faixas e 97 linhas de item na ordem da tela, sem embalagem e sem arredondar', async () => {
    const ws = (await carregar(await gerarXlsxRelatorioCompras(r))).getWorksheet(ABA_RELATORIO)!;
    const { grupos } = mapearLinhas(r);
    expect(grupos).toHaveLength(45);
    expect(grupos.flatMap(({ g }) => g.itens)).toHaveLength(97);
    const nomes: string[] = [];
    const embalagens: Array<string | number> = [];
    const finais: Array<string | number> = [];
    const sugeridas: Array<string | number> = [];
    let vencidas = 0;
    for (const { g, faixa, primeiroItem } of grupos) {
      expect(valorDaCelula(ws, faixa, 1)).toBe(tituloDoGrupo(g, r.urgencia.diasCritico));
      g.itens.forEach((_, i) => {
        const n = primeiroItem + i;
        nomes.push(String(valorDaCelula(ws, n, 1)));
        embalagens.push(valorDaCelula(ws, n, COL('Embalagem')));
        finais.push(valorDaCelula(ws, n, COL('Qtd. final')));
        sugeridas.push(valorDaCelula(ws, n, COL('Qtd. sugerida')));
        if (valorDaCelula(ws, n, COL('Vencida')) === 'Vencida') vencidas += 1;
      });
    }
    expect(nomes).toEqual(r.grupos.flatMap((g) => g.itens).map((i) => i.item));
    expect(embalagens).toEqual(Array(97).fill('Embalagem não cadastrada'));
    expect(finais).toEqual(sugeridas);
    expect(vencidas).toBe(r.totais.vencidas);
  });

  it('abas Por urgencia (97 itens, 29/23/39/6) e Atencao sem consumo (50 itens) e o resumo da 1a aba', async () => {
    const wb = await carregar(await gerarXlsxRelatorioCompras(r));
    const porUrgencia = wb.getWorksheet(ABA_POR_URGENCIA)!;
    const lista = itensNaOrdemDeUrgencia(r);
    expect(lista).toHaveLength(97);
    expect(porUrgencia.rowCount).toBe(98);
    const colU = COLUNAS_POR_URGENCIA_XLSX.indexOf('Urgência') + 1;
    const nomesNaAba = Array.from({ length: 97 }, (_, i) => String(valorDaCelula(porUrgencia, i + 2, 1)));
    expect(nomesNaAba).toEqual(lista.map((x) => x.item.item));
    const contagem: Record<string, number> = {};
    for (let i = 0; i < 97; i += 1) {
      const rotulo = String(valorDaCelula(porUrgencia, i + 2, colU));
      contagem[rotulo] = (contagem[rotulo] ?? 0) + 1;
    }
    expect(contagem).toEqual({
      'Sem estoque agora': 29,
      'Ruptura em até 15 dias': 23,
      Atrasado: 39,
      'No prazo': 6,
    });
    const semConsumo = wb.getWorksheet(ABA_SEM_CONSUMO)!;
    expect(r.semConsumo.itens).toHaveLength(50);
    expect(semConsumo.rowCount).toBe(51);
    expect(linhasDoResumo(r)).toContain(
      'Sem consumo: 50 em atenção (com estoque ou programação, fora da lista de compra) · 46 sem estoque nem programação',
    );
    expect(linhasDoResumo(r)).toContain(
      'Urgência: 29 sem estoque agora · 23 com ruptura em até 15 dias · 39 atrasados · 6 no prazo',
    );
  });
});

describe('nomeArquivoRelatorioCompras', () => {
  it('usa quinzena e data, sem fonte, item ou usuario', () => {
    expect(nomeArquivoRelatorioCompras({ label: '10-2', hoje: '2026-10-20' })).toBe(
      'relatorio-compras-10-2-2026-10-20.xlsx',
    );
  });

  it('sanitiza caracteres fora de [0-9A-Za-z-]', () => {
    const nome = nomeArquivoRelatorioCompras({ label: 'a/b c', hoje: '2026-10-20' });
    expect(nome).not.toContain('/');
    expect(nome).not.toContain(' ');
    expect(nome).toBe('relatorio-compras-a-b-c-2026-10-20.xlsx');
  });
});

describe('paridade com a tela do web', () => {
  it('rotulos de status iguais', () => {
    expect(STATUS_ROTULO_XLSX).toEqual(STATUS_ROTULO);
  });

  it('formatos iguais aos do web', () => {
    for (const d of ['2026-10-15', '2027-02-28']) {
      expect(dataBr(d)).toBe(dataBrWeb(d));
    }
    for (const v of [0, 5, -5, 1200, 1234567.6]) {
      expect(inteiroBr(v)).toBe(inteiroBrWeb(v));
    }
    for (const m of ['2026-10', '2027-01']) {
      expect(mesAbrev(m)).toBe(mesAbrevDoAnoMes(m));
    }
    for (const v of [0.5, 2.125, 25, 0.0004, 1250.5, 1234567.8912]) {
      expect(kgBr(v)).toBe(kgBrWeb(v));
    }
    expect(kgBr(0.5)).toBe('0,5');
    expect(kgBr(2.125)).toBe('2,125');
    expect(kgBr(25)).toBe('25');
    expect(kgBr(1250.5)).toBe('1.250,5');
    expect(dataBr(null)).toBe('—');
    expect(mesAbrev('2026-13')).toBe('—');
  });

  it('textos de urgencia e de sem consumo identicos aos da tela', () => {
    expect(URGENCIAS_XLSX).toEqual(URGENCIAS_WEB);
    expect(URGENCIAS).toEqual(URGENCIAS_WEB);
    for (const n of [0, 7, 15]) {
      for (const u of URGENCIAS) {
        expect(rotuloUrgencia(u, n)).toBe(rotuloUrgenciaWeb(u, n));
      }
      expect(paragrafoUrgencia(n)).toBe(paragrafoUrgenciaWeb(n));
      for (const c of [
        { 'sem-estoque': 1, critico: 1, atrasado: 1, 'no-prazo': 1 },
        { 'sem-estoque': 0, critico: 2, atrasado: 3, 'no-prazo': 0 },
      ]) {
        expect(resumoDeUrgencia(c, n)).toBe(resumoDeUrgenciaWeb(c, n));
      }
    }
    for (const m of [['estoque'], ['programacao'], ['programacao', 'estoque']] as const) {
      expect(textoMotivos([...m])).toBe(textoMotivosWeb([...m]));
    }
    expect(resumoSemConsumo(1, 0)).toBe(resumoSemConsumoWeb(1, 0));
    expect(resumoSemConsumo(50, 46)).toBe(resumoSemConsumoWeb(50, 46));
    expect(paragrafoSemConsumo()).toBe(paragrafoSemConsumoWeb());
  });

  it('textos de embalagem identicos aos da tela (formato de cada opcao e paragrafo das regras)', () => {
    const casos = [
      { codigo: 'C0002', quantidade: 200, rotulo: null, embalagens: 3, quantidadeFinal: 600, destaque: false },
      { codigo: 'C0003', quantidade: 25, rotulo: 'Saco 25 kg', embalagens: 18, quantidadeFinal: 450, destaque: true },
      { codigo: 'C0008', quantidade: 2.125, rotulo: null, embalagens: 2, quantidadeFinal: 4.25, destaque: false },
      { codigo: 'C0009', quantidade: 1250.5, rotulo: null, embalagens: 0, quantidadeFinal: 0, destaque: false },
    ];
    for (const op of casos) {
      expect(textoOpcaoDeEmbalagem(op)).toBe(textoOpcaoDeEmbalagemWeb(op));
    }
    expect(textoOpcaoDeEmbalagem(casos[0])).toBe('3 × 200 kg (código C0002) = 600 kg');
    expect(textoOpcaoDeEmbalagem(casos[1])).toBe('18 × Saco 25 kg (código C0003) = 450 kg');
    expect(PARAGRAFO_EMBALAGEM_XLSX).toBe(PARAGRAFO_EMBALAGEM);
  });

  it('a tela contem os mesmos textos que o arquivo', () => {
    // a tela = o componente + as funcoes puras de texto (forecastRelatorioUrgencia.ts)
    const pasta = resolve(__dirname, '..', 'web', 'src', 'pages', 'Forecast');
    const tela =
      readFileSync(resolve(pasta, 'ForecastRelatorioCompras.tsx'), 'utf8') +
      readFileSync(resolve(pasta, 'forecastRelatorioUrgencia.ts'), 'utf8') +
      readFileSync(resolve(pasta, 'forecastRelatorioTextos.ts'), 'utf8');
    for (const texto of [
      'Urgência',
      'Por urgência',
      'Por fonte',
      'Atenção: sem consumo',
      'Não entram na lista de compra',
      'Embalagem não cadastrada',
      'Não fraciona',
      'Vencida',
      'Arredondado pela embalagem do código',
      'já na data-base',
      'sem ruptura em 6 meses',
      'Qtd. sugerida',
      'Qtd. final',
      'Saldo zera',
      'Data-limite',
      'Em andamento',
      'Fora do relatório:',
      'Obs.:',
    ]) {
      expect(tela).toContain(texto);
    }
  });
});

// Pallet fechado (PR 6e): o texto fica dentro das celulas de embalagem (nenhuma coluna nova: Observacao segue a ultima).
describe('pallet fechado no XLSX (PR 6e)', () => {
  const comPallet = montarRelatorioCompras(
    quinzena([
      // Embalagem usada com pallet; a outra (nao destacada) tambem tem pallet.
      linha({ linha: 1, item: 'PRODUTO 001', fonte: 'FONTE 001', codigos: ['C0001', 'C0002'], AN: -1400, obs: 'OBS SINTETICA' }),
      // Multiplo exato e so uma embalagem.
      linha({ linha: 2, item: 'PRODUTO 002', fonte: 'FONTE 001', codigos: ['C0003'], AN: -1200 }),
      // Sem pallet cadastrado.
      linha({ linha: 3, item: 'PRODUTO 003', fonte: 'FONTE 002', codigos: ['C0004'], AN: -100 }),
      // Menos de 1 pallet: so "acima".
      linha({ linha: 4, item: 'PRODUTO 004', fonte: 'FONTE 002', codigos: ['C0005'], AN: -500 }),
    ]),
    [
      { codigo: 'C0001', quantidade: 25, palletKg: 600 },
      { codigo: 'C0002', quantidade: 1000, palletKg: 2000 },
      { codigo: 'C0003', quantidade: 25, palletKg: 600 },
      { codigo: 'C0004', quantidade: 25 },
      { codigo: 'C0005', quantidade: 25, palletKg: 600 },
    ],
  );

  const itens = comPallet.grupos.flatMap((g) => g.itens);
  const porNome = (nome: string) => itens.find((i) => i.item === nome)!;

  it('textoPallet do XLSX e identico ao da tela nos casos (abaixo+acima, exato, so acima, singular, kg com casas)', () => {
    for (const [qtd, pallet] of [
      [1400, 600],
      [1200, 600],
      [500, 600],
      [700, 600],
      [3000, 1250.5],
      [0.3, 0.125],
    ] as const) {
      const p = opcoesDePallet(qtd, pallet);
      expect(textoPallet(p)).toBe(textoPalletWeb(p));
    }
    expect(textoPallet(opcoesDePallet(1400, 600))).toBe(
      'Pallet de 600 kg: 2 pallets = 1.200 kg (abaixo) · 3 pallets = 1.800 kg (acima)',
    );
    expect(textoPalletWeb(null)).toBeNull();
    expect(textoPalletWeb(undefined)).toBeNull();
  });

  it('celulas Embalagem e Outras embalagens = as linhas da tela, com o pallet logo abaixo de cada opcao', () => {
    const i = porNome('PRODUTO 001');
    const cel = celulasDoItem(i, 15);
    const col = (nome: (typeof COLUNAS_RELATORIO_XLSX)[number]) => COLUNAS_RELATORIO_XLSX.indexOf(nome);
    expect(cel[col('Embalagem')]).toBe(
      '56 × 25 kg (código C0001)\nPallet de 600 kg: 2 pallets = 1.200 kg (abaixo) · 3 pallets = 1.800 kg (acima)',
    );
    expect(cel[col('Outras embalagens')]).toBe(
      '2 × 1.000 kg (código C0002) = 2.000 kg\nPallet de 2.000 kg: 1 pallet = 2.000 kg (acima)',
    );
    // Paridade: o mesmo texto que a tela monta (palletDoDestaque / opcoesOutrasComPallet).
    const web = i as unknown as Parameters<typeof palletDoDestaque>[0] & Parameters<typeof opcoesOutrasComPallet>[0];
    expect(cel[col('Embalagem')]).toBe(`56 × 25 kg (código C0001)\n${palletDoDestaque(web)}`);
    expect(cel[col('Outras embalagens')]).toBe(
      opcoesOutrasComPallet(web)
        .flatMap(({ texto, pallet }) => (pallet ? [texto, pallet] : [texto]))
        .join('\n'),
    );
  });

  it('multiplo exato, so acima e sem pallet', () => {
    const col = (nome: (typeof COLUNAS_RELATORIO_XLSX)[number]) => COLUNAS_RELATORIO_XLSX.indexOf(nome);
    expect(celulasDoItem(porNome('PRODUTO 002'), 15)[col('Embalagem')]).toBe(
      '48 × 25 kg (código C0003)\nPallet de 600 kg: 2 pallets = 1.200 kg (exato)',
    );
    expect(celulasDoItem(porNome('PRODUTO 004'), 15)[col('Embalagem')]).toBe(
      '20 × 25 kg (código C0005)\nPallet de 600 kg: 1 pallet = 600 kg (acima)',
    );
    expect(celulasDoItem(porNome('PRODUTO 003'), 15)[col('Embalagem')]).toBe('4 × 25 kg (código C0004)');
    expect(celulasDoItem(porNome('PRODUTO 002'), 15)[col('Outras embalagens')]).toBe('');
  });

  it('a Qtd. final continua a da embalagem em destaque (o pallet e so informacao)', () => {
    expect(porNome('PRODUTO 001').quantidadeFinal).toBe(1400);
    expect(porNome('PRODUTO 004').quantidadeFinal).toBe(500);
  });

  it('as 3 abas: celulas iguais a celulasDoItem, Observacao continua a ultima coluna e o resumo conta os itens com pallet', async () => {
    const wb = await carregar(await gerarXlsxRelatorioCompras(comPallet));
    const ws = wb.getWorksheet(ABA_RELATORIO)!;
    const { grupos } = mapearLinhas(comPallet);
    for (const { g, primeiroItem } of grupos) {
      g.itens.forEach((item, i) => {
        expect(linhaComoArray(ws, primeiroItem + i)).toEqual(celulasDoItem(item, 15));
      });
    }
    // Por urgencia: mesma celula de embalagem (Fonte entra depois de Urgencia).
    const wu = wb.getWorksheet(ABA_POR_URGENCIA)!;
    const lista = itensNaOrdemDeUrgencia(comPallet);
    const colU = (nome: (typeof COLUNAS_POR_URGENCIA_XLSX)[number]) => COLUNAS_POR_URGENCIA_XLSX.indexOf(nome) + 1;
    lista.forEach(({ item }, i) => {
      const c = celulasDoItem(item, 15);
      expect(valorDaCelula(wu, i + 2, colU('Embalagem'))).toBe(c[COLUNAS_RELATORIO_XLSX.indexOf('Embalagem')]);
      expect(valorDaCelula(wu, i + 2, colU('Outras embalagens'))).toBe(c[COLUNAS_RELATORIO_XLSX.indexOf('Outras embalagens')]);
    });
    expect(COLUNAS_RELATORIO_XLSX.at(-1)).toBe('Observação');
    expect(COLUNAS_POR_URGENCIA_XLSX.at(-1)).toBe('Observação');
    expect(COLUNAS_SEM_CONSUMO_XLSX.at(-1)).toBe('Observação');
    expect(valorDaCelula(wu, 2, colU('Observação'))).toBe(lista[0].item.obs);
    expect(comPallet.totais.comPallet).toBe(3);
    expect(linhasDoResumo(comPallet)).toContain('3 com pallet cadastrado');
    const regras = wb.getWorksheet(ABA_REGRAS)!;
    expect(valorDaCelula(regras, 3, 1)).toBe(PARAGRAFO_EMBALAGEM);
  });

  it('sem nenhum pallet cadastrado: a linha do resumo nao aparece e a celula e a de antes', () => {
    const r = montarRelatorioCompras(
      quinzena([linha({ linha: 1, item: 'PRODUTO 001', fonte: 'FONTE 001', codigos: ['C0001'], AN: -1400 })]),
      [{ codigo: 'C0001', quantidade: 25 }],
    );
    expect(linhasDoResumo(r).some((l) => l.includes('pallet'))).toBe(false);
    expect(celulasDoItem(r.grupos[0].itens[0], 15)[COLUNAS_RELATORIO_XLSX.indexOf('Embalagem')]).toBe(
      '56 × 25 kg (código C0001)',
    );
  });

  it('a tela contem os textos do pallet', () => {
    const pasta = resolve(__dirname, '..', 'web', 'src', 'pages', 'Forecast');
    const tela =
      readFileSync(resolve(pasta, 'ForecastRelatorioCompras.tsx'), 'utf8') +
      readFileSync(resolve(pasta, 'forecastRelatorioTextos.ts'), 'utf8');
    for (const texto of ['Pallet de ', 'com pallet cadastrado', 'fcr-embalagem__pallet']) {
      expect(tela).toContain(texto);
    }
  });
});

// ---- Compra sob demanda (PR 6a) ----
describe('compra sob demanda no XLSX', () => {
  // PRODUTO 001 marcado (entraria com 800), PRODUTO 002 regular e PRODUTO 003 sem consumo marcado (so selo).
  const marca = new Map([
    [1, { motivo: 'MOTIVO SINTETICO' }],
    [3, { motivo: null }],
  ]);
  const base = [
    linha({
      linha: 1,
      productId: 1,
      item: 'PRODUTO 001',
      fonte: 'FONTE 001',
      Q: 100,
      AG: 100,
      U: 300,
      AN: -800,
      AQ: 60,
      status: 'cotando',
      obs: 'OBS SINTETICA 001',
      chegadas: [0, 0, 0, 0, 100],
      programacoes: [0, 800, 0, 0],
    }),
    linha({ linha: 2, productId: 2, item: 'PRODUTO 002', fonte: 'FONTE 001', AN: -100 }),
    linha({
      linha: 3,
      productId: 3,
      item: 'PRODUTO 003',
      fonte: 'FONTE 002',
      Q: 0,
      AG: 0,
      U: 200,
      AN: 200,
      projecao: [200, 200, 200, 200, 200, 200],
    }),
  ];
  const comMarca = montarRelatorioCompras(quinzena(base), [], { sobDemanda: marca });
  const semMarca = montarRelatorioCompras(quinzena(base), []);
  const abrir = async (r: RelatorioCompras) => carregar(await gerarXlsxRelatorioCompras(r));

  it('premissa: o item marcado sai da lista e vai para a secao; o sem consumo so ganha o selo', () => {
    expect(comMarca.totais.itens).toBe(1);
    expect(comMarca.sobDemanda.itens.map((i) => i.item)).toEqual(['PRODUTO 001']);
    expect(comMarca.sobDemanda.itens[0].programacaoDescoberta).toBe(400); // 800 - 300 - 100
    expect(comMarca.fora.sobDemanda).toBe(1);
    expect(comMarca.semConsumo.itens.map((i) => [i.item, i.sobDemanda])).toEqual([['PRODUTO 003', true]]);
  });

  it('com item: aba "Sob demanda" depois da de sem consumo e antes das Regras; cabecalho e linhas = celulas', async () => {
    const wb = await abrir(comMarca);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      ABA_RELATORIO,
      ABA_POR_URGENCIA,
      ABA_SEM_CONSUMO,
      ABA_SOB_DEMANDA,
      ABA_REGRAS,
    ]);
    const ws = wb.getWorksheet(ABA_SOB_DEMANDA)!;
    const n = COLUNAS_SOB_DEMANDA_XLSX.length;
    expect(linhaComoArrayN(ws, 1, n)).toEqual([...COLUNAS_SOB_DEMANDA_XLSX]);
    expect(linhaComoArrayN(ws, 2, n)).toEqual(celulasDoItemSobDemanda(comMarca.sobDemanda.itens[0]));
    expect(linhaComoArrayN(ws, 2, n)).toEqual([
      'PRODUTO 001',
      'C0001',
      'FONTE 001',
      'Cotando',
      'Compra sob programação do cliente: MOTIVO SINTETICO',
      -800,
      'Programação nov/2026: 800',
      400,
      300,
      'Chegada fev/2027: 100',
      '',
      'OBS SINTETICA 001',
    ]);
    expect(COLUNAS_SOB_DEMANDA_XLSX.at(-1)).toBe('Observação');
  });

  it('o item marcado nao aparece nas abas de compra (por fonte e por urgencia)', async () => {
    const wb = await abrir(comMarca);
    for (const nome of [ABA_RELATORIO, ABA_POR_URGENCIA]) {
      const ws = wb.getWorksheet(nome)!;
      const itensDaAba: string[] = [];
      ws.eachRow((row) => itensDaAba.push(String(row.getCell(1).value ?? '')));
      expect(itensDaAba).toContain('PRODUTO 002');
      expect(itensDaAba).not.toContain('PRODUTO 001');
    }
  });

  it('resumo com a contagem so quando ha item; Regras ganha o paragrafo antes da nota de origem', async () => {
    expect(linhasDoResumo(comMarca)).toContain('1 sob demanda (fora da lista de compra)');
    expect(linhasDoResumo(semMarca).some((l) => l.includes('sob demanda'))).toBe(false);
    const regras = paragrafosDeRegras(15, true);
    expect(regras.at(-2)).toBe(paragrafoSobDemanda());
    expect(regras.at(-1)).toBe('Arquivo gerado do mesmo relatório exibido na tela (quinzena calculada).');
    expect(paragrafosDeRegras(15)).toEqual(regras.filter((p) => p !== paragrafoSobDemanda()));

    const wb = await abrir(comMarca);
    const textos: string[] = [];
    wb.getWorksheet(ABA_REGRAS)!.eachRow((row) => textos.push(String(row.getCell(1).value)));
    expect(textos).toEqual(paragrafosDeRegras(15, true));
  });

  it('sem item sob demanda: nada muda (4 abas, sem linha no resumo, Regras igual a de antes)', async () => {
    expect(semMarca.sobDemanda.itens).toEqual([]);
    expect(semMarca.fora.sobDemanda).toBe(0);
    const wb = await abrir(semMarca);
    expect(wb.worksheets.map((w) => w.name)).toEqual([ABA_RELATORIO, ABA_POR_URGENCIA, ABA_SEM_CONSUMO, ABA_REGRAS]);
    const textos: string[] = [];
    wb.getWorksheet(ABA_REGRAS)!.eachRow((row) => textos.push(String(row.getCell(1).value)));
    expect(textos.some((t) => t.includes('sob demanda'))).toBe(false);
  });

  it('sem consumo: coluna Motivo ganha "compra sob demanda" no item marcado', async () => {
    const wb = await abrir(comMarca);
    const ws = wb.getWorksheet(ABA_SEM_CONSUMO)!;
    const colMotivo = COLUNAS_SEM_CONSUMO_XLSX.indexOf('Motivo') + 1;
    expect(valorDaCelula(ws, 2, colMotivo)).toBe('tem estoque · compra sob demanda');
    expect(COLUNAS_SEM_CONSUMO_XLSX.at(-1)).toBe('Observação');
  });

  it('Observação continua a ULTIMA coluna das 3 abas existentes (nenhuma coluna nova entre elas)', () => {
    expect(COLUNAS_RELATORIO_XLSX.at(-1)).toBe('Observação');
    expect(COLUNAS_POR_URGENCIA_XLSX.at(-1)).toBe('Observação');
    expect(COLUNAS_SEM_CONSUMO_XLSX.at(-1)).toBe('Observação');
  });

  it('paridade tela x XLSX: motivo, resumo e paragrafo iguais; textoMotivos com o selo', () => {
    for (const motivo of [null, '', 'MOTIVO SINTETICO']) {
      expect(textoMotivoSobDemanda(motivo || null)).toBe(textoMotivoSobDemandaWeb(motivo));
    }
    expect(resumoSobDemanda(1)).toBe(resumoSobDemandaWeb(1));
    expect(resumoSobDemanda(12)).toBe(resumoSobDemandaWeb(12));
    expect(paragrafoSobDemanda()).toBe(paragrafoSobDemandaWeb());
    expect(textoMotivos(['programacao', 'estoque'], true)).toBe(textoMotivosWeb(['programacao', 'estoque'], true));
    expect(textoMotivos(['estoque'])).toBe(textoMotivosWeb(['estoque']));
  });
});

// ---- Meses atipicos fora da media (PR 6c) ----
describe('meses atipicos fora da media no XLSX', () => {
  // PRODUTO 001 (lista) com ago/2026 e set/2026 fora; PRODUTO 002 (lista) sem marca; PRODUTO 003 sem consumo, com ago/2026;
  // PRODUTO 004 sob demanda, com ago/2026.
  const base = [
    linha({
      linha: 1,
      productId: 1,
      item: 'PRODUTO 001',
      fonte: 'FONTE 001',
      obs: 'OBS SINTETICA 001',
      mesesForaDaMedia: [{ anoMes: '2026-08' }, { anoMes: '2026-09' }],
    }),
    linha({ linha: 2, productId: 2, item: 'PRODUTO 002', fonte: 'FONTE 001', AN: -50 }),
    linha({
      linha: 3,
      productId: 3,
      item: 'PRODUTO 003',
      fonte: 'FONTE 002',
      Q: 0,
      AG: 0,
      U: 200,
      AN: 200,
      projecao: [200, 200, 200, 200, 200, 200],
      mesesForaDaMedia: [{ anoMes: '2026-08' }],
    }),
    linha({
      linha: 4,
      productId: 4,
      item: 'PRODUTO 004',
      fonte: 'FONTE 003',
      AN: -300,
      obs: 'OBS SINTETICA 004',
      mesesForaDaMedia: [{ anoMes: '2026-08' }],
    }),
  ];
  const marca = new Map([[4, { motivo: 'MOTIVO SINTETICO' }]]);
  const com = montarRelatorioCompras(quinzena(base), [], { sobDemanda: marca });
  const semMarcas = montarRelatorioCompras(
    quinzena(base.map(({ mesesForaDaMedia: _omitido, ...resto }) => resto)),
    [],
    { sobDemanda: marca },
  );
  const abrir = async (r: RelatorioCompras) => carregar(await gerarXlsxRelatorioCompras(r));

  it('premissa: o relatorio repassa os meses fora da media nas tres listas', () => {
    expect(com.grupos[0].itens.map((i) => [i.item, i.mesesForaDaMedia])).toEqual([
      ['PRODUTO 001', ['2026-08', '2026-09']],
      ['PRODUTO 002', []],
    ]);
    expect(com.semConsumo.itens.map((i) => i.mesesForaDaMedia)).toEqual([['2026-08']]);
    expect(com.sobDemanda.itens.map((i) => i.mesesForaDaMedia)).toEqual([['2026-08']]);
  });

  it('coluna "Meses fora da média" fica ANTES da Observação, que continua a ultima, nas 4 abas', () => {
    for (const colunas of [
      COLUNAS_RELATORIO_XLSX,
      COLUNAS_POR_URGENCIA_XLSX,
      COLUNAS_SEM_CONSUMO_XLSX,
      COLUNAS_SOB_DEMANDA_XLSX,
    ] as ReadonlyArray<readonly string[]>) {
      expect(colunas.at(-1)).toBe('Observação');
      expect(colunas.at(-2)).toBe('Meses fora da média');
      expect(colunas.filter((c) => c === 'Meses fora da média')).toHaveLength(1);
    }
  });

  it('aba por fonte e por urgencia: texto dos meses e Observacao na ultima coluna', async () => {
    const wb = await abrir(com);
    const mapa = mapearLinhas(com);
    const row = (i: number) => linhaComoArray(wb.getWorksheet(ABA_RELATORIO)!, mapa.grupos[0].primeiroItem + i);
    expect(row(0)[COL('Meses fora da média') - 1]).toBe('ago/2026, set/2026');
    expect(row(0)[COL('Observação') - 1]).toBe('OBS SINTETICA 001');
    expect(row(0)).toEqual(celulasDoItem(com.grupos[0].itens[0], 15));
    expect(row(1)[COL('Meses fora da média') - 1]).toBe('');

    const urg = wb.getWorksheet(ABA_POR_URGENCIA)!;
    const colMeses = COLUNAS_POR_URGENCIA_XLSX.indexOf('Meses fora da média') + 1;
    const colObs = COLUNAS_POR_URGENCIA_XLSX.indexOf('Observação') + 1;
    expect(colObs).toBe(COLUNAS_POR_URGENCIA_XLSX.length);
    const textos = itensNaOrdemDeUrgencia(com).map((_, i) => valorDaCelula(urg, i + 2, colMeses));
    expect([...textos].sort()).toEqual(['', 'ago/2026, set/2026']);
  });

  it('abas sem consumo e sob demanda: coluna preenchida e Observação por ultimo', async () => {
    const wb = await abrir(com);
    const sem = wb.getWorksheet(ABA_SEM_CONSUMO)!;
    expect(valorDaCelula(sem, 2, COLUNAS_SEM_CONSUMO_XLSX.indexOf('Meses fora da média') + 1)).toBe('ago/2026');
    const sob = wb.getWorksheet(ABA_SOB_DEMANDA)!;
    const n = COLUNAS_SOB_DEMANDA_XLSX.length;
    expect(linhaComoArrayN(sob, 2, n)).toEqual(celulasDoItemSobDemanda(com.sobDemanda.itens[0]));
    expect(valorDaCelula(sob, 2, n - 1)).toBe('ago/2026');
    expect(valorDaCelula(sob, 2, n)).toBe('OBS SINTETICA 004');
  });

  it('resumo e Regras ganham a linha e o paragrafo so quando ha item com meses fora da media', async () => {
    expect(contarComMesesForaDaMedia(com)).toBe(3);
    expect(linhasDoResumo(com)).toContain('3 itens usam média sem meses atípicos');
    expect(linhasDoResumo(semMarcas).some((l) => l.includes('meses atípicos'))).toBe(false);

    const regras = paragrafosDeRegras(15, true, true);
    expect(regras.at(-2)).toBe(paragrafoMesesForaDaMedia());
    expect(regras.at(-1)).toBe('Arquivo gerado do mesmo relatório exibido na tela (quinzena calculada).');
    expect(paragrafosDeRegras(15, true)).toEqual(regras.filter((p) => p !== paragrafoMesesForaDaMedia()));
    const wb = await abrir(com);
    const textos: string[] = [];
    wb.getWorksheet(ABA_REGRAS)!.eachRow((row) => textos.push(String(row.getCell(1).value)));
    expect(textos).toEqual(paragrafosDeRegras(15, true, true));

    // Sem marca: Regras identica a de antes.
    const wbSem = await abrir(semMarcas);
    const textosSem: string[] = [];
    wbSem.getWorksheet(ABA_REGRAS)!.eachRow((row) => textosSem.push(String(row.getCell(1).value)));
    expect(textosSem).toEqual(paragrafosDeRegras(15, true));
  });

  it('sem meses marcados a coluna existe mas fica vazia em todas as abas', async () => {
    const wb = await abrir(semMarcas);
    const mapa = mapearLinhas(semMarcas);
    expect(linhaComoArray(wb.getWorksheet(ABA_RELATORIO)!, mapa.grupos[0].primeiroItem)[COL('Meses fora da média') - 1]).toBe('');
    const sem = wb.getWorksheet(ABA_SEM_CONSUMO)!;
    expect(valorDaCelula(sem, 2, COLUNAS_SEM_CONSUMO_XLSX.indexOf('Meses fora da média') + 1)).toBe('');
  });

  it('paridade tela x XLSX: texto dos meses, contagem, resumo e paragrafo iguais', () => {
    for (const meses of [[], ['2026-08'], ['2026-08', '2026-09', '2026-10']]) {
      expect(textoMesesForaDaMedia(meses)).toBe(textoMesesForaDaMediaWeb(meses));
    }
    for (const n of [1, 2, 10]) {
      expect(resumoMesesForaDaMedia(n)).toBe(resumoMesesForaDaMediaWeb(n));
    }
    expect(paragrafoMesesForaDaMedia()).toBe(paragrafoMesesForaDaMediaWeb());
    expect(contarComMesesForaDaMedia(com)).toBe(
      contarComMesesForaDaMediaWeb(com as unknown as Parameters<typeof contarComMesesForaDaMediaWeb>[0]),
    );
    // A linha da tela e o texto do XLSX usam a mesma lista: "Média sem: " + texto.
    expect(textoMediaSemWeb(['2026-08', '2026-09'])).toBe(`Média sem: ${textoMesesForaDaMedia(['2026-08', '2026-09'])}`);
  });
});
