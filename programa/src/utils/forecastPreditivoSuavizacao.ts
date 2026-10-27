// Forecast preditivo (fase 0): SES, Holt aditivo e Holt amortecido. Parametros em grade fixa (sem otimizador); escolha pelo
// menor SSE de 1 passo in-sample, empate fica com o primeiro da grade (alfa asc, beta asc, phi asc).
import { escolherMenorSse, montarResultado, validarAntes } from './forecastPreditivoBaselines';
import { PREDITIVO_CONFIG as C } from './forecastPreditivoTipos';
import type { Metodo, MetodoId, SerieNormalizada } from './forecastPreditivoTipos';

// Nivel inicial = 1o valor valido; mes mascarado nao atualiza o nivel. SSE a partir do 2o valido.
export function sesNivel(valores: number[], mascara: boolean[], alfa: number): { nivel: number; sse: number } {
  let nivel = 0;
  let sse = 0;
  let iniciado = false;
  for (let t = 0; t < valores.length; t++) {
    if (mascara[t]) continue;
    if (!iniciado) {
      nivel = valores[t];
      iniciado = true;
      continue;
    }
    const erro = valores[t] - nivel;
    sse += erro * erro;
    nivel = alfa * valores[t] + (1 - alfa) * nivel;
  }
  return { nivel, sse };
}

export interface ParametrosHolt {
  alfa: number;
  beta: number;
  phi: number;
}

// Estado inicial com os dois primeiros validos (indices i < j): nivel = y_i, tendencia = (y_j - y_i) / (j - i).
// A partir de i + 1: mascarado so avanca (nivel += phi * tendencia; tendencia *= phi); valido atualiza.
// SSE: erros de 1 passo a partir do 3o valido.
export function holtEstado(
  valores: number[],
  mascara: boolean[],
  { alfa, beta, phi }: ParametrosHolt,
): { nivel: number; tendencia: number; sse: number } {
  const validos: number[] = [];
  for (let t = 0; t < valores.length && validos.length < 2; t++) if (!mascara[t]) validos.push(t);
  if (validos.length < 2) return { nivel: validos.length === 1 ? valores[validos[0]] : 0, tendencia: 0, sse: 0 };
  const [i, j] = validos;
  let nivel = valores[i];
  let tendencia = (valores[j] - valores[i]) / (j - i);
  let sse = 0;
  for (let t = i + 1; t < valores.length; t++) {
    if (mascara[t]) {
      nivel += phi * tendencia;
      tendencia *= phi;
      continue;
    }
    const anterior = nivel;
    const previsto = anterior + phi * tendencia;
    if (t > j) sse += (valores[t] - previsto) * (valores[t] - previsto);
    nivel = alfa * valores[t] + (1 - alfa) * previsto;
    tendencia = beta * (nivel - anterior) + (1 - beta) * phi * tendencia;
  }
  return { nivel, tendencia, sse };
}

// nivel + (phi + phi^2 + ... + phi^h) * tendencia
export function holtPrevisao(nivel: number, tendencia: number, phi: number, h: number): number {
  let soma = 0;
  let potencia = 1;
  for (let k = 1; k <= h; k++) {
    potencia *= phi;
    soma += potencia;
  }
  return nivel + soma * tendencia;
}

const ses: Metodo = (s, o) => {
  const invalido = validarAntes(s, o, 'ses', C.minimoValidos.ses);
  if (invalido) return invalido;
  const candidatos = C.gradeSes.alfa.map((alfa) => ({ alfa, ...sesNivel(s.valores, s.mascara, alfa) }));
  const melhor = escolherMenorSse(candidatos);
  return montarResultado(s, 'ses', new Array<number>(o.horizonte).fill(melhor.nivel), [], { alfa: melhor.alfa });
};

function holtGrade(id: 'holt' | 'holt-amortecido'): Metodo {
  return (s: SerieNormalizada, o) => {
    const invalido = validarAntes(s, o, id, C.minimoValidos[id]);
    if (invalido) return invalido;
    const phis = id === 'holt' ? [1] : C.gradeHoltAmortecido.phi;
    const grade = id === 'holt' ? C.gradeHolt : C.gradeHoltAmortecido;
    const candidatos: (ParametrosHolt & { nivel: number; tendencia: number; sse: number })[] = [];
    for (const alfa of grade.alfa) {
      for (const beta of grade.beta) {
        for (const phi of phis) candidatos.push({ alfa, beta, phi, ...holtEstado(s.valores, s.mascara, { alfa, beta, phi }) });
      }
    }
    const m = escolherMenorSse(candidatos);
    const p50s: number[] = [];
    for (let h = 1; h <= o.horizonte; h++) p50s.push(holtPrevisao(m.nivel, m.tendencia, m.phi, h));
    const parametros: Record<string, number> = id === 'holt' ? { alfa: m.alfa, beta: m.beta } : { alfa: m.alfa, beta: m.beta, phi: m.phi };
    return montarResultado(s, id, p50s, [], parametros);
  };
}

export const METODOS_SUAVIZACAO: Readonly<Record<Extract<MetodoId, 'ses' | 'holt' | 'holt-amortecido'>, Metodo>> = {
  ses,
  holt: holtGrade('holt'),
  'holt-amortecido': holtGrade('holt-amortecido'),
};
