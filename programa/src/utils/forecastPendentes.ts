// Codigos do DBCorp que nao estao no cadastro de produtos ativos (PENDENTES DE CADASTRO): funcao PURA sobre as
// `Entradas` da quinzena (mesmo formato do snapshot), sem leitura de planilha e sem banco. O gateway DBCorp futuro monta
// as mesmas `Entradas` e chama igual.
//
// Regra: o codigo entra no calculo so como codigo de um produto ATIVO do cadastro. Enquanto nao estiver la, ele
// aparece aqui (com o consumo/programacao/chegada que o DBCorp trouxe) e fica FORA do calculo.
import { FORECAST_PENDENTES_MAX_ITENS } from '../constants/forecast';
import type { Entradas } from './forecastTypes';

export type PendentesEntradas = Pick<
  Entradas,
  'estoque' | 'vendasMes' | 'vendasAtual' | 'vendasAnual' | 'programacoes' | 'chegadas'
>;

export interface CadastroDeCodigos {
  // Codigos (maiusculas) de produtos ATIVOS.
  ativos: Set<string>;
  // Codigos (maiusculas) de produtos INATIVOS -> o produto dono.
  inativos: Map<string, { productId: number; nome: string }>;
}

export interface PendenteCadastro {
  codigo: string;
  situacao: 'sem_cadastro' | 'produto_inativo';
  produtoInativo: { id: number; nome: string } | null;
  vendasMes: number;
  vendasAtual: number;
  vendasAnual: number;
  programacao: number;
  chegadas: number;
  saldo: number;
}

export interface PendentesResultado {
  itens: PendenteCadastro[];
  totalItens: number;
  omitidos: number;
  // Codigos so com saldo (sem venda, programacao nem chegada): nao listados, so contados.
  soSaldo: { codigos: number; kg: number };
}

// Mesma regra de normalizeProductCode (forecastWorkbook.ts), repetida aqui para o util nao depender do leitor de planilha.
const normalizar = (codigo: string): string => codigo.trim().toUpperCase();

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

type Campo = 'vendasMes' | 'vendasAtual' | 'vendasAnual' | 'programacao' | 'chegadas' | 'saldo';

const vazio = (codigo: string): PendenteCadastro => ({
  codigo,
  situacao: 'sem_cadastro',
  produtoInativo: null,
  vendasMes: 0,
  vendasAtual: 0,
  vendasAnual: 0,
  programacao: 0,
  chegadas: 0,
  saldo: 0,
});

export function codigosPendentes(entradas: PendentesEntradas, cadastro: CadastroDeCodigos): PendentesResultado {
  const porCodigo = new Map<string, PendenteCadastro>();
  const somar = (linhas: Array<{ codigo: string; qtd: number }>, campo: Campo) => {
    for (const { codigo, qtd } of linhas) {
      const chave = normalizar(codigo);
      if (chave === '' || cadastro.ativos.has(chave) || !Number.isFinite(qtd)) continue;
      const atual = porCodigo.get(chave) ?? vazio(chave);
      atual[campo] += qtd;
      porCodigo.set(chave, atual);
    }
  };
  somar(entradas.estoque, 'saldo');
  somar(entradas.vendasMes, 'vendasMes');
  somar(entradas.vendasAtual, 'vendasAtual');
  somar(entradas.vendasAnual, 'vendasAnual');
  somar(entradas.programacoes, 'programacao');
  somar(entradas.chegadas, 'chegadas');

  const listados: PendenteCadastro[] = [];
  const soSaldo = { codigos: 0, kg: 0 };
  for (const item of porCodigo.values()) {
    item.vendasMes = round6(item.vendasMes);
    item.vendasAtual = round6(item.vendasAtual);
    item.vendasAnual = round6(item.vendasAnual);
    item.programacao = round6(item.programacao);
    item.chegadas = round6(item.chegadas);
    item.saldo = round6(item.saldo);

    const comMovimento =
      item.vendasMes > 0 ||
      item.vendasAtual > 0 ||
      item.vendasAnual > 0 ||
      item.programacao > 0 ||
      item.chegadas > 0;
    if (!comMovimento) {
      if (item.saldo !== 0) {
        soSaldo.codigos += 1;
        soSaldo.kg += item.saldo;
      }
      continue;
    }
    const dono = cadastro.inativos.get(item.codigo);
    if (dono) {
      item.situacao = 'produto_inativo';
      item.produtoInativo = { id: dono.productId, nome: dono.nome };
    }
    listados.push(item);
  }

  listados.sort(
    (a, b) => b.vendasAnual - a.vendasAnual || b.vendasMes - a.vendasMes || (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0),
  );
  const itens = listados.slice(0, FORECAST_PENDENTES_MAX_ITENS);
  return {
    itens,
    totalItens: listados.length,
    omitidos: listados.length - itens.length,
    soSaldo: { codigos: soSaldo.codigos, kg: round6(soSaldo.kg) },
  };
}
