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

export const textoSeloOcasiao = (extraDias: number): string => `Evento estrangeiro: +${extraDias} d`;

export const ariaSeloOcasiao = (extraDias: number): string =>
  `Evento estrangeiro no lead time: ${extraDias} ${plural(extraDias, 'dia', 'dias')} a mais (estimativa, só informa)`;

/** [X] */
export const textoOcasiaoDaLista = (o: { nome: string; dias: number; etapa: ForecastEtapaOcasiao }): string =>
  `${o.nome} · +${o.dias} d (${ROTULO_ETAPA_OCASIAO[o.etapa]})`;

export const textoLeadTimeAjustado = (leadTime: number, extraDias: number): string =>
  `${leadTime} + ${extraDias} = ${leadTime + extraDias} dias`;

/** [X] */
export const AVISO_ANTES_DE_HOJE = 'O evento estrangeiro antecipa a data-limite para antes de hoje.';

/** [X] */
export const AVISO_COMPONENTES_AUSENTES =
  'Etapas da fonte não cadastradas (ou somam mais que o lead time): cada evento foi comparado com o lead time inteiro.';

/** [X] */
export const NOTA_OSCILOU = 'A estimativa não estabilizou: vale o maior acréscimo.';

export const APOIO_OCASIOES =
  'Eventos estrangeiros: dias a MAIS do que o lead time da fonte já considera. Estimativa; só informa (não muda data-limite, urgência nem quantidades). Cada evento vale só para os países ou fontes escolhidos; eventos de regiões diferentes não se somam entre si. O evento soma por cima do lead time cadastrado: informe só os dias a mais.';

/** [X] */
export const TEXTO_OCASIOES_INDISPONIVEIS = 'Eventos estrangeiros do lead time indisponíveis agora: o relatório saiu sem eles.';

/** [X] */
export function resumoOcasioes(itens: number): string {
  if (itens === 0) return 'Nenhum item cruza os eventos estrangeiros cadastrados';
  return itens === 1
    ? '1 item com evento estrangeiro no lead time (estimativa)'
    : `${itens} itens com evento estrangeiro no lead time (estimativa)`;
}

/** [X] */
export const resumoOcasioesAntesDeHoje = (n: number): string =>
  `${n} ${plural(n, 'item', 'itens')} com a data-limite ajustada já vencida`;

/** [X] */
export const resumoSemFonteCadastrada = (n: number): string =>
  `${n} ${plural(n, 'item', 'itens')} com fonte fora do cadastro de lead time: eventos não avaliados`;

/** [X] */
export const resumoFontesSemPais = (n: number): string =>
  `${n} ${plural(n, 'fonte', 'fontes')} sem país: eventos por país não as alcançam`;

/** [X] Ultimo paragrafo do <details> do relatorio e da aba Regras do XLSX. */
export const PARAGRAFO_OCASIOES =
  'Eventos estrangeiros (feriados, greves, fechamentos) registram dias a MAIS do que o lead time da fonte já considera. O lead time ajustado e a data-limite ajustada são estimativas e só informam: a data-limite, a urgência, a ordem e as quantidades continuam as do lead time da fonte. Os eventos vêm do cadastro atual (não ficam congelados na quinzena). A linha do tempo do pedido segue prontidão, embarque, trânsito e liberação; a folga da fonte fica no fim e não cruza eventos. Cada evento vale só para os países ou fontes escolhidos; eventos de regiões diferentes não se somam entre si. O evento soma por cima do lead time cadastrado: informe só os dias a mais.';

/** Cabecalho do grupo (fonte): nomes das ocasioes e quantos itens cruzam. */
export const textoOcasioesDoGrupo = (g: { ocasioes: Array<{ nome: string }>; itensAfetados: number }): string =>
  `${plural(g.ocasioes.length, 'Evento estrangeiro', 'Eventos estrangeiros')}: ${g.ocasioes.map((o) => o.nome).join(', ')} · ${g.itensAfetados} ${plural(g.itensAfetados, 'item', 'itens')}`;

/** Memoria de calculo: a PO que sai hoje com as ocasioes. */
export const textoMemoriaOcasioes = (o: {
  chegadaEstimada: string;
  extraDias: number;
  ocasioes: Array<{ nome: string }>;
}): string =>
  `${plural(o.ocasioes.length, 'Com evento estrangeiro', 'Com eventos estrangeiros')}: chega em ${dataBr(o.chegadaEstimada)} (+${o.extraDias} ${plural(o.extraDias, 'dia', 'dias')}: ${o.ocasioes
    .map((x) => x.nome)
    .join(', ')})`;
