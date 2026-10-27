import { ApiError } from '@/api/client';
import {
  forecastOcasioesErrorMessage,
  type ForecastOcasiao,
  type ForecastOcasiaoNova,
} from '@/services/forecastOcasioes';
import { ROTULO_SITUACAO, montarCorpoNovo, situacaoDaOcasiao, type ValoresOcasiao } from './forecastOcasioes';
import type { PreenchimentoModelo } from './forecastOcasioesModelos';

// Logica pura dos eventos estrangeiros com varios alvos (paises e/ou fontes): selecao, validacao, um POST por alvo
// em sequencia, resumos e agrupamento da lista. Sem React, sem relogio (a data de hoje entra por argumento).

export const ALVOS_MAX = 30;

export interface SelecaoAlvos {
  modo: 'todas' | 'escolhidos';
  paises: string[];
  fontes: number[];
}
export type AlvoEvento =
  | { tipo: 'global' }
  | { tipo: 'pais'; codigo: string }
  | { tipo: 'fonte'; id: number; nome: string };
export interface FonteAtiva {
  id: number;
  nome: string;
  countryCode: string | null;
}
export interface ItemAlvo {
  alvo: AlvoEvento;
  rotulo: string;
  corpo: ForecastOcasiaoNova;
}
export type StatusAlvo = 'criado' | 'duplicado' | 'erro' | 'nao-enviado';
export interface ResultadoAlvo {
  alvo: AlvoEvento;
  rotulo: string;
  status: StatusAlvo;
  mensagem: string | null;
}
type NomeDoPais = (codigo: string) => string;

export const TEXTO_REGIONAL =
  'Cada evento vale só para os países e fontes escolhidos nele: uma fonte recebe apenas os eventos do próprio país, os que a escolhem pelo nome e os de Todas as fontes. Eventos de regiões diferentes não se somam entre si (um feriado da Alemanha não vale para uma fonte da China, e vice-versa).';
export const TEXTO_SOMA_POR_CIMA =
  'Dias a MAIS, somados por cima do lead time cadastrado da fonte: a folga FERIADOS e o prazo real médio já estão nele e não são descontados. Informe só o excedente. Inteiro de 0 a 120. Por enquanto só informa.';

const porNome = (a: string, b: string): number => a.localeCompare(b, 'pt-BR');

// ---------- selecao e validacao ----------

export function selecaoDoModelo(p?: PreenchimentoModelo): SelecaoAlvos {
  if (!p || p.escopo === 'global') return { modo: 'todas', paises: [], fontes: [] };
  if (p.escopo === 'pais') return { modo: 'escolhidos', paises: p.pais ? [p.pais] : [], fontes: [] };
  return { modo: 'escolhidos', paises: [], fontes: [] };
}

export function rotuloDoAlvo(a: AlvoEvento, nomeDoPais: NomeDoPais): string {
  if (a.tipo === 'global') return 'Todas as fontes';
  return a.tipo === 'pais' ? nomeDoPais(a.codigo) : a.nome;
}

export function validarAlvos(
  s: SelecaoAlvos,
  fontes: ReadonlyMap<number, FonteAtiva>,
  nomeDoPais: NomeDoPais,
): { erros: { escopo?: string; fonte?: string }; alvos: AlvoEvento[] | null } {
  if (s.modo === 'todas') return { erros: {}, alvos: [{ tipo: 'global' }] };
  const paises = [...new Set(s.paises)];
  const ids = [...new Set(s.fontes)];
  const erros: { escopo?: string; fonte?: string } = {};
  const total = paises.length + ids.length;
  if (total === 0) erros.escopo = 'Marque ao menos um país ou uma fonte.';
  else if (total > ALVOS_MAX) erros.escopo = `Marque no máximo ${ALVOS_MAX} países e fontes por vez.`;
  for (const id of ids) {
    const fonte = fontes.get(id);
    if (!fonte) {
      erros.fonte = 'Fonte não encontrada ou inativa.';
      break;
    }
    if (fonte.countryCode && paises.includes(fonte.countryCode)) {
      erros.fonte = `${fonte.nome} já recebe este evento pelo país ${nomeDoPais(fonte.countryCode)}: desmarque a fonte ou o país.`;
      break;
    }
  }
  if (erros.escopo || erros.fonte) return { erros, alvos: null };
  const alvosPais: AlvoEvento[] = [...paises]
    .sort((a, b) => porNome(nomeDoPais(a), nomeDoPais(b)))
    .map((codigo) => ({ tipo: 'pais', codigo }));
  const alvosFonte: AlvoEvento[] = ids
    .map((id) => fontes.get(id) as FonteAtiva)
    .sort((a, b) => porNome(a.nome, b.nome) || a.id - b.id)
    .map((f) => ({ tipo: 'fonte', id: f.id, nome: f.nome }));
  return { erros, alvos: [...alvosPais, ...alvosFonte] };
}

export function corposPorAlvo(v: ValoresOcasiao, alvos: AlvoEvento[], nomeDoPais: NomeDoPais): ItemAlvo[] {
  return alvos.map((alvo) => {
    const escopo =
      alvo.tipo === 'global'
        ? { escopo: 'global' as const, pais: null, fonteId: null }
        : alvo.tipo === 'pais'
          ? { escopo: 'pais' as const, pais: alvo.codigo, fonteId: null }
          : { escopo: 'fonte' as const, pais: null, fonteId: alvo.id };
    return { alvo, rotulo: rotuloDoAlvo(alvo, nomeDoPais), corpo: montarCorpoNovo({ ...v, ...escopo }) };
  });
}

export function textoAplicaA(s: SelecaoAlvos, fontes: readonly FonteAtiva[], nomeDoPais: NomeDoPais): string {
  if (s.modo === 'todas') return `Vale para todas as fontes ativas (${fontes.length}).`;
  const paises = [...new Set(s.paises)].sort((a, b) => porNome(nomeDoPais(a), nomeDoPais(b))).map(nomeDoPais);
  const nomes = fontes
    .filter((f) => s.fontes.includes(f.id))
    .sort((a, b) => porNome(a.nome, b.nome) || a.id - b.id)
    .map((f) => f.nome);
  const rotulos = [...paises, ...nomes];
  if (rotulos.length === 0) return 'Marque os países e/ou as fontes a que o evento se aplica.';
  const n = rotulos.length;
  return `Vale para: ${rotulos.join(', ')}. Ao salvar, cria ${n === 1 ? '1 registro' : `${n} registros`} (um por país ou fonte).`;
}

// ---------- envio em sequencia ----------

/** Falha que nao adianta repetir nos proximos alvos: sem conexao/erro desconhecido, sessao expirada ou sem permissao. */
export function deveParar(err: unknown): boolean {
  return !(err instanceof ApiError) || err.status === 401 || err.status === 403;
}

/** Um de cada vez (NUNCA em paralelo); no 1o erro que `deveParar`, os restantes ficam como nao enviados. */
export async function executarEmSequencia<T>(
  itens: readonly T[],
  acao: (item: T) => Promise<unknown>,
): Promise<Array<{ item: T; erro: unknown | null; naoEnviado: boolean }>> {
  const saida: Array<{ item: T; erro: unknown | null; naoEnviado: boolean }> = [];
  let parou = false;
  for (const item of itens) {
    if (parou) {
      saida.push({ item, erro: null, naoEnviado: true });
      continue;
    }
    try {
      await acao(item);
      saida.push({ item, erro: null, naoEnviado: false });
    } catch (erro) {
      saida.push({ item, erro, naoEnviado: false });
      if (deveParar(erro)) parou = true;
    }
  }
  return saida;
}

export async function criarEmSequencia(
  itens: readonly ItemAlvo[],
  criar: (c: ForecastOcasiaoNova) => Promise<unknown>,
): Promise<ResultadoAlvo[]> {
  const feitos = await executarEmSequencia(itens, (i) => criar(i.corpo));
  return feitos.map(({ item, erro, naoEnviado }): ResultadoAlvo => {
    const base = { alvo: item.alvo, rotulo: item.rotulo };
    if (naoEnviado) return { ...base, status: 'nao-enviado', mensagem: null };
    if (erro === null) return { ...base, status: 'criado', mensagem: null };
    if (erro instanceof ApiError && erro.status === 409) return { ...base, status: 'duplicado', mensagem: null };
    return { ...base, status: 'erro', mensagem: forecastOcasioesErrorMessage(erro, 'salvar') };
  });
}

export function resumoDoSalvamento(nome: string, r: readonly ResultadoAlvo[]): string {
  const n = (s: StatusAlvo) => r.filter((x) => x.status === s).length;
  const criados = n('criado');
  const duplicados = n('duplicado');
  const erros = n('erro');
  const naoEnviados = n('nao-enviado');
  const partes: string[] = [];
  if (criados > 0) partes.push(criados === 1 ? '1 criado' : `${criados} criados`);
  if (duplicados > 0) partes.push(duplicados === 1 ? '1 já existia' : `${duplicados} já existiam`);
  if (erros > 0) partes.push(`${erros} com erro`);
  if (naoEnviados > 0) partes.push(naoEnviados === 1 ? '1 não enviado' : `${naoEnviados} não enviados`);
  const nada = criados === 0 && erros === 0 && naoEnviados === 0 ? ' Nada foi criado.' : '';
  return `Evento ${nome}: ${partes.join(', ')}.${nada}`;
}

export function resumoEmLote(
  nome: string,
  verbo: 'inativado' | 'reativado' | 'excluído',
  ok: number,
  falhas: number,
  primeiraMensagem: string | null,
): string {
  if (falhas === 0) return `Evento ${nome} ${verbo} em ${ok} alvos.`;
  const base = `Evento ${nome}: ${ok} ${ok === 1 ? verbo : `${verbo}s`}, ${falhas} com erro.`;
  return primeiraMensagem ? `${base} ${primeiraMensagem}` : base;
}

// ---------- agrupamento da lista ----------

export function chaveDoGrupo(o: ForecastOcasiao): string {
  return JSON.stringify([
    o.name,
    o.startDate,
    o.endDate,
    o.recurrence,
    o.component,
    o.effectKind,
    o.effectValue,
    o.notes ?? '',
  ]);
}

export interface GrupoEvento {
  chave: string;
  nome: string;
  notas: string | null;
  /** Demais campos (periodo, etapa, efeito) leem-se de `membros[0]`. */
  membros: ForecastOcasiao[];
}

const ORDEM_ESCOPO = { global: 0, pais: 1, fonte: 2 } as const;

/** Agrupa por CONTEUDO, na ordem em que o 1o membro aparece (a lista ja vem filtrada e ordenada). */
export function agruparEventos(lista: readonly ForecastOcasiao[], nomeDoPais: NomeDoPais): GrupoEvento[] {
  const mapa = new Map<string, GrupoEvento>();
  for (const o of lista) {
    const chave = chaveDoGrupo(o);
    const achado = mapa.get(chave);
    if (achado) achado.membros.push(o);
    else mapa.set(chave, { chave, nome: o.name, notas: o.notes, membros: [o] });
  }
  const nomeDoMembro = (o: ForecastOcasiao): string =>
    o.scopeType === 'pais' ? nomeDoPais(o.countryCode ?? '') : (o.source?.name ?? '');
  for (const g of mapa.values()) {
    g.membros.sort(
      (a, b) =>
        ORDEM_ESCOPO[a.scopeType] - ORDEM_ESCOPO[b.scopeType] ||
        (a.scopeType === 'global' ? 0 : porNome(nomeDoMembro(a), nomeDoMembro(b))) ||
        a.id - b.id,
    );
  }
  return [...mapa.values()];
}

export const CLASSE_SITUACAO = { ativa: 'badge', passada: 'badge badge--muted', inativa: 'badge badge--warning' } as const;

export function situacaoDoGrupo(
  g: GrupoEvento,
  hoje: string,
): { rotulo: string; classe: string; detalhe: string | null } {
  const situacoes = g.membros.map((m) => situacaoDaOcasiao(m, hoje));
  const primeira = situacoes[0] ?? 'ativa';
  if (situacoes.every((s) => s === primeira)) {
    return { rotulo: ROTULO_SITUACAO[primeira], classe: CLASSE_SITUACAO[primeira], detalhe: null };
  }
  const conta = (s: 'ativa' | 'passada' | 'inativa') => situacoes.filter((x) => x === s).length;
  const rotulo = (n: number, singular: string, plural: string) => (n === 0 ? null : `${n} ${n === 1 ? singular : plural}`);
  const detalhe = [
    rotulo(conta('ativa'), 'ativo', 'ativos'),
    rotulo(conta('passada'), 'passado', 'passados'),
    rotulo(conta('inativa'), 'inativo', 'inativos'),
  ]
    .filter(Boolean)
    .join(', ');
  return { rotulo: 'Misto', classe: 'badge badge--info', detalhe };
}
