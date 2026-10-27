// Forecast preditivo (P1a): combinacao SES + planilha R + Holt amortecido (media simples) e o metodo composto
// 'preditivo-p1', que escolhe o metodo por regra de protecao. A regra olha SO a serie recebida (no backtest, a serie
// cortada na origem): nunca ler s.avisos, o aviso 'degrau-nivel' da serie inteira usa o futuro.
import { mediaValidos, validarAntes, montarResultado } from './forecastPreditivoBaselines';
import { PREDITIVO_CONFIG_P1, REGRA_IDS } from './forecastPreditivoConfigP1';
import type { ConfigProtecao, MetodoAlvo, RegraProtecao } from './forecastPreditivoConfigP1';
import { METODOS } from './forecastPreditivoMetodos';
import { temDegrau } from './forecastPreditivoSerie';
import type { AvisoId, Metodo, MetodoP1Id, MetodoTodosId, SerieNormalizada } from './forecastPreditivoTipos';

const COMBINACAO: MetodoP1Id = 'combinacao-ses-r-holt';

export const combinacaoSesRHolt: Metodo = (s, o) => {
  const cfg = PREDITIVO_CONFIG_P1.combinacao;
  const invalido = validarAntes(s, o, COMBINACAO, cfg.minimoValidos);
  if (invalido) return invalido;
  const validos = s.mascara.filter((m) => !m).length;
  const componentes = cfg.componentes.filter((c) => c !== 'holt-amortecido' || validos >= cfg.minimoValidosHolt);
  const p50s = new Array<number>(o.horizonte).fill(0);
  const avisos: AvisoId[] = [];
  const parametros: Record<string, number> = { componentes: componentes.length };
  for (const c of componentes) {
    const r = METODOS[c](s, o);
    if (!r.ok) return { ok: false, metodo: COMBINACAO, motivo: 'historico-curto' };
    r.pontos.forEach((p, i) => {
      p50s[i] += p.p50;
    });
    avisos.push(...r.avisos);
    if (c === 'ses') parametros['ses.alfa'] = r.parametros.alfa;
    if (c === 'holt-amortecido') {
      parametros['holt.alfa'] = r.parametros.alfa;
      parametros['holt.beta'] = r.parametros.beta;
      parametros['holt.phi'] = r.parametros.phi;
    }
  }
  return montarResultado(s, COMBINACAO, p50s.map((v) => v / componentes.length), [...new Set(avisos)], parametros);
};

// Media dos ultimos `janela` meses de calendario igual a zero (inclui serie toda zero).
export function ehDormente(s: SerieNormalizada, janela = 6): boolean {
  return mediaValidos(s.valores, s.mascara, janela).media === 0;
}

// Ordem fixa: sem dados -> curto | dormente | poucos meses validos -> curto | degrau | padrao.
export function regraProtecao(s: SerieNormalizada, cfg: ConfigProtecao = PREDITIVO_CONFIG_P1.protecao): RegraProtecao {
  if (s.valores.length === 0) return 'curto';
  if (ehDormente(s, cfg.janelaDormente)) return 'dormente';
  if (s.mascara.filter((m) => !m).length < cfg.minimoValidos) return 'curto';
  if (temDegrau(s.valores, s.mascara)) return 'degrau';
  return 'padrao';
}

// Registro local SEM o composto (a regra nunca chama 'preditivo-p1').
const SEM_COMPOSTO: Readonly<Record<MetodoAlvo, Metodo>> = { ...METODOS, 'combinacao-ses-r-holt': combinacaoSesRHolt };

export function criarPreditivoP1(cfg: ConfigProtecao = PREDITIVO_CONFIG_P1.protecao): Metodo {
  return (s, o) => {
    const invalido = validarAntes(s, o, 'preditivo-p1', 1);
    if (invalido) return invalido;
    const regra = regraProtecao(s, cfg);
    const alvo = { padrao: cfg.metodoPadrao, dormente: cfg.metodoDormente, curto: cfg.metodoCurto, degrau: cfg.metodoDegrau }[regra];
    let r = SEM_COMPOSTO[alvo](s, o);
    if (!r.ok) r = METODOS['planilha-q'](s, o); // alvo sem previsao: planilha Q
    if (!r.ok) return { ok: false, metodo: 'preditivo-p1', motivo: r.motivo };
    return { ...r, metodo: 'preditivo-p1', parametros: { regra: REGRA_IDS.indexOf(regra), ...r.parametros } };
  };
}

export const METODOS_P1: Readonly<Record<MetodoP1Id, Metodo>> = {
  'combinacao-ses-r-holt': combinacaoSesRHolt,
  'preditivo-p1': criarPreditivoP1(),
};

export const METODOS_TODOS: Readonly<Record<MetodoTodosId, Metodo>> = { ...METODOS, ...METODOS_P1 };

