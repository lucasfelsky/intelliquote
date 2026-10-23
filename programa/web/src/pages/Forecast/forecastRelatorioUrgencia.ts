// Funcoes puras da urgencia e da secao "Atencao: sem consumo" do relatorio de compras (PR 2D).
// SO `import type`: o teste de backend (tests/forecast-relatorio-compras-xlsx.test.ts) importa este arquivo
// para provar que os textos da tela e do XLSX sao iguais. Os textos abaixo sao copia exata de
// src/utils/forecastRelatorioComprasXlsx.ts.
import type {
  ForecastGrupoRelatorio,
  ForecastItemRelatorio,
  ForecastRelatorioCompras,
  ForecastUrgencia,
} from '@/services/forecast';

/** Prioridade das faixas (a primeira e a mais urgente). */
export const URGENCIAS: readonly ForecastUrgencia[] = ['sem-estoque', 'critico', 'atrasado', 'no-prazo'];

export type FiltroUrgencia = ForecastUrgencia | 'todas';
export type VisaoRelatorio = 'urgencia' | 'fonte';

export function rotuloUrgencia(u: ForecastUrgencia, diasCritico: number): string {
  switch (u) {
    case 'sem-estoque':
      return 'Sem estoque agora';
    case 'critico':
      return `Ruptura em até ${diasCritico} dias`;
    case 'atrasado':
      return 'Atrasado';
    default:
      return 'No prazo';
  }
}

export function resumoDeUrgencia(porUrgencia: Record<ForecastUrgencia, number>, diasCritico: number): string {
  const a = porUrgencia['sem-estoque'];
  const b = porUrgencia.critico;
  const c = porUrgencia.atrasado;
  const d = porUrgencia['no-prazo'];
  const partes = [`${a} sem estoque agora`];
  if (diasCritico > 0) partes.push(`${b} com ruptura em até ${diasCritico} dias`);
  partes.push(`${c} ${c === 1 ? 'atrasado' : 'atrasados'}`, `${d} no prazo`);
  return `Urgência: ${partes.join(' · ')}`;
}

export function paragrafoUrgencia(diasCritico: number): string {
  const critica =
    diasCritico > 0
      ? `"Ruptura em até ${diasCritico} dias" = ainda há estoque e a ruptura estimada cai nos próximos ${diasCritico} dias; `
      : '';
  return `Urgência: "Sem estoque agora" = a ruptura cai na data-base ou já passou na data de hoje; ${critica}"Atrasado" = a data-limite do pedido já passou; "No prazo" = o restante, inclusive sem ruptura em 6 meses. A lista segue essa ordem e, dentro de cada faixa, os dias até a ruptura e depois a data-limite.`;
}

export function textoMotivos(motivos: Array<'programacao' | 'estoque'>): string {
  return motivos.map((m) => (m === 'programacao' ? 'tem programação' : 'tem estoque')).join(' · ');
}

export function resumoSemConsumo(emAtencao: number, semMovimento: number): string {
  return `Sem consumo: ${emAtencao} em atenção (com estoque ou programação, fora da lista de compra) · ${semMovimento} sem estoque nem programação`;
}

export function paragrafoSemConsumo(): string {
  return 'Atenção: sem consumo = média trimestral zero, fora da lista de compra, mas com estoque ou programação. Aparece só para conferência, sem quantidade sugerida. Itens sem consumo, estoque nem programação ficam fora e só entram na contagem.';
}

export function tituloSemConsumo(n: number): string {
  return `Atenção: sem consumo · ${n} ${n === 1 ? 'item' : 'itens'}`;
}

export const APOIO_SEM_CONSUMO =
  'Não entram na lista de compra: sem consumo nos últimos 3 meses, mas com estoque ou programação.';

/** Texto sob o selo da linha: `—` sem ruptura; negativo = ruptura estimada que ja passou. */
export function textoDiasAteRuptura(dias: number | null | undefined): string {
  if (dias === null || dias === undefined) return '—';
  if (dias === 0) return 'ruptura hoje';
  if (dias === 1) return 'ruptura em 1 dia';
  if (dias > 1) return `ruptura em ${dias} dias`;
  if (dias === -1) return 'ruptura há 1 dia';
  return `ruptura há ${-dias} dias`;
}

/** Backend antigo nao manda as faixas: a tela cai no modo legado (por fonte, sem controles). */
export function temUrgencia(r: ForecastRelatorioCompras): boolean {
  return r.urgencia !== undefined && r.totais.porUrgencia !== undefined;
}

export function temSemConsumo(r: ForecastRelatorioCompras): boolean {
  return r.semConsumo !== undefined && r.fora.semConsumoSemMovimento !== undefined;
}

export interface ItemComFonte {
  item: ForecastItemRelatorio;
  fonte: string;
}

/** Itens achatados na ordem global de urgencia (`posicaoUrgencia`), ja filtrados pela faixa. */
export function itensPorUrgencia(r: ForecastRelatorioCompras, filtro: FiltroUrgencia): ItemComFonte[] {
  return r.grupos
    .flatMap((g) => g.itens.map((item) => ({ item, fonte: g.fonte })))
    .filter(({ item }) => filtro === 'todas' || item.urgencia === filtro)
    .sort((a, b) => (a.item.posicaoUrgencia ?? 0) - (b.item.posicaoUrgencia ?? 0));
}

function contarPorUrgencia(itens: ForecastItemRelatorio[]): Record<ForecastUrgencia, number> {
  const contagem: Record<ForecastUrgencia, number> = { 'sem-estoque': 0, critico: 0, atrasado: 0, 'no-prazo': 0 };
  for (const i of itens) {
    if (i.urgencia) contagem[i.urgencia] += 1;
  }
  return contagem;
}

/** Grupos por fonte so com os itens da faixa; grupo que fica vazio some. As contagens do grupo acompanham o filtro. */
export function gruposFiltrados(r: ForecastRelatorioCompras, filtro: FiltroUrgencia): ForecastGrupoRelatorio[] {
  if (filtro === 'todas') return r.grupos;
  return r.grupos
    .map((g) => {
      const itens = g.itens.filter((i) => i.urgencia === filtro);
      return {
        ...g,
        itens,
        vencidas: itens.filter((i) => i.vencida).length,
        porUrgencia: contarPorUrgencia(itens),
        urgenciaMaisAlta: itens[0]?.urgencia ?? g.urgenciaMaisAlta,
        dataLimiteMaisUrgente: itens.reduce<string | null>(
          (menor, i) => (i.dataLimite !== null && (menor === null || i.dataLimite < menor) ? i.dataLimite : menor),
          null,
        ),
      };
    })
    .filter((g) => g.itens.length > 0);
}

export function textoMostrando(
  n: number,
  total: number,
  filtro: FiltroUrgencia,
  visao: VisaoRelatorio,
  diasCritico: number,
): string {
  const faixa = filtro === 'todas' ? 'todas as faixas' : rotuloUrgencia(filtro, diasCritico);
  return `Mostrando ${n} de ${total} ${total === 1 ? 'item' : 'itens'} · ${faixa} · ${visao === 'urgencia' ? 'por urgência' : 'por fonte'}`;
}

/** Faixas que ganham botao de filtro: com N = 0 a faixa "Ruptura em ate N dias" nao existe. */
export function filtrosVisiveis(diasCritico: number): ForecastUrgencia[] {
  return URGENCIAS.filter((u) => u !== 'critico' || diasCritico > 0);
}

/** Um unico selo de texto por linha: vermelho nas 2 faixas criticas, neutro nas outras. */
export function badgeDaUrgencia(u: ForecastUrgencia): string {
  return u === 'sem-estoque' || u === 'critico' ? 'badge badge--danger' : 'badge badge--muted';
}
