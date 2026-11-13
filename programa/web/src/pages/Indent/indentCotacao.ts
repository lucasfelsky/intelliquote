import type { IndentQuoteDetail, IndentQuoteRow, IndentQuoteStatus } from '@/services/indentQuotes';

// Apoio das telas de Cotacoes do IQ Indent (mock viewCotacoes/openCot). Total, aceite unico e acoes permitidas vem do BACKEND:
// aqui so rotulo, formato pt-BR, leitura do que o usuario digita e agrupamento da lista.

export const QUOTE_STATUS: Record<IndentQuoteStatus, { rotulo: string; classe: string }> = {
  RASCUNHO: { rotulo: 'Rascunho', classe: 'badge badge--dot badge--muted' },
  ENVIADA: { rotulo: 'Enviada', classe: 'badge badge--dot badge--info' },
  RESPONDIDA: { rotulo: 'Respondida', classe: 'badge badge--dot badge--warning' },
  ACEITA: { rotulo: 'Aceita', classe: 'badge badge--dot badge--success' },
  RECUSADA: { rotulo: 'Recusada', classe: 'badge badge--dot badge--danger' },
  REVISADA: { rotulo: 'Revisada', classe: 'badge badge--dot badge--muted' },
};

/** Ordem dos grupos no agrupamento por status (mock: Rascunho, Enviada, Respondida, Aceita, Recusada, Revisada). */
export const QUOTE_STATUS_ORDER: IndentQuoteStatus[] = ['RASCUNHO', 'ENVIADA', 'RESPONDIDA', 'ACEITA', 'RECUSADA', 'REVISADA'];

function agrupaMilhar(inteiro: string): string {
  return inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Dinheiro no padrao do mock: `US$ 19.875,00` / `€ 19.875,00`. `null` (sem CFR em nenhum item) = "—". Formata a STRING decimal, sem passar por float. */
export function formatMoney(valor: string | null, moeda: string): string {
  if (valor === null) return '—';
  const [inteiro = '0', decimais = ''] = valor.split('.');
  return `${moeda === 'EUR' ? '€ ' : 'US$ '}${agrupaMilhar(inteiro)},${decimais.padEnd(2, '0').slice(0, 2)}`;
}

/** Preco por kg: pt-BR com no minimo 3 e no maximo 4 casas ("0.7950" -> "0,795"; "0.7955" -> "0,7955"). `null` = "—". */
export function formatPricePerKg(valor: string | null): string {
  if (valor === null) return '—';
  const [inteiro = '0', decimais = ''] = valor.split('.');
  return `${agrupaMilhar(inteiro)},${decimais.replace(/0+$/, '').padEnd(3, '0')}`;
}

/** Quantidade em kg a partir da string de 3 casas ("25000.000" -> "25.000"; "1000.500" -> "1.000,5"). */
export function formatQuantityKg(valor: string): string {
  const [inteiro = '0', decimais = ''] = valor.split('.');
  const casas = decimais.replace(/0+$/, '');
  return casas ? `${agrupaMilhar(inteiro)},${casas}` : agrupaMilhar(inteiro);
}

/**
 * Preco digitado em pt-BR para a string decimal da API: "0,795" -> "0.795". Aceita virgula ou ponto como separador decimal (uma vez),
 * ate 5 inteiros e 4 casas, maior que zero. `null` quando invalido (a tela mostra "Preco invalido: use ate 4 casas decimais.").
 */
export function parsePriceInput(texto: string): string | null {
  const limpo = texto.trim();
  if (!/^\d{1,5}([.,]\d{1,4})?$/.test(limpo)) return null;
  const normal = limpo.replace(',', '.');
  return Number(normal) > 0 ? normal : null;
}

/** Iniciais do avatar do grupo (regra `init2` do mock): ate 2 palavras que comecam com maiuscula. */
export function initials(nome: string): string {
  return nome
    .split(/\s+/)
    .filter((palavra) => /^[A-ZÀ-Ú]/.test(palavra))
    .slice(0, 2)
    .map((palavra) => palavra[0])
    .join('');
}

/** `YYYY-MM-DD` -> `dd/mm` (lista) ou `dd/mm/aaaa` (gaveta). `null` = "—". */
export function formatDateKey(chave: string | null, formato: 'curta' | 'longa'): string {
  if (!chave) return '—';
  const [ano, mes, dia] = chave.split('-');
  return formato === 'curta' ? `${dia}/${mes}` : `${dia}/${mes}/${ano}`;
}

export type QuoteGroupBy = 'fornecedor' | 'cliente' | 'status';

export interface QuoteGroup {
  chave: string;
  titulo: string;
  /** Linha de apoio ("Pais · Contato" no fornecedor; cidade no cliente; nada no status). */
  sub: string | null;
  /** Iniciais; ausente no agrupamento por status. */
  avatar: string | null;
  /** So no agrupamento por fornecedor: fornecedor sem parceria firmada. */
  semParceria: boolean;
  comExcecao: number;
  /** RASCUNHO + ENVIADA. */
  emAberto: number;
  linhas: IndentQuoteRow[];
}

function maisRecenteAntes(a: IndentQuoteRow, b: IndentQuoteRow): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return b.id - a.id;
}

/** Agrupa a lista no front (a API devolve ate 500 linhas). Grupos por nome (pt-BR) ou na ordem dos status; linhas da mais recente para a mais antiga. */
export function groupQuotes(linhas: IndentQuoteRow[], por: QuoteGroupBy): QuoteGroup[] {
  const grupos = new Map<string, QuoteGroup>();

  for (const linha of [...linhas].sort(maisRecenteAntes)) {
    let chave: string;
    let titulo: string;
    let sub: string | null = null;
    let avatar: string | null = null;
    let semParceria = false;

    if (por === 'fornecedor') {
      chave = `f${linha.supplier.id}`;
      titulo = linha.supplier.name;
      sub = [linha.supplier.country, linha.supplier.contactName].filter(Boolean).join(' · ') || null;
      avatar = initials(titulo);
      semParceria = !linha.supplier.hasPartnership;
    } else if (por === 'cliente') {
      chave = `c${linha.client?.id ?? 0}`;
      titulo = linha.client?.name ?? 'Sem cliente';
      sub = linha.client?.city ?? null;
      avatar = initials(titulo);
    } else {
      chave = linha.status;
      titulo = QUOTE_STATUS[linha.status].rotulo;
    }

    let grupo = grupos.get(chave);
    if (!grupo) {
      grupo = { chave, titulo, sub, avatar, semParceria, comExcecao: 0, emAberto: 0, linhas: [] };
      grupos.set(chave, grupo);
    }
    grupo.linhas.push(linha);
    if (linha.exception) grupo.comExcecao += 1;
    if (linha.status === 'RASCUNHO' || linha.status === 'ENVIADA') grupo.emAberto += 1;
  }

  const lista = [...grupos.values()];
  if (por === 'status') {
    return lista.sort((a, b) => QUOTE_STATUS_ORDER.indexOf(a.chave as IndentQuoteStatus) - QUOTE_STATUS_ORDER.indexOf(b.chave as IndentQuoteStatus));
  }
  return lista.sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'));
}

/** Aviso do aceite unico (Decisao 8 do plano); `null` quando a solicitacao nao tem OUTRA cotacao aceita (inclui a propria ACEITA). */
export function acceptedNotice(quote: Pick<IndentQuoteDetail, 'acceptedQuote' | 'processNumber' | 'status'>): string | null {
  if (!quote.acceptedQuote) return null;

  const base = `A solicitação ${quote.processNumber} já tem uma cotação aceita: ${quote.acceptedQuote.ref} · ${quote.acceptedQuote.supplierName}. Esta cotação não pode mais ser aceita nem revisada.`;
  if (quote.status === 'RESPONDIDA') return `${base} Você ainda pode recusá-la.`;
  if (quote.status === 'ENVIADA') return `${base} Você ainda pode registrar a resposta do fornecedor, para histórico.`;
  if (quote.status === 'RASCUNHO') return `${base} Ela não será enviada.`;
  return base;
}

/** Cabecalho da coluna CFR: `CFR <destino>` ou `CFR`. */
export function cfrHeader(destino: string | null): string {
  return destino ? `CFR ${destino}` : 'CFR';
}

/** Linha "Incoterm" da gaveta: `FOB origem e CFR <destino>` (ou `(destino a definir)`). */
export function incotermLine(destino: string | null): string {
  return `FOB origem e CFR ${destino ?? '(destino a definir)'}`;
}

/** Texto da linha "Observação": fabricante e/ou observacao unidos por " · "; `null` quando nenhum. */
export function observationText(fabricante: string | null, observacao: string | null): string | null {
  const partes = [fabricante ? `Fabricante: ${fabricante}` : null, observacao].filter(Boolean);
  return partes.length > 0 ? partes.join(' · ') : null;
}

/** "Cliente Exemplo Ltda Sul" -> "Cliente Exemplo Ltda" (3 primeiras palavras, como o banner do mock). */
export function firstWords(nome: string, quantas = 3): string {
  return nome.split(/\s+/).slice(0, quantas).join(' ');
}

const hojeBr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Hoje no calendario de Sao Paulo (`YYYY-MM-DD`), nunca o do navegador nem `toISOString()`. */
export function todayKeyBr(agora: Date = new Date()): string {
  const partes = hojeBr.formatToParts(agora);
  const pega = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? '';
  return `${pega('year')}-${pega('month')}-${pega('day')}`;
}

/** Soma `quantidade x CFR` dos precos digitados (so para EXIBIR o total enquanto digita; o total oficial e o do backend). `null` sem nenhum CFR valido. */
export function estimateTotal(itens: Array<{ quantityKg: string; cfr: string }>): string | null {
  let total = 0;
  let algum = false;
  for (const item of itens) {
    const preco = parsePriceInput(item.cfr);
    if (preco === null) continue;
    total += Number(item.quantityKg) * Number(preco);
    algum = true;
  }
  return algum ? total.toFixed(2) : null;
}
