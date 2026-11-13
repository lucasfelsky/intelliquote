// Conferencia da FUP Indent: cruza as linhas normalizadas com os cadastros (lista em memoria) e com o de-para
// opcional, e produz o plano de operacoes (criar/usar/rejeitar) e a reconciliacao planilha x DASH. Funcoes PURAS:
// sem banco, sem IO, sem console. Em H1 o historico so e CONTADO (as tabelas ainda nao existem).
import { normalizeItemNameKey } from './commercialItemName';
import type { DashFup, FupRow, MetricasMes } from './indentFupParse';
import {
  type GrupoFornecedor,
  type LinhaNormalizada,
  type LinkWindow,
  MOTIVO_COMPOSTO,
  agruparFornecedor,
  chaveAproximada,
  chaveLinha,
  chaveOrdem,
  interpretarDecisao,
  isWithinLinkWindow,
  linkWindow,
  normalizarLinha,
  possivelSigla,
} from './indentFupNormalize';

export type TipoCadastro = 'CLIENTE' | 'FORNECEDOR' | 'PRODUTO';
export const TIPOS_CADASTRO: TipoCadastro[] = ['FORNECEDOR', 'CLIENTE', 'PRODUTO'];

export interface CadastroFornecedor {
  id: number;
  name: string;
  nameKey: string;
}
export interface CadastroCliente {
  id: number;
  name: string;
  supplierRuleMode?: 'LIVRE' | 'APROVADOS' | 'BLOQUEIO';
}
export interface CadastroProduto {
  id: number;
  name: string;
  nameKey: string;
}
export interface Cadastros {
  fornecedores: CadastroFornecedor[];
  clientes: CadastroCliente[];
  produtos: CadastroProduto[];
  vinculos: { supplierId: number; productId: number }[];
  /** Regras cliente x fornecedor (lista de APROVADOS ou de BLOQUEIO, conforme o modo do cliente). */
  regras: { clientId: number; supplierId: number }[];
}
export const CADASTROS_VAZIOS: Cadastros = { fornecedores: [], clientes: [], produtos: [], vinculos: [], regras: [] };

export interface EntradaDePara {
  kind: TipoCadastro;
  texto: string;
  decisao: string;
  plant: string;
}

export interface Resolvido {
  /** `id:<n>` (cadastro existente) ou `nova:<chave>` (a criar). */
  ref: string;
  nome: string;
  chave: string;
  acao: 'CRIAR' | 'USAR';
  id: number | null;
  plant: string | null;
  ignorado: boolean;
  erro: string | null;
}

// ---------- reconciliacao planilha x DASH ----------

export const TOLERANCIA_PADRAO = 0.01;

/**
 * OK = dentro da tolerancia. DIFERE = fora da tolerancia. DASH_DESATUALIZADO = o DASH (tabela dinamica) esta
 * ZERADO no periodo em que a planilha tem movimento: a tabela nao foi atualizada, nao ha divergencia de leitura.
 */
export type StatusReconciliacao = 'OK' | 'DIFERE' | 'DASH_DESATUALIZADO';

export interface LinhaReconciliacao {
  ano: number;
  mes: number;
  planilha: MetricasMes;
  /** Somente linhas que seriam carregadas (nao rejeitadas). */
  carregavel: MetricasMes;
  dash: MetricasMes;
  diferenca: MetricasMes;
  status: StatusReconciliacao;
  /** Verdadeiro quando nao e DIFERE (DASH_DESATUALIZADO nao reprova, mas e sempre informado). */
  ok: boolean;
}
export interface TotalAnoReconciliacao {
  ano: number;
  planilha: MetricasMes;
  dash: MetricasMes;
  diferenca: MetricasMes;
  status: StatusReconciliacao;
  ok: boolean;
}
export interface Reconciliacao {
  tolerancia: number;
  meses: LinhaReconciliacao[];
  totais: TotalAnoReconciliacao[];
  /** Anos da planilha que o DASH nao cobre (informativo, nao compara). */
  anosForaDoDash: { ano: number; planilha: MetricasMes }[];
  /** Linhas da planilha sem DATA PO valida (fora de qualquer mes). */
  linhasSemData: number;
  /** Meses e totais com status DASH_DESATUALIZADO. */
  desatualizados: number;
  ok: boolean;
  /** Motivo da falha global (DASH sem meses reconhecidos); null no fluxo normal. */
  mensagem: string | null;
}

const zero = (): MetricasMes => ({ comissao: 0, faturamento: 0, volume: 0 });
const soma = (a: MetricasMes, l: LinhaNormalizada): void => {
  a.comissao += l.comissaoSubtotal;
  a.faturamento += l.subtotalBruto;
  a.volume += l.quantidadeBruta;
};
const dif = (a: MetricasMes, b: MetricasMes): MetricasMes => ({
  comissao: a.comissao - b.comissao,
  faturamento: a.faturamento - b.faturamento,
  volume: a.volume - b.volume,
});
const ehZero = (m: MetricasMes): boolean => m.comissao === 0 && m.faturamento === 0 && m.volume === 0;
const dentro = (d: MetricasMes, tol: number): boolean =>
  Math.abs(d.comissao) <= tol + 1e-9 && Math.abs(d.faturamento) <= tol + 1e-9 && Math.abs(d.volume) <= tol + 1e-9;

/**
 * Soma por ano-mes de DATA PO (partes UTC) de SUBTOTAL COMISSAO, SUBTOTAL e QTD, e compara com o DASH.
 * `planilha` usa toda linha com DATA PO valida (e o que o DASH soma); `carregavel` tira as rejeitadas.
 */
export function reconciliar(
  linhas: readonly LinhaNormalizada[],
  dash: DashFup,
  rejeitadas: ReadonlySet<number> = new Set(),
  tolerancia = TOLERANCIA_PADRAO,
): Reconciliacao {
  if (Object.keys(dash.meses).length === 0) {
    return {
      tolerancia,
      meses: [],
      totais: [],
      anosForaDoDash: [],
      linhasSemData: 0,
      desatualizados: 0,
      ok: false,
      mensagem: 'DASH sem nenhum mês reconhecido: layout fora do esperado, nada foi reconciliado.',
    };
  }
  const plan = new Map<string, MetricasMes>();
  const carr = new Map<string, MetricasMes>();
  let semData = 0;
  for (const l of linhas) {
    if (l.dataPo === null) {
      semData += 1;
      continue;
    }
    const chave = l.dataPo.slice(0, 7);
    if (!plan.has(chave)) plan.set(chave, zero());
    soma(plan.get(chave) as MetricasMes, l);
    if (!rejeitadas.has(l.linha)) {
      if (!carr.has(chave)) carr.set(chave, zero());
      soma(carr.get(chave) as MetricasMes, l);
    }
  }

  const meses: LinhaReconciliacao[] = [];
  const totais: TotalAnoReconciliacao[] = [];
  for (const ano of dash.anos) {
    const totalPlan = zero();
    const mesesAno: StatusReconciliacao[] = [];
    for (let mes = 1; mes <= 12; mes += 1) {
      const chave = `${ano}-${String(mes).padStart(2, '0')}`;
      const p = plan.get(chave) ?? zero();
      const d = dash.meses[chave] ?? zero();
      const diferenca = dif(p, d);
      totalPlan.comissao += p.comissao;
      totalPlan.faturamento += p.faturamento;
      totalPlan.volume += p.volume;
      const status: StatusReconciliacao = dentro(diferenca, tolerancia)
        ? 'OK'
        : ehZero(d)
          ? 'DASH_DESATUALIZADO'
          : 'DIFERE';
      mesesAno.push(status);
      meses.push({
        ano,
        mes,
        planilha: p,
        carregavel: carr.get(chave) ?? zero(),
        dash: d,
        diferenca,
        status,
        ok: status !== 'DIFERE',
      });
    }
    // "Total Geral" do DASH: so compara quando a linha existe.
    const totalDash = dash.totais[String(ano)];
    if (totalDash) {
      const diferenca = dif(totalPlan, totalDash);
      // O total so e "desatualizado" quando a diferenca vem inteira de meses desatualizados do mesmo ano.
      const emAtraso = zero();
      for (const m of meses) {
        if (m.ano === ano && m.status === 'DASH_DESATUALIZADO') {
          emAtraso.comissao += m.planilha.comissao;
          emAtraso.faturamento += m.planilha.faturamento;
          emAtraso.volume += m.planilha.volume;
        }
      }
      const status: StatusReconciliacao = dentro(diferenca, tolerancia)
        ? 'OK'
        : mesesAno.includes('DASH_DESATUALIZADO') && dentro(dif(diferenca, emAtraso), tolerancia)
          ? 'DASH_DESATUALIZADO'
          : 'DIFERE';
      totais.push({ ano, planilha: totalPlan, dash: totalDash, diferenca, status, ok: status !== 'DIFERE' });
    }
  }

  const anosDash = new Set(dash.anos);
  const fora = new Map<number, MetricasMes>();
  for (const [chave, m] of plan) {
    const ano = Number(chave.slice(0, 4));
    if (anosDash.has(ano)) continue;
    const acc = fora.get(ano) ?? zero();
    acc.comissao += m.comissao;
    acc.faturamento += m.faturamento;
    acc.volume += m.volume;
    fora.set(ano, acc);
  }
  return {
    tolerancia,
    meses,
    totais,
    anosForaDoDash: [...fora].sort((a, b) => a[0] - b[0]).map(([ano, planilha]) => ({ ano, planilha })),
    linhasSemData: semData,
    desatualizados: meses.filter((m) => m.status === 'DASH_DESATUALIZADO').length + totais.filter((t) => t.status === 'DASH_DESATUALIZADO').length,
    ok: meses.every((m) => m.ok) && totais.every((t) => t.ok),
    mensagem: null,
  };
}

// ---------- conferencia ----------

export interface LinhaConferida extends LinhaNormalizada {
  fornecedor: Resolvido | null;
  cliente: Resolvido | null;
  produto: Resolvido | null;
  rejeitada: boolean;
  motivos: string[];
  orderKey: string | null;
  lineKey: string | null;
}

export interface ItemTexto {
  kind: TipoCadastro;
  texto: string;
  linhas: number;
  chave: string;
  resolvido: Resolvido | null;
  decisaoDePara: string;
  /** Fornecedor: regra de agrupamento (D2/D10). */
  regra: GrupoFornecedor['regra'] | null;
  sugestao: string;
}
export interface ItemCadastro {
  kind: TipoCadastro;
  ref: string;
  nome: string;
  acao: 'CRIAR' | 'USAR';
  id: number | null;
  linhas: number;
  textos: number;
  plants: string[];
}
export interface ProdutoNcm {
  ref: string;
  nome: string;
  ncms: { ncm: string; linhas: number }[];
  conflito: boolean;
}
export interface QuaseDuplicidade {
  kind: TipoCadastro;
  grupo: number;
  tipo: 'MESMA_CHAVE_APROXIMADA' | 'POSSIVEL_SIGLA';
  texto: string;
  origem: 'FUP' | 'CADASTRO';
  linhas: number;
}
export interface ParCF {
  cliente: string;
  fornecedor: string;
  linhas: number;
  situacao: string;
}
export type SituacaoVinculo = 'ENTRA' | 'JA EXISTE' | 'FORA DA JANELA';
export interface ParFP {
  fornecedor: string;
  produto: string;
  linhas: number;
  /** Maior DATA PO do par (YYYY-MM-DD). */
  ultimaDataPo: string | null;
  situacao: SituacaoVinculo;
}
export interface ContagemTexto {
  texto: string;
  valor: string;
  linhas: number;
}
export interface Rejeicao {
  linha: number;
  motivo: string;
}
export interface AlertaLinha {
  linha: number;
  alerta: string;
}

export interface Plano {
  fornecedores: { criar: number; usar: number };
  clientes: { criar: number; usar: number };
  produtos: { criar: number; usar: number };
  vinculos: { entram: number; jaExistem: number; foraDaJanela: number };
  historico: { pedidos: number; linhas: number; amostras: number; rejeitadas: number; atualizadas: number; semMudanca: number };
  rejeicoesPorMotivo: Record<string, number>;
}

export const JANELA_VINCULOS_PADRAO_MESES = 24;

export interface Conferencia {
  janela: LinkWindow;
  linhas: LinhaConferida[];
  itens: Record<TipoCadastro, ItemTexto[]>;
  cadastros: Record<TipoCadastro, ItemCadastro[]>;
  produtosNcm: ProdutoNcm[];
  quaseDuplicidades: QuaseDuplicidade[];
  paresClienteFornecedor: ParCF[];
  paresFornecedorProduto: ParFP[];
  normalizacao: {
    incoterm: ContagemTexto[];
    origem: ContagemTexto[];
    destino: ContagemTexto[];
    pagamento: ContagemTexto[];
  };
  alertas: AlertaLinha[];
  alertasPorTipo: Record<string, number>;
  rejeicoes: Rejeicao[];
  plano: Plano;
  reconciliacao: Reconciliacao | null;
  resumo: {
    linhasLidas: number;
    linhasAceitas: number;
    linhasRejeitadas: number;
    fornecedoresTextos: number;
    fornecedoresDepois: number;
    clientesTextos: number;
    clientesDepois: number;
    produtosTextos: number;
    produtosDepois: number;
    fornecedoresAgrupados: number;
    fornecedoresCompostos: number;
    produtosNcmMultiplo: number;
    quaseDuplicidades: number;
  };
}

export interface EntradaConferencia {
  linhas: readonly FupRow[];
  dash: DashFup | null;
  cadastros?: Cadastros;
  dePara?: readonly EntradaDePara[];
  tolerancia?: number;
  /** Data de referencia da janela de vinculos (YYYY-MM-DD). Sem hora local: o chamador decide "hoje". */
  dataReferencia: string;
  /** Janela de vinculos em meses (padrao 24). */
  janelaMeses?: number;
}

const chaveDePara = (kind: TipoCadastro, texto: string): string => `${kind}|${normalizeItemNameKey(texto)}`;

function contar<T>(itens: readonly T[], chave: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of itens) m.set(chave(i), (m.get(chave(i)) ?? 0) + 1);
  return m;
}

export function conferir(entrada: EntradaConferencia): Conferencia {
  const janela = linkWindow(entrada.dataReferencia, entrada.janelaMeses ?? JANELA_VINCULOS_PADRAO_MESES);
  if (janela === null) throw new Error('data de referencia ou janela de vinculos invalida');
  const cad = entrada.cadastros ?? CADASTROS_VAZIOS;
  const deParaMap = new Map<string, EntradaDePara>();
  for (const e of entrada.dePara ?? []) deParaMap.set(chaveDePara(e.kind, e.texto), e);

  const existentes: Record<TipoCadastro, Map<string, { id: number; name: string }>> = {
    FORNECEDOR: new Map(cad.fornecedores.map((f) => [f.nameKey, { id: f.id, name: f.name }])),
    CLIENTE: new Map(cad.clientes.map((c) => [normalizeItemNameKey(c.name), { id: c.id, name: c.name }])),
    PRODUTO: new Map(cad.produtos.map((p) => [p.nameKey, { id: p.id, name: p.name }])),
  };
  const porId: Record<TipoCadastro, Map<number, { id: number; name: string }>> = {
    FORNECEDOR: new Map(cad.fornecedores.map((f) => [f.id, { id: f.id, name: f.name }])),
    CLIENTE: new Map(cad.clientes.map((c) => [c.id, { id: c.id, name: c.name }])),
    PRODUTO: new Map(cad.produtos.map((p) => [p.id, { id: p.id, name: p.name }])),
  };

  // ----- resolucao de um texto da FUP para o cadastro (de-para -> agrupamento automatico -> cadastro por chave) -----
  const cache = new Map<string, Resolvido>();
  function final(kind: TipoCadastro, nome: string, plant: string | null): Resolvido {
    const chave = normalizeItemNameKey(nome);
    const ex = existentes[kind].get(chave);
    return ex
      ? { ref: `id:${ex.id}`, nome: ex.name, chave, acao: 'USAR', id: ex.id, plant, ignorado: false, erro: null }
      : { ref: `nova:${chave}`, nome, chave, acao: 'CRIAR', id: null, plant, ignorado: false, erro: null };
  }
  const falha = (erro: string): Resolvido => ({
    ref: `erro:${erro}`,
    nome: '',
    chave: '',
    acao: 'CRIAR',
    id: null,
    plant: null,
    ignorado: false,
    erro,
  });

  function resolver(kind: TipoCadastro, raw: string, profundidade = 0): Resolvido {
    const memo = `${kind}|${raw}|${profundidade}`;
    const guardado = cache.get(memo);
    if (guardado) return guardado;
    const resultado = resolverSemCache(kind, raw, profundidade);
    cache.set(memo, resultado);
    return resultado;
  }

  function resolverSemCache(kind: TipoCadastro, raw: string, profundidade: number): Resolvido {
    const grupo = kind === 'FORNECEDOR' ? agruparFornecedor(raw) : null;
    const entrada = deParaMap.get(chaveDePara(kind, raw));
    const decisao = entrada ? interpretarDecisao(entrada.decisao) : null;
    const plantDePara = entrada && entrada.plant.trim() !== '' ? entrada.plant.trim().toUpperCase() : null;
    const nomeBase = grupo ? grupo.base : raw.trim().replace(/\s+/g, ' ');

    if (decisao === null) {
      if (grupo?.composto) return falha(MOTIVO_COMPOSTO);
      return final(kind, nomeBase, plantDePara ?? grupo?.plant ?? null);
    }
    switch (decisao.tipo) {
      case 'IGNORAR':
        return { ...falha('ignorado no de-para'), ignorado: true, ref: 'ignorado' };
      case 'INVALIDA':
        return falha('decisão do de-para inválida');
      case 'CRIAR':
        return final(kind, nomeBase, plantDePara ?? grupo?.plant ?? null);
      case 'USAR': {
        const ex = porId[kind].get(decisao.id);
        if (!ex) return falha('de-para aponta para cadastro inexistente');
        return {
          ref: `id:${ex.id}`,
          nome: ex.name,
          chave: normalizeItemNameKey(ex.name),
          acao: 'USAR',
          id: ex.id,
          plant: plantDePara ?? grupo?.plant ?? null,
          ignorado: false,
          erro: null,
        };
      }
      case 'AGRUPAR': {
        if (profundidade >= 5 || normalizeItemNameKey(decisao.alvo) === normalizeItemNameKey(raw)) {
          return falha('de-para AGRUPAR circular');
        }
        const alvo = resolver(kind, decisao.alvo, profundidade + 1);
        if (alvo.erro !== null || alvo.ignorado) return alvo;
        return { ...alvo, plant: plantDePara ?? grupo?.plant ?? alvo.plant };
      }
    }
  }

  // ----- linhas -----
  const base = entrada.linhas.map(normalizarLinha);
  const linhas: LinhaConferida[] = base.map((l) => {
    const motivos = [...l.rejeicoes];
    const resolverSe = (kind: TipoCadastro, raw: string): Resolvido | null => {
      if (raw === '') return null;
      const r = resolver(kind, raw);
      if (r.ignorado) motivos.push(`${kind.toLowerCase()} ignorado no de-para`);
      else if (r.erro !== null) motivos.push(r.erro);
      return r;
    };
    const fornecedor = resolverSe('FORNECEDOR', l.fornecedorRaw);
    const cliente = resolverSe('CLIENTE', l.clienteRaw);
    const produto = resolverSe('PRODUTO', l.produtoRaw);
    return {
      ...l,
      fornecedor,
      cliente,
      produto,
      rejeitada: motivos.length > 0,
      motivos,
      orderKey: null,
      lineKey: null,
    };
  });

  // Chaves de ordem e de linha (ordinal da ocorrencia do produto dentro do PO, na ordem da planilha).
  const ordinais = new Map<string, number>();
  const combinacoes = new Map<string, Set<string>>();
  const anosPorOrdem = new Map<string, Set<number>>();
  for (const l of linhas) {
    if (l.rejeitada || !l.fornecedor || !l.cliente || !l.produto) continue;
    l.orderKey = chaveOrdem(l.poInfo.chave, l.fornecedor.ref, l.cliente.ref);
    const k = `${l.orderKey}#${l.produto.ref}`;
    const ordinal = (ordinais.get(k) ?? 0) + 1;
    ordinais.set(k, ordinal);
    l.lineKey = chaveLinha(l.produto.chave, ordinal);
    if (!combinacoes.has(l.poInfo.chave)) combinacoes.set(l.poInfo.chave, new Set());
    combinacoes.get(l.poInfo.chave)?.add(`${l.fornecedor.ref}|${l.cliente.ref}`);
    if (l.dataPo !== null) {
      if (!anosPorOrdem.has(l.orderKey)) anosPorOrdem.set(l.orderKey, new Set());
      anosPorOrdem.get(l.orderKey)?.add(Number(l.dataPo.slice(0, 4)));
    }
  }
  for (const l of linhas) {
    if (l.orderKey === null) continue;
    if ((combinacoes.get(l.poInfo.chave)?.size ?? 0) > 1) l.alertas.push('PO repetido em combinações diferentes');
    if ((anosPorOrdem.get(l.orderKey)?.size ?? 0) > 1) l.alertas.push('mesma ordem com anos diferentes de DATA PO');
  }

  const aceitas = linhas.filter((l) => !l.rejeitada);
  const rejeitadasSet = new Set(linhas.filter((l) => l.rejeitada).map((l) => l.linha));

  // ----- itens por texto da FUP (de-para) -----
  const itens: Record<TipoCadastro, ItemTexto[]> = { FORNECEDOR: [], CLIENTE: [], PRODUTO: [] };
  const textosPorKind = (kind: TipoCadastro): string[] =>
    linhas
      .map((l) => (kind === 'FORNECEDOR' ? l.fornecedorRaw : kind === 'CLIENTE' ? l.clienteRaw : l.produtoRaw))
      .filter((t) => t !== '');
  for (const kind of TIPOS_CADASTRO) {
    const contagem = contar(textosPorKind(kind), (t) => t);
    for (const [texto, n] of [...contagem].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))) {
      const resolvido = resolver(kind, texto);
      const grupo = kind === 'FORNECEDOR' ? agruparFornecedor(texto) : null;
      const entradaDePara = deParaMap.get(chaveDePara(kind, texto));
      let sugestao: string;
      if (grupo?.composto) {
        sugestao = `CRIAR: fornecedor "${grupo.base}", fábrica "${grupo.plant ?? ''}" (exige decisão)`;
      } else if (grupo && grupo.regra !== 'SEM_VARIANTE') {
        sugestao = `AGRUPAR em "${grupo.base}" (fábrica ${grupo.plant ?? ''})`;
      } else {
        sugestao = resolvido.acao === 'USAR' && resolvido.id !== null ? `USAR:${resolvido.id}` : 'CRIAR';
      }
      itens[kind].push({
        kind,
        texto,
        linhas: n,
        chave: normalizeItemNameKey(grupo ? grupo.base : texto),
        resolvido,
        decisaoDePara: entradaDePara?.decisao ?? '',
        regra: grupo ? grupo.regra : null,
        sugestao,
      });
    }
  }

  // ----- cadastros resolvidos (apos normalizacao) -----
  const cadastros: Record<TipoCadastro, ItemCadastro[]> = { FORNECEDOR: [], CLIENTE: [], PRODUTO: [] };
  for (const kind of TIPOS_CADASTRO) {
    const mapa = new Map<string, ItemCadastro & { plantSet: Set<string>; textoSet: Set<string> }>();
    // So linhas aceitas criam/usam cadastro: linha rejeitada nunca cria cadastro.
    for (const l of aceitas) {
      const r = kind === 'FORNECEDOR' ? l.fornecedor : kind === 'CLIENTE' ? l.cliente : l.produto;
      if (!r || r.erro !== null || r.ignorado) continue;
      const texto = kind === 'FORNECEDOR' ? l.fornecedorRaw : kind === 'CLIENTE' ? l.clienteRaw : l.produtoRaw;
      const item =
        mapa.get(r.ref) ??
        { kind, ref: r.ref, nome: r.nome, acao: r.acao, id: r.id, linhas: 0, textos: 0, plants: [], plantSet: new Set<string>(), textoSet: new Set<string>() };
      item.linhas += 1;
      item.textoSet.add(texto);
      if (r.plant) item.plantSet.add(r.plant);
      mapa.set(r.ref, item);
    }
    cadastros[kind] = [...mapa.values()]
      .map(({ plantSet, textoSet, ...resto }) => ({ ...resto, textos: textoSet.size, plants: [...plantSet].sort() }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  // ----- NCM por produto (D6) -----
  const ncmPorProduto = new Map<string, { nome: string; ncms: Map<string, number> }>();
  for (const l of aceitas) {
    if (!l.produto || l.ncm.ncm === null) continue;
    const e = ncmPorProduto.get(l.produto.ref) ?? { nome: l.produto.nome, ncms: new Map<string, number>() };
    e.ncms.set(l.ncm.ncm, (e.ncms.get(l.ncm.ncm) ?? 0) + 1);
    ncmPorProduto.set(l.produto.ref, e);
  }
  const produtosNcm: ProdutoNcm[] = [...ncmPorProduto]
    .map(([ref, e]) => ({
      ref,
      nome: e.nome,
      ncms: [...e.ncms].map(([ncm, n]) => ({ ncm, linhas: n })).sort((a, b) => b.linhas - a.linhas),
      conflito: e.ncms.size > 1,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  // ----- quase-duplicidades (cadastros resolvidos da FUP + cadastros existentes) -----
  const quase: QuaseDuplicidade[] = [];
  let grupoSeq = 0;
  for (const kind of TIPOS_CADASTRO) {
    const candidatos = new Map<string, { texto: string; origem: 'FUP' | 'CADASTRO'; linhas: number; chave: string }[]>();
    const vistos = new Set<string>();
    const todos: { texto: string; origem: 'FUP' | 'CADASTRO'; linhas: number; chave: string }[] = [];
    for (const c of cadastros[kind]) {
      const chave = normalizeItemNameKey(c.nome);
      vistos.add(chave);
      todos.push({ texto: c.nome, origem: c.acao === 'USAR' ? 'CADASTRO' : 'FUP', linhas: c.linhas, chave });
    }
    const lista = kind === 'FORNECEDOR' ? cad.fornecedores : kind === 'CLIENTE' ? cad.clientes : cad.produtos;
    for (const c of lista) {
      const chave = normalizeItemNameKey(c.name);
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      todos.push({ texto: c.name, origem: 'CADASTRO', linhas: 0, chave });
    }
    for (const t of todos) {
      const ap = chaveAproximada(t.texto);
      if (ap === '') continue;
      candidatos.set(ap, [...(candidatos.get(ap) ?? []), t]);
    }
    for (const grupo of candidatos.values()) {
      if (grupo.length < 2) continue;
      grupoSeq += 1;
      for (const t of grupo) {
        quase.push({ kind, grupo: grupoSeq, tipo: 'MESMA_CHAVE_APROXIMADA', texto: t.texto, origem: t.origem, linhas: t.linhas });
      }
    }
    if (kind === 'FORNECEDOR') {
      for (const curta of todos) {
        for (const longa of todos) {
          if (curta === longa || !possivelSigla(curta.texto, longa.texto)) continue;
          grupoSeq += 1;
          for (const t of [curta, longa]) {
            quase.push({ kind, grupo: grupoSeq, tipo: 'POSSIVEL_SIGLA', texto: t.texto, origem: t.origem, linhas: t.linhas });
          }
        }
      }
    }
  }

  // ----- pares cliente x fornecedor (D8) e fornecedor x produto (D9) -----
  const regrasPorCliente = new Map<number, Set<number>>();
  for (const r of cad.regras) {
    if (!regrasPorCliente.has(r.clientId)) regrasPorCliente.set(r.clientId, new Set());
    regrasPorCliente.get(r.clientId)?.add(r.supplierId);
  }
  const modoPorCliente = new Map(cad.clientes.map((c) => [c.id, c.supplierRuleMode ?? 'LIVRE']));
  const nomeFornecedorPorId = new Map(cad.fornecedores.map((f) => [f.id, f.name]));
  const pares = new Map<string, ParCF & { c: Resolvido; f: Resolvido }>();
  for (const l of aceitas) {
    if (!l.cliente || !l.fornecedor) continue;
    const k = `${l.cliente.ref}|${l.fornecedor.ref}`;
    const p = pares.get(k);
    if (p) p.linhas += 1;
    else pares.set(k, { cliente: l.cliente.nome, fornecedor: l.fornecedor.nome, linhas: 1, situacao: '', c: l.cliente, f: l.fornecedor });
  }
  const paresCF: ParCF[] = [];
  const compradosPorCliente = new Map<string, Set<string>>();
  for (const p of pares.values()) {
    let situacao = 'comprado';
    if (p.c.id !== null) {
      const modo = modoPorCliente.get(p.c.id) ?? 'LIVRE';
      const regra = p.f.id !== null && (regrasPorCliente.get(p.c.id)?.has(p.f.id) ?? false);
      if (modo === 'APROVADOS' && !regra) situacao = 'comprado fora da lista APROVADOS';
      else if (modo === 'BLOQUEIO' && regra) situacao = 'comprado de fornecedor em BLOQUEIO';
    }
    if (!compradosPorCliente.has(p.c.ref)) compradosPorCliente.set(p.c.ref, new Set());
    compradosPorCliente.get(p.c.ref)?.add(p.f.ref);
    paresCF.push({ cliente: p.cliente, fornecedor: p.fornecedor, linhas: p.linhas, situacao });
  }
  for (const c of cadastros.CLIENTE) {
    if (c.id === null || modoPorCliente.get(c.id) !== 'APROVADOS') continue;
    for (const sid of regrasPorCliente.get(c.id) ?? []) {
      if (compradosPorCliente.get(c.ref)?.has(`id:${sid}`)) continue;
      paresCF.push({ cliente: c.nome, fornecedor: nomeFornecedorPorId.get(sid) ?? `#${sid}`, linhas: 0, situacao: 'aprovado sem compra' });
    }
  }
  paresCF.sort((a, b) => a.cliente.localeCompare(b.cliente, 'pt-BR') || a.fornecedor.localeCompare(b.fornecedor, 'pt-BR'));

  const vinculosExistentes = new Set(cad.vinculos.map((v) => `${v.supplierId}|${v.productId}`));
  // Vinculo ja existente nunca muda; senao ENTRA se ALGUMA linha do par tem DATA PO dentro da janela.
  const parFP = new Map<string, ParFP & { naJanela: boolean }>();
  for (const l of aceitas) {
    if (!l.fornecedor || !l.produto || l.dataPo === null) continue;
    const k = `${l.fornecedor.ref}|${l.produto.ref}`;
    const existe = l.fornecedor.id !== null && l.produto.id !== null && vinculosExistentes.has(`${l.fornecedor.id}|${l.produto.id}`);
    const dentroJanela = isWithinLinkWindow(l.dataPo, janela);
    const p = parFP.get(k);
    if (p) {
      p.linhas += 1;
      if (p.ultimaDataPo === null || l.dataPo > p.ultimaDataPo) p.ultimaDataPo = l.dataPo;
      if (dentroJanela) p.naJanela = true;
    } else {
      parFP.set(k, {
        fornecedor: l.fornecedor.nome,
        produto: l.produto.nome,
        linhas: 1,
        ultimaDataPo: l.dataPo,
        situacao: existe ? 'JA EXISTE' : 'FORA DA JANELA',
        naJanela: dentroJanela,
      });
    }
  }
  for (const p of parFP.values()) if (p.situacao !== 'JA EXISTE') p.situacao = p.naJanela ? 'ENTRA' : 'FORA DA JANELA';
  const paresFornecedorProduto: ParFP[] = [...parFP.values()]
    .map(({ naJanela: _naJanela, ...resto }) => resto)
    .sort((a, b) => a.fornecedor.localeCompare(b.fornecedor, 'pt-BR') || a.produto.localeCompare(b.produto, 'pt-BR'));

  // ----- tabelas de normalizacao (texto -> valor) -----
  const tabela = (textoDe: (l: LinhaNormalizada) => string | null, valorDe: (l: LinhaNormalizada) => string): ContagemTexto[] => {
    const m = new Map<string, ContagemTexto>();
    for (const l of linhas) {
      const texto = textoDe(l);
      if (texto === null) continue;
      const e = m.get(texto) ?? { texto, valor: valorDe(l), linhas: 0 };
      e.linhas += 1;
      m.set(texto, e);
    }
    return [...m.values()].sort((a, b) => b.linhas - a.linhas || a.texto.localeCompare(b.texto, 'pt-BR'));
  };
  const normalizacao = {
    incoterm: tabela(
      (l) => l.incoterm.raw,
      (l) => (l.incoterm.incoterm === null ? '(não reconhecido)' : `${l.incoterm.incoterm} / ${l.incoterm.local ?? ''}`),
    ),
    origem: tabela(
      (l) => l.origem.raw,
      (l) => (l.origem.pais === null ? '(não reconhecida)' : `${l.origem.pais} / ${l.origem.detalhe ?? ''}`),
    ),
    destino: tabela(
      (l) => l.destino.raw,
      (l) => `${l.destino.destino ?? ''}${l.destino.reconhecido ? '' : ' (fora do dicionário)'}`,
    ),
    pagamento: tabela(
      (l) => l.pagamento.raw,
      (l) =>
        l.pagamento.amostra
          ? 'AMOSTRA'
          : l.pagamento.padronizado
            ? `${l.pagamento.dias ?? ''} / ${l.pagamento.base ?? ''}`
            : '(sem padronização)',
    ),
  };

  // ----- alertas e rejeicoes -----
  const alertas: AlertaLinha[] = [];
  const alertasPorTipo: Record<string, number> = {};
  for (const l of linhas) {
    for (const a of l.alertas) {
      alertas.push({ linha: l.linha, alerta: a });
      alertasPorTipo[a] = (alertasPorTipo[a] ?? 0) + 1;
    }
  }
  const rejeicoes: Rejeicao[] = [];
  const rejeicoesPorMotivo: Record<string, number> = {};
  for (const l of linhas) {
    for (const motivo of l.motivos) {
      rejeicoes.push({ linha: l.linha, motivo });
      rejeicoesPorMotivo[motivo] = (rejeicoesPorMotivo[motivo] ?? 0) + 1;
    }
  }

  // ----- plano (dry-run) -----
  const cont = (kind: TipoCadastro): { criar: number; usar: number } => ({
    criar: cadastros[kind].filter((c) => c.acao === 'CRIAR').length,
    usar: cadastros[kind].filter((c) => c.acao === 'USAR').length,
  });
  const pedidos = new Set(aceitas.map((l) => l.orderKey));
  const plano: Plano = {
    fornecedores: cont('FORNECEDOR'),
    clientes: cont('CLIENTE'),
    produtos: cont('PRODUTO'),
    vinculos: {
      entram: paresFornecedorProduto.filter((p) => p.situacao === 'ENTRA').length,
      jaExistem: paresFornecedorProduto.filter((p) => p.situacao === 'JA EXISTE').length,
      foraDaJanela: paresFornecedorProduto.filter((p) => p.situacao === 'FORA DA JANELA').length,
    },
    // Em H1 as tabelas de historico nao existem: tudo seria criado, nada atualizado nem "sem mudanca".
    historico: {
      pedidos: pedidos.size,
      linhas: aceitas.length,
      amostras: aceitas.filter((l) => l.isSample).length,
      rejeitadas: rejeitadasSet.size,
      atualizadas: 0,
      semMudanca: 0,
    },
    rejeicoesPorMotivo,
  };

  const reconciliacao = entrada.dash ? reconciliar(base, entrada.dash, rejeitadasSet, entrada.tolerancia) : null;
  const fornItens = itens.FORNECEDOR;
  return {
    janela,
    linhas,
    itens,
    cadastros,
    produtosNcm,
    quaseDuplicidades: quase,
    paresClienteFornecedor: paresCF,
    paresFornecedorProduto,
    normalizacao,
    alertas,
    alertasPorTipo,
    rejeicoes,
    plano,
    reconciliacao,
    resumo: {
      linhasLidas: linhas.length,
      linhasAceitas: aceitas.length,
      linhasRejeitadas: rejeitadasSet.size,
      fornecedoresTextos: itens.FORNECEDOR.length,
      fornecedoresDepois: cadastros.FORNECEDOR.length,
      clientesTextos: itens.CLIENTE.length,
      clientesDepois: cadastros.CLIENTE.length,
      produtosTextos: itens.PRODUTO.length,
      produtosDepois: cadastros.PRODUTO.length,
      fornecedoresAgrupados: fornItens.filter((i) => i.regra === 'PARENTESES' || i.regra === 'NUMERO_FINAL').length,
      fornecedoresCompostos: fornItens.filter((i) => i.regra === 'COMPOSTO_BARRA').length,
      produtosNcmMultiplo: produtosNcm.filter((p) => p.conflito).length,
      quaseDuplicidades: new Set(quase.map((q) => q.grupo)).size,
    },
  };
}
