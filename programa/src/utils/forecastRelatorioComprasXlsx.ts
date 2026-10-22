// Exportacao XLSX do relatorio de compras do Forecast (PR 2B).
// Util PURO: recebe o relatorio ja montado (o mesmo objeto que a tela exibe) e so FORMATA.
// Nao recalcula nada (ruptura, data-limite, embalagem, ordem, filtro) e nao depende da origem dos dados.
// Datas saem como texto dd/mm/aaaa, igual a tela. Rotulos e formatos espelham o web
// (guarda de paridade em tests/forecast-relatorio-compras-xlsx.test.ts).
import exceljs from 'exceljs';
import type {
  GrupoRelatorioCompras,
  ItemRelatorioCompras,
  RelatorioCompras,
} from './forecastRelatorioCompras';

export const ABA_RELATORIO = 'Relatório de compras';
export const ABA_REGRAS = 'Regras';

// As 10 colunas da tela; Item / Embalagem / Data-limite desdobradas em colunas filtraveis.
export const COLUNAS_RELATORIO_XLSX = [
  'Item',
  'Códigos',
  'Não fraciona',
  'Status',
  'Demanda',
  'Qtd. sugerida',
  'Embalagem',
  'Arredondamento',
  'Outras embalagens',
  'Qtd. final',
  'Saldo zera',
  'Ruptura',
  'Data-limite',
  'Vencida',
  'Em andamento',
] as const;

// Copia exata de STATUS_ROTULO (web/src/pages/Forecast/forecastPainel.ts).
export const STATUS_ROTULO_XLSX: Record<string, string> = {
  nao: 'Cotação não enviada',
  cotando: 'Cotando',
  confirmado: 'Confirmado, aguarda PO',
  po: 'PO enviada',
  preco: 'Só atualização de preço',
};

const MES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;
const INT_BR = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const KG_BR = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const TRACO = '—';

const COL_ITEM = 1;
const COL_EMBALAGEM = COLUNAS_RELATORIO_XLSX.indexOf('Embalagem') + 1;
const COL_NAO_FRACIONA = COLUNAS_RELATORIO_XLSX.indexOf('Não fraciona') + 1;
const COL_QTD_FINAL = COLUNAS_RELATORIO_XLSX.indexOf('Qtd. final') + 1;
const COL_VENCIDA = COLUNAS_RELATORIO_XLSX.indexOf('Vencida') + 1;
const COL_ANDAMENTO = COLUNAS_RELATORIO_XLSX.indexOf('Em andamento') + 1;
// Colunas de texto que podem passar da largura: quebram linha em vez de cortar (ex.: Arredondamento tem ate 42 caracteres).
const COLUNAS_TEXTO_QUEBRA = (
  ['Item', 'Códigos', 'Status', 'Embalagem', 'Arredondamento', 'Outras embalagens', 'Ruptura', 'Em andamento'] as const
).map((nome) => COLUNAS_RELATORIO_XLSX.indexOf(nome) + 1);
const COLUNAS_NUMERICAS = [
  COLUNAS_RELATORIO_XLSX.indexOf('Demanda') + 1,
  COLUNAS_RELATORIO_XLSX.indexOf('Qtd. sugerida') + 1,
  COL_QTD_FINAL,
];
const LARGURAS = [34, 22, 14, 24, 11, 13, 30, 34, 30, 11, 12, 18, 13, 10, 28];

const plural = (n: number, singular: string, pluralForm: string) => (n === 1 ? singular : pluralForm);

// 'AAAA-MM-DD' -> 'dd/mm/aaaa' pelo texto (sem Date: evita o dia anterior em BRT); nulo/invalido -> '—'.
export function dataBr(key: string | null): string {
  const m = key ? /^(\d{4})-(\d{2})-(\d{2})/.exec(key) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : TRACO;
}

// '2026-10' -> 'out/2026'; invalido -> '—'.
export function mesAbrev(anoMes: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(anoMes);
  const abrev = m ? MES_ABREV[Number(m[2]) - 1] : undefined;
  return m && abrev ? `${abrev}/${m[1]}` : TRACO;
}

// kg de embalagem: ate 3 casas pt-BR (0,5 / 2,25 / 25), sem arredondar para inteiro; igual ao kgBr do web.
export function kgBr(v: number): string {
  return KG_BR.format(v);
}

// Inteiro pt-BR com milhar e sinal tipografico, igual ao do web.
export function inteiroBr(v: number): string {
  const arredondado = Math.round(v);
  return (arredondado < 0 ? '−' : '') + INT_BR.format(Math.abs(arredondado));
}

export function tituloDoGrupo(g: GrupoRelatorioCompras): string {
  const urgente = g.dataLimiteMaisUrgente ? `mais urgente ${dataBr(g.dataLimiteMaisUrgente)}` : 'sem data-limite';
  const base = `${g.fonte || 'Sem fonte'} · lead time ${g.leadTimeDias} dias · ${urgente}`;
  return g.vencidas > 0 ? `${base} · ${g.vencidas} ${plural(g.vencidas, 'vencida', 'vencidas')}` : base;
}

export function linhasDoResumo(r: RelatorioCompras): string[] {
  const { quinzena, totais, fora } = r;
  const linhas = [
    'Forecast de compras · Relatório de compras',
    'Beta · Em validação: confira os números com a planilha do Forecast.',
    `Quinzena ${quinzena.label} (base ${dataBr(quinzena.baseDate)}) · datas conferidas em ${dataBr(quinzena.hoje)}`,
    `${totais.itens} ${plural(totais.itens, 'item', 'itens')} em ${totais.fontes} ${plural(totais.fontes, 'fonte', 'fontes')}`,
    `${totais.vencidas} com data-limite vencida`,
    `${totais.semEmbalagem} sem embalagem cadastrada`,
  ];
  if (totais.multiplasEmbalagens > 0) {
    linhas.push(`${totais.multiplasEmbalagens} com mais de uma embalagem`);
  }
  linhas.push(`Fora do relatório: ${fora.semLeadTime} sem lead time, ${fora.semConsumoSemFalta} sem consumo e sem falta`);
  return linhas;
}

function textoEmbalagem(item: ItemRelatorioCompras): string {
  const { usada } = item.embalagem;
  if (!usada) {
    return 'Embalagem não cadastrada';
  }
  const nome = usada.rotulo ?? `${kgBr(usada.quantidade)} kg`;
  return `${item.quantidadeEmbalagens} × ${nome} (código ${usada.codigo})`;
}

function textoEmAndamento(item: ItemRelatorioCompras): string {
  const { chegadas, programacoes } = item.emAndamento;
  const linhas = [
    ...chegadas.map((c) => `Chegada ${mesAbrev(c.anoMes)}: ${inteiroBr(c.quantidade)}`),
    ...programacoes.map((p) => `Programação ${mesAbrev(p.anoMes)}: ${inteiroBr(p.quantidade)}`),
  ];
  return linhas.length > 0 ? linhas.join('\n') : TRACO;
}

// 15 valores, na ordem de COLUNAS_RELATORIO_XLSX.
export function celulasDoItem(item: ItemRelatorioCompras): Array<string | number> {
  const { usada, cadastradas, multiplas } = item.embalagem;
  const { ruptura } = item;
  const outras =
    multiplas && usada
      ? cadastradas
          .filter((e) => e.codigo !== usada.codigo)
          .map((e) => `${e.codigo} (${kgBr(e.quantidade)} kg)`)
          .join(', ')
      : '';
  const rupturaTexto = ruptura
    ? ruptura.jaNaDataBase
      ? 'já na data-base'
      : dataBr(ruptura.data)
    : 'sem ruptura em 6 meses';
  return [
    item.item,
    item.codigos.join(' · '),
    item.naoFraciona ? 'Não fraciona' : '',
    STATUS_ROTULO_XLSX[item.status] ?? item.status,
    item.demanda,
    item.quantidadeSugerida,
    textoEmbalagem(item),
    multiplas && usada ? `Arredondado pela embalagem do código ${usada.codigo}` : '',
    outras,
    item.quantidadeFinal,
    ruptura ? mesAbrev(ruptura.anoMes) : TRACO,
    rupturaTexto,
    item.dataLimite ? dataBr(item.dataLimite) : TRACO,
    item.vencida ? 'Vencida' : '',
    textoEmAndamento(item),
  ];
}

export function nomeArquivoRelatorioCompras(q: { label: string; hoje: string }): string {
  const limpo = (v: string) => v.replace(/[^0-9A-Za-z-]/g, '-');
  return `relatorio-compras-${limpo(q.label)}-${limpo(q.hoje)}.xlsx`;
}

// Texto da aba Regras: os 3 paragrafos do <details> da tela + nota de origem do arquivo.
const PARAGRAFOS_REGRAS = [
  'O saldo zera no primeiro mês em que a projeção do estoque fica negativa. O dia da ruptura é uma estimativa: o consumo do mês é distribuído de forma linear (no mês base, a partir da data-base).',
  'Data-limite do pedido = ruptura − lead time da fonte, em dias corridos e sem folga. Vencida: a data-limite já passou na data de hoje.',
  'Quantidade sugerida = demanda em módulo. Com embalagem cadastrada, arredonda para cima em múltiplos da embalagem (a principal; sem principal, a do primeiro código).',
  'Arquivo gerado do mesmo relatório exibido na tela (quinzena calculada).',
];

const COR_CABECALHO = 'FFE5E7EB';
const COR_FAIXA = 'FFDBEAFE';
const COR_VENCIDA_FUNDO = 'FFFEE2E2';
const COR_VENCIDA_TEXTO = 'FFB91C1C';
const COR_CINZA = 'FF6B7280';

function preencher(cor: string): exceljs.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: cor } };
}

function adicionarGrupo(ws: exceljs.Worksheet, g: GrupoRelatorioCompras): void {
  const total = COLUNAS_RELATORIO_XLSX.length;

  const faixa = ws.addRow([tituloDoGrupo(g)]);
  ws.mergeCells(faixa.number, 1, faixa.number, total);
  faixa.getCell(1).font = { bold: true };
  faixa.getCell(1).fill = preencher(COR_FAIXA);

  const cabecalho = ws.addRow([...COLUNAS_RELATORIO_XLSX]);
  cabecalho.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = preencher(COR_CABECALHO);
    cell.alignment = { vertical: 'middle', wrapText: true };
  });

  for (const item of g.itens) {
    const row = ws.addRow(celulasDoItem(item));
    row.alignment = { vertical: 'top' };
    for (const col of COLUNAS_TEXTO_QUEBRA) {
      row.getCell(col).alignment = { vertical: 'top', wrapText: true };
    }
    for (const col of COLUNAS_NUMERICAS) {
      row.getCell(col).numFmt = '0.0';
    }
    row.getCell(COL_QTD_FINAL).font = { bold: true };
    if (item.naoFraciona) {
      row.getCell(COL_NAO_FRACIONA).font = { bold: true };
    }
    row.getCell(COL_EMBALAGEM).font = item.embalagem.usada
      ? { bold: true }
      : { italic: true, color: { argb: COR_CINZA } };
    if (item.vencida) {
      for (let col = 1; col <= total; col += 1) {
        row.getCell(col).fill = preencher(COR_VENCIDA_FUNDO);
      }
      row.getCell(COL_VENCIDA).font = { bold: true, color: { argb: COR_VENCIDA_TEXTO } };
    }
  }

  ws.addRow([]);
}

export async function gerarXlsxRelatorioCompras(r: RelatorioCompras): Promise<Buffer> {
  const workbook = new exceljs.Workbook();
  const ws = workbook.addWorksheet(ABA_RELATORIO);
  ws.columns = LARGURAS.map((width) => ({ width }));
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  linhasDoResumo(r).forEach((texto, i) => {
    const row = ws.addRow([texto]);
    if (i === 0) {
      row.getCell(COL_ITEM).font = { bold: true, size: 14 };
    }
  });
  ws.addRow([]);

  if (r.grupos.length === 0) {
    ws.addRow(['Nenhum item com demanda ≤ 0 nesta quinzena.']);
  } else {
    for (const g of r.grupos) {
      adicionarGrupo(ws, g);
    }
  }

  const regras = workbook.addWorksheet(ABA_REGRAS);
  regras.columns = [{ width: 120 }];
  PARAGRAFOS_REGRAS.forEach((texto) => {
    const row = regras.addRow([texto]);
    row.getCell(1).alignment = { vertical: 'top', wrapText: true };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
