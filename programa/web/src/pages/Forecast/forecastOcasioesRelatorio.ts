// Textos puros das ocasioes no lead time do relatorio de compras e da memoria de calculo (PR 3 das ocasioes). So informa:
// tudo e estimativa e nada aqui muda data-limite, urgencia, ordem nem quantidades.
// Copia exata em src/utils/forecastRelatorioComprasOcasioesXlsx.ts onde marcado [X]; a igualdade tela x XLSX e provada em
// tests/forecast-relatorio-compras-ocasioes-xlsx.test.ts. Os rotulos de etapa repetem os do cadastro de ocasioes (PR 2);
// unificar depois dos dois merges.
import type { ForecastEtapaOcasiao } from '@/services/forecast';
import { dataBr } from './forecastPainel';

/** [X] */
export const ROTULO_ETAPA_OCASIAO: Record<ForecastEtapaOcasiao, string> = {
  total: 'Lead time inteiro',
  prontidao: 'Prontidão',
  embarque: 'Embarque',
  transito: 'Trânsito',
  liberacao: 'Liberação',
};

export const ROTULO_ESTIMATIVA = 'estimativa';

const plural = (n: number, singular: string, pluralForm: string) => (n === 1 ? singular : pluralForm);

export const textoSeloOcasiao = (extraDias: number): string => `Ocasião: +${extraDias} d`;

export const ariaSeloOcasiao = (extraDias: number): string =>
  `Ocasião no lead time: ${extraDias} ${plural(extraDias, 'dia', 'dias')} a mais (estimativa, só informa)`;

/** [X] */
export const textoOcasiaoDaLista = (o: { nome: string; dias: number; etapa: ForecastEtapaOcasiao }): string =>
  `${o.nome} · +${o.dias} d (${ROTULO_ETAPA_OCASIAO[o.etapa]})`;

export const textoLeadTimeAjustado = (leadTime: number, extraDias: number): string =>
  `${leadTime} + ${extraDias} = ${leadTime + extraDias} dias`;

/** [X] */
export const AVISO_ANTES_DE_HOJE = 'A ocasião antecipa a data-limite para antes de hoje.';

/** [X] */
export const AVISO_COMPONENTES_AUSENTES =
  'Etapas da fonte não cadastradas (ou somam mais que o lead time): cada ocasião foi comparada com o lead time inteiro.';

/** [X] */
export const NOTA_OSCILOU = 'A estimativa não estabilizou: vale o maior acréscimo.';

export const APOIO_OCASIOES =
  'Ocasiões: dias a MAIS do que o lead time da fonte já considera. Estimativa; só informa (não muda data-limite, urgência nem quantidades).';

/** [X] */
export const TEXTO_OCASIOES_INDISPONIVEIS = 'Ocasiões do lead time indisponíveis agora: o relatório saiu sem elas.';

/** [X] */
export function resumoOcasioes(itens: number): string {
  if (itens === 0) return 'Nenhum item cruza as ocasiões cadastradas';
  return itens === 1
    ? '1 item com ocasião no lead time (estimativa)'
    : `${itens} itens com ocasião no lead time (estimativa)`;
}

/** [X] */
export const resumoOcasioesAntesDeHoje = (n: number): string =>
  `${n} ${plural(n, 'item', 'itens')} com a data-limite ajustada já vencida`;

/** [X] */
export const resumoSemFonteCadastrada = (n: number): string =>
  `${n} ${plural(n, 'item', 'itens')} com fonte fora do cadastro de lead time: ocasiões não avaliadas`;

/** [X] */
export const resumoFontesSemPais = (n: number): string =>
  `${n} ${plural(n, 'fonte', 'fontes')} sem país: ocasiões por país não as alcançam`;

/** [X] Ultimo paragrafo do <details> do relatorio e da aba Regras do XLSX. */
export const PARAGRAFO_OCASIOES =
  'Ocasiões (feriados, greves, fechamentos) registram dias a MAIS do que o lead time da fonte já considera. O lead time ajustado e a data-limite ajustada são estimativas e só informam: a data-limite, a urgência, a ordem e as quantidades continuam as do lead time da fonte. As ocasiões vêm do cadastro atual (não ficam congeladas na quinzena). A linha do tempo do pedido segue prontidão, embarque, trânsito e liberação; a folga da fonte fica no fim e não cruza ocasiões.';

/** Cabecalho do grupo (fonte): nomes das ocasioes e quantos itens cruzam. */
export const textoOcasioesDoGrupo = (g: { ocasioes: Array<{ nome: string }>; itensAfetados: number }): string =>
  `Ocasiões: ${g.ocasioes.map((o) => o.nome).join(', ')} · ${g.itensAfetados} ${plural(g.itensAfetados, 'item', 'itens')}`;

/** Memoria de calculo: a PO que sai hoje com as ocasioes. */
export const textoMemoriaOcasioes = (o: {
  chegadaEstimada: string;
  extraDias: number;
  ocasioes: Array<{ nome: string }>;
}): string =>
  `Com ocasiões: chega em ${dataBr(o.chegadaEstimada)} (+${o.extraDias} ${plural(o.extraDias, 'dia', 'dias')}: ${o.ocasioes
    .map((x) => x.nome)
    .join(', ')})`;
