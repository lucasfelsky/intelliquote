import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import exceljs from 'exceljs';
import { describe, expect, it } from 'vitest';
import { calcular } from '../src/utils/forecastEngine';
import {
  montarRelatorioCompras,
  type EmbalagemCadastrada,
  type LinhaParaRelatorio,
  type QuinzenaParaRelatorio,
  type RelatorioCompras,
} from '../src/utils/forecastRelatorioCompras';
import {
  ABA_REGRAS,
  ABA_RELATORIO,
  COLUNAS_RELATORIO_XLSX,
  STATUS_ROTULO_XLSX,
  celulasDoItem,
  dataBr,
  gerarXlsxRelatorioCompras,
  inteiroBr,
  kgBr,
  linhasDoResumo,
  mesAbrev,
  nomeArquivoRelatorioCompras,
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
  });

  it('tem as duas abas, na ordem', async () => {
    const wb = await abrir();
    expect(wb.worksheets.map((w) => w.name)).toEqual([ABA_RELATORIO, ABA_REGRAS]);
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
      expect(valorDaCelula(ws, faixa, 1)).toBe(tituloDoGrupo(g));
      expect(ws.getRow(faixa).getCell(1).font?.bold).toBe(true);
      expect(linhaComoArray(ws, cabecalho)).toEqual([...COLUNAS_RELATORIO_XLSX]);
      g.itens.forEach((item, i) => {
        expect(linhaComoArray(ws, primeiroItem + i)).toEqual(celulasDoItem(item));
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
    expect(cel('PRODUTO 001', 'Outras embalagens')).toBe('C0003 (25 kg)');
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
        const fill = row.getCell(1).fill as exceljs.FillPattern | undefined;
        if (item.vencida) {
          expect(fill?.fgColor?.argb).toBeDefined();
          expect(row.getCell(COL('Vencida')).font?.bold).toBe(true);
        } else {
          expect(fill?.fgColor?.argb).toBeUndefined();
        }
        for (const nome of ['Item', 'Códigos', 'Status', 'Embalagem', 'Arredondamento', 'Outras embalagens', 'Ruptura', 'Em andamento'] as const) {
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
    expect(valorDaCelula(ws, n, COL('Outras embalagens'))).toBe('C0008 (2,125 kg), C0009 (1.250,5 kg)');
  });

  it('configura a pagina em paisagem, ajustada a largura', async () => {
    const wb = await abrir();
    const ws = wb.getWorksheet(ABA_RELATORIO)!;
    expect(ws.pageSetup.orientation).toBe('landscape');
    expect(ws.pageSetup.fitToPage).toBe(true);
    expect(ws.pageSetup.fitToWidth).toBe(1);
    expect(ws.pageSetup.fitToHeight).toBe(0);
  });

  it('aba Regras traz os 3 paragrafos da tela e a nota de origem', async () => {
    const wb = await abrir();
    const ws = wb.getWorksheet(ABA_REGRAS)!;
    const textos = [1, 2, 3, 4].map((n) => String(valorDaCelula(ws, n, 1)));
    expect(textos[0]).toContain('O saldo zera no primeiro mês');
    expect(textos[1]).toContain('Data-limite do pedido = ruptura − lead time da fonte');
    expect(textos[2]).toContain('Quantidade sugerida = demanda em módulo.');
    expect(textos[3]).toBe('Arquivo gerado do mesmo relatório exibido na tela (quinzena calculada).');
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
      expect(valorDaCelula(ws, faixa, 1)).toBe(tituloDoGrupo(g));
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

  it('a tela contem os mesmos textos que o arquivo', () => {
    const tela = readFileSync(
      resolve(__dirname, '..', 'web', 'src', 'pages', 'Forecast', 'ForecastRelatorioCompras.tsx'),
      'utf8',
    );
    for (const texto of [
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
    ]) {
      expect(tela).toContain(texto);
    }
  });
});
