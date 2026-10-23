// Codigos do DBCorp que nao estao no cadastro de produtos ativos (PENDENTES DE CADASTRO): funcao PURA sobre as
// `Entradas` da quinzena (mesmo formato do snapshot) e sobre as vendas mensais ja somadas, sem leitura de planilha e
// sem banco. O gateway DBCorp futuro monta as mesmas entradas e chama igual.
//
// Regra (alinhada ao COMEX, 5C): o codigo entra no calculo so como codigo de um produto ATIVO do cadastro. Enquanto
// nao estiver la, ele e PENDENTE (e fica FORA do calculo) somente se tiver
//   - venda nos ULTIMOS 3 MESES (base-3 + base-2 do historico mensal + o mes anterior das `Entradas`: a mesma base da
//     media trimestral Q do motor), OU
//   - PROGRAMACAO pendente, OU
//   - COMPRA em aberto no FUP (qualquer linha nao CONCLUIDA, congelada em `Entradas.comprasEmAberto`).
// Venda so no acumulado anual (ou so no mes atual) e codigo so com saldo ficam FORA da lista; os dois sao apenas contados.
import { FORECAST_PENDENTES_MAX_ITENS } from '../constants/forecast';
import type { Entradas } from './forecastTypes';

export type PendentesEntradas = Pick<
  Entradas,
  'estoque' | 'vendasMes' | 'vendasAtual' | 'vendasAnual' | 'programacoes' | 'chegadas'
> &
  Partial<Pick<Entradas, 'comprasEmAberto'>>;

export interface CadastroDeCodigos {
  // Codigos (maiusculas) de produtos ATIVOS.
  ativos: Set<string>;
  // Codigos (maiusculas) de produtos INATIVOS -> o produto dono.
  inativos: Map<string, { productId: number; nome: string }>;
}

// Vendas dos meses anteriores (historico mensal gravado) que a regra dos 3 meses usa.
export interface VendasRecentes {
  // [base-3, base-2, base-1] (YYYY-MM): so para exibir o criterio.
  meses: string[];
  // Soma por codigo (maiusculas) de base-3 + base-2 em `ForecastMonthlySale`.
  anteriores: ReadonlyMap<string, number>;
  // Meses base-3/base-2 sem nenhuma linha no historico (a lista pode estar incompleta).
  ausentes: string[];
}

export interface PendenteCadastro {
  codigo: string;
  situacao: 'sem_cadastro' | 'produto_inativo';
  produtoInativo: { id: number; nome: string } | null;
  vendasMes: number; // VENDAS do mes anterior (O)
  vendasAtual: number; // mes corrente ate o dia 15 (NAO qualifica sozinha)
  vendasAnual: number;
  // Venda dos ultimos 3 meses = vendasAnteriores (base-3 + base-2) + vendasMes (base-1).
  vendas3Meses: number;
  vendasAnteriores: number;
  programacao: number;
  // Chegadas que a regra F3 aceitou (informativo; a regra dos pendentes usa `comprasEmAberto`).
  chegadas: number;
  // Compra em aberto no FUP (qualquer linha nao CONCLUIDA).
  comprasEmAberto: number;
  saldo: number;
}

export interface PendentesResultado {
  itens: PendenteCadastro[];
  totalItens: number;
  omitidos: number;
  // Codigos so com saldo (sem venda, programacao nem compra em aberto): nao listados, so contados.
  soSaldo: { codigos: number; kg: number };
  // Codigos sem venda nos ultimos 3 meses, programacao nem compra em aberto, mas com venda no mes atual ou no
  // acumulado anual: nao listados, so contados (`vendasAnual` = kg do acumulado anual desses codigos).
  semVendaRecente: { codigos: number; vendasAnual: number };
  regra: {
    mesesVenda: string[];
    historicoAusente: string[];
    // 'fup_em_aberto' = `Entradas.comprasEmAberto`; 'chegadas' = quinzena gravada antes do 5C (sem essa chave).
    compras: 'fup_em_aberto' | 'chegadas';
  };
}

// Mesma regra de normalizeProductCode (forecastWorkbook.ts), repetida aqui para o util nao depender do leitor de planilha.
const normalizar = (codigo: string): string => codigo.trim().toUpperCase();

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

type Campo = 'vendasMes' | 'vendasAtual' | 'vendasAnual' | 'programacao' | 'chegadas' | 'comprasEmAberto' | 'saldo';

const vazio = (codigo: string): PendenteCadastro => ({
  codigo,
  situacao: 'sem_cadastro',
  produtoInativo: null,
  vendasMes: 0,
  vendasAtual: 0,
  vendasAnual: 0,
  vendas3Meses: 0,
  vendasAnteriores: 0,
  programacao: 0,
  chegadas: 0,
  comprasEmAberto: 0,
  saldo: 0,
});

export function codigosPendentes(
  entradas: PendentesEntradas,
  cadastro: CadastroDeCodigos,
  vendas: VendasRecentes,
): PendentesResultado {
  const porCodigo = new Map<string, PendenteCadastro>();
  const obter = (chave: string): PendenteCadastro => {
    const atual = porCodigo.get(chave) ?? vazio(chave);
    porCodigo.set(chave, atual);
    return atual;
  };
  const somar = (linhas: Array<{ codigo: string; qtd: number }>, campo: Campo) => {
    for (const { codigo, qtd } of linhas) {
      const chave = normalizar(codigo);
      if (chave === '' || cadastro.ativos.has(chave) || !Number.isFinite(qtd)) continue;
      obter(chave)[campo] += qtd;
    }
  };
  somar(entradas.estoque, 'saldo');
  somar(entradas.vendasMes, 'vendasMes');
  somar(entradas.vendasAtual, 'vendasAtual');
  somar(entradas.vendasAnual, 'vendasAnual');
  somar(entradas.programacoes, 'programacao');
  somar(entradas.chegadas, 'chegadas');
  // Quinzena gravada antes do 5C nao tem `comprasEmAberto`: a compra em aberto cai nas chegadas aceitas pela F3.
  const comprasDoFup = entradas.comprasEmAberto !== undefined;
  if (comprasDoFup) somar(entradas.comprasEmAberto ?? [], 'comprasEmAberto');
  for (const [codigo, qtd] of vendas.anteriores) {
    const chave = normalizar(codigo);
    if (chave === '' || cadastro.ativos.has(chave) || !Number.isFinite(qtd)) continue;
    obter(chave).vendasAnteriores += qtd;
  }

  const listados: PendenteCadastro[] = [];
  const soSaldo = { codigos: 0, kg: 0 };
  const semVendaRecente = { codigos: 0, vendasAnual: 0 };
  for (const item of porCodigo.values()) {
    item.vendasMes = round6(item.vendasMes);
    item.vendasAtual = round6(item.vendasAtual);
    item.vendasAnual = round6(item.vendasAnual);
    item.vendasAnteriores = round6(item.vendasAnteriores);
    item.vendas3Meses = round6(item.vendasAnteriores + item.vendasMes);
    item.programacao = round6(item.programacao);
    item.chegadas = round6(item.chegadas);
    item.comprasEmAberto = round6(comprasDoFup ? item.comprasEmAberto : item.chegadas);
    item.saldo = round6(item.saldo);

    if (item.vendas3Meses > 0 || item.programacao > 0 || item.comprasEmAberto > 0) {
      const dono = cadastro.inativos.get(item.codigo);
      if (dono) {
        item.situacao = 'produto_inativo';
        item.produtoInativo = { id: dono.productId, nome: dono.nome };
      }
      listados.push(item);
      continue;
    }
    if (item.vendasAtual > 0 || item.vendasAnual > 0) {
      semVendaRecente.codigos += 1;
      semVendaRecente.vendasAnual += item.vendasAnual;
    } else if (item.saldo !== 0) {
      soSaldo.codigos += 1;
      soSaldo.kg += item.saldo;
    }
  }

  listados.sort(
    (a, b) =>
      b.vendas3Meses - a.vendas3Meses ||
      b.programacao - a.programacao ||
      b.comprasEmAberto - a.comprasEmAberto ||
      (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0),
  );
  const itens = listados.slice(0, FORECAST_PENDENTES_MAX_ITENS);
  return {
    itens,
    totalItens: listados.length,
    omitidos: listados.length - itens.length,
    soSaldo: { codigos: soSaldo.codigos, kg: round6(soSaldo.kg) },
    semVendaRecente: { codigos: semVendaRecente.codigos, vendasAnual: round6(semVendaRecente.vendasAnual) },
    regra: {
      mesesVenda: [...vendas.meses],
      historicoAusente: [...vendas.ausentes],
      compras: comprasDoFup ? 'fup_em_aberto' : 'chegadas',
    },
  };
}
