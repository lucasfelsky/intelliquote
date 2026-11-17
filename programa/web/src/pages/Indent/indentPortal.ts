import type { IndentPortalState, IndentRecipientResult } from '@/services/indentEnvio';

// IQ Indent (PR 4b): funcoes puras do envio da cotacao e da secao "Portal do fornecedor". Sem React, sem rede.
// As regras de conteudo (sigilo, sentinela) sao do BACKEND: aqui so se valida o formato e se traduz o que ele devolve.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_EMAILS_CADASTRO = 10;
export const ERRO_EMAIL_INVALIDO_LISTA = 'Há um e-mail inválido na lista.';
export const ERRO_EMAIL_MAXIMO_LISTA = 'Informe no máximo 10 e-mails.';

/** Texto livre do cadastro: quebra em virgula, ponto e virgula ou espaco; minusculas, sem vazios nem duplicados (ordem mantida). */
export function parseEmailList(texto: string): { emails: string[] } | { erro: typeof ERRO_EMAIL_INVALIDO_LISTA | typeof ERRO_EMAIL_MAXIMO_LISTA } {
  const vistos = new Set<string>();
  const emails: string[] = [];

  for (const parte of texto.split(/[,;\s]+/)) {
    const email = parte.trim().toLowerCase();
    if (email === '') continue;
    if (!EMAIL_RE.test(email)) return { erro: ERRO_EMAIL_INVALIDO_LISTA };
    if (!vistos.has(email)) {
      vistos.add(email);
      emails.push(email);
    }
  }

  if (emails.length > MAX_EMAILS_CADASTRO) return { erro: ERRO_EMAIL_MAXIMO_LISTA };
  return { emails };
}

/** Chave do campo que o sentinela do backend barrou -> rotulo em portugues para a Compras. Chave desconhecida volta como esta. */
export function rotuloCampoSentinela(chave: string): string {
  if (chave === 'subject') return 'assunto';
  if (chave === 'firstItemName') return 'nome do item 1';
  if (chave === 'destinationPort') return 'porto de destino';
  if (chave === 'message') return 'mensagem';

  const item = /^items\[(\d+)\]\.(name|cas)$/.exec(chave);
  if (item) return `${item[2] === 'cas' ? 'CAS' : 'nome'} do item ${Number(item[1]) + 1}`;

  const anexo = /^attachments\[(\d+)\]\.fileName$/.exec(chave);
  if (anexo) return `nome do anexo ${Number(anexo[1]) + 1}`;

  return chave;
}

/** Troca "(campo: items[0].name)" por "(campo: nome do item 1)"; sem o padrao devolve a mensagem como veio. */
export function mensagemSentinela(mensagem: string): string {
  return mensagem.replace(/\(campo: ([^)]+)\)/, (_inteiro, chave: string) => `(campo: ${rotuloCampoSentinela(chave)})`);
}

/** sent/queued = entregue; suppressed = endereco interno bloqueado pelo backend; failed = motivo do provedor. */
export function resumoEnvio(results: IndentRecipientResult[]): { entregues: string[]; falhas: Array<{ email: string; motivo: string }> } {
  const entregues: string[] = [];
  const falhas: Array<{ email: string; motivo: string }> = [];

  for (const resultado of results) {
    if (resultado.status === 'sent' || resultado.status === 'queued') entregues.push(resultado.email);
    else if (resultado.status === 'suppressed') falhas.push({ email: resultado.email, motivo: 'endereço interno bloqueado (não enviado)' });
    else falhas.push({ email: resultado.email, motivo: resultado.error ?? 'falha no envio' });
  }

  return { entregues, falhas };
}

/** Titulo do toast do envio (mock openSend): "Cotacao 275/26 enviada para X (2 destinatarios)" + " (sem parceria)". */
export function tituloToastEnvio(ref: string, fornecedor: string, entregues: number, semParceria: boolean): string {
  return `Cotação ${ref} enviada para ${fornecedor} (${entregues} ${entregues === 1 ? 'destinatário' : 'destinatários'})${semParceria ? ' (sem parceria)' : ''}`;
}

/** Aguardando resposta com o link sem validade (todos vencidos ou revogados) ou ja vencido. */
export function linkVencido(estado: IndentPortalState, agora: Date): boolean {
  if (estado.state !== 'AGUARDANDO') return false;
  if (estado.expiresAt === null) return true;
  const validade = new Date(estado.expiresAt).getTime();
  return Number.isNaN(validade) || validade < agora.getTime();
}

const dataBr = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });

/** `dd/mm/aaaa` no fuso de Sao Paulo (nunca o do navegador); vazio/invalido = "—". */
export function formatarDataBr(iso: string | null): string {
  if (!iso) return '—';
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? '—' : dataBr.format(data);
}

/** "850 KB" / "1,2 MB" (pt-BR); abaixo de 1 KB em bytes. */
export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = Math.round(bytes / 1024);
  if (kb < 1024) return `${kb} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}
