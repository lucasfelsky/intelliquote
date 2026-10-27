// Ocasioes no lead time no XLSX do relatorio de compras (PR 3 das ocasioes). So FORMATA o bloco que o relatorio ja traz
// (forecastRelatorioComprasOcasioes.ts): nao recalcula nada e so informa. As 3 colunas entram DEPOIS de "Observacao" e SO
// quando ha ocasiao ativa (`r.ocasioes.estado === 'ok'`): sem ocasiao nenhuma coluna, linha ou aba nova, e com ocasiao
// nenhuma coluna antiga muda de posicao. Os textos marcados [X] sao copia exata de
// web/src/pages/Forecast/forecastOcasioesRelatorio.ts (guarda de paridade em
// tests/forecast-relatorio-compras-ocasioes-xlsx.test.ts).
import type exceljs from 'exceljs';
import { dataBr } from './forecastRelatorioComprasXlsx';
import type { ItemRelatorioCompras, RelatorioCompras } from './forecastRelatorioCompras';

export const COLUNAS_OCASIOES_XLSX = ['Lead time ajustado (dias)', 'Data-limite ajustada', 'Ocasiões'] as const;
export const LARGURAS_OCASIOES_XLSX = [14, 16, 44];

// [X]
export const ROTULO_ETAPA_OCASIAO_XLSX = {
  total: 'Lead time inteiro',
  prontidao: 'Prontidão',
  embarque: 'Embarque',
  transito: 'Trânsito',
  liberacao: 'Liberação',
} as const;

const plural = (n: number, singular: string, pluralForm: string) => (n === 1 ? singular : pluralForm);

// [X]
export const textoOcasiaoDaLista = (o: { nome: string; dias: number; etapa: keyof typeof ROTULO_ETAPA_OCASIAO_XLSX }) =>
  `${o.nome} · +${o.dias} d (${ROTULO_ETAPA_OCASIAO_XLSX[o.etapa]})`;

// [X]
export const AVISO_ANTES_DE_HOJE_XLSX = 'A ocasião antecipa a data-limite para antes de hoje.';
// [X]
export const AVISO_COMPONENTES_AUSENTES_XLSX =
  'Etapas da fonte não cadastradas (ou somam mais que o lead time): cada ocasião foi comparada com o lead time inteiro.';
// [X]
export const NOTA_OSCILOU_XLSX = 'A estimativa não estabilizou: vale o maior acréscimo.';
// [X]
export const TEXTO_OCASIOES_INDISPONIVEIS_XLSX = 'Ocasiões do lead time indisponíveis agora: o relatório saiu sem elas.';

// [X]
export function resumoOcasioes(itens: number): string {
  if (itens === 0) return 'Nenhum item cruza as ocasiões cadastradas';
  return itens === 1
    ? '1 item com ocasião no lead time (estimativa)'
    : `${itens} itens com ocasião no lead time (estimativa)`;
}
// [X]
export const resumoOcasioesAntesDeHoje = (n: number): string =>
  `${n} ${plural(n, 'item', 'itens')} com a data-limite ajustada já vencida`;
// [X]
export const resumoSemFonteCadastrada = (n: number): string =>
  `${n} ${plural(n, 'item', 'itens')} com fonte fora do cadastro de lead time: ocasiões não avaliadas`;
// [X]
export const resumoFontesSemPais = (n: number): string =>
  `${n} ${plural(n, 'fonte', 'fontes')} sem país: ocasiões por país não as alcançam`;

// [X]
export const PARAGRAFO_OCASIOES_XLSX =
  'Ocasiões (feriados, greves, fechamentos) registram dias a MAIS do que o lead time da fonte já considera. O lead time ajustado e a data-limite ajustada são estimativas e só informam: a data-limite, a urgência, a ordem e as quantidades continuam as do lead time da fonte. As ocasiões vêm do cadastro atual (não ficam congeladas na quinzena). A linha do tempo do pedido segue prontidão, embarque, trânsito e liberação; a folga da fonte fica no fim e não cruza ocasiões.';

// Mesmo valor de COR_VENCIDA_TEXTO (forecastRelatorioComprasXlsx.ts): a ajustada ja venceu e a normal nao.
const COR_ANTES_DE_HOJE_TEXTO = 'FFB91C1C';

export const comColunasDeOcasioes = (r: RelatorioCompras): boolean => r.ocasioes?.estado === 'ok';

// 3 valores, na ordem de COLUNAS_OCASIOES_XLSX; item sem bloco = 3 celulas vazias.
export function celulasDeOcasioes(item: ItemRelatorioCompras): Array<string | number> {
  const o = item.ocasioes;
  if (!o) {
    return ['', '', ''];
  }
  const linhas = [
    ...o.ocasioes.map(textoOcasiaoDaLista),
    ...(o.antesDeHoje ? [AVISO_ANTES_DE_HOJE_XLSX] : []),
    ...(o.componentesAusentes ? [AVISO_COMPONENTES_AUSENTES_XLSX] : []),
    ...(o.oscilou ? [NOTA_OSCILOU_XLSX] : []),
  ];
  return [o.leadTimeAjustado, dataBr(o.dataLimiteAjustada), linhas.join('\n')];
}

// `primeiraColuna` = coluna (1-based) do lead time ajustado; a aba por fonte e a por urgencia tem posicoes diferentes.
export function formatarCelulasDeOcasioes(row: exceljs.Row, item: ItemRelatorioCompras, primeiraColuna: number): void {
  if (!item.ocasioes) {
    return;
  }
  row.getCell(primeiraColuna).numFmt = '0';
  row.getCell(primeiraColuna + 2).alignment = { vertical: 'top', wrapText: true };
  if (item.ocasioes.antesDeHoje) {
    row.getCell(primeiraColuna + 1).font = { bold: true, color: { argb: COR_ANTES_DE_HOJE_TEXTO } };
  }
}

// Linhas do resumo (aba do relatorio): [] sem bloco; com a leitura indisponivel, so o aviso.
export function linhasDoResumoDeOcasioes(r: RelatorioCompras): string[] {
  const o = r.ocasioes;
  if (!o) {
    return [];
  }
  if (o.estado === 'indisponivel') {
    return [TEXTO_OCASIOES_INDISPONIVEIS_XLSX];
  }
  return [
    resumoOcasioes(o.itensAfetados),
    ...(o.antesDeHoje > 0 ? [resumoOcasioesAntesDeHoje(o.antesDeHoje)] : []),
    ...(o.itensSemFonteCadastrada > 0 ? [resumoSemFonteCadastrada(o.itensSemFonteCadastrada)] : []),
    ...(o.fontesSemPais > 0 ? [resumoFontesSemPais(o.fontesSemPais)] : []),
  ];
}

// Paragrafo das Regras (so com ocasiao ativa): entra antes do ultimo ("Arquivo gerado do mesmo relatorio ...").
export function comParagrafoDeOcasioes(paragrafos: string[], r: RelatorioCompras): string[] {
  if (!comColunasDeOcasioes(r)) {
    return paragrafos;
  }
  return [...paragrafos.slice(0, -1), PARAGRAFO_OCASIOES_XLSX, ...paragrafos.slice(-1)];
}
